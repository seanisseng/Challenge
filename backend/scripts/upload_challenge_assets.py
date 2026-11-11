"""Upload local challenge<N>.jpg references after migration 0013 and seeding.

Run from backend: .venv/Scripts/python.exe scripts/upload_challenge_assets.py
Credentials are read from backend/.env; they are never printed.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.config import Settings
from supabase import create_client


def plan_assets(folder: Path, challenges: list[dict]) -> list[tuple[Path, str]]:
    """Resolve every local filename before writing anything remotely."""
    plan = []
    for file in sorted(folder.glob("challenge*.jpg")):
        match = re.fullmatch(r"challenge([1-9][0-9]*)\.jpg", file.name)
        if not match:
            raise ValueError(f"invalid reference filename: {file.name}")
        matches = [row for row in challenges if row["sort_order"] == int(match[1])]
        if len(matches) != 1:
            raise ValueError(f"{file.name}: expected exactly one matching sort_order")
        if not 0 < file.stat().st_size <= 10 * 1024 * 1024:
            raise ValueError(f"{file.name}: must be nonempty and at most 10 MiB")
        plan.append((file, matches[0]["id"]))
    if not plan:
        raise ValueError("no challenge<N>.jpg files found")
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--room-code", default="95Q2X3")
    parser.add_argument("--folder", type=Path, default=BACKEND.parent / "challenges")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    settings = Settings(_env_file=BACKEND / ".env")
    if not settings.supabase_url or not settings.service_key:
        raise ValueError("configure SUPABASE_URL and a service key in backend/.env")
    client = create_client(settings.supabase_url, settings.service_key)
    sessions = client.table("game_sessions").select("id").eq("room_code", args.room_code).execute().data
    if len(sessions) != 1:
        raise ValueError("expected exactly one session for the room code")
    session_id = sessions[0]["id"]
    rows = client.table("challenges").select("id,sort_order").eq("session_id", session_id).execute().data
    plan = plan_assets(args.folder, rows)
    for file, challenge_id in plan:
        path = f"{session_id}/{file.name}"
        if not args.dry_run:
            client.storage.from_(settings.asset_bucket).upload(
                path, file.read_bytes(),
                {"content-type": "image/jpeg", "upsert": "true", "cache-control": "0"},
            )
            client.table("challenges").update({"image_path": path}).eq("id", challenge_id).execute()
        print(f"{'Planned' if args.dry_run else 'Uploaded'} {file.name} -> {path}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Third-party exceptions may contain request details; don't print them.
        print(f"Asset upload failed ({type(exc).__name__}); verify credentials, migration and seed.", file=sys.stderr)
        sys.exit(1)
