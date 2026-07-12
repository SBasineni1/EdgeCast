import type { CityInfo, ModelGrades, ModelGradeStats } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { closestModel, leanWords } from "../format";

const ROW_GRID = "grid grid-cols-[7rem_5rem_7rem_1fr] items-baseline gap-x-4";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-sm">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div className="pt-1 font-display text-3xl font-medium tabular-nums">{value}</div>
    </div>
  );
}

function GradeRow({ model, g }: { model: string; g: ModelGradeStats }) {
  const emphasized = model === "consensus";
  return (
    <div
      className={`${ROW_GRID} border-b border-hairline py-2 text-sm tabular-nums last:border-0 ${
        emphasized ? "font-medium text-text-1" : "text-text-2"
      }`}
    >
      <span>{MODEL_NAMES[model] ?? model}</span>
      <span>{g.mae.toFixed(1)}°</span>
      <span>{g.bucket_hit_rate === null ? "—" : `${Math.round(g.bucket_hit_rate * 100)}%`}</span>
      <span>{leanWords(g.bias)}</span>
    </div>
  );
}

interface SkillViewProps {
  modelGrades: ModelGrades | null | undefined;
  cities: Record<string, CityInfo>;
}

export function SkillView({ modelGrades, cities }: SkillViewProps) {
  if (modelGrades == null) {
    return (
      <p className="rounded-2xl border border-hairline bg-panel p-5 text-sm text-text-3 shadow-sm" data-testid="verdict">
        Awaiting model grades — run: uv run edgecast backfill
      </p>
    );
  }
  const models = MODEL_ORDER.filter((m) => modelGrades.overall[m] !== undefined);
  const closest = closestModel(modelGrades);
  const consensusHit = modelGrades.overall.consensus?.bucket_hit_rate ?? null;
  const verdict = closest === null ? "Models tied" : `${MODEL_NAMES[closest] ?? closest} closest`;
  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-lg font-medium" data-testid="verdict">
        {verdict} · day-ahead · last {modelGrades.window_days} days
      </p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        {models.map((m) => (
          <Stat key={m} label={`${MODEL_NAMES[m] ?? m} MAE`} value={`${modelGrades.overall[m].mae.toFixed(1)}°`} />
        ))}
        {consensusHit !== null && (
          <Stat label="Consensus right bucket" value={`${Math.round(consensusHit * 100)}%`} />
        )}
      </div>
      {Object.keys(modelGrades.by_city).length > 0 && (
        <section className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm">
          <p className="pb-3 text-xs font-medium text-text-3">By city</p>
          <div className={`${ROW_GRID} pb-2 text-xs font-medium text-text-3`}>
            <span>Model</span>
            <span>Off by</span>
            <span>Right bucket</span>
            <span>Lean</span>
          </div>
          <div className="flex flex-col gap-5">
            {Object.entries(modelGrades.by_city)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([loc, grades]) => (
                <div key={loc} data-testid="skill-city">
                  <p className="pb-1 text-sm font-medium">{cities[loc]?.name ?? loc}</p>
                  {MODEL_ORDER.filter((m) => grades[m] !== undefined).map((m) => (
                    <GradeRow key={m} model={m} g={grades[m]} />
                  ))}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
