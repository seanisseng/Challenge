-- Built-in challenge catalog, private admin preview, and atomic queue rotation.
alter table public.game_sessions add column if not exists board_visible boolean not null default false;
update public.game_sessions set board_visible = true where status = 'active';

create table public.challenge_templates (
    sort_order integer primary key,
    title text not null,
    location_area text,
    completion_condition text not null,
    clue_tier public.clue_tier not null,
    image_path text
);
alter table public.challenge_templates enable row level security;
revoke all on public.challenge_templates from public, anon, authenticated;
grant all on public.challenge_templates to service_role;

insert into public.challenge_templates
    (sort_order,title,location_area,completion_condition,clue_tier)
values
    (1, 'Going Bananas', 'Anywhere', 'Find a banana tree and, as a group, eat a banana beneath it.', 'tier1'),
    (2, 'Strava-geddon', 'Marina Barrage', 'Run the Marina Barrage loop from one end point to another and record the run on Strava. Submit a screenshot of the Strava activity.', 'tier3'),
    (3, 'Colour Chromacronym', 'Anywhere', 'Pick a colour, then find items whose names spell it out as an acronym (BLUE = Balloon, Lunch box, Underwear, Elephant). Photograph the items together.', 'tier2'),
    (4, 'Burp-apella', 'Anywhere', 'Burp the alphabet, or perform a camp verse, on video.', 'tier1'),
    (5, 'Chilli Sommelier', 'Anywhere', 'As a team, each eat one chilli padi and drink nothing for 2 minutes, then describe the tasting notes on video.', 'tier2'),
    (6, 'Money Grows on Trees', 'Singapore Botanic Gardens', 'Find and photograph the tree featured on the back of the $5 note.', 'tier3'),
    (7, 'Shophouse of Cards', 'Any shophouse row', 'Build a house of cards in front of a shophouse. The photo must show the standing tower and the shophouse frontage.', 'tier1'),
    (8, 'Egg-istential Crisis', 'Anywhere', 'Cook a raw egg and eat it. Every team member must eat some.', 'tier3'),
    (9, 'Breed Bingo', 'Anywhere', 'Snap photos of 5 different dog breeds.', 'tier2'),
    (10, 'Ketchup Allegiance', 'Anywhere', 'Find a red wall, smear your face with ketchup, and recite the pledge on video.', 'tier1'),
    (11, 'Opportunity Knocks', 'Any museum', 'Enter a museum and find the word "opportunity". Photograph it.', 'tier2'),
    (12, 'Hotdog High-Rise', 'Any HDB block', 'Climb to level 10 of an HDB block and eat 10 hotdogs.', 'tier3'),
    (13, 'Copy-Pose', 'Landmark for your allocated station', 'Recreate the pose in the reference photo as a group. Raise the difficulty by doing it in front of the landmark for your allocated station.', 'tier1'),
    (14, 'Exact Change ($4.55)', 'Any mall', 'Pick a mall and find an item that costs exactly $4.55. The photo must show the item and its price tag.', 'tier2'),
    (15, 'Tourist Trifecta', 'Merlion Park, Supertrees, Chinatown', 'Be a tourist for the day: take a photo at the Merlion, at the Supertrees, and in Chinatown. All three in one submission.', 'tier3'),
    (16, 'December Radar', 'Anywhere', 'Sing Happy Birthday to a stranger who was born in December. Video proof plus confirmation of their birth month.', 'tier2'),
    (17, 'Stonehenge', 'Anywhere', 'Build a rock statue using 8 rocks. Photo proof.', 'tier1'),
    (18, 'Boy Throb Bootcamp', 'Anywhere', 'Learn a @boy.throb choreography and replicate the dance exactly on video.', 'tier1'),
    (19, 'No Paddles Allowed', 'Any ping pong table', 'Find a ping pong table and rally the ball as a team, each member hitting it once with a different item. Paddles are not allowed.', 'tier2'),
    (20, 'Human Cargo', 'Between two MRT stations', 'As a team, carry one member from one MRT station to another. Every team member must be touching the person being carried. One leader may walk alongside to film but must not help carry.', 'tier3'),
    (21, 'Manicure Mayhem', 'Anywhere', 'Buy a bottle of nail polish and have every team member paint the nails of your right hand.', 'tier1'),
    (22, 'Squat Squad', 'Anywhere', 'As a team, complete 100 squats and drink 2 litres of milk. Video proof.', 'tier2'),
    (23, 'Call Me Maybe', 'Any surviving payphone', 'Find a payphone and make a call to Sean at {{phone}}. Photo of the payphone in use.', 'tier3'),
    (24, 'Trial by Rival', 'Anywhere', 'Challenge another team to a head-to-head and submit photo or video proof of the result.', 'tier1'),
    (25, 'Ninja Snap', 'Anywhere', 'Photograph another group without being spotted. If you are spotted, delete the photo and try again.', 'tier2'),
    (26, 'One-Word Wonder', 'Any McDonald''s', 'Choose 2 members to taste-test the McAirLandSea and describe the taste in one word. The team gets 5 attempts to say the same word. You may swap tasters between attempts, but the attempt count does not reset.', 'tier1'),
    (27, 'Blindfold Sundae', 'Any ice cream cart', 'Find an ice cream uncle, pick one team member, buy 3 flavours, and have them identify all 3 blindfolded.', 'tier2'),
    (28, 'Squirrel Safari', 'Anywhere', 'Find and film a Finlayson''s squirrel.', 'tier2'),
    (29, 'BA in the Wild', 'Anywhere', 'Find a person from BA in the wild and take a photo with them in person. SEED leaders, partners, parents and church staff do not count. You may call them first, but the photo must be taken in person.', 'tier2');

