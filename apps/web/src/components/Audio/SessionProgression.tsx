"use client";

import { useState } from "react";
import Link from "next/link";
import { formatSeconds } from "@/lib/audioTimeline";
import { displaySpelling } from "@/lib/roots";
import { qualityLabel } from "@/lib/qualities";
import { extractChordSequence, isCorrected, type AnalysisSession } from "@/state/lab/model";
import { useLab } from "@/state/lab/LabSessionProvider";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import styles from "./Audio.module.css";
import { ChordSheetSuggestions } from "./ChordSheetSuggestions";

interface SessionProgressionProps {
  session: AnalysisSession;
  pathIndex: number;
  selectedFrame: number | null;
  onSelectWindow: (frameIndex: number) => void;
}

/** Turns the chosen fingering path into a progression and shows the one linked to this session. */
export function SessionProgression({ session, pathIndex, selectedFrame, onSelectWindow }: SessionProgressionProps) {
  const { draft, createProgressionFromSession, dispatchProgression } = useLab();
  const [notice, setNotice] = useState<string | null>(null);
  const detectedCount = extractChordSequence(session.result, pathIndex).length;
  const linked = draft.sessionId === session.id && draft.progression.slots.length > 0 ? draft.progression.slots : null;

  const create = () => {
    if (draft.dirty && draft.progression.slots.length > 0
        && !window.confirm(`Replace the unsaved progression “${draft.name}”?`)) return;
    const created = createProgressionFromSession(pathIndex);
    setNotice(
      `Created a progression with ${created.chordCount} chord${created.chordCount === 1 ? "" : "s"} from path ${pathIndex + 1}.`
      + (created.omitted > 0 ? ` ${created.omitted} later chords were left out (limit reached).` : ""),
    );
  };

  return (
    <>
    <Panel
      title="Progression from this analysis"
      titleId="session-progression-title"
      description={
        `Consecutive windows that path ${pathIndex + 1} plays with the same chord become one chord (${detectedCount} chords). `
        + "Each chord keeps its time range and links back to its windows."
      }
      actions={
        <>
          {linked ? <Link href="/progressions" className={styles.linkButton}>Open in Progression Builder</Link> : null}
          <Button variant={linked ? "secondary" : "primary"} disabled={detectedCount === 0} onClick={create}>
            {linked ? `Recreate from path ${pathIndex + 1}` : `Create progression from path ${pathIndex + 1}`}
          </Button>
        </>
      }
    >
      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      {linked ? (
        <>
          <p className={styles.caveat}>
            Active progression “{draft.name}”{draft.dirty ? " · unsaved changes" : " · saved"}. Edits made in the Progression Builder
            appear here; the analysis itself is never changed.
          </p>
          <ol className={styles.chordStrip} aria-label="Chords in the active progression">
            {linked.map((slot, index) => {
              const source = slot.source;
              const corrected = isCorrected(slot);
              const symbol = `${displaySpelling(slot.root)} ${qualityLabel(slot.quality).toLowerCase()}`;
              const containsSelection = source !== undefined && selectedFrame !== null && source.frameIndexes.includes(selectedFrame);
              return (
                <li key={slot.id}>
                  <button
                    type="button"
                    className={styles.chordChip}
                    data-corrected={corrected}
                    aria-pressed={containsSelection}
                    disabled={!source || source.sessionId !== session.id}
                    onClick={() => source && onSelectWindow(source.frameIndexes[0]!)}
                    aria-label={`Chord ${index + 1}: ${corrected ? `${symbol} (corrected; detected ${source!.detected.symbol})` : source?.detected.symbol ?? symbol}${source ? `, ${formatSeconds(source.startSeconds)} to ${formatSeconds(source.endSeconds)}` : ""}`}
                    title={corrected ? `Corrected by you; detected ${source!.detected.symbol}` : "Detected by the analysis"}
                  >
                    <span className={styles.chipSymbol}>
                      {corrected ? symbol : displaySpelling(source?.detected.symbol ?? symbol)}
                    </span>
                    {source ? <span className={styles.chipTime}>{formatSeconds(source.startSeconds)}</span> : null}
                    {corrected ? <span className={styles.chipBadge}>edited</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <p className={styles.caveat}>
          No progression has been made from this analysis yet. Creating one copies only chord names and window links;
          you can then correct chords in the Progression Builder without changing the analysis.
        </p>
      )}
    </Panel>
    <ChordSheetSuggestions
      session={session}
      linkedSlots={linked}
      onSelectWindow={onSelectWindow}
      onApplySuggestion={(slotId, root, quality) => dispatchProgression({ type: "update", id: slotId, patch: { root, quality } })}
    />
    </>
  );
}
