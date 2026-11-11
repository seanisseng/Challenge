-- Session-local removals never return; host queue edits are atomic and checked.
alter table public.challenges add column if not exists is_discarded boolean not null default false;
alter table public.challenges add constraint discarded_challenges_stay_off_board
    check (not is_discarded or not is_active);

create or replace function public.refill_board(p_session_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_limit integer; v_needed integer;
begin
    select active_task_limit into v_limit from public.game_sessions where id = p_session_id;
    if v_limit is null then return; end if;
    update public.challenges set is_active = false
     where session_id = p_session_id and is_active and status = 'claimed';
    select v_limit - count(*) into v_needed from public.challenges
     where session_id = p_session_id and is_active and not is_discarded
       and status in ('open','pending_approval');
    if v_needed <= 0 then return; end if;
    with picked as (
        select id from public.challenges
         where session_id = p_session_id and not is_active and not is_discarded
           and status = 'open' order by sort_order,created_at limit v_needed
    )
    update public.challenges c set is_active = true from picked where c.id = picked.id;
end;
$$;

create or replace function public.discard_challenge(p_session_id uuid, p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_session public.game_sessions; v_challenge public.challenges;
begin
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if v_session.status = 'ended' then raise exception 'this game has ended'; end if;
    perform id from public.submissions where challenge_id = p_challenge_id and status = 'pending'
        order by id for update;
    select * into v_challenge from public.challenges
     where id = p_challenge_id and session_id = p_session_id for update;
    if not found then raise exception 'challenge not found in this session'; end if;
    if v_challenge.is_discarded then return; end if;
    if v_challenge.status = 'claimed' then raise exception 'claimed challenges cannot be removed'; end if;
    with cancelled as (
        update public.submissions set status = 'rejected', reviewed_by = 'admin', reviewed_at = now(),
            review_note = 'Challenge removed from this game by the host'
         where challenge_id = p_challenge_id and status = 'pending' returning id
    )
    insert into public.submission_events(submission_id,event,actor_id,note)
        select id,'rejected','admin','Challenge removed from this game by the host' from cancelled;
    update public.challenges set is_active = false, is_discarded = true, status = 'open'
     where id = p_challenge_id;
    perform public.refill_board(p_session_id);
end;
$$;

-- Compatibility for old clients: the former requeue action now removes too.
create or replace function public.defer_challenge(p_session_id uuid, p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
    perform public.discard_challenge(p_session_id, p_challenge_id);
end;
$$;

create or replace function public.reorder_challenge_queue(
    p_session_id uuid, p_challenge_ids uuid[], p_expected_ids uuid[]
)
returns void language plpgsql security definer set search_path = public as $$
declare v_session public.game_sessions; v_current uuid[]; v_base integer;
begin
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if v_session.status = 'ended' then raise exception 'this game has ended'; end if;
    if p_challenge_ids is null or p_expected_ids is null then raise exception 'queue order is required'; end if;
    perform id from public.challenges
     where session_id = p_session_id and not is_active and not is_discarded and status = 'open'
     order by id for update;
    select coalesce(array_agg(id order by sort_order,created_at),'{}'::uuid[]) into v_current
      from public.challenges where session_id = p_session_id
       and not is_active and not is_discarded and status = 'open';
    if p_expected_ids is distinct from v_current then
        raise exception using errcode = '40001', message = 'The queue changed. Refresh and try again.';
    end if;
    if cardinality(p_challenge_ids) <> cardinality(v_current)
       or cardinality(p_challenge_ids) <> (select count(distinct value) from unnest(p_challenge_ids) value)
       or not (p_challenge_ids <@ v_current and v_current <@ p_challenge_ids) then
        raise exception 'queue order must contain every queued challenge exactly once';
    end if;
    select coalesce(max(sort_order),0) into v_base from public.challenges
     where session_id = p_session_id and (is_active or is_discarded or status <> 'open');
    update public.challenges c set sort_order = v_base + ordered.position::integer
      from unnest(p_challenge_ids) with ordinality ordered(id,position)
     where c.id = ordered.id and c.session_id = p_session_id;
end;
$$;

create or replace function public.tg_submission_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_challenge public.challenges;
begin
    select * into v_challenge from public.challenges where id = new.challenge_id for update;
    if not found then raise exception 'challenge not found'; end if;
    if v_challenge.session_id <> new.session_id then raise exception 'submission session does not match challenge session'; end if;
    if v_challenge.is_discarded then raise exception 'challenge was removed from this game'; end if;
    if v_challenge.status = 'claimed' then raise exception 'challenge is already claimed'; end if;
    if not v_challenge.is_active then raise exception 'challenge is not on the live board'; end if;
    if not exists (select 1 from public.game_sessions where id = new.session_id and status = 'active' and board_visible) then
        raise exception 'the board is hidden or the game is not active';
    end if;
    update public.challenges set status = 'pending_approval' where id = new.challenge_id and status = 'open';
    return new;
end;
$$;

revoke all on function public.refill_board(uuid) from public,anon,authenticated;
revoke all on function public.discard_challenge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.defer_challenge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.reorder_challenge_queue(uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.refill_board(uuid) to service_role;
grant execute on function public.discard_challenge(uuid,uuid) to service_role;
grant execute on function public.defer_challenge(uuid,uuid) to service_role;
grant execute on function public.reorder_challenge_queue(uuid,uuid[],uuid[]) to service_role;
