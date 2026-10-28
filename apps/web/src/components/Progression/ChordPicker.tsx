import { useId } from "react";
import type { ChordQuality } from "@/services";
import { displaySpelling } from "@/lib/roots";
import { groupQualities, qualityLabel } from "@/lib/qualities";
import { ROOT_SPELLINGS } from "./chordOptions";
import styles from "./Progression.module.css";

interface ChordPickerProps {
  root: string;
  quality: ChordQuality;
  qualities: readonly ChordQuality[];
  onChange: (patch: { root?: string; quality?: ChordQuality }) => void;
  /** Prefix for accessible names when several pickers share a page. */
  labelPrefix?: string;
  compact?: boolean;
}

/** Root + quality selects. Qualities come from GET /api/chords/qualities. */
export function ChordPicker({ root, quality, qualities, onChange, labelPrefix = "", compact }: ChordPickerProps) {
  const id = useId();
  return (
    <div className={styles.picker} data-compact={compact}>
      <label className={styles.pickerField} htmlFor={`${id}-root`}>
        <span className={compact ? "visually-hidden" : styles.pickerLabel}>{labelPrefix}Root</span>
        <select id={`${id}-root`} value={root} onChange={(e) => onChange({ root: e.target.value })}>
          {ROOT_SPELLINGS.map((spelling) => (
            <option key={spelling} value={spelling}>{displaySpelling(spelling)}</option>
          ))}
        </select>
      </label>
      <label className={styles.pickerField} htmlFor={`${id}-quality`}>
        <span className={compact ? "visually-hidden" : styles.pickerLabel}>{labelPrefix}Quality</span>
        <select
          id={`${id}-quality`}
          value={quality}
          onChange={(e) => {
            const next = qualities.find((q) => q === e.target.value);
            if (next) onChange({ quality: next });
          }}
        >
          {groupQualities(qualities).map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.qualities.map((q) => <option key={q} value={q}>{qualityLabel(q)}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
