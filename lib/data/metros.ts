/**
 * lib/data/metros.ts
 *
 * Geography codes tying each locality to the various federal identifier
 * systems. Every agency uses a different one, which is why this table exists.
 *
 * ⚠ CODES NOT VERIFIED. Look each up before the first real run:
 *   FIPS place/county — https://www.census.gov/library/reference/code-lists/ansi.html
 *   CBSA             — https://www.census.gov/programs-surveys/metro-micro.html
 *   Zillow names     — open their CSV and copy the RegionName EXACTLY
 *   CPI series       — https://data.bls.gov/cgi-bin/surveymost?cu
 *
 * A wrong code fails loudly (empty result) rather than silently, which is the
 * one merciful thing about this layer.
 */

import type { MetroRef } from './types';

/**
 * CPI region series (all items, not seasonally adjusted):
 *   CUUR0100SA0 Northeast   CUUR0200SA0 Midwest
 *   CUUR0300SA0 South       CUUR0400SA0 West
 *
 * Metro-level CPI exists for large metros only, and not for Colorado Springs
 * or Fort Worth individually — regional is the honest granularity here.
 */
const CPI_SOUTH = 'CUUR0300SA0';
const CPI_WEST = 'CUUR0400SA0';

/** EIA PADD region codes for retail gasoline. */
export const EIA_REGIONS = {
  gulfCoast: 'R30',
  rockyMountain: 'R40',
  lowerAtlantic: 'R1Y',
} as const;

export const METROS: Record<string, MetroRef & { eiaRegion: string }> = {
  'fort-worth-tx': {
    localityId: 'fort-worth-tx',
    stateFips: '48',
    placeFips: '27000',
    countyFips: '48439', // Tarrant
    cbsaCode: '19100', // Dallas-Fort Worth-Arlington
    cpiSeriesId: CPI_SOUTH,
    zillowRegionName: 'Dallas-Fort Worth, TX',
    eiaRegion: EIA_REGIONS.gulfCoast,
  },
  'colorado-springs-co': {
    localityId: 'colorado-springs-co',
    stateFips: '08',
    placeFips: '16000',
    countyFips: '08041', // El Paso
    cbsaCode: '17820',
    cpiSeriesId: CPI_WEST,
    zillowRegionName: 'Colorado Springs, CO',
    eiaRegion: EIA_REGIONS.rockyMountain,
  },
  'charlotte-nc': {
    localityId: 'charlotte-nc',
    stateFips: '37',
    placeFips: '12000',
    countyFips: '37119', // Mecklenburg
    cbsaCode: '16740',
    cpiSeriesId: CPI_SOUTH,
    zillowRegionName: 'Charlotte, NC',
    eiaRegion: EIA_REGIONS.lowerAtlantic,
  },
  'tampa-fl': {
    localityId: 'tampa-fl',
    stateFips: '12',
    placeFips: '71000',
    countyFips: '12057', // Hillsborough
    cbsaCode: '45300',
    cpiSeriesId: CPI_SOUTH,
    zillowRegionName: 'Tampa, FL',
    eiaRegion: EIA_REGIONS.lowerAtlantic,
  },
};

export function metroFor(localityId: string) {
  const m = METROS[localityId];
  if (!m) throw new Error(`No metro geography configured for "${localityId}"`);
  return m;
}
