# Conventions

Project-wide rules for MarkCamp. Architectural decisions live in ADRs; this file covers how we write and organize things day to day.

## Language

- All code, schema (tables, columns, constraints), logs, API messages, comments and documentation are written in **English**.
- Portuguese appears **only** in UI translation files.
- Commit messages are written in English.

## Secrets and environment

- Never commit secrets, credentials or real `.env` files.
- Local configuration lives in `.env` at the repository root (read by Docker Compose and by the backend).
- `.env.example` is versioned and lists every required variable with placeholder values. When a new variable is added, update `.env.example` in the same commit.

## Database

- The schema is changed **only** through Flyway migrations (`backend/src/main/resources/db/migration`).
- Hibernate never creates or alters tables (`spring.jpa.hibernate.ddl-auto=validate`).
- A migration that has been committed is never edited. Fixes go in a new migration.
