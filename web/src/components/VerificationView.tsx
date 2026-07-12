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
      <p className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm text-sm text-text-3">
        NO VERIFICATION DATA YET — run: uv run edgecast backfill
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Window" value={`${verification.window_days}D`} />
        <Stat label="Markets checked" value={`${verification.n_markets}`} />
        <Stat label="Days graded" value={`${verification.n_days}`} />
      </div>
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
