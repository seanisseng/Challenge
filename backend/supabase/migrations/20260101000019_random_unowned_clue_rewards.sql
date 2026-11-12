-- Each approved challenge awards one random clue from its tier that the
-- winning team does not already own. Challenge bindings do not bias the draw.
-- Retain the session -> challenge -> submission lock order from migration 18:
-- concurrent approvals cannot draw the same unowned clue for the same team.
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

    select c.id into v_clue_id
      from public.clues c
     where c.session_id = v_challenge.session_id
       and c.tier = v_challenge.clue_tier
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

revoke all on function public.approve_submission(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text) to service_role;
