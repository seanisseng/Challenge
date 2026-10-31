"""Supabase client factory.

There is exactly one client: the service-role client. Every browser request
goes through the FastAPI backend, which is the only holder of this key, so
Row Level Security stays enabled with no policies and the anon key can read
nothing at all.
"""

from __future__ import annotations

from supabase import Client, create_client

from app.config import get_settings

_admin_client: Client | None = None


def get_admin_client() -> Client:
    """Return a cached service-role Supabase client (bypasses RLS)."""
    global _admin_client
    if _admin_client is None:
        settings = get_settings()
        if not settings.supabase_url:
            raise RuntimeError("SUPABASE_URL is not set. Copy .env.example to .env.")
        if not settings.supabase_service_role_key:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.example to .env."
            )
        _admin_client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
    return _admin_client
