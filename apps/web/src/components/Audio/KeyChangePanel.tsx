import type { KeyChangeDetectionResult, KeyChangeEvent, MusicalKeyCandidate } from "@/services";
import { formatSeconds } from "@/lib/audioTimeline";
import { pitchClassToSharpName } from "@/lib/pitchNames";
import { displaySpelling } from "@/lib/roots";
import { Panel } from "@/components/ui/Panel";
import styles from "./Audio.module.css";

interface KeyChangePanelProps {
  /** Absent on sessions saved before key-change detection existed. */
  detection: KeyChangeDetectionResult | undefined;
  durationSeconds: number;
  onSelectEvent: (event: KeyChangeEvent) => void;
}

// Wording keeps every event a candidate: the backend never confirms a modulation.
const STATUS_LABELS: Record<KeyChangeEvent["status"], string> = {
  possible: "Possible change · not confirmed",
  uncertain: "Uncertain · 不确定",
};
const INTERPRETATION_LABELS: Record<KeyChangeEvent["interpretation"], string> = {
  "possible-modulation": "Possible modulation (not confirmed) · 可能转调",
  "local-tonicization-or-modulation": "Possibly a local tonicization or a modulation · 可能是局部主音化或正式转调",
  uncertain: "Uncertain: tonicization, modulation or a change of emphasis · 不确定",
};
const CONFIDENCE_LABELS: Record<KeyChangeEvent["confidence"], string> = {
  low: "Low confidence",
  moderate: "Moderate confidence",
  high: "High confidence",
};

const keyList = (candidates: readonly MusicalKeyCandidate[]) =>
  candidates.length === 0 ? "No clear local key" : candidates.map((candidate) => candidate.label).join(" / ");
const pitchList = (pitchClasses: readonly number[]) =>
  pitchClasses.length === 0 ? "—" : pitchClasses.map((pc) => displaySpelling(pitchClassToSharpName(pc))).join(" ");
const bassLabel = (pitchClass: number | null) => (pitchClass === null ? "No clear bass" : displaySpelling(pitchClassToSharpName(pitchClass)));
const chordList = (symbols: readonly string[]) =>
  symbols.length === 0 ? "—" : symbols.map((symbol) => displaySpelling(symbol)).join(" · ");
const windowCount = (count: number) => `${count} window${count === 1 ? "" : "s"}`;

/**
 * Candidate local-key changes, kept separate from the song-level "Estimated key". Every value
 * shown comes from the backend result; selecting an event seeks the timeline and player there.
 */
export function KeyChangePanel({ detection, durationSeconds, onSelectEvent }: KeyChangePanelProps) {
  return (
    <Panel
      title="Key changes · 转调检测"
      titleId="key-changes-title"
      description="Sustained shifts in the local tonal center. Candidates only: chroma alone cannot confirm a modulation or tell it apart from tonicization."
    >
      <KeyChangeBody detection={detection} durationSeconds={durationSeconds} onSelectEvent={onSelectEvent} />
    </Panel>
  );
}

