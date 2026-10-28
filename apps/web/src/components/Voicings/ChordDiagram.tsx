import type { Voicing } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { diagramWindow } from "@/lib/diagram";
import { displaySpelling } from "@/lib/roots";
import { stringLabel } from "@/lib/strings";
import type { LabelMode } from "@/state/explorerState";

interface ChordDiagramProps {
  voicing: Voicing;
  labelMode: LabelMode;
  /** Open-string note names keyed by engine string number, for the accessible description. */
  openStringNames?: ReadonlyMap<number, string>;
}

const STRING_GAP = 22;
const FRET_GAP = 26;
const LEFT = 34;
const TOP = 26;
const DOT_R = 9;

/**
 * Vertical chord-box diagram (low string on the left, nut at the top).
 * Finger numbers are not drawn: the engine does not yet return a fingering assignment.
 */
export function ChordDiagram({ voicing, labelMode, openStringNames }: ChordDiagramProps) {
  const stringCount = voicing.strings.length;
  const { startFret, fretCount, showNut } = diagramWindow(voicing);
  const width = LEFT + (stringCount - 1) * STRING_GAP + 16;
  const height = TOP + fretCount * FRET_GAP + 22;
  const x = (stringIndex: number) => LEFT + stringIndex * STRING_GAP;
  const boardRight = x(stringCount - 1);

  const description = voicing.strings
    .map((note, index) => {
      const name = stringLabel(index + 1, stringCount, openStringNames?.get(index + 1));
      if (note === null) return `${name} muted`;
      const where = note.fret === 0 ? "open" : `fret ${note.fret}`;
      return `${name} ${where}, ${displaySpelling(note.chordToneSpelling)} (${note.degree})`;
    })
    .join("; ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${voicing.chordSymbol} chord diagram: ${description}`}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {/* Fret position label */}
      {!showNut ? (
        <text x={LEFT - 8} y={TOP + FRET_GAP / 2 + 4} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--text-muted)">
          {startFret}fr
        </text>
      ) : null}

      {/* Nut or top fret line */}
      <line
        x1={LEFT}
        x2={boardRight}
        y1={TOP}
        y2={TOP}
        stroke="var(--text)"
        strokeWidth={showNut ? 5 : 1.5}
        strokeLinecap="square"
      />

      {/* Fret lines */}
      {Array.from({ length: fretCount }, (_, i) => (
        <line key={i} x1={LEFT} x2={boardRight} y1={TOP + (i + 1) * FRET_GAP} y2={TOP + (i + 1) * FRET_GAP} stroke="var(--border-strong)" strokeWidth={1.5} />
      ))}

      {/* Strings */}
      {voicing.strings.map((_, i) => (
        <line key={i} x1={x(i)} x2={x(i)} y1={TOP} y2={TOP + fretCount * FRET_GAP} stroke="var(--text-muted)" strokeWidth={1 + (stringCount - 1 - i) * 0.25} />
      ))}

      {/* Open / muted markers and fretted dots */}
      {voicing.strings.map((note, i) => {
        const cx = x(i);
        if (note === null) {
          return (
            <text key={i} x={cx} y={TOP - 9} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--text-muted)">
              ×
            </text>
          );
        }
        const family = degreeFamily(note.degree);
        const label = labelMode === "degree" ? note.degree : displaySpelling(note.chordToneSpelling);
        if (note.fret === 0) {
          return (
            <g key={i} className={`deg-${family}`}>
              <circle cx={cx} cy={TOP - 13} r={6} fill="none" stroke="var(--deg)" strokeWidth={2} />
            </g>
          );
        }
        const cy = TOP + (note.fret - startFret + 0.5) * FRET_GAP;
        return (
          <g key={i} className={`deg-${family}`}>
            <circle cx={cx} cy={cy} r={DOT_R} fill="var(--deg)" />
            <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={label.length > 2 ? 7.5 : 9} fontWeight="700" fill="var(--deg-fg)">
              {label}
            </text>
          </g>
        );
      })}

      {/* Bottom row: note or degree under each string */}
      {voicing.strings.map((note, i) => (
        <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-muted)">
          {note === null ? "" : labelMode === "degree" ? displaySpelling(note.chordToneSpelling) : note.degree}
        </text>
      ))}
    </svg>
  );
}
