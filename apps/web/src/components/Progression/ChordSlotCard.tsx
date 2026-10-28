import type { ChordQuality } from "@/services";
import { degreeFamily } from "@/lib/degrees";
import { displaySpelling } from "@/lib/roots";
import { qualityLabel } from "@/lib/qualities";
import { useGuitarLabService } from "@/state/ServiceContext";
import { useAsyncResource } from "@/state/useAsyncResource";
import type { ProgressionSlot } from "@/state/progressionState";
import { ChordPicker } from "./ChordPicker";
import styles from "./Progression.module.css";

interface ChordSlotCardProps {
  slot: ProgressionSlot;
  index: number;
  total: number;
  qualities: readonly ChordQuality[];
  onChange: (patch: Partial<Pick<ProgressionSlot, "root" | "quality">>) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}

/** One chord in the progression; its identity comes from GET /api/chords. */
export function ChordSlotCard({ slot, index, total, qualities, onChange, onMove, onRemove }: ChordSlotCardProps) {
  const service = useGuitarLabService();
  const chord = useAsyncResource(`chord:${slot.root}:${slot.quality}`, (signal) =>
    service.getChord({ root: slot.root, quality: slot.quality }, { signal }),
  );
  const data = chord.status === "success" ? chord.data : chord.status === "loading" ? chord.previous : undefined;
  const position = `Chord ${index + 1} of ${total}`;

  return (
    <li className={styles.slot} aria-label={`${position}: ${data ? data.symbol : `${slot.root} ${slot.quality}`}`}>
      <div className={styles.slotHeader}>
        <span className={styles.slotIndex}>{index + 1}</span>
        <div className={styles.slotActions}>
          <button type="button" className={styles.iconButton} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move chord ${index + 1} earlier`}>
            ←
          </button>
          <button type="button" className={styles.iconButton} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move chord ${index + 1} later`}>
            →
          </button>
          <button type="button" className={`${styles.iconButton} ${styles.remove}`} onClick={onRemove} aria-label={`Remove chord ${index + 1}`}>
            ×
          </button>
        </div>
      </div>

      {chord.status === "error" ? (
        <p className={styles.slotError} role="alert">{chord.error.message}</p>
      ) : data ? (
        <>
          <p className={styles.slotSymbol}>{displaySpelling(data.symbol)}</p>
          <p className={styles.slotQuality}>{qualityLabel(data.quality)}</p>
          <ul className={styles.slotTones} aria-label={`${data.symbol} chord tones`}>
            {data.tones.map((tone) => (
              <li key={tone.degree} className={`deg-${degreeFamily(tone.degree)}`}>
                <span className={styles.toneDegree}>{tone.degree}</span>
                <span>{displaySpelling(tone.spelling)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className={styles.slotLoading} role="status">Loading…</p>
      )}

      <ChordPicker
        compact
        root={slot.root}
        quality={slot.quality}
        qualities={qualities}
        labelPrefix={`Chord ${index + 1} `}
        onChange={onChange}
      />
    </li>
  );
}
