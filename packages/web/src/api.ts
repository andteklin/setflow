import { load, save } from "./dom";

export async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(route, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${method} ${route} failed (${res.status})`);
  return data;
}

/** A stable id for this browser, used as the controller id when it conducts. */
export const clientId: string = (() => {
  const existing = load<string | null>("setflow.clientId", null);
  if (existing) return existing;
  const id = `client-${Math.random().toString(36).slice(2, 10)}`;
  save("setflow.clientId", id);
  return id;
})();

/** A unique command id. crypto.randomUUID needs a secure context, which a LAN http:// address is not. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
