"use client";

import { useSearchParams } from "next/navigation";
import type { ChordQuality } from "@/services";
import { findRootOption } from "@/lib/roots";
import { GuitarLab } from "./GuitarLab";

/** Opens the explorer on ?root=&quality= (used by "Open in Chord Explorer"); ignores unknown roots. */
export function ExplorerFromQuery() {
  const params = useSearchParams();
  const root = params.get("root");
  const quality = params.get("quality") as ChordQuality | null;
  const validRoot = root && findRootOption(root) ? root : null;
  return <GuitarLab key={`${validRoot}:${quality}`} initialRoot={validRoot} initialQuality={validRoot ? quality : null} />;
}
