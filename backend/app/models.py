"""Request/response schemas for the API."""

from __future__ import annotations

from uuid import UUID
from pydantic import BaseModel, Field


class AdminLoginRequest(BaseModel):
    pin: str = Field(min_length=1, max_length=128)


class AdminLoginResponse(BaseModel):
    token: str


class SessionCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    team_count: int = Field(default=8, ge=1, le=40)
    active_task_limit: int = Field(default=6, ge=1, le=24)


class JoinRequest(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str | None = Field(default=None, max_length=40)  # Legacy clients; ignored.


class ReviewRequest(BaseModel):
    note: str | None = Field(default=None, max_length=280)


class ReorderQueueRequest(BaseModel):
    challenge_ids: list[UUID] = Field(max_length=500)
    expected_ids: list[UUID] = Field(max_length=500)


class ChallengeCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    location_area: str | None = Field(default=None, max_length=160)
    completion_condition: str = Field(min_length=1, max_length=400)
    clue_tier: str = Field(pattern="^tier[123]$")
    sort_order: int = 0


class TeamNameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)
