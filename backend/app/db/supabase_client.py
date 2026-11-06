"""Supabase client factory.

There is exactly one client: the elevated service-role client. Every browser
request goes through the FastAPI backend, which is the only holder of this key,
so Row Level Security stays enabled with no policies and a leaked anon key can
read nothing at all.

The key may be either a new-style secret key (``sb_secret_...``) or the legacy
``service_role`` JWT - both resolve to the ``service_role`` Postgres role.
"""

from __future__ import annotations

from supabase import Client, create_client

from app.config import get_settings

_admin_client: Client | None = None


def get_admin_client() -> Client:
    """Return a cached elevated Supabase client (bypasses RLS)."""
    global _admin_client
    if _admin_client is None:
        settings = get_settings()
        if not settings.supabase_url:
            raise RuntimeError("SUPABASE_URL is not set. Copy .env.example to .env.")
        if not settings.service_key:
            raise RuntimeError(
                "No Supabase secret is configured. Set SUPABASE_SECRET_KEY "
                "(sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY in backend/.env."
            )
        _admin_client = create_client(settings.supabase_url, settings.service_key)
    return _admin_client
