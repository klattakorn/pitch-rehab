"""Drive the whole player journey against a running server, and narrate it.

    uvicorn app.main:app --reload      # in one terminal
    python scripts/walkthrough.py      # in another

Creates one winger with a left hamstring tear, does a camera-scored session,
logs pain, and prints the exit-criteria gate at each step.
Everything it does is a plain HTTP call you can repeat by hand in /docs.
"""

from __future__ import annotations

import sys
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# The synthetic-skeleton helpers the test suite uses, so this script can produce
# a believable landmark stream without a camera.
from tests.factories import frames_to_payload, squat_trace  # noqa: E402

BASE = "http://127.0.0.1:8000"
API = f"{BASE}/api/v1"

EMAIL = "somchai@rtpapp.com"
PASSWORD = "correct-horse-battery"

GREEN, RED, GREY, DIM, BOLD, OFF = (
    "\033[92m",
    "\033[91m",
    "\033[93m",
    "\033[90m",
    "\033[1m",
    "\033[0m",
)


def step(n: str, title: str) -> None:
    print(f"\n{BOLD}{'─' * 78}\n{n}  {title}\n{'─' * 78}{OFF}")


def show(method: str, path: str, note: str = "") -> None:
    print(f"{DIM}    {method:5} {path}{('   # ' + note) if note else ''}{OFF}")


def check(response: httpx.Response) -> dict:
    if response.status_code >= 400:
        print(f"{RED}    {response.status_code} {response.text[:400]}{OFF}")
        response.raise_for_status()
    return response.json()


def print_gate(gate: dict) -> None:
    icons = {"pass": f"{GREEN}✔{OFF}", "fail": f"{RED}✘{OFF}",
             "no_data": f"{GREY}○{OFF}", "pending_signoff": f"{GREY}◔{OFF}"}
    pct = round(gate["progress"] * 100)
    verdict = f"{GREEN}UNLOCKED{OFF}" if gate["passed"] else f"{RED}LOCKED{OFF}"
    print(
        f"\n    {BOLD}{gate['phase_key']}{OFF}  {verdict}   "
        f"{gate['required_passed']}/{gate['required_total']} required gates   "
        f"{pct}% overall\n"
    )
    for c in gate["criteria"]:
        icon = icons.get(c["status"], "?")
        tag = "    " if c["required"] else f"{GREY}opt {OFF}"
        observed = "—" if c["observed"] is None else f"{c['observed']:g}"
        target = "—" if c["target"] is None else f"{c['target']:g}"
        unit = c["unit"] or ""
        bar_len = round(c["progress"] * 20)
        bar = "█" * bar_len + "·" * (20 - bar_len)
        print(f"      {icon} {tag}{c['label_en']:<46} {bar}  {observed:>7} / {target:<7} {unit}")
        if c["baseline_origin"] and c["baseline_origin"] != "none":
            print(f"{DIM}              baseline from: {c['baseline_origin']}{OFF}")
    if gate["blocking"]:
        print(f"\n    {RED}blocking:{OFF} {', '.join(gate['blocking'])}")


