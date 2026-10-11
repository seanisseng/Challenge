-- ===========================================================================
-- seed.sql  —  demo data for local development
-- Applied automatically by `supabase db reset` after the migrations.
--
-- Includes the AGENTS.md banana-tree example and exercises every challenge
-- status (open / pending_approval / claimed).
--
-- Seeded auth users share the password: password123
-- ===========================================================================

-- --- Auth users (Admins + Teams) -------------------------------------------
-- Minimal auth.users rows so the FK relationships resolve. Passwords are hashed
-- with bcrypt via pgcrypto.
insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, is_sso_user, is_anonymous
)
values
    ('00000000-0000-0000-0000-000000000000',
     '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated',
     'admin@example.com', crypt('password123', gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Game Master"}',
     now(), now(), false, false),
    ('00000000-0000-0000-0000-000000000000',
     '00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated',
     'moderator@example.com', crypt('password123', gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Moderator"}',
     now(), now(), false, false),
    ('00000000-0000-0000-0000-000000000000',
     '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
     'banana@example.com', crypt('password123', gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Team Banana"}',
     now(), now(), false, false),
    ('00000000-0000-0000-0000-000000000000',
     '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
     'falcon@example.com', crypt('password123', gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Team Falcon"}',
     now(), now(), false, false),
    ('00000000-0000-0000-0000-000000000000',
     '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
     'compass@example.com', crypt('password123', gen_salt('bf')),
     now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Team Compass"}',
     now(), now(), false, false)
on conflict (id) do nothing;

-- --- Admins -----------------------------------------------------------------
insert into public.admin_users (user_id, display_name) values
    ('00000000-0000-0000-0000-0000000000a1', 'Game Master'),
    ('00000000-0000-0000-0000-0000000000a2', 'Moderator')
on conflict (user_id) do nothing;

-- --- Session ---------------------------------------------------------------
insert into public.game_sessions
    (id, room_code, name, status, active_task_limit, final_destination, created_by, started_at)
values (
    '10000000-0000-0000-0000-000000000001',
    'SUNSET',
    'Sunset City Hunt',
    'active',
    6,
    '{"lat": 1.3521, "lng": 103.8198, "note": "Under the clock tower at Merlion Park."}',
    '00000000-0000-0000-0000-0000000000a1',
    now()
);

-- --- Teams ------------------------------------------------------------------
insert into public.teams (id, session_id, name, user_id) values
    ('21000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Team Banana',  '20000000-0000-0000-0000-000000000001'),
    ('21000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Team Falcon',  '20000000-0000-0000-0000-000000000002'),
    ('21000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Team Compass', '20000000-0000-0000-0000-000000000003');

-- --- Clues (2 per tier) -----------------------------------------------------
insert into public.clues (id, session_id, tier, title, body, sort_order) values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'tier1',
     'Macro Direction — Riverside', 'Head toward the historic riverside district, north of the old market.', 1),
    ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'tier1',
     'Macro Direction — The Hills', 'The destination sits on the western edge, where the city meets the green hills.', 2),
    ('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'tier2',
     'Landmark Anchor — Old Clock', 'Look for the intersection near the 19th-century clock tower.', 1),
    ('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'tier2',
     'Landmark Anchor — Red Bridge', 'Cross the canal at the red iron footbridge beside the fish market.', 2),
    ('30000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000001', 'tier3',
     'Precision Pin — Coordinates', 'Exact coordinates: 1.3521 N, 103.8198 E.', 1),
    ('30000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000001', 'tier3',
     'Precision Pin — Final Photo', 'Match this close-up photo of the target plaque.', 2);

-- --- Challenges (8: 6 active + 2 in the pool) -------------------------------
insert into public.challenges
    (id, session_id, title, location_area, completion_condition, clue_tier, clue_id, status, is_active, sort_order)
values
    ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
     'Banana Bonanza', 'Botanic Gardens',
     'Find a banana tree and eat a banana as a group beneath it.',
     'tier1', '30000000-0000-0000-0000-000000000001', 'open', true, 1),
    ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     'Skyline Handshake', 'Marina Promenade',
     'Photograph your whole team spelling a word in front of the skyline.',
     'tier1', '30000000-0000-0000-0000-000000000002', 'open', true, 2),
    ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
     'Statue Mimic', 'City Hall Plaza',
     'Recreate the pose of the bronze founder statue.',
     'tier2', '30000000-0000-0000-0000-000000000011', 'open', true, 3),
    ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001',
     'Bridge Selfie', 'Red Iron Footbridge',
     'Take a group selfie standing on the red footbridge.',
     'tier2', '30000000-0000-0000-0000-000000000012', 'open', true, 4),
    ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001',
     'Coordinate Chase', 'Riverside District',
     'Stand exactly on the painted compass rose and point north.',
     'tier3', '30000000-0000-0000-0000-000000000021', 'open', true, 5),
    ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001',
     'Plaque Match', 'Old Clock Tower',
     'Photograph the target plaque exactly as shown in the clue.',
     'tier3', '30000000-0000-0000-0000-000000000022', 'open', true, 6),
    -- pool (not yet live)
    ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001',
     'Market Munch', 'Old Market',
     'Buy and share a local snack with a stranger.',
     'tier1', '30000000-0000-0000-0000-000000000001', 'open', false, 7),
    ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001',
     'Clock Face', 'Old Clock Tower',
     'Photograph the clock face showing a time that matches the current minute.',
     'tier2', '30000000-0000-0000-0000-000000000011', 'open', false, 8);

