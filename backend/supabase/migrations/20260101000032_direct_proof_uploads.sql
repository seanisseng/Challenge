-- Upload capabilities can outlive a session. Do not cascade these records:
-- retain tombstones until the 24h resumable URL lifetime plus a 1h margin.
create table public.proof_upload_batches (
    id uuid primary key default gen_random_uuid(),
    request_id uuid not null,
    session_id uuid not null,
    team_id uuid not null,
    member_id uuid not null,
    challenge_id uuid not null,
    manifest jsonb not null,
    expires_at timestamptz not null default now()+interval '25 hours',
    submission_id uuid,
    unique(team_id,request_id)
);
create table public.proof_uploads (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.proof_upload_batches(id) on delete cascade,
    session_id uuid not null,
    team_id uuid not null,
    ordinal integer not null,
    path text not null unique,
    name text not null,
    content_type text not null,
    size bigint not null check(size>0 and size<=47185920),
    verified_at timestamptz,
    duration_seconds numeric,
    unique(batch_id,ordinal)
);
create index proof_upload_batches_expiry on public.proof_upload_batches(expires_at);
create index proof_uploads_session on public.proof_uploads(session_id);
alter table public.proof_upload_batches enable row level security;
alter table public.proof_uploads enable row level security;
revoke all on public.proof_upload_batches,public.proof_uploads from public,anon,authenticated;
grant all on public.proof_upload_batches,public.proof_uploads to service_role;

create or replace function public.authorize_proof_uploads(
 p_request_id uuid,p_team_id uuid,p_member_id uuid,p_challenge_id uuid,p_files jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare b public.proof_upload_batches; s public.game_sessions; c public.challenges;
        item jsonb; upload_id uuid; i integer=0; extension text;
begin
 select gs.* into s from public.game_sessions gs join public.teams t on t.session_id=gs.id
 where t.id=p_team_id for update of gs;
 if not found then raise exception 'Session not found'; end if;
 if not exists(select 1 from public.team_members where id=p_member_id and team_id=p_team_id) then
  raise exception 'Member is not part of this team'; end if;
 select * into b from public.proof_upload_batches where team_id=p_team_id and request_id=p_request_id for update;
 if found then
  if b.challenge_id<>p_challenge_id or b.manifest<>p_files then raise exception 'Upload request does not match its original draft'; end if;
  if b.submission_id is not null then
   return jsonb_build_object('batch_id',b.id,'submission_id',b.submission_id,'uploads','[]'::jsonb);
  end if;
  if b.expires_at<=now() then raise sqlstate 'PT410' using message='Upload session expired. Start a new upload.'; end if;
 end if;
 select * into c from public.challenges where id=p_challenge_id and session_id=s.id;
 if not found or c.status='claimed' or not c.is_active or c.is_discarded
    or s.status<>'active' or not s.board_visible then raise sqlstate 'PT409' using message='Challenge is no longer open'; end if;
 if exists(select 1 from public.submissions where team_id=p_team_id and challenge_id=p_challenge_id and status='pending') then
  raise sqlstate 'PT409' using message='Your proof is awaiting host review'; end if;
 if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files)>10 then raise exception 'Attach at most 10 files'; end if;
 if b.id is null then
  if (select count(*) from public.proof_uploads u join public.proof_upload_batches ub on ub.id=u.batch_id
      where ub.team_id=p_team_id and ub.submission_id is null and ub.expires_at>now())+jsonb_array_length(p_files)>20 then
   raise sqlstate 'PT409' using message='Too many unfinished uploads. Resume your saved draft or try again after uploads expire.'; end if;
  insert into public.proof_upload_batches(request_id,session_id,team_id,member_id,challenge_id,manifest)
   values(p_request_id,s.id,p_team_id,p_member_id,p_challenge_id,p_files) returning * into b;
  for item in select value from jsonb_array_elements(p_files) loop
   if item->>'content_type' not in ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','video/mp4')
      or coalesce((item->>'size')::bigint,0)<=0
      or (item->>'size')::bigint>(case when item->>'content_type'='video/mp4' then 47185920 else 26214400 end)
      or coalesce(length(item->>'name'),0) not between 1 and 255 then raise exception 'Invalid upload metadata'; end if;
   extension=case item->>'content_type' when 'image/jpeg' then '.jpg' when 'image/png' then '.png'
    when 'image/webp' then '.webp' when 'image/gif' then '.gif' when 'image/heic' then '.heic'
    when 'image/heif' then '.heif' else '.mp4' end;
   upload_id=gen_random_uuid();
   insert into public.proof_uploads(id,batch_id,session_id,team_id,ordinal,path,name,content_type,size)
    values(upload_id,b.id,s.id,p_team_id,i,s.id::text||'/'||p_team_id::text||'/'||upload_id::text||extension,
           item->>'name',item->>'content_type',(item->>'size')::bigint);
   i=i+1;
  end loop;
 end if;
 -- A refreshed signed token gets a fresh cleanup horizon, while the session
 -- lock prevents issuing new capabilities after deletion commits.
 update public.proof_upload_batches set expires_at=now()+interval '25 hours' where id=b.id;
 return jsonb_build_object('batch_id',b.id,'submission_id',null,'uploads',
  coalesce((select jsonb_agg(to_jsonb(u) order by ordinal) from public.proof_uploads u where batch_id=b.id),'[]'::jsonb));
