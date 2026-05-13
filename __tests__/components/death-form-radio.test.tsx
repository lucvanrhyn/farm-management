// @vitest-environment jsdom
/**
 * Wave 3b / #254 — DeathModal single-cause radio + required carcassDisposal.
 *
 * Contract this test pins (mirrors __tests__/components/repro-form-radio
 * patterns from PRD #253):
 *
 *   1. Cause picker is structurally a single-select radio:
 *      - The cause container has `role="radiogroup"`.
 *      - Each cause is `role="radio"` with `aria-checked` reflecting the
 *        currently-selected state.
 *      - Selecting cause B after cause A flips A's `aria-checked` to false
 *        (single-select invariant — the multi-cause data-loss bug class
 *        from PRD #250 cannot be re-introduced at the UX layer).
 *
 *   2. Carcass disposal is a required <select> with the four
 *      maintainer-locked enum values: BURIED, BURNED, RENDERED, OTHER.
 *
 *   3. Submit is BLOCKED until both cause and disposal have been chosen.
 *      The onSubmit callback never fires with a missing field.
 *
 *   4. On submit, onSubmit receives `{ cause, carcassDisposal }` — the
 *      shape consumed by the logger queue in
 *      `app/[farmSlug]/logger/[campId]/page.tsx` :: handleDeathSubmit.
 *
 * Without this contract, the server-side validator
 * (`lib/server/validators/death.ts`) has no UX-layer companion and the
 * defense-in-depth fix is single-layered.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

const CAUSES = ['Disease', 'Predator', 'Accident', 'Old age', 'Stillbirth', 'Other'];

describe('DeathModal — single-cause radio (#254)', () => {
  it('renders a radiogroup with one role=radio per cause', async () => {
    const { default: DeathModal } = await import('@/components/logger/DeathModal');

    render(
      <DeathModal
        isOpen
        animalId="COW-001"
        causes={CAUSES}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const group = screen.getByRole('radiogroup', { name: /cause of death/i });
    expect(group).toBeDefined();

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(CAUSES.length);
    // None checked at mount.
    for (const r of radios) {
      expect(r.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('checking cause B unchecks cause A (single-select invariant)', async () => {
    const { default: DeathModal } = await import('@/components/logger/DeathModal');

    render(
      <DeathModal
        isOpen
        animalId="COW-001"
        causes={CAUSES}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const disease = screen.getByRole('radio', { name: /^Disease$/i });
    const predator = screen.getByRole('radio', { name: /^Predator$/i });

    fireEvent.click(disease);
    expect(disease.getAttribute('aria-checked')).toBe('true');
    expect(predator.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(predator);
    expect(disease.getAttribute('aria-checked')).toBe('false');
    expect(predator.getAttribute('aria-checked')).toBe('true');
  });
});

describe('DeathModal — carcassDisposal select (#254)', () => {
  it('renders a required select with the four enum values', async () => {
    const { default: DeathModal } = await import('@/components/logger/DeathModal');

    render(
      <DeathModal
        isOpen
        animalId="COW-001"
        causes={CAUSES}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const select = screen.getByLabelText(/carcass disposal/i) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(select.required).toBe(true);

    const optionValues = Array.from(select.options)
      .map((o) => o.value)
      .filter((v) => v !== '');
    expect(optionValues.sort()).toEqual(['BURIED', 'BURNED', 'OTHER', 'RENDERED']);
  });
});

describe('DeathModal — submit gating (#254)', () => {
  it('does not call onSubmit until both cause AND disposal are set', async () => {
    const { default: DeathModal } = await import('@/components/logger/DeathModal');

    const onSubmit = vi.fn();
    render(
      <DeathModal
        isOpen
        animalId="COW-001"
        causes={CAUSES}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />,
    );

    const submit = screen.getByRole('button', { name: /record death/i });

    // Click submit with nothing selected → onSubmit must not fire.
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    // Pick a cause but no disposal → still blocked.
    fireEvent.click(screen.getByRole('radio', { name: /^Old age$/i }));
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    // Pick a disposal → now submit fires with the joint payload.
    fireEvent.change(screen.getByLabelText(/carcass disposal/i), {
      target: { value: 'BURIED' },
    });
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0]).toEqual({
      cause: 'Old age',
      carcassDisposal: 'BURIED',
    });
  });
});
