-- Canonical content: challenges/challenges.md. Reference objects uploaded separately.
-- Safe to rerun: never changes a session that already has challenge content.
do $$
declare
    v_session uuid;
begin
    select id into v_session from public.game_sessions where room_code = '95Q2X3' for update;
    if v_session is null then
        raise exception 'Game2 session 95Q2X3 not found';
    end if;
    if exists (select 1 from public.challenges where session_id = v_session) then
        raise notice 'Session already has challenges; seed skipped';
        return;
    end if;
    insert into public.challenges
        (session_id, title, location_area, completion_condition, clue_tier, sort_order, image_path)
    values
        (v_session, 'Going Bananas', 'Anywhere', 'Find a banana tree and, as a group, eat a banana beneath it.', 'tier1', 1, null),
        (v_session, 'Strava-geddon', 'Marina Barrage', 'Run the Marina Barrage loop from one end point to another and record the run on Strava. Submit a screenshot of the Strava activity.', 'tier3', 2, v_session::text || '/challenge2.jpg'),
        (v_session, 'Colour Chromacronym', 'Anywhere', 'Pick a colour, then find items whose names spell it out as an acronym (BLUE = Balloon, Lunch box, Underwear, Elephant). Photograph the items together.', 'tier2', 3, null),
        (v_session, 'Burp-apella', 'Anywhere', 'Burp the alphabet, or perform a camp verse, on video.', 'tier1', 4, null),
        (v_session, 'Chilli Sommelier', 'Anywhere', 'As a team, each eat one chilli padi and drink nothing for 2 minutes, then describe the tasting notes on video.', 'tier2', 5, null),
        (v_session, 'Money Grows on Trees', 'Singapore Botanic Gardens', 'Find and photograph the tree featured on the back of the $5 note.', 'tier3', 6, null),
        (v_session, 'Shophouse of Cards', 'Any shophouse row', 'Build a house of cards in front of a shophouse. The photo must show the standing tower and the shophouse frontage.', 'tier1', 7, null),
        (v_session, 'Egg-istential Crisis', 'Anywhere', 'Cook a raw egg and eat it. Every team member must eat some.', 'tier3', 8, null),
        (v_session, 'Breed Bingo', 'Anywhere', 'Snap photos of 5 different dog breeds.', 'tier2', 9, null),
        (v_session, 'Ketchup Allegiance', 'Anywhere', 'Find a red wall, smear your face with ketchup, and recite the pledge on video.', 'tier1', 10, null),
        (v_session, 'Opportunity Knocks', 'Any museum', 'Enter a museum and find the word "opportunity". Photograph it.', 'tier2', 11, null),
        (v_session, 'Hotdog High-Rise', 'Any HDB block', 'Climb to level 10 of an HDB block and eat 10 hotdogs.', 'tier3', 12, null),
        (v_session, 'Copy-Pose', 'Landmark for your allocated station', 'Recreate the pose in the reference photo as a group. Raise the difficulty by doing it in front of the landmark for your allocated station.', 'tier1', 13, v_session::text || '/challenge13.jpg'),
        (v_session, 'Exact Change ($4.55)', 'Any mall', 'Pick a mall and find an item that costs exactly $4.55. The photo must show the item and its price tag.', 'tier2', 14, null),
        (v_session, 'Tourist Trifecta', 'Merlion Park, Supertrees, Chinatown', 'Be a tourist for the day: take a photo at the Merlion, at the Supertrees, and in Chinatown. All three in one submission.', 'tier3', 15, null),
        (v_session, 'December Radar', 'Anywhere', 'Sing Happy Birthday to a stranger who was born in December. Video proof plus confirmation of their birth month.', 'tier2', 16, null),
        (v_session, 'Stonehenge', 'Anywhere', 'Build a rock statue using 8 rocks. Photo proof.', 'tier1', 17, null),
        (v_session, 'Boy Throb Bootcamp', 'Anywhere', 'Learn a @boy.throb choreography and replicate the dance exactly on video.', 'tier1', 18, null),
        (v_session, 'No Paddles Allowed', 'Any ping pong table', 'Find a ping pong table and rally the ball as a team, each member hitting it once with a different item. Paddles are not allowed.', 'tier2', 19, null),
        (v_session, 'Human Cargo', 'Between two MRT stations', 'As a team, carry one member from one MRT station to another. Every team member must be touching the person being carried. One leader may walk alongside to film but must not help carry.', 'tier3', 20, null),
        (v_session, 'Manicure Mayhem', 'Anywhere', 'Buy a bottle of nail polish and have every team member paint the nails of your right hand.', 'tier1', 21, null),
        (v_session, 'Squat Squad', 'Anywhere', 'As a team, complete 100 squats and drink 2 litres of milk. Video proof.', 'tier2', 22, null),
        (v_session, 'Call Me Maybe', 'Any surviving payphone', 'Find a payphone and make a call to Sean at {{phone}}. Photo of the payphone in use.', 'tier3', 23, null),
        (v_session, 'Trial by Rival', 'Anywhere', 'Challenge another team to a head-to-head and submit photo or video proof of the result.', 'tier1', 24, null),
        (v_session, 'Ninja Snap', 'Anywhere', 'Photograph another group without being spotted. If you are spotted, delete the photo and try again.', 'tier2', 25, null),
        (v_session, 'One-Word Wonder', 'Any McDonald''s', 'Choose 2 members to taste-test the McAirLandSea and describe the taste in one word. The team gets 5 attempts to say the same word. You may swap tasters between attempts, but the attempt count does not reset.', 'tier1', 26, null),
        (v_session, 'Blindfold Sundae', 'Any ice cream cart', 'Find an ice cream uncle, pick one team member, buy 3 flavours, and have them identify all 3 blindfolded.', 'tier2', 27, null),
        (v_session, 'Squirrel Safari', 'Anywhere', 'Find and film a Finlayson''s squirrel.', 'tier2', 28, null),
        (v_session, 'BA in the Wild', 'Anywhere', 'Find a person from BA in the wild and take a photo with them in person. SEED leaders, partners, parents and church staff do not count. You may call them first, but the photo must be taken in person.', 'tier2', 29, null);
end;
$$;
