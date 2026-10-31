-- ===========================================================================
-- 20260101000010_drop_legacy_auth_functions.sql
-- Remove the auth-based functions superseded by 20260101000009_team_codes.sql.
--
-- `create or replace` only replaces a function with an identical signature, so
-- the old auth-flavoured versions survived as dead overloads. They reference
-- auth.uid() and a teams.user_id column that no longer exists.
-- ===========================================================================

drop function if exists public.join_session(text, text);
drop function if exists public.submit_proof(uuid, text, text);

-- Belt and braces: nothing outside service_role may call any of these.
revoke all on function public.create_session(text, integer, integer, text) from anon, authenticated, public;
revoke all on function public.join_team(text, text)                        from anon, authenticated, public;
revoke all on function public.submit_proof(uuid, uuid, uuid, text, text)   from anon, authenticated, public;
revoke all on function public.approve_submission(uuid, text)               from anon, authenticated, public;
revoke all on function public.reject_submission(uuid, text)                from anon, authenticated, public;
revoke all on function public.refill_board(uuid)                           from anon, authenticated, public;
revoke all on function public.generate_join_code()                         from anon, authenticated, public;

grant execute on function public.create_session(text, integer, integer, text) to service_role;
grant execute on function public.join_team(text, text)                        to service_role;
grant execute on function public.submit_proof(uuid, uuid, uuid, text, text)   to service_role;
grant execute on function public.approve_submission(uuid, text)               to service_role;
grant execute on function public.reject_submission(uuid, text)                to service_role;
grant execute on function public.refill_board(uuid)                           to service_role;
grant execute on function public.generate_join_code()                         to service_role;
