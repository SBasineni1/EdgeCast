import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyze,
  analyzeLive,
  getScenarioFiles,
  InputError,
  UpstreamError,
} from "./api";
import type { AnalysisOutput, ScenarioResult } from "./types";
import { AggregateStrip } from "./components/AggregateStrip";
import { CityCard } from "./components/CityCard";
import { CommandBar } from "./components/CommandBar";

type Mode = "live" | "fixtures";
const REFRESH_MS = 60_000;

function groupByLocation(results: ScenarioResult[]): [string, ScenarioResult[]][] {
  const groups = new Map<string, ScenarioResult[]>();
  for (const r of results) {
    const list = groups.get(r.market.location) ?? [];
    list.push(r);
    groups.set(r.market.location, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function App() {
  const [mode, setMode] = useState<Mode>("live");
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.05);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runLive = useCallback(async (th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyzeLive(th));
      setUpstreamError(null);
      setOffline(false);
    } catch (e) {
      if (e instanceof UpstreamError) setUpstreamError(e.message);
      else if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  const runFixture = useCallback(async (file: string, th: number) => {
    setBusy(true);
    setInputError(null);
    setUpstreamError(null);
    try {
      setOutput(await analyze(file, th));
      setOffline(false);
    } catch (e) {
      if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
    if (mode === "live") {
      void runLive(threshold);
      timer.current = setInterval(() => void runLive(threshold), REFRESH_MS);
      return () => {
        if (timer.current !== null) clearInterval(timer.current);
      };
    }
    getScenarioFiles()
      .then((fs) => {
        setFiles(fs);
        setSelected((cur) => cur ?? fs[0] ?? null);
      })
      .catch(() => setOffline(true));
  }, [mode, threshold, runLive]);

  useEffect(() => {
    if (mode === "fixtures" && selected !== null) void runFixture(selected, threshold);
  }, [mode, selected, threshold, runFixture]);

  if (offline && output === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-4xl font-bold tracking-[0.3em]">SIGNAL LOST</h1>
        <p className="font-sans text-sm text-text-3">
          is the server running? → uv run edgecast serve
        </p>
      </main>
    );
  }

  const groups = output !== null ? groupByLocation(output.results) : [];
  const cities = output?.live?.cities ?? {};

  return (
    <main className="min-h-screen">
      <CommandBar
        mode={mode}
        onMode={setMode}
        updatedAt={mode === "live" ? (output?.live?.fetched_at ?? null) : null}
        files={files}
        selected={selected}
        onSelect={setSelected}
        threshold={threshold}
        onThreshold={setThreshold}
        onAnalyze={() =>
          mode === "live"
            ? void runLive(threshold)
            : selected !== null && void runFixture(selected, threshold)
        }
        busy={busy}
      />
      {upstreamError !== null && (
        <p
          className="border-b border-hairline px-6 py-2 text-xs text-text-2"
          data-testid="upstream-strip"
        >
          <span className="font-bold text-text-1">UPSTREAM UNREACHABLE</span>{" "}
          {upstreamError} — retrying in 60s
        </p>
      )}
      {upstreamError === null && (output?.live?.cities_failed.length ?? 0) > 0 && (
        <p
          className="border-b border-hairline px-6 py-2 text-xs text-text-2"
          data-testid="upstream-strip"
        >
          <span className="font-bold text-text-1">UPSTREAM PARTIAL</span> —{" "}
          {output!.live!.cities_failed
            .map((f) => `${f.city} (${f.reason})`)
            .join(" · ")}
        </p>
      )}
      {inputError !== null && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2">
          <span className="font-bold text-text-1">INPUT ERROR</span> {inputError}
        </p>
      )}
      {output !== null && (
        <div className={`transition-opacity ${busy ? "opacity-40" : ""}`}>
          <AggregateStrip
            aggregate={output.aggregate}
            modelGrades={mode === "live" ? (output.model_grades ?? null) : undefined}
          />
          <div className="grid grid-cols-1 gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-3">
            {groups.map(([location, results]) => (
              <section key={location} data-testid="city-group">
                <h2 className="pb-2 text-sm font-bold tracking-[0.25em]">
                  {(cities[location]?.name ?? location).toUpperCase()}
                  {cities[location] && (
                    <span className="ml-3 font-normal tracking-[0.15em] text-text-3">
                      — {cities[location].series}
                    </span>
                  )}
                </h2>
                <CityCard
                  location={location}
                  cityInfo={cities[location]}
                  results={results}
                  modelHighs={output.live?.model_highs?.[location]}
                  grades={output.model_grades?.by_city?.[location]}
                  mismatches={
                    output.verification?.kalshi_mismatches?.filter((m) =>
                      cities[location]
                        ? m.market_id.startsWith(cities[location].series)
                        : false,
                    ) ?? []
                  }
                />
              </section>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
