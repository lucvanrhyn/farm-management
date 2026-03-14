import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compareSync } from 'bcryptjs';

// ─── Mock prisma ──────────────────────────────────────────────────────────────
const mockFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mockFindUnique } },
}));

// ─── Mock bcryptjs ────────────────────────────────────────────────────────────
vi.mock('bcryptjs', () => ({ compareSync: vi.fn() }));

// Import after mocks are registered
const { authOptions } = await import('@/lib/auth-options');
// next-auth CredentialsProvider exposes `authorize` as the third element in the
// providers array configuration object.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authorize = (authOptions.providers[0] as any).options.authorize as (
  credentials: Record<string, string>
) => Promise<unknown>;

// ─────────────────────────────────────────────────────────────────────────────

const VALID_CREDENTIALS = { email: 'dicky@triob.co.za', password: 'Tr!oB_F13ld_26' };
const STORED_USER = {
  id: 'user-1',
  email: 'dicky@triob.co.za',
  name: 'Dicky',
  password: '$2a$12$hashedpassword',
  role: 'field_logger',
};

describe('authorize (auth-options.ts)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────
  it('returns the user when credentials are valid', async () => {
    mockFindUnique.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(true);

    const result = await authorize(VALID_CREDENTIALS);

    expect(result).toEqual({
      id: 'user-1',
      email: 'dicky@triob.co.za',
      name: 'Dicky',
      role: 'field_logger',
    });
  });

  // ── Wrong password ──────────────────────────────────────────────────────────
  it('returns null when the password is wrong', async () => {
    mockFindUnique.mockResolvedValueOnce(STORED_USER);
    vi.mocked(compareSync).mockReturnValueOnce(false);

    expect(await authorize(VALID_CREDENTIALS)).toBeNull();
  });

  // ── User not found ──────────────────────────────────────────────────────────
  it('returns null when the user does not exist in the DB', async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    expect(await authorize(VALID_CREDENTIALS)).toBeNull();
  });

  // ── Missing credentials ─────────────────────────────────────────────────────
  it('returns null when credentials are missing', async () => {
    expect(await authorize({ email: '', password: '' })).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  // ── DB error → reproduces the production bug ────────────────────────────────
  // On Vercel (Node 24 + @libsql/client 0.5.6) the DB driver throws on every
  // request. authorize() catches the error and returns null, which makes login
  // show "Wrong credentials" even though the password is correct.
  //
  // This test pins that behaviour. Once the DB connection is fixed the happy-
  // path test above is the regression guard.
  it('returns null (not throw) when the DB driver throws — reproduces Vercel bug', async () => {
    const dbError = new Error('WebSocket connection failed');
    mockFindUnique.mockRejectedValueOnce(dbError);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await authorize(VALID_CREDENTIALS);
    consoleSpy.mockRestore();

    // Current (broken) behaviour: silently returns null, masking the DB error.
    expect(result).toBeNull();
  });

  // ── Error logging quality ────────────────────────────────────────────────────
  // The error MUST be logged with enough detail to diagnose production failures.
  // If logging is missing or incomplete this test fails, prompting us to improve
  // the logging before the next deploy.
  it('logs the full error message when the DB throws', async () => {
    const dbError = new Error('WebSocket connection failed: ECONNREFUSED');
    mockFindUnique.mockRejectedValueOnce(dbError);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await authorize(VALID_CREDENTIALS);

    // Must log the actual error message, not just the generic Error object.
    // The logging format is: prefix string, message string, stack string.
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[authorize]'),
      expect.stringContaining('WebSocket connection failed: ECONNREFUSED'),
      expect.any(String),
    );
    consoleSpy.mockRestore();
  });
});
