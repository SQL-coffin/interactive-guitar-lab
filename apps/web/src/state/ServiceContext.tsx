"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createDefaultGuitarLabService, type GuitarLabService } from "@/services";

const ServiceContext = createContext<GuitarLabService | null>(null);

/** Injects the service so tests and stories can supply a fake. */
export function GuitarLabServiceProvider({ service, children }: { service?: GuitarLabService; children: ReactNode }) {
  const [resolved] = useState(() => service ?? createDefaultGuitarLabService());
  return <ServiceContext.Provider value={resolved}>{children}</ServiceContext.Provider>;
}

export function useGuitarLabService(): GuitarLabService {
  const service = useContext(ServiceContext);
  if (!service) throw new Error("useGuitarLabService must be used inside <GuitarLabServiceProvider>.");
  return service;
}
