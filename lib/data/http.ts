/**
 * lib/data/http.ts
 *
 * Shared fetch wrapper for the public data APIs.
 *
 * Government APIs are slower and flakier than commercial ones, and several of
 * these go down for maintenance without notice. Every call gets a timeout and
 * bounded retries so a stalled request can't hang a serverless function until
 * Vercel kills it.
 */

export class DataSourceError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public readonly status?: number,
  ) {
    super(`[${source}] ${message}`);
    this.name = 'DataSourceError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch JSON with timeout and exponential backoff.
 *
 * Retries only on 5xx and network errors. A 4xx means the request itself is
 * wrong (bad key, bad geography code) and retrying just wastes the function's
 * execution budget.
 */
export async function fetchJson<T>(
  source: string,
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { timeoutMs = 15_000, retries = 2, headers = {}, method = 'GET', body } = opts;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const err = new DataSourceError(
          source,
          `HTTP ${res.status}: ${detail.slice(0, 200)}`,
          res.status,
        );
        // Client errors are not transient — fail immediately.
        if (res.status < 500) throw err;
        lastError = err;
        continue;
      }

      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof DataSourceError && err.status && err.status < 500) {
        throw err;
      }
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DataSourceError(
    source,
    `Failed after ${retries + 1} attempts: ${String(lastError)}`,
  );
}

/** Same, for endpoints that return CSV rather than JSON (Zillow). */
export async function fetchText(
  source: string,
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const { timeoutMs = 30_000, retries = 2 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(500 * Math.pow(2, attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const err = new DataSourceError(source, `HTTP ${res.status}`, res.status);
        if (res.status < 500) throw err;
        lastError = err;
        continue;
      }
      return await res.text();
    } catch (err) {
      if (err instanceof DataSourceError && err.status && err.status < 500) throw err;
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new DataSourceError(source, `Failed: ${String(lastError)}`);
}

/** Read a required env var with a message that says where to set it. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Add it in Vercel → Settings → Environment Variables, ` +
        `or in .env.local for local development. See .env.example.`,
    );
  }
  return value;
}
