-- Host visibility is independent of consent, arrival, game status and winning.
alter table public.game_sessions add column if not exists map_hidden_team_ids uuid[] not null default '{}';
alter table public.game_sessions add column if not exists map_visibility_revision bigint not null default 0;

create or replace function public.set_team_location_visibility(p_session_id uuid,p_team_id uuid,p_visible boolean)
returns bigint language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; hidden uuid[];
begin
    if p_visible is null then raise exception 'Visibility is required'; end if;
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'Session not found'; end if;
    if not exists(select 1 from public.teams where id=p_team_id and session_id=p_session_id) then
        raise exception 'Team is not part of this session';
    end if;
    hidden=s.map_hidden_team_ids;
    if p_visible then hidden=array_remove(hidden,p_team_id);
    elsif not p_team_id=any(hidden) then hidden=array_append(hidden,p_team_id);
    end if;
    if hidden is distinct from s.map_hidden_team_ids then
        update public.game_sessions set map_hidden_team_ids=hidden,map_visibility_revision=map_visibility_revision+1
         where id=p_session_id returning map_visibility_revision into s.map_visibility_revision;
    end if;
    return s.map_visibility_revision;
end $$;
revoke all on function public.set_team_location_visibility(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_team_location_visibility(uuid,uuid,boolean) to service_role;

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
    select * into v_sub from public.submissions where id = p_submission_id;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;

    select * into v_challenge from public.challenges where id = v_sub.challenge_id;
    if not found then
        raise exception 'challenge not found';
    end if;

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

    if not exists (select 1 from public.clues where tier = v_challenge.clue_tier) then
        raise exception 'no clues configured for tier %', v_challenge.clue_tier;
    end if;

    select c.id into v_clue_id
      from public.clues c
     where c.tier = v_challenge.clue_tier
       and not exists (
           select 1 from public.team_clues tc
            where tc.team_id = v_sub.team_id
              and tc.clue_id = c.id
       )
     order by random()
     limit 1;

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

    -- An exhausted tier has no new clue to give; never repeat an owned clue.
    if v_clue_id is not null then
        insert into public.team_clues (team_id, clue_id, challenge_id)
        values (v_sub.team_id, v_clue_id, v_challenge.id)
        on conflict (team_id, clue_id) do nothing;
    end if;

    -- Reject only competing pending proofs for this task, in the same transaction.
    with rejected as (
        update public.submissions
           set status = 'rejected', reviewed_by = 'admin', reviewed_at = now(),
               review_note = 'Another team has claimed this task.'
         where challenge_id = v_challenge.id and status = 'pending'
         returning id
    )
    insert into public.submission_events(submission_id,event,actor_id,note)
    select id,'rejected','admin','Another team has claimed this task.' from rejected;

    insert into public.submission_events (submission_id, event, actor_id, note)
    values (p_submission_id, 'approved', 'admin', p_note);

    perform public.refill_board(v_challenge.session_id);
end;
$$;

revoke all on function public.approve_submission(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text) to service_role;
