-- ===========================================================================
-- 20260101000002_constraints_indexes.sql
-- Business-rule indexes, an updated_at trigger, and the submission guard
-- trigger that enforces the sniping mechanic at the row level.
-- ===========================================================================

-- --- Sniping rules ---------------------------------------------------------
-- A challenge may have MANY pending submissions (non-exclusive until approved)
-- but only ONE approved submission ever — that is the winning claim.
create unique index submissions_one_approved_per_challenge
    on public.submissions (challenge_id)
    where status = 'approved';

-- A single team may not stack duplicate pending submissions on one challenge.
create unique index submissions_one_pending_per_team_challenge
    on public.submissions (challenge_id, team_id)
    where status = 'pending';

-- --- Performance indexes ---------------------------------------------------
create index challenges_session_active_idx
    on public.challenges (session_id, is_active, status);
create index challenges_claimed_by_idx
    on public.challenges (claimed_by_team_id);
create index clues_session_tier_idx
    on public.clues (session_id, tier, sort_order);
create index submissions_challenge_idx
    on public.submissions (challenge_id);
create index submissions_team_idx
    on public.submissions (team_id, status);
create index team_clues_team_idx
    on public.team_clues (team_id);
create index submission_events_submission_idx
    on public.submission_events (submission_id);
create index teams_session_idx
    on public.teams (session_id);

-- --- updated_at maintenance ------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger challenges_set_updated_at
    before update on public.challenges
    for each row execute function public.tg_set_updated_at();

-- --- Submission guard ------------------------------------------------------
-- Runs before every insert into submissions. It:
--   * rejects submissions targeting an already-claimed challenge,
--   * rejects cross-session submissions,
--   * flips the challenge from 'open' to 'pending_approval'.
-- The challenge row is locked FOR UPDATE so concurrent submissions serialize
-- safely. SECURITY DEFINER so it works regardless of the caller's RLS grants.
create or replace function public.tg_submission_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_challenge public.challenges;
begin
    select * into v_challenge
      from public.challenges
     where id = new.challenge_id
     for update;

    if not found then
        raise exception 'challenge % not found', new.challenge_id;
    end if;

    if v_challenge.session_id <> new.session_id then
        raise exception 'submission session does not match challenge session';
    end if;

    if v_challenge.status = 'claimed' then
        raise exception 'challenge % is already claimed', new.challenge_id;
    end if;

    update public.challenges
       set status = 'pending_approval', updated_at = now()
     where id = new.challenge_id
       and status = 'open';

    return new;
end;
$$;

create trigger submissions_before_insert
    before insert on public.submissions
    for each row execute function public.tg_submission_before_insert();
