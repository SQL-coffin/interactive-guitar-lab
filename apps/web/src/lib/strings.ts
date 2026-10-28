/**
 * The engine numbers strings 1..n from the LOWEST pitch (see docs/theory-decisions.md).
 * Guitarists number them from the highest pitch, so the UI converts only for display.
 */
export function conventionalStringNumber(engineString: number, stringCount: number): number {
  return stringCount - engineString + 1;
}

export function stringLabel(engineString: number, stringCount: number, openNoteName: string | undefined): string {
  const number = conventionalStringNumber(engineString, stringCount);
  const position = engineString === 1 ? "low " : engineString === stringCount ? "high " : "";
  return openNoteName ? `String ${number} (${position}${openNoteName})` : `String ${number}`;
}
