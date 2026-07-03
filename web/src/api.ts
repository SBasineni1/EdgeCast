import type { AnalysisOutput } from "./types";

export class InputError extends Error {}

export class UpstreamError extends Error {}

export async function analyzeLive(edgeThreshold: number): Promise<AnalysisOutput> {
  const res = await fetch(`/api/live?edge_threshold=${edgeThreshold}`);
  if (res.status === 502) {
    const body = (await res.json()) as { detail?: unknown };
    throw new UpstreamError(
      typeof body.detail === "string" ? body.detail : "upstream failure",
    );
  }
  if (res.status === 422) {
    const body = (await res.json()) as { detail?: unknown };
    throw new InputError(
      typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail),
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AnalysisOutput;
}

export async function getScenarioFiles(): Promise<string[]> {
  const res = await fetch("/api/scenario-files");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { files: string[] };
  return data.files;
}

export async function analyze(
  file: string,
  edgeThreshold: number,
): Promise<AnalysisOutput> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, edge_threshold: edgeThreshold }),
  });
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    const body = (await res.json()) as { detail?: unknown };
    throw new InputError(
      typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail),
    );
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as AnalysisOutput;
}
