"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChordQuality } from "@/services";
import { displaySpelling } from "@/lib/roots";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAsyncResource } from "@/state/useAsyncResource";
import { useFretboardData } from "@/state/useFretboardData";
import type { LabelMode } from "@/state/explorerState";
import {
  EXAMPLE_PROGRESSION,
  MAX_OPTIMIZE_SEGMENT,
  MAX_PROGRESSION_LENGTH,
  candidatesPerChord,
  optimizeSegment,
  progressionRequestKey,
} from "@/state/progressionState";
import { useLab } from "@/state/lab/LabSessionProvider";
import { ProgressionSessionBar } from "./ProgressionSessionBar";
import { PageIntro } from "@/components/AppShell/PageIntro";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/StatusMessage";
import { ChordPicker } from "./ChordPicker";
import { ChordSlotCard } from "./ChordSlotCard";
import { ProgressionResults } from "./ProgressionResults";
import styles from "./Progression.module.css";

const LABEL_MODES: ReadonlyArray<{ value: LabelMode; label: string }> = [
  { value: "degree", label: "Degrees" },
  { value: "note", label: "Notes" },
];

export function ProgressionBuilder() {
  const service = useGuitarLabService();
  const id = useId();
  const router = useRouter();
  // The progression lives in LabSessionProvider so it survives navigation between pages.
  const lab = useLab();
  const { draft: active, dispatchProgression: dispatch, optimizer, focusWindow } = lab;
  const state = active.progression;
  const [draft, setDraft] = useState<{ root: string; quality: ChordQuality }>({ root: "C", quality: "major" });
  const [labelMode, setLabelMode] = useState<LabelMode>("degree");
  const qualities = useAsyncResource<ChordQuality[]>("qualities", (signal) => service.listChordQualities({ signal }));
  const { fretboard, openStringNames, stringCount } = useFretboardData();
  const { slots, settings } = state;
  const key = progressionRequestKey(state);
  const qualityList = qualities.status === "success" ? qualities.data : [];
  const full = slots.length >= MAX_PROGRESSION_LENGTH;
  const opt = optimizer.state;
  const shownRun = opt.status === "success" ? opt.run : opt.status === "loading" ? opt.previous : undefined;
  const setSetting = (patch: Partial<typeof settings>) => dispatch({ type: "setSettings", patch });
  const segment = optimizeSegment(state);
  const effectivePerChord = candidatesPerChord(settings.voicingsPerChord, segment.slots.length);

  return (
    <>
      <PageIntro title="Progression builder">
        Arrange chords, then ask the engine for playable voicing paths that keep hand movement low between shapes.
      </PageIntro>

      <ProgressionSessionBar />

      <Panel
        title="Progression"
        titleId="progression-title"
        description={
          <>
            Chord names and tones come from the chord API. Harmonic-function labels (such as I–V–vi–IV) are not shown
            because the backend does not provide key or function analysis yet.
          </>
        }
        actions={slots.length > 0 ? <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "clear" })}>Clear all</Button> : null}
      >
        {qualities.status === "error" ? (
          <ErrorState title="Couldn't load chord qualities" message={qualities.error.message} onRetry={qualities.retry} />
        ) : (
          <>
            {slots.length === 0 ? (
              <EmptyState title="No chords yet">
                <p>Add chords below, or start from an example and edit it.</p>
                <Button
                  size="sm"
                  className={styles.exampleButton}
                  onClick={() => dispatch({ type: "replaceAll", chords: EXAMPLE_PROGRESSION })}
                >
                  Start with C – G – Am – F
                </Button>
              </EmptyState>
            ) : (
              <ol className={styles.slots} aria-label="Chords in progression">
                {slots.map((slot, index) => (
                  <ChordSlotCard
                    key={slot.id}
                    slot={slot}
                    index={index}
                    total={slots.length}
                    qualities={qualityList}
                    onChange={(patch) => dispatch({ type: "update", id: slot.id, patch })}
                    onMove={(offset) => dispatch({ type: "move", id: slot.id, offset })}
                    onRemove={() => dispatch({ type: "remove", id: slot.id })}
                    onRevert={() => dispatch({ type: "revert", id: slot.id })}
                    sourceAvailable={slot.source !== undefined && lab.sessions.some((s) => s.id === slot.source!.sessionId)}
                    onShowInAnalysis={() => {
                      if (!slot.source) return;
                      focusWindow({ sessionId: slot.source.sessionId, frameIndex: slot.source.frameIndexes[0]!, pathIndex: slot.source.pathIndex });
                      router.push("/audio");
                    }}
                  />
                ))}
              </ol>
            )}

            <form
              className={styles.addForm}
              aria-label="Add a chord"
              onSubmit={(event) => {
                event.preventDefault();
                dispatch({ type: "add", ...draft });
              }}
            >
              {qualityList.length > 0 ? (
                <ChordPicker
                  root={draft.root}
                  quality={draft.quality}
                  qualities={qualityList}
                  labelPrefix="New chord "
                  onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
                />
              ) : (
                <LoadingState label="Loading chord qualities…" />
              )}
              <Button type="submit" disabled={full || qualityList.length === 0}>
                Add {displaySpelling(draft.root)} chord
              </Button>
              {full ? <span className={styles.hint}>Progressions are limited to {MAX_PROGRESSION_LENGTH} chords.</span> : null}
            </form>
          </>
        )}
      </Panel>

      <Panel
        title="Voicing paths"
        titleId="paths-title"
        description="Candidates come from the voicing search API for each chord; the engine's progression optimizer ranks whole paths."
        actions={
          <SegmentedControl label="Marker labels" hideLabel value={labelMode} options={LABEL_MODES} onChange={setLabelMode} />
        }
      >
        <form
          className={styles.settings}
          aria-label="Voicing path settings"
          onSubmit={(event) => {
            event.preventDefault();
            void optimizer.run(segment.slots, settings, key);
          }}
        >
          {slots.length > MAX_OPTIMIZE_SEGMENT ? (
            <label htmlFor={`${id}-segment`}>
              <span>Chords to optimize</span>
              <select
                id={`${id}-segment`}
                value={segment.start}
                onChange={(e) => setSetting({ segmentStart: Number(e.target.value) })}
              >
                {Array.from({ length: slots.length - MAX_OPTIMIZE_SEGMENT + 1 }, (_, start) => (
                  <option key={start} value={start}>{start + 1}–{start + MAX_OPTIMIZE_SEGMENT} of {slots.length}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label htmlFor={`${id}-per`}>
            <span>Candidates per chord</span>
            <select id={`${id}-per`} value={settings.voicingsPerChord} onChange={(e) => setSetting({ voicingsPerChord: Number(e.target.value) })}>
              {[4, 8, 12, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label htmlFor={`${id}-maxFret`}>
            <span>Highest fret</span>
            <select id={`${id}-maxFret`} value={settings.maxFret} onChange={(e) => setSetting({ maxFret: Number(e.target.value) })}>
              {[5, 7, 9, 12, 15].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label htmlFor={`${id}-span`}>
            <span>Max fret span</span>
            <select id={`${id}-span`} value={settings.maxFretSpan} onChange={(e) => setSetting({ maxFretSpan: Number(e.target.value) })}>
              {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label htmlFor={`${id}-min`}>
            <span>Min strings sounded</span>
            <select id={`${id}-min`} value={settings.minNotes} onChange={(e) => setSetting({ minNotes: Number(e.target.value) })}>
              {Array.from({ length: stringCount - 2 }, (_, i) => i + 3).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label htmlFor={`${id}-paths`}>
            <span>Paths</span>
            <select id={`${id}-paths`} value={settings.pathLimit} onChange={(e) => setSetting({ pathLimit: Number(e.target.value) })}>
              {[1, 3, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {effectivePerChord < settings.voicingsPerChord ? (
            <p className={styles.hint} role="note">
              With {segment.slots.length} chords the optimizer accepts at most {effectivePerChord} candidates per chord, so{" "}
              {effectivePerChord} will be searched.
            </p>
          ) : null}
          <div className={styles.settingsActions}>
            {opt.status === "loading" ? (
              <Button variant="ghost" onClick={optimizer.cancel}>Cancel</Button>
            ) : null}
            <Button type="submit" variant="primary" disabled={slots.length === 0 || opt.status === "loading"}>
              {shownRun ? "Recompute paths" : "Find voicing paths"}
            </Button>
          </div>
        </form>

        <div className={styles.resultsArea}>
          {opt.status === "loading" ? (
            <LoadingState
              label={opt.phase === "searching" ? `Searching voicings for ${segment.slots.length} chords…` : "Ranking voicing paths…"}
            />
          ) : null}
          {opt.status === "error" ? (
            <ErrorState title="Couldn't compute voicing paths" message={opt.error.message} onRetry={() => void optimizer.run(slots, settings, key)} />
          ) : null}
          {opt.status === "empty" ? (
            <EmptyState title="No playable path under these settings">
              <p>
                {opt.emptyChords.length > 0
                  ? `The voicing search found no shapes for ${opt.emptyChords.map(displaySpelling).join(", ")}. `
                  : ""}
                Try a higher fret limit, a wider span, or fewer required strings.
              </p>
            </EmptyState>
          ) : null}
          {opt.status === "idle" && slots.length > 0 ? (
            <EmptyState title="Ready when you are">
              <p>Choose settings, then select “Find voicing paths”.</p>
            </EmptyState>
          ) : null}
          {opt.status === "idle" && slots.length === 0 ? (
            <EmptyState title="Add chords to find voicing paths" />
          ) : null}
          {shownRun ? (
            <ProgressionResults
              key={shownRun.key}
              run={shownRun}
              stale={shownRun.key !== key || opt.status === "loading"}
              labelMode={labelMode}
              positions={fretboard.status === "success" ? fretboard.data.positions : undefined}
              maxFret={fretboard.status === "success" ? fretboard.data.maxFret : 15}
              stringCount={stringCount}
              openStringNames={openStringNames}
            />
          ) : null}
        </div>
      </Panel>
    </>
  );
}
