/**
 * Response shapes for JMA's disaster-prevention XML service
 * (`data.jma.go.jp/developer/xml/`).
 *
 * Two documents, two shapes:
 *
 *   - the **Atom index** (`feed/extra_l.xml`), a flat list of every bulletin
 *     JMA published in roughly the last seven days;
 *   - a **VPWW53 warning document**, one office's complete current warning
 *     set in JMA's own H27 schema — *not* CAP, so nothing in `src/types/cap.ts`
 *     applies.
 *
 * Every field of an upstream shape is optional, per the project rule for
 * third-party JSON/XML: the parser's job is to narrow, and a required field
 * here would be a promise about someone else's server.
 *
 * Verified live 2026-09-03 against the index and 14 VPWW53 documents from 14
 * distinct offices; see `.devdocs/plan-japan-alerts-impl.md` T4 (rev 3) for
 * the observed structure and value vocabularies.
 */

/**
 * One entry of the Atom index, already narrowed to the fields this server
 * routes on.
 *
 * `infoType` and `officeCode` are derived from the document **filename**
 * (`20260903042854_0_VPWW53_180000.xml` -> `VPWW53`, `180000`) and never from
 * the entry title or `<content>`: titles differ between schema generations
 * (`気象特別警報・警報・注意報` vs `気象警報・注意報（Ｈ２７）`) and the
 * `<content>` element is prose that contains warning vocabulary of its own, so
 * a substring match on either is wrong.
 *
 * Both stay optional: an entry whose filename does not match the convention is
 * kept with them `undefined` rather than dropped, so a caller can tell "not the
 * type I wanted" from "I could not read this at all". Silently discarding
 * unreadable entries is how a changed filename convention would turn into a
 * fabricated all-clear.
 */
export interface JmaIndexEntry {
  /** Absolute URL of the bulletin document. Untrusted — allowlist before fetching. */
  documentUrl: string;
  /** Bulletin type code, e.g. `VPWW53`. Undefined when the filename did not parse. */
  infoType?: string;
  /** Publishing office code, e.g. `180000`. Undefined when the filename did not parse. */
  officeCode?: string;
  /** Atom `<updated>`, as published. */
  updated?: string;
  /** Atom `<title>`, kept for diagnostics only — never routed on. */
  title?: string;
}

/** The result of parsing one Atom index, with the counts a caller needs to tell empty from broken. */
export interface JmaIndexResult {
  /** Entries in feed order, which is newest-first. */
  entries: JmaIndexEntry[];
  /** How many `<entry>` elements the feed carried, before any cap. */
  totalEntries: number;
  /**
   * How many entries had a URL but an unparseable filename. Nonzero is a
   * signal that the filename convention may have moved; all-of-them is a
   * fault, never an empty result (G8).
   */
  unparsedEntries: number;
  /** Whether the entry array was trimmed by the cap. A trim is a caveat, never an exclusion (G8). */
  trimmed: boolean;
}

/**
 * One warning kind within an area.
 *
 * `status` is load-bearing and must never be dropped. Observed vocabulary:
 * `継続` (continuing), `発表` (newly issued), `警報から注意報` (downgraded from
 * warning to advisory) and **`解除` (lifted)**. Rendering a lifted warning as
 * active is a fabricated warning — the mirror image of the fabricated all-clear
 * this project's contract posture exists to prevent — so the parser carries the
 * value through verbatim and the renderer decides.
 *
 * `condition` qualifies the warning where JMA supplies one (`浸水害` flood
 * damage, `土砂災害` landslide).
 */
export interface JmaWarningKind {
  /** Japanese warning name, e.g. `大雨警報`. Rendered verbatim. */
  name?: string;
  /** JMA warning code, e.g. `03`. */
  code?: string;
  /** Issuance status, verbatim. See the note above — this decides active vs lifted. */
  status?: string;
  /** Qualifier, e.g. `浸水害`. */
  condition?: string;
}

/** One class10 area block of a warning document. */
export interface JmaWarningArea {
  /** class10 area code, e.g. `180010`. Joins to `src/data/jmaAreas.ts`. */
  code?: string;
  /**
   * Japanese area name as published, e.g. `嶺北`.
   *
   * Not unique across Japan — `北部` appears 17 times in the class10 space and
   * `南部` 18 — so it is meaningful only beside its publishing office and must
   * never be rendered as though it identified a place on its own.
   */
  name?: string;
  /** Every kind published for this area, including lifted ones. */
  kinds: JmaWarningKind[];
}

/**
 * One parsed VPWW53 warning document.
 *
 * A VPWW53 carries the **same warning set at five granularity levels**, as
 * sibling `Body/Warning[@type]` blocks — prefecture, class10
 * (`一次細分区域等`), grouped municipalities, municipality, and by-warning-type
 * — mirrored in summary form under `Head/Headline/Information`. Only the
 * class10 level is read: consuming a second level double-renders every warning,
 * the same hazard as consuming VPWW54 beside VPWW53.
 */
export interface JmaWarningDocument {
  /** `Head/ReportDateTime`, as published (JST offset preserved). */
  reportDateTime?: string;
  /** `Control/PublishingOffice`, e.g. `福井地方気象台`. */
  publishingOffice?: string;
  /** `Head/Title`, e.g. `福井県気象警報・注意報`. */
  title?: string;
  /**
   * `Head/InfoType` — the document's own kind (`発表`, `訂正`, `遅延`).
   * Distinct from a kind's `status`.
   */
  infoType?: string;
  /** class10 areas carried by this document. Empty is an honest empty, never an error. */
  areas: JmaWarningArea[];
}
