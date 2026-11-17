-- Private host plan and expiring, opt-in device fixes. No location history.
alter table public.game_sessions add column playing_area jsonb;
alter table public.game_sessions add column map_started_at timestamptz;
alter table public.game_sessions add column map_stage_floor integer not null default 0 check(map_stage_floor between 0 and 11);
create sequence public.map_location_revision_seq;
create table public.map_location_shares (
    session_id uuid not null references public.game_sessions(id) on delete cascade,
    team_id uuid not null references public.teams(id) on delete cascade,
    device_id uuid not null,
    lease uuid not null default gen_random_uuid(),
    lat double precision check(lat between -85 and 85),
    lng double precision check(lng between -180 and 180),
    accuracy_m double precision check(accuracy_m between 0 and 100000),
    updated_at timestamptz,
    revision bigint not null default nextval('public.map_location_revision_seq'),
    primary key(team_id,device_id),
    check ((lat is null and lng is null) or (lat is not null and lng is not null))
);
create index map_location_session_idx on public.map_location_shares(session_id);
alter table public.map_location_shares enable row level security;
revoke all on public.map_location_shares from public,anon,authenticated;
revoke all on sequence public.map_location_revision_seq from public,anon,authenticated;
grant all on public.map_location_shares to service_role;
grant all on sequence public.map_location_revision_seq to service_role;

create or replace function public.configure_playing_area(p_session_id uuid,p_plan jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare s public.game_sessions;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.map_started_at is not null or s.map_stage_floor>0 then raise exception 'Reset the shrink timer before editing the plan'; end if;
    if jsonb_typeof(p_plan->'stages')<>'array' or jsonb_array_length(p_plan->'stages') not between 1 and 12 then raise exception 'invalid playing area plan'; end if;
    update public.game_sessions set playing_area=p_plan-'finish',final_destination=p_plan->'finish' where id=p_session_id;
end $$;
create or replace function public.set_map_timer(p_session_id uuid,p_start boolean)
returns void language plpgsql security definer set search_path=public as $$
declare s public.game_sessions;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if p_start and (s.status<>'active' or s.playing_area is null) then raise exception 'Configure the map and start the game first'; end if;
    update public.game_sessions set map_started_at=case when p_start then coalesce(map_started_at,now()) else null end,
        map_stage_floor=case when p_start then map_stage_floor else 0 end where id=p_session_id;
end $$;
create or replace function public.shrink_map_area(p_session_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; current_stage integer; timed_stage integer; elapsed double precision;
begin
    select * into s from public.game_sessions where id=p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if s.status<>'active' or s.playing_area is null then raise exception 'Configure the map and start the game first'; end if;
    elapsed=case when s.map_started_at is null then 0 else greatest(0,extract(epoch from clock_timestamp()-s.map_started_at)) end;
    select coalesce(max(ordinality::integer-1),0) into timed_stage
      from jsonb_array_elements(s.playing_area->'stages') with ordinality
      where (value->>'after_seconds')::integer<=elapsed;
    current_stage=greatest(s.map_stage_floor,timed_stage);
    if current_stage>=jsonb_array_length(s.playing_area->'stages')-1 then raise exception 'The smallest playing area is already active'; end if;
    update public.game_sessions set map_stage_floor=current_stage+1 where id=p_session_id;
    return current_stage+1;
end $$;
revoke all on function public.shrink_map_area(uuid) from public,anon,authenticated;
grant execute on function public.shrink_map_area(uuid) to service_role;
create or replace function public.start_location_share(p_team_id uuid,p_device_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.game_sessions; r public.map_location_shares;
begin
    select gs.* into s from public.game_sessions gs join public.teams t on t.session_id=gs.id where t.id=p_team_id for update of gs;
    if not found or s.status<>'active' or s.playing_area is null then raise exception 'Location sharing is available during a configured active game'; end if;
    insert into public.map_location_shares(session_id,team_id,device_id)
    values(s.id,p_team_id,p_device_id)
    on conflict(team_id,device_id) do update set lease=gen_random_uuid(),lat=null,lng=null,accuracy_m=null,updated_at=null,revision=nextval('public.map_location_revision_seq')
    returning * into r;
    return jsonb_build_object('lease',r.lease,'revision',r.revision);
end $$;
create or replace function public.update_map_location(p_team_id uuid,p_device_id uuid,p_lease uuid,p_lat double precision,p_lng double precision,p_accuracy_m double precision)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.map_location_shares;
begin
    update public.map_location_shares l set lat=p_lat,lng=p_lng,accuracy_m=p_accuracy_m,updated_at=clock_timestamp(),revision=nextval('public.map_location_revision_seq')
     where l.team_id=p_team_id and l.device_id=p_device_id and l.lease=p_lease
       and exists(select 1 from public.game_sessions s where s.id=l.session_id and s.status='active') returning l.* into r;
    if not found then raise exception 'Location sharing has stopped; start sharing again'; end if;
    return jsonb_build_object('team_id',r.team_id,'device_id',r.device_id,'lat',r.lat,'lng',r.lng,'accuracy_m',r.accuracy_m,'updated_at',r.updated_at,'revision',r.revision);
end $$;
create or replace function public.stop_location_share(p_team_id uuid,p_device_id uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.map_location_shares;
begin
    delete from public.map_location_shares where team_id=p_team_id and device_id=p_device_id and lease=p_lease returning * into r;
    if not found then return null; end if;
    return jsonb_build_object('team_id',r.team_id,'device_id',r.device_id,'revision',nextval('public.map_location_revision_seq'));
end $$;
create or replace function public.expire_map_locations()
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
    with expired as (
        update public.map_location_shares set lat=null,lng=null,accuracy_m=null,updated_at=null,revision=nextval('public.map_location_revision_seq')
        where updated_at<now()-interval '2 minutes' returning session_id,team_id,device_id,revision
    ) select coalesce(jsonb_agg(to_jsonb(expired)),'[]'::jsonb) into result from expired;
    return result;
end $$;
create or replace function public.tg_clear_game_locations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
    if new.status='ended' then delete from public.map_location_shares where session_id=new.id; end if;
    return new;
end $$;
create trigger game_sessions_clear_locations after update of status on public.game_sessions
    for each row when(new.status='ended') execute function public.tg_clear_game_locations();
revoke all on function public.tg_clear_game_locations() from public,anon,authenticated;
revoke all on function public.configure_playing_area(uuid,jsonb),public.set_map_timer(uuid,boolean),public.start_location_share(uuid,uuid),public.update_map_location(uuid,uuid,uuid,double precision,double precision,double precision),public.stop_location_share(uuid,uuid,uuid),public.expire_map_locations() from public,anon,authenticated;
grant execute on function public.configure_playing_area(uuid,jsonb),public.set_map_timer(uuid,boolean),public.start_location_share(uuid,uuid),public.update_map_location(uuid,uuid,uuid,double precision,double precision,double precision),public.stop_location_share(uuid,uuid,uuid),public.expire_map_locations() to service_role;

-- Defaults apply to future inserts only. Existing games are not backfilled.
alter table public.game_sessions alter column playing_area set default '{"stages": [{"lat": 1.3108674745426903, "lng": 103.86352181175857, "radius_m": 7000, "after_seconds": 0}, {"lat": 1.3068510731577212, "lng": 103.87861641999885, "radius_m": 5000, "after_seconds": null}, {"lat": 1.3028346717727521, "lng": 103.89371102823912, "radius_m": 3000, "after_seconds": null}]}'::jsonb;
alter table public.game_sessions alter column final_destination set default '{"lat": 1.2993920420142073, "lng": 103.90664926387365}'::jsonb;
