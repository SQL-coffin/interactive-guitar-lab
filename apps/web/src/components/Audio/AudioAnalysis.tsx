"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChromaProgressionAnalysisOptions } from "@/services";
import { buildTimeline, formatSeconds, pathSymbolsByFrame, formatBytes } from "@/lib/audioTimeline";
import { displaySpelling } from "@/lib/roots";
import type { LabelMode } from "@/state/explorerState";
import { useLab } from "@/state/lab/LabSessionProvider";
import { useFretboardData } from "@/state/useFretboardData";
import { PageIntro } from "@/components/AppShell/PageIntro";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState, ErrorState } from "@/components/ui/StatusMessage";
import { AudioFilePicker } from "./AudioFilePicker";
import { AudioTimeline } from "./AudioTimeline";
import { SegmentInspector } from "./SegmentInspector";
import { RecentAnalyses } from "./RecentAnalyses";
import { SessionProgression } from "./SessionProgression";
import styles from "./Audio.module.css";

const WINDOW_CHOICES = [0.5, 1, 2] as const;
type WindowStrategy = "manual" | "auto";
const LABEL_MODES: ReadonlyArray<{ value: LabelMode; label: string }> = [
  { value: "degree", label: "Degrees" },
  { value: "note", label: "Notes" },
];

function errorTitle(status: number | undefined, code: string): string {
  if (status === 502) return "The audio analysis worker is unavailable";
  if (status === 413) return "This file is too large";
  if (code === "network_error") return "Couldn't reach the server";
  if (code === "invalid_request") return "The server couldn't analyze this file";
  return "Audio analysis failed";
}

