-- A proof can contain media, text, or both. Legacy photo proofs remain valid.
alter table public.submissions alter column photo_path drop not null;
alter table public.submissions add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.submissions add column if not exists proof_text text;
alter table public.submissions add constraint submission_attachments_array check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=10);
alter table public.submissions add constraint submission_has_evidence check(
    nullif(btrim(photo_path),'') is not null or jsonb_array_length(attachments)>0 or nullif(btrim(proof_text),'') is not null);
alter table public.submissions add constraint submission_text_length check(char_length(proof_text)<=4000);

create or replace function public.submit_evidence(
    p_team_id uuid,p_member_id uuid,p_challenge_id uuid,p_attachments jsonb,p_text text
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_session uuid; v_challenge public.challenges; v_id uuid; item jsonb; total bigint=0; body text=nullif(btrim(p_text),'');
begin
    select session_id into v_session from public.teams where id=p_team_id;
    if not found then raise exception 'team not found'; end if;
    -- Same lock order as approvals: session, challenge, submission.
    perform id from public.game_sessions where id=v_session for update;
    select * into v_challenge from public.challenges where id=p_challenge_id for update;
    if not found or v_challenge.session_id<>v_session then raise exception 'challenge is not part of your session'; end if;
    if p_member_id is not null and not exists(select 1 from public.team_members where id=p_member_id and team_id=p_team_id) then
        raise exception 'member is not part of your team';
    end if;
    if p_attachments is null or jsonb_typeof(p_attachments)<>'array' then raise exception 'invalid attachments'; end if;
    if jsonb_array_length(p_attachments)>10 then raise exception 'Attach at most 10 files'; end if;
    if jsonb_array_length(p_attachments)=0 and body is null then raise exception 'Add an image, a video, or a message'; end if;
    if char_length(body)>4000 then raise exception 'Message is too long'; end if;
    for item in select value from jsonb_array_elements(p_attachments) loop
        if jsonb_typeof(item)<>'object' or item->>'path' is null or
           left(item->>'path',length(v_session::text||'/'||p_team_id::text||'/'))<>v_session::text||'/'||p_team_id::text||'/' then
            raise exception 'Attachment is not owned by your team';
        end if;
        if coalesce(item->>'content_type','') not in ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4','video/webm','video/quicktime') then
            raise exception 'Unsupported attachment type';
        end if;
        if coalesce((item->>'size')::bigint,0)<=0 or (item->>'size')::bigint>(case when item->>'content_type' like 'video/%' then 47185920 else 26214400 end) then raise exception 'Invalid attachment size'; end if;
        if item->>'content_type' like 'video/%' and (coalesce((item->>'duration_seconds')::numeric,0)<=0 or (item->>'duration_seconds')::numeric>60) then raise exception 'Videos must be 60 seconds or shorter'; end if;
        total=total+(item->>'size')::bigint;
    end loop;
    if total>471859200 then raise exception 'Prepared attachments exceed the submission limit'; end if;
    -- The existing before-insert trigger checks active game/board and unclaimed challenge.
    insert into public.submissions(session_id,challenge_id,team_id,team_member_id,photo_path,attachments,proof_text)
    values(v_session,p_challenge_id,p_team_id,p_member_id,p_attachments->0->>'path',p_attachments,body) returning id into v_id;
    insert into public.submission_events(submission_id,event,actor_id) values(v_id,'submitted',p_member_id::text);
    return v_id;
end $$;
revoke all on function public.submit_evidence(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.submit_evidence(uuid,uuid,uuid,jsonb,text) to service_role;

update storage.buckets set file_size_limit=47185920,allowed_mime_types=array[
 'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
 'video/mp4','video/webm','video/quicktime'
] where id='challenge-proofs';
