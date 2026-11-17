-- Permanent shared clue catalog. Games own unlocks, never copies of clues.
-- Run atomically; retain existing awards and all distinct legacy clue content.
lock table public.game_sessions, public.clues, public.challenges, public.team_clues
    in access exclusive mode;

do $$
declare duplicate record;
begin
    for duplicate in
        select id, keep_id from (
            select id, first_value(id) over (
                partition by tier, title, body, media_url order by created_at, id
            ) as keep_id from public.clues
        ) mapped where id <> keep_id
    loop
        insert into public.team_clues (team_id, clue_id, challenge_id, unlocked_at)
        select team_id, duplicate.keep_id, challenge_id, unlocked_at
          from public.team_clues where clue_id = duplicate.id
        on conflict (team_id, clue_id) do nothing;
        update public.challenges set clue_id = duplicate.keep_id where clue_id = duplicate.id;
        delete from public.clues where id = duplicate.id;
    end loop;
end $$;

-- Removing the owning FK makes session deletion independent of the catalog.
alter table public.clues drop column session_id;

-- Only the player-facing columns from clues/clues.md are included.
-- Existing exact matches keep their IDs and unlocked inventories.
with built_in (tier, sort_order, title, body) as (values
    ('tier1'::public.clue_tier, 0, 'Yellow Yellow, there she goes!', 'Yellow.'),
    ('tier1'::public.clue_tier, 1, 'Five little digits, one big mystery!', '92251'),
    ('tier1'::public.clue_tier, 2, 'Net, net, what did we get?', 'Net.'),
    ('tier1'::public.clue_tier, 3, 'A little letter, a little number, a little trouble!', 'C1'),
    ('tier1'::public.clue_tier, 4, 'Green, green, what could it mean?', 'Green.'),
    ('tier1'::public.clue_tier, 5, 'Someone''s singing, but who''s listening?', 'Siren.'),
    ('tier1'::public.clue_tier, 6, 'A little grit in the mystery!', 'Sand.'),
    ('tier1'::public.clue_tier, 7, 'Three digits looking for a job!', '401'),
    ('tier2'::public.clue_tier, 0, 'The Morning Tenant', 'Borrow the sunrise''s address. Leave the sunset to somebody else.'),
    ('tier2'::public.clue_tier, 1, 'An Unwritten Letter', 'The wind has licked an envelope with salt. The reply stays on this island.'),
    ('tier2'::public.clue_tier, 2, 'Old Sunshine', 'A colour borrowed from ancient resin has been taught to stand upright.'),
    ('tier2'::public.clue_tier, 3, 'A Silent Conversation', 'One neighbour speaks to travellers who never set foot on these paths. Look nearby, not beneath it.'),
    ('tier2'::public.clue_tier, 4, 'An Argument in the Air', 'An argument is stretched tight between two sides. Its punctuation travels through air; the floor remembers the shore.'),
    ('tier2'::public.clue_tier, 5, 'A Song with No Sound', 'Two tails wait inside a circle. Nobody here has come to hear the song.'),
    ('tier2'::public.clue_tier, 6, 'A Place to Stop', 'Third in the procession, first in the count. Together they tell tired wheels where to rest.'),
    ('tier2'::public.clue_tier, 7, 'The Name''s Last Breath', 'The name ends where blue and yellow stop being separate. Find the beginning elsewhere.'),
    ('tier3'::public.clue_tier, 0, 'Two Words, One Tower', 'Solve two words: fossilised tree resin; a light that guides ships. Put them together and search for the tower with that name in Singapore. The finish is nearby, not at the tower.'),
    ('tier3'::public.clue_tier, 1, 'Build the Park', 'Solve these three words in order: opposite of WEST; where the sea meets the land; a public recreation space. Read them as one place name. That is the park containing the finish. Now mix blue and yellow: the resulting colour is the final word of your destination''s name.'),
    ('tier3'::public.clue_tier, 2, 'Park the Answer', 'Use A=1, B=2, C=3. Decode 3, then place the digit 1 after it. In the coastal park, this is your carpark reference. Search its surrounding recreation area, not the parking bays.'),
    ('tier3'::public.clue_tier, 3, 'Name the Game', 'Unscramble BEACH + L L V O E Y B A L L. Find the court for that sport near the finish. The court and a coffee outlet with a two-tailed logo are both nearby.'),
    ('tier3'::public.clue_tier, 4, 'Read the Starts', 'Take the first letter of each word: Sailors Trade Amber Rings Before Unusual Coastal Kings Sing. Search the resulting coffee brand in the coastal park; the finish is near that outlet.'),
    ('tier3'::public.clue_tier, 5, 'Three Steps Back', 'SDUNODQG JUHHQ. Every letter has moved three places forward in the alphabet. Move each one three places back, keeping the space. The answer is the destination''s name.'),
    ('tier3'::public.clue_tier, 6, 'Five Answers, One Stop', 'Calculate separately: 3 squared; 1+1; 6 divided by 3; 10 divided by 2; 4 minus 3. Join the five answers in order. Look up that Singapore bus-stop code: its name identifies the area opposite the finish. You do not need to board a bus.'),
    ('tier3'::public.clue_tier, 7, 'An Address in Pieces', 'Nine hundred plus twenty gives the street number. Take the initials of East Coast Parkway for the road. Search the number and initials together in Singapore: the finish is in that recreation and dining area.')
)
insert into public.clues (tier, sort_order, title, body)
select b.tier, b.sort_order, b.title, b.body from built_in b
where not exists (
    select 1 from public.clues c where c.tier=b.tier and c.title=b.title
      and c.body=b.body and c.media_url is null
);

