-- ===========================================================================
-- 20260101000006_storage.sql
-- Private bucket for team photo proofs + storage RLS.
--
-- Object path convention:  {session_id}/{team_id}/{filename}
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'challenge-proofs',
    'challenge-proofs',
    false,
    26214400, -- 25 MiB
    array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Teams may upload into their own {session_id}/{team_id}/ prefix.
create policy "proofs_insert_own"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'challenge-proofs'
        and (storage.foldername(name))[1] = public.current_session_id()::text
        and (storage.foldername(name))[2] = public.current_team_id()::text
    );

-- Teams may read their own uploads.
create policy "proofs_select_own"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'challenge-proofs'
        and (storage.foldername(name))[2] = public.current_team_id()::text
    );

-- Admins may read and manage every proof.
create policy "proofs_admin_all"
    on storage.objects for all to authenticated
    using (bucket_id = 'challenge-proofs' and public.is_admin())
    with check (bucket_id = 'challenge-proofs' and public.is_admin());
