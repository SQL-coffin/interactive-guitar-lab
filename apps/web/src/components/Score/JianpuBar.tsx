import type { KeyboardEvent } from "react";
import { displaySpelling } from "@/lib/roots";
import type { ScoreBar } from "@/lib/score/grid";
import type { ChordSegment } from "@/lib/score/chordTrack";
import type { NoteSegment } from "@/lib/score/melody";
import { VALUE_LABELS, glyphsFor, splitDuration, type JianpuGlyph, type RhythmPiece } from "@/lib/score/rhythm";

export const TICK_WIDTH = 15;
const PAD = 14;
const CHORD_Y = 20;
const RHYTHM_Y = 62;
const MELODY_Y = 112;
const HEIGHT = 140;

interface JianpuBarProps {
  bar: ScoreBar;
  ticksPerBeat: number;
  isLast: boolean;
  chordSegments: ChordSegment[];
  noteSegments: NoteSegment[];
  selectedEventIndex: number | null;
  selectedNoteId: string | null;
  /** Melody cursor tick inside this bar, if the cursor is here. */
  cursorTick: number | null;
  onSelectChord: (eventIndex: number) => void;
  onSelectNote: (noteId: string) => void;
  onSelectSlot: (tickInBar: number) => void;
}

const x = (tick: number) => PAD + tick * TICK_WIDTH;

/** Rests are written as one 0 per beat (never with dashes); shorter rests keep their underlines. */
function restPieces(startTick: number, ticks: number, b: number): RhythmPiece[] {
  return splitDuration(startTick, ticks, b).flatMap((piece) => {
    const parts: RhythmPiece[] = [];
    const push = (at: number, value: RhythmPiece["value"], len: number) => parts.push({ startTick: at, value, ticks: len });
    switch (piece.value) {
      case "whole": case "dotted-half": case "half":
        for (let at = piece.startTick; at < piece.startTick + piece.ticks; at += b) push(at, "quarter", b);
        break;
      case "dotted-quarter": push(piece.startTick, "quarter", b); push(piece.startTick + b, "eighth", 2); break;
      case "dotted-eighth": push(piece.startTick, "eighth", 2); push(piece.startTick + 2, "sixteenth", 1); break;
      default: parts.push(piece);
    }
    return parts;
  });
}

function Glyph({ glyph, y, label, octave = 0, accidental = 0 }: { glyph: JianpuGlyph; y: number; label: string; octave?: number; accidental?: number }) {
  const left = x(glyph.startTick);
  const width = glyph.ticks * TICK_WIDTH;
  const head = left + Math.min(width / 2, 10);
  const textX = glyph.kind === "head" ? head : left + width / 2;
  const lineY = (k: number) => y + 6 + k * 4;
  return (
    <g>
      {glyph.kind === "head" ? (
        <>
          {accidental !== 0 ? <text x={textX - 9} y={y - 4} fontSize="10" textAnchor="middle" fill="currentColor">{accidental > 0 ? "♯" : "♭"}</text> : null}
          <text x={textX} y={y} fontSize="18" fontWeight="600" textAnchor="middle" fill="currentColor">{label}</text>
          {Array.from({ length: Math.max(0, octave) }, (_, k) => <circle key={`u${k}`} cx={textX} cy={y - 17 - k * 5} r={1.8} fill="currentColor" />)}
          {Array.from({ length: Math.max(0, -octave) }, (_, k) => <circle key={`d${k}`} cx={textX} cy={lineY(glyph.underlines) + 3 + k * 5} r={1.8} fill="currentColor" />)}
        </>
      ) : glyph.kind === "dash" ? (
        <line x1={left + width / 2 - 6} x2={left + width / 2 + 6} y1={y - 6} y2={y - 6} stroke="currentColor" strokeWidth={2} />
      ) : (
        <circle cx={left + 4} cy={y - 6} r={2} fill="currentColor" />
      )}
      {Array.from({ length: glyph.underlines }, (_, k) => (
        <line key={k} x1={left + 1} x2={left + width - 1} y1={lineY(k)} y2={lineY(k)} stroke="currentColor" strokeWidth={1.4} />
      ))}
    </g>
  );
}

