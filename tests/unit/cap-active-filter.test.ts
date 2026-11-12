/**
 * The shared CAP lifecycle filter (`src/utils/capActiveFilter.ts`) and the
 * `Cancel` rule it adds (RF-28 M3, plan-alert-territory-trim-cancel §3).
 *
 * Every contract is asserted through **both** exported filters —
 * `filterActiveCapWarnings` (national CAP) and `filterActiveWarnings`
 * (MeteoAlarm) — and through the core. The ingestion block drives an info-less
 * `Cancel` through each real parser seam, because a filter that is correct but
 * unreachable fixes nothing (plan-review codex R1).
 *
 * Fixed `now`; fixtures carry distinct expiries (G13). `references` are the
 * identifiers `parseReferences` keeps from SACHET's `sender,identifier,sent`
 * triples (G48); one case runs a real triple through it first.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: (...args: unknown[]) => mockGet(...args),
      interceptors: { response: { use: vi.fn() } }
    }))
  }
}));

import { filterCapLifecycle } from '../../src/utils/capActiveFilter.js';
import {
  filterActiveCapWarnings,
  flattenCapAlert,
  parseCapDocument,
  parseReferences
} from '../../src/utils/capParse.js';
import { filterActiveWarnings, MeteoAlarmService } from '../../src/services/meteoalarm.js';
import type { NationalCapWarning } from '../../src/types/cap.js';
import type { MeteoAlarmWarning, MeteoAlarmCapAlert } from '../../src/types/meteoalarm.js';

const NOW = new Date('2026-11-11T12:00:00Z');
/** Distinct future and past instants relative to NOW. */
const IN_ONE_HOUR = '2026-11-11T13:00:00Z';
const IN_SIX_HOURS = '2026-11-11T18:00:00Z';
const IN_TWO_DAYS = '2026-11-13T12:00:00Z';
const AN_HOUR_AGO = '2026-11-11T11:00:00Z';
const A_DAY_AGO = '2026-11-10T12:00:00Z';

/** The lifecycle fields every test states explicitly; no defaults (G95). */
interface Lifecycle {
  identifier: string;
  status: string | undefined;
  msgType: string;
  expires: string | undefined;
  references: string[];
  responseType?: string[];
}

function asNational(record: Lifecycle): NationalCapWarning {
  return {
    identifier: record.identifier,
    status: record.status,
    msgType: record.msgType,
    expires: record.expires,
    references: record.references,
    responseType: record.responseType,
    areaDesc: ['Test area'],
    polygons: [],
    countryCode: 'in'
  };
}

function asMeteoAlarm(record: Lifecycle): MeteoAlarmWarning {
  return {
    identifier: record.identifier,
    status: record.status,
    msgType: record.msgType,
    expires: record.expires,
    references: record.references,
    areaDesc: ['Test area']
  };
}

/** Run one list through the core and both exported filters; return each surviving identifier list. */
function survivors(records: Lifecycle[]): { core: string[]; national: string[]; meteoAlarm: string[] } {
  return {
    core: filterCapLifecycle(records.map(asMeteoAlarm), NOW).map(w => w.identifier),
    national: filterActiveCapWarnings(records.map(asNational), NOW).map(w => w.identifier),
    meteoAlarm: filterActiveWarnings(records.map(asMeteoAlarm), NOW).map(w => w.identifier)
  };
}

function expectAllThree(records: Lifecycle[], expected: string[]): void {
  const result = survivors(records);
  expect(result.core).toEqual(expected);
  expect(result.national).toEqual(expected);
  expect(result.meteoAlarm).toEqual(expected);
}

const TARGET: Lifecycle = {
  identifier: 'IN-1794312226427017_45',
  status: 'Actual',
  msgType: 'Alert',
  expires: IN_TWO_DAYS,
  references: []
};

const BYSTANDER: Lifecycle = {
  identifier: 'IN-1794312226427017_46',
  status: 'Actual',
  msgType: 'Alert',
  expires: IN_SIX_HOURS,
  references: []
};

