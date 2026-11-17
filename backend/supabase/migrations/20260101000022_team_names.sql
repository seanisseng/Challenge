-- Any authenticated teammate may rename their team through the backend.
create unique index teams_session_lower_name_unique
    on public.teams(session_id,lower(name));

create or replace function public.rename_team(p_team_id uuid,p_name text)
returns text language plpgsql security definer set search_path=public as $$
declare v_session uuid; v_name text := trim(coalesce(p_name,''));
begin
    if length(v_name)=0 then raise exception 'a team name is required'; end if;
    if length(v_name)>40 then raise exception 'team name must be 40 characters or fewer'; end if;
    select session_id into v_session from public.teams where id=p_team_id;
    if not found then raise exception 'team not found'; end if;
    perform id from public.game_sessions where id=v_session for update;
    if exists(select 1 from public.teams t where t.session_id=v_session and t.id<>p_team_id and lower(t.name)=lower(v_name)) then
        raise exception 'another team is already using that name';
    end if;
    update public.teams set name=v_name where id=p_team_id;
    if not found then raise exception 'team not found'; end if;
    return v_name;
end $$;
revoke all on function public.rename_team(uuid,text) from public,anon,authenticated;
grant execute on function public.rename_team(uuid,text) to service_role;
