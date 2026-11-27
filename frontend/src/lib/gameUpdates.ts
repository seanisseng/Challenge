import type {AdminState,TeamState} from './types';

export interface TeamGameUpdate {
 kind:'team_update';session_id:string;team_id:string;
 changes:Pick<TeamState,'session'|'board'|'progress'|'clues'|'clue_awards'|'my_submissions'>;
}
export interface AdminGameUpdate {
 kind:'admin_update';session_id:string;
 changes:Pick<AdminState,'session'|'board'|'queue'|'progress'|'submissions'>;
}
export function mergeTeamGameUpdate(state:TeamState,event:TeamGameUpdate):TeamState {
 return event.session_id===state.session.id&&event.team_id===state.team.id?{...state,...event.changes}:state;
}
export function mergeAdminGameUpdate(state:AdminState,event:AdminGameUpdate):AdminState {
 return event.session_id===state.session.id?{...state,...event.changes}:state;
}
