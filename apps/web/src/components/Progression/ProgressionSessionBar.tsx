"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useLab } from "@/state/lab/LabSessionProvider";
import { Button } from "@/components/ui/Button";
import styles from "./Progression.module.css";

/** Which progression is active, where it came from, and whether it is saved. */
export function ProgressionSessionBar() {
  const id = useId();
  const { draft, sessions, savedProgressions, saveProgression, openProgression, newProgression, deleteProgression, storage } = useLab();
  const [name, setName] = useState(draft.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(draft.name), [draft.name]);
  const source = draft.sessionId ? sessions.find((s) => s.id === draft.sessionId) : undefined;
  const hasChords = draft.progression.slots.length > 0;
  const confirmDiscard = () => !draft.dirty || !hasChords || window.confirm(`Discard unsaved changes to “${draft.name}”?`);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveProgression(name);
    } catch {
      setError("The progression could not be saved to browser storage.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.sessionBar} aria-label="Active progression">
      <div className={styles.sessionMain}>
        <label htmlFor={`${id}-name`} className={styles.pickerLabel}>Progression name</label>
        <input
          id={`${id}-name`}
          className={styles.nameInput}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <p className={styles.sessionMeta}>
          {draft.sessionId ? (
            source ? (
              <>From analysis <Link href="/audio">{source.filename}</Link> · </>
            ) : (
              <>From an analysis that is no longer saved · </>
            )
          ) : null}
          {draft.dirty && hasChords
            ? <strong className={styles.unsaved}>Unsaved changes</strong>
            : draft.lastSavedAt
              ? `Saved ${new Date(draft.lastSavedAt).toLocaleString()}`
              : hasChords ? "Not saved yet" : "Empty"}
        </p>
        {error ? <p className={styles.slotError} role="alert">{error}</p> : null}
      </div>
      <div className={styles.sessionActions}>
        <Button
          variant="primary"
          disabled={!hasChords || !storage.ready || saving || (!draft.dirty && name.trim() === draft.name)}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save progression"}
        </Button>
        <Button variant="ghost" disabled={!hasChords} onClick={() => confirmDiscard() && newProgression()}>New</Button>
      </div>
      {savedProgressions.length > 0 ? (
        <details className={styles.savedList}>
          <summary>Saved progressions ({savedProgressions.length})</summary>
          <ul>
            {savedProgressions.map((saved) => (
              <li key={saved.id} data-active={saved.id === draft.savedId}>
                <span className={styles.savedName}>{saved.name}</span>
                <span className={styles.sessionMeta}>{saved.chordCount} chords · {new Date(saved.updatedAt).toLocaleString()}</span>
                {saved.id === draft.savedId ? (
                  <span className={styles.activeBadge}>Active</span>
                ) : (
                  <Button size="sm" onClick={() => confirmDiscard() && void openProgression(saved.id)} aria-label={`Open progression ${saved.name}`}>Open</Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete progression ${saved.name}`}
                  onClick={() => window.confirm(`Delete “${saved.name}”?`) && void deleteProgression(saved.id)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
