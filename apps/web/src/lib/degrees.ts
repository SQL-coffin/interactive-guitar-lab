export type DegreeFamily = "root" | "third" | "fifth" | "seventh" | "other";

/** Maps a degree label from the engine (e.g. "♭3", "7") to a colour family for display. */
export function degreeFamily(degree: string | undefined): DegreeFamily {
  const number = degree?.replace(/[^0-9]/g, "");
  switch (number) {
    case "1": return "root";
    case "3": return "third";
    case "5": return "fifth";
    case "7": return "seventh";
    default: return "other";
  }
}
