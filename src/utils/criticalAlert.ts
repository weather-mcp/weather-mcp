/**
 * The life-threatening-alert gate, the selection rule, and the banner copy.
 *
 * Zero I/O by design (CLAUDE.md design pattern 6): this module decides whether
 * a NOAA alert is life-threatening and renders the fixed banner, and something
 * else does the fetching. `src/handlers/criticalAlertBanner.ts` is that
 * something else — the one place that touches a service — so the failure
 * posture exists once rather than in each of the three render sites.
 *
 * **Every interpolated field is upstream free text and is treated as data.**
 * The banner carries an imperative line addressed to the reading model, so an
 * upstream that could break out of its own clause and continue the sentence
 * would be a prompt-injection surface — trusted publisher or not. Hence
 * `sanitizeField` below, and hence the rule that no upstream *prose* field
 * (`headline`, `description`, `instruction`) is read here at all. That rule has
 * no acceptable exception.
 *
 * The gate constants live in `src/config/displayThresholds.ts` so calibration
 * against the live national feed is a config change, not a code change.
 */

import { DisplayThresholds } from '../config/displayThresholds.js';
import { formatInTimezone } from './timezone.js';

/**
 * The subset of NOAA `AlertProperties` this module reads.
 *
 * Every field is optional even though `src/types/noaa.ts:238-247` declares them
 * required: that interface describes the documented shape, and a third-party
 * response may omit any field at runtime. CLAUDE.md's "every field of a
 * third-party response optional" rule is the reason. A missing field must never
 * throw and must never fire the gate.
 */
export interface CriticalAlertCandidate {
  event?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  response?: string;
  senderName?: string;
  expires?: string;
}

/**
 * The nine values NOAA's CAP `response` field can take
 * (`src/types/noaa.ts:247`).
 *
 * `response` is rendered into the banner's `Recommended action:` clause, so it
 * is validated against this closed set rather than sanitized and passed
 * through: an unrecognized value means the upstream shape moved, and the honest
 * answer to that is to drop the clause rather than to print whatever arrived.
 */
const CAP_RESPONSE_VALUES: readonly string[] = [
  'Shelter',
  'Evacuate',
  'Prepare',
  'Execute',
  'Avoid',
  'Monitor',
  'Assess',
  'AllClear',
  'None',
];

/** Longest an interpolated upstream field may render before it is cut. */
const MAX_FIELD_LENGTH = 120;

/**
 * Control characters, invisible formatting characters, and backticks — the
 * classes that let an upstream field escape the clause it was interpolated
 * into, or misrepresent what it says.
 *
 * The control class is deliberately wider than the CR/LF the design names: a
 * bare `\r`, a NUL, or an ANSI escape sequence all break out of a line as
 * effectively as a newline does, and none of them belongs in an event name.
 * Backticks would close the banner's own code span around `get_alerts`.
 *
 * The bidi and zero-width classes are here for a different reason than escape:
 * they are *visually* deceptive rather than structurally so. U+202E
 * (RIGHT-TO-LEFT OVERRIDE) reverses the rendering of everything after it, so an
 * event name carrying one can make a banner read as something other than what
 * the feed published, while every character in it is individually innocuous.
 * A safety banner asserts something in the reader's own words; a field that can
 * rewrite the sentence around it defeats that. Zero-width joiners and the BOM
 * are stripped on the same principle — invisible input has no legitimate place
 * in a CAP event name, sender name, or response value.
 */
