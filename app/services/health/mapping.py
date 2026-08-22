"""Normalise Apple HealthKit / Google Health Connect records into ``metric_sample`` rows.

The backend never talks to HealthKit or Health Connect directly -- neither has a
server API. The phone app asks the user for read permission, queries the store,
and POSTs the records to ``/health/sync``. This module is the translation layer:
platform type identifier + unit -> canonical ``health.*`` metric key + SI unit.
"""

from __future__ import annotations

from app.core.enums import HealthPlatform

#: Canonical unit for every ``health.*`` metric we store.
CANONICAL_UNITS: dict[str, str] = {
    "health.running_speed": "m/s",
    "health.walking_speed": "m/s",
    "health.distance_total": "m",
    "health.distance_high_speed": "m",
    "health.step_count": "count",
    "health.step_length": "m",
    "health.cadence": "spm",
    "health.walking_asymmetry": "%",
    "health.walking_double_support": "%",
    "health.ground_contact_time": "ms",
    "health.vertical_oscillation": "cm",
    "health.heart_rate": "bpm",
    "health.resting_heart_rate": "bpm",
    "health.hrv": "ms",
    "health.vo2max": "ml/kg/min",
    "health.sleep_hours": "h",
    "health.active_energy": "kcal",
    "health.workout_duration": "min",
    "health.body_mass": "kg",
    "health.six_minute_walk": "m",
}

#: HKQuantityTypeIdentifier / HKCategoryTypeIdentifier -> metric key.
APPLE_TYPE_MAP: dict[str, str] = {
    "HKQuantityTypeIdentifierRunningSpeed": "health.running_speed",
    "HKQuantityTypeIdentifierWalkingSpeed": "health.walking_speed",
    "HKQuantityTypeIdentifierDistanceWalkingRunning": "health.distance_total",
    "HKQuantityTypeIdentifierStepCount": "health.step_count",
    "HKQuantityTypeIdentifierWalkingStepLength": "health.step_length",
    "HKQuantityTypeIdentifierRunningStrideLength": "health.step_length",
    # The two gait metrics below are the reason Apple Health is worth wiring up
    # at all for rehab: they expose a limp long before the player reports one.
    "HKQuantityTypeIdentifierWalkingAsymmetryPercentage": "health.walking_asymmetry",
    "HKQuantityTypeIdentifierWalkingDoubleSupportPercentage": "health.walking_double_support",
    "HKQuantityTypeIdentifierRunningGroundContactTime": "health.ground_contact_time",
    "HKQuantityTypeIdentifierRunningVerticalOscillation": "health.vertical_oscillation",
    "HKQuantityTypeIdentifierHeartRate": "health.heart_rate",
    "HKQuantityTypeIdentifierRestingHeartRate": "health.resting_heart_rate",
    "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": "health.hrv",
    "HKQuantityTypeIdentifierVO2Max": "health.vo2max",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "health.active_energy",
    "HKQuantityTypeIdentifierBodyMass": "health.body_mass",
    "HKQuantityTypeIdentifierSixMinuteWalkTestDistance": "health.six_minute_walk",
    "HKCategoryTypeIdentifierSleepAnalysis": "health.sleep_hours",
    "HKWorkoutTypeIdentifier": "health.workout_duration",
}

#: androidx.health.connect record type -> metric key.
HEALTH_CONNECT_TYPE_MAP: dict[str, str] = {
    "SpeedRecord": "health.running_speed",
    "DistanceRecord": "health.distance_total",
    "StepsRecord": "health.step_count",
    "StepsCadenceRecord": "health.cadence",
    "HeartRateRecord": "health.heart_rate",
    "RestingHeartRateRecord": "health.resting_heart_rate",
    "HeartRateVariabilityRmssdRecord": "health.hrv",
    "Vo2MaxRecord": "health.vo2max",
    "SleepSessionRecord": "health.sleep_hours",
    "TotalCaloriesBurnedRecord": "health.active_energy",
    "ActiveCaloriesBurnedRecord": "health.active_energy",
    "ExerciseSessionRecord": "health.workout_duration",
    "WeightRecord": "health.body_mass",
}

#: Multiply an incoming value by this factor to reach the canonical unit.
UNIT_FACTORS: dict[str, dict[str, float]] = {
    "m/s": {"m/s": 1.0, "km/h": 1 / 3.6, "mph": 0.44704, "min/km": 0.0},
    "m": {"m": 1.0, "km": 1000.0, "cm": 0.01, "mi": 1609.344, "yd": 0.9144, "ft": 0.3048},
    "count": {"count": 1.0, "steps": 1.0},
    "spm": {"spm": 1.0, "count/min": 1.0, "steps/min": 1.0},
    "%": {"%": 1.0, "percent": 1.0, "fraction": 100.0},
    "ms": {"ms": 1.0, "s": 1000.0},
    "cm": {"cm": 1.0, "m": 100.0, "mm": 0.1},
    "bpm": {"bpm": 1.0, "count/min": 1.0},
    "ml/kg/min": {"ml/kg/min": 1.0, "ml/(kg*min)": 1.0},
    "h": {"h": 1.0, "hr": 1.0, "min": 1 / 60.0, "s": 1 / 3600.0, "ms": 1 / 3_600_000.0},
    "kcal": {"kcal": 1.0, "Cal": 1.0, "kJ": 0.239006, "J": 0.000239006},
    "min": {"min": 1.0, "s": 1 / 60.0, "h": 60.0, "ms": 1 / 60_000.0},
    "kg": {"kg": 1.0, "g": 0.001, "lb": 0.453592},
}

#: Speeds at or above this count as high-speed running (a common football
#: threshold, ~19.8 km/h). Configurable per club if needed.
HIGH_SPEED_THRESHOLD_MS = 5.5


class UnknownHealthType(ValueError):
    pass


def metric_for(platform: HealthPlatform, type_id: str) -> str | None:
    """Map a platform record type to a canonical metric key, or ``None`` to skip it."""
    if platform is HealthPlatform.APPLE_HEALTH:
        return APPLE_TYPE_MAP.get(type_id)
    if platform is HealthPlatform.HEALTH_CONNECT:
        return HEALTH_CONNECT_TYPE_MAP.get(type_id)
    # Manual / other sources are expected to send canonical keys directly.
    return type_id if type_id.startswith("health.") else None


def convert(metric_key: str, value: float, unit: str | None) -> tuple[float, str]:
    """Convert to the canonical unit. Unknown units pass through untouched."""
    canonical = CANONICAL_UNITS.get(metric_key, unit or "")
    if unit is None or unit == canonical:
        return value, canonical
    factor = UNIT_FACTORS.get(canonical, {}).get(unit)
    if factor is None:
        raise UnknownHealthType(f"cannot convert {unit!r} to {canonical!r} for {metric_key}")
    if canonical == "m/s" and unit == "min/km":
        return (1000.0 / (value * 60.0) if value else 0.0), canonical
    return value * factor, canonical