end $$;

create or replace function public.finalize_proof_uploads(p_batch_id uuid,p_team_id uuid,p_text text)
returns uuid language plpgsql security definer set search_path=public as $$
declare b public.proof_upload_batches; sid uuid; attachments jsonb;
begin
 select * into b from public.proof_upload_batches where id=p_batch_id and team_id=p_team_id;
 if not found then raise sqlstate 'PT404' using message='Upload session not found'; end if;
 perform id from public.game_sessions where id=b.session_id for update;
 if not found then raise sqlstate 'PT410' using message='Session was deleted'; end if;
 select * into b from public.proof_upload_batches where id=p_batch_id for update;
 if b.submission_id is not null then return b.submission_id; end if;
 if b.expires_at<=now() then raise sqlstate 'PT410' using message='Upload session expired'; end if;
 if exists(select 1 from public.proof_uploads where batch_id=b.id and verified_at is null) then
  raise sqlstate 'PT409' using message='Finish verifying all attachments first'; end if;
 if exists(select 1 from public.submissions where team_id=p_team_id and challenge_id=b.challenge_id and status='pending') then
  raise sqlstate 'PT409' using message='Your proof is awaiting host review'; end if;
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('path',path,'name',name,'content_type',content_type,
  'size',size,'duration_seconds',duration_seconds)) order by ordinal),'[]'::jsonb) into attachments
 from public.proof_uploads where batch_id=b.id;
 sid=public.submit_evidence(b.team_id,b.member_id,b.challenge_id,attachments,p_text);
 update public.proof_upload_batches set submission_id=sid where id=b.id;
 return sid;
end $$;

-- Historical proofs remain valid. Only new/changed media must meet 30 seconds.
create or replace function public.tg_limit_new_proof_video()
returns trigger language plpgsql set search_path=public as $$
begin
 if exists(select 1 from jsonb_array_elements(new.attachments) item
   where item->>'content_type' like 'video/%' and
   (coalesce((item->>'duration_seconds')::numeric,0)<=0 or (item->>'duration_seconds')::numeric>30)) then
  raise exception 'Videos must be 30 seconds or shorter'; end if;
 return new;
end $$;
create trigger submissions_video_duration before insert or update of attachments on public.submissions
 for each row execute function public.tg_limit_new_proof_video();
revoke all on function public.tg_limit_new_proof_video() from public,anon,authenticated;
revoke all on function public.authorize_proof_uploads(uuid,uuid,uuid,uuid,jsonb),public.finalize_proof_uploads(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.authorize_proof_uploads(uuid,uuid,uuid,uuid,jsonb),public.finalize_proof_uploads(uuid,uuid,text) to service_role;

create or replace function public.has_live_proof_uploads(p_session_id uuid)
returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from public.proof_upload_batches where session_id=p_session_id and expires_at>now()
               and jsonb_array_length(manifest)>0)
$$;
create or replace function public.expired_proof_uploads(p_limit integer default 50)
returns table(batch_id uuid,paths text[]) language sql security definer set search_path=public as $$
 select b.id,coalesce(array_agg(u.path) filter(where u.path is not null),'{}'::text[])
 from (select * from public.proof_upload_batches pb where expires_at<=now()
       and (submission_id is null or not exists(select 1 from public.submissions where id=pb.submission_id))
       order by expires_at limit greatest(1,least(p_limit,50))) b
 left join public.proof_uploads u on u.batch_id=b.id group by b.id
$$;
revoke all on function public.has_live_proof_uploads(uuid),public.expired_proof_uploads(integer) from public,anon,authenticated;
grant execute on function public.has_live_proof_uploads(uuid),public.expired_proof_uploads(integer) to service_role;