/** Tie arc between two ticks (or to/from the bar edge). */
function Tie({ from, to, y, below = false }: { from: number; to: number; y: number; below?: boolean }) {
  const dy = below ? 10 : -10;
  const base = below ? y + 16 : y - 20;
  return <path d={`M ${from} ${base} Q ${(from + to) / 2} ${base + dy} ${to} ${base}`} fill="none" stroke="currentColor" strokeWidth={1.2} />;
}

function headX(piece: RhythmPiece) {
  return x(piece.startTick) + Math.min((piece.ticks >= 4 ? 4 : piece.ticks) * TICK_WIDTH / 2, 10);
}

/** One bar of Jianpu: chord symbols, accompaniment rhythm, and the manually entered melody. */
export function JianpuBar(props: JianpuBarProps) {
  const { bar, ticksPerBeat: b, chordSegments: chords, noteSegments: notes } = props;
  const width = x(bar.ticks) + PAD;
  const label = bar.pickup ? "Pickup" : `Bar ${bar.number}`;
  // Same wording as the editor panels: "beat 2 + 1/4" is a sixteenth after beat 2.
  const beatOf = (tick: number) => `${Math.floor(tick / b) + 1}${tick % b ? ` + ${tick % b}/${b}` : ""}`;
  const keyActivate = (fn: () => void) => (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fn();
    }
  };

  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      width={width}
      height={HEIGHT}
      role="group"
      aria-label={`${label}, ${(bar.endSeconds - bar.startSeconds).toFixed(2)} seconds`}
      className="jianpu-bar"
      data-irregular={bar.irregular}
    >
      <text x={4} y={8} fontSize="8" fill="var(--text-muted)">{bar.pickup ? "pickup" : bar.number}</text>
      {/* Beat guides */}
      {Array.from({ length: bar.ticks / b }, (_, k) => (
        <line key={k} x1={x(k * b)} x2={x(k * b)} y1={RHYTHM_Y + 14} y2={RHYTHM_Y + 18} stroke="var(--border-strong)" />
      ))}

      {/* Chord symbols and sustain lines */}
      {chords.filter((s) => s.kind === "chord").map((seg, i) => {
        const selected = seg.eventIndex === props.selectedEventIndex;
        const x0 = x(seg.startTick);
        const x1 = x(seg.startTick + seg.ticks) - 3;
        return (
          <g
            key={`c${i}`}
            role="button"
            tabIndex={seg.tiedFromPrevious ? -1 : 0}
            aria-label={`${label}, beat ${beatOf(seg.startTick)}: ${seg.chordSymbol}${seg.tiedFromPrevious ? " (continued)" : ""}${seg.confident ? "" : ", low rhythm confidence"}`}
            aria-pressed={selected}
            onClick={() => props.onSelectChord(seg.eventIndex!)}
            onKeyDown={keyActivate(() => props.onSelectChord(seg.eventIndex!))}
            className="jianpu-chord"
            data-confident={seg.confident}
            data-selected={selected}
          >
            <rect x={x0 - 2} y={CHORD_Y - 14} width={Math.max(14, x1 - x0 + 4)} height={26} fill="transparent" />
            {!seg.tiedFromPrevious ? (
              <text x={x0} y={CHORD_Y} fontSize="13" fontWeight="700" fill={selected ? "var(--accent)" : "currentColor"}>
                {displaySpelling(seg.chordSymbol!)}{seg.confident ? "" : "?"}
              </text>
            ) : null}
            <line
              x1={seg.tiedFromPrevious ? x0 - PAD + 2 : x0}
              x2={x1}
              y1={CHORD_Y + 6}
              y2={CHORD_Y + 6}
              stroke={selected ? "var(--accent)" : "var(--border-strong)"}
              strokeWidth={2}
              strokeDasharray={seg.confident ? undefined : "4 3"}
            />
          </g>
        );
      })}

      {/* Accompaniment rhythm: X for chord hits, 0 for rests, ≈ where the rhythm is uncertain */}
      {chords.map((seg, i) => {
        if (seg.kind === "chord" && !seg.confident) {
          return <text key={`r${i}`} x={x(seg.startTick) + 4} y={RHYTHM_Y} fontSize="15" fill="var(--text-muted)">≈</text>;
        }
        const pieces = seg.kind === "rest" ? restPieces(seg.startTick, seg.ticks, b) : splitDuration(seg.startTick, seg.ticks, b);
        return (
          <g key={`r${i}`} data-kind={seg.kind}>
            {pieces.map((piece, p) => (
              <g key={p}>
                {glyphsFor(piece, b).map((glyph, g) => (
                  <Glyph key={g} glyph={glyph} y={RHYTHM_Y} label={seg.kind === "rest" ? "0" : "X"} />
                ))}
                {seg.kind === "chord" && (p > 0 || seg.tiedFromPrevious) ? (
                  <Tie from={p > 0 ? headX(pieces[p - 1]!) : 2} to={headX(piece)} y={RHYTHM_Y} below />
                ) : null}
              </g>
            ))}
            {seg.kind === "chord" && seg.tiedToNext && pieces.length > 0 ? (
              <Tie from={headX(pieces[pieces.length - 1]!)} to={width - 2} y={RHYTHM_Y} below />
            ) : null}
          </g>
        );
      })}

      {/* Melody lane: empty sixteenth slots are click targets for the editor cursor */}
      {Array.from({ length: bar.ticks }, (_, t) => (
        <rect
          key={`s${t}`}
          x={x(t)}
          y={MELODY_Y - 22}
          width={TICK_WIDTH}
          height={34}
          fill={props.cursorTick === t ? "var(--accent-soft)" : "transparent"}
          role="button"
          tabIndex={-1}
          aria-label={`${label}, beat ${beatOf(t)}: melody slot`}
          onClick={() => props.onSelectSlot(t)}
          className="jianpu-slot"
        />
      ))}
      {notes.map((seg, i) => {
        const pieces = splitDuration(seg.startTick, seg.ticks, b);
        const n = seg.note;
        const selected = n.id === props.selectedNoteId;
        const pieceLabel = pieces.map((p) => VALUE_LABELS[p.value].toLowerCase()).join(" tied to ");
        return (
          <g
            key={`n${i}`}
            role="button"
            tabIndex={0}
            aria-label={`${label}, beat ${beatOf(seg.startTick)}: ${n.degree === 0 ? "rest" : `${n.accidental > 0 ? "♯" : n.accidental < 0 ? "♭" : ""}${n.degree}${n.octave ? ` octave ${n.octave > 0 ? "+" : ""}${n.octave}` : ""}`}, ${pieceLabel}`}
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelectNote(n.id);
            }}
            onKeyDown={keyActivate(() => props.onSelectNote(n.id))}
            className="jianpu-note"
            style={{ color: selected ? "var(--accent)" : undefined }}
          >
            {(n.degree === 0 ? restPieces(seg.startTick, seg.ticks, b) : pieces).map((piece, p) => (
              <g key={p}>
                {glyphsFor(piece, b).map((glyph, g) => (
                  <Glyph key={g} glyph={glyph} y={MELODY_Y} label={String(n.degree)} octave={n.degree === 0 ? 0 : n.octave} accidental={p === 0 && !seg.tiedFromPrevious ? n.accidental : 0} />
                ))}
                {n.degree !== 0 && (p > 0 || seg.tiedFromPrevious) ? (
                  <Tie from={p > 0 ? headX(pieces[p - 1]!) : 2} to={headX(piece)} y={MELODY_Y} />
                ) : null}
              </g>
            ))}
            {n.degree !== 0 && seg.tiedToNext && pieces.length > 0 ? <Tie from={headX(pieces[pieces.length - 1]!)} to={width - 2} y={MELODY_Y} /> : null}
          </g>
        );
      })}

      {/* Bar lines; the last bar ends with a final double bar line */}
      <line x1={width - (props.isLast ? 5 : 1)} x2={width - (props.isLast ? 5 : 1)} y1={8} y2={HEIGHT - 14} stroke="currentColor" strokeWidth={1} />
      {props.isLast ? <line x1={width - 2} x2={width - 2} y1={8} y2={HEIGHT - 14} stroke="currentColor" strokeWidth={3} /> : null}
    </svg>
  );
}
