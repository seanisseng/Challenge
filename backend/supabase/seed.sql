-- ===========================================================================
-- seed.sql  -  demo data (optional)
-- NOT applied to the hosted project. Run it by hand against a throwaway
-- database if you want a pre-populated game to click through.
--
-- There are no auth users any more: a session is created by the RPC, which
-- also mints one join code per team. The final SELECT prints those codes -
-- hand them out and play.
--
-- Includes the AGENTS.md banana-tree example across all three clue tiers.
-- ===========================================================================

do $$
declare
    v_session uuid;
    v_room    text;
begin
    if exists (
        select 1 from public.game_sessions where name = 'Sunset City Hunt'
    ) then
        raise notice 'demo session already exists - nothing to do';
        return;
    end if;

    select session_id, room_code
      into v_session, v_room
      from public.create_session('Sunset City Hunt', 3, 6);

    -- --- clues: two per tier ------------------------------------------------
    insert into public.clues (session_id, tier, title, body, sort_order)
    values
        (v_session, 'tier1', 'Head for the water',
         'The final spot is within a kilometre of the river. Start walking that way.', 0),
        (v_session, 'tier1', 'Older half',
         'You are looking at the older half of the city - stone, not glass.', 1),

        (v_session, 'tier2', 'The clock tower',
         'Stand where you can see the clock tower, then look south.', 0),
        (v_session, 'tier2', 'Tram line 4',
         'Follow tram line 4 two stops past the market hall.', 1),

        (v_session, 'tier3', 'Almost there',
         'Look for the green door opposite the bakery on Kerkstraat.', 0),
        (v_session, 'tier3', 'Exact spot',
         'The bench under the third plane tree on the east side of the square.', 1);

    -- --- challenges: linked to clues only through clue_tier -----------------
    insert into public.challenges
        (session_id, title, location_area, completion_condition, clue_tier, sort_order)
    values
        (v_session, 'Banana tree selfie', 'Riverside park',
         'Find a banana tree and eat a banana as a group beneath it.', 'tier1', 0),
        (v_session, 'Bridge group photo', 'Any canal bridge',
         'Get all four of your team members onto one bridge and photograph the group.', 'tier1', 1),
        (v_session, 'Local coffee', 'Old market district',
         'Order a coffee in the local language and photograph the receipt.', 'tier1', 2),
        (v_session, 'Blue door', 'Old town',
         'Photograph a blue front door with its house number visible.', 'tier2', 3),
        (v_session, 'Street musician', 'Central square',
         'Record a ten second clip of a street performer playing live.', 'tier2', 4),
        (v_session, 'Tram selfie', 'Tram line 4',
         'Take a selfie inside tram line 4 with the route map in frame.', 'tier2', 5),
        (v_session, 'Clock tower from below', 'Clock tower square',
         'Shoot the clock tower from directly beneath it, showing the time.', 'tier3', 6),
        (v_session, 'Final bench', 'Final destination',
         'Sit on the bench under the third plane tree and take a group photo.', 'tier3', 7);

    -- --- put the opening board live ----------------------------------------
    perform public.refill_board(v_session);

    raise notice 'Created session % with room code %', v_session, v_room;
end $$;

-- Print the join codes so they can be handed out.
select t.name as team, t.join_code
  from public.teams t
  join public.game_sessions gs on gs.id = t.session_id
 where gs.name = 'Sunset City Hunt'
 order by t.name;
