// @vitest-environment jsdom
/**
 * Upload page boundary guard — S13 / OB-csv.
 *
 * The dropzone's `accept` attribute is advisory only (drag-and-drop bypasses
 * it entirely), so the page itself must validate the dropped file's type
 * before parsing/hashing, advertise the real accept list (.xlsx,.csv), and
 * not promise "any format" in the lead copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import OnboardingUploadPage from "@/app/[farmSlug]/onboarding/upload/page";

const h = vi.hoisted(() => ({
  pushMock: vi.fn(),
  setParsedFileMock: vi.fn(),
  setProposalMock: vi.fn(),
  parseSpreadsheetMock: vi.fn(),
  hashFileMock: vi.fn(),
  dropzoneProps: {
    onFile: null as ((file: File) => void) | null,
    accept: undefined as string | undefined,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.pushMock }),
  useParams: () => ({ farmSlug: "demo-farm" }),
}));

vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({
    setParsedFile: h.setParsedFileMock,
    setProposal: h.setProposalMock,
  }),
}));

vi.mock("@/components/onboarding/StepShell", () => ({
  StepShell: ({
    children,
    lead,
  }: {
    children: React.ReactNode;
    lead: React.ReactNode;
  }) => (
    <div>
      <div data-testid="lead">{lead}</div>
      {children}
    </div>
  ),
}));

vi.mock("@/components/onboarding/TemplateFallback", () => ({
  TemplateFallback: ({ reason }: { reason: Record<string, unknown> }) => (
    <div data-testid="fallback">{JSON.stringify(reason)}</div>
  ),
}));

vi.mock("@/components/onboarding/FileDropzone", () => ({
  FileDropzone: ({
    onFile,
    accept,
  }: {
    onFile: (file: File) => void;
    accept?: string;
  }) => {
    h.dropzoneProps.onFile = onFile;
    h.dropzoneProps.accept = accept;
    return <div data-testid="dropzone" />;
  },
}));

vi.mock("@/lib/onboarding/parse-file", () => ({
  parseSpreadsheet: h.parseSpreadsheetMock,
  hashFile: h.hashFileMock,
}));

const PARSED_FIXTURE = {
  parsedColumns: ["Ear Tag", "Sex"],
  sampleRows: [{ "Ear Tag": "A001", Sex: "Female" }],
  fullRowCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.dropzoneProps.onFile = null;
  h.dropzoneProps.accept = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OnboardingUploadPage — file-type boundary (S13 / OB-csv)", () => {
  it("advertises .xlsx and .csv in the dropzone accept list", () => {
    render(<OnboardingUploadPage />);
    expect(h.dropzoneProps.accept).toBe(".xlsx,.csv");
  });

  it("rejects an unsupported file with a clear message and never parses it", async () => {
    render(<OnboardingUploadPage />);
    const png = new File([new Uint8Array([0x89, 0x50])], "photo.png", {
      type: "image/png",
    });

    await act(async () => {
      h.dropzoneProps.onFile!(png);
    });

    const fallback = screen.getByTestId("fallback");
    expect(fallback.textContent).toContain("validation-error");
    expect(fallback.textContent).toMatch(/\.xlsx/);
    expect(fallback.textContent).toMatch(/\.csv/);
    expect(h.parseSpreadsheetMock).not.toHaveBeenCalled();
    expect(h.hashFileMock).not.toHaveBeenCalled();
  });

  it("accepts a .csv file (case-insensitive) into the parse pipeline", async () => {
    h.parseSpreadsheetMock.mockResolvedValue(PARSED_FIXTURE);
    h.hashFileMock.mockResolvedValue("ab".repeat(32));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ proposal: { mapping: [] } }),
      }),
    );

    render(<OnboardingUploadPage />);
    const csv = new File(["Ear Tag,Sex\nA001,Female\n"], "HERD.CSV", {
      type: "text/csv",
    });

    await act(async () => {
      h.dropzoneProps.onFile!(csv);
    });

    await waitFor(() => {
      expect(h.pushMock).toHaveBeenCalledWith("/demo-farm/onboarding/mapping");
    });
    expect(h.parseSpreadsheetMock).toHaveBeenCalledWith(csv);
    expect(screen.queryByTestId("fallback")).not.toBeInTheDocument();
  });

  it("no longer promises that any format is fine", () => {
    render(<OnboardingUploadPage />);
    const lead = screen.getByTestId("lead");
    expect(lead.textContent).not.toMatch(/any format is fine/i);
    expect(lead.textContent).toMatch(/\.xlsx/);
    expect(lead.textContent).toMatch(/csv/i);
  });
});
