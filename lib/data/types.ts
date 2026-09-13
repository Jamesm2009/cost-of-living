/**
 * lib/data/types.ts
 *
 * Normalized shapes every data source resolves to. The rest of the app never
 * sees a Census variable code or a BLS series ID — sources translate into
 * these, so swapping a provider later touches one file.
 */

export interface MetroRef {
  /** Stable internal id, matching a locality in /data/localities. */
  localityId: string;
  /** Census place FIPS: state + place, e.g. "48" + "27000" for Fort Worth. */
  stateFips: string;
  placeFips: string;
  /** County FIPS for HUD, e.g. "48439" for Tarrant County. */
  countyFips: string;
  /** CBSA / metro code for HUD FMR and BEA RPP, e.g. "19100" for DFW. */
  cbsaCode: string;
  /** BLS CPI region series prefix, e.g. "CUUR0300SA0" for the South. */
  cpiSeriesId: string;
  /** Zillow's metro region name, exactly as spelled in their CSV. */
  zillowRegionName: string;
}

export interface RentBenchmarks {
  /** Median gross rent, all units (Census ACS). */
  medianGrossRent: number | null;
  /** HUD Fair Market Rent by bedroom count. Index 0 = studio. */
  fmrByBedroom: (number | null)[];
  /** Zillow Observed Rent Index, most recent month. */
  zori: number | null;
  zoriMonth: string | null;
}

export interface HomeValueBenchmarks {
  /** Census ACS median owner-occupied home value. */
  medianHomeValue: number | null;
  /** Zillow Home Value Index, most recent month. */
  zhvi: number | null;
  zhviMonth: string | null;
  /** Trailing 12-month appreciation implied by ZHVI. */
  impliedAppreciation: number | null;
}

export interface PriceBenchmarks {
  /**
   * BEA Regional Price Parity — the scaling factor for budget categories you
   * don't itemize. 100 = national average.
   */
  regionalPriceParity: number | null;
  rppYear: number | null;
  /** Regional CPI level and year-over-year change (BLS). */
  cpiIndex: number | null;
  cpiYoY: number | null;
  /** Average regular gasoline price, $/gal (EIA). */
  gasolinePrice: number | null;
}

export interface MetroSnapshot {
  localityId: string;
  rent: RentBenchmarks;
  homeValue: HomeValueBenchmarks;
  prices: PriceBenchmarks;
  /** Sources that failed this run. Non-empty means partial data. */
  errors: string[];
}
