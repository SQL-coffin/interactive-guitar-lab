"use client";

import { useCallback, useMemo, useReducer } from "react";
import type { BuiltChord, ChordQuality, FretboardResponse, VoicingSearchResult } from "@/services";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAsyncResource } from "@/state/useAsyncResource";
import { INITIAL_EXPLORER_STATE, explorerReducer, toSearchOptions, type LabelMode } from "@/state/explorerState";
import { EMPTY_SELECTION, fretboardSelectionReducer } from "@/state/fretboardSelection";
import { displaySpelling } from "@/lib/roots";
import { Panel } from "./ui/Panel";
import { SegmentedControl } from "./ui/SegmentedControl";
import { ErrorState, LoadingState } from "./ui/StatusMessage";
import { RootSelector } from "./ChordExplorer/RootSelector";
import { QualitySelector } from "./ChordExplorer/QualitySelector";
import { SearchOptionsPanel } from "./ChordExplorer/SearchOptionsPanel";
import { Fretboard } from "./Fretboard/Fretboard";
import { FretboardInspector } from "./Fretboard/FretboardInspector";
import { ChordSummary } from "./ChordSummary/ChordSummary";
import { VoicingResults } from "./Voicings/VoicingResults";
import { DegreeLegend } from "./DegreeLegend";
import styles from "./GuitarLab.module.css";

/** Frets drawn on the interactive board (independent of the voicing search range). */
export const FRETBOARD_FRETS = 15;

const LABEL_MODES: ReadonlyArray<{ value: LabelMode; label: string }> = [
  { value: "degree", label: "Degrees" },
  { value: "note", label: "Notes" },
];

/** Composition root: owns UI state and wires service data into presentational components. */
export function GuitarLab() {
  const service = useGuitarLabService();
  const [state, dispatch] = useReducer(explorerReducer, INITIAL_EXPLORER_STATE);
  const [selection, dispatchSelection] = useReducer(fretboardSelectionReducer, EMPTY_SELECTION);
  const { root, quality, constraints, labelMode } = state;

  const qualities = useAsyncResource<ChordQuality[]>("qualities", (signal) => service.listChordQualities({ signal }));
  const fretboard = useAsyncResource<FretboardResponse>(`fretboard:${FRETBOARD_FRETS}`, (signal) =>
    service.getFretboard({ maxFret: FRETBOARD_FRETS }, { signal }),
  );
  const chord = useAsyncResource<BuiltChord>(`chord:${root}:${quality}`, (signal) =>
    service.getChord({ root, quality }, { signal }),
  );
  const searchOptions = useMemo(() => toSearchOptions(constraints), [constraints]);
  const voicings = useAsyncResource<VoicingSearchResult>(
    `voicings:${root}:${quality}:${JSON.stringify(searchOptions)}`,
    (signal) => service.searchVoicings({ root, quality, options: searchOptions }, { signal }),
  );

  const openStringNames = useMemo(
    () => new Map(fretboard.status === "success" ? fretboard.data.positions.filter((p) => p.fret === 0).map((p) => [p.string, p.noteName]) : []),
    [fretboard],
  );
  const stringCount = fretboard.status === "success" ? fretboard.data.tuning.length : 6;
  const chordData = chord.status === "success" ? chord.data : undefined;
  const voicingData = voicings.status === "success" ? voicings.data : undefined;
  const selectedVoicing =
    state.selectedVoicing !== null ? voicingData?.results[state.selectedVoicing] : undefined;

  const selectVoicing = useCallback((index: number | null) => dispatch({ type: "selectVoicing", index }), []);
  const resetConstraints = useCallback(() => dispatch({ type: "resetConstraints" }), []);

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 6h16M4 10h16M4 14h16M4 18h16" stroke="currentColor" strokeWidth="1.6" /><circle cx="9" cy="12" r="2.6" fill="currentColor" /><circle cx="15" cy="16" r="2.6" fill="currentColor" /></svg>
          </span>
          <div>
            <h1 className={styles.title}>Guitar Theory Lab</h1>
            <p className={styles.tagline}>Build a chord, see it on the neck, and explore playable voicings.</p>
          </div>
        </div>
      </header>

      <main className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Chord explorer controls">
          <Panel title="Chord explorer" titleId="explorer-title">
            <div className={styles.stack}>
              <RootSelector
                root={root}
                spelling={state.spelling}
                onRootChange={(next) => dispatch({ type: "setRoot", root: next })}
                onSpellingChange={(spelling, next) => dispatch({ type: "setSpelling", spelling, root: next })}
              />
              <QualitySelector
                qualities={qualities}
                value={quality}
                onChange={(next) => dispatch({ type: "setQuality", quality: next })}
                onRetry={qualities.retry}
              />
              <SearchOptionsPanel
                constraints={constraints}
                stringCount={stringCount}
                openStringNames={openStringNames}
                onChange={(patch) => dispatch({ type: "setConstraint", patch })}
                onReset={resetConstraints}
              />
            </div>
          </Panel>
        </aside>

        <div className={styles.content}>
          <Panel
            title="Fretboard"
            titleId="fretboard-title"
            description={
              selectedVoicing
                ? `Showing voicing ${(state.selectedVoicing ?? 0) + 1} of ${displaySpelling(selectedVoicing.chordSymbol)}; outlined dots mark every other ${displaySpelling(selectedVoicing.chordSymbol)} chord tone.`
                : chordData
                  ? `Every ${displaySpelling(chordData.symbol)} chord tone up to fret ${FRETBOARD_FRETS}.`
                  : undefined
            }
            actions={
              <SegmentedControl
                label="Marker labels"
                hideLabel
                value={labelMode}
                options={LABEL_MODES}
                onChange={(next) => dispatch({ type: "setLabelMode", labelMode: next })}
              />
            }
          >
            {fretboard.status === "error" ? (
              <ErrorState title="Couldn't load the fretboard" message={fretboard.error.message} onRetry={fretboard.retry} />
            ) : fretboard.status === "success" ? (
              <>
                <Fretboard
                  positions={fretboard.data.positions}
                  stringCount={stringCount}
                  maxFret={fretboard.data.maxFret}
                  chord={chordData}
                  voicing={selectedVoicing}
                  labelMode={labelMode}
                  selection={selection}
                  onSelectionChange={dispatchSelection}
                />
                <DegreeLegend chord={chordData} />
                <FretboardInspector
                  positions={fretboard.data.positions}
                  stringCount={stringCount}
                  chord={chordData}
                  selection={selection}
                  onClear={() => dispatchSelection({ type: "clear" })}
                />
              </>
            ) : (
              <LoadingState label="Loading fretboard…" />
            )}
          </Panel>

          <div className={styles.lower}>
            <Panel title="Chord" titleId="chord-title" className={styles.chordPanel}>
              <ChordSummary chord={chord} onRetry={chord.retry} />
            </Panel>

            <Panel
              title="Voicings"
              titleId="voicings-title"
              description="Pick a voicing to pin it on the fretboard."
              className={styles.voicingsPanel}
            >
              <VoicingResults
                result={voicings}
                selectedIndex={state.selectedVoicing}
                labelMode={labelMode}
                openStringNames={openStringNames}
                onSelect={selectVoicing}
                onRetry={voicings.retry}
                onResetConstraints={resetConstraints}
              />
            </Panel>
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        Voicing ranking is a heuristic, not a guarantee of the best fingering. String numbers follow guitar convention
        (string 1 = high E).
      </footer>
    </div>
  );
}
