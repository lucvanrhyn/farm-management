// @vitest-environment jsdom
/**
 * __tests__/components/admin-page.test.tsx
 *
 * Unit tests for the <AdminPage> shell component.
 *
 * TDD RED → GREEN → REFACTOR for wave/22-layout-shell.
 *
 * Contract under test:
 *  - Renders children inside a root element with data-testid="admin-page-shell"
 *  - Root carries min-h-dvh (full-viewport-height on dynamic-height-aware browsers)
 *  - Root carries brand background class (bg-[#FAFAF8])
 *  - Accepts optional `header` slot rendered above children
 *  - Accepts optional `footer` slot rendered below children
 *  - Forwards extra className onto the root element
 *  - Does NOT throw when header/footer slots are omitted
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import AdminPage from "@/app/_components/AdminPage";

describe("<AdminPage />", () => {
  it("renders children inside data-testid=admin-page-shell", () => {
    render(
      <AdminPage>
        <p>child content</p>
      </AdminPage>,
    );
    const shell = screen.getByTestId("admin-page-shell");
    expect(shell).toBeInTheDocument();
    expect(shell).toHaveTextContent("child content");
  });

  it("root element has min-h-dvh class", () => {
    render(<AdminPage>content</AdminPage>);
    const shell = screen.getByTestId("admin-page-shell");
    expect(shell.className).toContain("min-h-dvh");
  });

  it("root element has brand background class", () => {
    render(<AdminPage>content</AdminPage>);
    const shell = screen.getByTestId("admin-page-shell");
    // The brand background is the warm off-white used across all admin surfaces.
    expect(shell.className).toContain("bg-[#FAFAF8]");
  });

  it("renders header slot above children when provided", () => {
    render(
      <AdminPage header={<header data-testid="page-header">My Header</header>}>
        <main data-testid="page-body">body</main>
      </AdminPage>,
    );
    const header = screen.getByTestId("page-header");
    const body = screen.getByTestId("page-body");
    expect(header).toBeInTheDocument();
    expect(body).toBeInTheDocument();

    // Header should come before body in the DOM tree.
    const shell = screen.getByTestId("admin-page-shell");
    const nodes = Array.from(shell.childNodes);
    const headerIndex = nodes.indexOf(header as unknown as ChildNode);
    const bodyIndex = nodes.indexOf(body as unknown as ChildNode);
    expect(headerIndex).toBeLessThan(bodyIndex);
  });

  it("renders footer slot below children when provided", () => {
    render(
      <AdminPage footer={<footer data-testid="page-footer">My Footer</footer>}>
        <main data-testid="page-body">body</main>
      </AdminPage>,
    );
    const footer = screen.getByTestId("page-footer");
    const body = screen.getByTestId("page-body");
    expect(footer).toBeInTheDocument();

    // Footer should come after body in the DOM tree.
    const shell = screen.getByTestId("admin-page-shell");
    const nodes = Array.from(shell.childNodes);
    const footerIndex = nodes.indexOf(footer as unknown as ChildNode);
    const bodyIndex = nodes.indexOf(body as unknown as ChildNode);
    expect(footerIndex).toBeGreaterThan(bodyIndex);
  });

  it("works fine when no header or footer slots are passed", () => {
    expect(() =>
      render(<AdminPage>standalone child</AdminPage>),
    ).not.toThrow();
    expect(screen.getByText("standalone child")).toBeInTheDocument();
  });

  it("merges extra className onto root element", () => {
    render(<AdminPage className="extra-class another-class">child</AdminPage>);
    const shell = screen.getByTestId("admin-page-shell");
    expect(shell.className).toContain("extra-class");
    expect(shell.className).toContain("another-class");
  });

  it("applies safe-area padding classes for mobile viewport insets", () => {
    render(<AdminPage>content</AdminPage>);
    const shell = screen.getByTestId("admin-page-shell");
    // Must honour iOS/Android safe-area via pb-safe or similar utility.
    // We check for the word "safe" being present somewhere in the class list
    // as the exact utility name may vary (pb-safe, pt-safe, px-safe-or-4, etc).
    expect(shell.className).toMatch(/safe/);
  });
});