export function AudioAnalysis() {
  const id = useId();
  // Run state and the analysis result live in LabSessionProvider so they survive navigation.
  const lab = useLab();
  const { run: state, activeSession, focus, clearFocus } = lab;
  const { fretboard, openStringNames, stringCount } = useFretboardData();
  const [file, setFile] = useState<File | null>(() => lab.audio?.file ?? null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [windowSeconds, setWindowSeconds] = useState<number>(1);
  const [windowStrategy, setWindowStrategy] = useState<WindowStrategy>("manual");
  const [minNotes, setMinNotes] = useState(4);
  const [labelMode, setLabelMode] = useState<LabelMode>("degree");
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [pathIndex, setPathIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Playback uses the in-memory file for this session only; audio is never stored.
  const playbackFile = activeSession && lab.audio?.sessionId === activeSession.id ? lab.audio.file : null;
  useEffect(() => {
    if (!playbackFile) {
      setFileUrl(null);
      return;
    }
    const url = URL.createObjectURL(playbackFile);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [playbackFile]);

  const busy = state.status === "uploading" || state.status === "analyzing";
  const result = activeSession?.result;
  const optimization = result?.chordAnalysis.optimization ?? null;
  const path = optimization?.results[Math.min(pathIndex, optimization.results.length - 1)];
  const segments = useMemo(
    () => (result ? buildTimeline(result.chordAnalysis.frameResults, result.audio.durationSeconds, result.chordAnalysis.progressionFrameIndexes) : []),
    [result],
  );
  const pathSymbols = useMemo(() => pathSymbolsByFrame(segments, path), [segments, path]);
  const selected = selectedFrame !== null ? segments[selectedFrame] : undefined;
  const selectedStep = selected?.stepIndex != null ? path?.steps[selected.stepIndex] : undefined;
  const previousStep = selected?.stepIndex != null && selected.stepIndex > 0 ? path?.steps[selected.stepIndex - 1] : undefined;
  const frameDurations = useMemo(
    () => result?.chordAnalysis.frameResults.map((frame) => Math.max(0, frame.endSeconds - frame.startSeconds)) ?? [],
    [result],
  );
  const actualWindowRange = useMemo(() => {
    if (frameDurations.length === 0) return "No frame data";
    const minimum = Math.min(...frameDurations);
    const maximum = Math.max(...frameDurations);
    const format = (value: number) => `${value.toFixed(2)} s`;
    return minimum.toFixed(2) === maximum.toFixed(2)
      ? format(minimum)
      : `${format(minimum)}–${format(maximum)} actual range`;
  }, [frameDurations]);
  const windowStrategySummary = result?.audio.windowStrategy === "auto"
    ? result.audio.windowingMode === "adaptive-beat-aligned"
      ? "Auto · adaptive beat-aligned"
      : "Auto · 1 s fallback"
    : `Manual · ${(result?.audio.windowSeconds ?? windowSeconds).toFixed(1)} s target`;

  // Reset the view only when a different session becomes active (not on every remount).
  const sessionId = activeSession?.id;
  useEffect(() => {
    setSelectedFrame(null);
    setPathIndex(0);
  }, [sessionId]);

  // Another page asked to show a window (e.g. "Show in analysis" on a progression chord).
  const openSession = lab.openSession;
  useEffect(() => {
    if (!focus) return;
    if (focus.sessionId !== sessionId) {
      void openSession(focus.sessionId);
      return;
    }
    setPathIndex(focus.pathIndex);
    setSelectedFrame(focus.frameIndex);
    clearFocus();
    document.getElementById("detail-title")?.scrollIntoView({ block: "start" });
  }, [focus, sessionId, openSession, clearFocus]);

  const start = () => {
    if (!file) return;
    const options: ChromaProgressionAnalysisOptions = {
      chordCandidateLimit: 3,
      voicingsPerChord: 5,
      voicingSearchOptions: { maxFret: 12, maxFretSpan: 4, minNotes },
      progressionOptions: { limit: 3 },
    };
    void lab.analyze(file, windowSeconds, options, windowStrategy);
  };

  const selectFrame = (frameIndex: number) => {
    setSelectedFrame(frameIndex);
    const segment = segments[frameIndex];
    if (segment && audioRef.current) audioRef.current.currentTime = segment.startSeconds;
  };

  const progress = state.status === "uploading" && state.total ? Math.round((state.loaded / state.total) * 100) : null;

  return (
    <>
      <PageIntro title="Audio analysis">
        Upload a recording to estimate tempo, rank chord hypotheses for each time window, and see a playable fingering path.
      </PageIntro>

      <Panel title="Recording" titleId="recording-title" description="The file is sent to this app's server, which forwards it to the audio worker.">
        <div className={styles.uploadGrid}>
          <AudioFilePicker file={file} disabled={busy} onFile={setFile} />
          <form
            className={styles.uploadForm}
            aria-label="Analysis settings"
            onSubmit={(event) => {
              event.preventDefault();
              start();
            }}
          >
            <label htmlFor={`${id}-strategy`}>
              <span>Window strategy</span>
              <select id={`${id}-strategy`} value={windowStrategy} disabled={busy} onChange={(e) => setWindowStrategy(e.target.value as WindowStrategy)}>
                <option value="manual">Manual</option>
                <option value="auto">Auto</option>
              </select>
            </label>
            <label htmlFor={`${id}-window`}>
              <span>Analysis window</span>
              <select id={`${id}-window`} value={windowSeconds} disabled={busy || windowStrategy === "auto"} onChange={(e) => setWindowSeconds(Number(e.target.value))}>
                {WINDOW_CHOICES.map((w) => <option key={w} value={w}>{w} s</option>)}
              </select>
            </label>
            {windowStrategy === "auto" ? (
              <p className={styles.caveat}>
                Auto chooses coarser beat-aligned windows in stable passages and splits near strong chord changes. Without reliable beat detection, it falls back to fixed one-second windows.
              </p>
            ) : null}
            <label htmlFor={`${id}-min`}>
              <span>Min strings in fingerings</span>
              <select id={`${id}-min`} value={minNotes} disabled={busy} onChange={(e) => setMinNotes(Number(e.target.value))}>
                {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className={styles.uploadActions}>
              {busy ? <Button variant="ghost" onClick={lab.cancelAnalysis}>Cancel</Button> : null}
              <Button type="submit" variant="primary" disabled={!file || busy}>
                {result ? "Analyze again" : "Analyze recording"}
              </Button>
            </div>

            {state.status === "uploading" ? (
              <div className={styles.progress} role="status" aria-live="polite">
                <span>Uploading {state.fileName}{progress !== null ? ` · ${progress}%` : "…"}</span>
                <progress max={100} value={progress ?? undefined} aria-label="Upload progress" />
              </div>
            ) : null}
            {state.status === "analyzing" ? (
              <div className={styles.progress} role="status" aria-live="polite">
                <span>Upload complete. Analyzing on the server…</span>
                <progress aria-label="Analysis in progress" />
              </div>
            ) : null}
          </form>
        </div>

        {state.status === "error" ? (
          <div className={styles.errorWrap}>
            <ErrorState
              title={errorTitle(state.error.status, state.error.code)}
              message={
                state.error.status === 502
                  ? `${state.error.message} Start the worker in services/audio-worker (see its README), then try again.`
                  : state.error.message
              }
              {...(file ? { onRetry: start } : {})}
            />
            {activeSession ? (
              <p className={styles.caveat} role="note">
                Nothing was saved for {state.fileName ?? "this file"}. The results below are your previous analysis of{" "}
                {activeSession.source.filename}.
              </p>
            ) : null}
          </div>
        ) : null}
      </Panel>

      {lab.storage.warning ? <p className={styles.storageWarning} role="note">{lab.storage.warning}</p> : null}
      {lab.sessionError ? (
        <ErrorState title="Couldn't open the analysis" message={lab.sessionError} />
      ) : null}

      <RecentAnalyses />

      {!result || !activeSession ? (
        state.status === "idle" || state.status === "error" ? (
          <EmptyState title="No analysis yet">
            <p>
              Choose a recording and select “Analyze recording”, or open a recent analysis. Results appear here; nothing
              is shown until the server returns a real analysis.
            </p>
          </EmptyState>
        ) : null
      ) : (
        <>
          <Panel
            title="Overview"
            titleId="overview-title"
            description={`Active analysis session · ${new Date(activeSession.createdAt).toLocaleString()}`}
            actions={<Button size="sm" variant="ghost" onClick={lab.closeSession}>Close session</Button>}
          >
            <dl className={styles.overview}>
              <div><dt>File</dt><dd>{activeSession.source.filename} · {formatBytes(activeSession.source.sizeBytes)}</dd></div>
              <div><dt>Duration</dt><dd>{formatSeconds(result.audio.durationSeconds)}</dd></div>
              <div>
                <dt>Tempo (estimate)</dt>
                <dd>{result.audio.rhythm.tempoBpm === null ? "No stable estimate" : `≈ ${result.audio.rhythm.tempoBpm.toFixed(1)} BPM`}</dd>
              </div>
              <div><dt>Beats detected</dt><dd>{result.audio.rhythm.beatTimesSeconds.length}</dd></div>
              <div><dt>Window strategy</dt><dd>{windowStrategySummary}</dd></div>
              <div><dt>Windows</dt><dd>{result.chordAnalysis.frameResults.length} · {actualWindowRange}</dd></div>
              <div><dt>Silent windows</dt><dd>{result.chordAnalysis.skippedSilentFrameIndexes.length}</dd></div>
              <div><dt>Sample rate</dt><dd>{result.audio.sampleRate.toLocaleString()} Hz</dd></div>
            </dl>
            <p className={styles.caveat}>
              Tempo and beats are best-effort estimates and can be unreliable on rubato, syncopated or sustained material.{" "}
              {result.audio.windowStrategy === "auto"
                ? "Auto uses chroma changes to suggest likely chord boundaries; it may miss changes or split on other musical changes."
                : "Manual uses the chosen target duration; actual windows may align to detected beats. Windows are not guaranteed chord boundaries."}
            </p>
          </Panel>

          <Panel
            title="Timeline"
            titleId="timeline-title"
            description="Select a window (or use the arrow keys) to inspect its hypotheses and fingering. Beat estimates are marked on the ruler."
            actions={
              optimization && optimization.results.length > 1 ? (
                <SegmentedControl
                  label="Fingering path"
                  hideLabel
                  value={String(pathIndex)}
                  options={optimization.results.map((r, i) => ({ value: String(i), label: `Path ${i + 1} · ${r.totalCost.toFixed(1)}` }))}
                  onChange={(value) => setPathIndex(Number(value))}
                />
              ) : null
            }
          >
            {!fileUrl ? (
              <p className={styles.caveat}>
                Audio isn&rsquo;t stored with saved analyses, so playback is off for this session.{" "}
                <label className={styles.attach}>
                  Attach {activeSession.source.filename} to listen
                  <input
                    type="file"
                    accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff"
                    className="visually-hidden"
                    onChange={(event) => {
                      const chosen = event.target.files?.[0];
                      if (chosen) lab.attachAudio(chosen, activeSession.id);
                    }}
                  />
                </label>{" "}
                (no re-analysis).
              </p>
            ) : null}
            {fileUrl ? (
              <audio
                ref={audioRef}
                className={styles.player}
                controls
                src={fileUrl}
                onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
              >
                Your browser cannot play this file.
              </audio>
            ) : null}
            {segments.length === 0 ? (
              <EmptyState title="The analysis returned no windows" />
            ) : (
              <AudioTimeline
                segments={segments}
                pathSymbols={pathSymbols}
                beats={result.audio.rhythm.beatTimesSeconds}
                durationSeconds={result.audio.durationSeconds}
                currentTime={currentTime}
                selectedFrame={selectedFrame}
                onSelect={selectFrame}
              />
            )}
            {optimization === null ? (
              <p className={styles.caveat}>Every window was silent, so no fingering path was computed.</p>
            ) : path ? (
              <p className={styles.caveat}>
                Path {pathIndex + 1} of {optimization.results.length}: {path.steps.length} steps, total cost {path.totalCost.toFixed(2)}{" "}
                (lower is easier under the engine&rsquo;s heuristic cost model; not a musical judgement).
              </p>
            ) : null}
          </Panel>

          <SessionProgression
            session={activeSession}
            pathIndex={pathIndex}
            selectedFrame={selectedFrame}
            onSelectWindow={selectFrame}
          />

          <Panel
            title="Window detail"
            titleId="detail-title"
            actions={<SegmentedControl label="Marker labels" hideLabel value={labelMode} options={LABEL_MODES} onChange={setLabelMode} />}
          >
            {selected && result.chordAnalysis.frameResults[selected.frameIndex] ? (
              <SegmentInspector
                key={`${selected.frameIndex}:${pathIndex}`}
                frame={result.chordAnalysis.frameResults[selected.frameIndex]!}
                frameIndex={selected.frameIndex}
                step={selectedStep}
                previousStep={previousStep}
                labelMode={labelMode}
                positions={fretboard.status === "success" ? fretboard.data.positions : undefined}
                maxFret={fretboard.status === "success" ? fretboard.data.maxFret : 15}
                stringCount={stringCount}
                openStringNames={openStringNames}
              />
            ) : (
              <EmptyState title="Select a window on the timeline">
                {segments[0]?.topSymbol ? (
                  <p>The first window&rsquo;s top hypothesis is {displaySpelling(segments[0].topSymbol)}.</p>
                ) : null}
              </EmptyState>
            )}
          </Panel>
        </>
      )}
    </>
  );
}
