import type { Voicing } from "@/services";
import { voicingTab } from "@/lib/diagram";
import { displaySpelling } from "@/lib/roots";
import type { LabelMode } from "@/state/explorerState";
import { ChordDiagram } from "./ChordDiagram";
import styles from "./Voicings.module.css";

interface VoicingCardProps {
  voicing: Voicing;
  rank: number;
  selected: boolean;
  comparing?: boolean;
  labelMode: LabelMode;
  openStringNames: ReadonlyMap<number, string>;
  onSelect: () => void;
  /** Omit to hide the compare action. */
  onCompare?: (() => void) | undefined;
}

export function VoicingCard({ voicing, rank, selected, comparing = false, labelMode, openStringNames, onSelect, onCompare }: VoicingCardProps) {
  const tab = voicingTab(voicing);
  const position = voicing.lowestFret === 0 ? "Open position" : `Frets ${voicing.lowestFret}–${voicing.highestFret}`;
  return (
    <article className={styles.card} data-selected={selected} data-comparing={comparing} aria-label={`Voicing ${rank}: ${tab}`}>
      <header className={styles.cardHeader}>
        <span className={styles.rank}>#{rank}</span>
        <code className={styles.tab} title="Tab, low string first (x = muted)">{tab}</code>
      </header>

      <div className={styles.diagram}>
        <ChordDiagram voicing={voicing} labelMode={labelMode} openStringNames={openStringNames} />
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Notes</dt>
          <dd>{voicing.notes.map((n) => displaySpelling(n.chordToneSpelling)).join(" ")}</dd>
        </div>
        <div>
          <dt>Degrees</dt>
          <dd>{voicing.notes.map((n) => n.degree).join(" ")}</dd>
        </div>
        <div>
          <dt>Position</dt>
          <dd>{position} · span {voicing.fretSpan}</dd>
        </div>
      </dl>

      {voicing.missingDegrees.length > 0 ? (
        <p className={styles.missing}>Omits {voicing.missingDegrees.join(", ")}</p>
      ) : null}

      <div className={styles.cardActions}>
        <button type="button" className={styles.select} aria-pressed={selected} onClick={onSelect}>
          {selected ? "Shown on fretboard" : "Show on fretboard"}
        </button>
        {onCompare && !selected ? (
          <button
            type="button"
            className={styles.compare}
            aria-pressed={comparing}
            aria-label={comparing ? `Stop comparing voicing ${rank}` : `Compare voicing ${rank} with the shown voicing`}
            onClick={onCompare}
          >
            {comparing ? "Comparing" : "Compare"}
          </button>
        ) : null}
      </div>
    </article>
  );
}
