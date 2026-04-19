// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

// The main component imports client-only bits (useState/useEffect).
// parseDetails is a pure function on the same module — import only that.
import { parseDetails } from "@/components/admin/ObservationsLog";

describe("ObservationsLog.parseDetails", () => {
  it("humanises pregnancy_scan with result and scanner", () => {
    const raw = JSON.stringify({ result: "pregnant", scanner_name: "Dr Smith" });
    expect(parseDetails(raw, "pregnancy_scan")).toBe(
      "🤰 Pregnancy scan — pregnant — Scanner: Dr Smith",
    );
  });

  it("pregnancy_scan without scanner still renders", () => {
    const raw = JSON.stringify({ result: "empty" });
    expect(parseDetails(raw, "pregnancy_scan")).toBe("🤰 Pregnancy scan — empty");
  });

  it("humanises heat_detection with intensity", () => {
    const raw = JSON.stringify({ intensity: "strong" });
    expect(parseDetails(raw, "heat_detection")).toBe("❤️ Heat detected — strong");
  });

  it("humanises insemination with sire", () => {
    const raw = JSON.stringify({ method: "AI", sire_id: "BU-003" });
    expect(parseDetails(raw, "insemination")).toBe("💉 AI — Sire: BU-003");
  });

  it("humanises calving with outcome and calf id (cattle)", () => {
    const raw = JSON.stringify({ outcome: "Live calf", calf_id: "SK-159" });
    expect(parseDetails(raw, "calving")).toBe("👶 Calving — Live calf · Calf: SK-159");
  });

  it("humanises lambing with twin count (sheep)", () => {
    const raw = JSON.stringify({ twin_count: 2 });
    expect(parseDetails(raw, "lambing")).toBe("👶 Lambing — Twins: 2");
  });

  it("humanises fawning with species (game)", () => {
    const raw = JSON.stringify({ species: "Impala", fawn_count: 1 });
    expect(parseDetails(raw, "fawning")).toBe("👶 Fawning — Species: Impala · Fawns: 1");
  });

  it("humanises weighing with kg and method", () => {
    const raw = JSON.stringify({ weight_kg: 425, method: "scale" });
    expect(parseDetails(raw, "weighing")).toBe("⚖️ 425 kg — Method: scale");
  });

  it("weighing without method omits the suffix", () => {
    const raw = JSON.stringify({ weight_kg: 300 });
    expect(parseDetails(raw, "weighing")).toBe("⚖️ 300 kg");
  });

  it("humanises treatment with product and withdrawal", () => {
    const raw = JSON.stringify({
      treatmentType: "Antibiotic",
      product: "Terramycin",
      withdrawalDays: 21,
    });
    expect(parseDetails(raw, "treatment")).toBe(
      "💊 Antibiotic — Product: Terramycin — Withdrawal: 21d",
    );
  });

  it("humanises health_issue with severity", () => {
    const raw = JSON.stringify({ issue_type: "Lame", severity: "moderate" });
    expect(parseDetails(raw, "health_issue")).toBe("🩺 Lame — Severity: moderate");
  });

  it("health_issue falls back to symptoms array", () => {
    const raw = JSON.stringify({ symptoms: ["Thin", "Not eating"], severity: "mild" });
    expect(parseDetails(raw, "health_issue")).toBe(
      "🩺 Thin, Not eating — Severity: mild",
    );
  });

  it("humanises camp_move (alias of animal_movement)", () => {
    const raw = JSON.stringify({ to_camp: "B-2" });
    expect(parseDetails(raw, "camp_move")).toBe("🔄 Moved to Camp B-2");
  });

  it("humanises animal_movement with src + dest", () => {
    const raw = JSON.stringify({
      animalId: "KO-015",
      sourceCampId: "A",
      destCampId: "B",
    });
    expect(parseDetails(raw, "animal_movement")).toBe("🔄 KO-015 moved: A → B");
  });

  it("humanises rainfall with mm", () => {
    const raw = JSON.stringify({ mm: 12 });
    expect(parseDetails(raw, "rainfall")).toBe("🌧️ 12 mm");
  });

  it("humanises shearing with wool kg", () => {
    const raw = JSON.stringify({ wool_kg: 4.2 });
    expect(parseDetails(raw, "shearing")).toBe("✂️ Shorn — Clip: 4.2 kg");
  });

  it("humanises predator_loss with species", () => {
    const raw = JSON.stringify({ predator_species: "Caracal", count: 1 });
    expect(parseDetails(raw, "predator_loss")).toBe(
      "🦁 Predator loss — Species: Caracal · Lost: 1",
    );
  });

  it("camp_condition summarises grazing/water/fence without raw JSON", () => {
    const raw = JSON.stringify({ grazingQuality: "Good", waterStatus: "Full", fenceStatus: "Intact" });
    expect(parseDetails(raw, "camp_condition")).toBe(
      "Grazing: Good · Water: Full · Fence: Intact",
    );
  });

  it("never returns raw JSON for a known unrecognised type — uses generic fallback", () => {
    const raw = JSON.stringify({ weight_kg: 99, product: "X" });
    const out = parseDetails(raw, "completely_new_type");
    // Must be a humanised summary, not the raw payload.
    expect(out).not.toContain("{");
    expect(out).toContain("Weight: 99kg");
    expect(out).toContain("Product: X");
  });

  it("handles malformed JSON by returning a truncated safe string", () => {
    const out = parseDetails("not json at all", "weighing");
    expect(out).toBe("not json at all");
  });

  it("handles empty object with a sensible fallback (not raw JSON)", () => {
    const raw = JSON.stringify({});
    const out = parseDetails(raw, "weighing");
    expect(out).toBe("⚖️ Weighing recorded");
  });

  // Silence unused-var warning for `vi` under strict TS
  it("vi is available as a test runner import", () => {
    expect(typeof vi).toBe("object");
  });
});
