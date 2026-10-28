"use client";

import { useState } from "react";
import type { ChordQuality } from "@/services";
import type { ChordSheetRefinementSuggestion } from "@interactive-guitar-lab/audio-analysis";
import { formatSeconds } from "@/lib/audioTimeline";
import { displaySpelling } from "@/lib/roots";
import type { AnalysisSession } from "@/state/lab/model";
import { isCorrected } from "@/state/lab/model";
import type { ProgressionSlot } from "@/state/progressionState";
import { Button } from "@/components/ui/Button";
import { Panel } from "@/components/ui/Panel";
import styles from "./Audio.module.css";

interface ChordSheetSuggestionsProps {
  session: AnalysisSession;
  linkedSlots: readonly ProgressionSlot[] | null;
  onSelectWindow: (frameIndex: number) => void;
  onApplySuggestion: (slotId: string, root: string, quality: ChordQuality) => void;
}

function sameFrameIndexes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Shows non-destructive backend hints. A suggestion can update the editable progression
 * only when exactly one unedited slot maps to the same source frames and detected chord.
 */
export function ChordSheetSuggestions({
  session,
  linkedSlots,
  onSelectWindow,
  onApplySuggestion,
}: ChordSheetSuggestionsProps) {
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const allSuggestions = session.result.chordSheet?.refinementSuggestions ?? [];
  const suggestions = allSuggestions.filter((suggestion) => !hiddenIds.includes(suggestion.suggestionId));
  if (suggestions.length === 0) return null;

  const events = session.result.chordSheet?.events ?? [];

  return (
    <Panel
      title="Review possible chord glitches"
      titleId="chord-sheet-suggestions-title"
      description="These are heuristic review hints, not confirmed errors. The original analysis is never changed."
    >
      <ul className={styles.refinementList} aria-label="Chord refinement suggestions">
        {suggestions.map((suggestion: ChordSheetRefinementSuggestion) => {
          const event = events[suggestion.eventIndex];
          const sourceIndexes = suggestion.sourceFrameIndexes;
          const matches = linkedSlots?.filter((slot) =>
            slot.source?.sessionId === session.id
            && sameFrameIndexes(slot.source.frameIndexes, sourceIndexes)
            && slot.source.detected.symbol === suggestion.currentChordSymbol) ?? [];
          const target = matches.length === 1 ? matches[0] : undefined;
          const alreadyApplied = target !== undefined
            && target.root === suggestion.suggestedRoot
            && target.quality === suggestion.suggestedQuality
            && isCorrected(target);
          const targetHasOtherCorrection = target !== undefined && isCorrected(target) && !alreadyApplied;
          const startSeconds = event?.startSeconds ?? target?.source?.startSeconds;
          const endSeconds = event?.endSeconds ?? target?.source?.endSeconds;

          return (
            <li className={styles.refinementItem} key={suggestion.suggestionId}>
              <div className={styles.refinementHead}>
                <strong>{displaySpelling(suggestion.currentChordSymbol)}</strong>
                <span aria-hidden="true">→</span>
                <strong>{displaySpelling(suggestion.suggestedChordSymbol)}</strong>
                {startSeconds !== undefined && endSeconds !== undefined ? (
                  <span className={styles.refinementRange}>{formatSeconds(startSeconds)}–{formatSeconds(endSeconds)}</span>
                ) : null}
              </div>
              <p className={styles.refinementNote}>
                This event lasts {suggestion.durationSeconds.toFixed(2)} s, while the neighboring events agree on{" "}
                {displaySpelling(suggestion.suggestedChordSymbol)}.
                {targetHasOtherCorrection ? " The linked progression chord already has a different edit; revert it before applying this hint." : ""}
              </p>
              <div className={styles.refinementActions}>
                <Button size="sm" variant="secondary" onClick={() => onSelectWindow(sourceIndexes[0]!)}>
                  Inspect window
                </Button>
                {target && alreadyApplied ? (
                  <span role="status" className={styles.refinementApplied}>Applied to progression</span>
                ) : target && !targetHasOtherCorrection ? (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onApplySuggestion(target.id, suggestion.suggestedRoot, suggestion.suggestedQuality)}
                  >
                    Apply to progression
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setHiddenIds((current) => [...current, suggestion.suggestionId])}
                >
                  Hide for now
                </Button>
              </div>
              {!target ? (
                <p className={styles.refinementNote}>
                  {linkedSlots
                    ? "No exact matching chord exists in the linked progression, so this hint can be inspected but not applied automatically."
                    : "Create a progression from this path to apply a hint after checking its source window."}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
