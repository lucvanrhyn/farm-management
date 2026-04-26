import { NextResponse } from 'next/server';
import { verifyUserEmail } from '../../../../lib/meta-db';
import { logger } from '@/lib/logger';

export type VerifyEmailReason = 'missing_token' | 'invalid_token';

export interface VerifyEmailResponse {
  valid: true;
}

export interface VerifyEmailErrorResponse {
  valid: false;
  reason: VerifyEmailReason;
}

/**
 * GET /api/auth/verify-email?token=<token>
 *
 * Always returns HTTP 200 so the browser never auto-logs a network error in
 * the console. Error conditions are signalled via `{ valid: false, reason }`.
 * The client page reads `valid` and renders appropriate UI.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json<VerifyEmailErrorResponse>(
      { valid: false, reason: 'missing_token' },
      { status: 200 },
    );
  }

  try {
    const result = await verifyUserEmail(token);
    if (!result) {
      return NextResponse.json<VerifyEmailErrorResponse>(
        { valid: false, reason: 'invalid_token' },
        { status: 200 },
      );
    }
    return NextResponse.json<VerifyEmailResponse>({ valid: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[verify-email]', { message, stack: err instanceof Error ? err.stack : '' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
