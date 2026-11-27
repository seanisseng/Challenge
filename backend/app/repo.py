"""Data access layer.

Every database call in the application goes through here, using the
service-role client. Nothing in this module trusts caller input for identity:
the caller's team is always resolved from a member token first.
"""

from __future__ import annotations

import logging
import hashlib
import time
import uuid
from threading import RLock
from urllib.parse import quote
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from postgrest.exceptions import APIError
from supabase import Client

from app.config import get_settings
from app.db.supabase_client import get_admin_client
from app.media_gate import MediaGate

log = logging.getLogger(__name__)
_media_locks: dict[str,MediaGate] = {}
_media_registry_lock=RLock()

def _media_lock(session_id: str):
    with _media_registry_lock:
        return _media_locks.setdefault(session_id,MediaGate())

# Postgres sqlstate for "deadlock detected". The whole transaction was rolled
# back, so replaying the call is always safe.
DEADLOCK_SQLSTATE = "40P01"

# Two admin devices approving at the same moment used to deadlock because the
# reviewers locked submission-then-challenge while discard did the reverse. The
# database functions now agree on one lock order, but a retry is cheap insurance
# against any future ordering we have not spotted.
RPC_ATTEMPTS = 3
RPC_BACKOFF = 0.05

# A dropped connection may hide a commit. These RPCs set an absolute state (or
# return early when already done), so replaying them cannot double-apply.
REPLAY_SAFE_RPCS = frozenset(
    {
        "approve_submission",
        "reject_submission",
        "discard_challenge",
        "defer_challenge",
        "reorder_challenge_queue",
        "set_board_visibility",
        "refill_board",
    }
)

# If a replay finds the work already done, the first attempt committed and only
# its response was lost. That is a success, not an error.
_ALREADY_DONE = {
    "approve_submission": "submission is already approved",
    "reject_submission": "submission is already rejected",
}


# --------------------------------------------------------------------------- #
# plumbing
# --------------------------------------------------------------------------- #
def _client() -> Client:
    return get_admin_client()


def _clean_message(message: str) -> str:
    """Turn a raw Postgres error into something safe to show a player."""
    text = (message or "").strip()
    if text.startswith("ERROR:"):
        # "ERROR:  P0001: invalid team code" -> "invalid team code"
        text = text.split(":", 2)[-1].strip()
    return text.splitlines()[0].strip()[:200] or "request failed"


def _to_http(exc: APIError) -> HTTPException:
    message = getattr(exc, "message", None) or str(exc)
    code = getattr(exc, "code", None)
    status = 404 if code=='PT404' else 410 if code=='PT410' else 409 if code in {"23505", "PT409"} else 400
    return HTTPException(status_code=status, detail=_clean_message(message))


def _is_lost_commit(name: str, exc: APIError) -> bool:
    """True when a replay proves the original call had already committed."""
    expected = _ALREADY_DONE.get(name)
    if not expected:
        return False
    return expected in (getattr(exc, "message", None) or str(exc)).lower()


def rpc(name: str, params: dict[str, Any], *, retry: bool | None = None) -> Any:
    """Call a Postgres function, surviving deadlocks and dropped sockets.

    ``retry`` defaults to the idempotency table above. A transport failure on a
    non-replayable call is surfaced as 503 so the client can retry deliberately,
    rather than as an opaque 500.
    """
    if retry is None:
        retry = name in REPLAY_SAFE_RPCS

    delay = RPC_BACKOFF
    for attempt in range(1, RPC_ATTEMPTS + 1):
        last = attempt == RPC_ATTEMPTS
        try:
            return _client().rpc(name, params).execute().data
        except APIError as exc:
            code = getattr(exc, "code", None)
            if code == DEADLOCK_SQLSTATE and not last:
                log.warning("deadlock in %s, retrying (attempt %d)", name, attempt)
            elif retry and not last and _is_lost_commit(name, exc):
                log.warning("%s already applied before the connection dropped", name)
                return None
            else:
                raise _to_http(exc) from exc
        except httpx.TransportError as exc:
            if not retry or last:
                log.warning("transport failure in %s: %s", name, exc)
                raise HTTPException(
                    status_code=503,
                    detail="lost contact with the database, please try again",
                ) from exc
            log.warning(
                "retrying %s after %s (attempt %d)", name, type(exc).__name__, attempt
            )
        time.sleep(delay)
        delay *= 2
    raise AssertionError("unreachable")  # pragma: no cover


