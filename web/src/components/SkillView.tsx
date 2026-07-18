import { useState } from "react";
import type { BlendModelInfo, CityInfo, ModelGrades, ModelGradeStats } from "../types";
import { MODEL_NAMES, MODEL_ORDER } from "../types";
import { closestModel, formatPercent, formatTemperature, leanWords } from "../format";

const ROW_GRID = "grid grid-cols-[4.5rem_3rem_4.5rem_1fr] items-baseline gap-x-2 sm:grid-cols-[7rem_5rem_7rem_1fr] sm:gap-x-4";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-hairline bg-panel p-4">
      <div className="text-xs font-medium text-text-3">{label}</div>
      <div className="data-nums pt-1 text-3xl font-medium">{value}</div>
    </div>
  );
}

function bucketTone(rate: number | null): string {
  if (rate === null) return "text-text-3";
  const pct = Math.round(rate * 100);
  if (pct < 20) return "text-down";
  if (pct <= 40) return "text-mid";
  return "text-up";
}

function leanTone(bias: number): string {
  if (Math.abs(bias) < 0.05) return "text-text-3";
  return bias > 0 ? "text-down" : "text-cool";
}

function GradeRow({ model, g, emphasized }: { model: string; g: ModelGradeStats; emphasized: boolean }) {
  return (
    <div
      className={`${ROW_GRID} data-nums border-b border-hairline py-2 text-sm last:border-0 ${
        emphasized ? "font-medium text-text-1" : "text-text-2"
      }`}
    >
      <span>{MODEL_NAMES[model] ?? model}</span>
      <span>{formatTemperature(g.mae)}</span>
      <span className={bucketTone(g.bucket_hit_rate)} data-testid="bucket-cell">
        {g.bucket_hit_rate === null ? "—" : formatPercent(g.bucket_hit_rate)}
      </span>
      <span className={leanTone(g.bias)} data-testid="lean-cell">
        {leanWords(g.bias)}
      </span>
    </div>
  );
}

interface SkillViewProps {
  modelGrades: ModelGrades | null | undefined;
  cities: Record<string, CityInfo>;
  blendModel?: BlendModelInfo | null;
}

export function SkillView({ modelGrades, cities, blendModel }: SkillViewProps) {
  const cityKeys = Object.keys(modelGrades?.by_city ?? {}).sort((a, b) => a.localeCompare(b));
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  if (modelGrades == null) {
    return (
      <p className="rounded-xl border border-hairline bg-panel p-5 text-sm text-text-3" data-testid="verdict">
        Awaiting model grades — run: uv run edgecast backfill
      </p>
    );
  }
  const models = MODEL_ORDER.filter((m) => modelGrades.overall[m] !== undefined);
  const closest = closestModel(modelGrades);
  const liveModel = blendModel != null && modelGrades.overall.gbm !== undefined ? "gbm" : "consensus";
  const consensusHit = modelGrades.overall[liveModel]?.bucket_hit_rate ?? null;
  const verdict = closest === null ? "Models tied" : `${MODEL_NAMES[closest] ?? closest} closest`;
  const city =
    selectedCity !== null && cityKeys.includes(selectedCity) ? selectedCity : cityKeys[0];
  const cityGrades = city !== undefined ? modelGrades.by_city[city] : undefined;
  return (
    <div className="flex flex-col gap-6">
      <p className="font-display text-lg font-medium" data-testid="verdict">
        {verdict} · day-ahead · last {modelGrades.window_days} days
      </p>
      <div
        className={`grid grid-cols-2 gap-3 ${
          models.length + (consensusHit !== null ? 1 : 0) > 5 ? "xl:grid-cols-6" : "xl:grid-cols-5"
        }`}
      >
        {models.map((m) => (
          <Stat key={m} label={`${MODEL_NAMES[m] ?? m} MAE`} value={formatTemperature(modelGrades.overall[m].mae)} />
        ))}
        {consensusHit !== null && (
          <Stat label={`${MODEL_NAMES[liveModel]} right bucket`} value={formatPercent(consensusHit)} />
        )}
      </div>
      {city !== undefined && cityGrades !== undefined && (
        <section className="rounded-xl border border-hairline bg-panel p-5">
          <div className="flex items-center justify-between pb-3">
            <p className="text-xs font-medium text-text-3">By city</p>
            <select
              aria-label="city"
              value={city}
              onChange={(e) => setSelectedCity(e.target.value)}
              className="cursor-pointer rounded-full border border-hairline bg-panel px-3 py-1.5 text-sm"
            >
              {cityKeys.map((loc) => (
                <option key={loc} value={loc}>
                  {cities[loc]?.name ?? loc}
                </option>
              ))}
            </select>
          </div>
          <div className={`${ROW_GRID} pb-2 text-xs font-medium text-text-3`}>
            <span>Model</span>
            <span>Off by</span>
            <span>Right bucket</span>
            <span>Lean</span>
          </div>
          <div data-testid="skill-city">
            {MODEL_ORDER.filter((m) => cityGrades[m] !== undefined).map((m) => (
              <GradeRow key={m} model={m} g={cityGrades[m]} emphasized={m === liveModel} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
