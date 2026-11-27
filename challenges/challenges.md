# Challenge Pool

29 challenges for the **Game2** session (`95Q2X3`), seeded by
[`seed_challenges.sql`](../backend/supabase/seed_challenges.sql).

Every challenge unlocks the clue of its tier. The source list only pinned tiers
on the birthday and rock-statue challenges, so the rest were assigned by effort
and distance: **Tier 1** = quick and doable anywhere, **Tier 2** = needs a
specific place or a bit of nerve, **Tier 3** = long, physical, or location-locked.

`#` is the initial `sort_order`. It interleaves tiers so the opening six
challenges include all three tiers. Admins can change the order from the Board
tab by dragging queued challenges. × removes a queued or live challenge from
that session permanently; it will not return to the deck.

The **Name** column becomes `challenges.title`; **Complete when** becomes
`completion_condition`. Names are the hook, the condition is the rule.

The **Img** column becomes `challenges.image_path` - the object key in the
`challenge-assets` storage bucket, `{session_id}/{file}`. A dash means the
challenge has no reference photo. Files live in this folder and are named
`challenge<N>.jpg` to match `#`.

`{{phone}}` in challenge text is replaced at render time from the backend's
`CONTACT_PHONE` env var, so the number never lives in this file or in the
database. If the var is unset, players read "the number your station leader
gives you" instead.

| # | Tier | Name | Where | Complete when | Img |
|---|------|------|-------|---------------|-----|
| 1 | 1 | Going Bananas | Anywhere | Find a banana tree and, as a group, everyone must eat a piece of banana beneath it. | - |
| 2 | 3 | Strava-geddon | Marina Barrage | Complete the Marina Barrage loop from one end point to another and record the run on Strava. Submit a screenshot of the Strava activity. You may start from anyway in the loop but must end where you start. | `challenge2.jpg` |
| 3 | 1 | Colour Chromacronym | Anywhere | Pick a colour, then find items whose names spell it out as an acronym (BLUE = Balloon, Lunch box, Underwear, Elephant). Photograph the items together. | - |
| 4 | 2 | Burp-apella | Anywhere | Burp the alphabet or the camp verse and submit a video of it. | - |
| 5 | 3 | Chilli Sommelier | Anywhere | As a team, each eat one whole chilli padi and drink nothing for 2 minutes, then describe the tasting notes on video. | - |
| 6 | 3 | Money Grows on Trees | Singapore Botanic Gardens | Find and photograph the tree featured on the back of the $5 note. | - |
| 7 | 1 | Shophouse of Cards | Any shophouse row | Build a 2-tier house of cards in front of a shophouse. The photo must show the standing tower and the shophouse frontage. | `challenge7.jpg` |
| 8 | 3 | Egg-istential Crisis | Anywhere | Cook a raw egg and eat it. Every team member must eat some. | - |
| 9 | 2 | Breed Bingo | Anywhere | Snap photos of 5 different dog breeds. | - |
| 10 | 3 | Ketchup Allegiance | Anywhere | Find a red wall, smear your face with ketchup, and recite the pledge on video. | - |
| 11 | 2 | Opportunity Knocks | Any museum | Enter any museum and find the word "opportunity". Photograph it. | - |
| 12 | 2 | Hotdog High-Rise | Any HDB block | Climb to level 10 of an HDB block and eat 10 hotdogs. | - |
| 13 | 1 | I love my Country | Istana/Merlion | Recreate the pose in the reference photo as a group. You may complete this challenge in front of the Istana or the Merlion | `challenge13.jpg` |
| 14 | 2 | Exact Change ($4.55) | Any mall | Pick a mall and find an item that costs exactly $4.55. The photo must show the item and its price tag. | - |
| 15 | 3 | Tourist Trifecta | Merlion Park, Supertrees, Chinatown | Be a tourist for the day: take a photo at the Merlion, at the Supertrees, and in Chinatown. All three in one submission. | - |
| 16 | 2 | December Radar | Anywhere | Sing Happy Birthday to a stranger who was born in December. Video proof plus confirmation of their birth month. | - |
| 17 | 1 | Stonehenge | Anywhere | Build a rock tower using 8 rocks. Photo proof. | - |
| 18 | 2 | Boy Throb Bootcamp | Anywhere | Learn a @boy.throb choreography and replicate the dance exactly on video. | - |
| 19 | 2 | No Paddles Allowed | Any ping pong table | Find any table and rally a ping pong ball as a team, each member hitting it once with a different item. Paddles are not allowed. | - |
| 20 | 3 | Human Cargo | Between two MRT stations | As a team, carry one member from one MRT station to another. Every team member must be touching the person being carried. One person may walk alongside to film but must not help carry. | - |
| 21 | 1 | Manicure Mayhem | Anywhere | Buy a bottle of nail polish and have every team member paint the nails of your right hand. | - |
| 22 | 2 | Squat Squad | Anywhere | As a team, complete 100 squats and drink 2 litres of milk (any flavour). Video proof. | - |
| 23 | 3 | Call Me Maybe | Any surviving payphone | Find a payphone and make a call to Sean at {{phone}}. Photo of the payphone in use. | - |
| 24 | 2 | Youths in the Wild | Anywhere | Film another group without being spotted. The video should include narration like they are animals in a nat geo film. If you are spotted, delete the video and try again. | - |
| 25 | 1 | Ninja Snap | Anywhere | Photograph another group without being spotted. If you are spotted, delete the photo and try again. | - |
| 26 | 1 | One-Word Wonder | Any McDonald's | Choose 2 members to taste-test the McAirLandSea and describe the taste in one word. The team gets 5 attempts to say the same word. You may swap tasters between attempts, but the attempt count does not reset. | - |
| 27 | 2 | Blindfold Sundae | Any ice cream cart | Find an ice cream uncle, pick one team member, buy 3 flavours, and have them identify all 3 blindfolded. | - |
| 28 | 2 | Squirrel Safari | Anywhere | Find and film a Finlayson's squirrel. | - |
| 29 | 2 | BA in the Wild | Anywhere | Find a person from BA in the wild and take a photo with them in person. SEED leaders, partners, parents and church staff do not count. You may call to arrange meeting them, but a photo must be taken in person. | - |


## Photos in this folder

| File | Challenge | What it shows |
|------|-----------|---------------|
| `challenge2.jpg` | #2 Strava-geddon | Marina Bay Loop route map (3 km) |
| `challenge13.jpg` | #13 Copy-Pose | Six-person star-pose reference |

27 challenges have no photo yet. Drop a `challenge<N>.jpg` in this folder and
fill in the `Img` column to attach one.

## Tier distribution

| Tier | Count | Character |
|------|-------|-----------|
| 1 | 10 | Quick, doable anywhere, low commitment |
| 2 | 12 | Needs a specific place, a purchase, or some nerve |
| 3 | 7 | Long, physical, or locked to one location |

