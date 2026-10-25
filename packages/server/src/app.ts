import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { CommandEnvelope } from "@setflow/core";
import { HttpError, Library } from "./library.js";
import { LiveHost } from "./live.js";
import type { ClientMessage, ClientRole, ServerMessage } from "./protocol.js";
import { Store } from "./store.js";

export type * from "./protocol.js";

export interface AppOptions {
  /** SQLite file, or ":memory:" for tests. */
  dataFile: string;
  /** Built web app to serve. Optional so the API can run without a UI build. */
  staticDir?: string;
}

type Handler = (params: string[], body: any, url: URL) => unknown;

const MAX_BODY = 4 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export function lanUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const a of addresses ?? []) {
      if (a.family === "IPv4" && !a.internal) urls.push(`http://${a.address}:${port}`);
    }
  }
  return urls;
}

/**
 * The SetFlow host: JSON API, LAN WebSocket sync and the static web app,
 * all served locally with no Internet dependency (spec §2.1, §23, §24).
 */
export function createApp(options: AppOptions) {
  const store = new Store(options.dataFile);
  const library = new Library(store);
  const live = new LiveHost(store, library);
  const sockets = new Map<WebSocket, { clientId: string; role: ClientRole } | null>();

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage) => {
    const data = JSON.stringify(message);
    for (const ws of sockets.keys()) if (ws.readyState === ws.OPEN) ws.send(data);
  };
  const broadcastClients = () =>
    broadcast({ type: "clients", clients: [...sockets.values()].filter((c) => c !== null) });

  live.onChange((status) => broadcast({ type: "status", status }));

  const routes: Array<[string, RegExp, Handler, { libraryChange?: boolean }?]> = [
    ["GET", /^\/api\/host$/, () => ({ urls: lanUrls(port()), clients: [...sockets.values()].filter(Boolean) })],

    ["GET", /^\/api\/songs$/, () => library.listSongs()],
    ["POST", /^\/api\/import\/preview$/, (_, b) => library.preview(b?.text)],
    ["POST", /^\/api\/songs$/, (_, b) => library.importSong(b ?? {}), { libraryChange: true }],
    ["GET", /^\/api\/songs\/([^/]+)$/, ([id]) => library.songDetail(id)],
    ["PUT", /^\/api\/songs\/([^/]+)$/, ([id], b) => library.updateSource(id, b?.text, b?.expectedRevision), { libraryChange: true }],
    ["DELETE", /^\/api\/songs\/([^/]+)$/, ([id]) => library.deleteSong(id), { libraryChange: true }],

    ["POST", /^\/api\/songs\/([^/]+)\/arrangements$/, ([id], b) => library.createArrangement(id, b ?? {}), { libraryChange: true }],
    ["PUT", /^\/api\/arrangements\/([^/]+)$/, ([id], b) => library.updateArrangement(id, b ?? {}), { libraryChange: true }],
    ["POST", /^\/api\/arrangements\/([^/]+)\/duplicate$/, ([id], b) => library.duplicateArrangement(id, b?.name), { libraryChange: true }],
    ["POST", /^\/api\/arrangements\/([^/]+)\/restore-source-order$/, ([id]) => library.restoreSourceOrder(id), { libraryChange: true }],
    ["DELETE", /^\/api\/arrangements\/([^/]+)$/, ([id]) => library.deleteArrangement(id), { libraryChange: true }],

    ["GET", /^\/api\/setlists$/, () => library.listSetlists()],
    ["POST", /^\/api\/setlists$/, (_, b) => library.saveSetlist(null, b ?? {}), { libraryChange: true }],
    ["GET", /^\/api\/setlists\/([^/]+)$/, ([id]) => library.getSetlist(id)],
    ["PUT", /^\/api\/setlists\/([^/]+)$/, ([id], b) => library.saveSetlist(id, b ?? {}), { libraryChange: true }],
    ["DELETE", /^\/api\/setlists\/([^/]+)$/, ([id]) => library.deleteSetlist(id), { libraryChange: true }],

    ["GET", /^\/api\/session$/, () => live.status()],
    ["GET", /^\/api\/session\/content$/, () => live.content()],
    ["POST", /^\/api\/session\/start$/, (_, b) => live.start(b ?? {})],
    ["POST", /^\/api\/session\/commands$/, (_, b) => live.submit(validateEnvelope(b))],
    ["POST", /^\/api\/session\/control$/, (_, b) => live.takeControl(b?.controllerId)],
    ["POST", /^\/api\/session\/key$/, (_, b) => live.setPerformanceKey(b?.controllerId, b?.performanceKey)],
    ["POST", /^\/api\/session\/cues$/, (_, b) => live.setCues(b?.controllerId, b?.cues)],
    ["POST", /^\/api\/recovery\/resume$/, (_, b) => live.resumeRecovery(b?.controllerId)],
    ["POST", /^\/api\/recovery\/discard$/, () => live.discardRecovery()],

    ["GET", /^\/api\/settings\/([\w-]+)$/, ([key]) => store.getSetting(key) ?? null],
    ["PUT", /^\/api\/settings\/([\w-]+)$/, ([key], b) => (store.setSetting(key, b?.value ?? null), b?.value ?? null)],
  ];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://host");
    try {
      if (url.pathname.startsWith("/api/")) {
        const method = req.method ?? "GET";
        for (const [m, pattern, handler, opts] of routes) {
          const match = pattern.exec(url.pathname);
          if (!match || m !== method) continue;
          const body = method === "GET" || method === "DELETE" ? undefined : await readJson(req);
          const result = handler(match.slice(1).map(decodeURIComponent), body, url);
          if (opts?.libraryChange) broadcast({ type: "library" });
          return json(res, 200, result ?? { ok: true });
        }
        throw new HttpError(404, `No API route ${method} ${url.pathname}`);
      }
      serveStatic(options.staticDir, url.pathname, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      json(res, status, { error: (err as Error).message });
    }
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  // ws re-emits the HTTP server's errors; listen() reports those, so don't crash here.
  wss.on("error", () => {});
  wss.on("connection", (ws) => {
    sockets.set(ws, null);
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 10_000);

    // A joining client gets the current snapshot straight away (spec §23).
    send(ws, { type: "status", status: live.status() });

    ws.on("message", (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data));
      } catch {
        return send(ws, { type: "error", message: "Malformed message" });
      }
      try {
        if (message.type === "hello") {
          sockets.set(ws, { clientId: String(message.clientId), role: message.role });
          broadcastClients();
        } else if (message.type === "command") {
          send(ws, { type: "ack", ack: live.submit(validateEnvelope(message.envelope)) });
        }
      } catch (err) {
        send(ws, { type: "error", message: (err as Error).message });
      }
    });
    ws.on("close", () => {
      clearInterval(ping);
      sockets.delete(ws);
      broadcastClients();
    });
  });

  let boundPort = 0;
  const port = () => boundPort;

  return {
    server,
    store,
    library,
    live,
    listen(listenPort: number, host = "0.0.0.0"): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(listenPort, host, () => {
          server.off("error", reject);
          boundPort = (server.address() as { port: number }).port;
          resolve(boundPort);
        });
      });
    },
    async close(): Promise<void> {
      for (const ws of sockets.keys()) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}

