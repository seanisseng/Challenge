-- ===========================================================================
-- 20260101000009_team_codes.sql
-- Replace Supabase Auth identity with Kahoot-style team codes.
--
-- Model:
--   * Admin        -> a PIN held in the backend env, never in the database.
--   * Team         -> a slot created up front by the admin (N teams per
--                     session), each with its own join code.
--   * Team member  -> a person who joined with a team's code and typed their
--                     name. Many members share one team; each device holds its
--                     own member token.
--
-- All client access is mediated by the FastAPI backend using the service-role
-- key, so RLS stays enabled but carries no policies: the anon key can read
-- nothing even if it leaks.
-- ===========================================================================

-- --- 1. Drop every policy (public + storage) -------------------------------
do $$
declare
    r record;
begin
    for r in
        select schemaname, tablename, policyname
          from pg_policies
         where schemaname in ('public', 'storage')
    loop
        execute format(
            'drop policy if exists %I on %I.%I',
            r.policyname, r.schemaname, r.tablename
        );
    end loop;
end $$;

-- --- 2. Drop the auth-derived helpers --------------------------------------
drop function if exists public.is_admin();
drop function if exists public.current_team_id();
drop function if exists public.current_session_id();

-- --- 3. Admin is now an env PIN, not a table ------------------------------
drop table if exists public.admin_users;

-- --- 4. Teams: join code instead of auth user ------------------------------
alter table public.teams drop constraint if exists teams_user_unique;
alter table public.teams drop constraint if exists teams_user_id_fkey;
alter table public.teams drop column if exists user_id;
alter table public.teams drop column if exists join_token;

alter table public.teams add column if not exists join_code text;
update public.teams
   set join_code = upper(substr(md5(gen_random_uuid()::text), 1, 6))
 where join_code is null;
alter table public.teams alter column join_code set not null;
alter table public.teams
    add constraint teams_join_code_unique unique (join_code);

-- --- 5. Team members: many people share one team code ---------------------
create table if not exists public.team_members (
    id           uuid primary key default gen_random_uuid(),
    team_id      uuid not null references public.teams (id) on delete cascade,
    name         text not null,
    token        uuid not null unique default gen_random_uuid(),
    joined_at    timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    constraint team_members_name_unique unique (team_id, name)
);

create index if not exists team_members_team_idx
    on public.team_members (team_id);

-- --- 6. Sessions: declared team count, no auth owner ----------------------
alter table public.game_sessions
    add column if not exists team_count integer not null default 4;
alter table public.game_sessions drop column if exists created_by;

-- --- 7. Submissions: attribute to a member, review without auth -----------
alter table public.submissions
    add column if not exists team_member_id uuid
        references public.team_members (id) on delete set null;

alter table public.submissions drop constraint if exists submissions_reviewed_by_fkey;
alter table public.submissions
    alter column reviewed_by type text using reviewed_by::text;

alter table public.submission_events drop constraint if exists submission_events_actor_id_fkey;
alter table public.submission_events
    alter column actor_id type text using actor_id::text;

-- --- 8. Code generator ----------------------------------------------------
create or replace function public.generate_join_code()
returns text
language sql
volatile
as $$
    -- 6 chars from a 32-char alphabet: no 0/O/1/I/L to keep codes readable.
    select string_agg(
               substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                      1 + floor(random() * 31)::int, 1),
               ''
           )
      from generate_series(1, 6);
$$;

