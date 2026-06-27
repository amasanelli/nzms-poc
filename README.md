# nzms-poc

NestJS + Zod + MongoDB native driver + Swagger.

## Stack

- **Validation** — Zod schemas at controller (pipe) and response (interceptor) layers
- **Database** — MongoDB native driver wrapped in a generic `BaseRepository`
- **Docs** — Swagger UI auto-generated from Zod schemas

## Setup

```bash
cp .env.example .env   # edit MONGODB_URI if needed
npm install
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/api`

## Test

```bash
npm test
```

Integration tests use `mongodb-memory-server` (no external MongoDB needed).
