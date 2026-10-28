import type { BuiltChord, FretboardPosition } from "@/services";
import { displaySpelling } from "@/lib/roots";
import { stringLabel } from "@/lib/strings";
import { degreeFamily } from "@/lib/degrees";
import { markerKey, parseMarkerKey, type FretboardSelection } from "@/state/fretboardSelection";
import styles from "./FretboardInspector.module.css";

interface FretboardInspectorProps {
  positions: readonly FretboardPosition[];
  stringCount: number;
  chord?: BuiltChord | undefined;
  selection: FretboardSelection;
  onClear: () => void;
}

/** Reads back what the user has selected on the fretboard, using data the service returned. */
export function FretboardInspector({ positions, stringCount, chord, selection, onClear }: FretboardInspectorProps) {
  const byKey = new Map(positions.map((p) => [markerKey(p.string, p.fret), p]));
  const openName = (string: number) => byKey.get(markerKey(string, 0))?.noteName;
  const hasSelection = selection.markers.length > 0 || selection.string !== null || selection.fret !== null;

  return (
    <div className={styles.inspector} aria-live="polite">
      <div className={styles.summary}>
        {hasSelection ? (
          <>
            {selection.string !== null ? (
              <span className={styles.chip}>{stringLabel(selection.string, stringCount, openName(selection.string))}</span>
            ) : null}
            {selection.fret !== null ? (
              <span className={styles.chip}>{selection.fret === 0 ? "Open strings" : `Fret ${selection.fret}`}</span>
            ) : null}
            <span className={styles.hint}>
              {selection.markers.length} marker{selection.markers.length === 1 ? "" : "s"} placed
            </span>
          </>
        ) : (
          <span className={styles.hint}>
            Select a string or fret label to reveal its notes, or click any position to place a marker.
          </span>
        )}
        {hasSelection ? (
          <button type="button" className={styles.clear} onClick={onClear}>
            Clear selection
          </button>
        ) : null}
      </div>

      {selection.markers.length > 0 ? (
        <ul className={styles.list} aria-label="Placed note markers">
          {selection.markers.map((key) => {
            const position = byKey.get(key);
            if (!position) return null;
            const { string, fret } = parseMarkerKey(key);
            const tone = chord?.tones.find((t) => t.pitchClass === position.pitchClass);
            return (
              <li key={key} className={styles.item}>
                <span className={`${styles.note} ${tone ? `deg-${degreeFamily(tone.degree)}` : ""}`} data-in-chord={!!tone}>
                  {displaySpelling(tone?.spelling ?? position.noteName)}
                </span>
                <span className={styles.meta}>
                  {stringLabel(string, stringCount, openName(string))} · {fret === 0 ? "open" : `fret ${fret}`} · MIDI {position.midi}
                </span>
                <span className={styles.degree}>
                  {chord
                    ? tone
                      ? `Degree ${tone.degree} of ${displaySpelling(chord.symbol)}`
                      : `Not in ${displaySpelling(chord.symbol)}`
                    : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
