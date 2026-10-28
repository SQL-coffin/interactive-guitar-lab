"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChromaProgressionAnalysisOptions } from "@/services";
import { buildTimeline, formatSeconds, pathSymbolsByFrame, formatBytes } from "@/lib/audioTimeline";
import { displaySpelling } from "@/lib/roots";
import type { LabelMode } from "@/state/explorerState";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAudioAnalysis } from "@/state/useAudioAnalysis";
import { useFretboardData } from "@/state/useFretboardData";
import { PageIntro } from "@/components/AppShell/PageIntro";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState, ErrorState } from "@/components/ui/StatusMessage";
import { AudioFilePicker } from "./AudioFilePicker";
import { AudioTimeline } from "./AudioTimeline";
import { SegmentInspector } from "./SegmentInspector";
import styles from "./Audio.module.css";

const WINDOW_CHOICES = [0.5, 1, 2] as const;
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
  const service = useGuitarLabService();
  const id = useId();
  const { state, analyze, cancel } = useAudioAnalysis(service);
  const { fretboard, openStringNames, stringCount } = useFretboardData();
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [windowSeconds, setWindowSeconds] = useState<number>(1);
  const [minNotes, setMinNotes] = useState(4);
  const [labelMode, setLabelMode] = useState<LabelMode>("degree");
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [pathIndex, setPathIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  // A local object URL lets the user hear the file they analyzed; it never leaves the browser.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const busy = state.status === "uploading" || state.status === "analyzing";
  const result = state.status === "success" ? state.result : undefined;
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

  useEffect(() => {
    setSelectedFrame(null);
    setPathIndex(0);
  }, [result]);

  const start = () => {
    if (!file) return;
    const options: ChromaProgressionAnalysisOptions = {
      chordCandidateLimit: 3,
      voicingsPerChord: 5,
      voicingSearchOptions: { maxFret: 12, maxFretSpan: 4, minNotes },
      progressionOptions: { limit: 3 },
    };
    void analyze(file, windowSeconds, options);
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
            <label htmlFor={`${id}-window`}>
              <span>Analysis window</span>
              <select id={`${id}-window`} value={windowSeconds} disabled={busy} onChange={(e) => setWindowSeconds(Number(e.target.value))}>
                {WINDOW_CHOICES.map((w) => <option key={w} value={w}>{w} s</option>)}
              </select>
            </label>
            <label htmlFor={`${id}-min`}>
              <span>Min strings in fingerings</span>
              <select id={`${id}-min`} value={minNotes} disabled={busy} onChange={(e) => setMinNotes(Number(e.target.value))}>
                {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className={styles.uploadActions}>
              {busy ? <Button variant="ghost" onClick={cancel}>Cancel</Button> : null}
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
          </div>
        ) : null}
      </Panel>

      {!result ? (
        state.status === "idle" ? (
          <EmptyState title="No analysis yet">
            <p>
              Choose a recording and select “Analyze recording”. Results appear here; nothing is shown until the server
              returns a real analysis.
            </p>
          </EmptyState>
        ) : null
      ) : (
        <>
          <Panel title="Overview" titleId="overview-title">
            <dl className={styles.overview}>
              <div><dt>File</dt><dd>{result.audio.filename}{file ? ` · ${formatBytes(file.size)}` : ""}</dd></div>
              <div><dt>Duration</dt><dd>{formatSeconds(result.audio.durationSeconds)}</dd></div>
              <div>
                <dt>Tempo (estimate)</dt>
                <dd>{result.audio.rhythm.tempoBpm === null ? "No stable estimate" : `≈ ${result.audio.rhythm.tempoBpm.toFixed(1)} BPM`}</dd>
              </div>
              <div><dt>Beats detected</dt><dd>{result.audio.rhythm.beatTimesSeconds.length}</dd></div>
              <div><dt>Windows</dt><dd>{segments.length} × {result.audio.windowSeconds} s</dd></div>
              <div><dt>Silent windows</dt><dd>{result.chordAnalysis.skippedSilentFrameIndexes.length}</dd></div>
              <div><dt>Sample rate</dt><dd>{result.audio.sampleRate.toLocaleString()} Hz</dd></div>
            </dl>
            <p className={styles.caveat}>
              Tempo and beats are best-effort estimates and can be unreliable on rubato, syncopated or sustained material.
              Windows are fixed-length analysis intervals, not detected chord boundaries.
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
