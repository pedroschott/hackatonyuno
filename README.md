# Hackathon Project

Minimal starter structure for the project.

## Folders

- `src/` — application code
- `assets/` — images, fonts, and other static files
- `docs/` — notes and documentation
- `tests/` — tests

## Getting started

Add the first application files under `src/` and update this README as the project takes shape.

## Supabase

This project uses Supabase as its backend platform.

- Project name: `hackatonyuno`
- Project reference: `oieakzvyonhoddqukmse`
- Region: `us-west-2`
- PostgreSQL version: `17`
- Database host: `db.oieakzvyonhoddqukmse.supabase.co`

Keep Supabase credentials in local environment variables and provide only placeholder values in `.env.example`. Frontend code may use a Supabase publishable key, but service-role and secret keys must never be exposed in the client or committed to Git. Apply Row Level Security to tables exposed through the Data API and document schema changes with migrations.

## Project guidelines

### Language

- Write all source code, comments, documentation, commit messages, and pull request descriptions in English.
- All user-facing frontend content must be in English, including labels, buttons, messages, validation errors, and accessibility text.
- Use clear English names for files, variables, functions, components, database fields, and API routes.

### Git workflow

- Never commit directly to `main`.
- Create a focused branch for every change.
- Keep commits small, descriptive, and limited to one concern.
- Push the branch and open a pull request for every change, including documentation and configuration updates.
- Review and merge changes through the pull request; keep `main` stable and ready to demo.

### Organization

- Keep application code in `src/`, static files in `assets/`, project notes in `docs/`, and tests in `tests/`.
- Prefer simple, understandable solutions suitable for a hackathon. Avoid unnecessary abstractions and dependencies.
- Update documentation when a change affects setup, architecture, environment variables, or user behavior.
- Never commit secrets. Document required environment variables in an `.env.example` file.

### Agent coordination

- Treat this repository and README as the shared source of truth for every agent working on the hackathon.
- Before starting work, inspect the current branch, repository status, README, and relevant existing files.
- Coordinate work through focused branches and pull requests to avoid overlapping or conflicting changes.
- Preserve changes made by other contributors and agents. Do not overwrite or revert unrelated work.
- In each pull request, explain what changed, how it was verified, and any follow-up work that remains.
