-- Storage must be removed through its API, never by deleting storage.objects rows.
create table public.session_media_deletions (
    session_id uuid primary key,
    buckets text[] not null,
    requested_at timestamptz not null default now(),
    last_attempt_at timestamptz,
    attempts integer not null default 0,
    last_error text
);
alter table public.session_media_deletions enable row level security;
revoke all on public.session_media_deletions from public,anon,authenticated;
grant select,insert,update,delete on public.session_media_deletions to service_role;

create or replace function public.delete_session_with_media(p_session_id uuid,p_buckets text[])
returns void language plpgsql security definer set search_path=public as $$
begin
    perform id from public.game_sessions where id=p_session_id for update;
    if not found then
        if exists(select 1 from public.session_media_deletions where session_id=p_session_id) then return; end if;
        raise exception 'session not found' using errcode='PT404';
    end if;
    if p_buckets is null or cardinality(p_buckets)=0 then raise exception 'Storage buckets are required'; end if;
    insert into public.session_media_deletions(session_id,buckets) values(p_session_id,p_buckets)
    on conflict(session_id) do nothing;
    delete from public.game_sessions where id=p_session_id;
end $$;
revoke all on function public.delete_session_with_media(uuid,text[]) from public,anon,authenticated;
grant execute on function public.delete_session_with_media(uuid,text[]) to service_role;

-- Legacy templates reuse images that were originally uploaded under a game ID.
-- Move their references atomically after copying the object into shared Storage.
create or replace function public.relocate_shared_session_asset(p_session_id uuid,p_old_path text,p_new_path text,p_old_url text,p_new_url text)
returns void language plpgsql security definer set search_path=public as $$
begin
    if left(p_old_path,length(p_session_id::text)+1)<>p_session_id::text||'/' or left(p_new_path,8)<>'_shared/' then
        raise exception 'Invalid shared asset relocation';
    end if;
    -- Block new game population until all references point at the shared copy.
    lock table public.game_sessions in share row exclusive mode;
    lock table public.challenge_templates in access exclusive mode;
    update public.challenge_templates set image_path=p_new_path where image_path=p_old_path;
    update public.challenges set image_path=p_new_path where image_path=p_old_path;
    update public.clues set media_url=p_new_url where media_url=p_old_url;
end $$;
revoke all on function public.relocate_shared_session_asset(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.relocate_shared_session_asset(uuid,text,text,text,text) to service_role;
