-- ===========================================================================
-- 20260101000012_member_name_case_insensitive.sql
-- Player names must be unique per team regardless of case, otherwise "Alice"
-- and "alice" can both join the same team and nobody knows who is who on the
-- shared board.
-- ===========================================================================

alter table public.team_members drop constraint if exists team_members_name_unique;

create unique index if not exists team_members_team_lower_name_unique
    on public.team_members (team_id, lower(name));
