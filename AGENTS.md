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
- Update documentation when changes affect setup, architecture, environment variables, or user behavior.
- Never commit secrets. Document required environment variables with placeholder values in `.env.example`.

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
- In every pull request, explain what changed, how it was verified, and any remaining follow-up work.
