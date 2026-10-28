"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { displaySpelling } from "@/lib/roots";
import { formatSeconds } from "@/lib/audioTimeline";
import { LOW_METER_CONFIDENCE, readMeter, timeSignatureLabel } from "@/lib/score/meter";
import { buildBarGrid, locateTick, type BarGrid } from "@/lib/score/grid";
import { chordSegments, placeChordEvents } from "@/lib/score/chordTrack";
import { noteSegments, placeNote, removeNote, type JianpuDegree, type MelodyNote } from "@/lib/score/melody";
import { VALUE_LABELS, VALUE_TICKS, type RhythmValue } from "@/lib/score/rhythm";
import type { AnalysisSession } from "@/state/lab/model";
import { useLab } from "@/state/lab/LabSessionProvider";
import { ROOT_SPELLINGS } from "@/components/Progression/chordOptions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/StatusMessage";
import { JianpuBar } from "./JianpuBar";
import { ScoreTimeline } from "./ScoreTimeline";
import styles from "./Score.module.css";

const VALUES: RhythmValue[] = ["whole", "half", "dotted-half", "quarter", "dotted-quarter", "eighth", "dotted-eighth", "sixteenth"];
const DEGREES: JianpuDegree[] = [1, 2, 3, 4, 5, 6, 7, 0];

let noteCounter = 0;
const newNoteId = () => `note-${Date.now().toString(36)}-${(noteCounter++).toString(36)}`;

function position(grid: BarGrid, tick: number): string {
  const { barIndex, tickInBar } = locateTick(grid, tick);
  const bar = grid.bars[barIndex]!;
  const beat = Math.floor(tickInBar / grid.ticksPerBeat) + 1;
  const sub = tickInBar % grid.ticksPerBeat;
  return `${bar.pickup ? "pickup" : `bar ${bar.number}`}, beat ${beat}${sub ? ` + ${sub}/${grid.ticksPerBeat}` : ""}`;
}

/** Gaps shorter than this between the audio edges and the bar grid are not worth a notice. */
const UNCOVERED_NOTICE_SECONDS = 0.25;

