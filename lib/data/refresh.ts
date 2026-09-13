/**
 * lib/data/refresh.ts
 *
 * Orchestrates every feed for a metro and writes the result to Redis.
 *
 * Key behaviour: PARTIAL FAILURE IS NORMAL. Six independent government and
 * corporate endpoints will not all be up at once. Each source is settled
 * independently, failures are recorded in `errors`, and whatever succeeded is
 * still cached. One dead API must not blank the whole comparison.
 */

import { cached, setCached } from '../cache/redis';
import { metroFor } from './metros';
import { fetchCensus, fetchHudFmr } from './sources/census';
import { fetchCpi, fetchGasPrice, fetchRpp } from './sources/indices';
import { fetchZhvi, fetchZori, impliedAppreciation } from './sources/zillow';
import type { MetroSnapshot } from './types';

/** Resolve a promise to its value, or null plus a recorded error. */
async function settle<T>(
  label: string,
  errors: string[],
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`${label}: ${message}`);
    console.error(`[refresh] ${label} failed:`, message);
    return null;
  }
}

export async function refreshMetro(localityId: string): Promise<MetroSnapshot> {
  const metro = metroFor(localityId);
  const errors: string[] = [];

  // Run everything concurrently — six sequential calls would risk the
  // function timeout, and they share no dependencies.
  const [census, fmr, zori, zhvi, cpi, rpp, gas] = await Promise.all([
    settle('census', errors, () => fetchCensus(metro)),
    settle('hud', errors, () => fetchHudFmr(metro)),
    settle('zillow-zori', errors, () => fetchZori(metro)),
    settle('zillow-zhvi', errors, () => fetchZhvi(metro)),
    settle('bls-cpi', errors, () => fetchCpi(metro)),
    settle('bea-rpp', errors, () => fetchRpp(metro)),
    settle('eia-gas', errors, () => fetchGasPrice(metro.eiaRegion)),
  ]);

  const snapshot: MetroSnapshot = {
    localityId,
    rent: {
      medianGrossRent: census?.medianGrossRent ?? null,
      fmrByBedroom: fmr ?? [null, null, null, null, null],
      zori: zori?.latest ?? null,
      zoriMonth: zori?.latestMonth ?? null,
    },
    homeValue: {
      medianHomeValue: census?.medianHomeValue ?? null,
      zhvi: zhvi?.latest ?? null,
      zhviMonth: zhvi?.latestMonth ?? null,
      impliedAppreciation: zhvi ? impliedAppreciation(zhvi) : null,
    },
    prices: {
      regionalPriceParity: rpp?.rpp ?? null,
      rppYear: rpp?.year ?? null,
      cpiIndex: cpi?.index ?? null,
      cpiYoY: cpi?.yearOverYear ?? null,
      gasolinePrice: gas ?? null,
    },
    errors,
  };

  await setCached(`snapshot:${localityId}`, snapshot, 'refresh', 30 * 86_400);
  return snapshot;
}

/** Refresh every configured metro. Used by the cron route. */
export async function refreshAll(localityIds: string[]): Promise<{
  refreshed: string[];
  failed: { localityId: string; error: string }[];
  partial: { localityId: string; errors: string[] }[];
}> {
  const refreshed: string[] = [];
  const failed: { localityId: string; error: string }[] = [];
  const partial: { localityId: string; errors: string[] }[] = [];

  for (const id of localityIds) {
    try {
      const snap = await refreshMetro(id);
      refreshed.push(id);
      if (snap.errors.length > 0) partial.push({ localityId: id, errors: snap.errors });
    } catch (err) {
      failed.push({
        localityId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { refreshed, failed, partial };
}

/** Read a snapshot for the UI, refreshing on a cache miss. */
export async function getSnapshot(localityId: string) {
  return cached<MetroSnapshot>(
    `snapshot:${localityId}`,
    'refresh',
    () => refreshMetro(localityId),
    { ttlSeconds: 30 * 86_400 },
  );
}
