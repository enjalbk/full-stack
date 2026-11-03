# Temazon

A storefront with an Express API, MongoDB data, and Stripe-hosted Checkout.

## Project structure (MVC)

`server.js` loads the environment, starts the HTTP listener and handles shutdown. `backend/app.js` assembles the application without starting a listener, so it can be imported by tests.

```text
server.js                 Server startup and shutdown
backend/
  app.js                  Express application assembly
  bootstrap/              HTTP startup, graceful shutdown and connection cleanup
  config/                 MongoDB, external integrations and dependency setup
  models/                 MongoDB persistence and owner-scoped order queries
  controllers/            Named request handlers and response handling
  routes/                 Endpoint definitions and route-specific middleware
  services/               Catalogue caching and Stripe payment workflows
  middleware/             JWT identification, roles, guest sessions, request protection, errors
  utils/                  Shared validation, errors and public serializers
  data/                   Starter product catalogue
public/                   Views: HTML, CSS and browser JavaScript
scripts/                  Local administrator management command
tests/                    Integration tests
```

Routes pass requests to controllers. Controllers use models and services, then return JSON for the views in `public/`. MongoDB transactions and the raw Stripe webhook body are preserved. There is no server-side template engine; the existing HTML/browser frontend remains the view layer.

## Setup

Requires Node.js 22.13+, a MongoDB replica set (MongoDB Atlas works), and Stripe test credentials.

```powershell
npm.cmd install
```

Add these settings to your existing `.env`, using `.env.example` as a reference. Do not overwrite other secrets and do not commit `.env`.

```dotenv
PORT=8080
NODE_ENV=development
APP_URL=http://localhost:8080
MONGODB_URI=mongodb+srv://YOUR_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER/
MONGODB_DB=temazon
STRIPE_SECRET_KEY=YOUR_STRIPE_TEST_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_WEBHOOK_SIGNING_SECRET
```

For Atlas, create a database user, allow your development IP in Network Access, and use the provided Node.js connection string. Percent-encode special characters in the username/password. `MONGODB_DB` selects the application's database explicitly.

For local MongoDB, configure a replica set and use a URI such as `mongodb://127.0.0.1:27017/?replicaSet=rs0`. Standalone MongoDB is rejected because inventory and checkout need multi-document transactions.

`APP_URL` is the trusted storefront origin used for Stripe return URLs. It must have no trailing slash. Match it to your actual port or deployed HTTPS URL. Production mode enables Secure session cookies and requires HTTPS.

```powershell
npm.cmd start
```

Open http://localhost:8080. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`. Other shells can use `npm` normally.

The server connects to MongoDB and creates required indexes before listening. Without Stripe credentials, browsing and cart APIs work but checkout returns a clear configuration error. Connection failures do not print credentials. Your existing `.env` is preserved; add the values yourself. Neither MongoDB nor Stripe credentials belong in `public/` or in chat.

## Stripe development

Hosted Checkout uses the server secret key; a publishable key is not needed. Use test keys while developing. With the Stripe CLI installed:

```text
stripe login
stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired --forward-to localhost:8080/api/stripe/webhook
```

Put the `whsec_...` signing secret printed by this command into `STRIPE_WEBHOOK_SECRET`, then restart the app. Keep the CLI running. Use Stripe's test card `4242 4242 4242 4242`, a future expiry, and any valid CVC in test mode.

For a deployed app, register the HTTPS endpoint `/api/stripe/webhook` in Stripe and use that endpoint's signing secret instead. CLI and Dashboard signing secrets are different. This implementation accepts card payments only; tax and fulfillment/shipping integrations are not implemented. Do not use live keys until those business requirements are ready.

## Data and checkout behavior

MongoDB collections:

- `products`: catalogue, integer prices in cents, available stock. Eight starter products are seeded once with 100 units each; restarts do not reset stock or overwrite existing products.
- `sessions`: hashed guest tokens, embedded cart items, cart revision and active checkout reference. An HttpOnly, SameSite cookie identifies each guest. Sessions expire after seven days; expired sessions cannot access carts/orders even before MongoDB TTL cleanup runs.
- `orders`: customer details, immutable items/prices, payment status, Stripe session reference and idempotency key. Orders are retained after guest expiration; guest access still requires an active matching session. Account-based order access and a retention policy are future work.

