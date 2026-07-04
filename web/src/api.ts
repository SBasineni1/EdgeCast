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
