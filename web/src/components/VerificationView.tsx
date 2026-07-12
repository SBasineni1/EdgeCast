import type { SnapshotsInfo, VerificationInfo } from "../types";
import { formatDate } from "../format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-sm">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div className="pt-1 font-display text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

function SnapshotStatus({ s }: { s: SnapshotsInfo }) {
  if (s.taken_at !== null && s.pending_event_date !== null) {
    const at = new Date(s.taken_at).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    });
    return (
      <p className="text-sm text-text-2" data-testid="snapshot-status">
        Tomorrow's ladder ({formatDate(s.pending_event_date)}) frozen at {at} ET
      </p>
    );
  }
  return (
    <p className="text-sm text-text-3" data-testid="snapshot-status">
      Next capture after 11:00 AM ET — an hour after tomorrow's markets open
    </p>
  );
}

function SnapshotCard({ s }: { s: SnapshotsInfo }) {
  return (
    <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm">
      <div className="flex items-baseline justify-between pb-1">
        <p className="text-xs font-medium text-text-3">Day-ahead snapshots · 11 AM ET</p>
        {s.n_pending > 0 && (
          <span className="text-xs tabular-nums text-text-3">
            {s.n_pending} awaiting settlement
          </span>
        )}
      </div>
      <SnapshotStatus s={s} />
      {s.n_scored > 0 ? (
        <>
          <div className="flex gap-3 pt-4" data-testid="snapshot-score">
            <span className="rounded-full bg-up/10 px-3 py-1 text-sm tabular-nums text-up">
              Model {s.model_hits}/{s.n_scored}
            </span>
            <span className="rounded-full bg-panel-2 px-3 py-1 text-sm tabular-nums text-text-2">
              Market at snapshot {s.market_hits}/{s.n_scored}
            </span>
          </div>
          <div className="flex flex-col pt-3">
            {s.days.map((d) => (
              <div
                key={d.event_date}
                className="flex items-baseline justify-between border-b border-hairline py-2 text-sm tabular-nums last:border-0"
                data-testid="snapshot-day"
              >
                <span className="text-text-2">{formatDate(d.event_date)}</span>
                <span className="text-text-2">
                  model {d.model_hits}/{d.n} · market {d.market_hits}/{d.n}
                </span>
              </div>
            ))}
          </div>
          <p className="pt-3 text-xs text-text-3">
            A hit means the bucket ranked highest more than 24 hours ahead is the one that
            settled YES.
          </p>
        </>
      ) : (
        <p className="pt-3 text-xs text-text-3" data-testid="snapshot-empty">
          No snapshots scored yet — a frozen ladder scores once its day settles, so the
          first results appear the evening after the first 11 AM capture.
        </p>
      )}
    </section>
  );
}

interface VerificationViewProps {
  verification: VerificationInfo | null | undefined;
  snapshots?: SnapshotsInfo | null;
}

export function VerificationView({ verification, snapshots }: VerificationViewProps) {
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
      {snapshots != null && <SnapshotCard s={snapshots} />}
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
