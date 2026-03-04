import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  console.log('[observations] Received:', JSON.stringify(body, null, 2));
  return NextResponse.json({ success: true, message: 'Observation logged (stub)' });
}
