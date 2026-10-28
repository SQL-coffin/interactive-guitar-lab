# Interactive Guitar Theory Lab

An interactive guitar music-theory learning website. The frontend is built with Next.js and TypeScript; deterministic music-theory logic lives in a framework-independent package.

## Project principles

- Keep music-theory calculations independent from UI and HTTP concerns.
- Validate inputs at API boundaries.
- Use test-driven development for theory rules and fretboard calculations.
- Treat chord recognition as potentially ambiguous and return evidence rather than overclaiming certainty.

## Current status

- `packages/music-theory`: pitch, intervals, chords, fretboard and voicing search.
- `apps/web`: Next.js frontend with the interactive fretboard, chord explorer and voicing results.
  It talks to the backend through a typed service layer; see `docs/frontend-api-contract.md` for
  the proposed HTTP contract. Until those routes exist, it uses a local adapter around the engine.

## Planned packages

- `packages/music-theory`: pitch, intervals, chords, fretboard, and later voicing search.
- `packages/contracts`: shared API schemas and request/response types.
- `apps/web`: Next.js frontend and API routes (frontend implemented; API routes pending).

## Development

```bash
npm install
npm test            # engine + web unit/component tests
npm run typecheck   # engine and web
npm run dev         # http://localhost:3000
npm run build:web
```

Set `NEXT_PUBLIC_GUITAR_LAB_API_URL=/api` to point the web app at the HTTP API once it exists.

### Frontend layout (`apps/web/src`)

- `services/`: contract types, the `GuitarLabService` interface, and HTTP and local adapters.
- `state/`: UI state only (explorer reducer, fretboard selection, async resource hook, service context).
- `lib/`: pure presentation helpers (labels, diagram layout, tab strings). No theory calculations.
- `components/`: presentational components (fretboard, explorer controls, chord summary, voicings, UI primitives).