SQLite is no longer used. Existing SQLite files remain untouched and are **not automatically imported**. The previous localStorage-only cart is also not imported.

Prices and shipping are calculated on the server. Shipping is free from $50; otherwise $5.99. Tax is not calculated. Changing client totals cannot alter Stripe amounts.

Checkout reserves stock and locks the guest's cart in a MongoDB transaction. Stripe session creation uses a stable idempotency key, allowing retries after network errors and restarts. An open checkout can be resumed or cancelled from the bag. Checkout sessions expire after approximately 35 minutes.

The raw webhook body is verified using Stripe's signing secret. A paid order requires authoritative Stripe payment status, the matching order reference, and matching amount/currency. Merely visiting the success URL does not mark an order paid. The return page also checks Stripe on the server, helping recover a delayed webhook. Paid processing clears the bag once; it does not deduct reserved stock again. Cancellation checks/expires the Stripe session before releasing stock; paid orders cannot be cancelled through that endpoint. Expiry releases stock once and keeps bag items available to shop again. Webhook processing is idempotent.

Keep webhook delivery running: it releases abandoned reservations and confirms paid orders even when shoppers close the browser. If Stripe is unreachable, a pending reservation is retained until checkout can be recovered and reconciled. The app currently has no scheduled reconciliation job; monitor webhook delivery failures and retry them from Stripe. Shipping labels, automatic fulfillment, refunds and email receipts remain separate work. Account login and admin fulfilment are described below.

The single-process API limiter allows 180 requests per client IP each minute. Storefront mutations require JSON and a custom header; CORS is not enabled. Stripe webhooks use signature verification instead.

## API

Errors use `{ "error": "message" }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | MongoDB readiness and Stripe configuration status |
| GET | `/api/products` | Catalogue; supports `q`, `category`, `sort` |
| GET | `/api/products/:id` | Product details |
| GET | `/api/categories` | Categories |
| GET | `/api/cart` | Cart, server totals, active checkout reference |
| POST | `/api/cart/items` | Add `{ "id": 1, "quantity": 1 }` |
| PATCH | `/api/cart/items/:id` | Set `{ "quantity": 2 }` |
| DELETE | `/api/cart/items/:id` | Remove an item; send `{}` |
| GET | `/api/orders` | Latest 50 orders for the guest |
| GET | `/api/orders/:id` | One guest-owned order |
| POST | `/api/checkout/sessions` | Reserve stock and open Stripe Checkout |
| POST | `/api/checkout/:id/resume` | Resume an existing checkout; send `{}` |
| POST | `/api/checkout/:id/cancel` | Expire checkout and release stock; send `{}` |
| GET | `/api/checkout/:id` | Reconcile and retrieve payment status |
| POST | `/api/stripe/webhook` | Verified Stripe events; raw JSON body |

`POST /api/orders` returns 410; direct demo order creation has been removed.

Storefront mutations require `Content-Type: application/json` and `X-Temazon-Request: 1`. Use the guest cookie returned by `/api/cart`. Creating a checkout additionally requires an `Idempotency-Key` header (16-100 letters, digits, underscores or hyphens) and this body:

```json
{
  "customer": {
    "name": "Test Shopper",
    "email": "test@example.com",
    "address": "123 Example Street",
    "city": "Toronto",
    "postal": "A1A 1A1"
  }
}
```

The response contains `orderId` and the Stripe `url` to navigate to. Reuse the key for retries of the same checkout. Items and totals come from the server's saved bag. Customer details are stored in MongoDB; card details stay on Stripe.

## Tests

```powershell
npm.cmd test
```

Tests launch an isolated temporary MongoDB replica set and simulate Stripe API responses while exercising real Stripe webhook signature verification. No Atlas credentials, Stripe keys, or actual charges are needed. The first run downloads a MongoDB test binary into ignored `.cache/mongodb/`; later runs reuse it. Tests never use your configured store database.

Coverage includes catalogue/cart APIs, validation, guest isolation, restart persistence, concurrent updates, atomic inventory reservation, checkout idempotency, payment confirmation, amount mismatch, expired/cancelled checkout, webhook replay/signatures, and frontend redirect behavior. A real Stripe sandbox checkout still needs your own credentials and running webhook forwarding.

References: [MongoDB transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhook verification](https://docs.stripe.com/webhooks/signature).

## Accounts, Google login and JWTs

Open `/account.html` to register, sign in, connect Google, change a password, or view order history. Bcrypt hashes local passwords with a work factor of 12. Passwords must be at least 12 characters and no more than 72 UTF-8 bytes; bcrypt's byte limit is checked before hashing. Local email verification, password-reset email, and MFA are not yet implemented.

Set a strong, random `JWT_SECRET` of at least 32 bytes in `.env`. Generate one in your own terminal:

```text
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

