-- ===========================================================================
-- 20260101000003_helpers.sql
-- Identity helper functions used throughout the RLS policies and RPCs.
--
-- All are SECURITY DEFINER and owned by a privileged role, so they read the
-- base tables directly and never recurse through RLS.
-- ===========================================================================

-- Is the caller an Admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.admin_users where user_id = auth.uid()
    );
$$;

-- The team owned by the calling auth user (one team per user).
create or replace function public.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select id from public.teams where user_id = auth.uid() limit 1;
$$;

-- The session the calling user's team belongs to.
create or replace function public.current_session_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select session_id from public.teams where user_id = auth.uid() limit 1;
$$;

grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.current_team_id() to anon, authenticated;
grant execute on function public.current_session_id() to anon, authenticated;
