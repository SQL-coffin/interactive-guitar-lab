import { ROOT_OPTIONS } from "@/lib/roots";

/** Every root spelling offered in the progression selects (sharps and flats). */
export const ROOT_SPELLINGS: readonly string[] = ROOT_OPTIONS.flatMap((option) =>
  option.sharp === option.flat ? [option.sharp] : [option.sharp, option.flat],
);
