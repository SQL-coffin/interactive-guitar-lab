import {
  summarizeProgression,
  summarizeSession,
  type AnalysisSession,
  type AnalysisSessionSummary,
  type SavedProgression,
  type SavedProgressionSummary,
} from "./model";

/** Storage for completed analyses and saved progressions. Audio files are never stored. */
export interface LabRepository {
  readonly kind: "indexeddb" | "memory";
  listSessions(): Promise<AnalysisSessionSummary[]>;
  getSession(id: string): Promise<AnalysisSession | undefined>;
  putSession(session: AnalysisSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listProgressions(): Promise<SavedProgressionSummary[]>;
  getProgression(id: string): Promise<SavedProgression | undefined>;
  putProgression(progression: SavedProgression): Promise<void>;
  deleteProgression(id: string): Promise<void>;
}

const byNewest = <T extends { createdAt?: string; updatedAt?: string }>(a: T, b: T) =>
  (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "");

/** In-memory repository: used in tests and when IndexedDB is unavailable (e.g. blocked storage). */
export function createMemoryRepository(): LabRepository {
  const sessions = new Map<string, AnalysisSession>();
  const progressions = new Map<string, SavedProgression>();
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    kind: "memory",
    listSessions: async () => [...sessions.values()].map(summarizeSession).sort(byNewest),
    getSession: async (id) => (sessions.has(id) ? clone(sessions.get(id)!) : undefined),
    putSession: async (session) => void sessions.set(session.id, clone(session)),
    deleteSession: async (id) => void sessions.delete(id),
    listProgressions: async () => [...progressions.values()].map(summarizeProgression).sort(byNewest),
    getProgression: async (id) => (progressions.has(id) ? clone(progressions.get(id)!) : undefined),
    putProgression: async (progression) => void progressions.set(progression.id, clone(progression)),
    deleteProgression: async (id) => void progressions.delete(id),
  };
}

const DB_NAME = "guitar-theory-lab";
const DB_VERSION = 1;
// Summaries are stored separately so listing never loads multi-megabyte analysis payloads.
const STORES = { sessions: "sessions", sessionIndex: "sessionIndex", progressions: "progressions" } as const;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed."));
  });
}

/** Opens the browser's IndexedDB store; rejects when IndexedDB is missing or blocked. */
export async function openIndexedDbRepository(factory: IDBFactory = indexedDB): Promise<LabRepository> {
  const open = factory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    for (const name of Object.values(STORES)) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
    }
  };
  const db = await request(open);

  const read = async <T>(store: string, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
    const tx = db.transaction(store, "readonly");
    const result = await request(fn(tx.objectStore(store)));
    await done(tx);
    return result;
  };
  const write = async (stores: string[], fn: (tx: IDBTransaction) => void) => {
    const tx = db.transaction(stores, "readwrite");
    fn(tx);
    await done(tx);
  };

  return {
    kind: "indexeddb",
    listSessions: async () => ((await read(STORES.sessionIndex, (s) => s.getAll())) as AnalysisSessionSummary[]).sort(byNewest),
    getSession: (id) => read(STORES.sessions, (s) => s.get(id)) as Promise<AnalysisSession | undefined>,
    putSession: (session) => write([STORES.sessions, STORES.sessionIndex], (tx) => {
      tx.objectStore(STORES.sessions).put(session);
      tx.objectStore(STORES.sessionIndex).put(summarizeSession(session));
    }),
    deleteSession: (id) => write([STORES.sessions, STORES.sessionIndex], (tx) => {
      tx.objectStore(STORES.sessions).delete(id);
      tx.objectStore(STORES.sessionIndex).delete(id);
    }),
    listProgressions: async () =>
      ((await read(STORES.progressions, (s) => s.getAll())) as SavedProgression[]).map(summarizeProgression).sort(byNewest),
    getProgression: (id) => read(STORES.progressions, (s) => s.get(id)) as Promise<SavedProgression | undefined>,
    putProgression: (progression) => write([STORES.progressions], (tx) => void tx.objectStore(STORES.progressions).put(progression)),
    deleteProgression: (id) => write([STORES.progressions], (tx) => void tx.objectStore(STORES.progressions).delete(id)),
  };
}
