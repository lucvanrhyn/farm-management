// @vitest-environment jsdom
/**
 * FileDropzone accept affordance — S13 / OB-csv.
 *
 * The dropzone's default `accept` must track what the spreadsheet pipeline
 * actually parses (SPREADSHEET_ACCEPT from lib/xlsx-shim), not a hardcoded
 * ".xlsx". The onboarding import page renders <FileDropzone /> without an
 * explicit accept — with a hardcoded default it would advertise .xlsx-only
 * while its parse path (readWorkbook) happily accepts the CSV the user
 * uploaded one step earlier.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileDropzone } from "@/components/onboarding/FileDropzone";
import { SPREADSHEET_ACCEPT } from "@/lib/xlsx-shim";

function getHiddenInput(): HTMLInputElement {
  const dropzone = screen.getByRole("button", {
    name: /drop or select a spreadsheet file/i,
  });
  const input = dropzone.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("hidden file input not rendered");
  }
  return input;
}

describe("FileDropzone — accept list (S13 / OB-csv)", () => {
  it("defaults to the pipeline-wide SPREADSHEET_ACCEPT (.xlsx + .csv)", () => {
    render(<FileDropzone onFile={() => undefined} />);
    expect(getHiddenInput().accept).toBe(SPREADSHEET_ACCEPT);
    expect(SPREADSHEET_ACCEPT).toBe(".xlsx,.csv");
  });

  it("renders the accept list as the format chip", () => {
    render(<FileDropzone onFile={() => undefined} />);
    expect(screen.getByText(".xlsx · .csv")).toBeInTheDocument();
  });

  it("honours an explicit accept override", () => {
    render(<FileDropzone onFile={() => undefined} accept=".xlsx" />);
    expect(getHiddenInput().accept).toBe(".xlsx");
  });
});