/** Jianpu score view: meter, bars, chord rhythm from the analysis, and a hand-entered melody. */
export function ScoreView({ session }: { session: AnalysisSession }) {
  const { score, editScore, saveScore, storage } = useLab();
  const result = session.result;
  const meter = useMemo(() => readMeter(result), [result]);
  const grid = useMemo(() => buildBarGrid(meter, result.audio.durationSeconds), [meter, result]);
  // Sessions saved before chord sheets existed have no chordSheet at runtime.
  const events = useMemo(() => (result.chordSheet as typeof result.chordSheet | undefined)?.events ?? [], [result]);
  const doc = score?.doc;
  const placed = useMemo(() => (grid ? placeChordEvents(grid, events, doc?.chordAdjustments) : []), [grid, events, doc?.chordAdjustments]);
  const segments = useMemo(() => (grid ? chordSegments(grid, placed) : []), [grid, placed]);
  const melodySegments = useMemo(() => (grid && doc ? noteSegments(grid, doc.melody) : []), [grid, doc]);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [value, setValue] = useState<RhythmValue>("quarter");
  const [octave, setOctave] = useState<MelodyNote["octave"]>(0);
  const [accidental, setAccidental] = useState<MelodyNote["accidental"]>(0);
  const [saving, setSaving] = useState(false);

  const lowConfidenceCount = placed.filter((p) => !p.confident).length;
  // Audio the detected bars do not cover (e.g. before the first detected beat) is not placed in any bar.
  const uncoveredBefore = grid ? grid.bars[0]!.startSeconds : 0;
  const uncoveredAfter = grid ? result.audio.durationSeconds - grid.bars[grid.bars.length - 1]!.endSeconds : 0;
  const note = doc?.melody.find((n) => n.id === selectedNote);
  const event = selectedEvent !== null ? placed[selectedEvent] : undefined;

  const header = (
    <dl className={styles.header}>
      <div><dt>Key</dt><dd>
        <label className={styles.keyLabel}>
          <span>1 =</span>
          <select
            aria-label="Key (1 =)"
            value={doc?.keyTonic ?? ""}
            onChange={(e) => editScore((d) => ({ ...d, keyTonic: e.target.value || null }))}
            disabled={!doc}
          >
            <option value="">? (not detected)</option>
            {ROOT_SPELLINGS.map((r) => <option key={r} value={r}>{displaySpelling(r)}</option>)}
          </select>
        </label>
      </dd></div>
      <div><dt>Time signature</dt><dd>{timeSignatureLabel(meter)}</dd></div>
      <div><dt>Tempo</dt><dd>{meter.tempoBpm === null ? "♩ = ?" : `♩ ≈ ${meter.tempoBpm.toFixed(0)}`}</dd></div>
      <div><dt>Bar length</dt><dd>{meter.barDurationSeconds === null ? "—" : `${meter.barDurationSeconds.toFixed(2)} s`}</dd></div>
      <div><dt>Meter confidence</dt><dd>{meter.confidence === null ? "—" : `${meter.confidence.toFixed(2)} (heuristic)`}</dd></div>
      <div><dt>Windows</dt><dd>{meter.windowingMode === "unknown" ? "—" : meter.windowingMode}</dd></div>
    </dl>
  );

  const notices = (
    <ul className={styles.notices}>
      {!meter.known ? (
        <li>The time signature could not be determined, so the score falls back to a time-based view. Bars and note values are not shown; nothing is assumed to be 4/4.</li>
      ) : null}
      {meter.known && meter.confidence !== null && meter.confidence < LOW_METER_CONFIDENCE ? (
        <li>Low meter confidence ({meter.confidence.toFixed(2)}): bar lines may be shifted. Check them by ear.</li>
      ) : null}
      {meter.known && meter.windowingMode === "fixed-window" ? (
        <li>Chord changes come from fixed analysis windows, not the beat grid, so many positions are approximate.</li>
      ) : null}
      {uncoveredBefore > UNCOVERED_NOTICE_SECONDS ? (
        <li>The first {uncoveredBefore.toFixed(1)} s come before the first detected beat and are not placed in any bar; chords there are marked low confidence.</li>
      ) : null}
      {uncoveredAfter > UNCOVERED_NOTICE_SECONDS ? (
        <li>The last {uncoveredAfter.toFixed(1)} s come after the last detected bar and are not placed in any bar.</li>
      ) : null}
      {lowConfidenceCount > 0 ? (
        <li>{lowConfidenceCount} chord{lowConfidenceCount === 1 ? "" : "s"} could not be placed reliably on the sixteenth grid; they are drawn dashed with “?” and no note value until you adjust or confirm them.</li>
      ) : null}
      <li>
        Melody: not transcribed. Automatic melody transcription is not available yet, so the melody lane only shows notes you enter.
        Chord rhythm (X) comes from the analysis; it is not a melody.
      </li>
    </ul>
  );

  if (!doc || score?.status === "loading") return <p className={styles.muted} role="status">Loading score…</p>;
  if (!grid) {
    return (
      <div className={styles.score}>
        {header}
        {notices}
        {events.length > 0
          ? <ScoreTimeline events={events} beats={meter.beatTimesSeconds} durationSeconds={result.audio.durationSeconds} />
          : <EmptyState title="This analysis has no chord sheet to lay out" />}
      </div>
    );
  }

  const update = (patch: Partial<MelodyNote>) => {
    if (!note) return;
    editScore((d) => ({ ...d, melody: placeNote(d.melody, { ...note, ...patch }, grid.totalTicks) }));
  };
  const enterDegree = (degree: JianpuDegree) => {
    if (note) {
      update({ degree });
      return;
    }
    const ticks = VALUE_TICKS[value];
    const created: MelodyNote = { id: newNoteId(), startTick: cursor, ticks, degree, accidental: degree === 0 ? 0 : accidental, octave: degree === 0 ? 0 : octave, source: "manual" };
    editScore((d) => ({ ...d, melody: placeNote(d.melody, created, grid.totalTicks) }));
    setCursor(Math.min(grid.totalTicks - 1, cursor + ticks));
  };
  const remove = () => {
    if (!note) return;
    editScore((d) => ({ ...d, melody: removeNote(d.melody, note.id) }));
    setSelectedNote(null);
  };
  const adjust = (patch: { startTick?: number; endTick?: number; confirmed?: boolean } | null) => {
    if (!event) return;
    editScore((d) => {
      const next = { ...d.chordAdjustments };
      if (patch === null) delete next[event.eventIndex];
      else next[event.eventIndex] = { ...next[event.eventIndex], ...patch };
      return { ...d, chordAdjustments: next };
    });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
    if (/^[0-7]$/.test(e.key)) {
      e.preventDefault();
      enterDegree(Number(e.key) as JianpuDegree);
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setSelectedNote(null);
      setCursor((c) => Math.min(grid.totalTicks - 1, Math.max(0, c + (e.key === "ArrowRight" ? 1 : -1))));
    } else if ((e.key === "Delete" || e.key === "Backspace") && note) {
      e.preventDefault();
      remove();
    }
  };

  const cursorAt = locateTick(grid, note ? note.startTick : cursor);

  return (
    <div className={styles.score}>
      <div className={styles.scoreTop}>
        {header}
        <div className={styles.saveBox}>
          <span className={styles.muted} role="status">
            {score.dirty ? <strong className={styles.unsaved}>Unsaved changes</strong> : score.lastSavedAt ? `Saved ${new Date(score.lastSavedAt).toLocaleString()}` : "No edits yet"}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={!score.dirty || saving || !storage.ready}
            onClick={async () => {
              setSaving(true);
              try { await saveScore(); } finally { setSaving(false); }
            }}
          >
            {saving ? "Saving…" : "Save score"}
          </Button>
        </div>
      </div>
      {notices}

      <p className={styles.scoreTitle}>
        1 = {doc.keyTonic ? displaySpelling(doc.keyTonic) : "?"} · {timeSignatureLabel(meter)} · {meter.tempoBpm === null ? "♩ = ?" : `♩ ≈ ${meter.tempoBpm.toFixed(0)}`}
      </p>
      <div className={styles.lanesKey} aria-hidden="true">
        <span>Chords</span><span>Rhythm (X)</span><span>Melody (yours)</span>
      </div>
      <div className={styles.bars} tabIndex={0} onKeyDown={onKeyDown} aria-label="Jianpu score. Type 0–7 to enter notes at the cursor, arrow keys move the cursor.">
        {grid.bars.map((bar, i) => (
          <JianpuBar
            key={bar.index}
            bar={bar}
            ticksPerBeat={grid.ticksPerBeat}
            isLast={i === grid.bars.length - 1}
            chordSegments={segments.filter((s) => s.barIndex === i)}
            noteSegments={melodySegments.filter((s) => s.barIndex === i)}
            selectedEventIndex={selectedEvent}
            selectedNoteId={selectedNote}
            cursorTick={cursorAt.barIndex === i ? cursorAt.tickInBar : null}
            onSelectChord={(index) => {
              setSelectedEvent(index);
              setSelectedNote(null);
            }}
            onSelectNote={(id) => setSelectedNote(id)}
            onSelectSlot={(tickInBar) => {
              setSelectedNote(null);
              setCursor(bar.startTick + tickInBar);
            }}
          />
        ))}
      </div>

      <div className={styles.panels}>
        <section className={styles.editor} aria-label="Melody editor">
          <h3 className={styles.panelTitle}>Melody editor</h3>
          <p className={styles.muted}>
            {note ? `Editing note at ${position(grid, note.startTick)}` : `Cursor: ${position(grid, cursor)}`}. Select a slot in the melody lane, then type 1–7 (0 = rest).
          </p>
          <div className={styles.keypad} role="group" aria-label="Scale degree">
            {DEGREES.map((d) => (
              <button key={d} type="button" className={styles.key} onClick={() => enterDegree(d)} aria-label={d === 0 ? "Rest (0)" : `Degree ${d}`}>{d}</button>
            ))}
          </div>
          <div className={styles.controls}>
            <label>
              <span>Duration</span>
              <select
                value={note ? (Object.keys(VALUE_TICKS) as RhythmValue[]).find((v) => VALUE_TICKS[v] === note.ticks) ?? "" : value}
                onChange={(e) => {
                  const next = e.target.value as RhythmValue;
                  if (note) update({ ticks: VALUE_TICKS[next] });
                  else setValue(next);
                }}
              >
                {note && !(Object.values(VALUE_TICKS) as number[]).includes(note.ticks) ? <option value="">{note.ticks} sixteenths</option> : null}
                {VALUES.map((v) => <option key={v} value={v}>{VALUE_LABELS[v]}</option>)}
              </select>
            </label>
            <div className={styles.toggleRow} role="group" aria-label="Octave">
              {([-1, 0, 1] as const).map((o) => (
                <button key={o} type="button" className={styles.toggle} aria-pressed={(note?.octave ?? octave) === o}
                  onClick={() => (note ? update({ octave: o }) : setOctave(o))}>
                  {o === 0 ? "Middle" : o > 0 ? "High ˙" : "Low ."}
                </button>
              ))}
            </div>
            <div className={styles.toggleRow} role="group" aria-label="Accidental">
              {([-1, 0, 1] as const).map((a) => (
                <button key={a} type="button" className={styles.toggle} aria-pressed={(note?.accidental ?? accidental) === a}
                  onClick={() => (note ? update({ accidental: a }) : setAccidental(a))}>
                  {a === 0 ? "♮" : a > 0 ? "♯" : "♭"}
                </button>
              ))}
            </div>
            {note ? (
              <div className={styles.toggleRow}>
                <Button size="sm" variant="ghost" onClick={() => setSelectedNote(null)}>Done</Button>
                <Button size="sm" variant="danger" onClick={remove}>Delete note</Button>
              </div>
            ) : null}
          </div>
        </section>

        <section className={styles.editor} aria-label="Chord timing">
          <h3 className={styles.panelTitle}>Chord timing</h3>
          {event ? (
            <>
              <p className={styles.chordName}>{displaySpelling(event.chordSymbol)}{event.confident ? "" : " ?"}</p>
              <dl className={styles.facts}>
                <div><dt>Detected</dt><dd>{formatSeconds(event.start.seconds)} – {formatSeconds(event.end.seconds)}</dd></div>
                <div><dt>On the grid</dt><dd>{position(grid, event.startTick)} → {position(grid, event.endTick)}</dd></div>
                <div><dt>Off-grid by</dt><dd>{event.start.errorTicks.toFixed(2)} / {event.end.errorTicks.toFixed(2)} sixteenth</dd></div>
                <div><dt>Rhythm</dt><dd>{event.confident ? (event.adjusted ? "adjusted by you" : "quantized") : "low confidence"}</dd></div>
              </dl>
              <div className={styles.toggleRow}>
                <Button size="sm" onClick={() => adjust({ startTick: Math.max(0, event.startTick - 1) })} aria-label="Move start one sixteenth earlier">Start −</Button>
                <Button size="sm" onClick={() => adjust({ startTick: Math.min(event.endTick - 1, event.startTick + 1) })} aria-label="Move start one sixteenth later">Start +</Button>
                <Button size="sm" onClick={() => adjust({ endTick: Math.max(event.startTick + 1, event.endTick - 1) })} aria-label="Move end one sixteenth earlier">End −</Button>
                <Button size="sm" onClick={() => adjust({ endTick: Math.min(grid.totalTicks, event.endTick + 1) })} aria-label="Move end one sixteenth later">End +</Button>
              </div>
              <div className={styles.toggleRow}>
                {!event.confident ? <Button size="sm" variant="primary" onClick={() => adjust({ confirmed: true })}>Confirm position</Button> : null}
                {event.adjusted ? <Button size="sm" variant="ghost" onClick={() => adjust(null)}>Reset to detected</Button> : null}
              </div>
            </>
          ) : (
            <p className={styles.muted}>Select a chord above the bars to see its detected timestamps and adjust its position.</p>
          )}
        </section>
      </div>
    </div>
  );
}
