-- ===========================================================================
-- 20260101000001_init_schema.sql
-- Core enums and tables for the real-time competitive scavenger hunt.
-- ===========================================================================

-- gen_random_uuid() is built into Postgres 13+; ensure pgcrypto as a fallback.
create extension if not exists pgcrypto;

-- --- Enums -----------------------------------------------------------------
-- game lifecycle: teams gather in a lobby, then it goes live, then it ends.
create type public.session_status as enum ('lobby', 'active', 'ended');

-- challenge board state. "pending_approval" means at least one team has a
-- submission awaiting review; "claimed" means a submission was approved and
-- the challenge is now locked for all rival teams.
create type public.challenge_status as enum ('open', 'pending_approval', 'claimed');

-- 3 tiers of clue precision (see AGENTS.md).
create type public.clue_tier as enum ('tier1', 'tier2', 'tier3');

-- photo-proof review state.
create type public.submission_status as enum ('pending', 'approved', 'rejected');

-- --- Admin allow-list ------------------------------------------------------
-- Membership in this table is what makes a user an Admin (see is_admin()).
create table public.admin_users (
    user_id      uuid primary key references auth.users (id) on delete cascade,
    display_name text not null,
    created_at   timestamptz not null default now()
);

-- --- Game sessions ---------------------------------------------------------
create table public.game_sessions (
    id                uuid primary key default gen_random_uuid(),
    room_code         text not null unique,
    name              text not null,
    status            public.session_status not null default 'lobby',
    active_task_limit integer not null default 6,
    final_destination jsonb,                       -- coordinates/notes; admin-only
    created_by        uuid references auth.users (id) on delete set null,
    created_at        timestamptz not null default now(),
    started_at        timestamptz,
    ended_at          timestamptz
);

-- --- Teams -----------------------------------------------------------------
-- One team per (anonymous) auth user, joined via join_session().
create table public.teams (
    id         uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.game_sessions (id) on delete cascade,
    name       text not null,
    user_id    uuid not null references auth.users (id) on delete cascade,
    join_token text,
    created_at timestamptz not null default now(),
    constraint teams_session_name_unique unique (session_id, name),
    constraint teams_user_unique unique (user_id)
);

-- --- Clues -----------------------------------------------------------------
-- Clue content, grouped per session and tier. A clue may optionally carry media.
create table public.clues (
    id         uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.game_sessions (id) on delete cascade,
    tier       public.clue_tier not null,
    title      text not null,
    body       text not null,
    media_url  text,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

-- --- Challenges (the pool + live board) ------------------------------------
create table public.challenges (
    id                 uuid primary key default gen_random_uuid(),
    session_id         uuid not null references public.game_sessions (id) on delete cascade,
    title              text not null,
    location_area      text,                       -- 📍 where the task happens
    completion_condition text not null,            -- 🎯 exact photo requirement
    clue_tier          public.clue_tier not null,  -- 🔑 which tier this unlocks
    clue_id            uuid references public.clues (id) on delete set null,
    status             public.challenge_status not null default 'open',
    is_active          boolean not null default false, -- currently shown on the board
    claimed_by_team_id uuid references public.teams (id) on delete set null,
    sort_order         integer not null default 0,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

-- --- Submissions (photo proof + review log) --------------------------------
create table public.submissions (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid not null references public.game_sessions (id) on delete cascade,
    challenge_id uuid not null references public.challenges (id) on delete cascade,
    team_id      uuid not null references public.teams (id) on delete cascade,
    photo_path   text not null,                    -- storage key in challenge-proofs
    photo_url    text,
    status       public.submission_status not null default 'pending',
    reviewed_by  uuid references auth.users (id) on delete set null,
    review_note  text,
    submitted_at timestamptz not null default now(),
    reviewed_at  timestamptz
);

-- --- Per-team unlocked clue inventory --------------------------------------
create table public.team_clues (
    id           uuid primary key default gen_random_uuid(),
    team_id      uuid not null references public.teams (id) on delete cascade,
    clue_id      uuid not null references public.clues (id) on delete cascade,
    challenge_id uuid references public.challenges (id) on delete set null,
    unlocked_at  timestamptz not null default now(),
    constraint team_clues_unique unique (team_id, clue_id)
);

-- --- Submission audit trail ------------------------------------------------
create table public.submission_events (
    id            bigint generated always as identity primary key,
    submission_id uuid not null references public.submissions (id) on delete cascade,
    event         text not null,                   -- submitted | approved | rejected
    actor_id      uuid references auth.users (id) on delete set null,
    note          text,
    created_at    timestamptz not null default now()
);
