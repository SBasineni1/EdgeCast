import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { HelpPanel } from "./HelpPanel";

interface CommandBarProps {
  updatedAt: string | null;
  threshold: number;
  onThreshold: (t: number) => void;
  onRefresh: () => void;
  busy: boolean;
}

export function CommandBar({
  updatedAt,
  threshold,
  onThreshold,
  onRefresh,
  busy,
}: CommandBarProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const dotRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce || dotRef.current === null) return;
    const pulse = gsap.to(dotRef.current, {
      autoAlpha: 0.2,
      duration: 0.8,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });
    return () => {
      pulse.kill();
    };
  }, []);
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));
  return (
    <header className="flex items-center gap-6 border-b border-hairline px-6 py-3">
      <span className="text-sm font-bold tracking-[0.35em]">EDGECAST</span>
      <span className="flex items-center gap-2 text-xs tracking-[0.2em] text-down">
        <span
          ref={dotRef}
          data-testid="live-dot"
          className="inline-block h-1.5 w-1.5 rounded-full bg-down"
        />
        LIVE
      </span>
      <div className="ml-auto flex items-center gap-4">
        {updatedAt !== null && (
          <span className="text-xs text-text-3 tabular-nums">
            UPDATED{" "}
            {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
        {busy && <span className="text-xs text-text-3">ANALYZING…</span>}
        <div className="flex items-center gap-2 text-xs">
          <span className="tracking-widest text-text-3">FLAG ≥</span>
          <button
            aria-label="decrease threshold"
            onClick={() => step(-0.01)}
            className="border border-hairline px-1.5"
          >
            −
          </button>
          <span className="w-8 text-center tabular-nums">
            {threshold.toFixed(2)}
          </span>
          <button
            aria-label="increase threshold"
            onClick={() => step(0.01)}
            className="border border-hairline px-1.5"
          >
            +
          </button>
        </div>
        <button
          onClick={onRefresh}
          className="border border-text-2 px-3 py-1 text-xs tracking-widest"
        >
          REFRESH ▸
        </button>
        <button
          onClick={() => setHelpOpen((o) => !o)}
          aria-label="help"
          aria-expanded={helpOpen}
          className="border border-hairline px-2 py-1 text-xs text-text-2"
        >
          ?
        </button>
      </div>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </header>
  );
}
