import { BadgeCheck, ChevronRight, Circle, Clock3, MapPin, Ticket, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import type { TableCard } from "../lib/cardTable";
import type { Challenge } from "../lib/types";

export function proofStatus(challenge: Challenge) {
  if (challenge.status === "claimed" || challenge.my_submission?.status === "approved") return "approved";
  if (challenge.my_submission?.status === "pending") return "submitted";
  if (challenge.my_submission?.status === "rejected") return "rejected";
  return "open";
}

const STATUS = {
  open: { label: "Open", Icon: Circle },
  submitted: { label: "Submitted", Icon: Clock3 },
  approved: { label: "Approved", Icon: BadgeCheck },
  rejected: { label: "Rejected", Icon: X },
};

export function ProofStatus({ challenge }: { challenge: Challenge }) {
  const status = proofStatus(challenge);
  if (status === "open") return null;
  const { label, Icon } = STATUS[status];
  return <span className={`proof-status proof-status--${status}`}>
    <Icon size={16} aria-hidden="true" /><span>{label}</span>
  </span>;
}

export function CardBack() {
  return <span className="flop-card-back" aria-hidden="true"><span><Ticket size={24} /><b>THE<br />HUNT</b><span>RACE CONTROL</span></span></span>;
}

interface DrawMotion {
  left: number; top: number; width: number; height: number;
  x: number; y: number; scaleX: number; scaleY: number;
}

export function ChallengeCard({ card, deck, onOpen }: { card: TableCard; deck: RefObject<HTMLDivElement>; onOpen: (trigger: HTMLButtonElement) => void }) {
  const { challenge, phase, slot, delayMs } = card;
  const element = useRef<HTMLLIElement>(null);
  const [motion, setMotion] = useState<DrawMotion | null>(null);
  const angle = [-2, 1, -1, 1.5, -1, 2][slot % 6];

  useLayoutEffect(() => {
    if (phase !== "dealing" || !element.current || !deck.current) { setMotion(null); return; }
    const target = element.current.getBoundingClientRect();
    const source = deck.current.getBoundingClientRect();
    const viewport = element.current.closest(".challenge-list")?.getBoundingClientRect();
    if (!target.width || !source.width || (viewport && (target.bottom <= viewport.top || target.top >= viewport.bottom))) return;
    setMotion({ left: target.left, top: target.top, width: target.width, height: target.height,
      x: source.left + source.width / 2 - target.left - target.width / 2,
      y: source.top + source.height / 2 - target.top - target.height / 2,
      scaleX: source.width / target.width, scaleY: source.height / target.height });
    // A moving viewport invalidates the captured path. The real card still settles.
    const cancel = () => setMotion(null);
    window.addEventListener("resize", cancel);
    window.addEventListener("scroll", cancel, true);
    return () => { window.removeEventListener("resize", cancel); window.removeEventListener("scroll", cancel, true); };
  }, [phase, deck]);

  const rank = { tier1: "I", tier2: "II", tier3: "III" }[challenge.clue_tier];
  return <li ref={element} data-challenge-id={challenge.id} className={`flop-slot flop-slot--${phase}`} style={{ "--deal-delay": `${delayMs}ms`, "--rest-angle": `${angle}deg` } as CSSProperties}>
    <button type="button" disabled={phase !== "settled"} className={`challenge-card challenge-ticket challenge-ticket--${challenge.clue_tier} challenge-card--${challenge.clue_tier}`} onClick={event => onOpen(event.currentTarget)}>
      <span className="flop-card-inner">
        <CardBack />
        <span className="flop-card-front">
      <span className="ticket-card-topline">
        <span className={`card-tier-stamp tier-stamp tier-stamp--${challenge.clue_tier}`} aria-label={`Tier ${challenge.clue_tier.slice(-1)}`}>{rank}</span>
        <ProofStatus challenge={challenge} />
      </span>
      <span className="ticket-card-title">{challenge.title}</span>
      <span className="ticket-card-footer">
        <MapPin size={18} aria-hidden="true" />
        <span className="ticket-card-area"><span>AREA</span><span className="ticket-card-location">{challenge.location_area ?? "Anywhere"}</span></span>
        <ChevronRight size={16} aria-hidden="true" />
      </span>
        </span>
      </span>
    </button>
    {motion ? createPortal(<div className="deck-draw-flight" aria-hidden="true" data-challenge-id={challenge.id}
      style={{ left: motion.left, top: motion.top, width: motion.width, height: motion.height,
        "--draw-x": `${motion.x}px`, "--draw-y": `${motion.y}px`, "--draw-scale-x": motion.scaleX,
        "--draw-scale-y": motion.scaleY, "--deal-delay": `${delayMs}ms`, "--rest-angle": `${angle}deg` } as CSSProperties}
      onAnimationEnd={() => setMotion(null)}><CardBack /></div>, document.body) : null}
  </li>;
}
