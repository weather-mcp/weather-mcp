/**
 * JMA warning-name gloss table and tier classifier.
 *
 * Pure, zero-I/O module — no imports at all, not even types (design pattern 6
 * in CLAUDE.md: service fetches -> pure util computes -> handler renders).
 * Every function here is total over its declared input: it never throws, and
 * an input it cannot classify or gloss returns `undefined` rather than a
 * guess. This is deliberately structural, not just tested-to-be-true: every
 * exported function opens with an `if (!x) return undefined;` guard, and the
 * only other code paths are object-key lookups and `String.prototype.endsWith`
 * / `slice`, none of which can throw on a `string`.
 *
 * **This table is a convenience, not the source of truth.** The Japanese
 * warning name is always present inline in the parsed payload
 * (`JmaWarningKind.name` in `src/types/jma.ts`, e.g. `"大雨警報"`) and is
 * rendered verbatim regardless of whether this module recognises it. Losing
 * this table would degrade the English gloss line to "no English available,"
 * never drop a warning — see `docs/TOOLS.md`/handler wiring in a later task.
 *
 * ## Keying decision
 *
 * The lookup keys on the **Japanese name's phenomenon prefix**, not on
 * `JmaWarningKind.code`. Two reasons, both from the live sample recorded in
 * T4 (`.devdocs` plan, 14 documents / 11 distinct name+code pairs, reproduced
 * in this file's tests):
 *
 *   - `code` is a bare two-digit string (`"03"`, `"10"`, ...) with no visible
 *     structure tying a code to a tier or phenomenon — nothing published
 *     alongside the feed says code 03 is "heavy rain warning" rather than
 *     some other 警報. Treating it as a stable key would be guessing at an
 *     undocumented numbering scheme.
 *   - `name` is what the module's own docblock (and the task that produced
 *     this file) calls "guaranteed present" in the payload that matters —
 *     the whole reason this table can be a convenience layered on top of
 *     verbatim rendering rather than a required decoder.
 *
 * ## Compositional structure (the point of keying this way)
 *
 * JMA's tier is a **suffix** on the Japanese name (`特別警報` / `警報` /
 * `注意報`), and the phenomenon is what is left after stripping it. So
 * rather than a flat `Record<fullName, gloss>` — which would need one entry
 * per phenomenon *times* tier, and would silently miss an unseen combination
 * of a known phenomenon and a known tier — this module keys on the
 * phenomenon alone and composes the tier back in at lookup time. A
 * phenomenon this table has never seen paired with `特別警報` (a real
 * example: `波浪特別警報`, only inferred, not in the live sample) still
 * glosses correctly the first time it is seen, because the phenomenon prefix
 * (`波浪`, "High Waves") is already keyed and the tier suffix composes over
 * any phenomenon.
 *
 * ## The ordering trap this module exists to avoid
 *
 * `大雨特別警報` ends with `特別警報`, which *also* ends with `警報` (`特別警報`
 * contains `警報` as its own suffix: 特-別-警-報). A tier check that tests
 * `endsWith('警報')` before `endsWith('特別警報')` misclassifies every
 * Emergency Warning as an ordinary Warning. `TIER_SUFFIXES` below is an
 * ordered list with `特別警報` listed — and checked — first; see the tests for
 * the specific wrong answers this guards against.
 *
 * ## Source for the English glosses
 *
 * Hand-translation was avoided per this project's convention of not
 * presenting a guess as an official term. The glosses below were sourced
 * from JMA's own published English terminology, cross-checked in two places
 * on 2026-09-03:
 *
 *   - JMA's Emergency Warning System page
 *     (jma.go.jp/jma/en/Emergency_Warning/ew_index.html) confirms
 *     "Emergency Warning" as the official English name for `特別警報`, and a
 *     JMA-sourced summary confirms the compositional English form
 *     "Emergency Warning for Heavy Rain" for `大雨特別警報` specifically
 *     (matching the "`<Tier>` for `<Phenomenon>`" shape used below).
 *   - The English Wikipedia article "Severe weather terminology (Japan)"
 *     tabulates JMA's own English phenomenon names per tier (e.g. "Advisory
 *     for Heavy rain", "Warning for Storm", "Warning for Flood") for every
 *     phenomenon this table covers; it cites JMA as its source for the
 *     terminology, not an independent translation.
 *
 * The **attempted, official multilingual weather-term dictionary** JMA
 * publishes on its advanced-use portal was not reachable from this
 * environment (its warning/advisory listings render client-side; a fetch of
 * the static HTML returned navigation chrome with no phenomenon text) — so
 * it was not the source actually used here, and this docblock says so rather
 * than silently substituting a different source without flagging it (G46).
 *
 * One phenomenon's English name was chosen against a same-named source
 * rather than from it: the task description that produced this file glossed
 * `風雪` as "snowstorm." The two sources above instead show JMA using
 * "Snowstorm" for the *separate* word `暴風雪` (`暴風` storm + `雪` snow, the
 * warning-tier phenomenon) and "Gale and snow" for `風雪` itself (the
 * advisory-tier phenomenon, a milder collocation of "wind" + "snow"). This
 * mirrors a real split elsewhere in the vocabulary — `強風` ("Gale",
 * advisory-only) versus `暴風` ("Storm", warning-only) are two different
 * words for two different tiers, not one word at two tiers — so `風雪` and
 * `暴風雪` were kept as two separate table entries with the JMA/Wikipedia
 * English names rather than collapsed to one gloss borrowed from the task
 * text. See "Surprises" in this task's report.
 *
 * ## Coverage
 *
 * 19 phenomena are keyed (list: `Object.keys(JMA_PHENOMENON_GLOSSES)`),
 * chosen from the live-observed sample (8 phenomena directly seen in the
 * T4 14-document sample: 大雨, 雷, 洪水, 強風, 波浪, 濃霧, 乾燥, 暴風) plus
 * JMA's remaining published phenomena from the task's own reference list
 * and the two sources above (大雪, なだれ, 着雪, 着氷, 融雪, 霜, 低温, 高潮,
 * 風雪, 暴風雪, 竜巻). This is **not** asserted to be every phenomenon JMA
 * can ever publish — an unseen phenomenon degrades to `undefined` from
 * `glossJmaWarningName` (Japanese-only rendering), never a thrown error or a
 * dropped warning.
 */

