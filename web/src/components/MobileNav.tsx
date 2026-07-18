import { useState } from "react";
import { HelpPanel } from "./HelpPanel";
import type { View } from "./Sidebar";

interface MobileNavProps {
  view: View;
  onView: (v: View) => void;
  threshold: number;
  onThreshold: (t: number) => void;
}

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "verification", label: "Verification" },
  { id: "skill", label: "Model Skill" },
];

export function MobileNav({ view, onView, threshold, onThreshold }: MobileNavProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));

  return (
    <header
      className="flex flex-col gap-3 border-b border-hairline bg-panel px-4 py-3 lg:hidden"
      data-testid="mobile-nav"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-display text-lg tracking-tight">
          <span className="font-bold">Edge</span>Cast<span className="text-accent">.</span>
        </span>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-xs font-medium text-text-3">Flag ≥</span>
          <button
            aria-label="decrease threshold"
            onClick={() => step(-0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            −
          </button>
          <span className="data-nums">{threshold.toFixed(2)}</span>
          <button
            aria-label="increase threshold"
            onClick={() => step(0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            +
          </button>
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto">
        {NAV.map(({ id, label }) => {
          const active = view === id;
          return (
            <button
              key={id}
              onClick={() => onView(id)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink"
                  : "rounded-full px-3 py-1.5 text-sm text-text-2 hover:bg-panel-2"
              }
            >
              {label}
            </button>
          );
        })}
        <button
          onClick={() => setHelpOpen((open) => !open)}
          aria-expanded={helpOpen}
          aria-label="help"
          className="rounded-full px-3 py-1.5 text-sm text-text-2 hover:bg-panel-2"
        >
          Help Center
        </button>
      </nav>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </header>
  );
}
