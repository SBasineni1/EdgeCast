import { useId } from "react";

interface ProbBarProps {
  label: string;
  value: number; // 0..1
  variant: "solid" | "hatched";
}

export function ProbBar({ label, value, variant }: ProbBarProps) {
  const patternId = useId().replace(/:/g, "");
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 10000) / 100;
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs tracking-[0.2em] text-text-2">
        {label}
      </span>
      <svg
        className="h-3 flex-1"
        preserveAspectRatio="none"
        role="meter"
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={1}
      >
        {variant === "hatched" && (
          <defs>
            <pattern
              id={patternId}
              width="5"
              height="5"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="2" height="5" fill="var(--color-text-2)" />
            </pattern>
          </defs>
        )}
        <rect
          width="100%"
          height="100%"
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth="1"
        />
        <rect
          height="100%"
          width={`${pct}%`}
          fill={variant === "solid" ? "var(--color-text-2)" : `url(#${patternId})`}
          style={{ transition: "width 200ms ease-out" }}
          data-testid="probbar-fill"
        />
      </svg>
      <span className="w-12 shrink-0 text-right text-sm tabular-nums">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