/** The three JMA severity tiers, in ascending order of the suffix's specificity check below. */
export type JmaTier = 'emergency' | 'warning' | 'advisory';

interface TierSuffix {
  readonly suffix: string;
  readonly tier: JmaTier;
}

/**
 * Tier suffixes, **ordered most-specific-first**. `特別警報` must be checked
 * before `警報` because it ends with `警報` as a substring of itself
 * (`特-別-警-報`) — see the module docblock's "ordering trap" section. Do not
 * reorder this array, and do not replace the loop in `matchTierSuffix` with
 * anything that could iterate it out of order (e.g. sorting by key).
 */
const TIER_SUFFIXES: readonly TierSuffix[] = [
  { suffix: '特別警報', tier: 'emergency' },
  { suffix: '警報', tier: 'warning' },
  { suffix: '注意報', tier: 'advisory' }
];

/** English label for a tier, used to compose a full gloss ("`<label>` for `<phenomenon>`"). */
const TIER_LABELS: Readonly<Record<JmaTier, string>> = {
  emergency: 'Emergency Warning',
  warning: 'Warning',
  advisory: 'Advisory'
};

/**
 * Phenomenon -> English name, keyed on the exact Japanese substring left
 * after stripping a recognised tier suffix from a warning name.
 *
 * Directly observed in the T4 live sample (14 documents, 11 distinct
 * name+code pairs): 大雨, 雷, 洪水, 強風, 波浪, 濃霧, 乾燥, 暴風.
 * Not observed live, added from JMA's published English terminology (see
 * the module docblock's "Source" section): 大雪, なだれ, 着雪, 着氷, 融雪,
 * 霜, 低温, 高潮, 風雪, 暴風雪, 竜巻.
 */
export const JMA_PHENOMENON_GLOSSES: Readonly<Record<string, string>> = {
  '大雨': 'Heavy Rain',
  '洪水': 'Flood',
  '暴風雪': 'Snowstorm',
  '暴風': 'Storm',
  '波浪': 'High Waves',
  '大雪': 'Heavy Snow',
  '雷': 'Thunderstorm',
  '強風': 'Gale',
  '濃霧': 'Dense Fog',
  '乾燥': 'Dry Air',
  'なだれ': 'Avalanche',
  '着雪': 'Wet Snow Accretion',
  '着氷': 'Ice Accretion',
  '融雪': 'Snowmelt',
  '霜': 'Frost',
  '低温': 'Low Temperature',
  '高潮': 'Storm Surge',
  '風雪': 'Gale and Snow',
  '竜巻': 'Tornado'
};