def main() -> None:
    client = httpx.Client(timeout=60.0)

    try:
        client.get(f"{BASE}/healthz")
    except httpx.ConnectError:
        print(f"{RED}Server not running. Start it with:  uvicorn app.main:app --reload{OFF}")
        sys.exit(1)

    # ---------------------------------------------------------------- 1
    step("1.", "Register a player")
    show("POST", "/api/v1/auth/register")
    response = client.post(
        f"{API}/auth/register",
        json={
            "email": EMAIL,
            "password": PASSWORD,
            "full_name": "Somchai P.",
            "position": "winger",
            "dominant_foot": "right",
            "locale": "th",
        },
    )
    if response.status_code == 409:
        print(f"{GREY}    already registered — reusing{OFF}")
    else:
        user = check(response)
        print(f"    created user #{user['id']} · position: {user['profile']['position']}")
    print(f"{DIM}    Position is required at signup — it decides which of the 30 "
          f"protocols they get.{OFF}")

    # ---------------------------------------------------------------- 2
    step("2.", "Log in")
    show("POST", "/api/v1/auth/login")
    token = check(client.post(f"{API}/auth/login",
                              json={"email": EMAIL, "password": PASSWORD}))["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"    token: {token[:38]}…")
    print(f"{DIM}    Paste this into the green Authorize button in /docs to poke around "
          f"as this player.{OFF}")

    # ---------------------------------------------------------------- 3
    step("3.", "Open an injury episode")
    existing = check(client.get(f"{API}/injuries", headers=headers,
                                params={"status_filter": "active"}))
    if existing:
        episode = existing[0]
        print(f"{GREY}    reusing active episode #{episode['id']}{OFF}")
    else:
        show("POST", "/api/v1/injuries")
        episode = check(client.post(
            f"{API}/injuries",
            headers=headers,
            json={
                "injury_site": "hamstring",
                "side": "left",
                "injured_on": (date.today() - timedelta(days=12)).isoformat(),
                "severity": "grade_2",
                "diagnosis": "Left biceps femoris strain",
                # Somchai tore it 12 days ago and has been rehabbing on his own
                # for the last 8 — the healing-time gate counts from here.
                "phase_started_at": (datetime.now(UTC) - timedelta(days=8)).isoformat(),
            },
        ))
    episode_id = episode["id"]
    protocol = check(client.get(f"{API}/injuries/{episode_id}/protocol", headers=headers))
    print(f"    episode #{episode_id} · phase: {episode['current_phase']}")
    print(f"    auto-assigned protocol: {BOLD}{protocol['title_en']}{OFF}")
    print(f"{DIM}    winger + hamstring → one specific programme, picked automatically.{OFF}")

    # ---------------------------------------------------------------- 4
    step("4.", "What should they do today?")
    show("GET", f"/api/v1/injuries/{episode_id}/today")
    plan = check(client.get(f"{API}/injuries/{episode_id}/today", headers=headers))
    print(f"    {BOLD}{plan['title_en']}{OFF} — {plan['goal_en']}")
    print(f"    minimum {plan['min_days']} days in this phase, "
          f"{plan['sessions_per_week']} sessions/week\n")
    for rx in plan["prescriptions"]:
        ex = rx["exercise"]
        amount = f"{rx['reps']}" if rx["reps"] else f"{rx['hold_seconds']:g}s"
        dose = f"{rx['sets']}×{amount}"
        camera = "camera-scored" if ex["pose_rule"] else "logged by hand"
        print(f"      · {ex['name_en']:<32} {ex['name_th']:<34} {dose:<8} {GREY}{camera}{OFF}")

    # ---------------------------------------------------------------- 5
    step("5.", "The gate, before doing anything")
    show("GET", f"/api/v1/injuries/{episode_id}/exit-criteria")
    print_gate(check(client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers)))
    print(f"\n{DIM}    Nothing measured yet, so everything reads ○ no_data. "
          f"no_data never counts as a pass.{OFF}")

    # ---------------------------------------------------------------- 6
    step("6.", "Do a session in front of the camera")
    session_id = check(client.post(
        f"{API}/injuries/{episode_id}/sessions",
        headers=headers,
        json={"device": "walkthrough-script", "app_version": "0.1.0"},
    ))["id"]
    show("POST", f"/api/v1/sessions/{session_id}/sets", "6 reps of landmarks")

    frames = squat_trace(reps=6, peak_flexion=132.0, sagittal_axis="x",
                         thigh_fixed=True, seconds_per_rep=3.0)
    result = check(client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "prone_hamstring_curl",
            "side": "left",
            "prescribed_reps": 12,
            "frames": frames_to_payload(frames),
        },
    ))
    print(f"    sent {len(frames)} landmark frames "
          f"({len(frames) * 33:,} landmarks) of a prone hamstring curl\n")
    print(f"    reps detected: {BOLD}{result['completed_reps']}{OFF}   "
          f"valid: {BOLD}{result['valid_reps']}{OFF}   "
          f"form score: {BOLD}{result['form_score']}/100{OFF}   "
          f"tracking: {result['tracking_quality']}")
    for rep in result["reps"][:3]:
        flags = ", ".join(v["code"] for v in rep["violations"]) or "clean"
        print(f"      rep {rep['index'] + 1}: {rep['duration']:.1f}s  "
              f"score {rep['form_score']:g}  {rep['metrics']}  {GREY}{flags}{OFF}")
    print(f"\n    pushed to the criteria engine: "
          f"{', '.join(f'{e['key']}={e['value']:g}{e['unit']}' for e in result['emitted'])}")

    # a second, sloppier set so the violation messages show up
    sloppy = check(client.post(
        f"{API}/sessions/{session_id}/sets",
        headers=headers,
        json={
            "exercise_key": "prone_hamstring_curl",
            "side": "left",
            "order_index": 1,
            "frames": frames_to_payload(
                squat_trace(reps=3, peak_flexion=62.0, sagittal_axis="x",
                            thigh_fixed=True, seconds_per_rep=3.0)
            ),
        },
    ))
    print(f"\n    second set, deliberately shallow → form score "
          f"{RED}{sloppy['form_score']}/100{OFF}")
    for violation in sloppy["reps"][0]["violations"]:
        print(f"      {RED}!{OFF} {violation['message_en']}")
        print(f"        {violation['message_th']}")

    check(client.post(f"{API}/sessions/{session_id}/complete", headers=headers,
                      json={"rpe": 5, "pain_during": 1, "pain_after": 1}))
    print(f"\n    session closed{DIM} — RPE and pain go in as pro.* metrics too{OFF}")

    # ---------------------------------------------------------------- 7
    step("7.", "The rest of the week's sessions")
    show("POST", f"/api/v1/injuries/{episode_id}/sessions", "×5, backdated")
    for days_ago in range(1, 6):
        when = datetime.now(UTC) - timedelta(days=days_ago)
        past = check(client.post(
            f"{API}/injuries/{episode_id}/sessions",
            headers=headers,
            json={"started_at": when.isoformat(), "device": "walkthrough-script"},
        ))
        check(client.post(
            f"{API}/sessions/{past['id']}/complete",
            headers=headers,
            json={"ended_at": (when + timedelta(minutes=25)).isoformat(),
                  "rpe": 4, "pain_during": 1, "pain_after": 0},
        ))
    print("    5 more completed sessions over the last 5 days")
    print(f"{DIM}    Adherence is completed sessions ÷ what the phase prescribes for the "
          f"time elapsed.{OFF}")

    # ---------------------------------------------------------------- 7b
    step("8.", "Daily pain check-ins")
    show("POST", f"/api/v1/injuries/{episode_id}/pain-logs", "×6 days")
    for days_ago in range(6):
        check(client.post(
            f"{API}/injuries/{episode_id}/pain-logs",
            headers=headers,
            json={
                "recorded_at": (datetime.now(UTC) - timedelta(days=days_ago)).isoformat(),
                "pain_rest": 0,
                "pain_activity": 1,
                "confidence": 84,
            },
        ))
    print("    6 days of pain-free logs")

    # ---------------------------------------------------------------- 9
    step("9.", "The gate again, now that there is data")
    print_gate(check(client.get(f"{API}/injuries/{episode_id}/exit-criteria", headers=headers)))

    # ---------------------------------------------------------------- 10
    step("10.", "Try to move to the next phase")
    show("POST", f"/api/v1/injuries/{episode_id}/advance")
    advance = check(client.post(f"{API}/injuries/{episode_id}/advance", headers=headers))
    if advance["advanced"]:
        print(f"    {GREEN}advanced to {advance['episode']['current_phase']}{OFF}")
    else:
        print(f"    {RED}refused{OFF} — still on {advance['episode']['current_phase']}")
        print(f"    blocking: {', '.join(advance['gate']['blocking'])}")
    print(f"{DIM}    No partial credit. Every required gate passes, or nothing moves.{OFF}")

    attempts = check(client.get(f"{API}/injuries/{episode_id}/attempts", headers=headers))
    print("\n    audit trail:")
    for attempt in attempts:
        mark = f"{GREEN}passed{OFF}" if attempt["passed"] else f"{GREY}open{OFF}"
        entered = (attempt["entered_at"] or "")[:10]
        print(f"      {attempt['phase_key']:<14} entered {entered}  {mark}")
    print(f"{DIM}    Each passed phase keeps a frozen copy of the gate that let the "
          f"player through,\n    so a physio can always answer 'why was this player "
          f"cleared?'{OFF}")

    if advance["advanced"]:
        step("11.", "The new phase's gate")
        print_gate(check(client.get(f"{API}/injuries/{episode_id}/exit-criteria",
                                    headers=headers)))
        print(f"\n{DIM}    Harder gates, and new exercises to match. "
              f"GET /injuries/{episode_id}/today to see them.{OFF}")

    # ---------------------------------------------------------------- 12
    step("12.", "Same injury, different position")
    show("GET", "/api/v1/catalog/protocols/{position}/hamstring")
    print(f"\n    {'position':<18}{'phase 3 speed':>14}{'phase 4 speed':>15}")
    for position in ("winger", "full_back", "striker", "centre_midfield",
                     "centre_back", "goalkeeper"):
        proto = check(client.get(f"{API}/catalog/protocols/{position}/hamstring"))
        targets = {}
        for phase in proto["phases"]:
            for criterion in phase["exit_criteria"]:
                if criterion["key"] == "speed_vs_baseline":
                    targets[phase["phase_key"]] = criterion["spec"]["target"]["value"]
        print(f"    {position:<18}{targets.get('p3_running', 0):>13.0f}%"
              f"{targets.get('p4_return', 0):>14.0f}%")
    print(f"\n{DIM}    Identical hamstring tear. The winger has to run faster than the "
          f"keeper to be let back —\n    and both percentages are of their own "
          f"pre-injury speed, not each other's.{OFF}")

    print(f"\n{BOLD}{'─' * 78}{OFF}")
    print(f"Log in at {BASE}/docs as {EMAIL} / {PASSWORD}")
    print(f"Episode id is {episode_id}.\n")
    client.close()


if __name__ == "__main__":
    main()
