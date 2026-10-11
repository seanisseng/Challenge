-- ===========================================================================
-- 20260101000007_realtime.sql
-- Publish the live-board tables on Supabase Realtime so teams' dashboards
-- update instantly when a challenge is claimed or a clue is unlocked.
--
-- Realtime honours RLS: a subscriber only receives rows their policies allow
-- them to SELECT (their session's board, their own submissions/clues).
-- ===========================================================================

-- Full row images so clients can react to status transitions (old -> new).
alter table public.challenges    replica identity full;
alter table public.teams         replica identity full;
alter table public.submissions   replica identity full;
alter table public.team_clues    replica identity full;

do $$
begin
    alter publication supabase_realtime add table public.challenges;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.teams;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.submissions;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.team_clues;
exception when duplicate_object then null;
end $$;
