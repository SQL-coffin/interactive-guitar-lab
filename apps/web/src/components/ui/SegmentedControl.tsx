import { useId } from "react";
import styles from "./ui.module.css";

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hideLabel?: boolean;
}

/** A radio group styled as a segmented button row; arrow keys work natively. */
export function SegmentedControl<T extends string>({ label, value, options, onChange, hideLabel }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className={styles.segmented}>
      <legend className={hideLabel ? "visually-hidden" : styles.fieldLabel}>{label}</legend>
      <div className={styles.segmentedTrack}>
        {options.map((option) => (
          <label key={option.value} className={styles.segment} data-checked={option.value === value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
