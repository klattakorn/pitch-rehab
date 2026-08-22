from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.core.enums import HealthPlatform


class HealthRecordIn(BaseModel):
    """One record as read from HealthKit or Health Connect on the device.

    ``type`` is the platform's own identifier (``HKQuantityTypeIdentifierRunningSpeed``,
    ``SpeedRecord``, ...) -- the backend does the mapping so the app does not have
    to know our metric names. ``external_id`` should be the platform record UUID;
    it is what makes re-syncing safe.
    """

    type: str
    value: float
    unit: str | None = None
    start_at: datetime
    end_at: datetime | None = None
    external_id: str | None = Field(default=None, max_length=128)
    meta: dict[str, Any] | None = None


class HealthSyncIn(BaseModel):
    platform: HealthPlatform
    device_id: str | None = Field(default=None, max_length=128)
    #: Opaque HKQueryAnchor / Health Connect changes-token to hand back next sync.
    anchor: str | None = None
    records: list[HealthRecordIn] = Field(max_length=5000)


class HealthSyncOut(BaseModel):
    received: int
    stored: int
    duplicates: int
    derived: int
    skipped: list[dict[str, Any]]
    #: Echo the anchor back so the client can persist it.
    anchor: str | None = None


class SupportedMetricsOut(BaseModel):
    apple_health: dict[str, str]
    health_connect: dict[str, str]
    canonical_units: dict[str, str]
    derived: list[str]
    note: str
