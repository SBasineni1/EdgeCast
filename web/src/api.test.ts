import { afterEach, expect, it, vi } from "vitest";
import { analyzeLive, InputError, UpstreamError } from "./api";

afterEach(() => vi.unstubAllGlobals());

function fakeResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

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

it("analyzeLive throws InputError with the detail on 422", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(fakeResponse(422, { detail: "edge_threshold must be in [0, 1]" })),
  );
  await expect(analyzeLive(2)).rejects.toThrow(InputError);
});

it("analyzeLive throws plain Error (not InputError) on server failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fakeResponse(500, {})));
  const err = await analyzeLive(0.05).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(InputError);
  expect((err as Error).message).toBe("HTTP 500");
});
