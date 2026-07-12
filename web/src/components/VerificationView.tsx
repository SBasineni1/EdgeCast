import type { VerificationInfo } from "../types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-sm">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div className="pt-1 font-display text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface VerificationViewProps {
  verification: VerificationInfo | null | undefined;
}

export function VerificationView({ verification }: VerificationViewProps) {
  if (verification == null) {
    return (
      <p className="rounded-2xl border border-hairline bg-panel p-5 text-sm text-text-3 shadow-sm">
        No verification data yet — run: uv run edgecast backfill
      </p>
    );
  }
  const coverage = verification.coverage ?? [];
  const nMissing = coverage.filter((c) => !c.graded).length;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Window" value={`${verification.window_days}D`} />
        <Stat label="Markets checked" value={`${verification.n_markets}`} />
        <Stat label="Days graded" value={`${verification.n_days} / ${verification.window_days}`} />
      </div>
      {coverage.length > 0 && (
        <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm">
          <div className="flex items-center justify-between pb-3">
            <p className="text-xs font-medium text-text-3">Coverage — last {verification.window_days} days</p>
            <div className="flex items-center gap-4 text-xs text-text-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-lime" aria-hidden="true" />
                Graded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-panel-2 ring-1 ring-hairline" aria-hidden="true" />
                No data
              </span>
            </div>
          </div>
          <div className="flex gap-1" data-testid="coverage-strip">
            {coverage.map((c) => (
              <span
                key={c.date}
                title={`${c.date} — ${c.graded ? "graded" : "no data"}`}
                data-testid={c.graded ? "coverage-day" : "coverage-day-missing"}
                className={`h-6 min-w-0 flex-1 rounded ${c.graded ? "bg-lime" : "bg-panel-2"}`}
              />
            ))}
          </div>
          <div className="flex justify-between pt-1.5 text-[11px] tabular-nums text-text-3">
            <span>{coverage[0]?.date}</span>
            <span>{coverage[coverage.length - 1]?.date}</span>
          </div>
          {nMissing > 0 && (
            <p className="pt-3 text-xs text-text-3">
              Ungraded days are usually older than the ensemble archive reaches (~2 weeks) — they
              can't be verified and are skipped rather than retried.
            </p>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm">
        <p className="pb-3 text-xs font-medium text-text-3">Kalshi mismatches</p>
        {verification.kalshi_mismatches.length === 0 ? (
          <p className="text-sm text-text-3" data-testid="no-mismatches">
            None — every settled market matches the official observation
          </p>
        ) : (
          verification.kalshi_mismatches.map((m) => (
            <p key={m.market_id} className="text-sm text-down" data-testid="mismatch-warning">
              ⚠︎ KALSHI SETTLED {m.kalshi_result.toUpperCase()} — EDGECAST COMPUTES{" "}
              {m.edgecast_outcome === 1 ? "YES" : "NO"} ({m.market_id})
            </p>
          ))
        )}
      </section>
      <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm">
        <p className="pb-3 text-xs font-medium text-text-3">Fetch failures</p>
        {verification.verification_failed.length === 0 ? (
          <p className="text-sm text-text-3" data-testid="no-failures">
            None — verification data is current
          </p>
        ) : (
          verification.verification_failed.map((f, i) => (
            <p key={`${f.city}-${f.stage}-${i}`} className="break-all text-sm text-text-3">
              {f.city} · {f.stage} · {f.reason}
            </p>
          ))
        )}
      </section>
    </div>
  );
}
