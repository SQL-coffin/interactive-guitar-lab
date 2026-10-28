import type { BuiltChord } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import styles from "./FretboardLegend.module.css";

interface FretboardLegendProps {
  chord?: BuiltChord | undefined;
  showVoicing?: boolean;
  compareLabel?: string | undefined;
}

/** Explains every marker style the fretboard can draw. */
export function FretboardLegend({ chord, showVoicing, compareLabel }: FretboardLegendProps) {
  return (
    <div className={styles.legend}>
      {chord ? (
        <ul aria-label={`${chord.symbol} chord tones`} className={styles.group}>
          {chord.tones.map((tone) => (
            <li key={tone.degree} className={`deg-${degreeFamily(tone.degree)}`}>
              <span className={styles.dot} data-root={tone.degree === "1"} aria-hidden="true" />
              <span className={styles.degree}>{tone.degree}</span>
              <span>{displaySpelling(tone.spelling)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul aria-label="Marker styles" className={`${styles.group} ${styles.keys}`}>
        {showVoicing ? <li><span className={styles.solid} aria-hidden="true" /> Selected voicing</li> : null}
        <li><span className={styles.outline} aria-hidden="true" /> Other chord tones</li>
        {compareLabel ? <li><span className={styles.dashed} aria-hidden="true" /> {compareLabel}</li> : null}
        <li><span className={styles.square} aria-hidden="true" /> Root (squared)</li>
        <li><span className={styles.mute} aria-hidden="true">×</span> Muted string</li>
      </ul>
    </div>
  );
}