-- Canonical clues occupy slots 0..7; distinct legacy content follows them.
with built_in (tier, sort_order, title, body) as (values
    ('tier1'::public.clue_tier, 0, 'Yellow Yellow, there she goes!', 'Yellow.'),
    ('tier1'::public.clue_tier, 1, 'Five little digits, one big mystery!', '92251'),
    ('tier1'::public.clue_tier, 2, 'Net, net, what did we get?', 'Net.'),
    ('tier1'::public.clue_tier, 3, 'A little letter, a little number, a little trouble!', 'C1'),
    ('tier1'::public.clue_tier, 4, 'Green, green, what could it mean?', 'Green.'),
    ('tier1'::public.clue_tier, 5, 'Someone''s singing, but who''s listening?', 'Siren.'),
    ('tier1'::public.clue_tier, 6, 'A little grit in the mystery!', 'Sand.'),
    ('tier1'::public.clue_tier, 7, 'Three digits looking for a job!', '401'),
    ('tier2'::public.clue_tier, 0, 'The Morning Tenant', 'Borrow the sunrise''s address. Leave the sunset to somebody else.'),
    ('tier2'::public.clue_tier, 1, 'An Unwritten Letter', 'The wind has licked an envelope with salt. The reply stays on this island.'),
    ('tier2'::public.clue_tier, 2, 'Old Sunshine', 'A colour borrowed from ancient resin has been taught to stand upright.'),
    ('tier2'::public.clue_tier, 3, 'A Silent Conversation', 'One neighbour speaks to travellers who never set foot on these paths. Look nearby, not beneath it.'),
    ('tier2'::public.clue_tier, 4, 'An Argument in the Air', 'An argument is stretched tight between two sides. Its punctuation travels through air; the floor remembers the shore.'),
    ('tier2'::public.clue_tier, 5, 'A Song with No Sound', 'Two tails wait inside a circle. Nobody here has come to hear the song.'),
    ('tier2'::public.clue_tier, 6, 'A Place to Stop', 'Third in the procession, first in the count. Together they tell tired wheels where to rest.'),
    ('tier2'::public.clue_tier, 7, 'The Name''s Last Breath', 'The name ends where blue and yellow stop being separate. Find the beginning elsewhere.'),
    ('tier3'::public.clue_tier, 0, 'Two Words, One Tower', 'Solve two words: fossilised tree resin; a light that guides ships. Put them together and search for the tower with that name in Singapore. The finish is nearby, not at the tower.'),
    ('tier3'::public.clue_tier, 1, 'Build the Park', 'Solve these three words in order: opposite of WEST; where the sea meets the land; a public recreation space. Read them as one place name. That is the park containing the finish. Now mix blue and yellow: the resulting colour is the final word of your destination''s name.'),
    ('tier3'::public.clue_tier, 2, 'Park the Answer', 'Use A=1, B=2, C=3. Decode 3, then place the digit 1 after it. In the coastal park, this is your carpark reference. Search its surrounding recreation area, not the parking bays.'),
    ('tier3'::public.clue_tier, 3, 'Name the Game', 'Unscramble BEACH + L L V O E Y B A L L. Find the court for that sport near the finish. The court and a coffee outlet with a two-tailed logo are both nearby.'),
    ('tier3'::public.clue_tier, 4, 'Read the Starts', 'Take the first letter of each word: Sailors Trade Amber Rings Before Unusual Coastal Kings Sing. Search the resulting coffee brand in the coastal park; the finish is near that outlet.'),
    ('tier3'::public.clue_tier, 5, 'Three Steps Back', 'SDUNODQG JUHHQ. Every letter has moved three places forward in the alphabet. Move each one three places back, keeping the space. The answer is the destination''s name.'),
    ('tier3'::public.clue_tier, 6, 'Five Answers, One Stop', 'Calculate separately: 3 squared; 1+1; 6 divided by 3; 10 divided by 2; 4 minus 3. Join the five answers in order. Look up that Singapore bus-stop code: its name identifies the area opposite the finish. You do not need to board a bus.'),
    ('tier3'::public.clue_tier, 7, 'An Address in Pieces', 'Nine hundred plus twenty gives the street number. Take the initials of East Coast Parkway for the road. Search the number and initials together in Singapore: the finish is in that recreation and dining area.')
), ordered as (
    select c.id, row_number() over (
        partition by c.tier order by b.sort_order nulls last, c.sort_order, c.created_at, c.id
    ) - 1 as position
    from public.clues c left join built_in b
      on c.tier=b.tier and c.title=b.title and c.body=b.body and c.media_url is null
)
update public.clues c set sort_order = ordered.position from ordered where c.id=ordered.id;
alter table public.clues add constraint clues_tier_order_unique unique (tier, sort_order);
alter table public.clues enable row level security;
revoke all on public.clues from public, anon, authenticated;
grant all on public.clues to service_role;

