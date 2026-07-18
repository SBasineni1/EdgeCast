import type { SnapshotsInfo, VerificationInfo } from "../types";
import { formatDate, formatPercent, formatSigned } from "../format";

function MetaStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 first:pl-0 last:pr-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-text-3">{label}</div>
      <div className="data-nums pt-1 text-lg font-medium">{value}</div>
    </div>
  );
}

function VerificationHero({ verification, snapshots }: { verification: VerificationInfo; snapshots?: SnapshotsInfo | null }) {
  const scored = snapshots != null && snapshots.n_scored > 0;
  const modelRate = scored ? snapshots.model_hits / snapshots.n_scored : null;
  const marketRate = scored ? snapshots.market_hits / snapshots.n_scored : null;
  const lead = modelRate !== null && marketRate !== null ? (modelRate - marketRate) * 100 : null;
  const leadTone = lead === null || lead === 0 ? "text-text-1" : lead > 0 ? "text-up" : "text-down";
  return (
    <section className="grid gap-6 border-y border-hairline py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-text-3">
          Day-ahead skill vs market
        </p>
        {lead !== null && modelRate !== null && marketRate !== null ? (
          <>
            <div className="flex items-baseline gap-2 pt-1">
              <span className={`data-nums text-4xl font-medium tracking-tight ${leadTone}`} data-testid="skill-lead">
                {lead === 0 ? "0.0" : formatSigned(lead, 1)} pp
              </span>
            </div>
            <p className="data-nums pt-1 text-sm text-text-2" data-testid="snapshot-score">
              Model {formatPercent(modelRate, 1)} · market {formatPercent(marketRate, 1)} · n={snapshots!.n_scored}
            </p>
          </>
        ) : (
          <>
            <p className="pt-1 font-display text-2xl font-medium">Awaiting first scored snapshot</p>
            <p className="pt-1 text-sm text-text-3">Skill appears after a frozen ladder settles.</p>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 divide-x divide-hairline">
        <MetaStat label="Window" value={`${verification.window_days}D`} />
        <MetaStat label="Markets" value={`${verification.n_markets}`} />
        <MetaStat label="Coverage" value={`${verification.n_days}/${verification.window_days}`} />
      </div>
    </section>
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
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-baseline justify-between pb-1">
        <p className="text-xs font-medium text-text-3">Day-ahead snapshots · 11 AM ET</p>
        {s.n_pending > 0 && (
          <span className="data-nums text-xs text-text-3">
            {s.n_pending} awaiting settlement
          </span>
        )}
      </div>
      <SnapshotStatus s={s} />
      {s.n_scored > 0 ? (
        <>
          <div className="flex flex-col pt-4">
            {s.days.map((d) => (
              <div
                key={d.event_date}
                className="data-nums flex items-baseline justify-between border-b border-hairline py-2 text-sm last:border-0"
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
      <p className="rounded-xl border border-hairline bg-panel p-5 text-sm text-text-3">
        No verification data yet — run: uv run edgecast backfill
      </p>
    );
  }
  const coverage = verification.coverage ?? [];
  const nMissing = coverage.filter((c) => !c.graded).length;
  return (
    <div className="flex flex-col gap-6">
      <VerificationHero verification={verification} snapshots={snapshots} />
      {snapshots != null && <SnapshotCard s={snapshots} />}
      {coverage.length > 0 && (
        <section className="rounded-xl border border-hairline bg-panel p-5">
          <div className="flex items-center justify-between pb-3">
            <p className="text-xs font-medium text-text-3">Coverage — last {verification.window_days} days</p>
            <div className="flex items-center gap-4 text-xs text-text-2">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-coverage" aria-hidden="true" />
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
                className={`h-6 min-w-0 flex-1 rounded ${c.graded ? "bg-coverage" : "bg-panel-2"}`}
              />
            ))}
          </div>
          <div className="data-nums flex justify-between pt-1.5 text-[11px] text-text-3">
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
    </div>
  );
}
