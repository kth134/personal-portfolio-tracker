import { NextResponse } from 'next/server';

// Debug compute-irr endpoint removed — keep a 410 response in place so the
// route does not accidentally remain accessible. Delete this file once you
// are sure you don't need the historical debug route.
export async function GET() {
  return NextResponse.json({ error: 'Debug endpoint removed' }, { status: 410 });
}
