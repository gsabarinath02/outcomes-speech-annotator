from functools import lru_cache
from pathlib import Path

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "outcomes.ai speech annotator API"
    api_v1_prefix: str = "/api/v1"
    environment: str = "development"
    debug: bool = True

    database_url: str = Field(
        default="postgresql+psycopg://outcomes_user:outcomes_password@localhost:5432/outcomes_annotator",
        alias="DATABASE_URL",
    )
    jwt_secret_key: str = Field(default="dev-secret", alias="JWT_SECRET_KEY")
    jwt_refresh_secret_key: str = Field(default="dev-refresh-secret", alias="JWT_REFRESH_SECRET_KEY")
    token_expire_minutes: int = Field(default=30, alias="TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_minutes: int = Field(default=10080, alias="REFRESH_TOKEN_EXPIRE_MINUTES")
    algorithm: str = "HS256"

    upload_dir: str = Field(default="data/uploads", alias="UPLOAD_DIR")
    audio_signing_secret: str = Field(default="dev-audio-secret", alias="AUDIO_SIGNING_SECRET")
    audio_signing_expire_seconds: int = 300

    s3_enabled: bool = False
    s3_endpoint_url: str | None = None
    s3_region: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    cors_origins: str = "http://localhost:3000"
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    jobs_inline: bool = Field(default=True, alias="JOBS_INLINE")
    login_rate_limit_enabled: bool = Field(default=True, alias="LOGIN_RATE_LIMIT_ENABLED")
    login_rate_limit_max_attempts: int = Field(default=5, alias="LOGIN_RATE_LIMIT_MAX_ATTEMPTS")
    login_rate_limit_window_seconds: int = Field(default=900, alias="LOGIN_RATE_LIMIT_WINDOW_SECONDS")
    abandoned_upload_cleanup_hours: int = Field(default=24, alias="ABANDONED_UPLOAD_CLEANUP_HOURS")
    failed_job_output_cleanup_hours: int = Field(default=24, alias="FAILED_JOB_OUTPUT_CLEANUP_HOURS")
    export_file_cleanup_hours: int = Field(default=168, alias="EXPORT_FILE_CLEANUP_HOURS")

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if self.environment.lower() in {"prod", "production"}:
            default_values = {
                self.jwt_secret_key: {"dev-secret", "replace-me-with-long-secret"},
                self.jwt_refresh_secret_key: {"dev-refresh-secret", "replace-me-with-long-refresh-secret"},
                self.audio_signing_secret: {"dev-audio-secret", "replace-me-audio-secret"},
            }
            insecure = [value for value, defaults in default_values.items() if value in defaults]
            if insecure:
                raise ValueError("Invalid production secrets: replace default JWT and audio signing secrets")
        return self

    @property
    def upload_path(self) -> Path:
        path = Path(self.upload_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
