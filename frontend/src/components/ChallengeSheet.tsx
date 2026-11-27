import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { MapPin, MapPinned, X } from "lucide-react";
import { TierBadge } from "./Badges";
import { ChallengeImage } from "./ChallengeImage";
import { ProofStatus } from "./ChallengeCard";
import type { Challenge } from "../lib/types";
import { lockDialogScroll } from "../lib/dialogScrollLock";
import {SubmissionComposer} from './SubmissionComposer';
import {draftError} from '../lib/submissionDraft';
import type {SubmissionDraft} from '../lib/submissionDraft';

export function ChallengeSheet({ challenge, busy, error, trigger, onClose, onUpload,draft,onDraftChange,uploadProgress=0,onCancelUpload,draftStatus,draftStorageError,draftLoading=false }: {
  challenge: Challenge;
  busy: boolean;
  error: string | null;
  trigger: HTMLButtonElement | null;
  onClose: () => void;
  onUpload: (draft:SubmissionDraft) => Promise<boolean>;
  draft:SubmissionDraft;
  onDraftChange:(draft:SubmissionDraft)=>void;
  uploadProgress?:number;
  onCancelUpload?:()=>void;
  draftStatus?:string;
  draftStorageError?:boolean;
  draftLoading?:boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ y: number; time: number } | null>(null);
  const edgeStart = useRef<{ x: number; y: number } | null>(null);
  const submission = challenge.my_submission;
  const pending=submission?.status==='pending';
  const [preparing,setPreparing]=useState(false);
  const [sending,setSending]=useState(false);
  const submitLock=useRef(false);
  const submitting=busy||sending;
  const submitDisabled=preparing||submitting||draftLoading||pending||challenge.status==='claimed'||Boolean(draftError(draft));
  const close=()=>{if(!submitting)onClose();};
  const submit=async()=>{
    if(submitLock.current||submitDisabled)return;
    submitLock.current=true;setSending(true);
    let sent=false;
    try{sent=await onUpload(draft);}
    finally{
      // Keep successful submissions locked until the parent closes this sheet.
      if(!sent){submitLock.current=false;setSending(false);}
    }
  };

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const unlock = lockDialogScroll();
    return () => { element.close(); unlock(); trigger?.focus({ preventScroll: true }); };
  }, [trigger]);

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const distance = Math.max(0, event.clientY - drag.current.y);
    const velocity = distance / Math.max(1, performance.now() - drag.current.time);
    drag.current = null;
    dialog.current?.style.removeProperty("--sheet-drag-y");
    if (distance > 90 || (distance > 35 && velocity > .6)) close();
  };

  return <dialog ref={dialog} className="challenge-sheet" aria-labelledby="challenge-sheet-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onPointerDown={event => { if (event.clientX <= 24) edgeStart.current = { x: event.clientX, y: event.clientY }; }}
    onPointerUp={event => {
      const start = edgeStart.current;
      edgeStart.current = null;
      if (start && event.clientX - start.x > 80 && Math.abs(event.clientY - start.y) < 60) close();
    }}
    onPointerCancel={() => { edgeStart.current = null; }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    }}>
    <div className="sheet-drag-area" aria-hidden="true"
      onPointerDown={event => {
        if(submitting)return;
        drag.current = { y: event.clientY, time: performance.now() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (drag.current) dialog.current?.style.setProperty("--sheet-drag-y", `${Math.max(0, event.clientY - drag.current.y)}px`);
      }}
      onPointerUp={endDrag}
      onPointerCancel={() => { drag.current = null; dialog.current?.style.removeProperty("--sheet-drag-y"); }}>
      <span className="sheet-handle" />
    </div>
    <div className="sheet-topline">
      <TierBadge tier={challenge.clue_tier} />
      <ProofStatus challenge={challenge} />
      <button type="button" onClick={close} disabled={submitting} aria-label="Close challenge" className="sheet-close"><X size={22} aria-hidden="true" /></button>
    </div>
    <div className="sheet-content">
      <h2 id="challenge-sheet-title">{challenge.title}</h2>
      <p className="sheet-location"><MapPin size={16} aria-hidden="true" />{challenge.location_area ?? "Anywhere"}</p>
      {challenge.location_area && challenge.location_area.toLowerCase() !== "anywhere" ? (
        <a className="location-preview" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(challenge.location_area)}`} target="_blank" rel="noreferrer">
          <span className="location-preview-grid" aria-hidden="true"><MapPinned size={32} /></span>
          <span><strong>{challenge.location_area}</strong><span>Search area in Maps ↗</span></span>
        </a>
      ) : null}
      <ChallengeImage url={challenge.image_url} title={challenge.title} thumbnail />
      <h3>Your challenge</h3>
      <p className="sheet-description">{challenge.completion_condition}</p>
      {submission ? <p role="status" className={`sheet-proof-note ${submission.status === "rejected" ? "sheet-proof-note--rejected" : ""}`}>
        {submission.status === "pending" ? "Your proof is with the host. The challenge stays open until someone is approved."
          : submission.status === "approved" ? "Approved. Your clue is unlocked."
          : `Rejected${submission.review_note ? `: ${submission.review_note}` : ". You can try again."}`}
      </p> : null}
      {error ? <p role="alert" className="sheet-error">{error}</p> : null}
      {!pending?<SubmissionComposer draft={draft} onChange={onDraftChange} onPreparingChange={setPreparing} disabled={submitting||draftLoading||challenge.status==='claimed'}/>:null}
      {!pending&&draftStatus?<p className="proof-limits" role={draftStorageError?'alert':'status'}>{draftStatus}</p>:null}
    </div>
    <div className="sheet-actions">
      <div className="proof-submit-actions">
      <button type="button" className="btn-primary min-h-12" disabled={submitDisabled} aria-busy={submitting}
        onClick={()=>void submit()}>
        {pending?'Awaiting host review':submitting?'Sending…':'Submit'}
      </button></div>
      {submitting?<div className="proof-upload-status"><progress max={100} value={uploadProgress} aria-label="Upload progress"/>
        <p role="status">{uploadProgress<100?`Uploading and verifying: ${uploadProgress}%`:'Uploads verified. Saving your proof…'}</p>
        <button type="button" className="btn-secondary" onClick={onCancelUpload}>Cancel upload</button>
      </div>:null}
      <p>First approved submission wins the clue.</p>
    </div>
  </dialog>;
}