-- --- Submissions ------------------------------------------------------------
-- Winning claim: Team Banana's tier-3 "Plaque Match" was approved.
insert into public.submissions
    (id, session_id, challenge_id, team_id, photo_path, status, reviewed_by, review_note, submitted_at, reviewed_at)
values
    ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-000000000006', '21000000-0000-0000-0000-000000000001',
     '10000000-0000-0000-0000-000000000001/21000000-0000-0000-0000-000000000001/plaque.jpg',
     'approved', '00000000-0000-0000-0000-0000000000a1', 'Spot on matching angle!', now() - interval '10 minutes', now() - interval '8 minutes');

-- A live race: Team Compass is pending on "Statue Mimic".
insert into public.submissions
    (id, session_id, challenge_id, team_id, photo_path, status, submitted_at)
values
    ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     '40000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000003',
     '10000000-0000-0000-0000-000000000001/21000000-0000-0000-0000-000000000003/statue.jpg',
     'pending', now() - interval '3 minutes');

-- --- Apply the outcome of the approved submission ---------------------------
-- (mirrors what approve_submission() does, since we bypassed the RPC here.)
update public.challenges
   set status = 'claimed', claimed_by_team_id = '21000000-0000-0000-0000-000000000001'
 where id = '40000000-0000-0000-0000-000000000006';

-- Team Banana unlocked the tier-3 "Plaque Match" clue.
insert into public.team_clues (id, team_id, clue_id, challenge_id) values
    ('60000000-0000-0000-0000-000000000001',
     '21000000-0000-0000-0000-000000000001',
     '30000000-0000-0000-0000-000000000022',
     '40000000-0000-0000-0000-000000000006');

-- The pending submission flipped its challenge to pending_approval (trigger).
-- (challenge 40000000-...-03 is now pending_approval.)

-- --- Audit trail ------------------------------------------------------------
insert into public.submission_events (submission_id, event, actor_id, note) values
    ('50000000-0000-0000-0000-000000000001', 'submitted', '20000000-0000-0000-0000-000000000001', null),
    ('50000000-0000-0000-0000-000000000001', 'approved', '00000000-0000-0000-0000-0000000000a1', 'Spot on matching angle!'),
    ('50000000-0000-0000-0000-000000000002', 'submitted', '20000000-0000-0000-0000-000000000003', null);
