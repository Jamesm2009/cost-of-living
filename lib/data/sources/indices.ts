/**
 * lib/data/sources/indices.ts
 *
 * Three small feeds that together cover everything you don't itemize:
 *
 *   BEA Regional Price Parity — the cross-metro scaling factor (100 = national)
 *   BLS CPI                   — regional inflation, for escalating your budget
 *   EIA                       — gasoline prices, for the transport line
 *
 * Keys (all free):
 *   BLS: https://data.bls.gov/registrationEngine/
 *   BEA: https://apps.bea.gov/API/signup/
 *   EIA: https://www.eia.gov/opendata/register.php
 *
 * ⚠ ENDPOINT SHAPES NOT VERIFIED — see the note in census.ts. The BEA response
 * in particular is deeply nested and worth logging once before trusting.
 */

import { fetchJson, requireEnv } from '../http';
import type { MetroRef } from '../types';

// ---------------------------------------------------------------------------
// BLS — regional CPI
// ---------------------------------------------------------------------------

interface BlsResponse {
  status: string;
  message?: string[];
  Results?: {
    series?: Array<{
      seriesID: string;
      data?: Array<{ year: string; period: string; value: string }>;
    }>;
  };
}

export interface CpiResult {
  index: number | null;
  yearOverYear: number | null;
  period: string | null;
}

/**
 * BLS v2 is a POST with a JSON body. Returns monthly observations newest-first.
 * Free tier allows 500 queries/day — well within a weekly cron.
 */
export async function fetchCpi(metro: MetroRef): Promise<CpiResult> {
  const key = requireEnv('BLS_API_KEY');
  const thisYear = new Date().getFullYear();

  const res = await fetchJson<BlsResponse>(
    'bls',
    'https://api.bls.gov/publicAPI/v2/timeseries/data/',
    {
      method: 'POST',
      body: {
        seriesid: [metro.cpiSeriesId],
        startyear: String(thisYear - 2),
        endyear: String(thisYear),
        registrationkey: key,
      },
    },
  );

  if (res.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS: ${res.message?.join('; ') ?? res.status}`);
  }

  const data = res.Results?.series?.[0]?.data ?? [];
  // Monthly periods are M01–M12; M13 is an annual average — exclude it.
  const monthly = data.filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period));
  if (monthly.length === 0) return { index: null, yearOverYear: null, period: null };

  const latest = monthly[0];
  const index = Number(latest.value);
  const yearAgo = monthly.find(
    (d) => d.period === latest.period && d.year === String(Number(latest.year) - 1),
  );
  const prior = yearAgo ? Number(yearAgo.value) : null;

  return {
    index: Number.isFinite(index) ? index : null,
    yearOverYear:
      prior && Number.isFinite(prior) && prior !== 0 ? index / prior - 1 : null,
    period: `${latest.year}-${latest.period.slice(1)}`,
  };
}

// ---------------------------------------------------------------------------
// BEA — Regional Price Parity
// ---------------------------------------------------------------------------

interface BeaResponse {
  BEAAPI?: {
    Results?: {
      Data?: Array<{ GeoFips: string; TimePeriod: string; DataValue: string }>;
      Error?: unknown;
    };
  };
}

export interface RppResult {
  rpp: number | null;
  year: number | null;
}

/**
 * RPP for all items, by metro. 100 = national average, so a metro at 96.4 is
 * about 3.6% cheaper than the US as a whole.
 *
 * This is the honest shortcut for the categories you don't want to itemize —
 * far more defensible than crowdsourced per-item prices.
 */
export async function fetchRpp(metro: MetroRef): Promise<RppResult> {
  const key = requireEnv('BEA_API_KEY');
  const url =
    `https://apps.bea.gov/api/data?&UserID=${key}` +
    `&method=GetData&datasetname=Regional&TableName=MARPP` +
    `&LineCode=1&GeoFips=${metro.cbsaCode}&Year=ALL&ResultFormat=JSON`;

  const res = await fetchJson<BeaResponse>('bea', url);
  const rows = res.BEAAPI?.Results?.Data ?? [];
  if (rows.length === 0) return { rpp: null, year: null };

  // Take the most recent year present.
  const latest = rows.reduce((a, b) =>
    Number(b.TimePeriod) > Number(a.TimePeriod) ? b : a,
  );
  const value = Number(latest.DataValue);

  return {
    rpp: Number.isFinite(value) ? value : null,
    year: Number(latest.TimePeriod) || null,
  };
}

// ---------------------------------------------------------------------------
// EIA — gasoline
// ---------------------------------------------------------------------------

interface EiaResponse {
  response?: { data?: Array<{ period: string; value: number | string }> };
}

/**
 * Regular all-formulations retail gasoline, weekly, by PADD region.
 * `duoarea` is the regional code — not a metro, so cities in the same PADD
 * share a price. Good enough for a transport line item.
 */
export async function fetchGasPrice(duoarea: string): Promise<number | null> {
  const key = requireEnv('EIA_API_KEY');
  const url =
    `https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=${key}` +
    `&frequency=weekly&data[0]=value` +
    `&facets[duoarea][]=${duoarea}&facets[product][]=EPMR` +
    `&sort[0][column]=period&sort[0][direction]=desc&length=1`;

  const res = await fetchJson<EiaResponse>('eia', url);
  const raw = res.response?.data?.[0]?.value;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
