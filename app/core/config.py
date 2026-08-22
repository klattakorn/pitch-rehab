from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. Every field can be overridden by an ``RTP_*`` env var."""

    model_config = SettingsConfigDict(
        env_prefix="RTP_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: str = "dev"
    app_name: str = "Return-To-Pitch API"
    api_prefix: str = "/api/v1"

    database_url: str = "sqlite:///./rtp.db"
    sql_echo: bool = False

    secret_key: str = "dev-only-insecure-change-me"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60 * 24 * 30

    seed_on_startup: bool = True
    cors_origins: list[str] = ["*"]

    #: ~2 minutes of 30fps landmark frames. Guards the request body size.
    max_frames_per_upload: int = 3600
    # Landmarks below this MediaPipe visibility score are treated as unreliable
    # and excluded from angle computation.
    min_landmark_visibility: float = 0.5

    @property
    def is_prod(self) -> bool:
        return self.env.lower() in {"prod", "production"}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
