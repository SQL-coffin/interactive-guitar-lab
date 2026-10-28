"use client";

import { useCallback, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { BuiltChord, ChordTone, FretboardPosition, Voicing } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import { stringLabel } from "@/lib/strings";
import type { LabelMode } from "@/state/explorerState";
import { markerKey, type FretboardSelection, type FretboardSelectionAction } from "@/state/fretboardSelection";
import styles from "./Fretboard.module.css";

export interface FretboardProps {
  positions: readonly FretboardPosition[];
  stringCount: number;
  maxFret: number;
  chord?: BuiltChord | undefined;
  voicing?: Voicing | undefined;
  labelMode: LabelMode;
  selection: FretboardSelection;
  onSelectionChange: (action: FretboardSelectionAction) => void;
}

const SINGLE_INLAYS = new Set([3, 5, 7, 9, 15, 17, 19, 21]);
const DOUBLE_INLAYS = new Set([12, 24]);

interface CellModel {
  position: FretboardPosition;
  tone: ChordTone | undefined;
  inVoicing: boolean;
  marked: boolean;
  revealed: boolean;
}

export function Fretboard({
  positions,
  stringCount,
  maxFret,
  chord,
  voicing,
  labelMode,
  selection,
  onSelectionChange,
}: FretboardProps) {
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState({ string: stringCount, fret: 0 });

  const byKey = useMemo(() => new Map(positions.map((p) => [markerKey(p.string, p.fret), p])), [positions]);
  const toneByPitch = useMemo(() => new Map(chord?.tones.map((t) => [t.pitchClass, t]) ?? []), [chord]);
  const frets = useMemo(() => Array.from({ length: maxFret + 1 }, (_, fret) => fret), [maxFret]);
  // Display highest-pitched string on top, as on tab and when looking down at the guitar.
  const strings = useMemo(() => Array.from({ length: stringCount }, (_, i) => stringCount - i), [stringCount]);
  const openNames = useMemo(
    () => new Map(positions.filter((p) => p.fret === 0).map((p) => [p.string, p.noteName])),
    [positions],
  );

  const model = useCallback(
    (string: number, fret: number): CellModel | undefined => {
      const position = byKey.get(markerKey(string, fret));
      if (!position) return undefined;
      return {
        position,
        tone: toneByPitch.get(position.pitchClass),
        inVoicing: voicing?.strings[string - 1]?.fret === fret,
        marked: selection.markers.includes(markerKey(string, fret)),
        revealed: selection.string === string || selection.fret === fret,
      };
    },
    [byKey, toneByPitch, voicing, selection],
  );

  const focusCell = (string: number, fret: number) => {
    const s = Math.min(Math.max(string, 1), stringCount);
    const f = Math.min(Math.max(fret, 0), maxFret);
    setActive({ string: s, fret: f });
    cellRefs.current.get(markerKey(s, f))?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { string, fret } = active;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [string + 1, fret],
      ArrowDown: [string - 1, fret],
      ArrowLeft: [string, fret - 1],
      ArrowRight: [string, fret + 1],
      Home: [string, 0],
      End: [string, maxFret],
    };
    const target = moves[event.key];
    if (!target) return;
    event.preventDefault();
    focusCell(target[0], target[1]);
  };

  const chordName = chord ? displaySpelling(chord.symbol) : undefined;

  return (
    <div className={styles.scroller}>
      <div
        role="grid"
        aria-label={`Guitar fretboard, frets 0 to ${maxFret}. Use arrow keys to move, Enter or Space to toggle a note marker.`}
        aria-rowcount={stringCount + 1}
        aria-colcount={maxFret + 2}
        className={styles.grid}
        style={{ "--fret-count": maxFret } as CSSProperties}
        onKeyDown={onKeyDown}
      >
        <div role="row" className={`${styles.row} ${styles.headerRow}`}>
          <div role="columnheader" className={styles.corner}>
            <span className="visually-hidden">String</span>
          </div>
          {frets.map((fret) => (
            <div role="columnheader" key={fret} className={styles.fretHeader}>
              <button
                type="button"
                tabIndex={-1}
                className={styles.fretButton}
                aria-pressed={selection.fret === fret}
                aria-label={fret === 0 ? "Highlight open strings" : `Highlight fret ${fret}`}
                onClick={() => onSelectionChange({ type: "toggleFret", fret })}
              >
                {fret === 0 ? "Open" : fret}
              </button>
            </div>
          ))}
        </div>

        {strings.map((string) => {
          const label = stringLabel(string, stringCount, openNames.get(string));
          const mutedInVoicing = voicing !== undefined && voicing.strings[string - 1] === null;
          return (
            <div
              role="row"
              key={string}
              className={styles.row}
              data-highlighted={selection.string === string}
              style={{ "--string-weight": `${1 + (stringCount - string) * 0.35}px` } as CSSProperties}
            >
              <div role="rowheader" className={styles.stringHeader}>
                <button
                  type="button"
                  tabIndex={-1}
                  className={styles.stringButton}
                  aria-pressed={selection.string === string}
                  aria-label={`Highlight ${label}`}
                  title={label}
                  onClick={() => onSelectionChange({ type: "toggleString", string })}
                >
                  <span aria-hidden="true">{openNames.get(string) ?? string}</span>
                  {mutedInVoicing ? <span className={styles.muted} aria-hidden="true">×</span> : null}
                </button>
              </div>
              {frets.map((fret) => {
                const cell = model(string, fret);
                const key = markerKey(string, fret);
                const isActive = active.string === string && active.fret === fret;
                return (
                  <div
                    role="gridcell"
                    key={fret}
                    className={styles.cell}
                    data-open={fret === 0}
                    data-column-highlighted={selection.fret === fret}
                  >
                    {cell ? (
                      <button
                        type="button"
                        ref={(node) => {
                          if (node) cellRefs.current.set(key, node);
                          else cellRefs.current.delete(key);
                        }}
                        tabIndex={isActive ? 0 : -1}
                        className={styles.cellButton}
                        aria-pressed={cell.marked}
                        aria-label={cellLabel(cell, label, chordName)}
                        onFocus={() => setActive({ string, fret })}
                        onClick={() => onSelectionChange({ type: "toggleMarker", string, fret })}
                      >
                        <Marker cell={cell} labelMode={labelMode} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className={styles.inlayRow} aria-hidden="true">
          <div />
          {frets.map((fret) => (
            <div key={fret} className={styles.inlayCell}>
              {SINGLE_INLAYS.has(fret) ? <span className={styles.inlay} /> : null}
              {DOUBLE_INLAYS.has(fret) ? (
                <>
                  <span className={styles.inlay} />
                  <span className={styles.inlay} />
                </>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Marker({ cell, labelMode }: { cell: CellModel; labelMode: LabelMode }) {
  const { position, tone, inVoicing, marked, revealed } = cell;
  if (!inVoicing && !tone && !marked && !revealed) return null;
  const text = labelMode === "degree" && tone ? tone.degree : displaySpelling(tone?.spelling ?? position.noteName);
  const variant = inVoicing ? "voicing" : tone ? "chordTone" : marked ? "marked" : "revealed";
  return (
    <span
      aria-hidden="true"
      className={`${styles.marker} ${tone ? `deg-${degreeFamily(tone.degree)}` : ""}`}
      data-variant={variant}
      data-marked={marked}
    >
      {text}
    </span>
  );
}

function cellLabel(cell: CellModel, stringName: string, chordName: string | undefined): string {
  const { position, tone, inVoicing } = cell;
  const parts = [
    `${stringName}, ${position.fret === 0 ? "open" : `fret ${position.fret}`}: ${displaySpelling(tone?.spelling ?? position.noteName)}`,
  ];
  if (tone && chordName) parts.push(`degree ${tone.degree} of ${chordName}`);
  if (inVoicing) parts.push("in selected voicing");
  return parts.join(", ");
}
