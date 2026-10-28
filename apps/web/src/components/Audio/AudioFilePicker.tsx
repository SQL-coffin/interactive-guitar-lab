import { useId, useRef, useState, type DragEvent } from "react";
import { formatBytes } from "@/lib/audioTimeline";
import { MAX_AUDIO_BYTES } from "@/state/useAudioAnalysis";
import styles from "./Audio.module.css";

interface AudioFilePickerProps {
  file: File | null;
  disabled?: boolean;
  onFile: (file: File) => void;
}

/** File input with drag-and-drop; the native input stays the accessible control. */
export function AudioFilePicker({ file, disabled, onFile }: AudioFilePickerProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped && !disabled) onFile(dropped);
  };

  return (
    <div
      className={styles.dropzone}
      data-dragging={dragging}
      data-disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff"
        className="visually-hidden"
        disabled={disabled}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen) onFile(chosen);
          event.target.value = "";
        }}
      />
      <svg className={styles.dropIcon} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
        <path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
        <circle cx="16.5" cy="16" r="2.5" fill="currentColor" />
      </svg>
      {file ? (
        <p className={styles.dropTitle}>
          {file.name} <span className={styles.dropMeta}>· {formatBytes(file.size)}</span>
        </p>
      ) : (
        <p className={styles.dropTitle}>Drop an audio file here</p>
      )}
      <p className={styles.dropMeta}>
        WAV is the baseline format; other formats depend on the server&rsquo;s decoders. Up to {formatBytes(MAX_AUDIO_BYTES)} and 10 minutes.
      </p>
      <label htmlFor={id} className={styles.browse} aria-disabled={disabled}>
        {file ? "Choose a different file" : "Choose audio file"}
      </label>
    </div>
  );
}
