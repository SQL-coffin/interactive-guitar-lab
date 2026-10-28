import { useId } from "react";
import type { ChordQuality } from "@/services";
import { qualityLabel } from "@/lib/qualities";
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
        <div role="radiogroup" aria-labelledby={`${name}-label`} className={styles.qualityGrid}>
          {qualities.data.map((quality) => (
            <label key={quality} className={styles.qualityTile} data-checked={quality === value}>
              <input type="radio" name={name} value={quality} checked={quality === value} onChange={() => onChange(quality)} />
              <span>{qualityLabel(quality)}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className={styles.qualityGrid} role="status" aria-label="Loading chord qualities">
          {Array.from({ length: 6 }, (_, i) => <span key={i} className={styles.skeletonTile} />)}
        </div>
      )}
    </div>
  );
}
