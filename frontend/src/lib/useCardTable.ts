import { useEffect, useLayoutEffect, useState } from "react";

import { advanceTable, createTable, reconcileTable } from "./cardTable";
import type { Challenge } from "./types";

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    update();
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useCardTable(board: Challenge[], visible: boolean, revealVersion: number) {
  const reducedMotion = useReducedMotion();
  const [table, setTable] = useState(createTable);

  useLayoutEffect(() => {
    setTable(previous => reconcileTable(previous, board, {
      visible, revealVersion, reducedMotion, now: performance.now(),
    }));
  }, [board, visible, revealVersion, reducedMotion]);

  useEffect(() => {
    const deadlines = table.cards.filter(card => card.phase !== "settled").map(card => card.endsAt);
    if (!deadlines.length) return;
    const timer = window.setTimeout(() => {
      setTable(previous => advanceTable(previous, performance.now()));
    }, Math.max(0, Math.min(...deadlines) - performance.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [table]);

  return table;
}
