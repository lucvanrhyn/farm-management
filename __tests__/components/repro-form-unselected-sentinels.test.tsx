// @vitest-environment jsdom
/**
 * Wave 286 (PRD #279) — ReproductionForm unselected sentinels + submit gating.
 *
 * Root cause: `components/logger/ReproductionForm.tsx` pre-filled `useState`
 * defaults that read as the farmer's answer:
 *   - bcsScore=5, temperamentScore=1
 *   - insemMethod="AI", heatMethod="visual"
 *   - scanResult="pregnant"
 * Every sub-flow's submit was ungated, so a tap-through persisted a
 * fabricated default.
 *
 * Contract this test pins, per sub-flow:
 *   1. No option is visually selected at mount (no `aria-checked="true"`
 *      and no SELECTED_STYLE element) — explicit unselected sentinel.
 *   2. Submit is disabled until a valid option is actively chosen.
 *   3. Submit fires once the required value is chosen, with the chosen value.
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

async function openSubFlow(label: RegExp, onSubmit = vi.fn()) {
  const { default: ReproductionForm } = await import(
    '@/components/logger/ReproductionForm'
  );
  render(
    <ReproductionForm
      animalId="COW-001"
      animalSex="Female"
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  // Step 1 → pick the event type.
  fireEvent.click(screen.getByRole('button', { name: label }));
  return onSubmit;
}

describe('ReproductionForm — heat detection sentinel + gating', () => {
  it('no method preselected; Record Heat disabled until chosen', async () => {
    const onSubmit = await openSubFlow(/Heat \/ Oestrus/i);

    const radios = screen.getAllByRole('radio');
    for (const r of radios) {
      expect(r.getAttribute('aria-checked')).toBe('false');
    }

    const submit = screen.getByRole('button', {
      name: /record heat/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /visual observation/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].details).toEqual({ method: 'visual' });
  });
});

describe('ReproductionForm — insemination sentinel + gating', () => {
  it('no method preselected; Record Insemination disabled until chosen', async () => {
    const onSubmit = await openSubFlow(/Insemination/i);

    const submit = screen.getByRole('button', {
      name: /record insemination/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /AI — Artificial/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].details.method).toBe('AI');
  });
});

describe('ReproductionForm — pregnancy scan sentinel + gating', () => {
  it('no result preselected; Record Scan Result disabled until chosen', async () => {
    const onSubmit = await openSubFlow(/Pregnancy Scan/i);

    const radios = screen.getAllByRole('radio');
    for (const r of radios) {
      expect(r.getAttribute('aria-checked')).toBe('false');
    }

    const submit = screen.getByRole('button', {
      name: /record scan result/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: /Pregnant/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].details).toEqual({ result: 'pregnant' });
  });
});

describe('ReproductionForm — BCS sentinel + gating', () => {
  it('no score preselected; Record BCS disabled until chosen', async () => {
    const onSubmit = await openSubFlow(/Body Condition Score/i);

    const submit = screen.getByRole('button', {
      name: /record bcs/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^6 — Good/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].details).toEqual({ score: '6' });
  });
});

describe('ReproductionForm — temperament sentinel + gating', () => {
  it('no score preselected; Record Temperament disabled until chosen', async () => {
    const onSubmit = await openSubFlow(/Temperament Score/i);

    const submit = screen.getByRole('button', {
      name: /record temperament/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^3 — Restless/i }));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onSubmit.mock.calls[0][0].details).toEqual({ score: '3' });
  });
});
