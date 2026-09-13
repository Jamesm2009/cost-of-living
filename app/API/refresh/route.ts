/**
 * app/api/refresh/route.ts
 *
 * Cron target. Vercel calls this on the schedule in vercel.json.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically
 * when CRON_SECRET is set in your environment variables. Without that check
 * this route is a public endpoint anyone can hammer, burning your API quotas.
 *
 * You can also trigger it by hand:
 *   curl -H "Authorization: Bearer YOUR_SECRET" https://your-app.vercel.app/api/refresh
 */

import { NextResponse } from 'next/server';
import { refreshAll } from '@/lib/data/refresh';
import { METROS } from '@/lib/data/metros';

// Node runtime: the CSV parsing in the Zillow source needs more memory and
// time than the Edge runtime allows.
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else {
    console.warn('[refresh] CRON_SECRET is not set — this route is UNPROTECTED.');
  }

  const started = Date.now();

  try {
    const result = await refreshAll(Object.keys(METROS));

    return NextResponse.json({
      ok: result.failed.length === 0,
      durationMs: Date.now() - started,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      },
      { status: 500 },
    );
  }
}