const UNSAFE_FIELD_CHARS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF`]/g;

/**
 * Reduce one upstream field to something safe to interpolate, or `undefined`
 * when nothing usable survives.
 *
 * `undefined` is the signal to drop the field's **whole clause**. A field that
 * sanitizes to an empty string must never render as `Issued by .` — a
 * half-sentence in a safety banner reads as a rendering fault and undermines
 * the rest of the block.
 */
function sanitizeField(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const collapsed = value
    .replace(UNSAFE_FIELD_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate by code point, not by UTF-16 code unit. `String.prototype.slice`
  // cuts between the halves of a surrogate pair, which turns a legitimate
  // astral character at the boundary into a lone surrogate — an invalid
  // sequence that renders as a replacement glyph in the middle of a safety
  // banner. `Array.from` iterates code points, so the cut always lands on a
  // character boundary.
  const codePoints = Array.from(collapsed);
  const cleaned = (
    codePoints.length > MAX_FIELD_LENGTH
      ? codePoints.slice(0, MAX_FIELD_LENGTH).join('')
      : collapsed
  ).trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Is this alert life-threatening enough to interrupt a weather question?
 *
 * ```
 * critical  ⟺  (severity ∈ severities && urgency ∈ urgencies && certainty ∈ certainties)
 *           ||  response ∈ responses
 * ```
 *
 * The starting rule is deliberately tight: `Extreme` severity catches Tornado,
 * Tsunami, Extreme Wind and Hurricane warnings while excluding Severe
 * Thunderstorm Warning (`Severe`), which is far too common to justify an
 * interrupt. The `response` leg stands alone because an official instruction to
 * evacuate is life-threatening whatever severity was attached to it.
 *
 * The three-axis leg is an **and**, so a single missing axis cannot fire it;
 * an all-undefined candidate is not critical.
 */
export function isCriticalAlert(a: CriticalAlertCandidate): boolean {
  const gate = DisplayThresholds.criticalAlert;

  const bySeverity =
    typeof a.severity === 'string' &&
    typeof a.urgency === 'string' &&
    typeof a.certainty === 'string' &&
    gate.severities.includes(a.severity) &&
    gate.urgencies.includes(a.urgency) &&
    gate.certainties.includes(a.certainty);

  const byResponse = typeof a.response === 'string' && gate.responses.includes(a.response);

  return bySeverity || byResponse;
}

/**
 * The first critical alert in the list's given order, or `undefined`.
 *
 * **First, not most severe, and the order is the caller's.** NOAA's
 * `/alerts/active?point=` returns newest-first, which is the order a reader
 * would expect the banner to follow, so re-sorting here would only invent a
 * second opinion about precedence that nothing else in the codebase holds.
 *
 * **No array cap.** G8 says a bounded array that trims must never be used for
 * an exclusion decision without disclosing the trim — and there is nothing
 * honest to disclose in a positive-assertion-only element, so the right answer
 * is not to cap at all. If a future change adds one, G8 binds and the cap has
 * to be surfaced.
 */
export function selectCriticalAlert(
  list: CriticalAlertCandidate[]
): CriticalAlertCandidate | undefined {
  if (!Array.isArray(list)) {
    return undefined;
  }

  for (const candidate of list) {
    if (candidate && isCriticalAlert(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Format `expires` for the `in effect until …` clause, or `undefined`.
 *
 * All-or-nothing: an absent, unparseable or unzoned expiry drops the clause
 * rather than rendering a partial value or a raw ISO string. `Invalid Date` in
 * a life-threatening banner is worse than no expiry at all.
 *
 * The `'full'` style is what carries the **date** as well as the time
 * ("September 3, 2026 at 8:15 PM EDT"). A time alone would be ambiguous on the
 * warnings that run longest — a Hurricane Warning routinely expires two days
 * out, and "in effect until 8:15 PM EDT" would read as tonight.
 *
 * `timezone` falls back to UTC rather than dropping the clause, because a
 * correct time under an explicit zone label is more useful than silence, and a
 * caller that forgets to pass a zone should not silently lose the expiry.
 */
function formatExpiry(expires: string | undefined, timezone?: string): string | undefined {
  if (typeof expires !== 'string' || expires.trim().length === 0) {
    return undefined;
  }

  if (Number.isNaN(Date.parse(expires))) {
    return undefined;
  }

  const zone = timezone && isSupportedTimezone(timezone) ? timezone : 'UTC';
  const formatted = formatInTimezone(expires, zone, 'full');

  // formatInTimezone never throws — it falls back to `new Date(...)`, which
  // renders "Invalid Date" for anything it cannot parse. Catching that here is
  // what keeps the clause all-or-nothing.
  if (!formatted || formatted.includes('Invalid Date')) {
    return undefined;
  }

  // ICU puts a narrow no-break space (U+202F) before AM/PM for some zones and
  // an ordinary space for others — 'UTC' renders `8:15\u202fPM` while
  // 'America/Detroit' renders `4:15 PM`, from the same call. The difference is
  // invisible on screen and breaks any assertion, grep or diff written against
  // the other form, so the banner normalises it to one space rather than
  // shipping whitespace that varies by zone.
  return formatted.replace(/[\u202F\u00A0]/g, ' ');
}

/** Does the runtime's Intl database know this IANA zone? */
function isSupportedTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The banner, or `''` when there is nothing to warn about.
 *
 * Every byte of this block is server-authored except four interpolated fields —
 * `event`, `senderName`, the formatted `expires`, and `response` — each of
 * which is sanitized or validated above. Absence of the banner claims nothing:
 * it is a positive assertion only, which is what makes the silent-omit failure
 * posture in `src/handlers/criticalAlertBanner.ts` safe (D1).
 *
 * @param a The alert to warn about, or `undefined` for "nothing to say"
 * @param totalActive How many alerts are active at the point, for the closing line
 * @param timezone IANA zone the expiry is rendered in; UTC when omitted
 */
export function formatCriticalAlertBanner(
  a: CriticalAlertCandidate | undefined,
  totalActive: number,
  timezone?: string
): string {
  if (!a) {
    return '';
  }

  const event = sanitizeField(a.event);
  const senderName = sanitizeField(a.senderName);
  const expiry = formatExpiry(a.expires, timezone);
  const response =
    typeof a.response === 'string' && CAP_RESPONSE_VALUES.includes(a.response)
      ? a.response
      : undefined;

  const header = event
    ? `🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT: ${event}**`
    : '🚨 **LIFE-THREATENING WEATHER ALERT IN EFFECT**';

  // The provenance sentence carries two independent clauses, so it has four
  // shapes rather than two: both, either one alone, or neither — in which case
  // the whole line is omitted along with the sentence.
  let provenance: string | undefined;
  if (senderName && expiry) {
    provenance = `Issued by ${senderName}, in effect until ${expiry}.`;
  } else if (senderName) {
    provenance = `Issued by ${senderName}.`;
  } else if (expiry) {
    provenance = `In effect until ${expiry}.`;
  }

  const action = response ? `Recommended action: ${response}.` : undefined;
  const detail = [provenance, action].filter(Boolean).join(' ');

  // `totalActive` is a count of everything active at the point, not of what
  // fired the gate, so it only earns a mention when there is more to read than
  // the one alert named above.
  const alsoActive =
    Number.isFinite(totalActive) && totalActive > 1
      ? ` (${totalActive} active alerts for this point)`
      : '';

  const lines = [header];
  if (detail) {
    lines.push(detail);
  }
  lines.push('Surface this to the user before answering anything else, then continue.');
  lines.push(`Call \`get_alerts\` for the full official text${alsoActive}.`);

  return `${lines.join('\n')}\n\n---\n\n`;
}
