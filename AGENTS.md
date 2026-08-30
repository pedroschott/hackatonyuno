# Agent Instructions

These instructions apply to every contributor and coding agent working in this repository.

## Language

- Write all source code, comments, documentation, commit messages, and pull request descriptions in English.
- All user-facing frontend content must be in English, including labels, buttons, messages, validation errors, and accessibility text.
- Use clear English names for files, variables, functions, components, database fields, and API routes.

## Git workflow

- Do not commit directly to `main` unless the user explicitly authorizes it for a specific change.
- Create a focused branch for every change.
- Keep commits small, descriptive, and limited to one concern.
- Push the branch and open a pull request for every change, including documentation and configuration updates.
- Review and merge changes through the pull request; keep `main` stable and ready to demo.

## Project organization

- Keep application code in `src/`, static files in `assets/`, project notes in `docs/`, and tests in `tests/`.
- Prefer simple, understandable solutions suitable for a hackathon. Avoid unnecessary abstractions and dependencies.
- Update documentation in the same change. See [Documentation](#documentation) for what to update when.
- Never commit secrets. Document required environment variables with placeholder values in `.env.example`.

## Documentation

Documentation is part of the change, never a follow-up. **Always update the docs in the same branch and pull request as the code.** A change that alters behaviour and leaves documentation describing the old behaviour is incomplete, and reviewers should treat it as unfinished work.

### Where documentation lives

| Surface | Path | Audience |
|---|---|---|
| Merchant documentation site | `app/(docs)/docs/**` served at `/docs` | Developers integrating the SDK into a store |
| Documentation UI kit and navigation | `components/docs/**` | Anyone adding or reordering a docs page |
| Merchant SDK summary | `docs/merchant-sdk.md` | Readers browsing the repository on GitHub |
| Architecture | `docs/architecture.md` | Judges and contributors |
| Decision log | `docs/decisions.md` | Judges and contributors |
| Route and endpoint inventory | `docs/routes.md` | Contributors and integrators |
| Repository overview and run instructions | `README.md` | Everyone |
| Agent-readable summary | `public/llms.txt` | Agents and crawlers |

The docs site ships inside the application so it deploys with the code it describes and cannot drift into a separate repository. `components/docs/nav.ts` is the single source of truth for the sidebar, the search index, page titles and descriptions, `sitemap.xml` entries and previous/next links: adding a page means adding one entry there and one `page.tsx`.

### What to update when

| If you change | Also update |
|---|---|
| `sdk/index.ts` exports, options, verification steps or response shape | `/docs/reference`, `/docs/checkout`, `docs/merchant-sdk.md` |
| Policy rules or reason codes in `lib/agentpay-policy.ts` or `lib/domain.ts` | `/docs/reference/decisions`, the refusal matrix in `/docs/testing` |
| The signed request format, headers, canonical JSON or registry endpoints | `/docs/reference/protocol`, `docs/architecture.md` |
| Packaging, `scripts/install-sdk.mjs` or the install flow | `/docs/installation`, `/docs/quickstart`, `README.md` |
| Any route added, removed or renamed | `docs/routes.md`, `app/sitemap.ts`, `app/robots.ts`, `public/llms.txt` |
| Environment variables | `.env.example`, `README.md`, `/docs/installation` |
| MCP tools or the agent connection flow | `README.md`, `public/llms.txt`, `docs/routes.md` |
| A trade-off, rejected alternative or deliberate limitation | `docs/decisions.md` |
| Anything a judge sees, runs or clicks | `README.md` |

### Rules for documentation changes

- Run every command and code sample you publish. A sample that has not been executed is a claim, not documentation.
- Document what works today. Never describe planned behaviour as if it were shipped; state the limitation instead, as the mocked payment rail is stated.
- Keep the vocabulary the product uses. The UI says "mandate"; the docs say "mandate". Do not invent a second name for the same object.
- Prefer deleting a stale paragraph over leaving it. Wrong documentation costs more than missing documentation.
- Name the verification in the pull request: what changed, how it was verified, and which documents were updated.

## Hackathon judging context

- Keep the official [NextWave Hackathon 2026 evaluation guidelines](https://nextwave-hackathon-2026.vercel.app/judging) in context whenever planning, asking questions, making trade-offs, or implementing features.
- Optimize for depth over difficulty, working software over promised functionality, and sound judgment over spectacle.
- Start with the thinnest end-to-end version that works, then deepen it by handling edge cases, documenting trade-offs, and rehearsing live failure scenarios.
- Prioritize the jury's five lenses, roughly in this order:
  1. The system works end to end and responds correctly when judges change inputs live without team intervention.
  2. The architecture is sound, and the team can explain major decisions, rejected alternatives, and trade-offs.
  3. The product solves the challenge as written, including difficult and unpolished real-world cases.
  4. The solution contains an original insight, approach, or mechanism.
  5. The experience is useful and clear, the demo is legible, and the repository is understandable without extra context.
- Do not optimize for feature count, integrations, lines of code, buzzwords, or a polished recording of software that does not run live.
- Preserve time for the short pitch, live demo, trial by fire, and technical Q&A.
- Required final deliverables are slides, a working demo, a public GitHub repository with a clear README, an architecture diagram, and a decision log.
- When proposing work, state how it improves the end-to-end demo, resilience to live changes, technical defensibility, or clarity. Challenge work that adds scope without strengthening one of those outcomes.

## Supabase

- Use the existing `hackatonyuno` Supabase project with reference `oieakzvyonhoddqukmse`.
- Keep credentials in environment variables. Publishable keys may be used by the frontend; secret and service-role keys must never be exposed in client code or committed to Git.
- Enable Row Level Security on every table exposed through the Data API and create policies that match the intended access model.
- Record schema changes in migrations and verify database changes before considering the work complete.

## Coordination

- Treat this repository, `AGENTS.md`, and the current codebase as the shared source of truth.
- Before starting, inspect the current branch, repository status, README, `AGENTS.md`, and relevant files.
- Coordinate through focused branches and pull requests to avoid overlapping or conflicting changes.
- Preserve work from other contributors and agents. Never overwrite or revert unrelated changes.
- Keep the repository organized and leave concise documentation for decisions that affect other work.
- In every pull request, explain what changed, how it was verified, which documentation you updated, and any remaining follow-up work.
- Treat a pull request without its documentation update as unfinished, in the same way as one without tests.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
