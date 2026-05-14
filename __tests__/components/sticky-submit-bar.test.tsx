// @vitest-environment jsdom
/**
 * __tests__/components/sticky-submit-bar.test.tsx
 *
 * Wave 262 — Mobile sticky Submit bar.
 *
 * Bug class fixed: each of the seven logger BottomSheet forms
 * (Health, Movement, Calving, Weighing, Treatment, Reproduction, Death)
 * rendered Submit as the LAST child of an `overflow-y-auto flex-1` body.
 * On 390x844 viewports the user had to scroll past PhotoCapture and every
 * other field before reaching Submit, which made one-handed logging painful
 * (issue #262, mobile QA).
 *
 * Contract this test pins:
 *
 *   1. The component renders a wrapper with `data-sticky-submit-bar`
 *      so e2e + visual regression suites can target it without coupling
 *      to class-name churn.
 *
 *   2. The wrapper carries `position: sticky; bottom: 0` (the actual fix
 *      that pulls Submit out of the scroll well).
 *
 *   3. Children (the form's existing Submit button) render unchanged —
 *      composition only, no prop drilling, no state hoisting. Each form
 *      keeps its own disabled-state + onClick logic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import React from 'react';

afterEach(() => {
  cleanup();
});

describe('StickySubmitBar (#262)', () => {
  it('renders children inside a data-sticky-submit-bar wrapper', async () => {
    const { default: StickySubmitBar } = await import(
      '@/components/logger/StickySubmitBar'
    );

    render(
      <StickySubmitBar>
        <button>Submit Report</button>
      </StickySubmitBar>,
    );

    const wrapper = screen.getByTestId('sticky-submit-bar');
    expect(wrapper).toBeInTheDocument();
    // Child renders unchanged
    expect(screen.getByRole('button', { name: 'Submit Report' })).toBeInTheDocument();
    // Child must be a descendant of the wrapper (composition contract)
    expect(wrapper).toContainElement(
      screen.getByRole('button', { name: 'Submit Report' }),
    );
  });

  it('applies position: sticky; bottom: 0 so the Submit row stays in view', async () => {
    const { default: StickySubmitBar } = await import(
      '@/components/logger/StickySubmitBar'
    );

    const { container } = render(
      <StickySubmitBar>
        <button>Submit</button>
      </StickySubmitBar>,
    );

    const wrapper = container.querySelector(
      '[data-sticky-submit-bar]',
    ) as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    // Tailwind `sticky bottom-0` compiles to these inline-equivalent props
    // — assert via classList so the test survives style refactors.
    expect(wrapper!.className).toMatch(/\bsticky\b/);
    expect(wrapper!.className).toMatch(/bottom-0/);
  });
});
