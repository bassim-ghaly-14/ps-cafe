import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetDbForTests,
  getActiveDb,
  getDb,
  isDemoDbActive,
  setDbOverride,
} from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import { __setDevtoolsForTests } from "./developerMode";
import {
  buildDemoDb,
  enterDemoMode,
  exitDemoMode,
  validateDemoConsistency,
} from "./demoMode";
import * as dayRepo from "../repositories/businessDayRepo";
import * as sessionRepo from "../repositories/sessionRepo";
import * as stationRepo from "../repositories/stationRepo";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
  __setDevtoolsForTests(null);
});

describe("demo database isolation", () => {
  it("demo mutations never touch production", async () => {
    const t0 = 1_700_000_000_000;
    const prodDay = await dayRepo.openDay(t0);
    const before = await stationRepo.listStations();
    const r = await enterDemoMode("full", t0);
    expect(r.ok).toBe(true);
    expect(isDemoDbActive()).toBe(true);
    const demoStations = await stationRepo.listStations();
    await stationRepo.updateStation(demoStations[0]!.id, {
      name: "DEMO-MUTATED",
      colorHex: "#ff0000",
      isVisible: true,
      isActive: true,
      hourlyRateMinor: demoStations[0]!.hourlyRateMinor,
    });
    await exitDemoMode();
    expect(isDemoDbActive()).toBe(false);
    const after = await stationRepo.listStations();
    expect(after.map((s) => s.name)).toEqual(before.map((s) => s.name));
    expect(after.some((s) => s.name === "DEMO-MUTATED")).toBe(false);
    expect((await dayRepo.getOpenDay())?.id).toBe(prodDay.id);
  });

  it("repositories resolve the override while demo is active", async () => {
    const prodDb = await getDb();
    await enterDemoMode("full", 1_700_000_000_000);
    expect(await getActiveDb()).not.toBe(prodDb);
    await stationRepo.listStations();
    await dayRepo.getOpenDay();
    await sessionRepo.listActiveSessions();
    await exitDemoMode();
    expect(await getActiveDb()).toBe(prodDb);
  });

  it("returning to production reloads real state", async () => {
    const t0 = 1_700_000_000_000;
    await dayRepo.openDay(t0);
    await enterDemoMode("open-busy", t0);
    expect(await dayRepo.getOpenDay()).not.toBeNull();
    expect((await sessionRepo.listActiveSessions()).length).toBeGreaterThan(0);
    await exitDemoMode();
    expect((await dayRepo.getOpenDay())?.startedAtUtc).toBe(t0);
    expect(await sessionRepo.listActiveSessions()).toEqual([]);
  });

  it("demo seed is consistent", async () => {
    const db = await buildDemoDb("full", 1_700_000_000_000);
    expect(await validateDemoConsistency(db)).toEqual([]);
  });

  it("each scenario seeds coherently", async () => {
    const scenarios = [
      "full",
      "open-empty",
      "open-busy",
      "blocked-close",
      "closed-history",
    ] as const;
    for (const scenario of scenarios) {
      const db = await buildDemoDb(scenario, 1_700_000_000_000);
      expect(await validateDemoConsistency(db)).toEqual([]);
      setDbOverride(db);
      if (scenario === "closed-history") {
        expect(await dayRepo.getOpenDay()).toBeNull();
      } else if (scenario === "open-empty") {
        expect(await dayRepo.getOpenDay()).not.toBeNull();
        expect(await sessionRepo.listActiveSessions()).toEqual([]);
      } else {
        expect(await dayRepo.getOpenDay()).not.toBeNull();
        expect((await sessionRepo.listActiveSessions()).length).toBeGreaterThan(
          0,
        );
      }
      setDbOverride(null);
    }
  });

  it("demo reset restores the seed state", async () => {
    await enterDemoMode("full", 1_700_000_000_000);
    const before = await stationRepo.listStations();
    await stationRepo.createStation("TEMP-DEMO-STATION", "#ffffff");
    expect((await stationRepo.listStations()).length).toBe(before.length + 1);
    await exitDemoMode();
    await enterDemoMode("full", 1_700_000_000_000);
    expect(
      (await stationRepo.listStations()).some(
        (s) => s.name === "TEMP-DEMO-STATION",
      ),
    ).toBe(false);
    await exitDemoMode();
  });

  it("statistics come only from demo records while active", async () => {
    const t0 = 1_700_000_000_000;
    await dayRepo.openDay(t0);
    const prodAgg = await sessionRepo.aggregateAllTime();
    await enterDemoMode("full", t0);
    const demoAgg = await sessionRepo.aggregateAllTime();
    expect(demoAgg.count).toBeGreaterThan(prodAgg.count);
    await exitDemoMode();
    expect(await sessionRepo.aggregateAllTime()).toEqual(prodAgg);
  });
});
