"""Supabase client factories.

Two clients are provided:

* ``get_admin_client``  — uses the service-role key, bypasses RLS. Server-side
  trusted operations only (admin review, signed URL generation).
* ``get_anon_client``   — uses the anon key and respects RLS. Use with a
  team's access token to act on that team's behalf.
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
        if not settings.supabase_service_role_key:
            raise RuntimeError(
                "SUPABASE_SERVICE_ROLE_KEY is not set. Copy .env.example to .env."
            )
        _admin_client = create_client(
            settings.supabase_url, settings.supabase_service_role_key
        )
    return _admin_client


def get_anon_client(access_token: str | None = None) -> Client:
    """Return an anon-key client, optionally scoped to a user's access token."""
    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    if access_token:
        client.postgrest.auth(access_token)
    return client
