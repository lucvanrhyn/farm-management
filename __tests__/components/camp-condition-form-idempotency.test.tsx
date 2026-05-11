// @vitest-environment jsdom
/**
 * Issue #206 — Cycle 2: client UUID generation at form mount.
 *
 * Contract this test pins:
 *   - `CampConditionForm` generates a UUID once at MOUNT (not at submit) and
 *     includes it in the `onSubmit` payload as `clientLocalId`.
 *   - The UUID is STABLE across re-renders and across multiple submit clicks
 *     within a single form lifecycle — otherwise an accidental double-click
 *     bypasses the server-side `upsert` and creates two rows.
 *   - The UUID REGENERATES on re-mount (each new logging session gets its
 *     own idempotency key).
 *   - The UUID looks like a RFC 4122 v4 UUID (`crypto.randomUUID()` shape).
 *     Pinning the shape catches a future regression where someone replaces
 *     the call with `Math.random().toString(36)` or similar.
 *
 * Without this contract, Cycle 1's server-side `upsert` is useless: every
 * retry would arrive with a fresh UUID and still get a fresh row.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/components/logger/PhotoCapture', () => ({
  __esModule: true,
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

afterEach(() => {
  cleanup();
});

// RFC 4122 v4 UUID shape — `crypto.randomUUID()` always produces this form.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('CampConditionForm — clientLocalId (#206)', () => {
  it('emits a stable UUID in onSubmit payload (RFC 4122 v4 shape)', async () => {
    const { default: CampConditionForm } = await import(
      '@/components/logger/CampConditionForm'
    );

    const onSubmit = vi.fn();
    render(
      <CampConditionForm
        campId="A"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByText('Submit Camp Report');
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledOnce();
    const payload = onSubmit.mock.calls[0][0];
    expect(payload.clientLocalId, 'onSubmit must carry a clientLocalId').toBeDefined();
    expect(
      payload.clientLocalId,
      `clientLocalId must be a v4 UUID, got: ${payload.clientLocalId}`,
    ).toMatch(UUID_V4_RE);
  });

  it('keeps the same UUID across two submit clicks within one mount', async () => {
    const { default: CampConditionForm } = await import(
      '@/components/logger/CampConditionForm'
    );

    const onSubmit = vi.fn();
    render(
      <CampConditionForm
        campId="A"
        onClose={() => {}}
        onSubmit={onSubmit}
      />,
    );

    const submit = screen.getByText('Submit Camp Report');
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(onSubmit).toHaveBeenCalledTimes(2);
    const first = onSubmit.mock.calls[0][0].clientLocalId;
    const second = onSubmit.mock.calls[1][0].clientLocalId;
    expect(
      second,
      'double-click must reuse the mount-time UUID so the server upsert collapses both POSTs to one row',
    ).toBe(first);
  });

  it('regenerates the UUID on a fresh mount', async () => {
    const { default: CampConditionForm } = await import(
      '@/components/logger/CampConditionForm'
    );

    const onSubmit1 = vi.fn();
    const { unmount } = render(
      <CampConditionForm
        campId="A"
        onClose={() => {}}
        onSubmit={onSubmit1}
      />,
    );
    fireEvent.click(screen.getByText('Submit Camp Report'));
    const uuid1 = onSubmit1.mock.calls[0][0].clientLocalId;

    act(() => {
      unmount();
    });

    const onSubmit2 = vi.fn();
    render(
      <CampConditionForm
        campId="A"
        onClose={() => {}}
        onSubmit={onSubmit2}
      />,
    );
    fireEvent.click(screen.getByText('Submit Camp Report'));
    const uuid2 = onSubmit2.mock.calls[0][0].clientLocalId;

    expect(uuid1).toMatch(UUID_V4_RE);
    expect(uuid2).toMatch(UUID_V4_RE);
    expect(
      uuid2,
      'a new mount must start a new idempotency key — otherwise distinct submissions would collide on the server',
    ).not.toBe(uuid1);
  });
});
