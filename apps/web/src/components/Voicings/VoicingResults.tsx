import type { VoicingSearchResult } from "@/services";
import type { LabelMode } from "@/state/explorerState";
import type { AsyncState } from "@/state/useAsyncResource";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/StatusMessage";
import { VoicingCard } from "./VoicingCard";
import styles from "./Voicings.module.css";

interface VoicingResultsProps {
  result: AsyncState<VoicingSearchResult>;
  selectedIndex: number | null;
  labelMode: LabelMode;
  openStringNames: ReadonlyMap<number, string>;
  onSelect: (index: number | null) => void;
  onRetry: () => void;
  onResetConstraints: () => void;
}

export function VoicingResults({
  result,
  selectedIndex,
  labelMode,
  openStringNames,
  onSelect,
  onRetry,
  onResetConstraints,
}: VoicingResultsProps) {
  if (result.status === "idle") return null;
  if (result.status === "error") {
    return <ErrorState title="Voicing search failed" message={result.error.message} onRetry={onRetry} />;
  }

  const data = result.status === "success" ? result.data : result.previous;
  if (!data) {
    return (
      <div className={styles.results}>
        <LoadingState label="Searching the fretboard for voicings…" />
        <ul className={styles.grid} aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <li key={i} className={styles.skeletonCard} />)}
        </ul>
      </div>
    );
  }

  if (data.results.length === 0) {
    return (
      <EmptyState title={`No playable ${data.chord.symbol} voicings match these constraints`}>
        <p>Try widening the fret span, raising the highest fret, allowing open strings, or choosing “Any string” for the root.</p>
        <button type="button" className={styles.inlineButton} onClick={onResetConstraints}>
          Reset constraints
        </button>
      </EmptyState>
    );
  }

  const refreshing = result.status === "loading";
  return (
    <div className={styles.results} aria-busy={refreshing}>
      <p className={styles.count} role="status">
        {refreshing ? "Updating… " : ""}
        Showing {data.results.length} of {data.totalFound} voicing{data.totalFound === 1 ? "" : "s"}, ranked by an ergonomic
        heuristic (lower span and fewer fretted notes first).
      </p>
      <ul className={styles.grid} data-refreshing={refreshing}>
        {data.results.map((voicing, index) => (
          <li key={voicing.strings.map((n) => (n === null ? "x" : n.fret)).join(",")}>
            <VoicingCard
              voicing={voicing}
              rank={index + 1}
              selected={index === selectedIndex}
              labelMode={labelMode}
              openStringNames={openStringNames}
              onSelect={() => onSelect(index === selectedIndex ? null : index)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
