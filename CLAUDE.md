# tribe-rcm-denial-appeals-prototype

A demo prototype of a GenAI denial appeals assistant for healthcare revenue cycle
management: a Next.js app that mimics an EHR billing workqueue, with API routes
running a multi-stage LLM pipeline over claim denials.

> Placeholder — the full version of this file is still to be written.

## Stack

- **Next.js 16** (App Router, React 19, TypeScript, `src/` directory)
- **Tailwind CSS v4** with CSS variables
- **shadcn/ui on Radix primitives** — style `radix-nova`, base color `neutral`,
  `lucide-react` icons. Components live in `src/components/ui`.
- **Anthropic SDK** (`@anthropic-ai/sdk`) for the pipeline, **zod** for schemas
- **Drizzle ORM** over **Postgres/pgvector** (`postgres` driver)
- **Vitest** for tests; **tsx** and **dotenv** for scripts
- Deployment target: **Railway**, with a Postgres/pgvector service

## npm scripts

| Script | Command | Status |
| --- | --- | --- |
| `dev` | `next dev` | working |
| `build` | `next build` | working |
| `start` | `next start` | working |
| `lint` | `eslint` | working |
| `typecheck` | `tsc --noEmit` | working |
| `test` | `vitest run --passWithNoTests` | working (no tests yet) |
| `db:generate` | `node scripts/not-implemented.mjs db:generate` | stub |
| `db:push` | `node scripts/not-implemented.mjs db:push` | stub |
| `db:seed` | `node scripts/not-implemented.mjs db:seed` | stub |
| `eval` | `node scripts/not-implemented.mjs eval` | stub |

Stubs print "not implemented yet" and exit 0.
