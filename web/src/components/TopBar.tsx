import { useEffect, useRef } from "react";
import gsap from "gsap";
import type { ColorMode } from "../theme";

interface TopBarProps {
  updatedAt: string | null;
  busy: boolean;
  onRefresh: () => void;
  colorMode: ColorMode;
  onColorMode: () => void;
}

export function TopBar({ updatedAt, busy, onRefresh, colorMode, onColorMode }: TopBarProps) {
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
      <span className="flex items-center gap-2 rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs font-medium text-live">
        <span ref={dotRef} data-testid="live-dot" className="inline-block h-1.5 w-1.5 rounded-full bg-live" />
        Live
      </span>
      {busy && <span className="text-xs text-text-3">Analyzing…</span>}
      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        {updatedAt !== null && (
          <span className="data-nums text-xs text-text-3">
            Updated {new Date(updatedAt).toLocaleTimeString("en-US", { hour12: false })}
          </span>
        )}
        <button
          type="button"
          onClick={onColorMode}
          aria-label={colorMode === "day" ? "Switch to night mode" : "Switch to day mode"}
          title={colorMode === "day" ? "Night mode" : "Day mode"}
          className="grid h-8 w-8 place-items-center rounded-full border border-hairline bg-panel text-text-2 transition-colors duration-150 hover:bg-panel-2 hover:text-text-1"
        >
          {colorMode === "day" ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M13.5 10.2A5.7 5.7 0 0 1 5.8 2.5 5.7 5.7 0 1 0 13.5 10.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1.5v1M8 12.5v2M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M12.6 3.4l-.7.7M4.1 11.9l-.7.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
        <button
          onClick={onRefresh}
          className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-accent-ink transition duration-150 hover:brightness-90"
        >
          Refresh ▸
        </button>
      </div>
    </header>
  );
}
