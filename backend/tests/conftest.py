"""Disposable local PostgreSQL fixture. Never connects to hosted databases."""
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess

import pytest

MIGRATIONS = Path(__file__).resolve().parents[1] / "supabase" / "migrations"

@pytest.fixture(scope="module")
def postgres(tmp_path_factory):
    executable = shutil.which("initdb")
    binary_dir = Path(os.environ.get("POSTGRES_BIN", Path(executable).parent if executable else ""))
    initdb = binary_dir / ("initdb.exe" if os.name == "nt" else "initdb")
    if not initdb.is_file():
        pytest.skip("local PostgreSQL binaries required; set POSTGRES_BIN")
    root = tmp_path_factory.mktemp("clue-rotation-postgres")
    data = root / "data"
    subprocess.run([str(initdb), "-D", str(data), "-U", "postgres", "-A", "trust", "--no-locale", "-E", "UTF8"], check=True, capture_output=True)
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    control = str(binary_dir / "pg_ctl")
    # A Windows server can inherit captured pipe handles and prevent run()
    # from returning even after pg_ctl exits. Use a file for startup output.
    with (root / "control.log").open("w") as output:
        subprocess.run([control, "-D", str(data), "-l", str(root / "postgres.log"), "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"], check=True, stdout=output, stderr=subprocess.STDOUT, timeout=90)

    def sql(statement, *, check=True):
        result = subprocess.run(
            [str(binary_dir / "psql"), "-X", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"],
            input=statement, text=True, encoding="utf-8", env={**os.environ, "PGCLIENTENCODING": "UTF8"}, capture_output=True, timeout=30,
        )

        if check:
            assert result.returncode == 0, result.stderr
        return result

    try:
        # Only the tables touched by approve_submission; board refill is outside
        # this reward regression. Execute the actual migration's PL/pgSQL below.
        sql("""
            create table game_sessions (id uuid primary key);
            create table challenges (
                id uuid primary key, session_id uuid, clue_id uuid,
                clue_tier text, status text default 'open',
                claimed_by_team_id uuid, updated_at timestamptz
            );
            create table submissions (
                id uuid primary key, challenge_id uuid, team_id uuid,
                status text default 'pending', reviewed_by text,
                review_note text, reviewed_at timestamptz
            );
            create table clues (id uuid primary key, session_id uuid, tier text, sort_order integer);
            create table team_clues (
                team_id uuid, clue_id uuid, challenge_id uuid,
                unique (team_id, clue_id)
            );
            create table submission_events (submission_id uuid, event text, actor_id text, note text);
            create function refill_board(uuid) returns void language sql as 'select';
        """)
        override = os.environ.get("CLUE_APPROVAL_MIGRATION")
        paths = [MIGRATIONS / override] if override else sorted(MIGRATIONS.glob("*.sql"))
        definitions = []
        for path in paths:
            definitions.extend(re.findall(
                r"create or replace function public\.approve_submission\(.*?\$\$;",
                path.read_text(encoding="utf-8"), re.DOTALL | re.IGNORECASE,
            ))
        assert definitions, "approval RPC migration must exist"
        sql(definitions[-1])
        yield sql
    finally:
        subprocess.run([control, "-D", str(data), "-m", "immediate", "-w", "stop"], check=True, capture_output=True)




@pytest.fixture(scope='module')
def full_database(postgres):
    sql=postgres
    sql("""
        drop schema public cascade; create schema public;
        create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql as 'select null::uuid';
        create role anon; create role authenticated; create role service_role;
        grant usage on schema public to anon,authenticated,service_role;
        create schema storage; create table storage.objects(id uuid);
        create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    """)
    for path in sorted(MIGRATIONS.glob('*.sql')):
        if int(path.name[10:14]) not in (6,7): sql('begin;'+path.read_text(encoding='utf-8')+'commit;')
    return sql

