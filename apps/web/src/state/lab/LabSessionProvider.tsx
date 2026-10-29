"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { ChromaProgressionAnalysisOptions } from "@/services";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAudioAnalysis, type AudioAnalysisState } from "@/state/useAudioAnalysis";
import { useProgressionOptimizer } from "@/state/useProgressionOptimizer";
import {
  DEFAULT_PROGRESSION_SETTINGS,
  INITIAL_PROGRESSION_STATE,
  MAX_PROGRESSION_LENGTH,
  progressionReducer,
  type ProgressionAction,
  type ProgressionSlot,
  type ProgressionState,
} from "@/state/progressionState";
import {
  extractChordSequence,
  type AnalysisSession,
  type AnalysisSessionSummary,
  type SavedProgression,
  type SavedProgressionSummary,
} from "./model";
import { createMemoryRepository, openIndexedDbRepository, type LabRepository } from "./repository";
import { emptyScore, type ScoreDocument } from "@/lib/score/document";

export interface ScoreDraft {
  doc: ScoreDocument;
  dirty: boolean;
  status: "loading" | "ready";
  lastSavedAt: string | null;
}

export interface ProgressionDraft {
  progression: ProgressionState;
  /** Id of the saved record this draft was loaded from or saved as. */
  savedId: string | null;
  name: string;
  /** Analysis session the chords were extracted from, if any. */
  sessionId: string | null;
  dirty: boolean;
  lastSavedAt: string | null;
}

type DraftAction =
  | { type: "edit"; action: ProgressionAction }
  | { type: "replace"; draft: ProgressionDraft }
  | { type: "saved"; id: string; at: string };

const EMPTY_DRAFT: ProgressionDraft = {
  progression: INITIAL_PROGRESSION_STATE,
  savedId: null,
  name: "Untitled progression",
  sessionId: null,
  dirty: false,
  lastSavedAt: null,
};

function draftReducer(state: ProgressionDraft, action: DraftAction): ProgressionDraft {
  switch (action.type) {
    case "edit": {
      const progression = progressionReducer(state.progression, action.action);
      return progression === state.progression ? state : { ...state, progression, dirty: true };
    }
    case "replace":
      return action.draft;
    case "saved":
      return { ...state, savedId: action.id, lastSavedAt: action.at, dirty: false };
  }
}

export interface TimelineFocus {
  sessionId: string;
  frameIndex: number;
  pathIndex: number;
}

export interface CreatedProgression {
  chordCount: number;
  /** Chords beyond MAX_PROGRESSION_LENGTH that were not included. */
  omitted: number;
}

interface LabContextValue {
  storage: { ready: boolean; kind: LabRepository["kind"] | null; warning: string | null };
  sessions: AnalysisSessionSummary[];
  activeSession: AnalysisSession | null;
  sessionError: string | null;
  run: AudioAnalysisState;
  analyze: (file: File, windowSeconds: number, options: ChromaProgressionAnalysisOptions, windowStrategy?: "manual" | "auto") => Promise<void>;
  cancelAnalysis: () => void;
  /** In-memory only: the file the user picked, for playback. Never persisted. */
  audio: { file: File; sessionId: string | null } | null;
  attachAudio: (file: File, sessionId: string | null) => void;
  openSession: (id: string) => Promise<void>;
  closeSession: () => void;
  deleteSession: (id: string) => Promise<void>;
  draft: ProgressionDraft;
  dispatchProgression: (action: ProgressionAction) => void;
  createProgressionFromSession: (pathIndex: number) => CreatedProgression;
  saveProgression: (name?: string) => Promise<void>;
  openProgression: (id: string) => Promise<void>;
  newProgression: () => void;
  deleteProgression: (id: string) => Promise<void>;
  savedProgressions: SavedProgressionSummary[];
  optimizer: ReturnType<typeof useProgressionOptimizer>;
  focus: TimelineFocus | null;
  focusWindow: (focus: TimelineFocus) => void;
  clearFocus: () => void;
  /** Editable score for the active session (null when no session is active). */
  score: ScoreDraft | null;
  editScore: (update: (doc: ScoreDocument) => ScoreDocument) => void;
  saveScore: () => Promise<void>;
}

