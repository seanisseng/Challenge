import { useId, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, renameTeam } from "../lib/api";
import { RaceDialog } from "./RaceDialog";

export function TeamNameDialog({name,onClose,onSaved}: {name:string;onClose:()=>void;onSaved:()=>void}) {
  const [draft,setDraft]=useState(name);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string | null>(null);
  const formId=useId();
  const submit=async (event:FormEvent) => {
    event.preventDefault();
    if(busy || !draft.trim()) return;
    setBusy(true); setError(null);
    try {await renameTeam(draft);onSaved();}
    catch(error) {setError(error instanceof ApiError ? error.message : "Could not change your team name.");setBusy(false);}
  };
  return <RaceDialog title="Change team name" eyebrow="RACE CONTROL / YOUR TEAM" onClose={()=>{if(!busy) onClose();}}
    footer={<><button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" form={formId} className="btn-primary" disabled={busy || !draft.trim() || draft.trim()===name}>{busy ? "Saving..." : "Save team name"}</button></>}>
    <form id={formId} onSubmit={event=>void submit(event)}>
      <p>Everyone on your team can change this name. Your team code, clues and progress stay the same.</p>
      <label className="mt-4 block">Team name<input className="field mt-2 w-full" value={draft} onChange={event=>setDraft(event.target.value)} maxLength={40} required autoComplete="off" /></label>
      {error ? <p className="mt-3" role="alert">{error}</p> : null}
    </form>
  </RaceDialog>;
}
