# Commonroom

A small social space for everyday connections, built for [The Odin Project’s Odin-Book assignment](https://www.theodinproject.com/lessons/nodejs-odin-book).

Commonroom pairs an amber and sky-blue visual identity with a chronological feed: no ranking algorithm, just your own posts and people you choose to follow.

## Features

- Signup, Passport Local login, persistent PostgreSQL sessions, and logout.
- Read-only guest exploration without a shared public account.
- Directed follow requests: send, cancel, accept, decline, and unfollow. Reciprocal follows are independent.
- Text posts with owner editing/deletion, likes, and paginated comments with owner deletion.
- Searchable user directory and profiles with editable display names, bios, and six local avatar pictures.
- Cursor pagination, responsive navigation, keyboard focus, and recoverable form errors.

All community data requires a member or guest session. Guests see recent community posts; members see only their own posts and accepted outgoing follows in the main feed. Any authenticated visitor can explore other profiles. Pending requests do not affect the feed. Canceling, declining, or unfollowing removes the directed relationship and permits another request.

## Stack and structure

JavaScript, React 19, Vite 7, React Router, Express 5, Prisma 6, PostgreSQL, Passport Local, bcrypt, and npm workspaces. Prisma 6 is deliberately retained for its conventional JavaScript client and schema configuration; upgrading to Prisma 7+ requires a separate migration.

```text
apps/api/           Express app, authentication, validation, Prisma, integration tests
apps/web/           React frontend, original avatars, UI tests
api/proxy.js        Server-side Vercel → Render API proxy
vercel.json         Frontend build and same-origin routing
```

The Express app factory is independent of its listener. PostgreSQL constraints enforce unique normalized usernames, directed follow pairs, and user/post likes. Foreign keys cascade comments and likes when a post is deleted. Follow acceptance uses a conditional update; follow creation and likes use conflict-skipping inserts. Lists are bounded to 12 entries, ordered by timestamp and ID; opaque cursors use the same ordering for stable ties.

## Local setup

Use Node.js 24 LTS, npm, and a running PostgreSQL instance. On Linux/WSL with the local `jc` role and peer authentication:

```bash
createdb odin_book
createdb odin_book_test
npm ci
cp apps/api/.env.example apps/api/.env
```

Skip `createdb` when these dedicated databases already exist. Adjust connection URLs for your local role. Set `SESSION_SECRET` to at least 32 random characters; for example, generate one with `openssl rand -hex 32`. Actual `.env` files are ignored.

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. The API listens on port 3000. Vite forwards `/api` while preserving the browser Origin and cookies. Use `localhost` consistently with `WEB_ORIGIN`.

The repeatable `seeds.js` adds fictional profiles, posts, comments, likes, and follows using Faker and deterministic IDs. It preserves existing records and refuses production or nonlocal databases. Demo users receive random, undisclosed passwords; create your own account or explore as guest. Seeding is optional and never runs automatically.

| Variable            | Purpose                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `DATABASE_URL`      | Prisma and session-store PostgreSQL connection                     |
| `TEST_DATABASE_URL` | Local `odin_book_test` only; test runner refuses other databases   |
| `SESSION_SECRET`    | Cookie-signing secret, at least 32 random characters               |
| `WEB_ORIGIN`        | Exact browser origin, no trailing slash                            |
| `PORT`              | API port, defaults to 3000                                         |
| `NODE_ENV`          | `production` enables Secure cookies and authenticated proxy access |
| `PROXY_SECRET`      | Production server-to-server secret shared by Vercel and Render     |
| `API_ORIGIN`        | Vercel function only: Render HTTPS origin, without `/api`          |

## Commands

| Command                                   | Action                                                         |
| ----------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                             | Both development servers                                       |
| `npm run build`                           | Build frontend to `apps/web/dist`                              |
| `npm start`                               | Start API                                                      |
| `npm run lint`                            | ESLint                                                         |
| `npm run format` / `npm run format:check` | Prettier                                                       |
| `npm test`                                | PostgreSQL integration tests, then React Testing Library tests |
| `npm run db:generate`                     | Generate Prisma client                                         |
| `npm run db:migrate`                      | Apply committed migrations, including session table            |
| `npm run db:seed`                         | Add fictional local community                                  |

API tests apply migrations and truncate only the dedicated local `odin_book_test` database after URL and current-database checks. They run serially and replace `DATABASE_URL` before importing the database client. Never point `TEST_DATABASE_URL` at valuable data. UI tests use mocked API responses for failure recovery, text rendering, and state transitions.

## Authentication and boundaries

Passwords use bcrypt with a 72-byte UTF-8 maximum. Usernames normalize to lowercase and allow 3–24 letters, numbers, or underscores. Sessions rotate at login and expire after seven days of inactivity; logout destroys the stored session and expires its cookie. Cookies are HttpOnly, SameSite=Lax, and Secure in production, with a host-only scope and `/api` path.

State-changing requests require a session-bound CSRF token and reject a supplied Origin that differs from `WEB_ORIGIN`. `/api/session` bootstraps the token; the frontend updates it after authentication. Protected routes check authentication before accessing data, then enforce member access and ownership for mutations. Authentication and general request limits are deliberately separate. Public JSON responses exclude password hashes. Text is rendered as text, preserving line breaks.

Posts allow 3,000 characters, comments 1,000, bios 240, and display names 50. There are no uploads, rich HTML, chat, notifications, or real-time updates. Refreshing/refetching retrieves changes from other sessions. Rate limits are in-process and intended for one API instance; a multi-instance deployment should use a shared limiter store. There is no password recovery, email verification, moderation console, or account deletion flow.

## Deployment preparation

See [deployment instructions](DEPLOYMENT.md) for Neon PostgreSQL, a Render API, and a Vercel frontend. No live instance is published yet.

## Assets

The six SVG avatars were drawn specifically for Commonroom and are bundled locally. Interface icons are from [Lucide](https://lucide.dev/license) (ISC). Typography uses system-installed Trebuchet MS and Arial fallbacks; no external font requests are needed.
