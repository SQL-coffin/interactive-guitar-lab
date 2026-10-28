import { useId } from "react";
import { ROOT_OPTIONS, displaySpelling, findRootOption, spellRootOption, type SpellingPreference } from "@/lib/roots";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import styles from "./ChordExplorer.module.css";

interface RootSelectorProps {
  root: string;
  spelling: SpellingPreference;
  onRootChange: (root: string) => void;
  onSpellingChange: (spelling: SpellingPreference, root: string) => void;
}

export function RootSelector({ root, spelling, onRootChange, onSpellingChange }: RootSelectorProps) {
  const name = useId();
  const current = findRootOption(root);
  return (
    <div className={styles.group}>
      <div className={styles.groupHeader}>
        <span className={styles.label} id={`${name}-label`}>Root note</span>
        <SegmentedControl
          label="Accidental spelling"
          hideLabel
          value={spelling}
          options={[
            { value: "sharp", label: "♯" },
            { value: "flat", label: "♭" },
          ]}
          onChange={(next) => onSpellingChange(next, current ? spellRootOption(current, next) : root)}
        />
      </div>
      <div role="radiogroup" aria-labelledby={`${name}-label`} className={styles.rootGrid}>
        {ROOT_OPTIONS.map((option) => {
          const spelled = spellRootOption(option, spelling);
          const checked = option === current;
          const accidental = option.sharp !== option.flat;
          return (
            <label key={option.sharp} className={styles.rootTile} data-checked={checked} data-accidental={accidental}>
              <input type="radio" name={name} value={spelled} checked={checked} onChange={() => onRootChange(spelled)} />
              <span>{displaySpelling(spelled)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
