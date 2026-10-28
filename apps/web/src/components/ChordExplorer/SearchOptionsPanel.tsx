import { useId } from "react";
import { stringLabel } from "@/lib/strings";
import { DEFAULT_CONSTRAINTS, type SearchConstraints } from "@/state/explorerState";
import styles from "./ChordExplorer.module.css";

interface SearchOptionsPanelProps {
  constraints: SearchConstraints;
  stringCount: number;
  openStringNames: ReadonlyMap<number, string>;
  onChange: (patch: Partial<SearchConstraints>) => void;
  onReset: () => void;
}

const MAX_FRET_CHOICES = [5, 7, 9, 12, 15];
const LIMIT_CHOICES = [12, 24, 48];

export function SearchOptionsPanel({ constraints, stringCount, openStringNames, onChange, onReset }: SearchOptionsPanelProps) {
  const id = useId();
  const isDefault = JSON.stringify(constraints) === JSON.stringify(DEFAULT_CONSTRAINTS);
  // High string first, matching the fretboard.
  const strings = Array.from({ length: stringCount }, (_, i) => stringCount - i);

  return (
    <fieldset className={styles.options}>
      <legend className={styles.label}>Voicing constraints</legend>

      <div className={styles.field}>
        <label htmlFor={`${id}-maxFret`}>Highest fret</label>
        <select
          id={`${id}-maxFret`}
          value={constraints.maxFret}
          onChange={(e) => onChange({ maxFret: Number(e.target.value) })}
        >
          {MAX_FRET_CHOICES.map((fret) => <option key={fret} value={fret}>{fret}</option>)}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-span`}>
          Max fret span <output htmlFor={`${id}-span`} className={styles.output}>{constraints.maxFretSpan}</output>
        </label>
        <input
          id={`${id}-span`}
          type="range"
          min={1}
          max={6}
          step={1}
          value={constraints.maxFretSpan}
          onChange={(e) => onChange({ maxFretSpan: Number(e.target.value) })}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-minNotes`}>
          Min strings sounded <output htmlFor={`${id}-minNotes`} className={styles.output}>{constraints.minNotes}</output>
        </label>
        <input
          id={`${id}-minNotes`}
          type="range"
          min={1}
          max={stringCount}
          step={1}
          value={constraints.minNotes}
          onChange={(e) => onChange({ minNotes: Number(e.target.value) })}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-rootString`}>Root on string</label>
        <select
          id={`${id}-rootString`}
          value={constraints.rootString ?? ""}
          onChange={(e) => onChange({ rootString: e.target.value === "" ? null : Number(e.target.value) })}
        >
          <option value="">Any string</option>
          {strings.map((string) => (
            <option key={string} value={string}>{stringLabel(string, stringCount, openStringNames.get(string))}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor={`${id}-limit`}>Results</label>
        <select id={`${id}-limit`} value={constraints.limit} onChange={(e) => onChange({ limit: Number(e.target.value) })}>
          {LIMIT_CHOICES.map((limit) => <option key={limit} value={limit}>Top {limit}</option>)}
        </select>
      </div>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={constraints.requireAllTones}
          onChange={(e) => onChange({ requireAllTones: e.target.checked })}
        />
        <span>Require every chord tone</span>
      </label>

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={constraints.allowOpenStrings}
          onChange={(e) => onChange({ allowOpenStrings: e.target.checked })}
        />
        <span>Allow open strings</span>
      </label>

      <button type="button" className={styles.reset} onClick={onReset} disabled={isDefault}>
        Reset constraints
      </button>
    </fieldset>
  );
}
