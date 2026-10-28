"use client";

import { useCallback, useMemo, useReducer } from "react";
import { useFretboardData, FRETBOARD_FRETS } from "@/state/useFretboardData";
import { voicingTab } from "@/lib/diagram";
import { PageIntro } from "./AppShell/PageIntro";
import { Button } from "./ui/Button";
import { FretboardLegend } from "./Fretboard/FretboardLegend";
import { VoicingBreakdown } from "./Voicings/VoicingBreakdown";
import { TransitionSummary } from "./Voicings/TransitionSummary";
import type { BuiltChord, ChordQuality, VoicingSearchResult } from "@/services";
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
import styles from "./GuitarLab.module.css";

export { FRETBOARD_FRETS };

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
  const { fretboard, openStringNames, stringCount } = useFretboardData();
  const chord = useAsyncResource<BuiltChord>(`chord:${root}:${quality}`, (signal) =>
    service.getChord({ root, quality }, { signal }),
  );
  const searchOptions = useMemo(() => toSearchOptions(constraints), [constraints]);
  const voicings = useAsyncResource<VoicingSearchResult>(
    `voicings:${root}:${quality}:${JSON.stringify(searchOptions)}`,
    (signal) => service.searchVoicings({ root, quality, options: searchOptions }, { signal }),
  );

  const chordData = chord.status === "success" ? chord.data : undefined;
  const voicingData = voicings.status === "success" ? voicings.data : undefined;
  const selectedVoicing =
    state.selectedVoicing !== null ? voicingData?.results[state.selectedVoicing] : undefined;

  const compareVoicing =
    state.compareVoicing !== null ? voicingData?.results[state.compareVoicing] : undefined;
  const compareLabel = state.compareVoicing !== null ? `voicing ${state.compareVoicing + 1} (compare)` : "comparison voicing";
  const symbol = chordData ? displaySpelling(chordData.symbol) : "";
  const fretboardDescription = selectedVoicing
    ? `Solid markers: voicing ${(state.selectedVoicing ?? 0) + 1}. Outlined: every other ${symbol} chord tone.${compareVoicing ? ` Dashed: ${compareLabel}.` : ""}`
    : chordData
      ? `Every ${symbol} chord tone up to fret ${FRETBOARD_FRETS}.`
      : undefined;

  const selectVoicing = useCallback((index: number | null) => dispatch({ type: "selectVoicing", index }), []);
  const compare = useCallback((index: number | null) => dispatch({ type: "compareVoicing", index }), []);
  const resetConstraints = useCallback(() => dispatch({ type: "resetConstraints" }), []);

  return (
    <>
      <PageIntro title="Chord explorer">
        Pick a root and quality, see every chord tone on the neck, and compare playable voicings string by string.
      </PageIntro>

      <div className={styles.layout}>
        <aside className={styles.sidebar} aria-label="Chord explorer controls">
          <Panel title="Chord" titleId="explorer-title">
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
            description={fretboardDescription}
            actions={
              <>
                {compareVoicing ? (
                  <Button size="sm" variant="ghost" onClick={() => compare(null)}>Stop comparing</Button>
                ) : null}
                <SegmentedControl
                  label="Marker labels"
                  hideLabel
                  value={labelMode}
                  options={LABEL_MODES}
                  onChange={(next) => dispatch({ type: "setLabelMode", labelMode: next })}
                />
              </>
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
                  compareVoicing={compareVoicing}
                  compareLabel={compareLabel}
                  labelMode={labelMode}
                  selection={selection}
                  onSelectionChange={dispatchSelection}
                />
                <FretboardLegend chord={chordData} showVoicing={!!selectedVoicing} compareLabel={compareVoicing ? compareLabel : undefined} />
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

          {selectedVoicing ? (
            <Panel
              title="Why this voicing works"
              titleId="breakdown-title"
              description={`Voicing ${(state.selectedVoicing ?? 0) + 1} (${voicingTab(selectedVoicing)}): every sounding string plays a ${displaySpelling(selectedVoicing.chordSymbol)} chord tone.`}
            >
              <VoicingBreakdown voicing={selectedVoicing} chord={chordData} openStringNames={openStringNames} />
              {compareVoicing ? (
                <TransitionSummary
                  from={selectedVoicing}
                  to={compareVoicing}
                  fromLabel={`voicing ${(state.selectedVoicing ?? 0) + 1}`}
                  toLabel={compareLabel}
                />
              ) : null}
            </Panel>
          ) : null}

          <div className={styles.lower}>
            <Panel title="Chord tones" titleId="chord-title" className={styles.chordPanel}>
              <ChordSummary chord={chord} onRetry={chord.retry} />
            </Panel>

            <Panel
              title="Voicings"
              titleId="voicings-title"
              description="Show a voicing on the fretboard, or compare it against the one already shown."
              className={styles.voicingsPanel}
            >
              <VoicingResults
                result={voicings}
                selectedIndex={state.selectedVoicing}
                compareIndex={state.compareVoicing}
                labelMode={labelMode}
                openStringNames={openStringNames}
                onSelect={selectVoicing}
                onCompare={compare}
                onRetry={voicings.retry}
                onResetConstraints={resetConstraints}
              />
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
