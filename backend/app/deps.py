"""Auth dependencies.

Two credentials exist, both plain headers:

* ``X-Admin-Token`` -- HMAC derived from ``ADMIN_PIN``, proves you are the host.
* ``X-Team-Token``  -- a per-device UUID minted when a player redeems a team
  join code. Many devices share a team; each has its own token.
"""

from __future__ import annotations

import secrets
from typing import Annotated, Any

from fastapi import Header, HTTPException

from app import repo
from app.config import get_settings


def require_admin(
    x_admin_token: Annotated[str | None, Header()] = None,
) -> None:
    settings = get_settings()
    if not settings.admin_pin:
        raise HTTPException(
            status_code=503,
            detail="admin PIN is not configured; set ADMIN_PIN in backend/.env",
        )
    if not x_admin_token or not secrets.compare_digest(
        x_admin_token, settings.admin_token
    ):
        raise HTTPException(status_code=401, detail="invalid admin token")


def current_member(
    x_team_token: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    member = repo.member_by_token(x_team_token or "")
    if member is None:
        raise HTTPException(status_code=401, detail="invalid or missing team token")
    return member
