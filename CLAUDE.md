# MarkCamp

MarkCamp is an offline-first app for stingless beekeepers (meliponiculture) to track bait hives in the field, organized into projects, built for places with no cellular signal.

Current scope is the **bait hive MVP**. Colonies, splits and anything else are out of scope until explicitly brought in. The core entity is the bait site (`bait_sites`), not a generic marker (see ADR 0003 and ADR 0005).

This is a **learning project** run like a real product. The goal is to understand every architectural decision, not to ship fast. The developer is learning backend architecture, security, logging and deployment through this codebase.

@CONVENTIONS.md

## Stack

- Backend: Spring Boot (Maven) in `backend/`
- Database: PostgreSQL via Docker Compose (`docker-compose.yml` at the root)
- Schema migrations: Flyway
- Frontend: React + Vite (TypeScript) PWA in `frontend/` (ADR 0007). Layers: `src/core/` (pure TypeScript, no DOM, no React), `src/adapters/` (Dexie, fetch, Firebase), `src/ui/` (React). `ui` never imports `adapters`; `src/main.tsx` wires them. UI text only in `src/ui/i18n/pt-BR.ts`.

## Running locally

```
docker compose up -d           # from the repo root
cd backend && ./mvnw spring-boot:run
cd frontend && npm install && npm run dev   # http://localhost:5173, proxies /api to :8080
cp frontend/.env.example frontend/.env.local   # then fill in the Firebase web config
```

Credentials come from `.env` at the root (see `.env.example`).

## How to work in this repo

- Do only what was asked. Do not create extra files, classes, endpoints or tests beyond the request.
- Do not add dependencies. If a task seems to need one, stop and explain why before adding it.
- Do not make architectural decisions on your own (IDs, auth, sync strategy, new infrastructure). If a decision is needed, present the options with trade-offs and wait.
- Do not add infrastructure for scale that does not exist yet (caches, queues, extra services) without a concrete justification.
- After each change, explain briefly what you did and why, so the developer can learn from it.
- Do not commit. The developer reviews and commits.