def _select(table: str):
    return _client().table(table)


# --------------------------------------------------------------------------- #
# sessions
# --------------------------------------------------------------------------- #
def create_session(
    name: str, team_count: int, active_task_limit: int
) -> dict[str, Any]:
    rows = rpc(
        "create_session",
        {
            "p_name": name,
            "p_team_count": team_count,
            "p_active_task_limit": active_task_limit,
        },
    )
    return rows[0]


def list_sessions() -> list[dict[str, Any]]:
    return (
        _select("game_sessions")
        .select("id,room_code,name,status,team_count,active_task_limit,created_at,started_at,ended_at")
        .order("created_at", desc=True)
        .execute()
        .data
    )


def get_session(session_id: str) -> dict[str, Any]:
    rows = (
        _select("game_sessions")
        .select("*")
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="session not found")
    return rows[0]


def delete_session(session_id: str) -> bool:
    """Atomically queue media cleanup and cascade game records; return pending."""
    try:session_id=str(uuid.UUID(session_id))
    except ValueError as exc:raise HTTPException(400,'Invalid session ID.') from exc
    settings=get_settings()
    # Remove the session first so newly queued uploads fail their existence
    # check while any already-running Storage transfer finishes under the lock.
    rpc('delete_session_with_media',{'p_session_id':session_id,'p_buckets':list(dict.fromkeys([settings.proof_bucket,settings.asset_bucket]))},retry=True)
    with _media_lock(session_id):
        try:return _cleanup_session_media(session_id)
        except Exception:
            log.warning('Session deleted; durable Storage cleanup will retry')
            return True


def _storage_session_paths(bucket,session_id: str) -> list[str]:
    """List the entire exact session prefix before deleting any paged results."""
    root=str(uuid.UUID(session_id));folders=[root];paths=[]
    while folders:
        folder=folders.pop();offset=0
        while True:
            entries=bucket.list(folder,{'limit':100,'offset':offset,'sortBy':{'column':'name','order':'asc'}})
            for item in entries:
                name=item['name']
                if not name or name in ('.','..') or '/' in name or '\\' in name:raise ValueError('Invalid Storage object name')
                path=f'{folder}/{name}'
                if not path.startswith(root+'/'):raise ValueError('Storage path left session prefix')
                if item.get('id') is None and item.get('metadata') is None:folders.append(path)
                else:paths.append(path)
            if len(entries)<100:break
            offset+=len(entries)
    return paths


def _cleanup_session_media(session_id: str) -> bool:
    with _media_lock(session_id):
        jobs=_select('session_media_deletions').select('*').eq('session_id',session_id).limit(1).execute().data
        if not jobs:return False
        job=jobs[0]
        try:
            _select('session_media_deletions').update({'attempts':job['attempts']+1,'last_attempt_at':datetime.now(timezone.utc).isoformat()}).eq('session_id',session_id).execute()
            for name in job['buckets']:
                bucket=_client().storage.from_(name)
                paths=_storage_session_paths(bucket,session_id)
                if name==get_settings().asset_bucket:
                    _preserve_shared_assets(bucket,session_id,paths)
                for offset in range(0,len(paths),100):bucket.remove(paths[offset:offset+100])
                if _storage_session_paths(bucket,session_id):raise RuntimeError('Session media remains in Storage')
            # Signed resumable capabilities cannot be revoked individually.
            # Re-sweep deleted prefixes until every issued upload has expired.
            if pending_direct_uploads(session_id):return True
            _select('session_media_deletions').delete().eq('session_id',session_id).execute()
            return False
        except Exception as exc:
            log.warning('Session Storage cleanup pending (%s)',type(exc).__name__)
            try:_select('session_media_deletions').update({'last_error':type(exc).__name__}).eq('session_id',session_id).execute()
            except Exception:pass
            return True


def _preserve_shared_assets(bucket,session_id: str,paths: list[str]) -> None:
    shared=set()
    for table in ('challenge_templates','challenges'):
        rows=_select(table).select('image_path').like('image_path',session_id+'/%').execute().data
        shared.update(row['image_path'] for row in rows)
    urls={row['media_url'] for row in _select('clues').select('media_url').not_.is_('media_url','null').execute().data}
    shared.update(path for path in paths if public_asset_url(path) in urls)
    for path in sorted(shared.intersection(paths)):
        extension=path.rsplit('.',1)[-1].lower()
        if not extension.isalnum() or len(extension)>10:extension='bin'
        destination=f'_shared/{hashlib.sha256(path.encode()).hexdigest()}.{extension}'
        if not bucket.exists(destination):bucket.copy(path,destination)
        rpc('relocate_shared_session_asset',{'p_session_id':session_id,'p_old_path':path,'p_new_path':destination,
            'p_old_url':public_asset_url(path),'p_new_url':public_asset_url(destination)},retry=True)


