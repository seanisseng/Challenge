"""Application configuration loaded from environment variables."""

from __future__ import annotations

import hashlib
import hmac
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings sourced from the environment / .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # No defaults for the connection settings: they come from .env, which
    # points at the hosted Supabase project. Leaving them blank makes a
    # missing .env fail loudly instead of silently targeting a dead host.
    supabase_url: str = ""

    # Supabase ships two names for the same elevated credential:
    #   * SUPABASE_SECRET_KEY        - the new `sb_secret_...` key (preferred)
    #   * SUPABASE_SERVICE_ROLE_KEY  - the legacy `eyJ...` JWT (valid to end 2026)
    # Both resolve to the `service_role` Postgres role, so either works. Set
    # whichever the dashboard gave you; `service_key` picks the one present.
    supabase_secret_key: str = ""
    supabase_service_role_key: str = ""

    database_url: str = ""

    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    backend_cors_origins: str = "http://localhost:5173"

    # --- Game / admin -------------------------------------------------------
    # The admin gate is a single PIN. There are no user accounts: teams prove
    # identity with a per-team join code, the admin proves it with this PIN.
    admin_pin: str = ""
    proof_bucket: str = "challenge-proofs"
    max_upload_bytes: int = 25 * 1024 * 1024

    # --- Game content -------------------------------------------------------
    # Substituted for the {{phone}} token in challenge text. Keeping the number
    # here means it never has to be committed or written to the database.
    contact_phone: str = ""

    @property
    def cors_origins(self) -> list[str]:
        """Split the comma-separated CORS origin list into a clean list."""
        return [o.strip() for o in self.backend_cors_origins.split(",") if o.strip()]

    @property
    def service_key(self) -> str:
        """The elevated Supabase credential, whichever name it was given under.

        New-style secret keys (`sb_secret_...`) and legacy `service_role` JWTs
        both map to the same Postgres role, so the backend does not care which
        one is configured.
        """
        return (self.supabase_secret_key or self.supabase_service_role_key).strip()

    @property
    def admin_token(self) -> str:
        """Derive a stateless admin token from the PIN.

        Derived rather than stored so it survives a restart without a session
        table, and rotating ADMIN_PIN invalidates every issued token.
        """
        if not self.admin_pin:
            return ""
        return hmac.new(
            self.admin_pin.encode("utf-8"),
            b"challenge-admin-v1",
            hashlib.sha256,
        ).hexdigest()


@lru_cache
def get_settings() -> Settings:
    """Return a cached Settings instance."""
    return Settings()
