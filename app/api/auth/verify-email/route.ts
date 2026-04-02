import { NextResponse } from 'next/server';
import { verifyUserEmail } from '../../../../lib/meta-db';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.json({ error: 'Missing verification token' }, { status: 400 });
  }

  const result = await verifyUserEmail(token);
  if (!result) {
    return NextResponse.json({ error: 'Invalid or expired verification token' }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
