/**
 * Shapes exchanged between the host and its browser clients. Type-only and
 * free of Node imports so the web app can share them.
 */
import type { ArrangementItem, ChartLine, CommandAck, CommandEnvelope, PerformanceState, SongMetadata } from "@setflow/core";

/** Where a song came from (spec §16.1–16.2). Content stays on this host. */
export interface Provenance {
  providerId: "file" | "paste" | "manual";
  fileName?: string;
  importedAt: string;
  storagePolicy: "organization-local";
}

export interface SongRecord {
  id: string;
  title: string;
  /** The ChordPro exactly as imported or last edited. Reparsed on every read. */
  sourceText: string;
  revision: number;
  provenance: Provenance;
  createdAt: string;
  updatedAt: string;
}

/** A saved Song Map. Stored as map text ("I → V1 → B×2") so it survives source edits that renumber sections. */
export interface ArrangementRecord {
  id: string;
  songId: string;
  name: string;
  songMap: string;
  performanceKey: string | null;
  revision: number;
  updatedAt: string;
}

export interface SetlistItem {
  songId: string;
  arrangementId: string;
  performanceKey?: string;
}

export interface SetlistRecord {
  id: string;
  name: string;
  items: SetlistItem[];
  revision: number;
  updatedAt: string;
}

export interface SectionSummary {
  id: string;
  token: string;
  sourceLabel: string;
  displayLabel: string;
  type: string;
  lineCount: number;
}

export interface ImportPreview {
  metadata: SongMetadata;
  sections: SectionSummary[];
  sourceOrderMap: string;
  warnings: string[];
}

export interface ArrangementView extends ArrangementRecord {
  /** Resolved against the current song source; null when the map no longer matches it. */
  items: ArrangementItem[] | null;
  error: string | null;
}

export interface SongSummary {
  id: string;
  title: string;
  artist?: string;
  originalKey?: string;
  revision: number;
  sectionCount: number;
  provenance: Provenance;
  updatedAt: string;
}

export interface SongDetail {
  song: SongRecord;
  metadata: SongMetadata;
  sections: SectionSummary[];
  arrangements: ArrangementView[];
}

/** Everything a view needs to render the pinned song. Fetched once per session id. */
export interface SessionContent {
  sessionId: string;
  songId: string;
  songRevision: number;
  title: string;
  arrangementId: string;
  arrangementName: string;
  songMap: string;
  metadata: SongMetadata;
  sections: Array<SectionSummary & { lines: ChartLine[] }>;
}

export interface RecoverySummary {
  title: string;
  arrangementName: string;
  current: string | null;
  status: PerformanceState["status"];
  savedAt: string;
}

/** The authoritative live status broadcast to every client. */
export interface LiveStatus {
  state: PerformanceState | null;
  controllerId: string | null;
  title: string | null;
  recovery: RecoverySummary | null;
}

export type ClientRole = "control" | "stage" | "musician";

export interface ConnectedClient {
  clientId: string;
  role: ClientRole;
}

export interface HostInfo {
  urls: string[];
  clients: ConnectedClient[];
}

/** Messages the host sends over the LAN WebSocket. */
export type ServerMessage =
  | { type: "status"; status: LiveStatus }
  | { type: "ack"; ack: CommandAck }
  | { type: "clients"; clients: ConnectedClient[] }
  | { type: "library" }
  | { type: "error"; message: string };

/** Messages clients send. Commands carry the same envelope as the HTTP endpoint. */
export type ClientMessage =
  | { type: "hello"; clientId: string; role: ClientRole }
  | { type: "command"; envelope: CommandEnvelope };
