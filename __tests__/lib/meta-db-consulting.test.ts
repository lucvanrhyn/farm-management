import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Shared mock-execute: tests push scripted responses and assert on calls.
type ExecuteArgs = { sql: string; args?: unknown[] };
type ExecuteResponse = { rows: Record<string, unknown>[] };

const mockExecute = vi.fn<(call: ExecuteArgs) => Promise<ExecuteResponse>>();

vi.mock('@libsql/client', () => ({
  createClient: () => ({ execute: mockExecute }),
}));

// Ensure env vars are present for getMetaClient()
process.env.META_TURSO_URL = 'libsql://test.example';
process.env.META_TURSO_AUTH_TOKEN = 'token';

// Helper to queue a sequence of responses (FIFO).
function queueResponses(responses: ExecuteResponse[]): void {
  mockExecute.mockReset();
  for (const r of responses) mockExecute.mockResolvedValueOnce(r);
}

const baseLeadRow = {
  id: 'lead-1',
  name: 'Jannie Brand',
  email: 'jannie@example.com',
  phone: '+27 82 111 2222',
  farm_name: 'Brand Boerdery',
  province: 'Free State',
  species_json: JSON.stringify(['cattle', 'sheep']),
  herd_size: 320,
  data_notes: 'Uses pen-and-paper for weights',
  custom_tracking: null,
  source: 'website',
  status: 'new',
  assigned_to: null,
  created_at: '2026-04-10 09:00:00',
};

describe('getConsultingLeads', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('parses species_json correctly when it is a valid JSON array', async () => {
    const { getConsultingLeads } = await import('@/lib/meta-db');
    queueResponses([{ rows: [{ ...baseLeadRow }] }]);

    const leads = await getConsultingLeads();

    expect(leads).toHaveLength(1);
    expect(leads[0].species).toEqual(['cattle', 'sheep']);
    expect(leads[0].herdSize).toBe(320);
  });

  it('defaults species to [] on malformed JSON', async () => {
    const { getConsultingLeads } = await import('@/lib/meta-db');
    queueResponses([
      { rows: [{ ...baseLeadRow, species_json: 'not-json-at-all' }] },
    ]);

    const leads = await getConsultingLeads();

    expect(leads[0].species).toEqual([]);
  });

  it('filters by status and passes correct args', async () => {
    const { getConsultingLeads } = await import('@/lib/meta-db');
    queueResponses([{ rows: [] }]);

    await getConsultingLeads({ status: 'scoped', limit: 25 });

    expect(mockExecute).toHaveBeenCalledOnce();
    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toMatch(/WHERE status = \?/);
    expect(call.args).toEqual(['scoped', 25]);
  });
});

describe('getConsultingLeadById', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('returns null when id not found', async () => {
    const { getConsultingLeadById } = await import('@/lib/meta-db');
    queueResponses([{ rows: [] }]);

    const lead = await getConsultingLeadById('missing');

    expect(lead).toBeNull();
  });

  it('returns a shaped lead when found', async () => {
    const { getConsultingLeadById } = await import('@/lib/meta-db');
    queueResponses([{ rows: [{ ...baseLeadRow }] }]);

    const lead = await getConsultingLeadById('lead-1');

    expect(lead).not.toBeNull();
    expect(lead?.id).toBe('lead-1');
    expect(lead?.species).toEqual(['cattle', 'sheep']);
    expect(lead?.status).toBe('new');
  });
});

