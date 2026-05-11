// @vitest-environment jsdom
/**
 * Issue #207 — Cycle 2: client UUID generation at animal-form mount.
 *
 * Mirrors `__tests__/components/camp-condition-form-idempotency.test.tsx`
 * (#206) one-for-one against the admin `RecordBirthButton` form — the
 * primary admin path for creating an Animal row.
 *
 * Contract this test pins (3 cases):
 *   - The form generates a UUID once at MOUNT and includes it in the
 *     `/api/animals` POST body as `clientLocalId`.
 *   - The UUID is STABLE across multiple submit attempts within a single
 *     form lifecycle — accidental double-click MUST collapse to the same
 *     server row via the upsert path.
 *   - The UUID looks like a RFC 4122 v4 UUID (`crypto.randomUUID()` shape).
 *     Pinning the shape catches a future regression where someone replaces
 *     the call with `Math.random().toString(36)` or similar.
 *
 * Without this contract, the cycle-1 server upsert is useless: every retry
 * would arrive with a fresh UUID and still get a fresh row.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Next.js router stub — RecordBirthButton calls router.refresh() on success.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CapturedPost {
  url: string;
  body: Record<string, unknown>;
}

function setupFetchSpy(): CapturedPost[] {
  const captured: CapturedPost[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      let body: Record<string, unknown> = {};
      if (init?.body) {
        try {
          body = JSON.parse(init.body as string);
        } catch {
          body = { _raw: init.body as string };
        }
      }
      captured.push({ url, body });
      return new Response(
        JSON.stringify({ success: true, animal: { id: 'a-1', animalId: 'A-1' } }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    },
  );
  return captured;
}

const SAMPLE_CAMPS = [
  { camp_id: 'A', camp_name: 'Camp A', size_hectares: 10, water_source: 'River' },
];

// RecordBirthButton's form is gated behind a "+ Record Birth" toggle. The
// helper opens it, then fills minimum-required fields so the submit is valid.
function openAndFill() {
  fireEvent.click(screen.getByText(/Record Birth/i));
  // Modal is open — fill Calf ID.
  const calfInput = screen.getByPlaceholderText(/TB-2026-001/i) as HTMLInputElement;
  fireEvent.change(calfInput, { target: { value: 'CALF-001' } });
}

describe('RecordBirthButton — clientLocalId (#207)', () => {
  it('POST /api/animals body carries a clientLocalId in RFC 4122 v4 shape', async () => {
    const { default: RecordBirthButton } = await import(
      '@/components/admin/RecordBirthButton'
    );

    const captured = setupFetchSpy();

    render(
      <RecordBirthButton
        animals={[]}
        camps={SAMPLE_CAMPS as unknown as Parameters<typeof RecordBirthButton>[0]['camps']}
      />,
    );

    openAndFill();
    // Submit the form.
    const submitButtons = screen.getAllByText(/Record Birth/i);
    // The modal's submit button is the inner one (`type="submit"`); click the
    // form to dispatch the submit event reliably.
    const form = submitButtons[submitButtons.length - 1].closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);

    // Allow the async handleSubmit to flush.
    await new Promise((r) => setTimeout(r, 0));

    expect(captured.length, 'expected one POST /api/animals call').toBe(1);
    expect(captured[0].url).toMatch(/\/api\/animals\b/);
    const body = captured[0].body;
    expect(
      body.clientLocalId,
      'POST body must carry a clientLocalId so the server upsert can collapse retries',
    ).toBeDefined();
    expect(body.clientLocalId).toMatch(UUID_V4_RE);
  });

  it('keeps the same UUID across two submit attempts within one mount', async () => {
    const { default: RecordBirthButton } = await import(
      '@/components/admin/RecordBirthButton'
    );

    const captured = setupFetchSpy();

    render(
      <RecordBirthButton
        animals={[]}
        camps={SAMPLE_CAMPS as unknown as Parameters<typeof RecordBirthButton>[0]['camps']}
      />,
    );

    openAndFill();
    const submitButtons = screen.getAllByText(/Record Birth/i);
    const form = submitButtons[submitButtons.length - 1].closest('form');
    expect(form).toBeTruthy();
    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await new Promise((r) => setTimeout(r, 0));

    expect(captured.length).toBeGreaterThanOrEqual(2);
    const first = captured[0].body.clientLocalId;
    const second = captured[1].body.clientLocalId;
    expect(
      second,
      'double-submit must reuse the mount-time UUID so the server upsert collapses both POSTs to one row',
    ).toBe(first);
  });

  it('regenerates the UUID on a fresh mount', async () => {
    const { default: RecordBirthButton } = await import(
      '@/components/admin/RecordBirthButton'
    );

    const captured1 = setupFetchSpy();

    const { unmount } = render(
      <RecordBirthButton
        animals={[]}
        camps={SAMPLE_CAMPS as unknown as Parameters<typeof RecordBirthButton>[0]['camps']}
      />,
    );
    openAndFill();
    const submit1 = screen.getAllByText(/Record Birth/i);
    fireEvent.submit(submit1[submit1.length - 1].closest('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const uuid1 = captured1[0].body.clientLocalId as string;

    unmount();
    vi.restoreAllMocks();
    const captured2 = setupFetchSpy();

    render(
      <RecordBirthButton
        animals={[]}
        camps={SAMPLE_CAMPS as unknown as Parameters<typeof RecordBirthButton>[0]['camps']}
      />,
    );
    openAndFill();
    const submit2 = screen.getAllByText(/Record Birth/i);
    fireEvent.submit(submit2[submit2.length - 1].closest('form')!);
    await new Promise((r) => setTimeout(r, 0));
    const uuid2 = captured2[0].body.clientLocalId as string;

    expect(uuid1).toMatch(UUID_V4_RE);
    expect(uuid2).toMatch(UUID_V4_RE);
    expect(
      uuid2,
      'a new mount must start a new idempotency key — distinct submissions must NOT collide on the server',
    ).not.toBe(uuid1);
  });
});
