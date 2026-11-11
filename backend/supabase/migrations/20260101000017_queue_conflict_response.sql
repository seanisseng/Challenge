-- Application conflicts must not use the database serialization-retry code.
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
        raise exception using errcode = 'PT409', message = 'The queue changed. Refresh and try again.';
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

revoke all on function public.reorder_challenge_queue(uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.reorder_challenge_queue(uuid,uuid[],uuid[]) to service_role;