-- Reuse the existing public reference assets without copying image bytes.
update public.challenge_templates t set image_path = c.image_path
from public.challenges c join public.game_sessions s on s.id = c.session_id
where s.room_code = '95Q2X3' and c.sort_order = t.sort_order and c.title = t.title
  and c.image_path is not null;

create or replace function public.tg_populate_challenge_board()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.challenges
        (session_id,title,location_area,completion_condition,clue_tier,sort_order,image_path)
    select new.id,title,location_area,completion_condition,clue_tier,sort_order,image_path
      from public.challenge_templates order by sort_order;
    perform public.refill_board(new.id);
    return new;
end;
$$;
revoke all on function public.tg_populate_challenge_board() from public, anon, authenticated;
create trigger game_sessions_populate_board after insert on public.game_sessions
    for each row execute function public.tg_populate_challenge_board();

-- Existing lobbies also get a ready-to-preview board. Preserve custom pools.
do $$
declare v_session public.game_sessions;
begin
    for v_session in select * from public.game_sessions where status = 'lobby' for update loop
        if not exists (select 1 from public.challenges where session_id = v_session.id) then
            insert into public.challenges
                (session_id,title,location_area,completion_condition,clue_tier,sort_order,image_path)
            select v_session.id,title,location_area,completion_condition,clue_tier,sort_order,image_path
              from public.challenge_templates order by sort_order;
        end if;
        perform public.refill_board(v_session.id);
    end loop;
end;
$$;

create or replace function public.set_board_visibility(p_session_id uuid, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_session public.game_sessions;
begin
    if p_visible is null then raise exception 'board visibility is required'; end if;
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if p_visible and v_session.status = 'ended' then raise exception 'this game has ended'; end if;
    if p_visible then
        perform public.refill_board(p_session_id);
        update public.game_sessions set board_visible = true, status = 'active',
            started_at = coalesce(started_at, now()) where id = p_session_id;
    else
        update public.game_sessions set board_visible = false where id = p_session_id;
    end if;
end;
$$;

create or replace function public.defer_challenge(p_session_id uuid, p_challenge_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
    v_session public.game_sessions;
    v_challenge public.challenges;
    v_bottom integer;
begin
    -- Serialize admin queue edits for this room.
    select * into v_session from public.game_sessions where id = p_session_id for update;
    if not found then raise exception 'session not found'; end if;
    if v_session.status = 'ended' then raise exception 'this game has ended'; end if;
    -- Reviewers lock submissions before their challenge; use the same order.
    perform id from public.submissions
     where challenge_id = p_challenge_id and status = 'pending' order by id for update;
    select * into v_challenge from public.challenges
     where id = p_challenge_id and session_id = p_session_id for update;
    if not found then raise exception 'challenge not found in this session'; end if;
    if v_challenge.status = 'claimed' then raise exception 'claimed challenges cannot be moved'; end if;

    with cancelled as (
        update public.submissions set status = 'rejected', reviewed_by = 'admin',
            reviewed_at = now(), review_note = 'Challenge moved to the bottom of the queue by the host'
         where challenge_id = p_challenge_id and status = 'pending' returning id
    )
    insert into public.submission_events(submission_id,event,actor_id,note)
        select id,'rejected','admin','Challenge moved to the bottom of the queue by the host' from cancelled;
    select coalesce(max(sort_order),0) + 1 into v_bottom
      from public.challenges where session_id = p_session_id;
    update public.challenges set is_active = false, status = 'open', sort_order = v_bottom
     where id = p_challenge_id;
    perform public.refill_board(p_session_id);
end;
$$;

-- Enforce hidden/off-board rules even for stale clients and direct RPC calls.
create or replace function public.tg_submission_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_challenge public.challenges;
begin
    select * into v_challenge from public.challenges where id = new.challenge_id for update;
    if not found then raise exception 'challenge not found'; end if;
    if v_challenge.session_id <> new.session_id then
        raise exception 'submission session does not match challenge session';
    end if;
    if v_challenge.status = 'claimed' then raise exception 'challenge is already claimed'; end if;
    if not v_challenge.is_active then raise exception 'challenge is not on the live board'; end if;
    if not exists (select 1 from public.game_sessions
        where id = new.session_id and status = 'active' and board_visible) then
        raise exception 'the board is hidden or the game is not active';
    end if;
    update public.challenges set status = 'pending_approval'
     where id = new.challenge_id and status = 'open';
    return new;
end;
$$;

revoke all on function public.set_board_visibility(uuid, boolean) from public, anon, authenticated;
revoke all on function public.defer_challenge(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_board_visibility(uuid, boolean) to service_role;
grant execute on function public.defer_challenge(uuid, uuid) to service_role;
