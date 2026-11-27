-- Preserve the existing claim/reward functions and their lock order. Return
-- the session in the same round trip; retries never grant a second clue.
create or replace function public.review_submission(
    p_submission_id uuid, p_status text, p_note text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_session uuid; v_status text;
begin
    if p_status is null or p_status not in ('approved','rejected') then
        raise exception 'Invalid review status';
    end if;
    select session_id into v_session from public.submissions where id=p_submission_id;
    if not found then raise exception 'Submission not found'; end if;
    -- Session first, matching the existing approval lock order.
    perform id from public.game_sessions where id=v_session for update;
    if not found then raise exception 'Session not found'; end if;
    select status into v_status from public.submissions where id=p_submission_id;
    if not found then raise exception 'Submission not found'; end if;
    if v_status=p_status then return v_session; end if;
    if p_status='approved' then
        perform public.approve_submission(p_submission_id,p_note);
    else
        perform public.reject_submission(p_submission_id,p_note);
    end if;
    return v_session;
end $$;
revoke all on function public.review_submission(uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_submission(uuid,text,text) to service_role;
