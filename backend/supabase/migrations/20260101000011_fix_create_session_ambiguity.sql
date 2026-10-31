-- ===========================================================================
-- 20260101000011_fix_create_session_ambiguity.sql
-- `create_session` declares an OUT parameter named `room_code`, which collides
-- with `game_sessions.room_code` inside the room-code uniqueness probe:
--
--   ERROR 42702: column reference "room_code" is ambiguous
--
-- Qualify the table reference with an alias. 20260101000009 has been corrected
-- so a fresh database never hits this.
-- ===========================================================================

create or replace function public.create_session(
    p_name              text,
    p_team_count        integer,
    p_active_task_limit integer default 6,
    p_room_code         text default null
)
returns table (session_id uuid, room_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session_id uuid;
    v_room_code  text := nullif(upper(trim(coalesce(p_room_code, ''))), '');
    v_code       text;
    v_i          integer;
begin
    if p_team_count is null or p_team_count < 1 then
        raise exception 'team count must be at least 1';
    end if;
    if p_team_count > 40 then
        raise exception 'team count must be 40 or fewer';
    end if;
    if p_name is null or length(trim(p_name)) = 0 then
        raise exception 'session name is required';
    end if;

    if v_room_code is null then
        loop
            v_code := public.generate_join_code();
            exit when not exists (
                select 1 from public.game_sessions gs where gs.room_code = v_code
            );
        end loop;
        v_room_code := v_code;
    end if;

    insert into public.game_sessions
        (room_code, name, team_count, active_task_limit, status)
    values
        (v_room_code, trim(p_name), p_team_count,
         coalesce(p_active_task_limit, 6), 'lobby')
    returning id into v_session_id;

    for v_i in 1..p_team_count loop
        loop
            v_code := public.generate_join_code();
            begin
                insert into public.teams (session_id, name, join_code)
                values (v_session_id, 'Team ' || v_i, v_code);
                exit;
            exception when unique_violation then
                null;
            end;
        end loop;
    end loop;

    return query select v_session_id, v_room_code;
end;
$$;

revoke all on function public.create_session(text, integer, integer, text)
    from anon, authenticated, public;
grant execute on function public.create_session(text, integer, integer, text)
    to service_role;
