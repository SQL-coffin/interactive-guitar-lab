import type { ChordQuality } from "@/services";

const QUALITY_LABELS: Partial<Record<ChordQuality, string>> = {
  major: "Major",
  minor: "Minor",
  dominant7: "Dominant 7",
  major7: "Major 7",
  minor7: "Minor 7",
  sus4: "Sus 4",
  sus2: "Sus 2",
  augmented: "Augmented",
  diminished: "Diminished",
  add9: "Add 9",
};

/** Falls back to the raw id so qualities added by the backend still render. */
export function qualityLabel(quality: ChordQuality): string {
  return QUALITY_LABELS[quality] ?? quality;
}

export interface QualityGroup {
  id: "triads" | "sevenths" | "colour" | "other";
  label: string;
  qualities: ChordQuality[];
}

/** Display grouping only; which qualities exist is decided by GET /api/chords/qualities. */
const GROUP_ORDER: ReadonlyArray<{ id: QualityGroup["id"]; label: string; members: readonly string[] }> = [
  { id: "triads", label: "Triads", members: ["major", "minor", "diminished", "augmented"] },
  { id: "sevenths", label: "Seventh chords", members: ["dominant7", "major7", "minor7"] },
  { id: "colour", label: "Suspended & added", members: ["sus2", "sus4", "add9"] },
];

/**
 * Groups the qualities the backend returned. Known qualities appear in musical order within
 * their group; any quality this table does not know yet goes to "Other", in API order.
 * Empty groups are omitted.
 */
export function groupQualities(available: readonly ChordQuality[]): QualityGroup[] {
  const present = new Set(available);
  const known = new Set(GROUP_ORDER.flatMap((group) => group.members));
  const groups: QualityGroup[] = GROUP_ORDER.map((group) => ({
    id: group.id,
    label: group.label,
    qualities: group.members.filter((q): q is ChordQuality => present.has(q as ChordQuality)) as ChordQuality[],
  }));
  groups.push({ id: "other", label: "Other", qualities: available.filter((q) => !known.has(q)) });
  return groups.filter((group) => group.qualities.length > 0);
}
