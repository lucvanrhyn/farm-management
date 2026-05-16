// @vitest-environment jsdom
/**
 * Wave 285 (PRD #279) — CalvingForm "Record Birth" submit gating.
 *
 * Root cause: `components/logger/CalvingForm.tsx` enforced the required
 * calf ear tag only via an `alert()` inside `submit()`. The submit button
 * had no `disabled` prop, so a bad record still enqueued offline / from a
 * stale client.
 *
 * Contract this test pins:
 *   1. "Record Birth" is visibly disabled (`disabled` attribute) at mount
 *      when the calf ear tag is empty.
 *   2. Clicking the disabled button does NOT call onSubmit.
 *   3. Once a calf ear tag is entered, the button enables and onSubmit
 *      fires with the trimmed calf id.
 *   4. Whitespace-only tag keeps it disabled (the alert-era trim check is
 *      now structural).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/logger/PhotoCapture', () => ({
  __esModule: true,
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

vi.mock('@/lib/offline-store', () => ({
  getCachedFarmSettings: vi.fn().mockResolvedValue(null),
}));

afterEach(() => {
  cleanup();
});

async function renderForm(onSubmit = vi.fn()) {
  const { default: CalvingForm } = await import('@/components/logger/CalvingForm');
  render(
    <CalvingForm
      animalId="COW-001"
      campId="CAMP-1"
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

describe('CalvingForm — submit gating (#285)', () => {
  it('disables "Record Birth" at mount when calf ear tag is empty', async () => {
    await renderForm();
    const submit = screen.getByRole('button', {
      name: /record birth/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('clicking the disabled button does not call onSubmit', async () => {
    const onSubmit = await renderForm();
    const submit = screen.getByRole('button', { name: /record birth/i });
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('enables once a calf ear tag is entered and submits the trimmed id', async () => {
    const onSubmit = await renderForm();
    const input = screen.getByPlaceholderText(/T-2024-001/i);
    fireEvent.change(input, { target: { value: '  CALF-2026-001  ' } });

    const submit = screen.getByRole('button', {
      name: /record birth/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].calfAnimalId).toBe('CALF-2026-001');
  });

  it('keeps disabled for a whitespace-only tag', async () => {
    await renderForm();
    const input = screen.getByPlaceholderText(/T-2024-001/i);
    fireEvent.change(input, { target: { value: '   ' } });
    const submit = screen.getByRole('button', {
      name: /record birth/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
