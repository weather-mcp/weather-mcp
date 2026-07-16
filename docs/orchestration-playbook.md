# Orchestration Playbook — Rules of Engagement

How orchestrated implementation plans are written (`/impl-plan`) and executed
(`/run-plan`) in this repo. Design plans live at `docs/<name>-plan.md`,
implementation plans at `docs/<name>-implementation-plan.md`, work happens on
`feat/<name>`.

## Project bindings

**Verification gate** (run after every task, from `weather-mcp/`):

```bash
npm run build     # TypeScript strict compile — 0 errors
npm test          # Full Vitest suite — 100% pass, < 2s
npm audit         # No high/critical vulnerabilities
```

There is no separate lint step or test database; the gate above is the whole
gate. Tests must stay deterministic and fast (no live API calls in unit tests —
mock HTTP per existing patterns in `tests/unit/`).

**Conventions** (see `CLAUDE.md` for detail):

- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, …).
  **No `Co-Authored-By` lines.**
- TypeScript strict mode, no `any` (use `unknown` + validation).
- New feature order: types → validation → service → handler → registration in
  `src/index.ts` → tests → docs.
- Errors via classes in `src/errors/ApiError.ts`; logs via `src/utils/logger.ts`
  to stderr only.

## Model policy

| Model | Use for |
|-------|---------|
| `opus` | Orchestration, design-sensitive logic, tricky state, final integration + docs. The orchestrator does `opus` tasks itself. |
| `sonnet` | Bulk implementation and test-writing. |
| `haiku` | Mechanical edits (renames, boilerplate registration, doc touch-ups). |

## Task rules

- Tasks are small and verifiable — roughly one focused conventional commit each,
  with exact expected files, crisp acceptance criteria (name the tests/gate),
  and an explicit dependency order.
- `parallel-safe` may be marked only when a task's files are disjoint from the
  task(s) it could run beside. When in doubt, serialize.
- Scope comes from the design plan's active sections only. Deferred/blocked
  items are listed as out of scope, not tasked. A necessary mechanical
  consequence of an in-scope change is not new scope: make it, keep the gate
  green, note it in the commit.

## Execution loop (summary — `/run-plan` is authoritative)

1. Branch `feat/<name>`; establish a green baseline with the full gate before
   touching anything. Never proceed on red.
2. Per task: spawn a subagent of the task's model with scope, files, acceptance
   criteria, and the relevant design-plan section. Review the diff, then run the
   gate yourself — a subagent's self-report is never the gate.
3. Green → commit with the task's message, tick the task in the Progress
   Tracker with the commit's short SHA, commit the tracker update, push.
   Red → send the failure back to the same-model subagent (or fix trivia
   yourself). **Never commit red.**
4. Stop and ask the human when acceptance can't be met, a design point is
   genuinely ambiguous, or a real product bug surfaces. Don't guess; don't
   expand scope.
5. Done = every box ticked, full gate green, design plan marked `IMPLEMENTED`,
   status reported. Opening a PR / merging is the human's call.

The committed Progress Tracker is the source of truth; a fresh session must be
able to resume from it alone.