function KeyChangeBody({ detection, durationSeconds, onSelectEvent }: KeyChangePanelProps) {
  if (!detection) {
    return (
      <p className={styles.caveat} role="note">
        This saved analysis predates key-change detection. Analyze the recording again to check for key changes.
      </p>
    );
  }
  if (detection.status === "insufficient-evidence") {
    return (
      <div className={styles.keyChangeStatus} data-status="insufficient-evidence" role="status">
        <p className={styles.keyChangeHeadline}>Not enough evidence to compare local keys · 证据不足</p>
        <p className={styles.caveat}>{detection.explanation}</p>
      </div>
    );
  }
  if (detection.status === "no-clear-change" || detection.events.length === 0) {
    return (
      <div className={styles.keyChangeStatus} data-status="no-clear-change" role="status">
        <p className={styles.keyChangeHeadline}>No clear key change · 未发现明显转调</p>
        <p className={styles.caveat}>
          No change in the local tonal center persisted long enough to meet the persistence requirement.{" "}
          {detection.explanation}
        </p>
      </div>
    );
  }

  const total = durationSeconds > 0 ? durationSeconds : 1;
  const pct = (seconds: number) => Math.min(100, Math.max(0, (seconds / total) * 100));
  return (
    <>
      <div className={styles.keyChangeTrack} aria-hidden="true">
        {detection.events.map((event, index) => (
          <span key={index}>
            <span
              className={styles.keyChangeBand}
              data-status={event.status}
              style={{
                left: `${pct(event.transitionWindow.startSeconds)}%`,
                width: `${Math.max(0.5, pct(event.transitionWindow.endSeconds) - pct(event.transitionWindow.startSeconds))}%`,
              }}
            />
            <span className={styles.keyChangeMarker} data-status={event.status} style={{ left: `${pct(event.timeSeconds)}%` }} />
          </span>
        ))}
        <span className={styles.rulerStart}>0:00</span>
        <span className={styles.rulerEnd}>{formatSeconds(durationSeconds)}</span>
      </div>

      <ol className={styles.keyChangeList} aria-label="Candidate key changes">
        {detection.events.map((event, index) => (
          <li key={index} className={styles.keyChangeEvent} data-status={event.status}>
            <button
              type="button"
              className={styles.keyChangeJump}
              aria-label={`Change ${index + 1} at ${formatSeconds(event.timeSeconds)}: ${keyList(event.beforeCandidates)} to ${keyList(event.afterCandidates)}. Show in timeline`}
              onClick={() => onSelectEvent(event)}
            >
              <span className={styles.keyChangeTime}>≈ {formatSeconds(event.timeSeconds)}</span>
              <span className={styles.keyChangeKeys}>
                <span>{keyList(event.beforeCandidates)}</span>
                <span aria-hidden="true"> → </span>
                <span>{keyList(event.afterCandidates)}</span>
              </span>
            </button>

            <div className={styles.keyChangeBadges}>
              <span className={styles.keyChangeBadge} data-status={event.status}>{STATUS_LABELS[event.status]}</span>
              <span className={styles.keyChangeBadge} data-confidence={event.confidence}>
                {CONFIDENCE_LABELS[event.confidence]} · score {event.confidenceScore.toFixed(2)} (heuristic)
              </span>
            </div>
            <p className={styles.keyChangeInterpretation}>{INTERPRETATION_LABELS[event.interpretation]}</p>

            <dl className={styles.keyChangeFacts}>
              <div>
                <dt>Transition window</dt>
                <dd>{formatSeconds(event.transitionWindow.startSeconds)}–{formatSeconds(event.transitionWindow.endSeconds)}</dd>
              </div>
              <div>
                <dt>Persistence</dt>
                <dd>
                  {windowCount(event.evidence.beforeWindowCount)} before · {windowCount(event.evidence.afterWindowCount)} after
                  {" "}(≈ {event.evidence.persistentAfterSeconds.toFixed(0)} s)
                </dd>
              </div>
            </dl>

            <details className={styles.keyChangeEvidence}>
              <summary>Evidence</summary>
              <table className={styles.keyChangeTable}>
                <thead>
                  <tr>
                    <th scope="col"><span className="visually-hidden">Evidence</span></th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Key candidates</th>
                    <td>{keyList(event.beforeCandidates)}</td>
                    <td>{keyList(event.afterCandidates)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Pitch classes</th>
                    <td>{pitchList(event.evidence.observedPitchClassesBefore)}</td>
                    <td>{pitchList(event.evidence.observedPitchClassesAfter)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Bass support</th>
                    <td>{bassLabel(event.evidence.bassSupportBefore)}</td>
                    <td>{bassLabel(event.evidence.bassSupportAfter)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Chord candidates</th>
                    <td>{chordList(event.evidence.topChordsBefore)}</td>
                    <td>{chordList(event.evidence.topChordsAfter)}</td>
                  </tr>
                </tbody>
              </table>
              <p className={styles.caveat}>{event.explanation}</p>
            </details>
          </li>
        ))}
      </ol>
      <p className={styles.caveat} role="note">
        {detection.explanation} Times are approximate ({detection.windowSeconds} s windows every {detection.hopSeconds} s);
        the score ranks evidence and is not a probability.
      </p>
    </>
  );
}
