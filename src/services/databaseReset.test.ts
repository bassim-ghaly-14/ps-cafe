import { beforeEach, describe, expect, it } from "vitest";
import { __resetDbForTests } from "../db/client";
import { __clearMemoryDb } from "../db/memory";
import {
  DATABASE_RESET_PHRASE,
  checkDatabaseResetSafety,
  resetDatabase,
} from "./databaseReset";
import * as dayRepo from "../repositories/businessDayRepo";
import * as stationRepo from "../repositories/stationRepo";
import * as sessionRepo from "../repositories/sessionRepo";

beforeEach(() => {
  __clearMemoryDb();
  __resetDbForTests();
});

describe("database reset safety gate", () => {
  it("blocks while a business day is open", async () => {
    await dayRepo.openDay(1_700_000_000_000);
    const blocked = await checkDatabaseResetSafety(() => false);
    expect(blocked?.reason).toBe("OPEN_DAY");
  });

  it("blocks while sessions are active", async () => {
    const t0 = 1_700_000_000_000;
    await dayRepo.openDay(t0);
    const stations = await stationRepo.listStations();
    await sessionRepo.startSession(stations[0]!.id, 1, t0 + 1000);
    const blocked = await checkDatabaseResetSafety(() => false);
    expect(blocked?.reason).toBe("ACTIVE_SESSIONS");
  });

  it("blocks while the LAN gateway is running", async () => {
    const blocked = await checkDatabaseResetSafety(() => true);
    expect(blocked?.reason).toBe("LAN_RUNNING");
  });

  it("treats LAN status failure as blocked", async () => {
    const blocked = await checkDatabaseResetSafety(() => {
      throw new Error("ipc-down");
    });
    expect(blocked?.reason).toBe("LAN_RUNNING");
  });

  it("passes on a clean idle database", async () => {
    expect(await checkDatabaseResetSafety(() => false)).toBeNull();
  });
});

describe("database reset", () => {
  it("requires the exact confirmation phrase constant", () => {
    expect(DATABASE_RESET_PHRASE).toBe("DELETE ALL DATA");
  });

  it("clears all business data and reseeds defaults", async () => {
    const t0 = 1_700_000_000_000;
    const day = await dayRepo.openDay(t0);
    const stations = await stationRepo.listStations();
    const s = await sessionRepo.startSession(
      stations[0]!.id,
      day.id,
      t0 + 1000,
    );
    await sessionRepo.stopSession(s.id, t0 + 2000);
    await dayRepo.closeDay(day.id, t0 + 3000);
    const r = await resetDatabase(() => false);
    expect(r.ok).toBe(true);
    expect(r.deleted?.sessions).toBeGreaterThan(0);
    expect((await sessionRepo.listActiveSessions()).length).toBe(0);
    expect(await dayRepo.getOpenDay()).toBeNull();
    expect((await dayRepo.listDays(50)).length).toBe(0);
    const after = await stationRepo.listStations();
    expect(after.length).toBe(4);
  });

  it("blocked reset deletes nothing", async () => {
    await dayRepo.openDay(1_700_000_000_000);
    const before = await stationRepo.listStations();
    const r = await resetDatabase(() => false);
    expect(r.ok).toBe(false);
    expect(r.blocked?.reason).toBe("OPEN_DAY");
    expect((await stationRepo.listStations()).length).toBe(before.length);
  });

  it("repeated resets stay consistent", async () => {
    const first = await resetDatabase(() => false);
    expect(first.ok).toBe(true);
    const second = await resetDatabase(() => false);
    expect(second.ok).toBe(true);
    expect((await stationRepo.listStations()).length).toBe(4);
  });
});
