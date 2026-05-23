// @vitest-environment jsdom
/**
 * Issue #321 (PRD #318 stress-test remediation, wave R4) —
 * CampConditionForm "Submit Camp Report" gating.
 *
 * Root cause: `components/logger/CampConditionForm.tsx` initialised
 * grazing="Good", water="Full", fence="Intact" and left "Submit Camp
 * Report" permanently enabled. A zero-interaction (or stale offline)
 * submit therefore persisted those pre-selected defaults as the farmer's
 * *answer* — a clean inspection indistinguishable from a deliberate
 * all-good one. The defaults were doing double duty as placeholders AND
 * answers.
 *
 * Contract this test pins:
 *   1. No option is pre-selected at mount (none of grazing/water/fence
 *      shows a chosen state).
 *   2. "Submit Camp Report" is `disabled` at mount.
 *   3. It stays disabled until ALL THREE of grazing, water and fence have
 *      been explicitly chosen.
 *   4. Clicking while disabled does not call onSubmit.
 *   5. Once all three are chosen the button enables and onSubmit fires
 *      with the explicit selections.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/logger/PhotoCapture', () => ({
  __esModule: true,
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

afterEach(() => {
  cleanup();
});

async function renderForm(onSubmit = vi.fn()) {
  const { default: CampConditionForm } = await import(
    '@/components/logger/CampConditionForm'
  );
  render(
    <CampConditionForm campId="CAMP-1" onClose={vi.fn()} onSubmit={onSubmit} />,
  );
  return onSubmit;
}

function submitButton() {
  return screen.getByRole('button', {
    name: /submit camp report/i,
  }) as HTMLButtonElement;
}

describe('CampConditionForm — submit gating (#321)', () => {
  it('disables "Submit Camp Report" at mount with zero selections', async () => {
    await renderForm();
    expect(submitButton().disabled).toBe(true);
  });

  it('clicking the disabled button does not call onSubmit', async () => {
    const onSubmit = await renderForm();
    fireEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('stays disabled until ALL THREE selections are made', async () => {
    await renderForm();

    fireEvent.click(screen.getByRole('button', { name: /good/i }));
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /low/i }));
    expect(submitButton().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /damaged/i }));
    expect(submitButton().disabled).toBe(false);
  });

  it('enables only once all three are chosen and submits the explicit selections', async () => {
    const onSubmit = await renderForm();

    fireEvent.click(screen.getByRole('button', { name: /poor/i }));
    fireEvent.click(screen.getByRole('button', { name: /empty/i }));
    fireEvent.click(screen.getByRole('button', { name: /intact/i }));

    const submit = submitButton();
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toMatchObject({
      campId: 'CAMP-1',
      grazing: 'Poor',
      water: 'Empty',
      fence: 'Intact',
    });
  });
});
