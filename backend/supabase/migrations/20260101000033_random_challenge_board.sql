-- Shuffle once per new session and persist that order. Refills still respect
-- the queue, including any ordering chosen by the host. Existing games stay put.
create or replace function public.tg_populate_challenge_board()
returns trigger language plpgsql security definer set search_path = public as $$
begin
    insert into public.challenges
        (session_id,title,location_area,completion_condition,clue_tier,sort_order,image_path)
    select new.id,title,location_area,completion_condition,clue_tier,
           (row_number() over (order by random()))::integer,image_path
      from public.challenge_templates;
    perform public.refill_board(new.id);
    return new;
end;
$$;

revoke all on function public.tg_populate_challenge_board() from public,anon,authenticated;
