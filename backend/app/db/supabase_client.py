"""Supabase client factory.

There is exactly one client: the elevated service-role client. Every browser
request goes through the FastAPI backend, which is the only holder of this key,
so Row Level Security stays enabled with no policies and a leaked anon key can
read nothing at all.

The key may be either a new-style secret key (``sb_secret_...``) or the legacy
``service_role`` JWT - both resolve to the ``service_role`` Postgres role.

Transport notes
---------------
The SDK builds its own ``httpx.Client(http2=True)`` when no client is supplied.
A single HTTP/2 connection multiplexes every request from every request thread,
and the Supabase edge aborts that session under load:

    httpx.RemoteProtocolError: Server disconnected
    EOF occurred in violation of protocol

which surfaced as intermittent 500s during an 8-photo upload burst. We supply
our own HTTP/1.1 pool instead: one connection per in-flight request, up to 50,
so a broken socket costs exactly one request. Idempotent calls (GET/HEAD) are
also retried once the transport drops them.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx
from supabase import Client, ClientOptions, create_client

from app.config import get_settings

log = logging.getLogger(__name__)

# Pool sizing: the game targets ~100 concurrent devices, but a single request
# only holds a connection for one round trip, so 50 slots is plenty and keeps
# the Supabase connection count sane.
MAX_CONNECTIONS = 50
MAX_KEEPALIVE_CONNECTIONS = 20
KEEPALIVE_EXPIRY = 30.0

# Uploads are the slowest call (a 25 MiB photo over a phone connection), so the
# write budget is generous while connect/pool stay tight enough to fail fast.
TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=60.0, pool=10.0)

RETRY_ATTEMPTS = 3
RETRY_BACKOFF = 0.1

# Methods we may replay after a dropped connection. RPCs are POSTs, so they are
# retried in the repository layer where we know whether they are idempotent.
RETRYABLE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

_admin_client: Client | None = None
_admin_lock = threading.Lock()


class RetryingTransport(httpx.HTTPTransport):
    """HTTP/1.1 transport that survives a dropped keep-alive connection.

    A pooled socket can be closed by the server between our checkout and the
    write. httpx reports that as ``RemoteProtocolError`` (a ``TransportError``),
    which used to bubble all the way up as a 500. Retrying the read-only calls
    is always safe, and a failed *connect* is safe for every method because the
    request never left the machine.
    """

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        delay = RETRY_BACKOFF
        for attempt in range(1, RETRY_ATTEMPTS + 1):
            try:
                return super().handle_request(request)
            except httpx.TransportError as exc:
                replayable = (
                    request.method in RETRYABLE_METHODS
                    or isinstance(exc, (httpx.ConnectError, httpx.ConnectTimeout))
                )
                if not replayable or attempt == RETRY_ATTEMPTS:
                    raise
                log.warning(
                    "retrying %s %s after %s (attempt %d/%d)",
                    request.method,
                    request.url.path,
                    type(exc).__name__,
                    attempt,
                    RETRY_ATTEMPTS,
                )
                time.sleep(delay)
                delay *= 2
        raise AssertionError("unreachable")  # pragma: no cover


def _build_http_client() -> httpx.Client:
    return httpx.Client(
        http2=False,
        limits=httpx.Limits(
            max_connections=MAX_CONNECTIONS,
            max_keepalive_connections=MAX_KEEPALIVE_CONNECTIONS,
            keepalive_expiry=KEEPALIVE_EXPIRY,
        ),
        timeout=TIMEOUT,
        transport=RetryingTransport(),
        follow_redirects=True,
    )


def get_admin_client() -> Client:
    """Return a cached elevated Supabase client (bypasses RLS).

    Double-checked locking keeps the first concurrent burst of requests from
    building two clients (and two connection pools).
    """
    global _admin_client
    if _admin_client is not None:
        return _admin_client

    with _admin_lock:
        if _admin_client is not None:
            return _admin_client

        settings = get_settings()
        if not settings.supabase_url:
            raise RuntimeError("SUPABASE_URL is not set. Copy .env.example to .env.")
        if not settings.service_key:
            raise RuntimeError(
                "No Supabase secret is configured. Set SUPABASE_SECRET_KEY "
                "(sb_secret_...) or SUPABASE_SERVICE_ROLE_KEY in backend/.env."
            )
        _admin_client = create_client(
            settings.supabase_url,
            settings.service_key,
            ClientOptions(httpx_client=_build_http_client()),
        )
        return _admin_client
