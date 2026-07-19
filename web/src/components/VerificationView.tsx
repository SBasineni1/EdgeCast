import { useState } from "react";
import type { BlendModelInfo, EdgeCallInfo, RealizationInfo, SnapshotsInfo, VerificationInfo } from "../types";
import { formatDate, formatPercent, formatSigned, formatTemperature, shortRangeLabel } from "../format";

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

function EdgeCallRow({ c }: { c: EdgeCallInfo }) {
  const settled = c.outcome !== null;
  const verdictTone = c.model_right === null ? "text-text-3" : c.model_right ? "text-up" : "text-down";
  const verdict = c.model_right === null ? "open" : c.model_right ? "Model ✓" : "Market ✓";
  return (
    <div
      className="data-nums flex items-baseline gap-2 border-b border-hairline py-1.5 text-sm last:border-0"
      data-testid={settled ? "edge-call" : "edge-call-pending"}
    >
      <span className="shrink-0 text-xs text-text-3">{formatDate(c.event_date)}</span>
      <span className="min-w-0 flex-1 truncate text-text-2" title={c.question}>
        {c.city} <span className="text-text-1">{shortRangeLabel(c)}°</span>
      </span>
      <span
        className={`shrink-0 ${c.edge > 0 ? "text-up" : "text-down"}`}
        title={`model ${formatPercent(c.model_prob)} vs market ${formatPercent(c.market_prob)}`}
      >
        {formatSigned(c.edge * 100, 1)} pp
      </span>
      <span className="w-8 shrink-0 text-right text-xs text-text-3">
        {settled ? (c.outcome === 1 ? "YES" : "NO") : ""}
      </span>
      <span className={`w-16 shrink-0 text-right text-xs font-medium ${verdictTone}`} data-testid="edge-verdict">
        {verdict}
      </span>
    </div>
  );
}

const REALIZATION_PREVIEW_ROWS = 14;

function RealizationCard({ r }: { r: RealizationInfo }) {
  const [expanded, setExpanded] = useState(false);
  const rate = r.n_settled > 0 ? r.n_model_right / r.n_settled : null;
  const rateTone = rate === null ? "text-text-1" : rate > 0.5 ? "text-up" : rate < 0.5 ? "text-down" : "text-text-1";
  const settled = expanded ? r.settled : r.settled.slice(0, REALIZATION_PREVIEW_ROWS);
  const hidden = r.settled.length - settled.length;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5" data-testid="edge-realization">
      <div className="flex items-baseline justify-between pb-1">
        <p className="text-xs font-medium text-text-3">
          Edge realization · disagreements ≥ {formatPercent(r.threshold)} at freeze
        </p>
        {r.mean_brier_edge !== null && (
          <span className="data-nums text-xs text-text-3" title="mean Brier improvement over the market, per settled disagreement">
            {formatSigned(r.mean_brier_edge, 3)} Brier
          </span>
        )}
      </div>
      {r.n_settled > 0 ? (
        <p className="pt-1 text-sm text-text-2" data-testid="realization-score">
          Model right on{" "}
          <span className={`data-nums font-medium ${rateTone}`}>
            {r.n_model_right} of {r.n_settled}
          </span>{" "}
          settled disagreements{rate !== null && <> · <span className={`data-nums ${rateTone}`}>{formatPercent(rate)}</span></>}
        </p>
      ) : (
        <p className="pt-1 text-sm text-text-3" data-testid="realization-empty">
          No settled disagreements yet — calls score once their frozen ladder settles.
        </p>
      )}
      {settled.length > 0 && (
        <div className="grid pt-3 sm:grid-cols-2 sm:gap-x-8">
          {settled.map((c) => <EdgeCallRow key={c.market_id} c={c} />)}
        </div>
      )}
      {(hidden > 0 || expanded) && (
        <button
          type="button"
          className="cursor-pointer pt-2 text-xs font-medium text-text-3 hover:text-text-1"
          onClick={() => setExpanded(!expanded)}
          data-testid="realization-toggle"
        >
          {expanded ? "Show fewer" : `Show all ${r.settled.length} settled calls`}
        </button>
      )}
      {r.pending.length > 0 && (
        <>
          <p className="pt-4 text-xs font-medium text-text-3">Awaiting settlement</p>
          <div className="grid pt-1 sm:grid-cols-2 sm:gap-x-8">
            {r.pending.map((c) => <EdgeCallRow key={c.market_id} c={c} />)}
          </div>
        </>
      )}
      <p className="pt-3 text-xs text-text-3">
        A disagreement is scored from the probabilities frozen at 11 AM ET the day before —
        whoever gave more probability to the settled outcome was right.
      </p>
    </section>
  );
}

function ActiveModelCard({ m }: { m: BlendModelInfo | null | undefined }) {
  const validated = m != null && m.candidate_mae !== null && m.baseline_mae !== null;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5" data-testid="active-model">
      <p className="pb-1 text-xs font-medium text-text-3">Active forecast model</p>
      {m != null ? (
        <>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-medium">Learned blend</span>
            <span className="data-nums text-xs text-text-3">gbm-v{m.id}</span>
          </div>
          <p className="data-nums pt-1 text-sm text-text-2">
            Trained on {m.n_rows} market-days through {formatDate(m.train_end_date)} · promoted{" "}
            {formatDate(m.promoted_at.slice(0, 10))}
          </p>
          {validated && (
            <p className="data-nums pt-1 text-sm text-text-2" data-testid="active-model-validation">
              Validation MAE <span className="font-medium text-text-1">{formatTemperature(m.candidate_mae!)}</span> vs{" "}
              {formatTemperature(m.baseline_mae!)} equal-weight baseline
            </p>
          )}
          <p className="pt-3 text-xs text-text-3">
            Retrained nightly on all graded days; a new model goes live only when it beats both
            this baseline and the previous model on days neither trained on.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-lg font-medium">Equal-weight blend</p>
          <p className="pt-1 text-sm text-text-2">
            Forecasts use the bias-corrected average of the three source models.
          </p>
          <p className="pt-3 text-xs text-text-3">
            A learned model promotes automatically once it beats this baseline in walk-forward
            validation.
          </p>
        </>
      )}
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
  blendModel?: BlendModelInfo | null;
  realization?: RealizationInfo | null;
}

export function VerificationView({ verification, snapshots, blendModel, realization }: VerificationViewProps) {
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
      {realization != null && <RealizationCard r={realization} />}
      <ActiveModelCard m={blendModel} />
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
