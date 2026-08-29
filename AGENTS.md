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
