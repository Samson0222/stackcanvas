# StackCanvas

StackCanvas is a real-time collaborative system design workspace. Describe a system in plain English, watch an AI agent map it onto a shared canvas, refine the architecture with collaborators, and generate a technical specification from the resulting graph.

**Live demo:** https://ghost-ai-git-development-samson0222s-projects.vercel.app

## Features

- **Collaborative canvas** — real-time shared canvas with live cursors, presence, and node/edge editing (Liveblocks + React Flow).
- **AI architecture generation** — describe a system in natural language and have an AI agent generate nodes and edges directly into the shared canvas.
- **Starter system designs** — import prebuilt templates (monolith, microservices, event-driven, serverless, and more) into the canvas at any time.
- **Spec generation** — convert the current canvas graph into a persisted Markdown technical specification, viewable and downloadable from the project.
- **Projects and collaboration** — authenticated project ownership with collaborator access control.

## Tech Stack

| Layer             | Technology               |
| ------------------ | ------------------------- |
| Framework         | Next.js 16 + TypeScript  |
| UI                | Tailwind CSS + shadcn/ui |
| Auth              | Clerk                    |
| Database          | Prisma + PostgreSQL      |
| Canvas            | Liveblocks + React Flow  |
| Background tasks  | Trigger.dev               |
| AI                | Google Gemini (via Vercel AI SDK) |
| Artifact storage  | Vercel Blob               |

## Getting Started

### Prerequisites

- Node.js 20+
- A PostgreSQL database
- Accounts/API keys for [Clerk](https://clerk.com), [Liveblocks](https://liveblocks.io), [Trigger.dev](https://trigger.dev), [Vercel Blob](https://vercel.com/storage/blob), and [Google AI Studio](https://aistudio.google.com)

### 1. Install dependencies

```bash
npm install
```

This also runs `prisma generate` via `postinstall`.

### 2. Configure environment variables

Create a `.env.local` file in the project root with the following:

```bash
# Database
DATABASE_URL=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=
NEXT_PUBLIC_CLERK_SIGN_UP_URL=
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=
NEXT_PUBLIC_CLERK_AFTER_SIGN_OUT_URL=

# Liveblocks
LIVEBLOCKS_PUBLIC_KEY=
LIVEBLOCKS_SECRET_KEY=

# Trigger.dev
TRIGGER_PROJECT_REF=
TRIGGER_SECRET_KEY=

# Vercel Blob
BLOB_READ_WRITE_TOKEN=

# Google AI
GOOGLE_AI_API_KEY=
```

### 3. Set up the database

```bash
npx prisma migrate dev
```

### 4. Run the app

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### 5. Run background tasks (separate terminal)

AI generation and spec generation run as durable background tasks via Trigger.dev and require the dev CLI running locally:

```bash
npm run trigger:dev
```

## Project Structure

```
app/                  Next.js routes, layouts, and API handlers
  api/                Authenticated request handlers
  generated/prisma/   Generated Prisma client (gitignored)
components/           UI composition — canvas surfaces, sidebars, dialogs
lib/                  Shared infrastructure — Prisma client, access control, utilities
prisma/               Database schema and migrations
trigger/              Background jobs — AI design generation, spec generation
context/              Product and architecture documentation
```

## Scripts

| Command                | Description                          |
| ----------------------- | ------------------------------------- |
| `npm run dev`           | Start the Next.js dev server          |
| `npm run build`         | Build for production                  |
| `npm run start`         | Start the production server           |
| `npm run lint`          | Run ESLint                            |
| `npm run trigger:dev`   | Run Trigger.dev tasks locally         |
| `npm run trigger:deploy`| Deploy Trigger.dev tasks              |

## Deployment

The app is deployed on Vercel. Prisma's client is generated to a custom output path (`app/generated/prisma`), which is gitignored, so `postinstall` runs `prisma generate` automatically on every install to ensure the client exists before the build runs.

## Documentation

Further project context lives in [`context/`](context):

- [`project-overview.md`](context/project-overview.md) — product definition, goals, and scope
- [`architecture-context.md`](context/architecture-context.md) — system structure, boundaries, and invariants
- [`ui-context.md`](context/ui-context.md) — theme, colors, typography, and component conventions
- [`code-standards.md`](context/code-standards.md) — implementation rules and conventions
- [`ai-workflow-rules.md`](context/ai-workflow-rules.md) — development workflow and scoping rules
- [`progress-tracker.md`](context/progress-tracker.md) — current phase and open questions
