interface CommandBarProps {
  files: string[];
  selected: string | null;
  onSelect: (f: string) => void;
  threshold: number;
  onThreshold: (t: number) => void;
  onAnalyze: () => void;
  busy: boolean;
}

export function CommandBar({
  files,
  selected,
  onSelect,
  threshold,
  onThreshold,
  onAnalyze,
  busy,
}: CommandBarProps) {
  const step = (d: number) =>
    onThreshold(Math.min(1, Math.max(0, Math.round((threshold + d) * 100) / 100)));
  return (
    <header className="flex items-center gap-6 border-b border-hairline px-6 py-3">
      <span className="text-sm font-bold tracking-[0.35em]">EDGECAST</span>
      <nav className="flex gap-1" aria-label="scenario file">
        {files.length <= 4 ? (
          files.map((f) => (
            <button
              key={f}
              onClick={() => onSelect(f)}
              className={`border px-2 py-1 text-xs tracking-wider ${
                f === selected
                  ? "border-text-2 text-text-1"
                  : "border-hairline text-text-3"
              }`}
            >
              {f}
            </button>
          ))
        ) : (
          <select
            value={selected ?? ""}
            onChange={(e) => onSelect(e.target.value)}
            className="border border-hairline bg-ink px-2 py-1 text-xs"
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-4">
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
          onClick={onAnalyze}
          className="border border-text-2 px-3 py-1 text-xs tracking-widest"
        >
          ANALYZE ▸
        </button>
      </div>
    </header>
  );
}
