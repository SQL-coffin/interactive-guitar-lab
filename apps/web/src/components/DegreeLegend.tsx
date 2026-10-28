import type { BuiltChord } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import styles from "./GuitarLab.module.css";

export function DegreeLegend({ chord }: { chord: BuiltChord | undefined }) {
  if (!chord) return null;
  return (
    <ul className={styles.legend} aria-label={`${chord.symbol} chord tones`}>
      {chord.tones.map((tone) => (
        <li key={tone.degree} className={`deg-${degreeFamily(tone.degree)}`}>
          <span className={styles.legendDot} aria-hidden="true" />
          <span className={styles.legendDegree}>{tone.degree}</span>
          <span>{displaySpelling(tone.spelling)}</span>
        </li>
      ))}
    </ul>
  );
}
