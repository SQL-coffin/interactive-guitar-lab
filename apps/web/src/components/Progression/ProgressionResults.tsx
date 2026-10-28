import { useReducer, useState } from "react";
import type { FretboardPosition } from "@/services";
import { voicingTab } from "@/lib/diagram";
import { displaySpelling } from "@/lib/roots";
import { diffVoicings } from "@/lib/voicingDiff";
import type { LabelMode } from "@/state/explorerState";
import { EMPTY_SELECTION, fretboardSelectionReducer } from "@/state/fretboardSelection";
import type { ProgressionRun } from "@/state/useProgressionOptimizer";
import { Fretboard } from "@/components/Fretboard/Fretboard";
import { FretboardLegend } from "@/components/Fretboard/FretboardLegend";
import { ChordDiagram } from "@/components/Voicings/ChordDiagram";
import { TransitionSummary } from "@/components/Voicings/TransitionSummary";
import { VoicingBreakdown } from "@/components/Voicings/VoicingBreakdown";
import styles from "./Progression.module.css";

interface ProgressionResultsProps {
  run: ProgressionRun;
  stale: boolean;
  labelMode: LabelMode;
  positions: readonly FretboardPosition[] | undefined;
  maxFret: number;
  stringCount: number;
  openStringNames: ReadonlyMap<number, string>;
}

/** Renders the optimizer's ranked paths exactly as returned; lower total cost ranks first. */
export function ProgressionResults({ run, stale, labelMode, positions, maxFret, stringCount, openStringNames }: ProgressionResultsProps) {
  const [pathIndex, setPathIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [selection, dispatchSelection] = useReducer(fretboardSelectionReducer, EMPTY_SELECTION);
  const { result } = run;
  const path = result.results[Math.min(pathIndex, result.results.length - 1)]!;
  const step = path.steps[Math.min(stepIndex, path.steps.length - 1)]!;
  const safeStep = path.steps.indexOf(step);
  const previous = safeStep > 0 ? path.steps[safeStep - 1] : undefined;
  const chord = run.chords[safeStep];

  return (
    <div className={styles.results} aria-busy={stale}>
      {stale ? (
        <p className={styles.staleNote} role="status">
          The progression or settings changed since these paths were computed. Run the search again to update them.
        </p>
      ) : null}

      <div className={styles.pathTabs} role="tablist" aria-label="Ranked voicing paths">
        {result.results.map((candidate, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === pathIndex}
            className={styles.pathTab}
            onClick={() => setPathIndex(i)}
          >
            <span className={styles.pathRank}>Path {i + 1}</span>
            <span className={styles.pathCost}>total cost {candidate.totalCost.toFixed(2)}</span>
          </button>
        ))}
      </div>
      <p className={styles.method}>
        Ranked by the engine&rsquo;s cost model (hand-position shift, per-string fret movement, mute changes, bass
        movement and voicing ergonomics); lower is easier to play under that model. It is a heuristic ranking, not a
        judgement of musical quality. Searched {result.candidateCounts.join(" / ")} candidate voicings per chord and
        evaluated {result.pathExtensionsEvaluated.toLocaleString()} path extensions.
      </p>

      <ol className={styles.sequence} aria-label={`Path ${pathIndex + 1} chord shapes`}>
        {path.steps.map((s, i) => {
          const before = i > 0 ? path.steps[i - 1] : undefined;
          const diff = before ? diffVoicings(before.voicing, s.voicing) : undefined;
          return (
            <li key={i} className={styles.sequenceItem}>
              {diff ? (
                <span className={styles.transitionChip} aria-label={`Transition cost ${s.transitionCost.toFixed(2)}: ${diff.held} held, ${diff.moved} moved, ${diff.muteChanges} mute changes`}>
                  <span aria-hidden="true">→</span>
                  <span aria-hidden="true">{s.transitionCost.toFixed(1)}</span>
                </span>
              ) : null}
              <button
                type="button"
                className={styles.stepCard}
                aria-pressed={i === safeStep}
                aria-label={`Step ${i + 1}: ${s.chordSymbol}, ${voicingTab(s.voicing)}`}
                onClick={() => setStepIndex(i)}
              >
                <span className={styles.stepSymbol}>{displaySpelling(s.chordSymbol)}</span>
                <span className={styles.stepDiagram}>
                  <ChordDiagram voicing={s.voicing} labelMode={labelMode} openStringNames={openStringNames} />
                </span>
                <code className={styles.stepTab}>{voicingTab(s.voicing)}</code>
              </button>
            </li>
          );
        })}
      </ol>

      <section className={styles.stepDetail} aria-labelledby="step-detail-title">
        <div className={styles.stepDetailHeader}>
          <h3 id="step-detail-title">
            Step {safeStep + 1}: {displaySpelling(step.chordSymbol)} <code>{voicingTab(step.voicing)}</code>
          </h3>
          <div className={styles.stepNav}>
            <button type="button" className={styles.iconButton} disabled={safeStep === 0} onClick={() => setStepIndex(safeStep - 1)} aria-label="Previous step">←</button>
            <button type="button" className={styles.iconButton} disabled={safeStep === path.steps.length - 1} onClick={() => setStepIndex(safeStep + 1)} aria-label="Next step">→</button>
          </div>
        </div>
        <dl className={styles.costs}>
          <div><dt>Voicing cost</dt><dd>{step.localCost.toFixed(2)}</dd></div>
          <div><dt>Transition cost</dt><dd>{safeStep === 0 ? "—" : step.transitionCost.toFixed(2)}</dd></div>
          <div><dt>Running total</dt><dd>{step.cumulativeCost.toFixed(2)}</dd></div>
        </dl>

        {positions ? (
          <>
            <Fretboard
              positions={positions}
              stringCount={stringCount}
              maxFret={maxFret}
              chord={chord}
              voicing={step.voicing}
              compareVoicing={previous?.voicing}
              compareLabel={previous ? `previous shape (${previous.chordSymbol})` : undefined}
              labelMode={labelMode}
              selection={selection}
              onSelectionChange={dispatchSelection}
            />
            <FretboardLegend
              chord={chord}
              showVoicing
              compareLabel={previous ? `Previous shape (${displaySpelling(previous.chordSymbol)})` : undefined}
            />
          </>
        ) : null}

        {previous ? (
          <TransitionSummary
            from={previous.voicing}
            to={step.voicing}
            fromLabel={`${displaySpelling(previous.chordSymbol)} (step ${safeStep})`}
            toLabel={`${displaySpelling(step.chordSymbol)} (step ${safeStep + 1})`}
            optimizerCost={step.transitionCost}
          />
        ) : null}
        <div className={styles.breakdownWrap}>
          <VoicingBreakdown voicing={step.voicing} chord={chord} openStringNames={openStringNames} />
        </div>
      </section>
    </div>
  );
}
