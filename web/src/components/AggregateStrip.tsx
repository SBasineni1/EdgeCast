import type { ModelGrades } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";

function closestModel(grades: ModelGrades): string | null {
  const entries = Object.entries(grades.overall);
  if (entries.length === 0) return null;
  const hit = (r: number | null) => r ?? -1;
  entries.sort(
    ([, a], [, b]) => a.mae - b.mae || hit(b.bucket_hit_rate) - hit(a.bucket_hit_rate),
  );
  const [name, best] = entries[0];
  const rival = entries[1]?.[1];
  if (rival && rival.mae === best.mae && hit(rival.bucket_hit_rate) === hit(best.bucket_hit_rate)) {
    return null;
  }
  return name;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] tracking-[0.2em] text-text-3">{label}</div>
      <div className="text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

interface AggregateStripProps {
  modelGrades: ModelGrades | null;
}

export function AggregateStrip({ modelGrades }: AggregateStripProps) {
  if (modelGrades === null) {
    return (
      <section className="flex items-end border-b border-hairline px-6 py-5">
        <p
          className="ml-auto text-xl font-bold tracking-[0.1em] text-text-3"
          data-testid="verdict"
        >
          AWAITING MODEL GRADES — run: uv run edgecast backfill
        </p>
      </section>
    );
  }
  const models = MODEL_ORDER.filter((m) => modelGrades.overall[m] !== undefined);
  const closest = closestModel(modelGrades);
  const consensusHit = modelGrades.overall.consensus?.bucket_hit_rate ?? null;
  const verdict = closest === null ? "MODELS TIED" : `${MODEL_NAMES[closest] ?? closest} CLOSEST`;
  return (
    <section className="flex flex-wrap items-end gap-x-10 gap-y-3 border-b border-hairline px-6 py-5">
      {models.map((m) => (
        <Stat
          key={m}
          label={`${MODEL_NAMES[m] ?? m} MAE`}
          value={`${modelGrades.overall[m].mae.toFixed(1)}°`}
        />
      ))}
      {consensusHit !== null && (
        <Stat label="CONSENSUS RIGHT BUCKET" value={`${Math.round(consensusHit * 100)}%`} />
      )}
      <p
        className="ml-auto text-xl font-bold tracking-[0.1em]"
        data-testid="verdict"
      >
        {verdict} · DAY-FORWARD · LAST {modelGrades.window_days} DAYS
      </p>
    </section>
  );
}