const LabContext = createContext<LabContextValue | null>(null);

const ACTIVE_SESSION_KEY = "igl.activeSessionId";
const ACTIVE_PROGRESSION_KEY = "igl.activeProgressionId";

// localStorage only remembers which records are active; it can be unavailable, so never rely on it.
function remember(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked: the session simply is not auto-restored */ }
}
function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function defaultRepository(): Promise<{ repo: LabRepository; warning: string | null }> {
  try {
    return { repo: await openIndexedDbRepository(), warning: null };
  } catch {
    return {
      repo: createMemoryRepository(),
      warning: "Browser storage is unavailable, so analyses and progressions are kept only until this tab closes.",
    };
  }
}

/**
 * Owns the state that must outlive a page: the analysis run, the active analysis session and the
 * progression draft. It sits in the root layout, which stays mounted across route changes.
 */
export function LabSessionProvider({ children, repository }: { children: ReactNode; repository?: LabRepository }) {
  const service = useGuitarLabService();
  const { state: run, analyze: runAnalysis, cancel: cancelAnalysis } = useAudioAnalysis(service);
  const optimizer = useProgressionOptimizer(service);
  const [repo, setRepo] = useState<LabRepository | null>(repository ?? null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AnalysisSessionSummary[]>([]);
  const [savedProgressions, setSavedProgressions] = useState<SavedProgressionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<AnalysisSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [audio, setAudio] = useState<{ file: File; sessionId: string | null } | null>(null);
  const [draft, dispatchDraft] = useReducer(draftReducer, EMPTY_DRAFT);
  const [focus, setFocus] = useState<TimelineFocus | null>(null);
  const [score, setScore] = useState<ScoreDraft | null>(null);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const resetOptimizer = optimizer.reset;

  // Open storage, then restore the last active session and saved progression.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let store = repository;
      if (!store) {
        const opened = await defaultRepository();
        store = opened.repo;
        if (!cancelled) setStorageWarning(opened.warning);
      }
      if (cancelled) return;
      setRepo(store);
      const [sessionList, progressionList] = await Promise.all([store.listSessions(), store.listProgressions()]);
      if (cancelled) return;
      setSessions(sessionList);
      setSavedProgressions(progressionList);
      const sessionId = recall(ACTIVE_SESSION_KEY);
      if (sessionId) {
        const session = await store.getSession(sessionId);
        if (!cancelled) {
          if (session) setActiveSession(session);
          else remember(ACTIVE_SESSION_KEY, null);
        }
      }
      const progressionId = recall(ACTIVE_PROGRESSION_KEY);
      if (progressionId && !draftRef.current.dirty && draftRef.current.progression.slots.length === 0) {
        const saved = await store.getProgression(progressionId);
        if (!cancelled && saved) dispatchDraft({ type: "replace", draft: draftFromSaved(saved) });
      }
    })().catch(() => {
      if (!cancelled) setStorageWarning("Saved analyses could not be loaded from browser storage.");
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  // Load the score overlay for the active session (an empty one if none was saved).
  const activeSessionId = activeSession?.id ?? null;
  useEffect(() => {
    if (!activeSessionId) {
      setScore(null);
      return;
    }
    let cancelled = false;
    setScore({ doc: emptyScore(activeSessionId), dirty: false, status: "loading", lastSavedAt: null });
    (async () => {
      const saved = repo ? await repo.getScore(activeSessionId).catch(() => undefined) : undefined;
      if (cancelled) return;
      setScore((current) => (current && current.doc.sessionId === activeSessionId && current.dirty
        ? { ...current, status: "ready" }
        : { doc: saved ?? emptyScore(activeSessionId), dirty: false, status: "ready", lastSavedAt: saved?.updatedAt ?? null }));
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, repo]);

  // Unsaved progression or score edits are only in memory; warn before a reload or tab close discards them.
  const anyDirty = draft.dirty || score?.dirty === true;
  useEffect(() => {
    if (!anyDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyDirty]);

  const refreshLists = useCallback(async (store: LabRepository) => {
    const [sessionList, progressionList] = await Promise.all([store.listSessions(), store.listProgressions()]);
    setSessions(sessionList);
    setSavedProgressions(progressionList);
  }, []);

  const analyze = useCallback(async (file: File, windowSeconds: number, options: ChromaProgressionAnalysisOptions, windowStrategy: "manual" | "auto" = "manual") => {
    setAudio({ file, sessionId: null });
    const result = await runAnalysis(file, windowSeconds, options, windowStrategy);
    if (!result) return;
    const session: AnalysisSession = {
      schemaVersion: 1,
      id: newId(),
      createdAt: new Date().toISOString(),
      source: { filename: file.name, sizeBytes: file.size, mimeType: file.type },
      request: { windowSeconds, windowStrategy, options },
      result,
    };
    setActiveSession(session);
    setSessionError(null);
    setAudio({ file, sessionId: session.id });
    setFocus(null);
    remember(ACTIVE_SESSION_KEY, session.id);
    if (repo) {
      try {
        await repo.putSession(session);
        await refreshLists(repo);
      } catch {
        setStorageWarning("This analysis could not be saved to browser storage; it is available until the tab closes.");
      }
    }
  }, [repo, refreshLists, runAnalysis]);

  const openSession = useCallback(async (id: string) => {
    if (!repo) return;
    setSessionError(null);
    try {
      const session = await repo.getSession(id);
      if (!session) throw new Error("missing");
      setActiveSession(session);
      setFocus(null);
      remember(ACTIVE_SESSION_KEY, id);
    } catch {
      setSessionError("That analysis could not be loaded from browser storage.");
    }
  }, [repo]);

  const closeSession = useCallback(() => {
    setActiveSession(null);
    setFocus(null);
    remember(ACTIVE_SESSION_KEY, null);
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    if (!repo) return;
    await repo.deleteSession(id);
    if (activeSession?.id === id) closeSession();
    await refreshLists(repo);
  }, [repo, activeSession, closeSession, refreshLists]);

  const createProgressionFromSession = useCallback((pathIndex: number): CreatedProgression => {
    if (!activeSession) return { chordCount: 0, omitted: 0 };
    const chords = extractChordSequence(activeSession.result, pathIndex);
    const kept = chords.slice(0, MAX_PROGRESSION_LENGTH);
    const slots: ProgressionSlot[] = kept.map((chord) => ({
      id: "",
      root: chord.detected.root,
      quality: chord.detected.quality,
      source: { ...chord, sessionId: activeSession.id, pathIndex },
    }));
    const progression = progressionReducer(
      { ...INITIAL_PROGRESSION_STATE, nextId: draftRef.current.progression.nextId },
      { type: "load", slots, settings: DEFAULT_PROGRESSION_SETTINGS },
    );
    dispatchDraft({
      type: "replace",
      draft: {
        progression,
        savedId: null,
        name: `${activeSession.source.filename} · path ${pathIndex + 1}`,
        sessionId: activeSession.id,
        dirty: true,
        lastSavedAt: null,
      },
    });
    resetOptimizer();
    remember(ACTIVE_PROGRESSION_KEY, null);
    return { chordCount: kept.length, omitted: chords.length - kept.length };
  }, [activeSession, resetOptimizer]);

  const saveProgression = useCallback(async (name?: string) => {
    if (!repo) return;
    const current = draftRef.current;
    const now = new Date().toISOString();
    const id = current.savedId ?? newId();
    const existing = current.savedId ? await repo.getProgression(current.savedId) : undefined;
    const record: SavedProgression = {
      schemaVersion: 1,
      id,
      name: name?.trim() || current.name,
      sessionId: current.sessionId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      slots: current.progression.slots,
      settings: current.progression.settings,
    };
    await repo.putProgression(record);
    if (name?.trim()) dispatchDraft({ type: "replace", draft: { ...current, name: record.name } });
    dispatchDraft({ type: "saved", id, at: now });
    remember(ACTIVE_PROGRESSION_KEY, id);
    await refreshLists(repo);
  }, [repo, refreshLists]);

  const openProgression = useCallback(async (id: string) => {
    if (!repo) return;
    const saved = await repo.getProgression(id);
    if (!saved) return;
    dispatchDraft({ type: "replace", draft: draftFromSaved(saved) });
    resetOptimizer();
    remember(ACTIVE_PROGRESSION_KEY, id);
  }, [repo, resetOptimizer]);

  const newProgression = useCallback(() => {
    dispatchDraft({ type: "replace", draft: { ...EMPTY_DRAFT, progression: { ...INITIAL_PROGRESSION_STATE, nextId: draftRef.current.progression.nextId } } });
    resetOptimizer();
    remember(ACTIVE_PROGRESSION_KEY, null);
  }, [resetOptimizer]);

  const deleteProgression = useCallback(async (id: string) => {
    if (!repo) return;
    await repo.deleteProgression(id);
    if (draftRef.current.savedId === id) dispatchDraft({ type: "replace", draft: { ...draftRef.current, savedId: null, dirty: true } });
    if (recall(ACTIVE_PROGRESSION_KEY) === id) remember(ACTIVE_PROGRESSION_KEY, null);
    await refreshLists(repo);
  }, [repo, refreshLists]);

  const dispatchProgression = useCallback((action: ProgressionAction) => dispatchDraft({ type: "edit", action }), []);
  const attachAudio = useCallback((file: File, sessionId: string | null) => setAudio({ file, sessionId }), []);
  const focusWindow = useCallback((next: TimelineFocus) => setFocus(next), []);
  const editScore = useCallback((update: (doc: ScoreDocument) => ScoreDocument) => {
    setScore((current) => (current ? { ...current, doc: update(current.doc), dirty: true } : current));
  }, []);
  const saveScore = useCallback(async () => {
    const current = scoreRef.current;
    if (!repo || !current) return;
    const doc = { ...current.doc, updatedAt: new Date().toISOString() };
    await repo.putScore(doc);
    setScore((latest) => (latest && latest.doc.sessionId === doc.sessionId
      ? { doc: latest.doc === current.doc ? doc : latest.doc, dirty: latest.doc !== current.doc, status: "ready", lastSavedAt: doc.updatedAt }
      : latest));
  }, [repo]);
  const clearFocus = useCallback(() => setFocus(null), []);

  const value = useMemo<LabContextValue>(() => ({
    storage: { ready: repo !== null, kind: repo?.kind ?? null, warning: storageWarning },
    sessions, activeSession, sessionError, run, analyze, cancelAnalysis, audio, attachAudio,
    openSession, closeSession, deleteSession,
    draft, dispatchProgression, createProgressionFromSession, saveProgression, openProgression, newProgression,
    deleteProgression, savedProgressions, optimizer, focus, focusWindow, clearFocus, score, editScore, saveScore,
  }), [repo, storageWarning, sessions, activeSession, sessionError, run, analyze, cancelAnalysis, audio, attachAudio,
    openSession, closeSession, deleteSession, draft, dispatchProgression, createProgressionFromSession, saveProgression,
    openProgression, newProgression, deleteProgression, savedProgressions, optimizer, focus, focusWindow, clearFocus,
    score, editScore, saveScore]);

  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

function draftFromSaved(saved: SavedProgression): ProgressionDraft {
  return {
    // Re-key through the reducer so slot ids stay unique in this tab.
    progression: progressionReducer(INITIAL_PROGRESSION_STATE, {
      type: "load",
      slots: saved.slots,
      settings: { ...DEFAULT_PROGRESSION_SETTINGS, ...saved.settings },
    }),
    savedId: saved.id,
    name: saved.name,
    sessionId: saved.sessionId,
    dirty: false,
    lastSavedAt: saved.updatedAt,
  };
}

export function useLab(): LabContextValue {
  const value = useContext(LabContext);
  if (!value) throw new Error("useLab must be used inside <LabSessionProvider>.");
  return value;
}
