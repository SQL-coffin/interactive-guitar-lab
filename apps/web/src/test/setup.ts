import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// Components use the App Router; outside Next there is no router, so provide a minimal stand-in.
export const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// jsdom does not implement scrolling (node-environment test files have no DOM at all).
if (typeof Element !== "undefined") Element.prototype.scrollIntoView ??= function scrollIntoView() {};
