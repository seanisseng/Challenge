-- Team codes authorize shared team access, not individual player accounts.
-- Keep the old optional name argument for older clients, but never use it.
create or replace function public.join_team(
    p_join_code text,
    p_member_name text default null
)
returns table (
    member_id uuid, member_token uuid, team_id uuid, team_name text,
    session_id uuid, session_name text, room_code text,
    session_status public.session_status
)
language plpgsql security definer set search_path=public as $$
declare
    v_team public.teams;
    v_session public.game_sessions;
    v_member public.team_members;
    v_pool_name text;
begin
    select * into v_team from public.teams
     where join_code=upper(trim(coalesce(p_join_code,'')));
    if not found then raise exception 'invalid team code'; end if;
    -- Serialize joins with other session mutations and concurrent devices.
    select * into v_session from public.game_sessions
     where id=v_team.session_id for update;
    if not found then raise exception 'invalid team code'; end if;
    if v_session.status='ended' then raise exception 'this game has ended'; end if;
    v_pool_name := 'team-access:' || v_team.id::text;
    select * into v_member from public.team_members m
     where m.team_id=v_team.id and m.name=v_pool_name for update;
    if not found then
        insert into public.team_members(team_id,name)
        values(v_team.id,v_pool_name) returning * into v_member;
    else
        update public.team_members m set last_seen_at=now() where m.id=v_member.id;
    end if;
    return query select v_member.id,v_member.token,v_team.id,v_team.name,
        v_session.id,v_session.name,v_session.room_code,v_session.status;
end $$;
revoke all on function public.join_team(text,text) from public,anon,authenticated;
grant execute on function public.join_team(text,text) to service_role;
