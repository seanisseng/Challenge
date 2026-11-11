-- A durable reveal identity lets reconnecting players detect a missed flop.
alter table public.game_sessions add column if not exists board_reveal_version bigint not null default 0;

create or replace function public.set_board_visibility(p_session_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_session public.game_sessions;
begin
    if p_visible is null then raise exception 'board visibility is required'; end if;
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if p_visible and v_session.status = 'ended' then raise exception 'this game has ended'; end if;
    if p_visible then
        perform public.refill_board(p_session_id);
        update public.game_sessions set board_visible = true, status = 'active',
            started_at = coalesce(started_at, now()),
            board_reveal_version = board_reveal_version + case when v_session.board_visible then 0 else 1 end
        where id = p_session_id;
    else
        update public.game_sessions set board_visible = false where id = p_session_id;
    end if;
end;
$$;
revoke all on function public.set_board_visibility(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_board_visibility(uuid, boolean) to service_role;
