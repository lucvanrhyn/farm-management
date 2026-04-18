// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MappingRow } from "@/components/onboarding/MappingRow";
import type { ProposalResult } from "@/lib/onboarding/adaptive-import";

type ProposalMapping = ProposalResult["proposal"]["mapping"][number];

const TARGET_OPTIONS = [
  { value: "earTag", label: "Ear Tag" },
  { value: "sex", label: "Sex" },
  { value: "birthDate", label: "Birth Date" },
  { value: "__ignored__", label: "Ignore" },
];

function buildMapping(overrides: Partial<ProposalMapping> = {}): ProposalMapping {
  return {
    source: "Oormerk",
    target: "earTag",
    confidence: 0.95,
    ...overrides,
  };
}

describe("MappingRow", () => {
  it("renders source column name and up to 3 sample values", () => {
    render(
      <MappingRow
        mapping={buildMapping()}
        sampleValues={["A001", "A002", "A003", "A004", "A005"]}
        effectiveTarget="earTag"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={() => {}}
        ignored={false}
      />,
    );

    expect(screen.getByText("Oormerk")).toBeInTheDocument();
    // Exactly 3 sample values rendered.
    const samples = screen.getByText(/e\.g\./);
    expect(samples.textContent).toContain("A001");
    expect(samples.textContent).toContain("A002");
    expect(samples.textContent).toContain("A003");
    expect(samples.textContent).not.toContain("A004");
  });

  it("calls onTargetChange when select value changes", () => {
    const onTargetChange = vi.fn();
    render(
      <MappingRow
        mapping={buildMapping()}
        sampleValues={["A001"]}
        effectiveTarget="earTag"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={onTargetChange}
        onIgnore={() => {}}
        ignored={false}
      />,
    );

    const select = screen.getByLabelText(/Target field for Oormerk/i);
    fireEvent.change(select, { target: { value: "sex" } });

    expect(onTargetChange).toHaveBeenCalledWith("sex");
  });

  it("calls onIgnore when the Ignore button is clicked", () => {
    const onIgnore = vi.fn();
    render(
      <MappingRow
        mapping={buildMapping()}
        sampleValues={[]}
        effectiveTarget="earTag"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={onIgnore}
        ignored={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Ignore/i }));
    expect(onIgnore).toHaveBeenCalledTimes(1);
  });

  it("reduces opacity and disables select when ignored", () => {
    const { container } = render(
      <MappingRow
        mapping={buildMapping()}
        sampleValues={["A001"]}
        effectiveTarget="earTag"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={() => {}}
        ignored={true}
      />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.opacity).toBe("0.5");
    expect(screen.getByLabelText(/Target field for Oormerk/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /Un-ignore/i })).toBeInTheDocument();
  });

  it("shows transform hint when mapping.transform is present", () => {
    render(
      <MappingRow
        mapping={buildMapping({ transform: "m→Male, v→Female" })}
        sampleValues={[]}
        effectiveTarget="sex"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={() => {}}
        ignored={false}
      />,
    );

    expect(screen.getByText(/Transform/)).toBeInTheDocument();
    expect(screen.getByText(/m→Male, v→Female/)).toBeInTheDocument();
  });

  it("shows fuzzy match list when mapping.fuzzy_matches non-empty", () => {
    render(
      <MappingRow
        mapping={buildMapping({
          fuzzy_matches: [
            { source_value: "Kamp A", camp_id: "camp-a" },
            { source_value: "Kamp B", camp_id: "camp-b" },
          ],
        })}
        sampleValues={[]}
        effectiveTarget="campId"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={() => {}}
        ignored={false}
      />,
    );

    expect(screen.getByText(/Fuzzy matches/i)).toBeInTheDocument();
    expect(screen.getByText(/Kamp A → camp-a/)).toBeInTheDocument();
    expect(screen.getByText(/Kamp B → camp-b/)).toBeInTheDocument();
  });

  it("shows approximate warning when mapping.approximate is true", () => {
    render(
      <MappingRow
        mapping={buildMapping({ approximate: true })}
        sampleValues={[]}
        effectiveTarget="birthDate"
        targetOptions={TARGET_OPTIONS}
        onTargetChange={() => {}}
        onIgnore={() => {}}
        ignored={false}
      />,
    );

    expect(screen.getByText(/Approximate values/i)).toBeInTheDocument();
  });
});
