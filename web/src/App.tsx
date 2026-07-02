import { useCallback, useEffect, useState } from "react";
import { analyze, getScenarioFiles, InputError } from "./api";
import type { AnalysisOutput } from "./types";
import { AggregateStrip } from "./components/AggregateStrip";
import { CommandBar } from "./components/CommandBar";
import { MarketCard } from "./components/MarketCard";

type Status = "loading" | "ready" | "offline" | "empty";

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(0.05);
  const [output, setOutput] = useState<AnalysisOutput | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getScenarioFiles()
      .then((fs) => {
        setFiles(fs);
        if (fs.length === 0) {
          setStatus("empty");
        } else {
          setSelected(fs[0]);
          setStatus("ready");
        }
      })
      .catch(() => setStatus("offline"));
  }, []);

  const run = useCallback(async (file: string, th: number) => {
    setBusy(true);
    setInputError(null);
    try {
      setOutput(await analyze(file, th));
    } catch (e) {
      if (e instanceof InputError) setInputError(e.message);
      else setStatus("offline");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (selected !== null) void run(selected, threshold);
  }, [selected, threshold, run]);

  if (status === "offline") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <h1 className="text-4xl font-bold tracking-[0.3em]">SIGNAL LOST</h1>
        <p className="font-sans text-sm text-text-3">
          is the server running? → uv run edgecast serve
        </p>
      </main>
    );
  }
  if (status === "empty") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="tracking-widest text-text-2">
          NO SCENARIO FILES — drop a scenarios JSON into fixtures/
        </p>
      </main>
    );
  }
  return (
    <main className="min-h-screen">
      <CommandBar
        files={files}
        selected={selected}
        onSelect={setSelected}
        threshold={threshold}
        onThreshold={setThreshold}
        onAnalyze={() => selected !== null && void run(selected, threshold)}
        busy={busy}
      />
      {inputError !== null && (
        <p className="border-b border-hairline px-6 py-2 text-xs text-text-2">
          <span className="font-bold text-text-1">INPUT ERROR</span> {inputError}
        </p>
      )}
      {output !== null && (
        <div className={`transition-opacity ${busy ? "opacity-40" : ""}`}>
          <AggregateStrip aggregate={output.aggregate} />
          <section className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
            {output.results.map((r) => (
              <MarketCard key={r.scenario_id} result={r} />
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
