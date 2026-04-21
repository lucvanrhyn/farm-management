// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, useState, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  AssistantNameProvider,
  DEFAULT_ASSISTANT_NAME,
  normalizeAssistantName,
  useAssistantName,
} from "@/hooks/useAssistantName";

/**
 * Tiny probe component that renders the hook's value to a test-id so
 * spec bodies can assert on the visible wordmark without repeating
 * render plumbing.
 */
function Probe() {
  const name = useAssistantName();
  return createElement("span", { "data-testid": "name" }, name);
}

afterEach(() => {
  cleanup();
});

describe("useAssistantName — default fallback", () => {
  it("returns 'Einstein' when no provider wraps the component", () => {
    render(createElement(Probe));
    expect(screen.getByTestId("name").textContent).toBe(DEFAULT_ASSISTANT_NAME);
    expect(DEFAULT_ASSISTANT_NAME).toBe("Einstein");
  });

  it("returns the default when the provider is given a null name", () => {
    render(
      createElement(AssistantNameProvider, {
        name: null,
        children: createElement(Probe),
      }),
    );
    expect(screen.getByTestId("name").textContent).toBe("Einstein");
  });

  it("returns the default when the provider is given whitespace", () => {
    render(
      createElement(AssistantNameProvider, {
        name: "   ",
        children: createElement(Probe),
      }),
    );
    expect(screen.getByTestId("name").textContent).toBe("Einstein");
  });
});

describe("useAssistantName — custom names", () => {
  it("returns the custom name when provided", () => {
    render(
      createElement(AssistantNameProvider, {
        name: "Oupa",
        children: createElement(Probe),
      }),
    );
    expect(screen.getByTestId("name").textContent).toBe("Oupa");
  });

  it("trims surrounding whitespace on the stored name", () => {
    render(
      createElement(AssistantNameProvider, {
        name: "  Boerkloof  ",
        children: createElement(Probe),
      }),
    );
    expect(screen.getByTestId("name").textContent).toBe("Boerkloof");
  });
});

describe("useAssistantName — live re-render", () => {
  it("re-renders when the provider's name changes (rename flow)", () => {
    // Host wires a state holder so we can flip the name after mount,
    // mirroring Wave 3's rename editor calling setState on the layout.
    let setName: (v: string) => void = () => {};
    function Host({ children }: { children: ReactNode }) {
      const [name, setN] = useState("Einstein");
      setName = setN;
      return createElement(AssistantNameProvider, { name, children });
    }

    render(createElement(Host, { children: createElement(Probe) }));
    expect(screen.getByTestId("name").textContent).toBe("Einstein");

    act(() => {
      setName("Boerkloof");
    });
    expect(screen.getByTestId("name").textContent).toBe("Boerkloof");
  });
});

describe("normalizeAssistantName", () => {
  it("returns the default for non-string values", () => {
    expect(normalizeAssistantName(undefined)).toBe("Einstein");
    expect(normalizeAssistantName(null)).toBe("Einstein");
  });

  it("returns the default for empty / whitespace strings", () => {
    expect(normalizeAssistantName("")).toBe("Einstein");
    expect(normalizeAssistantName("   \t\n")).toBe("Einstein");
  });

  it("returns the trimmed name for valid strings", () => {
    expect(normalizeAssistantName("Oupa")).toBe("Oupa");
    expect(normalizeAssistantName("  Oupa  ")).toBe("Oupa");
  });
});
