// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, useState, useEffect, type ReactNode } from "react";
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
    render(createElement(AssistantNameProvider, { name: null }, createElement(Probe)));
    expect(screen.getByTestId("name").textContent).toBe("Einstein");
  });

  it("returns the default when the provider is given whitespace", () => {
    render(createElement(AssistantNameProvider, { name: "   " }, createElement(Probe)));
    expect(screen.getByTestId("name").textContent).toBe("Einstein");
  });
});

describe("useAssistantName — custom names", () => {
  it("returns the custom name when provided", () => {
    render(createElement(AssistantNameProvider, { name: "Oupa" }, createElement(Probe)));
    expect(screen.getByTestId("name").textContent).toBe("Oupa");
  });

  it("trims surrounding whitespace on the stored name", () => {
    render(
      createElement(AssistantNameProvider, { name: "  Boerkloof  " }, createElement(Probe)),
    );
    expect(screen.getByTestId("name").textContent).toBe("Boerkloof");
  });
});

describe("useAssistantName — live re-render", () => {
  it("re-renders when the provider's name changes (rename flow)", () => {
    // Host exposes setState via a stable container object. The setter is
    // placed into the container inside useEffect (after render) so no
    // ref mutation occurs during the render phase (satisfies
    // react-hooks/immutability). useState setters are stable across
    // renders so reading container.set after mount always works.
    const container: { set: (v: string) => void } = { set: () => {} };
    function Host({ children }: { children: ReactNode }) {
      const [name, setN] = useState("Einstein");
      useEffect(() => { container.set = setN; });
      return createElement(AssistantNameProvider, { name }, children);
    }

    render(createElement(Host, {}, createElement(Probe)));
    expect(screen.getByTestId("name").textContent).toBe("Einstein");

    act(() => {
      container.set("Boerkloof");
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
