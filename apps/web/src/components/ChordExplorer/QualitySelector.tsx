import { useId } from "react";
import type { ChordQuality } from "@/services";
import { groupQualities, qualityLabel } from "@/lib/qualities";
import type { AsyncState } from "@/state/useAsyncResource";
import { ErrorState } from "@/components/ui/StatusMessage";
import styles from "./ChordExplorer.module.css";

interface QualitySelectorProps {
  qualities: AsyncState<ChordQuality[]>;
  value: ChordQuality;
  onChange: (quality: ChordQuality) => void;
  onRetry: () => void;
}

export function QualitySelector({ qualities, value, onChange, onRetry }: QualitySelectorProps) {
  const name = useId();
  return (
    <div className={styles.group}>
      <span className={styles.label} id={`${name}-label`}>Chord quality</span>
      {qualities.status === "error" ? (
        <ErrorState title="Couldn't load chord qualities" message={qualities.error.message} onRetry={onRetry} />
      ) : qualities.status === "success" ? (
        // One radio group (arrow keys move across all qualities); the groups are visual sections.
        <div role="radiogroup" aria-labelledby={`${name}-label`} className={styles.qualityGroups}>
          {groupQualities(qualities.data).map((group) => (
            <div key={group.id} role="group" aria-labelledby={`${name}-${group.id}`} className={styles.qualitySection}>
              <span id={`${name}-${group.id}`} className={styles.qualitySectionLabel}>{group.label}</span>
              <div className={styles.qualityGrid}>
                {group.qualities.map((quality) => (
                  <label key={quality} className={styles.qualityTile} data-checked={quality === value}>
                    <input type="radio" name={name} value={quality} checked={quality === value} onChange={() => onChange(quality)} />
                    <span>{qualityLabel(quality)}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.qualityGrid} role="status" aria-label="Loading chord qualities">
          {Array.from({ length: 10 }, (_, i) => <span key={i} className={styles.skeletonTile} />)}
        </div>
      )}
    </div>
  );
}
