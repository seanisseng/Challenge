-- Canonical content: challenges/challenges.md (49 entries).
-- Preserve in-progress/history rows, removals and the host's existing order.
lock table public.game_sessions in share row exclusive mode;
lock table public.challenge_templates in access exclusive mode;
create temporary table challenge_catalog_sync (
    catalog_number integer primary key, title text unique not null,
    legacy_title text not null, location_area text,
    completion_condition text not null, clue_tier public.clue_tier not null,
    image_filename text
) on commit drop;
insert into challenge_catalog_sync values
    (1,'Going Bananas','Going Bananas','Anywhere','Find a banana tree and, as a group, everyone must eat a piece of banana beneath it.','tier1',null),
    (2,'Strava-geddon','Strava-geddon','Marina Barrage','Complete the Marina Barrage loop from one end point to another and record the run on Strava. Submit a screenshot of the Strava activity. You may start from anyway in the loop but must end where you start.','tier3','challenge2.jpg'),
    (3,'Colour Chromacronym','Colour Chromacronym','Anywhere','Pick a colour, then find items whose names spell it out as an acronym (BLUE = Balloon, Lunch box, Underwear, Elephant). Photograph the items together.','tier1',null),
    (4,'Burp-apella','Burp-apella','Anywhere','Burp the alphabet or the camp verse and submit a video of it.','tier2',null),
    (5,'Chilli Sommelier','Chilli Sommelier','Anywhere','As a team, each eat one whole chilli padi and drink nothing for 2 minutes, then describe the tasting notes on video.','tier3',null),
    (6,'Money Grows on Trees','Money Grows on Trees','Singapore Botanic Gardens','Find and photograph the tree featured on the back of the $5 note.','tier3',null),
    (7,'Shophouse of Cards','Shophouse of Cards','Any shophouse row','Build a 2-tier house of cards in front of a shophouse. The photo must show the standing tower and the shophouse frontage.','tier1','challenge7.jpg'),
    (8,'Egg-istential Crisis','Egg-istential Crisis','Anywhere','Cook a raw egg and eat it. Every team member must eat some.','tier3',null),
    (9,'Breed Bingo','Breed Bingo','Anywhere','Snap photos of 5 different dog breeds.','tier2',null),
    (10,'Ketchup Allegiance','Ketchup Allegiance','Anywhere','Find a red wall, smear your face with ketchup, and recite the pledge on video.','tier3',null),
    (11,'Opportunity Knocks','Opportunity Knocks','Any museum','Enter any museum and find the word "opportunity". Photograph it.','tier2',null),
    (12,'Hotdog High-Rise','Hotdog High-Rise','Any HDB block','Climb to level 10 of an HDB block and eat 10 hotdogs.','tier2',null),
    (13,'I love my Country','Copy-Pose','Istana/Merlion','Recreate the pose in the reference photo as a group. You may complete this challenge in front of the Istana or the Merlion','tier1','challenge13.jpg'),
    (14,'Exact Change ($4.55)','Exact Change ($4.55)','Any mall','Pick a mall and find an item that costs exactly $4.55. The photo must show the item and its price tag.','tier2',null),
    (15,'Tourist Trifecta','Tourist Trifecta','Merlion Park, Supertrees, Chinatown','Be a tourist for the day: take a photo at the Merlion, at the Supertrees, and in Chinatown. All three in one submission.','tier3',null),
    (16,'December Radar','December Radar','Anywhere','Sing Happy Birthday to a stranger who was born in December. Video proof plus confirmation of their birth month.','tier2',null),
    (17,'Stonehenge','Stonehenge','Anywhere','Build a rock tower using 8 rocks. Photo proof.','tier1',null),
    (18,'Boy Throb Bootcamp','Boy Throb Bootcamp','Anywhere','Learn https://www.instagram.com/reel/Df-I8Bqy5Db/ this boy throb choreography and replicate the dance exactly on video.','tier2',null),
    (19,'No Paddles Allowed','No Paddles Allowed','Any ping pong table','Find any table and rally a ping pong ball as a team, each member hitting it once with a different item. Paddles are not allowed.','tier2',null),
    (20,'Human Cargo','Human Cargo','Between two MRT stations','As a team, carry one member from one MRT station to another. Every team member must be touching the person being carried. One person may walk alongside to film but must not help carry.','tier3',null),
    (21,'Manicure Mayhem','Manicure Mayhem','Anywhere','Buy a bottle of nail polish and have every team member paint the nails of your right hand.','tier1',null),
    (22,'Squat Squad','Squat Squad','Anywhere','As a team, complete 100 squats and drink 2 litres of milk (any flavour). Video proof.','tier2',null),
    (23,'Call Me Maybe','Call Me Maybe','Any surviving payphone','Find a payphone and make a call to Sean at {{phone}}. Photo of the payphone in use.','tier3',null),
    (24,'Youths in the Wild','Trial by Rival','Anywhere','Film another group without being spotted. The video should include narration like they are animals in a nat geo film. If you are spotted, delete the video and try again.','tier2',null),
    (25,'Ninja Snap','Ninja Snap','Anywhere','Photograph another group without being spotted. If you are spotted, delete the photo and try again.','tier1',null),
    (26,'One-Word Wonder','One-Word Wonder','Any McDonald''s','Choose 2 members to taste-test the McAirLandSea and describe the taste in one word. The team gets 5 attempts to say the same word. You may swap tasters between attempts, but the attempt count does not reset.','tier1',null),
    (27,'Blindfold Sundae','Blindfold Sundae','Any ice cream cart','Find an ice cream uncle, pick one team member, buy 3 flavours, and have them identify all 3 blindfolded.','tier2',null),
    (28,'Squirrel Safari','Squirrel Safari','Anywhere','Find and film a Finlayson''s squirrel.','tier2',null),
    (29,'BA in the Wild','BA in the Wild','Anywhere','Find a person from BA in the wild and take a photo with them in person. SEED leaders, partners, parents and church staff do not count. You may call to arrange meeting them, but a photo must be taken in person.','tier2',null),
    (30,'Snack Heritage Hunt','Snack Heritage Hunt','Anywhere','Find 3 traditional Singaporean snacks or pastries from any of these categories: crispy, chewy, spicy, coconut-based, or pandan-flavoured. You may snap a picture of yourself biting each food item!','tier2',null),
    (31,'Six-Cuisine Feast','Six-Cuisine Feast','Anywhere','Eat one food from each cuisine: Indian, Thai, Malay, Chinese, Western, and Vietnamese.','tier3',null),
    (32,'Five-Dollar Fast Feast','Five-Dollar Fast Feast','Anywhere','Eat a meal worth $5 in 2 minutes.','tier1',null),
    (33,'Fast Food, Wrong Venue','Fast Food, Wrong Venue','A fast food outlet and another restaurant','Buy a fast food meal and eat it in another restaurant without getting chased out. You may not order any food from the other restaurant. Only one person in your team needs to eat the meal.','tier2',null),
    (34,'Chubby Nugget','Chubby Nugget','Anywhere','Complete the Chubby Bunny challenge with nuggets: fit 6 nuggets into your mouth. Only one person needs to do this.','tier2',null),
    (35,'Triple Drink Remix','Triple Drink Remix','Anywhere','Buy 1 juice, 1 milk tea, and 1 coffee. Mix them all together and drink half of the mixture as a group.','tier2',null),
    (36,'Thanks and Mash','Thanks and Mash','Anywhere','Have a Thanksgiving meal: eat some sort of poultry and mashed potatoes. Every team member must share something they are thankful for!','tier1',null),
    (37,'Count Your Steps','Count Your Steps','Bukit Arang','In Bukit Arang, how many steps are there from EB1 to E3?','tier1',null),
    (38,'Mall Carol Crew','Mall Carol Crew','In front of any mall','Go caroling in front of a mall and sing at least 2 songs.','tier2',null),
    (39,'Scenery, Twice','Scenery, Twice','Anywhere','Take a picture of some scenery and make a photorealistic drawing of it. Submit pictures of both the scenery and the drawing.','tier2',null),
    (40,'Zi Char Rankings','Zi Char Rankings','Any Zi Char stall','Buy a different noodle or rice dish for each person. Rank the dishes from best to worst!','tier1',null),
    (41,'Pau Partners','Pau Partners','Anywhere selling Amy Yip pau','Buy an Amy Yip pau and have 2 people finish it.','tier1',null),
    (42,'FrankenRice','FrankenRice','A biryani stall, a chicken rice stall, and a nasi lemak stall','Buy rice from a biryani stall, chicken from a chicken rice stall, and vegetables from a nasi lemak stall. Assemble them into a dish and eat it.','tier3',null),
    (43,'Natto for Everyone','Natto for Everyone','Anywhere','Find natto and have everyone in the group try it.','tier2',null),
    (44,'Yo-Chi Price Is Right','Yo-Chi Price Is Right','Yo-Chi','Make a Yo-Chi bowl and predict its price. The actual price must be within $1.50 of your prediction.','tier2',null),
    (45,'Moustache Moment','Moustache Moment','Anywhere','Draw moustaches on your faces and snap a picture!','tier1',null),
    (46,'Picnic Perfect','Picnic Perfect','Any picnic spot','Have a picnic with a mat, a drink, and a savoury or sweet snack. Take an Instagrammable picture of the setup with your team members in it.','tier2',null),
    (47,'Mural Doppelgangers','Mural Doppelgangers','An MRT mural','Reenact the contents of an MRT mural with your group and take a picture in front of it.','tier2',null),
    (48,'Angsana Instinct','Angsana Instinct','Anywhere','Find an angsana tree without Googling.','tier2',null),
    (49,'Next Stop, No Script','Next Stop, No Script','Anywhere','Perform the MRT announcement in Malay and Tamil without referencing a script.','tier1',null);

