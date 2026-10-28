import { describe, expect, it } from "vitest";
import { intervalFromDistance } from "./index.js";

describe("intervalFromDistance", () => {
  it("recognizes common major seventh and perfect fifth intervals", () => {
    expect(intervalFromDistance(7,11).abbreviation).toBe("M7");
    expect(intervalFromDistance(5,7).abbreviation).toBe("P5");
  });
  it("distinguishes major and minor thirds", () => {
    expect(intervalFromDistance(3,4).abbreviation).toBe("M3");
    expect(intervalFromDistance(3,3).abbreviation).toBe("m3");
  });
});
