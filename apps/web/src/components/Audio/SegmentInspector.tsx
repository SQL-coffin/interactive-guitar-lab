import { useReducer } from "react";
import type { ChordInferenceResult, FretboardPosition, OptimizedVoicingStep } from "@/services";
import { displaySpelling } from "@/lib/roots";
import { qualityLabel } from "@/lib/qualities";
import { formatSeconds } from "@/lib/audioTimeline";
import { pitchClassToSharpName } from "@/lib/pitchNames";
import { voicingTab } from "@/lib/diagram";
import type { LabelMode } from "@/state/explorerState";
import { EMPTY_SELECTION, fretboardSelectionReducer } from "@/state/fretboardSelection";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAsyncResource } from "@/state/useAsyncResource";
import { Fretboard } from "@/components/Fretboard/Fretboard";
import { FretboardLegend } from "@/components/Fretboard/FretboardLegend";
import { ChordDiagram } from "@/components/Voicings/ChordDiagram";
import { VoicingBreakdown } from "@/components/Voicings/VoicingBreakdown";
import { TransitionSummary } from "@/components/Voicings/TransitionSummary";
import styles from "./Audio.module.css";

interface SegmentInspectorProps {
  frame: ChordInferenceResult;
  frameIndex: number;
  step: OptimizedVoicingStep | undefined;
  previousStep: OptimizedVoicingStep | undefined;
  labelMode: LabelMode;
  positions: readonly FretboardPosition[] | undefined;
  maxFret: number;
  stringCount: number;
  openStringNames: ReadonlyMap<number, string>;
}

/** Everything the response says about one analysis window, nothing more. */
export function SegmentInspector({
  frame, frameIndex, step, previousStep, labelMode, positions, maxFret, stringCount, openStringNames,
}: SegmentInspectorProps) {
  const service = useGuitarLabService();
  const [selection, dispatchSelection] = useReducer(fretboardSelectionReducer, EMPTY_SELECTION);
  const top = frame.candidates[0];
  // The step names its chord by symbol; the matching hypothesis supplies root + quality for GET /api/chords.
  const stepCandidate = step ? frame.candidates.find((c) => c.symbol === step.chordSymbol) : undefined;
  const chord = useAsyncResource(
    stepCandidate ? `chord:${stepCandidate.root}:${stepCandidate.quality}` : null,
    (signal) => service.getChord({ root: stepCandidate!.root, quality: stepCandidate!.quality }, { signal }),
  );
  const chordData = chord.status === "success" ? chord.data : undefined;
  const range = `${formatSeconds(frame.startSeconds)}–${formatSeconds(frame.endSeconds)}`;

  return (
    <section className={styles.inspector} aria-labelledby="segment-title">
      <h3 id="segment-title" className={styles.inspectorTitle}>
        Window {frameIndex + 1} <span className={styles.inspectorRange}>{range}</span>
      </h3>

      {!top ? (
        <p className={styles.silent}>This window was silent, so the analysis skipped it and no chord is assigned.</p>
      ) : (
        <div className={styles.inspectorGrid}>
          <div>
            <h4 className={styles.subTitle}>Chord hypotheses</h4>
            <p className={styles.caveat}>Fit is a cosine-style chroma match, not a probability.</p>
            <ol className={styles.candidates}>
              {frame.candidates.map((candidate) => (
                <li key={candidate.symbol} data-chosen={candidate.symbol === step?.chordSymbol}>
                  <div className={styles.candidateHead}>
                    <span className={styles.candidateSymbol}>{displaySpelling(candidate.symbol)}</span>
                    <span className={styles.candidateQuality}>{qualityLabel(candidate.quality)}</span>
                    {candidate.symbol === step?.chordSymbol ? <span className={styles.chosenBadge}>used by path</span> : null}
                  </div>
                  <div className={styles.meter} aria-hidden="true">
                    <span style={{ width: `${Math.round(candidate.confidence * 100)}%` }} />
                  </div>
                  <p className={styles.candidateMeta}>
                    fit {candidate.confidence.toFixed(2)} · ranking score {candidate.score.toFixed(2)}
                    {candidate.evidence.bassRootMatch === null
                      ? " · no bass estimate"
                      : candidate.evidence.bassRootMatch ? " · bass matches root" : " · bass differs from root"}
                  </p>
                  <p className={styles.candidateMeta}>
                    matched {candidate.evidence.matchedPitchClasses.map(pitchClassToSharpName).join(" ") || "none"} of active{" "}
                    {candidate.evidence.activePitchClasses.map(pitchClassToSharpName).join(" ")}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          <div>
            <h4 className={styles.subTitle}>Fingering in the selected path</h4>
            {step ? (
              <>
                {step.chordSymbol !== top.symbol ? (
                  <p className={styles.differs}>
                    The path plays {displaySpelling(step.chordSymbol)} here although {displaySpelling(top.symbol)} fits this window
                    best on its own. The optimizer scores whole paths (chord fit, voicing ergonomics and movement between shapes),
                    and this choice gave the lower total cost.
                  </p>
                ) : null}
                <div className={styles.stepSummary}>
                  <ChordDiagram voicing={step.voicing} labelMode={labelMode} openStringNames={openStringNames} />
                  <dl className={styles.stepFacts}>
                    <div><dt>Shape</dt><dd><code>{voicingTab(step.voicing)}</code></dd></div>
                    <div><dt>Chord penalty</dt><dd>{step.chordPenalty.toFixed(2)}</dd></div>
                    <div><dt>Voicing cost</dt><dd>{step.localCost.toFixed(2)}</dd></div>
                    <div><dt>Transition cost</dt><dd>{previousStep ? step.transitionCost.toFixed(2) : "—"}</dd></div>
                  </dl>
                </div>
              </>
            ) : (
              <p className={styles.caveat}>This window is not part of the optimized path.</p>
            )}
          </div>
        </div>
      )}

      {step && positions ? (
        <>
          <Fretboard
            positions={positions}
            stringCount={stringCount}
            maxFret={maxFret}
            chord={chordData}
            voicing={step.voicing}
            compareVoicing={previousStep?.voicing}
            compareLabel={previousStep ? `previous window (${previousStep.chordSymbol})` : undefined}
            labelMode={labelMode}
            selection={selection}
            onSelectionChange={dispatchSelection}
          />
          <FretboardLegend
            chord={chordData}
            showVoicing
            compareLabel={previousStep ? `Previous window (${displaySpelling(previousStep.chordSymbol)})` : undefined}
          />
          {previousStep ? (
            <TransitionSummary
              from={previousStep.voicing}
              to={step.voicing}
              fromLabel={`previous window (${displaySpelling(previousStep.chordSymbol)})`}
              toLabel={`this window (${displaySpelling(step.chordSymbol)})`}
              optimizerCost={step.transitionCost}
            />
          ) : null}
          <div className={styles.breakdownWrap}>
            <VoicingBreakdown voicing={step.voicing} chord={chordData} openStringNames={openStringNames} />
          </div>
        </>
      ) : null}
    </section>
  );
}
