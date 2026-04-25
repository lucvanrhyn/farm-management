import { NextRequest, NextResponse } from 'next/server';
import { hash } from 'bcryptjs';
import { getUserByEmail } from '../../../../lib/meta-db';
import { provisionFarm } from '../../../../lib/provisioning';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { logger } from '../../../../lib/logger';

interface RegisterBody {
  name: string;
  email: string;
  username: string;
  password: string;
  farmName: string;
}

export async function POST(request: NextRequest) {
  // Rate limit by IP — 5 registrations per hour per IP (each registration provisions a Turso DB)
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  const rl = checkRateLimit(`register:${ip}`, 5, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many registration attempts. Please try again later.' }, { status: 429 });
  }

  let body: RegisterBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { name, email, username, password, farmName } = body;

  // Validation
  if (!name || !email || !username || !password || !farmName) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
  }

  if (username.length < 3 || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    return NextResponse.json(
      { error: 'Username must be 3+ characters (letters, numbers, hyphens, underscores)' },
      { status: 400 },
    );
  }

  if (farmName.length < 2) {
    return NextResponse.json({ error: 'Farm name must be at least 2 characters' }, { status: 400 });
  }

  // Anti-enumeration: new vs existing emails must produce byte-identical
  // responses. We also time-match the two paths — the existing-email branch
  // runs a dummy bcrypt hash so its latency tracks the provisioning branch's
  // `hash(password, 12)` cost, and a subsequent attacker cannot distinguish
  // the two by timing either.
  //
  // Residual timing delta: provisioning additionally writes to meta-db and
  // creates a Turso tenant DB. bcrypt dominates wall-clock (~200ms at cost=12),
  // but a patient attacker with low jitter and many samples could still see
  // a small (~tens of ms) difference. Acceptable given the LOW severity and
  // the 5/hr IP rate limit above; follow-up would add a fixed-latency sleep
  // to fully flatten if we ever ship a threat-model that requires it.
  //
  // The UI no longer branches on `slug` — it unconditionally shows the
  // "Check your email" screen whenever `success: true` is returned.
  const ANTI_ENUM_RESPONSE = { success: true, pending: true } as const;

  const existing = await getUserByEmail(email);
  if (existing) {
    // Time-match the happy path: hash the supplied password so the
    // "already exists" branch spends ~the same CPU as the "provision"
    // branch before responding. We discard the result.
    await hash(password, 12);
    return NextResponse.json(ANTI_ENUM_RESPONSE);
  }

  // Provision — use async hash to avoid blocking the event loop.
  try {
    const passwordHash = await hash(password, 12);
    await provisionFarm({ name, email, username, passwordHash, farmName });
    return NextResponse.json(ANTI_ENUM_RESPONSE);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    logger.error('[register] Provisioning error', { message });
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