-- --- 9. create_session ----------------------------------------------------
-- Creates a session plus `p_team_count` team slots, each with a unique code.
create or replace function public.create_session(
    p_name              text,
    p_team_count        integer,
    p_active_task_limit integer default 6,
    p_room_code         text default null
)
returns table (session_id uuid, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session_id uuid;
    v_room_code  text := nullif(upper(trim(coalesce(p_room_code, ''))), '');
    v_code       text;
    v_i          integer;
begin
    if p_team_count is null or p_team_count < 1 then
        raise exception 'team count must be at least 1';
    end if;
    if p_team_count > 40 then
        raise exception 'team count must be 40 or fewer';
    end if;
    if p_name is null or length(trim(p_name)) = 0 then
        raise exception 'session name is required';
    end if;

    if v_room_code is null then
        loop
            v_code := public.generate_join_code();
            exit when not exists (
                select 1 from public.game_sessions gs where gs.room_code = v_code
            );
        end loop;
        v_room_code := v_code;
    end if;

    insert into public.game_sessions
        (room_code, name, team_count, active_task_limit, status)
    values
        (v_room_code, trim(p_name), p_team_count,
         coalesce(p_active_task_limit, 6), 'lobby')
    returning id into v_session_id;

    for v_i in 1..p_team_count loop
        loop
            v_code := public.generate_join_code();
            begin
                insert into public.teams (session_id, name, join_code)
                values (v_session_id, 'Team ' || v_i, v_code);
                exit;  -- inserted cleanly
            exception when unique_violation then
                null;  -- code collided, try another
            end;
        end loop;
    end loop;

    return query select v_session_id, v_room_code;
end;
$$;

-- --- 10. join_team --------------------------------------------------------
-- Redeems a team code + player name. Returns that device's member token.
create or replace function public.join_team(
    p_join_code   text,
    p_member_name text
)
returns table (
    member_id      uuid,
    member_token   uuid,
    team_id        uuid,
    team_name      text,
    session_id     uuid,
    session_name   text,
    room_code      text,
    session_status public.session_status
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_team    public.teams;
    v_session public.game_sessions;
    v_member  public.team_members;
    v_name    text := trim(coalesce(p_member_name, ''));
begin
    if length(v_name) = 0 then
        raise exception 'a name is required to join';
    end if;
    if length(v_name) > 40 then
        raise exception 'name must be 40 characters or fewer';
    end if;

    select * into v_team
      from public.teams
     where join_code = upper(trim(coalesce(p_join_code, '')));

    if not found then
        raise exception 'invalid team code';
    end if;

    select * into v_session
      from public.game_sessions
     where id = v_team.session_id;

    if v_session.status = 'ended' then
        raise exception 'this game has ended';
    end if;

    begin
        insert into public.team_members (team_id, name)
        values (v_team.id, v_name)
        returning * into v_member;
    exception when unique_violation then
        raise exception 'someone in this team is already using the name %', v_name;
    end;

    return query
        select v_member.id, v_member.token, v_team.id, v_team.name,
               v_session.id, v_session.name, v_session.room_code,
               v_session.status;
end;
$$;

-- --- 11. submit_proof -----------------------------------------------------
-- Team identity is passed explicitly; the backend has already resolved the
-- member token to a team.
create or replace function public.submit_proof(
    p_team_id      uuid,
    p_member_id    uuid,
    p_challenge_id uuid,
    p_photo_path   text,
    p_photo_url    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_team      public.teams;
    v_challenge public.challenges;
    v_sub_id    uuid;
begin
    select * into v_team from public.teams where id = p_team_id;
    if not found then
        raise exception 'team not found';
    end if;

    select * into v_challenge from public.challenges where id = p_challenge_id;
    if not found then
        raise exception 'challenge % not found', p_challenge_id;
    end if;

    if v_challenge.session_id <> v_team.session_id then
        raise exception 'challenge is not part of your session';
    end if;

    if v_challenge.status = 'claimed' then
        raise exception 'challenge already claimed';
    end if;

    insert into public.submissions
        (session_id, challenge_id, team_id, team_member_id, photo_path, photo_url)
    values
        (v_challenge.session_id, p_challenge_id, v_team.id, p_member_id,
         p_photo_path, p_photo_url)
    returning id into v_sub_id;

    insert into public.submission_events (submission_id, event, actor_id)
    values (v_sub_id, 'submitted', p_member_id::text);

    return v_sub_id;
end;
$$;

-- --- 12. approve_submission ----------------------------------------------
-- The winning-claim transaction. Unchanged mechanics, minus the auth check
-- (the backend gates this behind the admin PIN).
create or replace function public.approve_submission(
    p_submission_id uuid,
    p_note          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub       public.submissions;
    v_challenge public.challenges;
    v_clue_id   uuid;
begin
    select * into v_sub
      from public.submissions
     where id = p_submission_id
     for update;

    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;
    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;

    select * into v_challenge
      from public.challenges
     where id = v_sub.challenge_id
     for update;

    if not found then
        raise exception 'challenge not found';
    end if;
    if v_challenge.status = 'claimed' then
        raise exception 'challenge already claimed by another team';
    end if;

    v_clue_id := v_challenge.clue_id;
    if v_clue_id is null then
        select id into v_clue_id
          from public.clues
         where session_id = v_challenge.session_id
           and tier = v_challenge.clue_tier
         order by sort_order
         limit 1;
    end if;

    update public.submissions
       set status = 'approved',
           reviewed_by = 'admin',
           review_note = p_note,
           reviewed_at = now()
     where id = p_submission_id;

    update public.challenges
       set status = 'claimed',
           claimed_by_team_id = v_sub.team_id,
           updated_at = now()
     where id = v_challenge.id;

    if v_clue_id is not null then
        insert into public.team_clues (team_id, clue_id, challenge_id)
        values (v_sub.team_id, v_clue_id, v_challenge.id)
        on conflict (team_id, clue_id) do nothing;
    end if;

    -- Everyone else who was racing this challenge loses.
    update public.submissions
       set status = 'rejected',
           reviewed_by = 'admin',
           reviewed_at = now(),
           review_note = coalesce(review_note, 'Challenge claimed by another team')
     where challenge_id = v_challenge.id
       and status = 'pending';

    insert into public.submission_events (submission_id, event, actor_id, note)
    values (p_submission_id, 'approved', 'admin', p_note);

    perform public.refill_board(v_challenge.session_id);
end;
$$;

-- --- 13. reject_submission -----------------------------------------------
create or replace function public.reject_submission(
    p_submission_id uuid,
    p_note          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub public.submissions;
begin
    select * into v_sub
      from public.submissions
     where id = p_submission_id
     for update;

    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;
    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;

    update public.submissions
       set status = 'rejected',
           reviewed_by = 'admin',
           review_note = p_note,
           reviewed_at = now()
     where id = p_submission_id;

    if not exists (
        select 1 from public.submissions
         where challenge_id = v_sub.challenge_id and status = 'pending'
    ) then
        update public.challenges
           set status = 'open', updated_at = now()
         where id = v_sub.challenge_id
           and status = 'pending_approval';
    end if;

    insert into public.submission_events (submission_id, event, actor_id, note)
    values (p_submission_id, 'rejected', 'admin', p_note);
end;
$$;

-- --- 14. refill_board ----------------------------------------------------
create or replace function public.refill_board(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limit        integer;
    v_active_count integer;
    v_needed       integer;
begin
    select active_task_limit into v_limit
      from public.game_sessions
     where id = p_session_id;

    if v_limit is null then
        return;
    end if;

    update public.challenges
       set is_active = false, updated_at = now()
     where session_id = p_session_id
       and is_active
       and status = 'claimed';

    select count(*) into v_active_count
      from public.challenges
     where session_id = p_session_id
       and is_active
       and status in ('open', 'pending_approval');

    v_needed := v_limit - v_active_count;
    if v_needed <= 0 then
        return;
    end if;

    with picked as (
        select id
          from public.challenges
         where session_id = p_session_id
           and not is_active
           and status = 'open'
         order by sort_order, created_at
         limit v_needed
    )
    update public.challenges c
       set is_active = true, updated_at = now()
      from picked
     where c.id = picked.id;
end;
$$;

-- --- 15. Lock the API surface down ---------------------------------------
-- Nothing but the backend's service_role may touch these. RLS stays enabled
-- with no policies, so a leaked anon key reads nothing.

alter table public.game_sessions     enable row level security;
alter table public.teams             enable row level security;
alter table public.team_members      enable row level security;
alter table public.clues             enable row level security;
alter table public.challenges        enable row level security;
alter table public.submissions       enable row level security;
alter table public.team_clues        enable row level security;
alter table public.submission_events enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
revoke execute on all functions in schema public from public;

grant usage on schema public to service_role;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Storage: the bucket stays, but nothing is reachable directly. The backend
-- mints short-lived signed upload/download URLs with the service-role key.
revoke all on storage.objects from anon, authenticated;