function validateEnvelope(raw: unknown): CommandEnvelope {
  const e = raw as Partial<CommandEnvelope> | undefined;
  const commandTypes = ["NEXT", "PREVIOUS", "REPEAT", "JUMP", "VAMP", "END"];
  if (
    !e ||
    typeof e.commandId !== "string" ||
    typeof e.sessionId !== "string" ||
    typeof e.expectedRevision !== "number" ||
    typeof e.controllerId !== "string" ||
    !e.command ||
    !commandTypes.includes(e.command.type) ||
    (e.command.type === "JUMP" && typeof e.command.sectionId !== "string")
  ) {
    throw new HttpError(400, "Malformed command envelope");
  }
  return { ...e, source: e.source ?? "web" } as CommandEnvelope;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function serveStatic(root: string | undefined, pathname: string, res: http.ServerResponse) {
  if (!root || !fs.existsSync(path.join(root, "index.html"))) {
    res.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    res.end("The SetFlow web app has not been built. Run `npm run build` from the repository root.");
    return;
  }
  const resolved = path.resolve(root, "." + decodeURIComponent(pathname));
  const inside = resolved.startsWith(path.resolve(root) + path.sep);
  const file = inside && fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : path.join(root, "index.html");
  const ext = path.extname(file);
  res.writeHead(200, {
    "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  fs.createReadStream(file).pipe(res);
}
