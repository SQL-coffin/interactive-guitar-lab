import type { BuiltChord, Voicing } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import { conventionalStringNumber, stringLabel } from "@/lib/strings";
import styles from "./Voicings.module.css";

interface VoicingBreakdownProps {
  voicing: Voicing;
  chord?: BuiltChord | undefined;
  openStringNames: ReadonlyMap<number, string>;
}

/**
 * Explains a voicing from its own data: what every string plays and which chord degree it
 * supplies. No theory is computed here; degrees and spellings come from the engine.
 */
export function VoicingBreakdown({ voicing, chord, openStringNames }: VoicingBreakdownProps) {
  const stringCount = voicing.strings.length;
  const degreeCounts = new Map<string, number>();
  for (const note of voicing.notes) degreeCounts.set(note.degree, (degreeCounts.get(note.degree) ?? 0) + 1);
  const order = chord?.tones.map((t) => t.degree) ?? [...degreeCounts.keys()];
  const present = order.filter((degree) => degreeCounts.has(degree));
  const doubled = present.filter((degree) => (degreeCounts.get(degree) ?? 0) > 1);
  const bass = voicing.notes[0];
  const conventional = (engineString: number) => conventionalStringNumber(engineString, stringCount);
  const muted = voicing.strings.flatMap((note, i) => (note === null ? [conventional(i + 1)] : []));
  const open = voicing.notes.filter((n) => n.fret === 0).map((n) => conventional(n.string));
  // High string first, matching the fretboard.
  const rows = voicing.strings.map((note, i) => ({ note, string: i + 1 })).reverse();

  return (
    <div className={styles.breakdown}>
      <ul className={styles.breakdownFacts}>
        <li>
          <strong>Chord tones covered:</strong>{" "}
          {present.map((degree) => (
            <span key={degree} className={`${styles.degreeChip} deg-${degreeFamily(degree)}`}>{degree}</span>
          ))}
          {voicing.missingDegrees.length > 0 ? <span className={styles.omits}> omits {voicing.missingDegrees.join(", ")}</span> : null}
        </li>
        {bass ? (
          <li>
            <strong>Lowest note:</strong> {displaySpelling(bass.chordToneSpelling)} (degree {bass.degree})
          </li>
        ) : null}
        {doubled.length > 0 ? <li><strong>Doubled:</strong> {doubled.join(", ")}</li> : null}
        <li>
          <strong>Hand position:</strong>{" "}
          {voicing.frettedNotes === 0
            ? "all open strings"
            : `${voicing.frettedNotes} fretted note${voicing.frettedNotes === 1 ? "" : "s"}, frets ${voicing.lowestFret}–${voicing.highestFret} (span ${voicing.fretSpan})`}
        </li>
        {muted.length > 0 ? <li><strong>Mute:</strong> string{muted.length === 1 ? "" : "s"} {muted.join(", ")}</li> : null}
        {open.length > 0 ? <li><strong>Open:</strong> string{open.length === 1 ? "" : "s"} {open.join(", ")}</li> : null}
      </ul>

      <table className={styles.breakdownTable}>
        <caption className="visually-hidden">String-by-string breakdown of {voicing.chordSymbol}</caption>
        <thead>
          <tr>
            <th scope="col">String</th>
            <th scope="col">Fret</th>
            <th scope="col">Note</th>
            <th scope="col">Degree</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ note, string }) => (
            <tr key={string} data-muted={note === null}>
              <th scope="row">{stringLabel(string, stringCount, openStringNames.get(string))}</th>
              <td>{note === null ? "× muted" : note.fret === 0 ? "open" : note.fret}</td>
              <td>{note === null ? "—" : displaySpelling(note.chordToneSpelling)}</td>
              <td>
                {note === null ? "—" : (
                  <span className={`${styles.degreeChip} deg-${degreeFamily(note.degree)}`}>{note.degree}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