describe('updateConsultingLeadStatus', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('returns not found when lead does not exist', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([{ rows: [] }]); // getConsultingLeadById returns empty

    const res = await updateConsultingLeadStatus('missing', 'scoped');

    expect(res).toEqual({ ok: false, error: 'not found' });
  });

  it('rejects an invalid transition (new → active)', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([{ rows: [{ ...baseLeadRow, status: 'new' }] }]);

    const res = await updateConsultingLeadStatus('lead-1', 'active');

    expect(res).toEqual({ ok: false, error: 'invalid transition' });
    // Only the SELECT should have fired — no UPDATE.
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('allows a valid transition (new → scoped) and issues UPDATE', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([
      { rows: [{ ...baseLeadRow, status: 'new' }] }, // SELECT
      { rows: [] }, // UPDATE
    ]);

    const res = await updateConsultingLeadStatus('lead-1', 'scoped');

    expect(res).toEqual({ ok: true });
    expect(mockExecute).toHaveBeenCalledTimes(2);
    const update = mockExecute.mock.calls[1][0];
    expect(update.sql).toMatch(/UPDATE consulting_leads/);
    expect(update.args?.[0]).toBe('scoped');
  });

  it('with options.assignedTo="user@x.com" sets the assignee', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([
      { rows: [{ ...baseLeadRow, status: 'new' }] }, // SELECT
      { rows: [] }, // UPDATE
    ]);

    const res = await updateConsultingLeadStatus('lead-1', 'scoped', {
      assignedTo: 'user@x.com',
    });

    expect(res).toEqual({ ok: true });
    const update = mockExecute.mock.calls[1][0];
    expect(update.sql).toMatch(/assigned_to = \?/);
    expect(update.sql).not.toMatch(/COALESCE/);
    expect(update.args).toEqual(['scoped', 'user@x.com', 'lead-1']);
  });

  it('with options.assignedTo=null un-assigns the lead', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([
      { rows: [{ ...baseLeadRow, status: 'new' }] }, // SELECT
      { rows: [] }, // UPDATE
    ]);

    const res = await updateConsultingLeadStatus('lead-1', 'scoped', {
      assignedTo: null,
    });

    expect(res).toEqual({ ok: true });
    const update = mockExecute.mock.calls[1][0];
    expect(update.sql).toMatch(/assigned_to = \?/);
    expect(update.sql).not.toMatch(/COALESCE/);
    expect(update.args).toEqual(['scoped', null, 'lead-1']);
  });

  it('with no options preserves existing assignee (UPDATE only status column)', async () => {
    const { updateConsultingLeadStatus } = await import('@/lib/meta-db');
    queueResponses([
      { rows: [{ ...baseLeadRow, status: 'new' }] }, // SELECT
      { rows: [] }, // UPDATE
    ]);

    const res = await updateConsultingLeadStatus('lead-1', 'scoped');

    expect(res).toEqual({ ok: true });
    const update = mockExecute.mock.calls[1][0];
    expect(update.sql).toMatch(/UPDATE consulting_leads SET status = \? WHERE id = \?/);
    expect(update.sql).not.toMatch(/assigned_to/);
    expect(update.args).toEqual(['scoped', 'lead-1']);
  });
});

describe('isPlatformAdmin', () => {
  const originalEnv = process.env.PLATFORM_ADMIN_EMAILS;

  beforeEach(() => {
    mockExecute.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PLATFORM_ADMIN_EMAILS;
    } else {
      process.env.PLATFORM_ADMIN_EMAILS = originalEnv;
    }
  });

  it('returns true when email is in PLATFORM_ADMIN_EMAILS (case-insensitive)', async () => {
    vi.stubEnv(
      'PLATFORM_ADMIN_EMAILS',
      'owner@example.com, other@example.com',
    );
    const { isPlatformAdmin } = await import('@/lib/meta-db');

    // Mixed-case input proves the lookup is case-insensitive against the
    // lowercased allowlist.
    await expect(isPlatformAdmin('Owner@Example.com')).resolves.toBe(true);
    // Should not have hit the DB
    expect(mockExecute).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('returns false when email NOT in allowlist', async () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', 'owner@example.com');
    const { isPlatformAdmin } = await import('@/lib/meta-db');

    await expect(isPlatformAdmin('stranger@example.com')).resolves.toBe(false);
    expect(mockExecute).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it('falls back to farm-ADMIN check when env var unset', async () => {
    vi.stubEnv('PLATFORM_ADMIN_EMAILS', '');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    queueResponses([{ rows: [{ count: 1 }] }]);

    const { isPlatformAdmin } = await import('@/lib/meta-db');
    const result = await isPlatformAdmin('admin@example.com');

    expect(result).toBe(true);
    expect(mockExecute).toHaveBeenCalledOnce();
    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toMatch(/SELECT COUNT\(\*\)/);
    expect(call.args).toEqual(['admin@example.com']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('PLATFORM_ADMIN_EMAILS not set'),
    );

    warnSpy.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('getConsultingEngagements', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('filters by leadId when provided', async () => {
    const { getConsultingEngagements } = await import('@/lib/meta-db');
    queueResponses([{ rows: [] }]);

    await getConsultingEngagements('lead-42');

    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).toMatch(/WHERE lead_id = \?/);
    expect(call.args).toEqual(['lead-42']);
  });

  it('omits WHERE when no leadId provided', async () => {
    const { getConsultingEngagements } = await import('@/lib/meta-db');
    queueResponses([{ rows: [] }]);

    await getConsultingEngagements();

    const call = mockExecute.mock.calls[0][0];
    expect(call.sql).not.toMatch(/WHERE lead_id/);
    expect(call.args).toEqual([]);
  });
});
