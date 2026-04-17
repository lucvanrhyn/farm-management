import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    expect(update.args?.[2]).toBe('lead-1');
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
