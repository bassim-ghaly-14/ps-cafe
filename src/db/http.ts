import type { DbPort } from "./port";
import { RepoError } from "./port";
import { READ_ONLY_CODE } from "../mode/visitor";

/**
 * HTTP-backed DbPort for paired phones. Forwards the exact same
 * parameterized SQL the repositories issue to the desktop LAN gateway
 * (`POST /api/select`, `POST /api/execute`), which validates and runs it
 * against the shared `ps-cafe.db`.
 *
 * All business logic stays in TypeScript (repositories/domain/hooks run
 * unchanged); only this transport differs from the desktop Tauri port.
 *
 * Auth: the pairing token from the QR fragment is sent as
 * `Authorization: Bearer …` on every request. The token lives in
 * sessionStorage (per-tab, never in localStorage) and is dropped on
 * "forget pairing".
 */

const TOKEN_KEY = "pscafe.lan.token.v1";

export function readLanToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeLanToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

export function clearLanToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export interface HttpPortOptions {
  /** Same-origin base, e.g. `""` (relative) — never a hardcoded host. */
  base?: string;
}

async function postJson<T>(
  base: string,
  path: string,
  token: string,
  payload: unknown,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const raw: unknown = await res.json().catch(() => null);
  const body =
    typeof raw === "object" && raw !== null
      ? (raw as { ok?: boolean; error?: string; rows?: T; affected?: number })
      : null;
  if (!res.ok || !body || body.ok !== true) {
    const code = body?.error ?? `HTTP_${res.status}`;
    throw new RepoError(code, `LAN request failed: ${code}`);
  }
  return (body.rows ?? []) as T;
}

export function createHttpPort(options: HttpPortOptions = {}): DbPort {
  const base = options.base ?? "";
  const token = readLanToken();
  if (!token) {
    throw new RepoError(
      "LAN_UNPAIRED",
      "No LAN pairing token. Scan the desktop QR code first.",
    );
  }
  return {
    execute: async () => {
      // Visitor mode is read-only. The gateway rejects writes too, but we
      // fail locally so no mutation ever leaves the browser and callers
      // get the same error code as the backend would return.
      throw new RepoError(
        READ_ONLY_CODE,
        "Visitor mode: the LAN gateway is read-only.",
      );
    },
    select: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      return postJson<T[]>(base, "/api/select", token, {
        sql,
        params: params ?? [],
      });
    },
  };
}
