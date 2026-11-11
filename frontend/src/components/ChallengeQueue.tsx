import { useEffect, useRef, useState } from "react";
import type { PointerEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Inbox, LockKeyhole } from "lucide-react";

import { TierBadge } from "./Badges";
import { reorderQueue } from "../lib/api";
import { moveQueueItem } from "../lib/queueOrder";
import type { Challenge } from "../lib/types";

interface Drag {
  id: string;
  pointerId: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  original: string[];
  order: string[];
}

export function ChallengeQueue({ queue, sessionId, disabled, renderRemove, onAction, onDraggingChange }: {
  queue: Challenge[];
  sessionId: string;
  disabled: boolean;
  renderRemove: (challenge: Challenge) => ReactNode;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  onDraggingChange: (dragging: boolean) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const ids = queue.map(card => card.id);
  const fingerprint = ids.join("|");
  const latestFingerprint = useRef(fingerprint);
  latestFingerprint.current = fingerprint;
  const [preview, setPreview] = useState<string[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const stopDrag = () => {
    const previous = drag.current;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (previous && list.current?.hasPointerCapture(previous.pointerId)) {
      list.current.releasePointerCapture(previous.pointerId);
    }
    setDraggingId(null);
    onDraggingChange(false);
    return previous;
  };

  useEffect(() => {
    if (drag.current && drag.current.original.join("|") !== fingerprint) {
      stopDrag();
      setPreview(null);
      setAnnouncement("The queue changed. Your drag was cancelled; try again.");
    }
    // The fingerprint is the server order; local previews must not cancel a drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const save = async (order: string[], original: string[]) => {
    if (disabled || order.join("|") === original.join("|")) {
      setPreview(null);
      return;
    }
    try {
      await onAction(async () => {
        await reorderQueue(sessionId, order, original);
        setAnnouncement("Queue order saved.");
      });
    } finally {
      setPreview(null);
    }
  };

  const previewAtPointer = () => {
    const current = drag.current;
    const element = list.current;
    if (!current?.active || !element) return;
    const bounds = element.getBoundingClientRect();
    if (current.x < bounds.left - 24 || current.x > bounds.right + 24) return;
    const rows = Array.from(element.querySelectorAll<HTMLElement>("[data-queue-id]"));
    const target = rows.find(row => {
      const rect = row.getBoundingClientRect();
      return current.y >= rect.top && current.y <= rect.bottom;
    }) ?? (current.y < bounds.top ? rows[0] : current.y > bounds.bottom ? rows[rows.length - 1] : undefined);
    if (!target?.dataset.queueId || target.dataset.queueId === current.id) return;
    const rect = target.getBoundingClientRect();
    const order = moveQueueItem(current.order, current.id, target.dataset.queueId, current.y > rect.top + rect.height / 2);
    if (order.join("|") !== current.order.join("|")) {
      current.order = order;
      setPreview(order);
    }
  };

  const scrollWhileDragging = () => {
    const current = drag.current;
    if (!current) return;
    if (current.active) {
      const distance = current.y < 145 ? -Math.min(14, (145 - current.y) / 6)
        : current.y > window.innerHeight - 80 ? Math.min(14, (current.y - window.innerHeight + 80) / 6) : 0;
      if (distance) {
        window.scrollBy(0, distance);
        previewAtPointer();
      }
    }
    frame.current = requestAnimationFrame(scrollWhileDragging);
  };

  const startDrag = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (disabled || drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.focus();
    drag.current = { id, pointerId: event.pointerId, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, original: ids, order: ids };
    list.current?.setPointerCapture(event.pointerId);
    frame.current = requestAnimationFrame(scrollWhileDragging);
  };

  const finishDrag = () => {
    const bounds = list.current?.getBoundingClientRect();
    const current = stopDrag();
    if (!current?.active) return;
    const validDrop = bounds && current.x >= bounds.left - 24 && current.x <= bounds.right + 24
      && current.y >= bounds.top - 32 && current.y <= bounds.bottom + 32;
    if (!validDrop || latestFingerprint.current !== current.original.join("|")) {
      setPreview(null);
      setAnnouncement("Drag cancelled. The saved queue was kept.");
      return;
    }
    void save(current.order, current.original);
  };

  const moveBy = (id: string, direction: -1 | 1) => {
    const index = ids.indexOf(id);
    const target = ids[index + direction];
    if (!target || disabled || drag.current) return;
    const order = moveQueueItem(ids, id, target, direction === 1);
    setPreview(order);
    void save(order, ids);
  };

  const byId = new Map(queue.map(card => [card.id, card]));
  const ordered = (preview ?? ids).map(id => byId.get(id)).filter((card): card is Challenge => Boolean(card));

  return (
    <aside className="race-queue">
      <div className="board-section-heading"><div><span className="race-section-index">02</span><h3>UP NEXT</h3></div><span className="queue-total">{String(queue.length).padStart(2, "0")} queued</span></div>
      <p id="queue-drag-help" className="queue-instructions">
        Drag to set the next move. Use the arrows or arrow keys on a grip, too.
      </p>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {queue.length === 0 ? <div className="race-empty queue-empty"><Inbox size={28} aria-hidden="true" /><h4>The queue is empty.</h4><p>Every available challenge is in play or has left this race.</p></div> : (
        <ol ref={list} className="race-queue-list"
          onPointerMove={event => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) return;
            current.x = event.clientX;
            current.y = event.clientY;
            if (!current.active && Math.abs(current.y - current.startY) > 6) {
              current.active = true;
              setDraggingId(current.id);
              onDraggingChange(true);
              setAnnouncement("Dragging challenge. Release to save, or press Escape to cancel.");
            }
            if (current.active) { event.preventDefault(); previewAtPointer(); }
          }}
          onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) finishDrag(); }}
          onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { stopDrag(); setPreview(null); } }}
          onLostPointerCapture={() => { if (drag.current) { stopDrag(); setPreview(null); } }}
          onKeyDown={event => {
            if (event.key === "Escape" && drag.current) {
              event.preventDefault(); stopDrag(); setPreview(null); setAnnouncement("Drag cancelled.");
            }
          }}>
          {(showAll ? ordered : ordered.slice(0, 6)).map((challenge, index) => (
            <li key={challenge.id} data-queue-id={challenge.id}
              className={`queue-row ${draggingId === challenge.id ? "queue-row--dragging" : ""}`}>
              <button type="button" aria-label={`Drag ${challenge.title} to reorder`} aria-describedby="queue-drag-help"
                className="queue-grip" disabled={disabled} style={{ touchAction: "none" }}
                onPointerDown={event => startDrag(event, challenge.id)}
                onKeyDown={event => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault(); moveBy(challenge.id, event.key === "ArrowUp" ? -1 : 1);
                  }
                }}><GripVertical size={16} aria-hidden="true" /><span className="queue-position">{String(index + 1).padStart(2, "0")}</span></button>
              <div className="queue-row-copy">
                <TierBadge tier={challenge.clue_tier} />
                <p className="queue-title">{challenge.title}</p>
                <p className="queue-condition">{challenge.completion_condition}</p>
              </div>
              <div className="queue-row-controls">
                {renderRemove(challenge)}
                <button type="button" className="queue-step" disabled={disabled || draggingId !== null || index === 0}
                  aria-label={`Move ${challenge.title} up`} onClick={() => moveBy(challenge.id, -1)}><ArrowUp size={15} aria-hidden="true" /></button>
                <button type="button" className="queue-step" disabled={disabled || draggingId !== null || index === ids.length - 1}
                  aria-label={`Move ${challenge.title} down`} onClick={() => moveBy(challenge.id, 1)}><ArrowDown size={15} aria-hidden="true" /></button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {queue.length > 6 ? (
        <button type="button" disabled={draggingId !== null} onClick={() => setShowAll(!showAll)} className="btn-secondary queue-showall">
          {showAll ? "Show next 6" : `Show all ${queue.length}`}
        </button>
      ) : null}
      <p className="queue-private-note"><LockKeyhole size={12} aria-hidden="true" /> HOST ONLY. TEAMS SEE THE LIVE BOARD.</p>
    </aside>
  );
}
