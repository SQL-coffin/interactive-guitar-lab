import type { Voicing } from "@/services";
import { diffVoicings, type StringChange } from "@/lib/voicingDiff";
import { conventionalStringNumber } from "@/lib/strings";
import styles from "./Voicings.module.css";

interface TransitionSummaryProps {
  from: Voicing;
  to: Voicing;
  fromLabel: string;
  toLabel: string;
  /** Backend-computed transition cost, when the optimizer supplied one. */
  optimizerCost?: number | undefined;
  compact?: boolean;
}

const CHANGE_TEXT: Record<StringChange, string> = {
  held: "stays",
  moved: "moves",
  muted: "mutes",
  unmuted: "starts sounding",
  silent: "stays muted",
};

const fretText = (fret: number | null) => (fret === null ? "×" : String(fret));

/** String-by-string movement between two shapes, read straight from the voicing data. */
export function TransitionSummary({ from, to, fromLabel, toLabel, optimizerCost, compact }: TransitionSummaryProps) {
  const diff = diffVoicings(from, to);
  const stringCount = Math.max(from.strings.length, to.strings.length);
  return (
    <section className={styles.transition} data-compact={compact} aria-label={`Change from ${fromLabel} to ${toLabel}`}>
      {!compact ? (
        <h3 className={styles.transitionTitle}>
          {fromLabel} → {toLabel}
        </h3>
      ) : null}
      <p className={styles.transitionStats}>
        <span><strong>{diff.held}</strong> held</span>
        <span><strong>{diff.moved}</strong> moved ({diff.fretTravel} fret{diff.fretTravel === 1 ? "" : "s"} of travel)</span>
        <span><strong>{diff.muteChanges}</strong> mute change{diff.muteChanges === 1 ? "" : "s"}</span>
        {optimizerCost !== undefined ? <span>optimizer transition cost <strong>{optimizerCost.toFixed(2)}</strong></span> : null}
      </p>
      <ol className={styles.transitionStrings}>
        {[...diff.strings].reverse().map((s) => (
          <li key={s.string} data-change={s.change}>
            <span className={styles.transitionString}>S{conventionalStringNumber(s.string, stringCount)}</span>
            <span className={styles.transitionFrets} aria-hidden="true">{fretText(s.from)} → {fretText(s.to)}</span>
            <span className="visually-hidden">
              String {conventionalStringNumber(s.string, stringCount)} {CHANGE_TEXT[s.change]}: {fretText(s.from)} to {fretText(s.to)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
