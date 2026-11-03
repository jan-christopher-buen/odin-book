# Deployment preparation

This repository is prepared for a Vercel frontend, a Render API, and Neon PostgreSQL. No resources have been provisioned. Verify the deployed proxy and cookies before treating a release as ready.

## 1. Neon PostgreSQL

Create a dedicated project/database in the region nearest the API. Copy a direct PostgreSQL connection string with TLS (`sslmode=require`) into Render’s `DATABASE_URL` secret. A direct connection keeps this single-instance Prisma 6 and `pg` session-store setup simple and supports migrations without transaction-pooler caveats. Do not reuse the local development or test database. Keep connection secrets out of the repository.

Committed Prisma migrations create application tables, foreign keys, indexes, database checks, and the `Session` table used by `connect-pg-simple`. The API does not create the session table at runtime. Run migrations once per release with `npm run db:migrate`. Never run local test cleanup or demo seeding against Neon. For future pooled runtime connections, configure a separate Prisma `directUrl` for migrations and account for both the Prisma and session-store pools.

Reference: [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## 2. Render API

Create a Node web service from this repository with the repository root as its working directory.

- Node version: **24.x** (`NODE_VERSION=24`).
- Build command: `npm ci --include=dev && npm run db:generate`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health check path: `/api/health`

If the selected service does not support pre-deploy commands, use `npm ci --include=dev && npm run db:generate && npm run db:migrate` as the build command for this single-service project. Coordinate future incompatible schema changes separately.

Set `NODE_ENV=production`, `DATABASE_URL`, `SESSION_SECRET`, `PROXY_SECRET`, and `WEB_ORIGIN=https://your-exact-frontend-host`. Let Render supply `PORT`. Generate independent random values of at least 32 characters for the signing and proxy secrets. The proxy secret must match Vercel’s value. `WEB_ORIGIN` has no trailing slash and must be an HTTPS origin. The service refuses incomplete production configuration.

Only the minimal health endpoint is public directly on Render. Other API requests must carry the private `x-commonroom-proxy` header inserted by the Vercel function. One immediate ingress hop is trusted for HTTPS detection. The application never accepts a client-provided forwarded header directly through its frontend proxy: it constructs `x-forwarded-proto: https` itself. Origin and CSRF validation still apply after proxy authentication. No cross-origin CORS access is enabled.

Reference: [Render deploy lifecycle](https://render.com/docs/deploys), [Node versions](https://render.com/docs/node-version).

## 3. Vercel frontend and proxy

Import the repository with **Root Directory left at the repository root**, framework preset **Other**, Node **24.x**, and the committed `vercel.json`:

- Install: `npm ci`
- Build: `npm run build`
- Output: `apps/web/dist`
- Functions: root `api/proxy.js`

Set server-only `API_ORIGIN=https://your-api.onrender.com` and `PROXY_SECRET`. Neither is a `VITE_` variable. The browser always fetches relative `/api` URLs. Rewrites send `/api/:path*` to the Node proxy function and remaining frontend routes to `index.html`.

The function constructs an API path on the fixed `API_ORIGIN`, preserves query parameters, cookies, Origin, JSON bodies, and CSRF headers, adds the private proxy header and HTTPS indicator, and copies each upstream `Set-Cookie` separately. No cookie Domain rewrite is needed: cookies are host-only and reach the browser from its Vercel origin. Responses use `Cache-Control: no-store`. Arbitrary forwarded client headers are discarded. The proxy takes the platform-overwritten `x-real-ip` header, validates it as an IP address, and sends it as `x-commonroom-client-ip` behind the proxy secret. Render uses this value for per-visitor limits with IPv6 subnet grouping, rather than grouping all visitors under a Vercel egress IP. See [Vercel request headers](https://vercel.com/docs/headers/request-headers). Non-GET/HEAD requests use the same function, including PATCH, PUT, and DELETE. Upstream redirects are rejected. The proxy allows 90 seconds for a sleeping free Render instance to wake, within a 120-second Vercel function limit; timeouts return a recoverable 502.

Preview domains need their own API environment with the exact matching `WEB_ORIGIN`; production intentionally rejects preview-origin mutations. Keep secrets restricted to their intended environments. Avoid using production sessions/data for previews.

Reference: [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Node function request/response](https://vercel.com/docs/functions/runtimes/node-js).

## 4. Release verification

After an authorized push/deployment, verify signup, login, refresh restoration, CSRF rejection, logout cookie expiry, guest browsing, and guest mutation rejection through the Vercel URL. Inspect browser Network headers: session cookies should be HttpOnly, Secure, SameSite=Lax, Path=/api, and have no Domain; they should return on `/api/session` refresh. Confirm multiple Set-Cookie headers survive the function, protected data is never cached, and Render directly rejects requests lacking the proxy secret. Confirm a forged Origin and a missing CSRF token cannot mutate data.

Check a frontend deep link refresh and verify the API routing is not swallowed by the SPA fallback. Compare the request Origin, fixed upstream URL, proxy-added HTTPS header, and resulting Secure session cookie. These local contracts have automated coverage; platform ingress behavior still needs this deployed smoke check. Add confirmed live links to the README only after verification.
