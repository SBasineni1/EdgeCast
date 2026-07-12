import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { analyzeLive, InputError, UpstreamError } from "./api";
import type { AnalysisOutput, ScenarioResult } from "./types";
import { CityHero } from "./components/CityHero";
import { CityRail } from "./components/CityRail";
import { LadderChart } from "./components/LadderChart";
import { LadderTable } from "./components/LadderTable";
import { Sidebar, type View } from "./components/Sidebar";
import { DashboardSkeleton, RailSkeleton } from "./components/Skeleton";
import { SkillView } from "./components/SkillView";
import { TopBar } from "./components/TopBar";
import { VerificationView } from "./components/VerificationView";

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
  const [view, setView] = useState<View>("dashboard");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [offline, setOffline] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [upstreamError, setUpstreamError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedPolls, setFailedPolls] = useState(0);
  const entered = useRef(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const prevSelected = useRef<string | null>(null);

  const runLive = useCallback(async (th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyzeLive(th));
      setUpstreamError(null);
      setOffline(false);
      setFailedPolls(0);
    } catch (e) {
      if (e instanceof UpstreamError) setUpstreamError(e.message);
      else if (e instanceof InputError) setInputError(e.message);
      else setOffline(true);
      if (!(e instanceof InputError)) setFailedPolls((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void runLive(threshold);
    const timer = setInterval(() => void runLive(threshold), REFRESH_MS);
    return () => clearInterval(timer);
  }, [threshold, runLive]);

  const groups = useMemo(
    () => (output !== null ? groupByLocation(output.results) : []),
    [output],
  );
  const selected =
    selectedCity !== null && groups.some(([l]) => l === selectedCity)
      ? selectedCity
      : groups[0]?.[0] ?? null;
  const selectedResults = useMemo(
    () => (selected !== null ? groups.find(([l]) => l === selected)?.[1] ?? [] : []),
    [groups, selected],
  );

  // Entrance timeline — first data load only.
  useEffect(() => {
    if (output === null || entered.current) return;
    entered.current = true;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from("[data-anim='sidebar-item']", { x: -12, autoAlpha: 0, duration: 0.4, stagger: 0.04, clearProps: "all" })
      .from("[data-anim='hero']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.2")
      .from("[data-anim='chart']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.35")
      .from("[data-anim='table']", { y: 14, autoAlpha: 0, duration: 0.5, clearProps: "all" }, "-=0.35")
      .from("[data-anim='rail-item']", { y: 14, autoAlpha: 0, duration: 0.4, stagger: 0.05, clearProps: "all" }, "-=0.4");
  }, [output]);

  // Quick out/in on city switch.
  useEffect(() => {
    const el = mainRef.current;
    if (el === null || selected === null) return;
    const was = prevSelected.current;
    prevSelected.current = selected;
    if (was === null || was === selected) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    if (reduce) return;
    gsap.fromTo(
      el,
      { y: 8, autoAlpha: 0 },
      { y: 0, autoAlpha: 1, duration: 0.25, ease: "power2.out", clearProps: "all" },
    );
  }, [selected]);

  if (offline && output === null) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="font-display text-4xl font-bold">Signal lost</h1>
        <p className="text-sm text-text-3">is the server running? → uv run edgecast serve</p>
      </main>
    );
  }

  const cities = output?.live?.cities ?? {};
  const highs = selected !== null ? output?.live?.model_highs?.[selected] : undefined;
  const consensus = highs?.consensus ?? null;
  const sigma = selected !== null ? output?.live?.consensus_sigma?.[selected] ?? null : null;
  const selectedInfo = selected !== null ? cities[selected] : undefined;
  const mismatches =
    selectedInfo !== undefined
      ? output?.verification?.kalshi_mismatches?.filter((m) =>
          m.market_id.startsWith(selectedInfo.series),
        ) ?? []
      : [];

  return (
    <main className="mx-auto flex min-h-screen max-w-[1480px]">
      <Sidebar view={view} onView={setView} threshold={threshold} onThreshold={setThreshold} />
      <div className="min-w-0 flex-1 px-8 py-7">
        <TopBar
          updatedAt={output?.live?.fetched_at ?? null}
          busy={busy}
          onRefresh={() => void runLive(threshold)}
        />
        {upstreamError !== null && (
          <p className="mb-4 rounded-xl border border-hairline bg-panel px-4 py-2 text-xs text-text-2" data-testid="upstream-strip">
            <span className="font-bold text-down">UPSTREAM UNREACHABLE</span> {upstreamError} —
            retrying in 60s
          </p>
        )}
        {upstreamError === null && (output?.live?.cities_failed.length ?? 0) > 0 && (
          <p className="mb-4 rounded-xl border border-hairline bg-panel px-4 py-2 text-xs text-text-2" data-testid="upstream-strip">
            <span className="font-bold text-down">UPSTREAM PARTIAL</span> —{" "}
            {output!.live!.cities_failed.map((f) => `${f.city} (${f.reason})`).join(" · ")}
          </p>
        )}
        {inputError !== null && (
          <p className="mb-4 rounded-xl border border-hairline bg-panel px-4 py-2 text-xs text-text-2">
            <span className="font-bold text-down">INPUT ERROR</span> {inputError}
          </p>
        )}
        {output === null && <DashboardSkeleton />}
        {output !== null && (
          <div
            ref={mainRef}
            data-testid="main-column"
            className={`flex flex-col gap-6 transition-opacity ${
              failedPolls >= 2 ? "opacity-40" : ""
            }`}
          >
            {view === "dashboard" && selected !== null && (
              <>
                <CityHero
                  location={selected}
                  cityInfo={selectedInfo}
                  eventDate={selectedResults[0]?.market.event_date}
                  consensus={consensus}
                  sigma={sigma}
                  modelHighs={highs}
                  results={selectedResults}
                />
                <LadderChart results={selectedResults} consensus={consensus} />
                <LadderTable results={selectedResults} consensus={consensus} mismatches={mismatches} />
              </>
            )}
            {view === "verification" && (
              <VerificationView verification={output.verification} snapshots={output.snapshots} />
            )}
            {view === "skill" && <SkillView modelGrades={output.model_grades} cities={cities} />}
          </div>
        )}
      </div>
      {output === null && <RailSkeleton />}
      {output !== null && (
        <CityRail
          groups={groups}
          cities={cities}
          modelHighs={output.live?.model_highs}
          selected={selected}
          onSelect={(loc) => {
            setSelectedCity(loc);
            setView("dashboard");
          }}
        />
      )}
    </main>
  );
}
