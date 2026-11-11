-- ===========================================================================
-- 20260101000008_hardening.sql
-- Tighten EXECUTE grants on the public API surface.
--
-- By default Postgres grants EXECUTE on new functions to PUBLIC, which on
-- Supabase means the `anon` role can reach them over /rest/v1/rpc/*. Every
-- RPC here re-checks identity internally, but there is no reason to expose
-- them to browser callers at all. Restrict to the backend service_role.
-- ===========================================================================

-- --- Helpers ---------------------------------------------------------------
revoke execute on function public.is_admin()            from anon, authenticated, public;
revoke execute on function public.current_team_id()     from anon, authenticated, public;
revoke execute on function public.current_session_id()  from anon, authenticated, public;

grant execute on function public.is_admin()            to service_role;
grant execute on function public.current_team_id()     to service_role;
grant execute on function public.current_session_id()  to service_role;

-- --- RPCs ------------------------------------------------------------------
revoke execute on function public.join_session(text, text)       from anon, authenticated, public;
revoke execute on function public.submit_proof(uuid, text, text) from anon, authenticated, public;
revoke execute on function public.approve_submission(uuid, text) from anon, authenticated, public;
revoke execute on function public.reject_submission(uuid, text)  from anon, authenticated, public;
revoke execute on function public.refill_board(uuid)             from anon, authenticated, public;

grant execute on function public.join_session(text, text)       to service_role;
grant execute on function public.submit_proof(uuid, text, text) to service_role;
grant execute on function public.approve_submission(uuid, text) to service_role;
grant execute on function public.reject_submission(uuid, text)  to service_role;
grant execute on function public.refill_board(uuid)             to service_role;

-- --- Trigger helpers: pin the search_path ----------------------------------
-- Trigger functions do not need a caller-facing EXECUTE grant either, and a
-- mutable search_path is a privilege-escalation footgun.
revoke execute on function public.tg_set_updated_at()          from anon, authenticated, public;
revoke execute on function public.tg_submission_before_insert() from anon, authenticated, public;

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
