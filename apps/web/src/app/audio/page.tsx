import type { Metadata } from "next";
import { AudioAnalysis } from "@/components/Audio/AudioAnalysis";

export const metadata: Metadata = { title: "Audio analysis" };

export default function AudioPage() {
  return <AudioAnalysis />;
}
