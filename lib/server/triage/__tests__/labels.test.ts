import { describe, it, expect } from "vitest";
import {
  reasonLabel,
  reasonCategory,
  unlockHint,
  SNAPSHOT_REASON_IDS,
  HISTORY_REASON_IDS,
  ALL_REASON_IDS,
} from "../labels";
import { REASON_IDS } from "../reasons";

describe("triage labels", () => {
  it("gives every registered reason a non-empty human label", () => {
    for (const id of REASON_IDS) {
      expect(reasonLabel(id).length).toBeGreaterThan(0);
    }
  });

  it("partitions every reason into exactly one of snapshot or history", () => {
    const snapshot = new Set<string>(SNAPSHOT_REASON_IDS);
    const history = new Set<string>(HISTORY_REASON_IDS);
    for (const id of REASON_IDS) {
      const inSnapshot = snapshot.has(id);
      const inHistory = history.has(id);
      // exactly one
      expect(inSnapshot !== inHistory).toBe(true);
      expect(reasonCategory(id)).toBe(inSnapshot ? "snapshot" : "history");
    }
    // union covers the whole registry
    expect(snapshot.size + history.size).toBe(REASON_IDS.length);
  });

  it("ALL_REASON_IDS mirrors the registry order", () => {
    expect(ALL_REASON_IDS).toEqual(REASON_IDS);
  });

  it("gives every history reason an unlock hint", () => {
    for (const id of HISTORY_REASON_IDS) {
      expect(unlockHint(id).length).toBeGreaterThan(0);
    }
  });
});
