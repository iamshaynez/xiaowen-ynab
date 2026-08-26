# AGENTS.md — xiaowen-ynab

Guidance for AI agents and contributors working in this repository.

## Project Purpose

A **local, YNAB-style (zero-based) budgeting application**. It runs entirely on the
user's machine: a SQLite database holds accounts, transactions, category assignments
and budgets, an Express API serves it, and a React SPA provides the UI.

Core goals:

- Zero-based budgeting: assign every dollar to a category until "Ready to Assign" is 0.
- Full local ownership of data (single SQLite file under `data/`).
- Built-in AI agent chat that can inspect and reason about the budget via SQL tools.

## Tech Stack

| Layer   | Stack                                                        |
| ------- | ------------------------------------------------------------ |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4              |
| Backend  | Node.js (ESM, `.mjs`) + Express 4 + better-sqlite3          |
| Data     | SQLite (`data/budget.db`), versioned migrations at startup   |
| Tests    | Vitest (node env for server, jsdom-capable for React)        |
| CI       | GitHub Actions, runs on every push/PR to `dev`               |

Node 20+ is required. Use `npm ci` in CI and `npm install` locally.

## Engineering Structure

```
.
├── src/                # React frontend (TypeScript)
│   ├── pages/          # Route-level pages (Accounts, Budget, Reports, Chat, ...)
│   ├── components/     # Reusable UI components
│   ├── api.ts          # Typed client for the /api endpoints
│   ├── store.tsx       # App-wide state/context
│   ├── types.ts        # Shared TypeScript types
│   ├── format.ts       # Formatting helpers (currency, dates)
│   ├── i18n.ts         # Internationalization
│   └── main.tsx        # SPA entry point
├── server/             # Express backend (ESM `.mjs`)
│   ├── index.mjs       # HTTP server bootstrap
│   ├── routes.mjs      # Express router (the /api surface)
│   ├── engine.mjs      # Budget computation (pure logic + DB queries)
│   ├── db.mjs          # SQLite connection + date helpers
│   ├── migrations.mjs  # Versioned schema migrations
│   ├── ai.mjs          # Built-in AI agent + SQL tool loop
│   └── *.test.mjs      # Colocated server tests (Vitest)
├── data/               # SQLite database files (do NOT commit the db)
├── dist/               # Production build output (generated)
├── vite.config.ts      # Frontend dev server + build
├── vitest.config.ts    # Test runner config
└── package.json        # Scripts and dependencies
```

### Layering rules

- **`server/engine.mjs`** holds the budget math. Keep computations pure where possible
  (functions that only depend on arguments, e.g. `goalNeed`, `daysBetween`) so they are
  trivially unit-testable without a database.
- DB access lives in `db.mjs` and is imported by engine/routes; never reach into the DB
  from the frontend.
- The frontend talks to the backend only through `src/api.ts` (the `/api` proxy in
  `vite.config.ts` forwards to the Express server on `:3001`).

## Conventions

- **Modules:** backend uses ESM `.mjs` with `import`/`export`; frontend uses `.ts`/`.tsx`.
- **TypeScript:** `strict: true`. No `any` unless unavoidable; prefer precise types in
  `src/types.ts`.
- **Formatting:** match surrounding code. 2-space indentation, double quotes, no
  semicolons are omitted consistently with existing files (follow the existing style).
- **Naming:** `camelCase` for functions/variables, `PascalCase` for React components and
  types. DB tables/columns are `snake_case`.
- **Imports:** keep imports at the top; prefer named imports over default where possible.
- **Commits:** concise, imperative, conventional-ish messages (e.g. `feat:`, `fix:`,
  `chore:`).

## TDD — Mandatory Workflow

**Always write the test before the implementation. This is non-negotiable.**

1. **RED** — Write a failing test that specifies the desired behavior. Run it and confirm
   it fails for the right reason.
2. **GREEN** — Write the minimal implementation to make the test pass.
3. **REFACTOR** — Improve structure/naming without changing behavior, keeping tests green.

Rules:

- New logic in `server/engine.mjs` (or new pure modules) MUST have a colocated
  `*.test.mjs` before the code is considered done.
- New React components/pages SHOULD have a `*.test.tsx` covering their core behavior.
- Tests run in the **node** environment by default. Use jsdom only for component tests.
- A test that merely asserts "no error" is not sufficient; assert the actual outcome.
- Do not disable or skip tests to make CI green. Fix the cause.

### Running tests locally

```bash
npm test            # run once (CI mode)
npm run test:watch  # watch mode during development
npm run test:coverage
npm run typecheck   # tsc -b --noEmit
```

## Branching & Pull Requests

- `main` and `dev` are **protected** branches. Direct pushes are blocked.
- All changes go through a **Pull Request** into `dev`. PRs require at least one PR (no
  human approval needed — review count is 0), but CI must pass.
- Merge to `dev` only via PR. Promotion from `dev` to `main` is a separate PR when
  releasing.

## CI (GitHub Actions)

Workflow: `.github/workflows/ci.yml`, triggered on **push to `dev`** and **PRs targeting
`dev`**.

Steps:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`

**A PR cannot be merged into `dev` unless CI is green.** Treat a failing CI run as a
blocker: fix the code or the test, do not bypass.

## Getting Started (dev)

```bash
npm install
npm run dev          # starts API (:3001) and Vite web (:5173) concurrently
```

Open http://localhost:5173. The SQLite DB is created/migrated automatically on API start.
