import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { analyzeLive, InputError, UpstreamError } from "./api";
import type { AnalysisOutput, ScenarioResult } from "./types";
import { AggregateStrip } from "./components/AggregateStrip";
import { CityCard } from "./components/CityCard";
import { CommandBar } from "./components/CommandBar";

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
  const [threshold, setThreshold] = useState(0.05);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const entered = useRef(false);

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

  useEffect(() => {
    void runLive(threshold);
    const timer = setInterval(() => void runLive(threshold), REFRESH_MS);
    return () => clearInterval(timer);
  }, [threshold, runLive]);

  useEffect(() => {
    if (output === null || entered.current) return;
    entered.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    gsap.from("[data-testid='city-group']", {
      y: 14,
      autoAlpha: 0,
      duration: 0.5,
      ease: "power2.out",
      stagger: 0.04,
      clearProps: "opacity,visibility,transform",
    });
  }, [output]);

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
        updatedAt={output?.live?.fetched_at ?? null}
        threshold={threshold}
        onThreshold={setThreshold}
        onRefresh={() => void runLive(threshold)}
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
          <AggregateStrip modelGrades={output.model_grades ?? null} />
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
