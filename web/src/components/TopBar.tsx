import { useEffect, useRef } from "react";
import gsap from "gsap";

interface TopBarProps {
  updatedAt: string | null;
  busy: boolean;
  onRefresh: () => void;
}

export function TopBar({ updatedAt, busy, onRefresh }: TopBarProps) {
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
  return (
    <header className="flex items-center gap-4 pb-6">
      <span className="flex items-center gap-2 rounded-full bg-panel px-3 py-1.5 text-xs tracking-[0.2em] text-lime">
        <span ref={dotRef} data-testid="live-dot" className="inline-block h-1.5 w-1.5 rounded-full bg-lime" />
        LIVE
      </span>
      {busy && <span className="text-xs text-text-3">ANALYZING…</span>}
      <div className="ml-auto flex items-center gap-4">
        {updatedAt !== null && (
          <span className="text-xs tabular-nums text-text-3">
            UPDATED {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
        <button
          onClick={onRefresh}
          className="rounded-full bg-lime px-4 py-1.5 text-xs font-medium tracking-widest text-lime-ink transition-opacity duration-150 hover:opacity-90"
        >
          REFRESH ▸
        </button>
      </div>
    </header>
  );
}
