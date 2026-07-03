import { afterEach, expect, it, vi } from "vitest";
import { analyze, analyzeLive, getScenarioFiles, InputError, UpstreamError } from "./api";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

it("getScenarioFiles returns the file list", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(200, { files: ["a.json", "b.json"] })),
  );
  expect(await getScenarioFiles()).toEqual(["a.json", "b.json"]);
});

it("analyze posts file and threshold", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(fakeResponse(200, { results: [], aggregate: {} }));
  vi.stubGlobal("fetch", fetchMock);
  await analyze("a.json", 0.1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/analyze",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ file: "a.json", edge_threshold: 0.1 }),
    }),
  );
});

it("analyze throws InputError with the detail on 422", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(fakeResponse(422, { detail: "scenario 's1': field 'x' bad" })),
  );
  await expect(analyze("a.json", 0.05)).rejects.toThrow(InputError);
  await expect(analyze("a.json", 0.05)).rejects.toThrow("scenario 's1'");
});

it("analyze throws plain Error (not InputError) on server failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(500, {})));
  const err = await analyze("a.json", 0.05).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(InputError);
  expect((err as Error).message).toBe("HTTP 500");
});

it("analyzeLive hits /api/live with the threshold", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(fakeResponse(200, { results: [], aggregate: {} }));
  vi.stubGlobal("fetch", fetchMock);
  await analyzeLive(0.07);
  expect(fetchMock).toHaveBeenCalledWith("/api/live?edge_threshold=0.07");
});

it("analyzeLive throws UpstreamError on 502", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      fakeResponse(502, { detail: "no live data available: NYC: timeout" }),
    ),
  );
  await expect(analyzeLive(0.05)).rejects.toThrow(UpstreamError);
  await expect(analyzeLive(0.05)).rejects.toThrow("NYC");
});
