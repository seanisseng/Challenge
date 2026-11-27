"""Snapshot builders shared by the REST endpoints and the WebSocket hub.

A snapshot is the complete state a client needs to render its screen. Because
the whole app is push-driven, every mutation ends with a broadcast of a fresh
snapshot to the session room.
"""

from __future__ import annotations

from typing import Any
from concurrent.futures import ThreadPoolExecutor
import time

from app import repo
from app.config import get_settings
from app.game_map import public_map,default_plan

# Deploy-time values that live in challenge copy. `{{phone}}` is replaced from
# CONTACT_PHONE so the host's number never reaches git or Postgres.
PHONE_PLACEHOLDER = "{{phone}}"
PHONE_FALLBACK = "the number your station leader gives you"


def fill_placeholders(text: str | None) -> str | None:
    """Swap deploy-time tokens for their configured values.

    If CONTACT_PHONE is unset the sentence still reads correctly, rather than
    showing a raw `{{phone}}` token to players.
    """
    if not text or PHONE_PLACEHOLDER not in text:
        return text
    phone = get_settings().contact_phone.strip()
    return text.replace(PHONE_PLACEHOLDER, phone or PHONE_FALLBACK)


def _render_challenge(challenge: dict[str, Any]) -> dict[str, Any]:
    """Apply placeholders to the fields a player actually reads."""
    challenge = dict(challenge)
    image_path = challenge.pop("image_path", None)
    return {
        **challenge,
        "image_url": repo.public_asset_url(image_path),
        "title": fill_placeholders(challenge.get("title")),
        "location_area": fill_placeholders(challenge.get("location_area")),
        "completion_condition": fill_placeholders(
            challenge.get("completion_condition")
        ),
    }



