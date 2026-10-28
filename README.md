# Interactive Guitar Theory Lab

An interactive guitar music-theory learning website. The frontend is built with Next.js and TypeScript; deterministic music-theory logic lives in a framework-independent package.

## Project principles

- Keep music-theory calculations independent from UI and HTTP concerns.
- Validate inputs at API boundaries.
- Use test-driven development for theory rules and fretboard calculations.
- Treat chord recognition as potentially ambiguous and return evidence rather than overclaiming certainty.

## Current status

- `packages/music-theory`: pitch, intervals, chords, fretboard, voicing search and progression optimizer.
- `packages/audio-analysis` + `services/audio-worker`: chroma extraction and chord/fingering hypotheses.
- `apps/web`: Next.js frontend (chord explorer, progression builder, audio analysis) and its `/api`
  routes. The UI talks to the routes through a typed service layer; see
  `docs/frontend-api-contract.md` for the contract and the remaining gaps.

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

The web app calls its own `/api` routes by default. Audio analysis also needs the Python worker
(`services/audio-worker`, see its README) listening at `AUDIO_WORKER_URL` (default
`http://127.0.0.1:8010`). Set `NEXT_PUBLIC_GUITAR_LAB_API_URL=local` to run the UI against the
in-process engine without a server (audio analysis is unavailable in that mode).

Workspaces: `/` chord explorer, `/progressions` progression builder, `/audio` audio analysis.

### Frontend layout (`apps/web/src`)

- `services/`: contract types, the `GuitarLabService` interface, and HTTP and local adapters.
- `state/`: UI state only (explorer reducer, fretboard selection, async resource hook, service context).
- `lib/`: pure presentation helpers (labels, diagram layout, tab strings). No theory calculations.
- `components/`: presentational components (fretboard, explorer controls, chord summary, voicings, UI primitives).