create or replace function public.approve_submission(
    p_submission_id uuid,
    p_note          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sub       public.submissions;
    v_challenge public.challenges;
    v_clue_id   uuid;
begin
    select * into v_sub from public.submissions where id = p_submission_id;
    if not found then
        raise exception 'submission % not found', p_submission_id;
    end if;

    select * into v_challenge from public.challenges where id = v_sub.challenge_id;
    if not found then
        raise exception 'challenge not found';
    end if;

    perform id from public.game_sessions
     where id = v_challenge.session_id for update;

    select * into v_challenge
      from public.challenges
     where id = v_sub.challenge_id
     for update;

    select * into v_sub
      from public.submissions
     where id = p_submission_id
     for update;

    if v_sub.status <> 'pending' then
        raise exception 'submission is already %', v_sub.status;
    end if;
    if v_challenge.status = 'claimed' then
        raise exception 'challenge already claimed by another team';
    end if;

    if not exists (select 1 from public.clues where tier = v_challenge.clue_tier) then
        raise exception 'no clues configured for tier %', v_challenge.clue_tier;
    end if;

    select c.id into v_clue_id
      from public.clues c
     where c.tier = v_challenge.clue_tier
       and not exists (
           select 1 from public.team_clues tc
            where tc.team_id = v_sub.team_id
              and tc.clue_id = c.id
       )
     order by random()
     limit 1;

    update public.submissions
       set status = 'approved',
           reviewed_by = 'admin',
           review_note = p_note,
           reviewed_at = now()
     where id = p_submission_id;

    update public.challenges
       set status = 'claimed',
           claimed_by_team_id = v_sub.team_id,
           updated_at = now()
     where id = v_challenge.id;

    -- An exhausted tier has no new clue to give; never repeat an owned clue.
    if v_clue_id is not null then
        insert into public.team_clues (team_id, clue_id, challenge_id)
        values (v_sub.team_id, v_clue_id, v_challenge.id)
        on conflict (team_id, clue_id) do nothing;
    end if;

    update public.submissions
       set status = 'rejected',
           reviewed_by = 'admin',
           reviewed_at = now(),
           review_note = coalesce(review_note, 'Challenge claimed by another team')
     where challenge_id = v_challenge.id
       and status = 'pending';

    insert into public.submission_events (submission_id, event, actor_id, note)
    values (p_submission_id, 'approved', 'admin', p_note);

    perform public.refill_board(v_challenge.session_id);
end;
$$;

revoke all on function public.approve_submission(uuid, text) from public, anon, authenticated;
grant execute on function public.approve_submission(uuid, text) to service_role;
