import type { BuiltChord } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import { qualityLabel } from "@/lib/qualities";
import type { AsyncState } from "@/state/useAsyncResource";
import { ErrorState, LoadingState } from "@/components/ui/StatusMessage";
import styles from "./ChordSummary.module.css";

export function ChordSummary({ chord, onRetry }: { chord: AsyncState<BuiltChord>; onRetry: () => void }) {
  if (chord.status === "error") {
    return <ErrorState title="Couldn't build this chord" message={chord.error.message} onRetry={onRetry} />;
  }
  const data = chord.status === "success" ? chord.data : chord.status === "loading" ? chord.previous : undefined;
  if (!data) return <LoadingState label="Building chord…" />;

  return (
    <div className={styles.summary} aria-busy={chord.status === "loading"}>
      <div className={styles.heading}>
        <p className={styles.symbol} aria-label={`Chord ${data.symbol}`}>{displaySpelling(data.symbol)}</p>
        <p className={styles.quality}>
          {displaySpelling(data.root)} {qualityLabel(data.quality).toLowerCase()}
        </p>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Formula</dt>
          <dd className={styles.formula}>{data.formula.join(" – ")}</dd>
        </div>
      </dl>
      <table className={styles.tones}>
        <caption className="visually-hidden">Chord tones of {data.symbol}</caption>
        <thead>
          <tr>
            <th scope="col">Degree</th>
            <th scope="col">Note</th>
            <th scope="col">Semitones</th>
          </tr>
        </thead>
        <tbody>
          {data.tones.map((tone) => (
            <tr key={tone.degree}>
              <td>
                <span className={`${styles.degree} deg-${degreeFamily(tone.degree)}`}>{tone.degree}</span>
              </td>
              <td className={styles.note}>{displaySpelling(tone.spelling)}</td>
              <td className={styles.semitones}>{tone.semitonesFromRoot}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
