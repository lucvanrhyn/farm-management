import { NextResponse } from 'next/server';
import { hashSync } from 'bcryptjs';
import { getUserByEmail } from '../../../../lib/meta-db';
import { provisionFarm } from '../../../../lib/provisioning';

interface RegisterBody {
  name: string;
  email: string;
  username: string;
  password: string;
  farmName: string;
}

export async function POST(request: Request) {
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

  // Check email uniqueness
  const existing = await getUserByEmail(email);
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 });
  }

  // Provision
  try {
    const passwordHash = hashSync(password, 12);
    const { slug } = await provisionFarm({ name, email, username, passwordHash, farmName });
    return NextResponse.json({ success: true, slug });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Registration failed';
    console.error('[register] Provisioning error:', message);
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 });
  }
}
