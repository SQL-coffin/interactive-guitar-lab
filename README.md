# Interactive Guitar Theory Lab

An interactive guitar music-theory learning website. The frontend is built with Next.js and TypeScript; deterministic music-theory logic lives in a framework-independent package.

## Project principles

- Keep music-theory calculations independent from UI and HTTP concerns.
- Validate inputs at API boundaries.
- Use test-driven development for theory rules and fretboard calculations.
- Treat chord recognition as potentially ambiguous and return evidence rather than overclaiming certainty.

## Current status

Repository initialized. Backend foundation is being developed in small, testable increments.

## Planned packages

- `packages/music-theory`: pitch, intervals, chords, fretboard, and later voicing search.
- `packages/contracts`: shared API schemas and request/response types.
- `apps/web`: Next.js frontend and API routes (frontend implementation can proceed independently).

## Development

See package scripts and `docs/` as they are added.