App JWTs last one hour and are stored in an HttpOnly, SameSite cookie, with Secure enabled in production. They are not returned in JSON or stored in localStorage. Verification restricts the algorithm, issuer and audience. MongoDB holds revocable authentication sessions, and middleware checks the current user and role on each request. Sign-out revokes the current JWT; changing a password revokes all account sessions. Sign in again when the one-hour session expires; automatic refresh is not implemented.

Sign-in rotates the guest shopping cookie and carries over that browser's guest cart and orders. Account order history is available across browsers after login. Carts remain per-browser; they are not merged across devices. Signing out starts a fresh guest bag. A shopping cookie alone cannot access an account-owned cart or orders.

### Firebase Google sign-in

1. Create/select a Firebase project. In Authentication, enable the **Google** provider and configure its support email.
2. Add `localhost` and your deployment hostname to Authentication's authorized domains. Register a Firebase web app.
3. Copy that web app's config into `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, and `FIREBASE_APP_ID` in `.env`.
4. Create a Firebase Admin service-account key. Put its client email into `FIREBASE_CLIENT_EMAIL` and its private key into `FIREBASE_PRIVATE_KEY`. Keep this service-account key private and out of Git.

For the private key, preserve the PEM markers and use quoted escaped newlines, for example:

```dotenv
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_KEY_CONTENT\n-----END PRIVATE KEY-----\n"
```

The web config is deliberately public and is delivered by `/api/auth/config`; the service-account private key never leaves the server. The Google button uses Firebase's hosted Google OAuth flow and exchanges the resulting Firebase ID token for an app JWT. Firebase Admin verifies the token, checks revocation, requires the Google provider and a verified Google email. The frontend uses in-memory Firebase persistence and signs out of the temporary Firebase client after the exchange.

Existing password accounts are never automatically linked by matching an email. Sign in with the password and use **Connect your Google account** to explicitly link the verified Google identity. The email must match. New accounts always start as `customer`; request-supplied roles are ignored.

## Redis cache

Set `REDIS_URL` to your Redis connection URL, such as `redis://127.0.0.1:6379`, or use a `rediss://` URL for a TLS-enabled service. `REDIS_PREFIX` isolates cache namespaces; MongoDB database names also isolate keys.

Catalogue descriptions/images are cached for 30 seconds. Every response overlays fresh MongoDB prices, available stock, version, and active state; checkout always reads MongoDB inside a transaction. Admin product changes invalidate the catalogue through a versioned key, which also prevents an older in-flight read from repopulating the current cache version. Accounts, carts, JWTs and orders are not cached.

With no Redis URL, caching is disabled. An unavailable Redis service falls back to MongoDB. The Redis client uses bounded queues, short connection timeouts and limited reconnect attempts; restart after a prolonged outage. A failed invalidation can leave descriptive text stale until its 30-second TTL, while prices/stock remain authoritative. `/api/health` reports whether Redis caching is active.