def _board_with_my_status(
    challenges: list[dict[str, Any]], submissions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Annotate each live challenge with this team's latest submission state."""
    latest: dict[str, dict[str, Any]] = {}
    for sub in submissions:  # already newest-first
        latest.setdefault(sub["challenge_id"], sub)

    board: list[dict[str, Any]] = []
    for challenge in challenges:
        mine = latest.get(challenge["id"])
        board.append(
            {
                **challenge,
                "my_submission": (
                    {
                        "id": mine["id"],
                        "status": mine["status"],
                        "review_note": mine.get("review_note"),
                        "submitted_at": mine["submitted_at"],
                    }
                    if mine
                    else None
                ),
            }
        )
    return board


def _session_info(session: dict[str, Any]) -> dict[str, Any]:
    return {key:session[key] for key in ('id','name','room_code','status','team_count','active_task_limit')} | {
        'board_visible':session.get('board_visible',False),
        'board_reveal_version':session.get('board_reveal_version',0),
    }


def team_board_payload(member: dict[str, Any]) -> dict[str, Any]:
    """Restore the playable board without waiting for clues, scores or the map."""
    session_id=member['session']['id'];team=member['team']
    with ThreadPoolExecutor(max_workers=3) as pool:
        session_read=pool.submit(repo.get_session,session_id)
        board_read=pool.submit(repo.active_challenges,session_id)
        proofs_read=pool.submit(repo.team_submissions,team['id'])
        session=session_read.result();board=board_read.result();proofs=proofs_read.result()
    visible=session.get('board_visible',False) and session['status']=='active'
    return {'kind':'team','session':_session_info(session),
            'me':{'id':member['id'],'name':member['name']},
            'team':{'id':team['id'],'name':team['name'],'join_code':team.get('join_code')},
            'board':_board_with_my_status([_render_challenge(c) for c in board] if visible else [],proofs),
            'my_submissions':proofs,'clues':[],'progress':[],'loading_details':True}


def _core(
    session: dict[str, Any],
    board: list[dict[str, Any]],
    progress: list[dict[str, Any]],
    awards: list[dict[str, Any]],
    locations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "session": _session_info(session),
        "board": board,
        "progress": progress,
        "clue_awards": awards,
        "map": public_map(session,locations or []),
        "_hidden_location_team_ids": session.get('map_hidden_team_ids') or [],
        "_host_map": {"plan":session.get("playing_area") or {'stages':default_plan()['stages']},
                      "finish":session.get("final_destination") or default_plan()['finish'],
                      "hidden_team_ids":session.get('map_hidden_team_ids') or []},
    }


def session_core(session_id: str) -> dict[str, Any]:
    """The parts of the snapshot that are identical for every viewer."""
    session=repo.get_session(session_id)
    return _core(
        session,
        [_render_challenge(c) for c in repo.active_challenges(session_id)],
        repo.progress(session_id),
        repo.recent_clue_awards(session_id),
        repo.map_locations(session_id) if session.get("playing_area") else [],
    )


def room_data(session_id: str) -> dict[str, Any]:
    """One batched view of a room, shared by every device in a broadcast.

    Building each payload on its own meant two queries per connected phone plus
    four for the host console, so one approval could fire hundreds of round
    trips. This reads the room once (a fixed handful of queries) and the
    per-viewer builders just slice the result.
    """
    session = repo.get_session(session_id)
    teams = repo.list_teams(session_id)
    team_ids = [team["id"] for team in teams]

    return {
        "core": _core(
            session,
            [_render_challenge(c) for c in repo.active_challenges(session_id)],
            repo.progress(session_id, teams),
            repo.recent_clue_awards(session_id),
            repo.map_locations(session_id) if session.get("playing_area") else [],
        ),
        "teams": teams,
        "members": repo.members_by_team(team_ids),
        "submissions": repo.submissions_by_team(team_ids),
        "clues": repo.clues_by_team(team_ids),
        "queue": [_render_challenge(c) for c in repo.queued_challenges(session_id)],
        "session_submissions": repo.session_submissions(session_id),
    }


def game_data(session_id: str) -> dict[str, Any]:
    """Only data changed by evidence/reviews; skip maps and member rosters.

    Fetch submission history once for all viewers, and overlap independent
    reads with a bounded pool instead of paying every network delay in series.
    """
    session=repo.get_session(session_id)
    teams=repo.list_teams(session_id)
    with ThreadPoolExecutor(max_workers=4) as pool:
        board=pool.submit(repo.active_challenges,session_id)
        progress=pool.submit(repo.progress,session_id,teams)
        awards=pool.submit(repo.recent_clue_awards,session_id)
        submissions=pool.submit(repo.session_submissions,session_id)
        clues=pool.submit(repo.clues_by_team,[team['id'] for team in teams])
        queue=pool.submit(repo.queued_challenges,session_id)
        return {'session':{key:session.get(key,False if key=='board_visible' else 0) for key in
                           ('id','name','room_code','status','team_count','active_task_limit','board_visible','board_reveal_version')},
                'board':[_render_challenge(row) for row in board.result()],
                'progress':progress.result(),'clue_awards':awards.result(),
                'submissions':submissions.result(),'clues':clues.result(),
                'queue':[_render_challenge(row) for row in queue.result()]}


def team_game_update(team_id: str,data: dict[str,Any]) -> dict[str,Any]:
    own=[{key:value for key,value in row.items() if key not in ('team_id','session_id','teams','team_members','challenges')}
         for row in data['submissions'] if row['team_id']==team_id]
    # Admin queues are FIFO; player status must still use the latest attempt.
    own.sort(key=lambda row:(row['submitted_at'],row['id']),reverse=True)
    visible=data['session']['board_visible'] and data['session']['status']=='active'
    return {'kind':'team_update','session_id':data['session']['id'],'team_id':team_id,
            'changes':{'session':data['session'],'board':_board_with_my_status(data['board'] if visible else [],own),
                       'progress':data['progress'],'clue_awards':data['clue_awards'],
                       'clues':data['clues'].get(team_id,[]),'my_submissions':own}}


def admin_game_update(data: dict[str,Any]) -> dict[str,Any]:
    return {'kind':'admin_update','session_id':data['session']['id'],
            'changes':{key:data[key] for key in ('session','board','queue','progress','submissions')}}


def team_payload(
    member: dict[str, Any],
    core: dict[str, Any] | None = None,
    room: dict[str, Any] | None = None,
    location_until: float = 0,
) -> dict[str, Any]:
    """Full snapshot for one player's device.

    Pass ``room`` from :func:`room_data` when fanning one broadcast out to many
    devices; omit it for a one-off response and each read happens directly.
    """
    session_id = member["session"]["id"]
    team_id = member["team"]["id"]

    if room is not None:
        core = room["core"]
        submissions = room["submissions"].get(team_id, [])
        clues = room["clues"].get(team_id, [])
    else:
        if core is None:
            core = session_core(session_id)
        submissions = repo.team_submissions(team_id)
        clues = repo.team_clues(team_id)

    # Existing sockets cache member identity; team names come from fresh room data.
    team_name = next((row["team_name"] for row in core["progress"]
                      if row.get("team_id") == team_id and row.get("team_name")),
                     member["team"]["name"])
    visible = core["session"].get("board_visible", False) and core["session"]["status"] == "active"
    board = _board_with_my_status(core["board"] if visible else [], submissions)
    game_map=core.get('map')
    if game_map is not None:
        can_track=location_until>time.time() and core['session']['status']=='active'
        hidden=set(core.get('_hidden_location_team_ids',[]))
        game_map={**game_map,'can_track_teams':can_track,
                  'locations':[point for point in game_map.get('locations',[]) if point['team_id']==team_id or can_track and point['team_id'] not in hidden],
                  **{key:None for key in ('started_at','next_shrink_at','paused_at') if key in game_map}}

    return {
        "kind": "team",
        "session": core["session"],
        "me": {"id": member["id"], "name": member["name"]},
        "team": {"id": member["team"]["id"], "name": team_name,
                 "join_code": member["team"].get("join_code")},
        "board": board,
        "progress": core["progress"],
        "clues": clues,
        "my_submissions": submissions,
        "clue_awards": core.get("clue_awards", []),
        "map": game_map,
    }


def admin_payload(
    session_id: str,
    core: dict[str, Any] | None = None,
    room: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Full snapshot for the admin console."""
    if room is not None:
        core = room["core"]
        teams = room["teams"]
        by_team = room["members"]
        queue = room["queue"]
        submissions = room["session_submissions"]
    else:
        if core is None:
            core = session_core(session_id)
        teams = repo.list_teams(session_id)
        by_team = repo.members_by_team([team["id"] for team in teams])
        queue = [_render_challenge(c) for c in repo.queued_challenges(session_id)]
        submissions = repo.session_submissions(session_id)

    return {
        "kind": "admin",
        "map": {**core.get("map",{}),**core.get("_host_map",{})},
        "session": core["session"],
        "board": core["board"],
        "queue": queue,
        "progress": core["progress"],
        "teams": [
            {
                "id": team["id"],
                "name": team["name"],
                "join_code": team["join_code"],
                "members": by_team.get(team["id"], []),
            }
            for team in teams
        ],
        "submissions": submissions,
    }
