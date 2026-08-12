# Documentation Maintenance

How this project's docs stay accurate. The previous, much longer version of
this guide (November 2025) is archived at
[docs/archive/DOCUMENTATION_MAINTENANCE_2025-11.md](../archive/DOCUMENTATION_MAINTENANCE_2025-11.md);
its still-used pieces — the three `scripts/*.sh` helpers and the
single-source-of-truth rules — live on here.

## Source of truth per fact

| Fact | Lives in | Everything else… |
|------|----------|------------------|
| Version | `package.json` | …copies it (README, CLAUDE.md, docs/README.md) via the release script |
| Release history | `CHANGELOG.md` | …links to it; don't restate release detail elsewhere |
| Feature-idea status | [`docs/planning/README.md`](../planning/README.md) | …holds detail only; status changes happen in the index |
| Tool reference | `docs/TOOLS.md` | …links to it |
| Dev guidance for AI assistants | `CLAUDE.md` | …is summarized there; deep detail belongs in docs/ |

## Release flow (docs portion)

Mostly automated:

```bash
npm run build && npm test && npm audit   # the gate — must be green first
./scripts/update-docs-for-release.sh X.Y.Z   # CHANGELOG [Unreleased] → [X.Y.Z], version bumps
                                             # in package.json/server.json/README/CLAUDE.md/
                                             # docs/README.md/TOOLS.md, SECURITY.md row
git diff                                     # review, especially CHANGELOG wording
./scripts/check-doc-versions.sh              # consistency check (versions, test count, links)
```

Then follow [docs/publishing/PUBLISHING.md](../publishing/PUBLISHING.md) for
tagging and publishing.

## When a feature ships

1. `CHANGELOG.md` — entry under `[Unreleased]` (written as the work merges).
2. `docs/planning/README.md` — flip the idea's row to ✅ with the version.
3. `docs/TOOLS.md` — update if tools or parameters changed.
4. Move the feature's plan set (`docs/<name>-plan.md`,
   `-implementation-plan.md`, verification/review docs) into `docs/plans/`.
5. `CLAUDE.md` — the "New in vX.Y.Z" blurb is added by the release script;
   update architecture/feature sections by hand if patterns changed.

## Archiving

A doc is archive material when it describes work that is finished or a state
that no longer exists, and it isn't being kept current. Move it, don't let it
masquerade as live documentation:

- General/historical docs → `docs/archive/`
- Planning-era docs → `docs/planning/archive/`
- Shipped plan sets → `docs/plans/` (reference, not archive — they document
  how features were built and verified)

When archiving: `git mv`, add a short `> 📁 ARCHIVED <date>` banner at the top
saying why and where the live equivalent is, and update
[docs/README.md](../README.md).

## Folder map

| Location | Contents |
|----------|----------|
| `docs/` root | Live reference docs + **in-flight** design plans only |
| `docs/plans/` | Shipped plan sets (design, implementation, verification) |
| `docs/planning/` | Idea backlog; `README.md` there is the status index |
| `docs/development/` | Code quality, security audits, this guide |
| `docs/testing/`, `docs/publishing/`, `docs/releases/`, `docs/analytics/` | As named |
| `docs/archive/`, `docs/planning/archive/` | Historical documents |

---

*Rewritten 2026-08-12 to match actual practice; see the archive for the 2025-11 original.*
