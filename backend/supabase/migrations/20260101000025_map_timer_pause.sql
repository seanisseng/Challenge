-- Persist pause state so all devices and restarted servers use the same clock.
alter table public.game_sessions add column if not exists map_paused_at timestamptz;

-- The shared countdown remains an absolute server timestamp. Seeking updates
-- that timestamp and the manual stage floor together under the session lock.
create or replace function public.seek_map_timer(p_session_id uuid,p_elapsed_seconds integer)
returns void language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; duration integer; stage integer;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.status<>'active' or s.playing_area is null or s.map_started_at is null then
        raise exception 'Start the shrink countdown before adjusting its position';
    end if;
    select coalesce(max((value->>'after_seconds')::integer),0) into duration
        from jsonb_array_elements(s.playing_area->'stages');
    if p_elapsed_seconds is null or p_elapsed_seconds<0 or p_elapsed_seconds>duration or duration=0 then
        raise exception 'Timer position is outside the scheduled stages';
    end if;
    select coalesce(max(ordinality::integer-1),0) into stage
        from jsonb_array_elements(s.playing_area->'stages') with ordinality
        where (value->>'after_seconds')::integer<=p_elapsed_seconds;
    update public.game_sessions set
        map_started_at=coalesce(map_paused_at,clock_timestamp())-make_interval(secs=>p_elapsed_seconds),
        map_stage_floor=stage where id=p_session_id;
end $$;
revoke all on function public.seek_map_timer(uuid,integer) from public,anon,authenticated;
grant execute on function public.seek_map_timer(uuid,integer) to service_role;

create or replace function public.set_map_timer(p_session_id uuid,p_start boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; position integer;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if p_start and (s.status<>'active' or s.playing_area is null) then raise exception 'Configure the map and start the game first'; end if;
    position=coalesce((s.playing_area->'stages'->s.map_stage_floor->>'after_seconds')::integer,0);
    update public.game_sessions set
        map_started_at=case when p_start then coalesce(map_started_at,clock_timestamp()-make_interval(secs=>position)) else null end,
        map_stage_floor=case when p_start then map_stage_floor else 0 end,
        map_paused_at=case when p_start then map_paused_at else null end where id=p_session_id;
end $$;

create or replace function public.shrink_map_area(p_session_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; current_stage integer; timed_stage integer; elapsed double precision; position integer;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.status<>'active' or s.playing_area is null then raise exception 'Configure the map and start the game first'; end if;
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
-- Replacements retain the existing service-role-only execute grants.

create or replace function public.pause_map_timer(p_session_id uuid,p_pause boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s public.game_sessions;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.status<>'active' or s.map_started_at is null then
        raise exception 'Start the shrink countdown before pausing or resuming';
    end if;
    if p_pause and s.map_paused_at is null then
        update public.game_sessions set map_paused_at=clock_timestamp() where id=p_session_id;
    elsif not p_pause and s.map_paused_at is not null then
        update public.game_sessions set map_started_at=map_started_at+(clock_timestamp()-map_paused_at),
            map_paused_at=null where id=p_session_id;
    end if;
end $$;
revoke all on function public.pause_map_timer(uuid,boolean) from public,anon,authenticated;
grant execute on function public.pause_map_timer(uuid,boolean) to service_role;
