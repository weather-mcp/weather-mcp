/**
 * Live control: every product in FIRMS_PRODUCTS is current (G72).
 *
 * **This file makes live network calls** and runs only under
 * `npm run test:live`. Both rows read `FIRMS_PRODUCTS`, so a table edit is
 * covered with no change here.
 *
 * Row 1 (keyless): HEAD each product's Global 24 h flat file, once plain and
 * once with a cache-buster, and assert `last-modified` is present and
 * `classifyLastModified` says current. If the two readings disagree about
 * whether the header exists, the buster is the variable, not the upstream, and
 * the test says so. A sibling non-product file on the same host
 * (`MODIS_C6_1_Global_24h.csv`) is read in the same row, so a host-wide outage
 * reads differently from one dead product.
 *
 * Row 2 (keyed, needs FIRMS_MAP_KEY): `getProductAvailability()` names every
 * product, and `classifyMaxDate` says each is current. The key is passed to
 * the service and never printed; no keyed URL is logged.
 *
 * Transport failures skip with a message. Anything else is rethrown, and every
 * `expect` sits after its try/catch (G9).
 */

import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { FIRMSService } from '../../src/services/firms.js';
import {
  FIRMS_PRODUCTS,
  classifyLastModified,
  classifyMaxDate,
} from '../../src/utils/firmsProducts.js';

const HOST = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire';
const SIBLING_URL = `${HOST}/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv`;
const HEAD_TIMEOUT_MS = 20_000;

class TransportFailure extends Error {}

function productUrl(p: { flatFileDir: string; flatFilePrefix: string }): string {
  return `${HOST}/${p.flatFileDir}/csv/${p.flatFilePrefix}_Global_24h.csv`;
}

/** HEAD one URL. Returns status and the `last-modified` header (or null). */
async function head(url: string): Promise<{ status: number; lastModified: string | null }> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
    });
    return { status: res.status, lastModified: res.headers.get('last-modified') };
  } catch (err) {
    // fetch rejects with TypeError (connect/DNS/reset) or a Timeout/Abort DOMException.
    const name = err instanceof Error ? err.name : '';
    if (name === 'TypeError' || name === 'TimeoutError' || name === 'AbortError') {
      throw new TransportFailure(`${name} on ${new URL(url).host}`);
    }
    throw err;
  }
}

interface Reading {
  label: string;
  url: string;
  plain: { status: number; lastModified: string | null };
  buster: { status: number; lastModified: string | null };
}

async function readBoth(label: string, url: string): Promise<Reading> {
  const plain = await head(url);
  const buster = await head(`${url}?cb=${Date.now()}${Math.floor(Math.random() * 1e6)}`);
  return { label, url, plain, buster };
}

describe('FIRMS product freshness — keyless flat files (live)', () => {
  it('every product and the MODIS sibling control are current', async () => {
    let readings: Reading[] | undefined;
    try {
      readings = [];
      readings.push(await readBoth('sibling MODIS_C6_1', SIBLING_URL));
      for (const p of FIRMS_PRODUCTS) {
        readings.push(await readBoth(p.id, productUrl(p)));
      }
    } catch (err) {
      if (err instanceof TransportFailure) {
        console.warn(`FIRMS freshness (flat files) skipped — network error: ${err.message}`);
        readings = undefined;
      } else {
        throw err;
      }
    }

    if (readings === undefined) {
      return;
    }

    expect(FIRMS_PRODUCTS.length, 'FIRMS_PRODUCTS is empty; the loop would pass vacuously').toBeGreaterThan(0);
    const now = Date.now();
    const sibling = readings[0] as Reading;
    const siblingState = classifyLastModified(sibling.plain.lastModified ?? undefined, now).state;
    const hostNote =
      sibling.plain.lastModified === null || siblingState !== 'current'
        ? 'sibling control is NOT current: the whole host looks down or stale, not one product'
        : 'sibling control is current: any stale product below is that product alone';

    for (const r of readings) {
      expect(r.plain.status, `${r.label}: plain HEAD status`).toBe(200);
      expect(r.buster.status, `${r.label}: cache-busted HEAD status`).toBe(200);
      expect(
        r.plain.lastModified !== null,
        `${r.label}: the plain and cache-busted readings disagree about whether last-modified exists ` +
          `(plain=${r.plain.lastModified !== null}, buster=${r.buster.lastModified !== null}); ` +
          'the buster is the variable, not the upstream',
      ).toBe(r.buster.lastModified !== null);
      expect(r.plain.lastModified, `${r.label}: no last-modified header; ${hostNote}`).not.toBeNull();
      const verdict = classifyLastModified(r.plain.lastModified ?? undefined, now);
      expect(
        verdict,
        `${r.label}: last-modified ${r.plain.lastModified} is stale (${r.url}); ${hostNote}`,
      ).toEqual({ state: 'current' });
    }
  });
});

const KEY = process.env.FIRMS_MAP_KEY;
const itKeyed = KEY ? it : it.skip;

describe('FIRMS product freshness — keyed data_availability (live)', () => {
  itKeyed(
    KEY ? 'every product max_date is current' : 'every product max_date is current (skipped: FIRMS_MAP_KEY unset)',
    async () => {
      const service = new FIRMSService({ mapKey: KEY });
      // getProductAvailability never throws by contract: it maps every transport,
      // HTTP and key failure to undefined, and the runtime check then fails open.
      // So undefined is exactly the silently dead keyed check this control exists
      // to catch. With a key set it fails; it is never a skip.
      const availability = await service.getProductAvailability();
      expect(
        availability,
        'FIRMS data_availability returned no table with FIRMS_MAP_KEY set ' +
          '(rejected key, HTTP error, transport failure or empty body); ' +
          'the runtime freshness check is failing open for every keyed product',
      ).toBeDefined();
      if (availability === undefined) {
        return;
      }

      const now = Date.now();
      for (const p of FIRMS_PRODUCTS) {
        const maxDate = availability.get(p.id);
        expect(maxDate, `${p.id} missing from data_availability`).toBeDefined();
        expect(
          classifyMaxDate(maxDate, now),
          `${p.id}: max_date ${maxDate} is stale`,
        ).toEqual({ state: 'current' });
      }
    },
  );
});
