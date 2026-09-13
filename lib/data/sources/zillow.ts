/**
 * lib/data/sources/zillow.ts
 *
 * Zillow Observed Rent Index (ZORI) and Home Value Index (ZHVI).
 *
 * Zillow has no API — they publish research CSVs. No key needed, but:
 *
 * ⚠ THESE URLs ARE THE FRAGILE PART OF THE WHOLE SYSTEM. Zillow renames and
 * relocates these files periodically without notice. If a refresh starts
 * failing, check https://www.zillow.com/research/data/ for the current
 * filename before debugging anything else.
 *
 * The files are wide: one row per metro, one COLUMN per month, with new
 * columns appended over time. So "most recent month" means the last column,
 * not a fixed index.
 */

import { fetchText } from '../http';
import type { MetroRef } from '../types';

const ZORI_URL =
  'https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv';

const ZHVI_URL =
  'https://files.zillowstatic.com/research/public_csvs/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv';

/**
 * Minimal CSV parser handling quoted fields containing commas — metro names
 * like "Dallas-Fort Worth-Arlington, TX" break a naive split(',').
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

export interface ZillowSeries {
  /** Most recent non-empty value. */
  latest: number | null;
  /** Column header for that value, e.g. "2026-08-31". */
  latestMonth: string | null;
  /** Value twelve months earlier, for computing appreciation. */
  yearAgo: number | null;
}

/** Month columns are ISO dates; identify them by shape, not position. */
const isMonthColumn = (h: string) => /^\d{4}-\d{2}-\d{2}$/.test(h.trim());

function extractSeries(csv: string, regionName: string): ZillowSeries {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Zillow CSV appears empty — the URL has probably moved.');
  }

  const header = parseCsvLine(lines[0]);
  const nameIdx = header.findIndex((h) => h.trim() === 'RegionName');
  if (nameIdx === -1) {
    throw new Error('Zillow CSV has no RegionName column — format changed.');
  }

  const monthIdxs = header
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => isMonthColumn(h));

  const target = regionName.trim().toLowerCase();
  const row = lines
    .slice(1)
    .map(parseCsvLine)
    .find((cells) => cells[nameIdx]?.trim().toLowerCase() === target);

  if (!row) {
    throw new Error(
      `Zillow metro "${regionName}" not found. Names must match their CSV ` +
        `exactly, e.g. "Dallas-Fort Worth-Arlington, TX".`,
    );
  }

  const valueAt = (idx: number): number | null => {
    const n = Number(row[idx]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // Walk backwards to the last populated month — trailing columns are often
  // blank for smaller metros.
  let latest: number | null = null;
  let latestMonth: string | null = null;
  let latestPos = -1;

  for (let p = monthIdxs.length - 1; p >= 0; p--) {
    const v = valueAt(monthIdxs[p].i);
    if (v !== null) {
      latest = v;
      latestMonth = monthIdxs[p].h;
      latestPos = p;
      break;
    }
  }

  const yearAgoPos = latestPos - 12;
  const yearAgo =
    yearAgoPos >= 0 ? valueAt(monthIdxs[yearAgoPos].i) : null;

  return { latest, latestMonth, yearAgo };
}

export async function fetchZori(metro: MetroRef): Promise<ZillowSeries> {
  const csv = await fetchText('zillow-zori', ZORI_URL);
  return extractSeries(csv, metro.zillowRegionName);
}

export async function fetchZhvi(metro: MetroRef): Promise<ZillowSeries> {
  const csv = await fetchText('zillow-zhvi', ZHVI_URL);
  return extractSeries(csv, metro.zillowRegionName);
}

/**
 * Trailing 12-month appreciation. Feed this into MarketAssumptions rather than
 * guessing — but do NOT project it forward unmodified. One year of ZHVI is a
 * terrible 10-year forecast; use it to sanity-check your assumption, not to set it.
 */
export function impliedAppreciation(series: ZillowSeries): number | null {
  if (series.latest === null || series.yearAgo === null || series.yearAgo === 0) {
    return null;
  }
  return series.latest / series.yearAgo - 1;
}
