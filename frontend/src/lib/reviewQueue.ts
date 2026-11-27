/** Keep incoming proof FIFO even when snapshots arrive newest-first. */
export function pendingReviewQueue<T extends {id:string;status:string;submitted_at:string}>(submissions:readonly T[]):T[] {
 return submissions.filter(item=>item.status==='pending').sort((a,b)=>
  Date.parse(a.submitted_at)-Date.parse(b.submitted_at)||a.id.localeCompare(b.id));
}