describe('filterCapLifecycle — an Actual Cancel retires what it references', () => {
  it('retires a listed, unexpired alert; the Cancel itself never survives', () => {
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: 'Actual',
      msgType: 'Cancel',
      expires: IN_ONE_HOUR,
      references: [TARGET.identifier]
    };
    expectAllThree([TARGET, BYSTANDER, cancel], [BYSTANDER.identifier]);
  });

  it('retires it even when the Cancel has already expired', () => {
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: 'Actual',
      msgType: 'Cancel',
      expires: AN_HOUR_AGO,
      references: [TARGET.identifier]
    };
    expectAllThree([TARGET, BYSTANDER, cancel], [BYSTANDER.identifier]);
  });

  it('retires it from a real SACHET references triple run through parseReferences', () => {
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: 'Actual',
      msgType: 'Cancel',
      expires: IN_ONE_HOUR,
      references: parseReferences(`IMD-Test,${TARGET.identifier},2026-11-11T08:23:59+05:30`)
    };
    expect(cancel.references).toEqual([TARGET.identifier]);
    expectAllThree([TARGET, BYSTANDER, cancel], [BYSTANDER.identifier]);
  });

  it('retires it when the Cancel carries no status (an absent status reads as Actual)', () => {
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: undefined,
      msgType: 'Cancel',
      expires: IN_ONE_HOUR,
      references: [TARGET.identifier]
    };
    expectAllThree([TARGET, BYSTANDER, cancel], [BYSTANDER.identifier]);
  });

  for (const status of ['Test', 'Exercise']) {
    it(`a ${status} Cancel retires nothing, and never renders`, () => {
      const cancel: Lifecycle = {
        identifier: 'IN-CANCEL-1',
        status,
        msgType: 'Cancel',
        expires: IN_ONE_HOUR,
        references: [TARGET.identifier]
      };
      expectAllThree([TARGET, BYSTANDER, cancel], [TARGET.identifier, BYSTANDER.identifier]);
    });
  }

  it('a Cancel referencing an identifier not in the list changes nothing (the observed SACHET case)', () => {
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: 'Actual',
      msgType: 'Cancel',
      expires: A_DAY_AGO,
      references: ['IN-NOT-IN-THE-INDEX_9']
    };
    expectAllThree([TARGET, BYSTANDER, cancel], [TARGET.identifier, BYSTANDER.identifier]);
  });

  it('an expired Update stays inert while a Cancel in the same list still retires', () => {
    const expiredUpdate: Lifecycle = {
      identifier: 'IN-UPDATE-1',
      status: 'Actual',
      msgType: 'Update',
      expires: A_DAY_AGO,
      references: [BYSTANDER.identifier]
    };
    const cancel: Lifecycle = {
      identifier: 'IN-CANCEL-1',
      status: 'Actual',
      msgType: 'Cancel',
      expires: AN_HOUR_AGO,
      references: [TARGET.identifier]
    };
    expectAllThree([TARGET, BYSTANDER, expiredUpdate, cancel], [BYSTANDER.identifier]);
  });

  it('PAGASA Final (Update + AllClear) still retires its target, and the AllClear message is dropped', () => {
    const advisory: Lifecycle = {
      identifier: 'PH-ADVISORY-1',
      status: 'Actual',
      msgType: 'Alert',
      expires: IN_TWO_DAYS,
      references: []
    };
    const final: Lifecycle = {
      identifier: 'PH-ADVISORY-1-FINAL',
      status: 'Actual',
      msgType: 'Update',
      expires: IN_SIX_HOURS,
      references: [advisory.identifier],
      responseType: ['AllClear']
    };
    const national = filterActiveCapWarnings([advisory, final].map(asNational), NOW).map(w => w.identifier);
    expect(national).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ingestion seams — an info-less Cancel must reach the filter (codex R1)
// ---------------------------------------------------------------------------

function infoLessCancelXml(status: string): string {
  return `<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">
<cap:identifier>IN-CANCEL-2</cap:identifier>
<cap:sender>Test-SDMA</cap:sender>
<cap:sent>2026-11-11T17:00:00+05:30</cap:sent>
<cap:status>${status}</cap:status>
<cap:msgType>Cancel</cap:msgType>
<cap:scope>Public</cap:scope>
<cap:references>Test-SDMA,${TARGET.identifier},2026-11-11T08:23:59+05:30</cap:references>
</cap:alert>`;
}

describe('national CAP ingestion — an info-less Cancel survives flattenCapAlert', () => {
  const feed = { preferLanguage: 'en', polygonSource: 'linked-parameter' } as const;

  it('parseCapDocument → flattenCapAlert → filterActiveCapWarnings retires the listed target', () => {
    const cancel = flattenCapAlert(parseCapDocument(infoLessCancelXml('Actual')), feed, 'in');

    expect(cancel).toMatchObject({
      identifier: 'IN-CANCEL-2',
      msgType: 'Cancel',
      references: [TARGET.identifier],
      areaDesc: [],
      polygons: []
    });

    const view = filterActiveCapWarnings([asNational(TARGET), asNational(BYSTANDER), cancel!], NOW);
    expect(view.map(w => w.identifier)).toEqual([BYSTANDER.identifier]);
  });

  for (const status of ['Test', 'Exercise']) {
    it(`a ${status} info-less Cancel is kept by the parser and retires nothing at the filter`, () => {
      const cancel = flattenCapAlert(parseCapDocument(infoLessCancelXml(status)), feed, 'in');
      expect(cancel?.msgType).toBe('Cancel');

      const view = filterActiveCapWarnings([asNational(TARGET), cancel!], NOW);
      expect(view.map(w => w.identifier)).toEqual([TARGET.identifier]);
    });
  }

  it('an info-less Cancel with no references is still an unusable shape', () => {
    const xml = infoLessCancelXml('Actual').replace(/<cap:references>.*<\/cap:references>\n/, '');
    expect(flattenCapAlert(parseCapDocument(xml), feed, 'in')).toBeUndefined();
  });

  it('an info-less Alert with references is still an unusable shape', () => {
    const xml = infoLessCancelXml('Actual').replace('<cap:msgType>Cancel</cap:msgType>', '<cap:msgType>Alert</cap:msgType>');
    expect(flattenCapAlert(parseCapDocument(xml), feed, 'in')).toBeUndefined();
  });
});

/** A MeteoAlarm entry with every field stated; unexpired well past any run date. */
function meteoAlarmTarget(): MeteoAlarmCapAlert {
  return {
    identifier: 'MA-TARGET-1',
    sender: 'https://www.metoffice.gov.uk/',
    sent: '2026-11-11T09:00:00+00:00',
    status: 'Actual',
    msgType: 'Alert',
    scope: 'Public',
    info: [
      {
        language: 'en',
        event: 'Yellow wind warning',
        severity: 'Moderate',
        urgency: 'Immediate',
        certainty: 'Likely',
        expires: '2099-01-01T00:00:00+00:00',
        headline: 'Strong winds',
        senderName: 'UK Met Office',
        area: [{ areaDesc: 'Northern Ireland' }]
      }
    ]
  };
}

function meteoAlarmInfoLessCancel(status: string, references: string | undefined): MeteoAlarmCapAlert {
  return {
    identifier: 'MA-CANCEL-1',
    sender: 'https://www.metoffice.gov.uk/',
    sent: '2026-11-11T10:00:00+00:00',
    status,
    msgType: 'Cancel',
    scope: 'Public',
    references
  };
}

describe('MeteoAlarm ingestion — an info-less Cancel survives parseFeed', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  function feedOf(...alerts: MeteoAlarmCapAlert[]) {
    return { data: { warnings: alerts.map((alert, index) => ({ alert, uuid: `uuid-${index}` })) }, status: 200 };
  }

  it('MeteoAlarmService.getWarnings drops both the target and the info-less Actual Cancel', async () => {
    mockGet.mockImplementation(async () =>
      feedOf(meteoAlarmTarget(), meteoAlarmInfoLessCancel('Actual', 'https://www.metoffice.gov.uk/,MA-TARGET-1,2026-11-11T09:00:00+00:00'))
    );
    const service = new MeteoAlarmService();

    const warnings = await service.getWarnings('gb');

    expect(warnings.map(w => w.identifier)).toEqual([]);
  });

  it('positive control: without the Cancel the target is served', async () => {
    mockGet.mockImplementation(async () => feedOf(meteoAlarmTarget()));
    const service = new MeteoAlarmService();

    const warnings = await service.getWarnings('gb');

    expect(warnings.map(w => w.identifier)).toEqual(['MA-TARGET-1']);
  });

  for (const status of ['Test', 'Exercise']) {
    it(`a ${status} info-less Cancel leaves the target served`, async () => {
      mockGet.mockImplementation(async () =>
        feedOf(meteoAlarmTarget(), meteoAlarmInfoLessCancel(status, 'https://www.metoffice.gov.uk/,MA-TARGET-1,2026-11-11T09:00:00+00:00'))
      );
      const service = new MeteoAlarmService();

      const warnings = await service.getWarnings('gb');

      expect(warnings.map(w => w.identifier)).toEqual(['MA-TARGET-1']);
    });
  }

  it('an info-less Cancel with no references is still skipped (the target stays)', async () => {
    mockGet.mockImplementation(async () => feedOf(meteoAlarmTarget(), meteoAlarmInfoLessCancel('Actual', undefined)));
    const service = new MeteoAlarmService();

    const warnings = await service.getWarnings('gb');

    expect(warnings.map(w => w.identifier)).toEqual(['MA-TARGET-1']);
  });
});
