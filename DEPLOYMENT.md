# Deployment

Commonroom runs on [Vercel](https://commonroom-odin-book.vercel.app), a [Render API](https://commonroom-api-old9.onrender.com/api/health), and a dedicated Neon PostgreSQL database. All three use free plans. Render and Neon are in Singapore; the Vercel proxy function is configured for Singapore. Production data is separate from local development and test databases. No local seed or test data is deployed.

## 1. Neon PostgreSQL

Create a dedicated project/database in the region nearest the API. Copy a direct PostgreSQL connection string with TLS (`sslmode=require`) into Render’s `DATABASE_URL` secret. A direct connection keeps this single-instance Prisma 6 and `pg` session-store setup simple and supports migrations without transaction-pooler caveats. Do not reuse the local development or test database. Keep connection secrets out of the repository.

Committed Prisma migrations create application tables, foreign keys, indexes, database checks, and the `Session` table used by `connect-pg-simple`. The API does not create the session table at runtime. Run migrations once per release with `npm run db:migrate`. Never run local test cleanup or demo seeding against Neon. For future pooled runtime connections, configure a separate Prisma `directUrl` for migrations and account for both the Prisma and session-store pools.

Reference: [Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

## 2. Render API

Create a Node web service from this repository with the repository root as its working directory.

- Node version: **24.x** (`NODE_VERSION=24`).
- Build command: `npm ci --include=dev && npm run db:generate && npm run db:migrate`
- Pre-deploy command: none (unavailable on Free)
- Start command: `npm start`
- Health: Render currently uses its default TCP readiness check; `/api/health` is available for HTTP checks. To configure HTTP checking, set this path in the Render Dashboard’s Settings → Health Checks section.

The Free service runs committed migrations during its build. Do not add seeding to this command. A paid service could move migrations to a pre-deploy command; coordinate future incompatible schema changes separately.

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

## 4. Release verification and free-plan limits

After an authorized push/deployment, verify signup, login, refresh restoration, CSRF rejection, logout cookie expiry, guest browsing, and guest mutation rejection through the Vercel URL. Inspect browser Network headers: session cookies should be HttpOnly, Secure, SameSite=Lax, Path=/api, and have no Domain; they should return on `/api/session` refresh. Confirm multiple Set-Cookie headers survive the function, protected data is never cached, and Render directly rejects requests lacking the proxy secret. Confirm a forged Origin and a missing CSRF token cannot mutate data.

Check a frontend deep link refresh and verify the API routing is not swallowed by the SPA fallback. Compare the request Origin, fixed upstream URL, proxy-added HTTPS header, and resulting Secure session cookie. These contracts also have local automated coverage. Repeat the hosted smoke checks after changes to routing, session settings, or hosting configuration. Add confirmed live links to the README only after verification.

Render Free sleeps after 15 minutes without inbound traffic, and its free instance hours are shared across the workspace. Cold starts can take around a minute. Vercel Hobby and Neon Free also enforce usage caps. Keep paid upgrades and additional paid capacity disabled unless explicitly approved. See [Render Free limits](https://render.com/docs/free), [Vercel Hobby](https://vercel.com/docs/plans/hobby), and [Neon pricing](https://neon.com/pricing).
