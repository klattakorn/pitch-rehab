"""Fallback reference values, per playing position.

These are **configuration, not clinical truth**. They are only used when a player
has no personal baseline stored (`player_baseline`) and no usable pre-injury
history -- so a first-time user still gets a concrete target instead of a
"no data" wall. A club should overwrite them with its own testing data, and a
clinician can always override a target per episode.

Sources of the shape of these numbers: typical amateur/semi-pro senior male
values reported in team-sport testing literature. Treat them as placeholders.
"""

from __future__ import annotations

from app.core.enums import Position

#: metric_key -> value. Units are documented in ``METRIC_UNITS``.
_BASE: dict[str, float] = {
    "test.sprint_30m": 4.45,  # s (lower is better)
    "test.cmj_height": 0.34,  # m
    "test.hop_single": 1.45,  # m
    "test.hop_triple": 4.60,  # m
    "test.iso_hamstring": 3.0,  # N/kg
    "test.iso_quadriceps": 3.2,  # N/kg
    "test.iso_adductor": 2.6,  # N/kg
    "test.heel_raise_reps": 25.0,
    "test.yo_yo_ir1": 1400.0,  # m
}

_OVERRIDES: dict[Position, dict[str, float]] = {
    Position.GOALKEEPER: {
        "test.sprint_30m": 4.70,
        "test.cmj_height": 0.40,  # keepers jump more than they sprint
        "test.yo_yo_ir1": 900.0,
    },
    Position.CENTRE_BACK: {
        "test.sprint_30m": 4.35,
        "test.cmj_height": 0.38,
        "test.yo_yo_ir1": 1300.0,
    },
    Position.FULL_BACK: {
        "test.sprint_30m": 4.15,
        "test.yo_yo_ir1": 1800.0,
    },
    Position.CENTRE_MIDFIELD: {
        "test.sprint_30m": 4.30,
        "test.yo_yo_ir1": 2000.0,
    },
    Position.WINGER: {
        "test.sprint_30m": 4.05,
        "test.hop_triple": 4.90,
        "test.yo_yo_ir1": 1800.0,
    },
    Position.STRIKER: {
        "test.sprint_30m": 4.10,
        "test.cmj_height": 0.39,
        "test.yo_yo_ir1": 1500.0,
    },
}

METRIC_UNITS: dict[str, str] = {
    "test.sprint_30m": "s",
    "test.cmj_height": "m",
    "test.hop_single": "m",
    "test.hop_triple": "m",
    "test.iso_hamstring": "N/kg",
    "test.iso_quadriceps": "N/kg",
    "test.iso_adductor": "N/kg",
    "test.heel_raise_reps": "count",
    "test.yo_yo_ir1": "m",
}


def position_norm(position: Position, metric_key: str) -> float | None:
    override = _OVERRIDES.get(position, {})
    if metric_key in override:
        return override[metric_key]
    return _BASE.get(metric_key)
