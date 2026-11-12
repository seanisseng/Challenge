import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";

export type StickerTier = "1" | "2" | "3";

/** The clue ticket, scaled for a team's collection. Existing awards never replay. */
export function TierSticker({ tier, state, count, size = "sm" }: {
  tier: StickerTier; state: "earned" | "empty"; count: number; size?: "sm" | "md";
}) {
  const previous = useRef(state === "earned" ? count : 0);
  const [slapping, setSlapping] = useState(false);
  useEffect(() => {
    const next = state === "earned" ? count : 0;
    const animate = next > previous.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    previous.current = next;
    setSlapping(animate);
    if (animate) {
      const timer = window.setTimeout(() => setSlapping(false), 340);
      return () => window.clearTimeout(timer);
    }
  }, [state, count]);
  return <span role="img" aria-label={`Tier ${tier} sticker, ${state === "earned" ? `${count} earned` : "not yet earned"}`}
    className={`tier-sticker tier-sticker--${tier} tier-sticker--${state} tier-sticker--${size}${slapping ? " tier-sticker--slap" : ""}`}
    onAnimationEnd={() => setSlapping(false)}>
    <span className="tier-sticker-number" aria-hidden="true">{tier}</span>
    <span className="tier-sticker-copy" aria-hidden="true"><span>TIER {tier}</span>
      <span className="tier-sticker-chevrons">{Array.from({ length: Number(tier) }, (_, i) => <ChevronRight key={i} size={10} strokeWidth={3} />)}</span>
    </span>
    {state === "earned" && count > 1 ? <span className="tier-sticker-count" aria-hidden="true">x{count}</span> : null}
  </span>;
}

export function TeamLabelSticker({ label }: { label: "YOU" | "FINISHED" | "LEADING" }) {
  return <span className={`team-label-sticker team-label-sticker--${label.toLowerCase()}`}>{label}</span>;
}