/**
 * `Condition` qualifier -> English gloss, keyed on the exact Japanese string
 * for one qualifier (not a compound). Both entries are the two qualifiers
 * observed live in the T4 sample. See `glossJmaCondition` for how a
 * `、`-joined compound (e.g. `土砂災害、浸水害`) is handled.
 */
const CONDITION_GLOSSES: Readonly<Record<string, string>> = {
  '土砂災害': 'landslide (sediment disaster)',
  '浸水害': 'flood damage (inundation)'
};

/**
 * Find the most specific tier suffix `name` ends with, or `undefined` if it
 * matches none. Internal — both `classifyJmaTier` and `glossJmaWarningName`
 * need this same match (tier, and the exact suffix text to strip), and
 * deriving the suffix a second time from the tier in the gloss path would
 * risk them silently drifting apart.
 */
function matchTierSuffix(name: string): TierSuffix | undefined {
  for (const entry of TIER_SUFFIXES) {
    if (name.endsWith(entry.suffix)) {
      return entry;
    }
  }
  return undefined;
}

/**
 * Classify a JMA warning name into its severity tier.
 *
 * Never throws. Returns `undefined` for `undefined`, `null`, `''`, or any
 * string ending in none of the three recognised suffixes — never a guessed
 * tier. `特別警報` is checked ahead of `警報` (see the module docblock), so
 * `大雨特別警報` classifies as `'emergency'`, never `'warning'`.
 */
export function classifyJmaTier(name: string | null | undefined): JmaTier | undefined {
  if (!name) {
    return undefined;
  }
  return matchTierSuffix(name)?.tier;
}

/**
 * Gloss a full JMA warning name (e.g. `"大雨警報"`) to English (e.g.
 * `"Warning for Heavy Rain"`), or `undefined` when either the tier suffix or
 * the remaining phenomenon prefix is not recognised.
 *
 * Never throws, and never falls back to a partial or guessed gloss: a known
 * tier with an unrecognised phenomenon (or vice versa) returns `undefined`
 * as a whole, so a caller cannot render half a translation.
 *
 * The result composes as `"<tier label> for <phenomenon>"`
 * (`"Emergency Warning for Heavy Rain"`, `"Warning for Flood"`, `"Advisory
 * for Dense Fog"`), matching JMA's own published English phrasing (see the
 * module docblock's "Source" section) rather than an adjective-first form
 * ("Heavy Rain Warning") that was not verified against a JMA-sourced page.
 */
export function glossJmaWarningName(name: string | null | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  const match = matchTierSuffix(name);
  if (!match) {
    return undefined;
  }
  const phenomenon = name.slice(0, name.length - match.suffix.length);
  const phenomenonGloss = JMA_PHENOMENON_GLOSSES[phenomenon];
  if (!phenomenonGloss) {
    return undefined;
  }
  return `${TIER_LABELS[match.tier]} for ${phenomenonGloss}`;
}

/**
 * Gloss a `JmaWarningKind.condition` qualifier (e.g. `"浸水害"`), or a
 * `、`-joined compound of several (e.g. `"土砂災害、浸水害"`), to English.
 *
 * Documented handling of the compound case: the condition is split on `、`,
 * each part is looked up independently, and the parts are rejoined with
 * `"; "` in their original order — but only when **every** part is
 * recognised. A compound with even one unrecognised part returns
 * `undefined` for the whole string, on the same "never a partial guess"
 * principle as `glossJmaWarningName`: rendering two of three qualifiers
 * without saying one was dropped would understate the hazard.
 *
 * Never throws. Returns `undefined` for `undefined`, `null`, `''`, or any
 * unrecognised qualifier (or compound containing one).
 */
export function glossJmaCondition(condition: string | null | undefined): string | undefined {
  if (!condition) {
    return undefined;
  }
  const parts = condition.split('、');
  const glossed: string[] = [];
  for (const part of parts) {
    const gloss = CONDITION_GLOSSES[part];
    if (!gloss) {
      return undefined;
    }
    glossed.push(gloss);
  }
  return glossed.join('; ');
}
