import type { ChordQuality } from "@/services";

const QUALITY_LABELS: Partial<Record<ChordQuality, string>> = {
  major: "Major",
  minor: "Minor",
  dominant7: "Dominant 7",
  major7: "Major 7",
  minor7: "Minor 7",
  sus4: "Sus 4",
};

/** Falls back to the raw id so qualities added by the backend still render. */
export function qualityLabel(quality: ChordQuality): string {
  return QUALITY_LABELS[quality] ?? quality;
}
