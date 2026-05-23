// @vitest-environment jsdom
/**
 * __tests__/components/animal-checklist-layout.test.tsx
 *
 * Wave 262 — Mobile animal-ID overlap with action labels.
 *
 * Bug class fixed: each checklist row was a single horizontal flex
 * (`flex items-center gap-3`) with the action cluster `shrink-0` and
 * the ID/chip column `flex-1 min-w-0`. With 7 cattle action buttons at
 * `min-w-[44px]` the right cluster reserved ~332px on a 390px viewport,
 * leaving ~14px for the ID+chips column. Result: the ID literally
 * overlapped the action labels (issue #262).
 *
 * Contract this test pins:
 *
 *   1. The row root is `flex-col sm:flex-row` — the row stacks
 *      vertically below the Tailwind `sm` breakpoint (640px) and only
 *      becomes side-by-side on tablets+.
 *
 *   2. The action cluster carries `overflow-x-auto` so even if more
 *      buttons are added on a narrow viewport the row scrolls
 *      horizontally instead of clipping (the original z-index manifested
 *      as visual overlap because the cluster could not be scrolled).
 *
 *   3. The ID + category chip remain in DOM order before the action
 *      cluster so screen readers + keyboard tab order stay sensible.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

// Stubbed Animal — the component only reads `animal_id`, `category`, `name`
// for the row layout assertions.
const ANIMALS = [
  { animal_id: 'X026', category: 'Cow' as const, name: 'Bessie' },
  { animal_id: 'X027', category: 'Heifer' as const, name: null },
];

describe('AnimalChecklist row layout (#262)', () => {
  it('row root stacks vertically below sm breakpoint and side-by-side at sm+', async () => {
    const { default: AnimalChecklist } = await import(
      '@/components/logger/AnimalChecklist'
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
      />,
    );

    const rows = container.querySelectorAll('[data-animal-row]');
    expect(rows.length).toBe(ANIMALS.length);
    rows.forEach((row) => {
      const cls = row.className;
      // Mobile: column. sm+: row.
      expect(cls).toMatch(/flex-col/);
      expect(cls).toMatch(/sm:flex-row/);
    });
  });

  it('action cluster is horizontally scrollable so buttons never overlap', async () => {
    const { default: AnimalChecklist } = await import(
      '@/components/logger/AnimalChecklist'
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
      />,
    );

    const actionStrips = container.querySelectorAll('[data-animal-actions]');
    expect(actionStrips.length).toBe(ANIMALS.length);
    actionStrips.forEach((strip) => {
      const cls = strip.className;
      expect(cls).toMatch(/overflow-x-auto/);
    });
  });

  it('ID/category column appears in DOM before the action cluster', async () => {
    const { default: AnimalChecklist } = await import(
      '@/components/logger/AnimalChecklist'
    );

    const { container } = render(
      <AnimalChecklist
        campId="camp-1"
        onFlag={vi.fn()}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        animals={ANIMALS as any}
      />,
    );

    const firstRow = container.querySelector('[data-animal-row]');
    expect(firstRow).not.toBeNull();
    const idCol = firstRow!.querySelector('[data-animal-id-col]');
    const actionStrip = firstRow!.querySelector('[data-animal-actions]');
    expect(idCol).not.toBeNull();
    expect(actionStrip).not.toBeNull();
    // compareDocumentPosition: bit 4 means `actionStrip` follows `idCol` in DOM order.
    expect(idCol!.compareDocumentPosition(actionStrip!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
