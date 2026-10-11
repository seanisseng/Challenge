-- ===========================================================================
-- 20260101000004_rls_policies.sql
-- Row Level Security. Teams see only their own session, their own submissions
-- and their own unlocked clues; Admins see and manage everything. All writes
-- that must be atomic go through SECURITY DEFINER RPCs (see the next file).
-- ===========================================================================

alter table public.admin_users       enable row level security;
alter table public.game_sessions     enable row level security;
alter table public.teams             enable row level security;
alter table public.clues             enable row level security;
alter table public.challenges        enable row level security;
alter table public.submissions       enable row level security;
alter table public.team_clues        enable row level security;
alter table public.submission_events enable row level security;

-- --- admin_users -----------------------------------------------------------
create policy admin_users_select_admin
    on public.admin_users for select to authenticated
    using (public.is_admin());

-- --- game_sessions ---------------------------------------------------------
create policy game_sessions_select_member
    on public.game_sessions for select to authenticated
    using (public.is_admin() or id = public.current_session_id());

create policy game_sessions_write_admin
    on public.game_sessions for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- --- teams -----------------------------------------------------------------
create policy teams_select_session
    on public.teams for select to authenticated
    using (public.is_admin() or session_id = public.current_session_id());

create policy teams_insert_self
    on public.teams for insert to authenticated
    with check (public.is_admin() or user_id = auth.uid());

create policy teams_update_self
    on public.teams for update to authenticated
    using (public.is_admin() or user_id = auth.uid())
    with check (public.is_admin() or user_id = auth.uid());

create policy teams_delete_admin
    on public.teams for delete to authenticated
    using (public.is_admin());

-- --- clues -----------------------------------------------------------------
-- A team only ever sees clues it has unlocked.
create policy clues_select_unlocked
    on public.clues for select to authenticated
    using (
        public.is_admin()
        or exists (
            select 1 from public.team_clues tc
             where tc.clue_id = clues.id
               and tc.team_id = public.current_team_id()
        )
    );

create policy clues_write_admin
    on public.clues for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- --- challenges ------------------------------------------------------------
-- Teams read the live board of their session (active challenges, including the
-- ones currently claimed/locked). Admins see the whole pool.
create policy challenges_select_board
    on public.challenges for select to authenticated
    using (
        public.is_admin()
        or (session_id = public.current_session_id() and is_active)
    );

create policy challenges_write_admin
    on public.challenges for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- --- submissions -----------------------------------------------------------
create policy submissions_select_own
    on public.submissions for select to authenticated
    using (public.is_admin() or team_id = public.current_team_id());

create policy submissions_insert_own
    on public.submissions for insert to authenticated
    with check (
        public.is_admin()
        or (team_id = public.current_team_id() and session_id = public.current_session_id())
    );

create policy submissions_update_admin
    on public.submissions for update to authenticated
    using (public.is_admin())
    with check (public.is_admin());

create policy submissions_delete_admin
    on public.submissions for delete to authenticated
    using (public.is_admin());

-- --- team_clues ------------------------------------------------------------
create policy team_clues_select_own
    on public.team_clues for select to authenticated
    using (public.is_admin() or team_id = public.current_team_id());

create policy team_clues_write_admin
    on public.team_clues for all to authenticated
    using (public.is_admin())
    with check (public.is_admin());

-- --- submission_events -----------------------------------------------------
create policy submission_events_select_own
    on public.submission_events for select to authenticated
    using (
        public.is_admin()
        or exists (
            select 1 from public.submissions s
             where s.id = submission_events.submission_id
               and s.team_id = public.current_team_id()
        )
    );

create policy submission_events_insert_admin
    on public.submission_events for insert to authenticated
    with check (public.is_admin());
