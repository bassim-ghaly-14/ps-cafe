import { invoke } from "@tauri-apps/api/core";
import { isLanClient } from "../db/client";

/**
 * Desktop-side LAN gateway bridge (Tauri commands). Never imported on the
 * phone path — `isLanClient()` guards every call site so a phone browser
 * never attempts Tauri IPC.
 */

export interface LanInterface {
  name: string;
  address: string;
}

export interface LanStatus {
  running: boolean;
  enabled: boolean;
  /**
   * Always `true`: the LAN gateway is permanently read-only. It is sent
   * to the desktop UI so the panel can state the fact instead of offering
   * a write toggle that no longer exists.
   */
  readOnly: boolean;
  address: string | null;
  port: number;
  url: string | null;
  candidates: LanInterface[];
  pairedDevices: number;
  pairedLabels: string[];
  error: string | null;
}

export interface LanPairing {
  url: string;
  payload: string;
  qrSvg: string;
  pairedDevices: number;
}

function guard(): void {
  if (isLanClient()) {
    throw new Error("LAN bridge is desktop-only.");
  }
}

export async function lanStatus(): Promise<LanStatus> {
  guard();
  return invoke<LanStatus>("lan_status");
}

export async function lanPair(label?: string): Promise<LanPairing> {
  guard();
  return invoke<LanPairing>("lan_pair", { label: label ?? null });
}

export async function lanSetEnabled(enabled: boolean): Promise<LanStatus> {
  guard();
  return invoke<LanStatus>("lan_set_enabled", { enabled });
}

export async function lanRefresh(): Promise<LanStatus> {
  guard();
  return invoke<LanStatus>("lan_refresh");
}

export async function lanSelectInterface(address: string): Promise<LanStatus> {
  guard();
  return invoke<LanStatus>("lan_select_interface", { address });
}

export async function lanRevokeAll(): Promise<LanStatus> {
  guard();
  return invoke<LanStatus>("lan_revoke_all");
}
