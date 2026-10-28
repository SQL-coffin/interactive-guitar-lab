import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/AppShell/AppHeader";
import { GuitarLabServiceProvider } from "@/state/ServiceContext";
import { LabSessionProvider } from "@/state/lab/LabSessionProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Guitar Theory Lab", template: "%s · Guitar Theory Lab" },
  description: "Interactive guitar fretboard, chord explorer, progression builder and audio chord analysis.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        <GuitarLabServiceProvider>
          {/* Lives above the routes, so analysis and progression state survive navigation. */}
          <LabSessionProvider>
            <AppHeader />
            <main id="main" className="page">{children}</main>
          </LabSessionProvider>
        </GuitarLabServiceProvider>
        <footer className="site-footer">
          Rankings and audio hypotheses are heuristics from the analysis engine, not guarantees. String numbers follow
          guitar convention (string 1 = highest pitch).
        </footer>
      </body>
    </html>
  );
}
