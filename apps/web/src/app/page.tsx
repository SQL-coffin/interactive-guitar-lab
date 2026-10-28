import { Suspense } from "react";
import { ExplorerFromQuery } from "@/components/ExplorerFromQuery";
import { LoadingState } from "@/components/ui/StatusMessage";

export default function ChordExplorerPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading chord explorer…" />}>
      <ExplorerFromQuery />
    </Suspense>
  );
}
