import type { Metadata } from "next";
import { ProgressionBuilder } from "@/components/Progression/ProgressionBuilder";

export const metadata: Metadata = { title: "Progressions" };

export default function ProgressionsPage() {
  return <ProgressionBuilder />;
}
