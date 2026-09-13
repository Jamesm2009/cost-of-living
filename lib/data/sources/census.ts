/**
 * lib/data/sources/census.ts
 *
 * US Census American Community Survey (5-year estimates) and HUD Fair Market
 * Rents. Both are free; both need a key.
 *
 *   Census key: https://api.census.gov/data/key_signup.html  (instant, email)
 *   HUD token:  https://www.huduser.gov/portal/dataset/fmr-api.html
 *
 * ⚠ ENDPOINT SHAPES NOT VERIFIED. I could not reach these APIs from the
 * environment where this was written. The variable codes and URL structure
 * reflect the documented API, but confirm the first response shape by hand
 * before trusting the parsing — especially the ACS year, which advances
 * annually and 404s once the old one is retired.
 */

import { fetchJson, requireEnv } from '../http';
import type { MetroRef } from '../types';

/** Most recent ACS 5-year release. Bump annually — old years are removed. */
const ACS_YEAR = 2023;

/**
 * ACS variable codes:
 *   B25064_001E — median gross rent
 *   B25077_001E — median value, owner-occupied units
 *   B19013_001E — median household income
 */
const ACS_VARS = ['B25064_001E', 'B25077_001E', 'B19013_001E'] as const;

export interface CensusResult {
  medianGrossRent: number | null;
  medianHomeValue: number | null;
  medianHouseholdIncome: number | null;
  year: number;
}

/** ACS returns a header row followed by data rows, all as strings. */
type AcsResponse = string[][];

/** Census uses large negative sentinels for suppressed values. */
function parseAcs(raw: string | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function fetchCensus(metro: MetroRef): Promise<CensusResult> {
  const key = requireEnv('CENSUS_API_KEY');
  const url =
    `https://api.census.gov/data/${ACS_YEAR}/acs/acs5` +
    `?get=NAME,${ACS_VARS.join(',')}` +
    `&for=place:${metro.placeFips}` +
    `&in=state:${metro.stateFips}` +
    `&key=${key}`;

  const rows = await fetchJson<AcsResponse>('census', url);
  const header = rows[0] ?? [];
  const data = rows[1];
  if (!data) {
    throw new Error(
      `Census returned no rows for place ${metro.stateFips}${metro.placeFips}. ` +
        `Check the FIPS codes.`,
    );
  }

  const at = (code: string) => parseAcs(data[header.indexOf(code)]);

  return {
    medianGrossRent: at('B25064_001E'),
    medianHomeValue: at('B25077_001E'),
    medianHouseholdIncome: at('B19013_001E'),
    year: ACS_YEAR,
  };
}

// ---------------------------------------------------------------------------
// HUD Fair Market Rents
// ---------------------------------------------------------------------------

interface HudFmrResponse {
  data?: {
    basicdata?:
      | {
          Efficiency?: number;
          'One-Bedroom'?: number;
          'Two-Bedroom'?: number;
          'Three-Bedroom'?: number;
          'Four-Bedroom'?: number;
        }
      // Some metros return an array of sub-areas rather than one object.
      | Array<Record<string, number | string>>;
  };
}

/** FMR by bedroom count, index 0 = studio through index 4 = four-bedroom. */
export async function fetchHudFmr(metro: MetroRef): Promise<(number | null)[]> {
  const token = requireEnv('HUD_API_TOKEN');
  const url = `https://www.huduser.gov/hudapi/public/fmr/data/${metro.countyFips}`;

  const res = await fetchJson<HudFmrResponse>('hud', url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const basic = res.data?.basicdata;
  // Multi-area metros return an array; take the first sub-area as a stand-in
  // and flag it, since sub-area FMRs can differ meaningfully.
  const record = Array.isArray(basic) ? basic[0] : basic;
  if (!record) return [null, null, null, null, null];

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return [
    num((record as Record<string, unknown>)['Efficiency']),
    num((record as Record<string, unknown>)['One-Bedroom']),
    num((record as Record<string, unknown>)['Two-Bedroom']),
    num((record as Record<string, unknown>)['Three-Bedroom']),
    num((record as Record<string, unknown>)['Four-Bedroom']),
  ];
}
