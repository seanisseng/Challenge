import type { Challenge } from "./types.ts";

// Keep these durations aligned with the card-table CSS keyframes.
export const DEAL_MS = 1100;
export const DISCARD_MS = 420;
export const STAGGER_MS = 90;

export interface TableCard {
  key: number;
  slot: number;
  challenge: Challenge;
  phase: "dealing" | "settled" | "discarding";
  endsAt: number;
  delayMs: number;
}

export interface CardTableState {
  cards: TableCard[];
  pending: Challenge[];
  visible: boolean;
  revealVersion: number;
  nextKey: number;
  slots: number;
  reducedMotion: boolean;
  discarded: number;
}

interface TableOptions {
  visible: boolean;
  revealVersion: number;
  reducedMotion: boolean;
  now: number;
}

export function createTable(): CardTableState {
  return { cards: [], pending: [], visible: false, revealVersion: 0, nextKey: 1, slots: 0, reducedMotion: false, discarded: 0 };
}

function drawWaiting(state: CardTableState, now: number): CardTableState {
  const cards = [...state.cards];
  const occupied = new Set(cards.map(card => card.slot));
  const pending = [...state.pending];
  let nextKey = state.nextKey;
  let stagger = 0;
  for (let slot = 0; slot < state.slots && pending.length; slot += 1) {
    if (occupied.has(slot)) continue;
    const delayMs = state.reducedMotion ? 0 : stagger++ * STAGGER_MS;
    cards.push({
      key: nextKey++, slot, challenge: pending.shift()!, delayMs,
      phase: state.reducedMotion ? "settled" : "dealing",
      endsAt: state.reducedMotion ? 0 : now + DEAL_MS + delayMs,
    });
  }
  return { ...state, cards: cards.sort((a, b) => a.slot - b.slot), pending, nextKey };
}

export function reconcileTable(state: CardTableState, incoming: Challenge[], options: TableOptions): CardTableState {
  const { visible, revealVersion, reducedMotion, now } = options;
  if (!visible) {
    return { ...state, cards: [], pending: [], visible, revealVersion, reducedMotion };
  }
  const reset = !state.visible || state.revealVersion !== revealVersion;
  const latest = new Map(incoming.map(challenge => [challenge.id, challenge]));
  const cards: TableCard[] = [];
  let discarded = reset ? 0 : state.discarded;
  for (const card of reset ? [] : state.cards) {
    const challenge = latest.get(card.challenge.id);
    if (challenge) {
      cards.push({
        ...card, challenge,
        phase: reducedMotion || (card.phase === "dealing" && card.endsAt <= now) ? "settled"
          : card.phase === "discarding" ? "dealing" : card.phase,
        endsAt: card.phase === "discarding" ? now + DEAL_MS : card.endsAt,
        delayMs: card.phase === "discarding" ? 0 : card.delayMs,
      });
    } else if (!reducedMotion) {
      cards.push(card.phase === "discarding" ? card : {
        ...card, phase: "discarding", endsAt: now + DISCARD_MS, delayMs: 0,
      });
    } else {
      discarded += 1;
    }
  }
  const existing = new Set(cards.map(card => card.challenge.id));
  return advanceTable({
    ...state, visible, revealVersion, reducedMotion, cards, discarded,
    slots: reset ? incoming.length : Math.max(state.slots, incoming.length),
    pending: incoming.filter(challenge => !existing.has(challenge.id)),
  }, now);
}

export function advanceTable(state: CardTableState, now: number): CardTableState {
  const cards: TableCard[] = [];
  let discarded = state.discarded;
  for (const card of state.cards) {
    if (card.phase === "discarding" && card.endsAt <= now) {
      discarded += 1;
      continue;
    }
    cards.push(card.phase === "dealing" && card.endsAt <= now
      ? { ...card, phase: "settled" } : card);
  }
  return drawWaiting({ ...state, cards, discarded }, now);
}
