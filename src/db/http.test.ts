import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoError } from "./port";
import { createHttpPort } from "./http";
import { clearLanToken, writeLanToken } from "./http";
import { READ_ONLY_CODE } from "../mode/visitor";

const TOKEN = `pscafe_${"c".repeat(32)}`;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("http db port", () => {
  beforeEach(() => {
    clearLanToken();
    vi.unstubAllGlobals();
  });

  it("throws LAN_UNPAIRED without a token", () => {
    expect(() => createHttpPort()).toThrowError(RepoError);
    try {
      createHttpPort();
    } catch (e) {
      expect((e as RepoError).code).toBe("LAN_UNPAIRED");
    }
  });

  it("select posts sql+params with bearer auth and returns rows", async () => {
    writeLanToken(TOKEN);
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ok: true, rows: [{ id: 1 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const port = createHttpPort();
    const rows = await port.select<{ id: number }>(
      "SELECT * FROM stations",
      [],
    );
    expect(rows).toEqual([{ id: 1 }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/select");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      sql: "SELECT * FROM stations",
      params: [],
    });
  });

  it("rejects every mutation locally with READ_ONLY_MODE (no request is sent)", async () => {
    writeLanToken(TOKEN);
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { ok: true, rows: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const port = createHttpPort();
    // The LAN gateway is permanently read-only: the browser refuses the
    // write before any request leaves the device.
    await expect(
      port.execute("DELETE FROM stations", []),
    ).rejects.toMatchObject({
      code: READ_ONLY_CODE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps gateway errors to RepoError codes", async () => {
    writeLanToken(TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(403, { ok: false, error: "READ_ONLY_MODE" }),
      ),
    );
    const port = createHttpPort();
    await expect(port.select("SELECT 1", [])).rejects.toMatchObject({
      code: "READ_ONLY_MODE",
    });
  });

  it("maps 401 to UNAUTHORIZED", async () => {
    writeLanToken(TOKEN);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, { ok: false, error: "UNAUTHORIZED" }),
      ),
    );
    const port = createHttpPort();
    await expect(port.select("SELECT 1", [])).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
