-- ===========================================================================
-- 20260101000005_rpc_functions.sql
-- Atomic, SECURITY DEFINER operations. These bypass RLS but re-check identity
-- internally, so the sniping and clue-unlock mechanics stay race-safe no
-- matter which client calls them.
-- ===========================================================================

-- --- join_session -----------------------------------------------------------
-- Idempotent: creates (or renames) the calling user's team in a session.
create or replace function public.join_session(
    p_room_code text,
    p_team_name text
)
returns table (team_id uuid, session_id uuid, session_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_session public.game_sessions;
    v_team_id uuid;
begin
    if v_uid is null then
        raise exception 'authentication required';
    end if;

    select * into v_session
      from public.game_sessions
     where upper(room_code) = upper(p_room_code);

    if not found then
        raise exception 'no session found for room code %', p_room_code;
    end if;

    if v_session.status = 'ended' then
        raise exception 'session has ended';
    end if;

    select id into v_team_id from public.teams where user_id = v_uid;

    if v_team_id is null then
        insert into public.teams (session_id, name, user_id)
        values (v_session.id, p_team_name, v_uid)
        returning id into v_team_id;
    else
        update public.teams
           set name = p_team_name
         where id = v_team_id and session_id = v_session.id;

        if not found then
            raise exception 'you have already joined a different session';
        end if;
    end if;

    return query select v_team_id, v_session.id, v_session.name;
end;
$$;

-- --- submit_proof -----------------------------------------------------------
-- Registers a photo submission. The table trigger flips the challenge to
-- 'pending_approval' and rejects already-claimed challenges.
create or replace function public.submit_proof(
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
    select * into v_team from public.teams where user_id = auth.uid();
    if not found then
        raise exception 'join a session before submitting';
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

    insert into public.submissions (session_id, challenge_id, team_id, photo_path, photo_url)
    values (v_challenge.session_id, p_challenge_id, v_team.id, p_photo_path, p_photo_url)
    returning id into v_sub_id;

    insert into public.submission_events (submission_id, event, actor_id)
    values (v_sub_id, 'submitted', auth.uid());

    return v_sub_id;
end;
$$;

-- --- approve_submission -----------------------------------------------------
-- The winning-claim transaction. Locks the challenge, marks the submission
-- approved, claims the challenge for that team, grants the matching tier clue,
-- auto-rejects rival pending submissions, and refills the board. All atomic.
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
    if not public.is_admin() then
        raise exception 'admin privileges required';
    end if;

    select * into v_sub from public.submissions where id = p_submission_id for update;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;
    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;

    select * into v_challenge from public.challenges where id = v_sub.challenge_id for update;
    if not found then
        raise exception 'challenge not found';
    end if;
    if v_challenge.status = 'claimed' then
        raise exception 'challenge already claimed by another team';
    end if;

    -- Resolve the clue bound to the challenge; fall back to the first clue of
    -- the same tier in the session.
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
           reviewed_by = auth.uid(),
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
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           review_note = coalesce(review_note, 'Challenge claimed by another team')
     where challenge_id = v_challenge.id
       and status = 'pending';

    insert into public.submission_events (submission_id, event, actor_id, note)
    values (p_submission_id, 'approved', auth.uid(), p_note);

    perform public.refill_board(v_challenge.session_id);
end;
$$;

-- --- reject_submission ------------------------------------------------------
-- Rejects a pending submission. If no other pending submissions remain, the
-- challenge returns to the open board.
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
    if not public.is_admin() then
        raise exception 'admin privileges required';
    end if;

    select * into v_sub from public.submissions where id = p_submission_id for update;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;
    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;

    update public.submissions
       set status = 'rejected',
           reviewed_by = auth.uid(),
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
    values (p_submission_id, 'rejected', auth.uid(), p_note);
end;
$$;

-- --- refill_board -----------------------------------------------------------
-- Keeps exactly `active_task_limit` challenges live: retires claimed ones and
-- activates fresh open challenges from the pool.
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

    -- Retire claimed challenges that are still showing on the board.
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

-- --- Grants -----------------------------------------------------------------
-- Keep fresh installs backend-only, including before the identity rewrite.
revoke execute on function public.join_session(text, text) from public, anon, authenticated;
revoke execute on function public.submit_proof(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.approve_submission(uuid, text) from public, anon, authenticated;
revoke execute on function public.reject_submission(uuid, text) from public, anon, authenticated;
revoke execute on function public.refill_board(uuid) from public, anon, authenticated;

grant execute on function public.join_session(text, text) to service_role;
grant execute on function public.submit_proof(uuid, text, text) to service_role;
grant execute on function public.approve_submission(uuid, text) to service_role;
grant execute on function public.reject_submission(uuid, text) to service_role;
grant execute on function public.refill_board(uuid) to service_role;
