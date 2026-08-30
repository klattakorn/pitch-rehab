"""End-to-end walk through the flow the mobile app will actually make."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.factories import frames_to_payload, squat_trace

API = "/api/v1"


def auth_headers(client: TestClient, email: str, position: str = "winger") -> dict[str, str]:
    client.post(
        f"{API}/auth/register",
        json={
            "email": email,
            "password": "correct-horse-battery",
            "full_name": "Test Player",
            "position": position,
        },
    )
    token = client.post(
        f"{API}/auth/login", json={"email": email, "password": "correct-horse-battery"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    return auth_headers(client, f"flow-{datetime.now(UTC).timestamp()}@rtpapp.com")


@pytest.fixture
def episode_id(client: TestClient, headers: dict[str, str]) -> int:
    response = client.post(
        f"{API}/injuries",
        headers=headers,
        json={
            "injury_site": "hamstring",
            "side": "left",
            "injured_on": (date.today() - timedelta(days=20)).isoformat(),
            "severity": "grade_2",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_health_endpoint_needs_no_auth(client: TestClient) -> None:
    assert client.get("/healthz").json()["status"] == "ok"


def test_protected_endpoints_reject_anonymous_callers(client: TestClient) -> None:
    assert client.get(f"{API}/injuries").status_code == 401


def test_registration_requires_a_position_for_players(client: TestClient) -> None:
    response = client.post(
        f"{API}/auth/register",
        json={"email": "nopos@rtpapp.com", "password": "correct-horse-battery",
              "full_name": "No Position"},
    )
    assert response.status_code == 422
    assert "position" in response.json()["detail"]


def test_login_does_not_reveal_whether_an_email_exists(client: TestClient) -> None:
    unknown = client.post(
        f"{API}/auth/login", json={"email": "ghost@rtpapp.com", "password": "whatever12"}
    )
    auth_headers(client, "known@rtpapp.com")
    wrong = client.post(
        f"{API}/auth/login", json={"email": "known@rtpapp.com", "password": "wrong-password"}
    )
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json()["detail"] == wrong.json()["detail"]


def test_creating_an_injury_assigns_the_position_specific_protocol(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    episode = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert episode["protocol_id"] is not None
    assert episode["current_phase"] == "p1_protect"

    protocol = client.get(f"{API}/injuries/{episode_id}/protocol", headers=headers).json()
    assert protocol["position"] == "winger"
    assert protocol["injury_site"] == "hamstring"
    assert len(protocol["phases"]) == 4


def test_reseeding_the_library_does_not_strand_a_player(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    """Regression: the seeder used to delete and recreate every protocol, which
    detached anyone mid-rehab and left them with no programme."""
    from app.db.seed import seed_all
    from app.db.session import SessionLocal

    before = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert before["protocol_id"] is not None

    with SessionLocal() as db:
        seed_all(db)

    after = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert after["protocol_id"] == before["protocol_id"]
    # And the plan still resolves rather than 404-ing.
    assert client.get(f"{API}/injuries/{episode_id}/today", headers=headers).status_code == 200


def test_today_returns_the_current_phase_plan(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    plan = client.get(f"{API}/injuries/{episode_id}/today", headers=headers).json()
    assert plan["phase_key"] == "p1_protect"
    assert len(plan["prescriptions"]) > 0
    assert any(c["required"] for c in plan["exit_criteria"])
    # Every prescription carries the rule the phone needs to score it live.
    for rx in plan["prescriptions"]:
        assert "pose_rule" in rx["exercise"]


def test_a_full_session_is_scored_and_feeds_the_exit_criteria(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions",
        headers=headers,
        json={"device": "pytest", "app_version": "0.1.0"},
    ).json()["id"]

    # Phase 1 for a hamstring asks for 120 degrees of pain-free knee flexion.
    frames = squat_trace(
        reps=4, peak_flexion=130.0, sagittal_axis="x", thigh_fixed=True, seconds_per_rep=3.0
    )
    response = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "prone_hamstring_curl",
            "side": "left",
            "prescribed_reps": 12,
            "frames": frames_to_payload(frames),
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["completed_reps"] == 4
    assert result["valid_reps"] == 4
    assert result["form_score"] > 90
    assert {e["key"] for e in result["emitted"]} == {"pose.knee_flexion_rom"}

    completed = client.post(
        f"{API}/sessions/{session_id}/complete",
        headers=headers,
        json={"rpe": 5, "pain_during": 1, "pain_after": 1},
    )
    assert completed.json()["status"] == "completed"

    gate = client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers).json()
    rom = next(c for c in gate["criteria"] if c["key"] == "knee_rom")
    assert rom["status"] == "pass"
    assert rom["observed"] == pytest.approx(130.0, abs=3.0)
    assert gate["passed"] is False  # other gates still open
    assert "knee_rom" not in gate["blocking"]


def test_wrong_camera_angle_tells_the_player_to_move_the_phone(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions", headers=headers, json={}
    ).json()["id"]
    # single_leg_squat must be filmed head-on; send footage shot from the side.
    response = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "single_leg_squat",
            "side": "left",
            "image_width": 1080,
            "image_height": 1920,
            "frames": frames_to_payload(
                squat_trace(reps=4, peak_flexion=80.0, sagittal_axis="x")
            ),
        },
    )
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["error"] == "wrong_camera_view"
    assert detail["expected_view"] == "front"
    assert detail["detected_view"] == "side"
    assert detail["message_th"]

    # Nothing was written — a rejected set must not leave half a set behind.
    metrics = client.get(
        f"{API}/injuries/{episode_id}/metrics",
        headers=headers,
        params={"metric_key": "pose.slsq_knee_flexion"},
    ).json()
    assert metrics == []


def test_camera_scored_exercises_reject_an_empty_upload(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions", headers=headers, json={}
    ).json()["id"]
    response = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={"exercise_key": "prone_hamstring_curl", "side": "left", "frames": []},
    )
    assert response.status_code == 422
    assert "landmark frames" in response.json()["detail"]


def test_drills_with_no_camera_rule_are_logged_manually(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions", headers=headers, json={}
    ).json()["id"]
    response = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={"exercise_key": "progressive_running", "completed_reps": 1},
    )
    assert response.status_code == 200
    assert response.json()["warnings"] == ["manually_logged"]


def test_frame_payloads_must_carry_all_33_landmarks(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions", headers=headers, json={}
    ).json()["id"]
    response = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "prone_hamstring_curl",
            "frames": [{"t": 0.0, "landmarks": [{"x": 0.5, "y": 0.5}] * 12}],
        },
    )
    assert response.status_code == 422


def test_pain_logs_flow_into_the_pro_criteria(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    for days_ago in range(5):
        response = client.post(
            f"{API}/injuries/{episode_id}/pain-logs",
            headers=headers,
            json={
                "recorded_at": (datetime.now(UTC) - timedelta(days=days_ago)).isoformat(),
                "pain_rest": 0,
                "pain_activity": 1,
                "confidence": 88,
            },
        )
        assert response.status_code == 201

    gate = client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers).json()
    pain = next(c for c in gate["criteria"] if c["key"] == "pain_at_rest")
    assert pain["status"] == "pass"
    streak = next(c for c in gate["criteria"] if c["key"] == "pain_free_days")
    assert streak["observed"] >= 3


def test_players_cannot_sign_themselves_off(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    response = client.post(
        f"{API}/injuries/{episode_id}/signoff",
        headers=headers,
        json={"phase_key": "p4_return", "approved": True},
    )
    assert response.status_code == 403


def test_a_player_cannot_read_another_players_episode(
    client: TestClient, episode_id: int
) -> None:
    other = auth_headers(client, "intruder@rtpapp.com", position="striker")
    assert client.get(f"{API}/injuries/{episode_id}", headers=other).status_code == 404


def test_advance_refuses_while_gates_are_open(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    response = client.post(f"{API}/injuries/{episode_id}/advance", headers=headers).json()
    assert response["advanced"] is False
    assert response["episode"]["current_phase"] == "p1_protect"
    assert response["gate"]["blocking"]


def test_catalog_exposes_every_position_and_injury_combination(
    client: TestClient,
) -> None:
    protocols = client.get(f"{API}/catalog/protocols").json()
    assert len(protocols) == 42  # 6 positions x 7 injury sites
    combos = {(p["position"], p["injury_site"]) for p in protocols}
    assert len(combos) == 42

    winger = client.get(f"{API}/catalog/protocols/winger/hamstring").json()
    keeper = client.get(f"{API}/catalog/protocols/goalkeeper/hamstring").json()

    def drills(protocol: dict, phase_key: str) -> set[str]:
        phase = next(p for p in protocol["phases"] if p["phase_key"] == phase_key)
        return {rx["exercise"]["key"] for rx in phase["prescriptions"]}

    # Same injury, different job: a keeper trains dive landings in phase 3 and a
    # winger trains bounds, and neither is handed the other's work.
    assert "goalkeeper_dive_landing" in drills(keeper, "p3_running")
    assert "goalkeeper_dive_landing" not in drills(winger, "p3_running")
    assert "lateral_bound" in drills(winger, "p3_running")

    def criteria(protocol: dict, phase_key: str) -> set[str]:
        phase = next(p for p in protocol["phases"] if p["phase_key"] == phase_key)
        return {c["key"] for c in phase["exit_criteria"]}

    # And the keeper is tested on the landing they were made to practise.
    assert "lateral_landing_valgus" in criteria(keeper, "p3_running")
    assert "lateral_landing_valgus" not in criteria(winger, "p3_running")


def test_role_picker_shows_what_a_position_actually_changes(client: TestClient) -> None:
    """The role screen has to justify itself, not just collect a label.

    Whatever it displays comes from this endpoint, and this endpoint reads the
    same profiles the protocol composer uses -- so the promise made on the picker
    and the programme the player is handed cannot drift apart.
    """
    positions = client.get(f"{API}/catalog/positions").json()
    assert len(positions) == 6

    by_key = {p["key"]: p for p in positions}
    assert set(by_key) == {
        "goalkeeper", "centre_back", "full_back",
        "centre_midfield", "winger", "striker",
    }

    for position in positions:
        assert position["blurb_en"].strip(), f"{position['key']} has nothing to say"
        for extra in position["extra_exercises"] + position["extra_criteria"]:
            assert extra["phase_order"] in (1, 2, 3, 4)

    winger, keeper = by_key["winger"], by_key["goalkeeper"]

    # What the picker promises is what the protocol composes.
    protocol = client.get(f"{API}/catalog/protocols/winger/hamstring").json()
    listed = {c["key"] for c in winger["extra_criteria"]}
    composed = {
        c["key"] for phase in protocol["phases"] for c in phase["exit_criteria"]
    }
    assert listed <= composed, "the picker names a test the programme does not carry"

    # Centre midfield adds nothing of its own. Its only extra criterion was the
    # weekly-distance gate, which the health app fed; with that gone the role
    # runs the core programme unchanged. Pinned rather than papered over -- if
    # something position-specific is added for them, update this.
    assert by_key["centre_midfield"]["extra_exercises"] == []
    assert by_key["centre_midfield"]["extra_criteria"] == []

    # A keeper trains dive landings; a winger does not. That difference is the
    # whole argument for asking the question.
    assert any(e["key"] == "goalkeeper_dive_landing" for e in keeper["extra_exercises"])
    assert not any(e["key"] == "goalkeeper_dive_landing" for e in winger["extra_exercises"])

    # Repeated sprint is prescribed in P4 for wingers; it must be listed once,
    # under the phase it first appears in, not repeated per phase.
    keys = [e["key"] for e in winger["extra_exercises"]]
    assert len(keys) == len(set(keys))
    assert all(e["phase_order"] in (1, 2, 3, 4) for e in winger["extra_exercises"])


def test_changing_position_moves_the_targets_without_losing_progress(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    """The role picker promises a position sets your targets. Make that true.

    A player who switches position mid-rehab has to end up on the new
    programme -- otherwise the screen lied. What they must *not* lose is where
    they had got to, so the phase and its clock have to survive the move.
    """
    before = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert before["current_phase"] == "p1_protect"

    def running_drills() -> set[str]:
        protocol = client.get(
            f"{API}/injuries/{episode_id}/protocol", headers=headers
        ).json()
        phase = next(p for p in protocol["phases"] if p["phase_key"] == "p3_running")
        return {rx["exercise"]["key"] for rx in phase["prescriptions"]}

    assert "lateral_bound" in running_drills()  # winger
    assert "goalkeeper_dive_landing" not in running_drills()

    # Advance out of phase 1 so there is real progress to preserve.
    client.post(
        f"{API}/injuries/{episode_id}/pain-logs",
        headers=headers,
        json={"pain_rest": 0, "pain_activity": 0, "logged_for": str(date.today())},
    )

    updated = client.patch(
        f"{API}/players/me/profile", headers=headers, json={"position": "goalkeeper"}
    )
    assert updated.status_code == 200
    assert updated.json()["position"] == "goalkeeper"

    # The programme followed the player...
    assert "goalkeeper_dive_landing" in running_drills()
    keeper_plan = client.get(f"{API}/injuries/{episode_id}/protocol", headers=headers).json()
    assert keeper_plan["position"] == "goalkeeper"
    assert keeper_plan["injury_site"] == before["injury_site"]

    # ...and did not throw away where they were.
    after = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert after["current_phase"] == before["current_phase"]
    assert after["injured_on"] == before["injured_on"]
    assert client.get(f"{API}/injuries/{episode_id}/today", headers=headers).status_code == 200


def test_setting_the_same_position_again_changes_nothing(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    """Re-saving the picker without changing the answer must be a no-op."""
    before = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    client.patch(f"{API}/players/me/profile", headers=headers, json={"position": "winger"})
    after = client.get(f"{API}/injuries/{episode_id}", headers=headers).json()
    assert after["protocol_id"] == before["protocol_id"]
    assert after["current_phase"] == before["current_phase"]

def test_progress_is_derived_and_never_disagrees_with_the_testing_screen(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    """The dashboard and the gate read the same source, so they cannot drift.

    Nothing on the progress screen is stored -- it is recomputed from completed
    sessions and the live gate every time it is asked for.
    """
    progress = client.get(f"{API}/injuries/{episode_id}/progress", headers=headers).json()
    gate = client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers).json()

    assert progress["criteria_passed"] == gate["required_passed"]
    assert progress["criteria_total"] == gate["required_total"]
    assert progress["phase_key"] == gate["phase_key"]

    # A fresh episode has done nothing. Those are zeroes; the accuracy is not --
    # it is unmeasured, and 0% would read as failure rather than as no data.
    assert progress["sessions_completed"] == 0
    assert progress["exercises_completed"] == 0
    assert progress["mean_form_score"] is None
    assert progress["symmetry"] is None

    # Overall progress spans the four phases, not just the current one.
    assert progress["phase_order"] == 1
    assert 0 <= progress["overall_pct"] <= 25

    # The chart always has a full window, so it never renders as a stub.
    assert len(progress["trend"]) == 28
    assert all(point["mean_form_score"] is None for point in progress["trend"])

    # Milestones say so plainly rather than showing an empty box.
    assert progress["milestones"] and progress["milestones"][0]["reached"] is False


def test_progress_counts_a_real_session(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    session_id = client.post(
        f"{API}/injuries/{episode_id}/sessions", headers=headers, json={}
    ).json()["id"]
    uploaded = client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "prone_hamstring_curl",
            "side": "left",
            "image_width": 1280,
            "image_height": 720,
            "frames": frames_to_payload(
                squat_trace(
                    reps=3,
                    peak_flexion=130.0,
                    sagittal_axis="x",
                    thigh_fixed=True,
                    seconds_per_rep=3.0,
                )
            ),
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    client.post(f"{API}/sessions/{session_id}/complete", headers=headers, json={"rpe": 5})

    progress = client.get(f"{API}/injuries/{episode_id}/progress", headers=headers).json()
    assert progress["sessions_completed"] == 1
    assert progress["exercises_completed"] == 1
    assert progress["mean_form_score"] is not None

    # Today is the last point in the window, and it is where the work landed.
    assert progress["trend"][-1]["sessions"] == 1
    assert progress["top_exercises"][0]["key"] == "prone_hamstring_curl"

def test_a_phase_never_reads_full_while_a_test_is_failing(
    client: TestClient, headers: dict[str, str], episode_id: int
) -> None:
    """The ring counts criteria passed, not average progress toward each.

    Averaging rounds a gate up: one criterion sitting at 79.3 against a target
    of 80 is 99% of the way there, and the mean of that with four passes is
    100%. A ring reading 100% beside the words "NOT YET" is not a rounding
    error, it is the screen contradicting itself.
    """
    # Clear one criterion and leave the rest untouched.
    client.post(
        f"{API}/injuries/{episode_id}/pain-logs",
        headers=headers,
        json={"pain_rest": 0, "pain_activity": 0, "logged_for": str(date.today())},
    )

    gate = client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers).json()
    progress = client.get(f"{API}/injuries/{episode_id}/progress", headers=headers).json()

    assert not gate["passed"]
    assert gate["required_passed"] < gate["required_total"]
    assert progress["phase_pct"] < 100
    assert progress["phase_pct"] == pytest.approx(
        100 * gate["required_passed"] / gate["required_total"], abs=0.1
    )

def test_a_tendinopathy_is_not_treated_like_a_torn_ligament(client: TestClient) -> None:
    """The two used to share one "knee" programme. They need opposite handling:
    a reconstructed ligament is protected early, a painful tendon is loaded."""
    acl = client.get(f"{API}/catalog/protocols/winger/acl").json()
    tendon = client.get(f"{API}/catalog/protocols/winger/patellar_tendinopathy").json()

    def phase_one(protocol: dict) -> dict:
        return next(p for p in protocol["phases"] if p["phase_key"] == "p1_protect")

    acl_exercises = {rx["exercise"]["key"] for rx in phase_one(acl)["prescriptions"]}
    tendon_exercises = {rx["exercise"]["key"] for rx in phase_one(tendon)["prescriptions"]}
    assert acl_exercises != tendon_exercises
    # The tendon programme loads it from day one.
    assert "spanish_squat" in tendon_exercises

    # And it tolerates pain that would block an acute injury.
    tendon_pain = next(
        c for c in phase_one(tendon)["exit_criteria"] if c["key"] == "tendon_pain_during"
    )
    acl_pain = next(
        c for c in phase_one(acl)["exit_criteria"] if c["key"] == "pain_at_rest"
    )
    assert tendon_pain["spec"]["target"]["value"] > acl_pain["spec"]["target"]["value"]


def test_every_running_phase_is_gated_on_change_of_direction(client: TestClient) -> None:
    """Cutting is where knees and groins get hurt, so straight-line speed alone
    must not clear anyone."""
    for site in ("hamstring", "acl", "ankle", "adductor", "groin", "calf"):
        protocol = client.get(f"{API}/catalog/protocols/winger/{site}").json()
        for key in ("p3_running", "p4_return"):
            phase = next(p for p in protocol["phases"] if p["phase_key"] == key)
            keys = {c["key"] for c in phase["exit_criteria"]}
            assert "change_of_direction" in keys, f"{site} {key}"