insert into public.challenge_templates as existing
    (sort_order,title,location_area,completion_condition,clue_tier,image_path)
select catalog_number,title,location_area,completion_condition,clue_tier,
       case when image_filename is not null then '_shared/' || image_filename end
from challenge_catalog_sync
on conflict (sort_order) do update set
    title=excluded.title, location_area=excluded.location_area,
    completion_condition=excluded.completion_condition, clue_tier=excluded.clue_tier,
    image_path=case when excluded.image_path is null then null
                   else coalesce(existing.image_path,excluded.image_path) end;

-- Match by title/legacy alias, never session sort_order (the host may reorder it).
update public.challenges c set
    title=t.title, location_area=t.location_area,
    completion_condition=t.completion_condition, clue_tier=t.clue_tier,
    image_path=t.image_path
from public.challenge_templates t join challenge_catalog_sync source
    on source.catalog_number=t.sort_order
where c.title in (source.title,source.legacy_title)
  and c.status='open' and not c.is_discarded
  and exists(select 1 from public.game_sessions s where s.id=c.session_id and s.status<>'ended')
  and not exists(select 1 from public.submissions proof where proof.challenge_id=c.id);

-- Append missing catalog entries to unfinished games, preserving queue order.
-- Claimed, discarded and pending rows count as present, so they never respawn.
with missing as (
    select s.id as session_id,t.*,
        coalesce((select max(c.sort_order) from public.challenges c where c.session_id=s.id),0)
          + (row_number() over(partition by s.id order by t.sort_order))::integer as queue_order
    from public.game_sessions s cross join public.challenge_templates t
    join challenge_catalog_sync source on source.catalog_number=t.sort_order
    where s.status<>'ended' and not exists (
        select 1 from public.challenges c where c.session_id=s.id
          and c.title in (source.title,source.legacy_title)
    )
)
insert into public.challenges
    (session_id,title,location_area,completion_condition,clue_tier,sort_order,image_path)
select session_id,title,location_area,completion_condition,clue_tier,queue_order,image_path
from missing;