## Cloudinary product images

Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` in `.env`. In the admin product editor, select an image and press **Upload image**, then save the product.

Only administrators can upload. The server accepts one PNG, JPEG or WebP image up to 5 MB, checks the file signature and uses Cloudinary's signed server-side upload. Cloudinary validates/decodes the image and limits it to 1600 x 1600. The returned HTTPS URL and public ID are saved as a MongoDB media record. Product creation references the saved media ID; arbitrary URL fetching is not supported. Existing starter Unsplash images remain until replaced.

The UI uses the saved Cloudinary URL for uploaded products. Archiving a product preserves its media and historical order snapshots. Unused uploads are not automatically deleted; manage orphaned assets in Cloudinary as needed. Cloudinary credentials are never sent to the browser.

## Administrator dashboard

1. Create an account through `/account.html`.
2. Grant its administrator role from your local terminal:

```powershell
npm.cmd run admin -- your-email@example.com
```

3. Refresh the account page and choose **Open admin**, or visit `/admin.html`.

To remove admin access:

```powershell
npm.cmd run admin -- your-email@example.com --remove
```

There is no public role-promotion endpoint or default administrator password. Access is enforced by backend middleware; hiding UI controls is not the security boundary. Current roles are read from MongoDB on every authenticated request, so revocation is effective on the next request.

The dashboard includes paid revenue, active product count, order count, customer count, product creation/editing/archive, Cloudinary upload, latest orders and latest customer accounts. Product edits include a version to reject stale changes after a concurrent inventory update. Stock means currently available units, excluding reserved checkout items. Archived products cannot be newly added or checked out; historical orders are preserved.

Paid orders can move through processing and shipped fulfilment, with an optional tracking number. Fulfilment cannot mark an unpaid order paid or undo a shipment. Payment state still comes exclusively from Stripe. Product/fulfilment changes and local role grants are recorded in `admin_audit`. Dashboard tables show the latest 100 orders and 50 users; pagination and shipping-carrier integration are future work.

The admin HTML is a public shell, while every `/api/admin/*` data/mutation endpoint requires an authenticated administrator. Product text is escaped before rendering in the storefront and dashboards.

## Additional API endpoints

All mutations retain the JSON/custom-header checks, except `/api/admin/images`, which uses multipart FormData with the same custom header. Stripe webhooks retain their separate signature check.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/auth/config` | Public Firebase web config and enabled sign-in methods |
| GET | `/api/auth/me` | Current user, or null |
| POST | `/api/auth/register` | Local signup: name, email, password |
| POST | `/api/auth/login` | Local sign-in: email, password |
| POST | `/api/auth/google` | Exchange `{ "idToken": "..." }` for an app session |
| POST | `/api/auth/google/link` | Link Google to the signed-in account |
| POST | `/api/auth/logout` | Revoke session and clear cookies |
| POST | `/api/auth/password` | Current/new password; revoke all sessions |
| GET | `/api/admin/overview` | Store summary |
| GET | `/api/admin/products` | All products, including archived |
| POST | `/api/admin/products` | Add product with imageId |
| PATCH | `/api/admin/products/:id` | Edit product using its version |
| DELETE | `/api/admin/products/:id` | Archive using `{ "version": 0 }` |
| POST | `/api/admin/images` | Upload FormData field `image` |
| GET | `/api/admin/orders` | Latest orders across the store |
| PATCH | `/api/admin/orders/:id` | Paid-order fulfilment and tracking |
| GET | `/api/admin/users` | Latest account summaries without password hashes |

Product input includes `name`, `category`, `description`, integer `priceCents`, integer available `stock`, and uploaded `imageId`. Updates also include `version` and can omit `imageId` to keep the existing image.

Authentication attempts are limited to 20 per IP per 15 minutes per process. Uploads have an additional 20-per-minute limit. The middleware module under `backend/middleware/` supplies authentication requirements, role checks, rate limiting and customer validation. The app also retains bounded JSON parsing, request protection and centralized error responses.

Only Firebase Auth is used: `.npmrc` omits optional dependencies, including unused Firestore/Storage SDKs. MongoDB remains the database. Authentication, admin and caching tests use real MongoDB and bcrypt/JWT behavior, with simulated Firebase token verification, Redis client responses and Cloudinary uploads. Real Google popup login, Redis connectivity and Cloudinary delivery require your own service configuration; browser testing remains separate.

References: [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin), [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [bcrypt](https://github.com/kelektiv/node.bcrypt.js), [JWT](https://github.com/auth0/node-jsonwebtoken), [Redis Node.js](https://redis.io/docs/latest/develop/clients/nodejs/), [Cloudinary uploads](https://cloudinary.com/documentation/node_image_and_video_upload).
