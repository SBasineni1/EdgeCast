import { useState, type ReactNode } from "react";
import { HelpPanel } from "./HelpPanel";

export type View = "dashboard" | "verification" | "skill";

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 8.5 8 3l6 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 8.5V13h8V8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconVerification() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2 3 4v4c0 3 2.2 5.2 5 6 2.8-.8 5-3 5-6V4L8 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m5.8 8 1.6 1.6L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconSkill() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 13V9M8 13V5M13 13V2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconHelp() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.3 6.2c.2-1 1-1.5 1.9-1.4.9 0 1.7.7 1.7 1.6 0 1.2-1.6 1.4-1.9 2.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.8" fill="currentColor" />
    </svg>
  );
}

const NAV: { id: View; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { id: "verification", label: "Verification", icon: <IconVerification /> },
  { id: "skill", label: "Model Skill", icon: <IconSkill /> },
];

interface SidebarProps {
  view: View;
  onView: (v: View) => void;
  threshold: number;
  onThreshold: (t: number) => void;
}

export function Sidebar({ view, onView, threshold, onThreshold }: SidebarProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col gap-8 overflow-y-auto border-r border-hairline bg-panel px-5 py-7">
      <span className="font-display text-lg tracking-tight" data-anim="sidebar-item">
        <span className="font-bold">Edge</span>Cast<span className="text-lime">.</span>
      </span>
      <nav>
        <p className="pb-3 text-xs font-medium text-text-3" data-anim="sidebar-item">
          Menu
        </p>
        <ul className="flex flex-col gap-1.5">
          {NAV.map(({ id, label, icon }) => (
            <li key={id} data-anim="sidebar-item">
              <button
                onClick={() => onView(id)}
                aria-current={view === id ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm transition-colors duration-150 ${
                  view === id ? "bg-lime font-medium text-lime-ink" : "text-text-2 hover:bg-panel-2"
                }`}
              >
                {icon}
                {label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div>
        <p className="pb-3 text-xs font-medium text-text-3" data-anim="sidebar-item">
          Other
        </p>
        <button
          onClick={() => setHelpOpen((o) => !o)}
          aria-expanded={helpOpen}
          aria-label="help"
          data-anim="sidebar-item"
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm text-text-2 transition-colors duration-150 hover:bg-panel-2"
        >
          <IconHelp />
          Help Center
        </button>
      </div>
      <div className="mt-auto rounded-2xl border border-hairline p-4" data-anim="sidebar-item">
        <p className="pb-2 text-xs font-medium text-text-3">Flag ≥</p>
        <div className="flex items-center justify-between">
          <button
            aria-label="decrease threshold"
            onClick={() => step(-0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            −
          </button>
          <span className="text-sm tabular-nums">{threshold.toFixed(2)}</span>
          <button
            aria-label="increase threshold"
            onClick={() => step(0.01)}
            className="h-7 w-7 rounded-full bg-panel-2 text-text-2 transition-colors duration-150 hover:text-text-1"
          >
            +
          </button>
        </div>
      </div>
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
    </aside>
  );
}