def retry_session_media_deletions() -> None:
    jobs=(_select('session_media_deletions').select('session_id').order('last_attempt_at',nullsfirst=True).limit(25).execute().data)
    for job in jobs:_cleanup_session_media(job['session_id'])


def set_session_status(session_id: str, status: str) -> None:
    payload: dict[str, Any] = {"status": status}
    now = datetime.now(timezone.utc).isoformat()
    if status == "active":
        payload["started_at"] = now
    elif status == "ended":
        payload["ended_at"] = now
        payload["board_visible"] = False
    try:
        _select("game_sessions").update(payload).eq("id", session_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


def list_teams(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("teams")
        .select("id,name,join_code,created_at")
        .eq("session_id", session_id)
        .order("name")
        .execute()
        .data
    )


def list_members(team_ids: list[str]) -> list[dict[str, Any]]:
    if not team_ids:
        return []
    return (
        _select("team_members")
        .select("id,team_id,name,joined_at,last_seen_at")
        .in_("team_id", team_ids)
        .order("joined_at")
        .execute()
        .data
    )


def members_by_team(team_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Team rosters in one query, keyed by team id."""
    out: dict[str, list[dict[str, Any]]] = {team_id: [] for team_id in team_ids}
    for member in list_members(team_ids):
        out.setdefault(member["team_id"], []).append(
            {"id": member["id"], "name": member["name"]}
        )
    return out


def delete_member(member_id: str) -> None:
    try:
        _select("team_members").delete().eq("id", member_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


# --------------------------------------------------------------------------- #
# identity
# --------------------------------------------------------------------------- #
def member_by_token(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    try:
        uuid.UUID(token)
    except ValueError:
        return None

    rows = (
        _select("team_members")
        .select(
            "id,name,token,team_id,"
            "teams!inner(id,name,join_code,session_id,"
            "game_sessions!inner(id,name,room_code,status,team_count,active_task_limit))"
        )
        .eq("token", token)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None

    row = rows[0]
    team = row.pop("teams")
    session = team.pop("game_sessions")
    row["team"] = team
    row["session"] = session
    return row


def touch_member(member_id: str) -> None:
    try:
        _select("team_members").update(
            {"last_seen_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", member_id).execute()
    except APIError:
        pass  # presence is cosmetic; never fail a request over it


def join_team(code: str, name: str | None = None) -> dict[str, Any]:
    rows = rpc("join_team", {"p_join_code": code})
    if not rows:
        raise HTTPException(status_code=400, detail="could not join team")
    return rows[0]


# --------------------------------------------------------------------------- #
# board / progress
# --------------------------------------------------------------------------- #
def active_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges")
        .select(
            "id,title,location_area,completion_condition,clue_tier,status,"
            "claimed_by_team_id,sort_order,updated_at,image_path"
        )
        .eq("session_id", session_id)
        .eq("is_active", True)
        .eq("is_discarded", False)
        .order("sort_order")
        .execute()
        .data
    )


def all_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges")
        .select("*")
        .eq("session_id", session_id)
        .order("sort_order")
        .execute()
        .data
    )


def queued_challenges(session_id: str) -> list[dict[str, Any]]:
    return (
        _select("challenges").select(
            "id,title,location_area,completion_condition,clue_tier,status,"
            "claimed_by_team_id,sort_order,updated_at,image_path"
        )
        .eq("session_id", session_id).eq("is_active", False)
        .eq("is_discarded", False).eq("status", "open")
        .order("sort_order").order("created_at")
        .execute().data
    )


def set_board_visibility(session_id: str, visible: bool) -> None:
    rpc("set_board_visibility", {"p_session_id": session_id, "p_visible": visible})


def defer_challenge(session_id: str, challenge_id: str) -> None:
    rpc("defer_challenge", {"p_session_id": session_id, "p_challenge_id": challenge_id})


def discard_challenge(session_id: str, challenge_id: str) -> None:
    rpc("discard_challenge", {"p_session_id": session_id, "p_challenge_id": challenge_id})


def reorder_queue(session_id: str, challenge_ids: list[str], expected_ids: list[str]) -> None:
    rpc("reorder_challenge_queue", {
        "p_session_id": session_id, "p_challenge_ids": challenge_ids, "p_expected_ids": expected_ids,
    })


def team_submissions(team_id: str) -> list[dict[str, Any]]:
    return submissions_by_team([team_id]).get(team_id, [])


def _submission_rows(columns: str, configure) -> list[dict[str, Any]]:
    """Allow board reads during a rolling deployment of the evidence schema."""
    try:
        return configure(_select("submissions").select(columns)).execute().data
    except APIError as exc:
        # Only tolerate these two pending-migration columns. Permissions,
        # connectivity and other schema errors must still surface.
        message = (getattr(exc, "message", "") or "").lower()
        if exc.code != "42703" or not any(field in message for field in ("attachments", "proof_text")):
            raise
        legacy = columns.replace(",attachments,proof_text", "")
        return configure(_select("submissions").select(legacy)).execute().data


def submissions_by_team(team_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Every team's submissions in one query, keyed by team.

    The broadcast path used to run this per connected device. One query per
    room keeps a fan-out to 100 phones at the same cost as a fan-out to one.
    """
    out: dict[str, list[dict[str, Any]]] = {team_id: [] for team_id in team_ids}
    if not team_ids:
        return out

    rows = _submission_rows(
        "id,challenge_id,team_id,status,photo_path,attachments,proof_text,review_note,submitted_at,reviewed_at,team_member_id",
        lambda query: query.in_("team_id", team_ids).order("submitted_at", desc=True),
    )
    for row in rows:
        row = dict(row)
        team_id = row.pop("team_id", None)
        out.setdefault(team_id, []).append(row)
    return out


def session_submissions(session_id: str, status: str | None = None) -> list[dict[str, Any]]:
    def configure(query):
        query = query.eq("session_id", session_id).order("submitted_at", desc=True)
        return query.eq("status", status) if status else query
    return _submission_rows(
        "id,session_id,challenge_id,team_id,team_member_id,photo_path,attachments,proof_text,status,"
        "review_note,submitted_at,reviewed_at,challenges!inner(title),teams!inner(name),team_members(name)",
        configure,
    )


TIER_ORDER = {"tier1": 1, "tier2": 2, "tier3": 3}


def _clue_payload(clue: dict[str, Any], unlocked_at: str) -> dict[str, Any]:
    return {
        "id": clue["id"],
        "tier": clue["tier"],
        "title": clue["title"],
        "body": clue["body"],
        "media_url": clue.get("media_url"),
        "unlocked_at": unlocked_at,
    }


def _clue_sort_key(clue: dict[str, Any]) -> tuple[int, str]:
    return (TIER_ORDER.get(clue["tier"], 9), clue["unlocked_at"])


def team_clues(team_id: str) -> list[dict[str, Any]]:
    return clues_by_team([team_id]).get(team_id, [])


def clues_by_team(team_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Unlocked clues for every team in the room, in two queries."""
    out: dict[str, list[dict[str, Any]]] = {team_id: [] for team_id in team_ids}
    if not team_ids:
        return out

    unlocked = (
        _select("team_clues")
        .select("team_id,clue_id,unlocked_at")
        .in_("team_id", team_ids)
        .order("unlocked_at")
        .execute()
        .data
    )
    if not unlocked:
        return out

    clue_ids = sorted({row["clue_id"] for row in unlocked})
    clues = (
        _select("clues")
        .select("id,tier,title,body,media_url,sort_order")
        .in_("id", clue_ids)
        .execute()
        .data
    )
    by_id = {clue["id"]: clue for clue in clues}

    for row in unlocked:
        clue = by_id.get(row["clue_id"])
        if not clue:
            continue
        out.setdefault(row["team_id"], []).append(
            _clue_payload(clue, row["unlocked_at"])
        )

    for clues_for_team in out.values():
        clues_for_team.sort(key=_clue_sort_key)
    return out


def recent_clue_awards(session_id: str) -> list[dict[str, Any]]:
    """Public, session-scoped unlock events; never include clue text or media."""
    rows = (
        _select("team_clues")
        .select("id,team_id,unlocked_at,teams!inner(name,session_id),clues!inner(tier)")
        .eq("teams.session_id", session_id)
        .order("unlocked_at", desc=True)
        .limit(50)
        .execute()
        .data
    )
    return [
        {
            "id": row["id"],
            "team_id": row["team_id"],
            "team_name": row["teams"]["name"],
            "tier": row["clues"]["tier"],
            "awarded_at": row["unlocked_at"],
        }
        for row in rows
    ]


def progress(session_id: str, teams: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Per-team tallies for the scoreboard.

    ``teams`` lets the broadcast path reuse the team list it already fetched
    instead of issuing the same query twice.
    """
    if teams is None:
        teams = list_teams(session_id)
    if not teams:
        return []
    team_ids = [t["id"] for t in teams]

    members = (
        _select("team_members").select("team_id").in_("team_id", team_ids).execute().data
    )
    clues = (
        _select("team_clues").select("team_id,clues!inner(tier)").in_("team_id", team_ids).execute().data
    )
    claimed = (
        _select("challenges")
        .select("claimed_by_team_id")
        .eq("session_id", session_id)
        .not_.is_("claimed_by_team_id", "null")
        .execute()
        .data
    )

    def tally(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for row in rows:
            value = row.get(key)
            if value:
                out[value] = out.get(value, 0) + 1
        return out

    member_count = tally(members, "team_id")
    clue_count = tally(clues, "team_id")
    tier_counts = {team_id: {tier: 0 for tier in TIER_ORDER} for team_id in team_ids}
    for clue in clues:
        tier_counts[clue["team_id"]][clue["clues"]["tier"]] += 1
    claim_count = tally(claimed, "claimed_by_team_id")

    return [
        {
            "team_id": team["id"],
            "team_name": team["name"],
            "member_count": member_count.get(team["id"], 0),
            "clue_count": clue_count.get(team["id"], 0),
            "clue_tier_counts": tier_counts[team["id"]],
            "claimed_count": claim_count.get(team["id"], 0),
        }
        for team in teams
    ]


# --------------------------------------------------------------------------- #
# submissions
# --------------------------------------------------------------------------- #
def submit_proof(
    team_id: str, member_id: str, challenge_id: str, photo_path: str, photo_url: str | None
) -> str:
    return rpc(
        "submit_proof",
        {
            "p_team_id": team_id,
            "p_member_id": member_id,
            "p_challenge_id": challenge_id,
            "p_photo_path": photo_path,
            "p_photo_url": photo_url,
        },
    )


def approve_submission(submission_id: str, note: str | None) -> None:
    rpc("approve_submission", {"p_submission_id": submission_id, "p_note": note})


def review_submission(submission_id: str, status: str, note: str | None) -> str:
    return rpc('review_submission',{'p_submission_id':submission_id,'p_status':status,'p_note':note},retry=True)


def submit_evidence(team_id:str,member_id:str,challenge_id:str,attachments:list[dict],text:str) -> str:
    return rpc('submit_evidence',{'p_team_id':team_id,'p_member_id':member_id,'p_challenge_id':challenge_id,'p_attachments':attachments,'p_text':text})


def require_submission_open(session_id: str, team_id: str, challenge_id: str) -> None:
    challenge = get_challenge(challenge_id)
    session = get_session(session_id)
    if challenge['session_id'] != session_id:
        raise HTTPException(404, 'Challenge not found.')
    if session['status'] != 'active' or not session.get('board_visible'):
        raise HTTPException(409, 'The challenge board is not open for submissions.')
    if challenge['status'] == 'claimed' or not challenge.get('is_active') or challenge.get('is_discarded'):
        raise HTTPException(409, 'This challenge is no longer available.')
    pending = (_select('submissions').select('id').eq('team_id',team_id)
               .eq('challenge_id',challenge_id).eq('status','pending').limit(1).execute().data)
    if pending:
        raise HTTPException(409, 'Your proof is awaiting host review. You can try again if it is rejected.')


def remove_proof_files(paths:list[str]) -> None:
    try:_client().storage.from_(get_settings().proof_bucket).remove(paths)
    except Exception:log.warning('Could not clean up unsubmitted proof attachments')


def reject_submission(submission_id: str, note: str | None) -> None:
    rpc("reject_submission", {"p_submission_id": submission_id, "p_note": note})


def submission(submission_id: str) -> dict[str, Any]:
    rows = _submission_rows(
        "id,session_id,team_id,status,photo_path,attachments,proof_text,submitted_at",
        lambda query: query.eq("id", submission_id).limit(1),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="submission not found")
    return rows[0]


def member_session_id(member_id: str) -> str | None:
    rows = (
        _select("team_members")
        .select("teams!inner(session_id)")
        .eq("id", member_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        return None
    return rows[0]["teams"]["session_id"]


# --------------------------------------------------------------------------- #
# challenges / clues (admin)
# --------------------------------------------------------------------------- #
def create_challenge(
    session_id: str,
    title: str,
    location_area: str | None,
    completion_condition: str,
    clue_tier: str,
    sort_order: int,
    image_path: str | None = None,
) -> dict[str, Any]:
    try:
        rows = (
            _select("challenges")
            .insert(
                {
                    "session_id": session_id,
                    "title": title,
                    "location_area": location_area,
                    "completion_condition": completion_condition,
                    "clue_tier": clue_tier,
                    "sort_order": sort_order,
                    "image_path": image_path,
                }
            )
            .execute()
            .data
        )
    except APIError as exc:
        raise _to_http(exc) from exc
    return rows[0]


def get_challenge(challenge_id: str) -> dict[str, Any]:
    rows = _select("challenges").select("*").eq("id", challenge_id).limit(1).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="challenge not found")
    return rows[0]


def set_challenge_image(challenge_id: str, path: str) -> None:
    try:
        _select("challenges").update({"image_path": path}).eq("id", challenge_id).execute()
    except APIError as exc:
        raise _to_http(exc) from exc


def list_clues() -> list[dict[str, Any]]:
    return (
        _select("clues")
        .select("id,tier,title,body,media_url,sort_order")
        .order("tier")
        .order("sort_order")
        .execute()
        .data
    )


def start_board(session_id: str) -> None:
    """Activate the opening board and flip the session live."""
    refill_board(session_id)


def refill_board(session_id: str) -> None:
    """Top the live board back up to the session's active-task limit."""
    rpc("refill_board", {"p_session_id": session_id})


# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #
UPLOAD_ATTEMPTS = 3
UPLOAD_BACKOFF = 0.25


def public_asset_url(path: str | None) -> str | None:
    if not path:
        return None
    settings = get_settings()
    return (
        f"{settings.supabase_url.rstrip('/')}/storage/v1/object/public/"
        f"{quote(settings.asset_bucket, safe='')}/{quote(path, safe='/')}"
    )


def _upload_object(bucket: str, path: str, data: Any, content_type: str) -> None:
    """Upload bytes, retrying a dropped connection.

    A burst of phones uploading at once used to kill the connection mid-upload
    and the whole submission failed. Retries reuse the same object path, so a
    "duplicate" answer means an earlier attempt actually landed.
    """
    delay = UPLOAD_BACKOFF
    for attempt in range(1, UPLOAD_ATTEMPTS + 1):
        try:
            if hasattr(data,'seek'):data.seek(0)
            _client().storage.from_(bucket).upload(
                path, data, {"content-type": content_type, "upsert": "false"}
            )
            return
        except httpx.TransportError as exc:
            if attempt == UPLOAD_ATTEMPTS:
                log.warning("upload of %s failed: %s", path, exc)
                raise HTTPException(
                    status_code=503, detail="photo storage is busy, please try again"
                ) from exc
            log.warning(
                "retrying upload %s after %s (attempt %d)",
                path,
                type(exc).__name__,
                attempt,
            )
        except Exception as exc:  # storage3 raises its own error types
            text = str(exc).lower()
            if "duplicate" in text or "already exists" in text:
                return
            raise
        time.sleep(delay)
        delay *= 2


def upload_challenge_image(
    session_id: str, filename: str, data: bytes, content_type: str
) -> str:
    # Derive extensions from the allowed MIME type, never from an uploaded name.
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[content_type]
    path = f"{session_id}/{uuid.uuid4().hex}{extension}"
    try:
        _upload_session_object(session_id,get_settings().asset_bucket, path, data, content_type)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail="image upload failed") from exc
    return path


def pending_direct_uploads(session_id: str) -> bool:
    return bool(rpc('has_live_proof_uploads',{'p_session_id':session_id},retry=True))


def upload_proof(session_id: str, team_id: str, filename: str, data: Any, content_type: str) -> str:
    settings = get_settings()
    suffix={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','image/heic':'.heic','image/heif':'.heif','video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov'}.get(content_type,'.bin')
    safe = f"{uuid.uuid4().hex}{suffix}"
    path = f"{session_id}/{team_id}/{safe}"
    try:
        _upload_session_object(session_id,settings.proof_bucket, path, data, content_type)
    except HTTPException:
        raise
    except Exception as exc:  # storage3 raises its own errors
        raise HTTPException(status_code=400, detail=f"upload failed: {exc}") from exc
    return path


def _upload_session_object(session_id: str,bucket: str,path: str,data: Any,content_type: str) -> None:
    # Transfers may overlap; cleanup takes exclusive access and waits for all
    # active transfers. Queued transfers recheck existence after getting a slot.
    with _media_lock(session_id).upload():
        get_session(session_id)
        _upload_object(bucket,path,data,content_type)


def signed_url(path: str, expires_in: int = 3600) -> str | None:
    settings = get_settings()
    try:
        res = _client().storage.from_(settings.proof_bucket).create_signed_url(
            path, expires_in
        )
    except Exception:
        return None
    if isinstance(res, dict):
        return res.get("signedURL") or res.get("signedUrl")
    return None


def rename_team(team_id: str, name: str) -> str:
    return rpc("rename_team", {"p_team_id": team_id, "p_name": name})


def map_locations(session_id: str) -> list[dict[str, Any]]:
    since=(datetime.now(timezone.utc).timestamp()-120)
    rows=(_select("map_location_shares").select("team_id,device_id,lat,lng,accuracy_m,updated_at,revision,teams!inner(name)")
          .eq("session_id",session_id).gte("updated_at",datetime.fromtimestamp(since,timezone.utc).isoformat()).execute().data)
    return [{**{k:v for k,v in row.items() if k!="teams"},"team_name":row["teams"]["name"]} for row in rows]


def map_visibility(session_id: str) -> dict:
    session=get_session(session_id)
    return {'hidden_team_ids':session.get('map_hidden_team_ids') or [],'revision':session.get('map_visibility_revision',0)}


def set_team_location_visibility(session_id: str,team_id: str,visible: bool) -> int:
    return rpc('set_team_location_visibility',{'p_session_id':session_id,'p_team_id':team_id,'p_visible':visible},retry=True)


def configure_map(session_id: str, plan: dict) -> None:
    rpc("configure_playing_area",{"p_session_id":session_id,"p_plan":plan})


def location_access_until(team_id: str, device_id: str | None, lease: str | None) -> float:
    """Private device proof: another teammate's shared fix does not grant access."""
    if not device_id or not lease:return 0
    try:uuid.UUID(device_id);uuid.UUID(lease)
    except (ValueError,TypeError,AttributeError):return 0
    rows=(_select('map_location_shares').select('updated_at,lat').eq('team_id',team_id)
          .eq('device_id',device_id).eq('lease',lease).limit(1).execute().data)
    if not rows or rows[0].get('lat') is None or not rows[0].get('updated_at'):return 0
    return datetime.fromisoformat(rows[0]['updated_at'].replace('Z','+00:00')).timestamp()+120


def set_map_timer(session_id: str, start: bool) -> None:
    rpc("set_map_timer",{"p_session_id":session_id,"p_start":start})


def seek_map_timer(session_id: str, elapsed_seconds: int) -> None:
    rpc("seek_map_timer",{"p_session_id":session_id,"p_elapsed_seconds":elapsed_seconds})


def pause_map_timer(session_id: str, pause: bool) -> None:
    rpc('pause_map_timer',{'p_session_id':session_id,'p_pause':pause})


def shrink_map(session_id: str) -> int:
    return rpc("shrink_map_area",{"p_session_id":session_id})


def start_location(team_id: str, device_id: str) -> dict:
    return rpc("start_location_share",{"p_team_id":team_id,"p_device_id":device_id})


def update_location(team_id: str, data: dict) -> dict:
    return rpc("update_map_location",{"p_team_id":team_id,**{"p_"+key:value for key,value in data.items()}})


def stop_location(team_id: str, device_id: str, lease: str) -> dict | None:
    return rpc("stop_location_share",{"p_team_id":team_id,"p_device_id":device_id,"p_lease":lease})


def expire_locations() -> list[dict]:
    return rpc("expire_map_locations",{}) or []


def running_maps() -> list[dict]:
    return (_select("game_sessions").select("id").eq("status","active").not_.is_("map_started_at","null").execute().data)
