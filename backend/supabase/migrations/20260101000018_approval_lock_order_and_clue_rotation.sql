-- ===========================================================================
-- 20260101000018_approval_lock_order_and_clue_rotation.sql
--
-- Two fixes:
--
-- 1. Lock order. Every admin write now takes row locks in the same order:
--
--        game_sessions -> challenges -> submissions
--
--    Two approvals for the same challenge (two host tabs/devices, or an
--    approval racing a discard) used to lock their submission first and then
--    the challenge. Each transaction then held the row the other needed, and
--    Postgres aborted one with 40P01 "deadlock detected" - a real intermittent
--    failure during a live game. The challenge lock is now taken first.
--    refill_board takes the session lock too, so a standalone board top-up
--    cannot interleave with an approval.
--
-- 2. Clue rotation. A challenge with no bound clue used to fall back to the
--    first clue of its tier every time. team_clues is unique on
--    (team_id, clue_id), so every later win of that tier was silently
--    discarded and a team could never collect more than one clue per tier.
--    The fallback now skips clues the team already owns.
-- ===========================================================================

-- --- approve_submission -----------------------------------------------------
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
    -- Unlocked read only to learn which challenge this submission belongs to.
    select * into v_sub from public.submissions where id = p_submission_id;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;

    select * into v_challenge from public.challenges where id = v_sub.challenge_id;
    if not found then
        raise exception 'challenge not found';
    end if;

    -- Lock order: session -> challenge -> submission.
    perform id from public.game_sessions
     where id = v_challenge.session_id for update;

    select * into v_challenge
      from public.challenges
     where id = v_sub.challenge_id
     for update;

    select * into v_sub
      from public.submissions
     where id = p_submission_id
     for update;

    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;
    if v_challenge.status = 'claimed' then
        raise exception 'challenge already claimed by another team';
    end if;

    -- Prefer the clue bound to the challenge. If this team already owns it,
    -- rotate to the next clue of the same tier they do not own yet, otherwise
    -- every repeat win of a tier would be swallowed by the unique index.
    v_clue_id := v_challenge.clue_id;
    if v_clue_id is not null and exists (
        select 1 from public.team_clues
         where team_id = v_sub.team_id and clue_id = v_clue_id
    ) then
        v_clue_id := null;
    end if;

    if v_clue_id is null then
        select c.id into v_clue_id
          from public.clues c
         where c.session_id = v_challenge.session_id
           and c.tier = v_challenge.clue_tier
           and not exists (
               select 1 from public.team_clues tc
                where tc.team_id = v_sub.team_id
                  and tc.clue_id = c.id
           )
         order by c.sort_order, c.id
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

    -- Everyone else racing this challenge loses. Safe now that we hold the
    -- challenge lock: rival approvals block before locking their submission.
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

-- --- reject_submission ------------------------------------------------------
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
    v_sub       public.submissions;
    v_challenge public.challenges;
begin
    select * into v_sub from public.submissions where id = p_submission_id;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;

    select * into v_challenge from public.challenges where id = v_sub.challenge_id;
    if not found then
        raise exception 'challenge not found';
    end if;

    -- Same order as approve/discard: session -> challenge -> submission.
    perform id from public.game_sessions
     where id = v_challenge.session_id for update;

    select * into v_challenge
      from public.challenges
     where id = v_sub.challenge_id
     for update;

    select * into v_sub
      from public.submissions
     where id = p_submission_id
     for update;

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

-- --- discard_challenge ------------------------------------------------------
-- Lock the challenge before its pending submissions, matching the reviewers.
create or replace function public.discard_challenge(
    p_session_id   uuid,
    p_challenge_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session   public.game_sessions;
    v_challenge public.challenges;
begin
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if v_session.status = 'ended' then raise exception 'this game has ended'; end if;

    select * into v_challenge
      from public.challenges
     where id = p_challenge_id and session_id = p_session_id
     for update;
    if not found then raise exception 'challenge not found in this session'; end if;
    if v_challenge.is_discarded then return; end if;
    if v_challenge.status = 'claimed' then
        raise exception 'claimed challenges cannot be removed';
    end if;

    with cancelled as (
        update public.submissions
           set status = 'rejected',
               reviewed_by = 'admin',
               reviewed_at = now(),
               review_note = 'Challenge removed from this game by the host'
         where challenge_id = p_challenge_id and status = 'pending'
         returning id
    )
    insert into public.submission_events (submission_id, event, actor_id, note)
        select id, 'rejected', 'admin', 'Challenge removed from this game by the host'
          from cancelled;

    update public.challenges
       set is_active = false, is_discarded = true, status = 'open'
     where id = p_challenge_id;

    perform public.refill_board(p_session_id);
end;
$$;

-- --- refill_board -----------------------------------------------------------
-- Same entry point as everything else: lock the session first. A standalone
-- refill (start board, manual top-up) then queues behind an in-flight approval
-- instead of picking up challenge row locks in plan order and deadlocking
-- against it. Called from approve/discard it is a no-op re-lock.
create or replace function public.refill_board(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_limit  integer;
    v_needed integer;
begin
    perform id from public.game_sessions where id = p_session_id for update;

    select active_task_limit into v_limit
      from public.game_sessions
     where id = p_session_id;
    if v_limit is null then return; end if;

    update public.challenges
       set is_active = false
     where session_id = p_session_id and is_active and status = 'claimed';

    select v_limit - count(*) into v_needed
      from public.challenges
     where session_id = p_session_id
       and is_active
       and not is_discarded
       and status in ('open', 'pending_approval');
    if v_needed <= 0 then return; end if;

    with picked as (
        select id
          from public.challenges
         where session_id = p_session_id
           and not is_active
           and not is_discarded
           and status = 'open'
         order by sort_order, created_at
         limit v_needed
    )
    update public.challenges c
       set is_active = true
      from picked
     where c.id = picked.id;
end;
$$;

-- --- grants -----------------------------------------------------------------
revoke all on function public.approve_submission(uuid, text) from public, anon, authenticated;
revoke all on function public.reject_submission(uuid, text)  from public, anon, authenticated;
revoke all on function public.discard_challenge(uuid, uuid)  from public, anon, authenticated;
revoke all on function public.refill_board(uuid)             from public, anon, authenticated;

grant execute on function public.approve_submission(uuid, text) to service_role;
grant execute on function public.reject_submission(uuid, text)  to service_role;
grant execute on function public.discard_challenge(uuid, uuid)  to service_role;
grant execute on function public.refill_board(uuid)             to service_role;
