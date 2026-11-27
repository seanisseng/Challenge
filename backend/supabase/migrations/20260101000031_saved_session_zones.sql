-- Save independent zone defaults in the same transaction as session creation,
-- including installations whose older column defaults are absent or null.
-- Explicitly supplied plans are retained; existing sessions are unchanged.
create or replace function public.tg_save_session_zones()
returns trigger language plpgsql set search_path=public as $$
begin
    new.playing_area=coalesce(new.playing_area,'{"stages":[{"lat":1.3108674745426903,"lng":103.86352181175857,"radius_m":7000,"after_seconds":0},{"lat":1.3068510731577212,"lng":103.87861641999885,"radius_m":5000,"after_seconds":3600},{"lat":1.3028346717727521,"lng":103.89371102823912,"radius_m":3000,"after_seconds":7200}]}'::jsonb);
    new.final_destination=coalesce(new.final_destination,'{"lat":1.2993920420142073,"lng":103.90664926387365}'::jsonb);
    return new;
end $$;
revoke all on function public.tg_save_session_zones() from public,anon,authenticated;
create trigger game_sessions_save_zones before insert on public.game_sessions
    for each row execute function public.tg_save_session_zones();

-- Manual shrinking is independent of starting either the game or countdown.
-- Keep the session lock, stage limits, paused clock and timer-seek behavior.
create or replace function public.shrink_map_area(p_session_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; current_stage integer; timed_stage integer; elapsed double precision; position integer;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.status not in ('lobby','active') or s.playing_area is null then raise exception 'Configure the map in a lobby or active game first'; end if;
    elapsed=case when s.map_started_at is null then 0 else greatest(0,extract(epoch from coalesce(s.map_paused_at,clock_timestamp())-s.map_started_at)) end;
    select coalesce(max(ordinality::integer-1),0) into timed_stage
        from jsonb_array_elements(s.playing_area->'stages') with ordinality
        where (value->>'after_seconds')::integer<=elapsed;
    current_stage=greatest(s.map_stage_floor,timed_stage);
    if current_stage>=jsonb_array_length(s.playing_area->'stages')-1 then raise exception 'The smallest playing area is already active'; end if;
    position=(s.playing_area->'stages'->(current_stage+1)->>'after_seconds')::integer;
    update public.game_sessions set map_stage_floor=current_stage+1,
        map_started_at=case when map_started_at is not null and position is not null
            then coalesce(map_paused_at,clock_timestamp())-make_interval(secs=>position) else map_started_at end where id=p_session_id;
    return current_stage+1;
end $$;
revoke all on function public.shrink_map_area(uuid) from public,anon,authenticated;
grant execute on function public.shrink_map_area(uuid) to service_role;
