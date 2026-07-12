import type { CityInfo, ModelGrades } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { closestModel, gradeLine } from "../format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-panel p-4 shadow-sm">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div className="pt-1 font-display text-3xl font-medium tabular-nums">{value}</div>
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
      <p className="rounded-2xl border border-hairline bg-panel p-5 shadow-sm text-sm text-text-3" data-testid="verdict">
        AWAITING MODEL GRADES — run: uv run edgecast backfill
      </p>
    );
  }
  const models = MODEL_ORDER.filter((m) => modelGrades.overall[m] !== undefined);
  const closest = closestModel(modelGrades);
  const consensusHit = modelGrades.overall.consensus?.bucket_hit_rate ?? null;
  const verdict = closest === null ? "MODELS TIED" : `${MODEL_NAMES[closest] ?? closest} CLOSEST`;
  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-lg font-medium" data-testid="verdict">
        {verdict} · DAY-FORWARD · LAST {modelGrades.window_days} DAYS
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
          <div className="flex flex-col gap-4">
            {Object.entries(modelGrades.by_city)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([loc, grades]) => (
                <div key={loc} data-testid="skill-city">
                  <p className="pb-1 text-sm font-medium">{cities[loc]?.name ?? loc}</p>
                  {MODEL_ORDER.filter((m) => grades[m] !== undefined).map((m) => (
                    <p
                      key={m}
                      className={`text-xs tabular-nums ${m === "consensus" ? "text-text-2" : "text-text-3"}`}
                    >
                      {gradeLine(m, grades[m])}
                    </p>
                  ))}
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
