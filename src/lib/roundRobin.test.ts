import { describe, it, expect } from "vitest";
import { computeRoundCount } from "./roundRobin";

describe("computeRoundCount", () => {
  it("returns n-1 for an even roster, single round", () => {
    expect(computeRoundCount(4, "single")).toBe(3);
  });

  it("returns n for an odd roster, single round", () => {
    expect(computeRoundCount(5, "single")).toBe(5);
  });

  it("doubles the round count for double round type", () => {
    expect(computeRoundCount(4, "double")).toBe(6);
  });
});
