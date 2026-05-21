# Frontend Specification

## 1. Tech Stack

| Concern          | Choice                                            |
|------------------|---------------------------------------------------|
| Framework        | React 19 + TypeScript                             |
| Build tool       | Vite                                              |
| Routing          | TanStack Router (type-safe, HTML5 History API)    |
| Data fetching    | TanStack Query                                    |
| Styling          | Tailwind CSS v4                                   |
| UI primitives    | shadcn/ui (Radix under the hood)                  |
| Icons            | lucide-react                                      |
| Forms            | react-hook-form + zod                             |
| Toasts           | sonner                                            |
| i18n             | i18next + react-i18next                           |
| PWA              | vite-plugin-pwa (Workbox)                         |
| Tests            | Vitest + React Testing Library + Playwright (e2e) |
| Lint / format    | ESLint + Prettier                                 |
| Package manager  | pnpm                                              |

### Repo layout

```
source/
  backend/      # existing FastAPI app
  frontend/     # NEW — Vite project with its own package.json
    src/
      routes/
      components/
      lib/        # api client, query keys, helpers
      i18n/
      hooks/
    public/
    index.html
    package.json
    vite.config.ts
```

### Dev / Prod setup

- **Dev:** Vite dev server on `:5173`, FastAPI on `:8000`. Vite proxies `/api/*` → `localhost:8000`. From the browser everything looks like one origin (`:5173`) → no CORS needed.
- **Prod:** `pnpm build` produces `source/frontend/dist/`. FastAPI mounts that directory as `StaticFiles` at `/` and serves `index.html` as fallback for any non-`/api` route (so deep links + browser refresh work with HTML5 History API). API stays at `/api/*`. **Same origin → no CORS.**
- **Reverse proxy:** Deployment behind e.g. `finanzguruclone.mydomain.de`. FastAPI must trust `X-Forwarded-For` / `X-Forwarded-Proto` headers (uvicorn `--proxy-headers`) so that secure cookies and IP logging work correctly.

### Security baseline

- Session cookie: `HttpOnly`, `Secure` (in prod), `SameSite=Lax`, lifetime **14 days** when "remember me" is checked, otherwise session-only.
- **CSRF protection** for all state-changing routes (`POST`/`PATCH`/`PUT`/`DELETE` under `/api`). Strategy: double-submit token — backend issues a `csrf_token` cookie (readable by JS, not HttpOnly) on first request; frontend echoes it back in an `X-CSRF-Token` header for mutations.
- **Rate limiting:** new middleware. Strict on `/api/auth/login`, `/api/auth/register`, `/api/auth/2fa`. Looser global default. Backed by an in-process token bucket initially (no Redis dependency yet); pluggable for later.
- Content-Security-Policy header set by FastAPI.
- Password requirements (15+ chars, upper/lower/digit/symbol) live in the backend as the **single source of truth** and are exposed via `GET /api/auth/password_requirements` so the frontend can render the live validator from the same rules.

---

## 2. API changes

### 2.1 Route move

All existing routers move under the `/api` prefix:

| Old                       | New                              |
|---------------------------|----------------------------------|
| `/users`                  | `/api/users`                     |
| `/credentials`            | `/api/credentials`               |
| `/account`                | `/api/account`                   |
| `/login`                  | `/api/auth/login`                |
| `/register`               | `/api/auth/register`             |
| `/logout`                 | `/api/auth/logout`               |

### 2.2 New endpoints

- `GET  /api/auth/me` — returns the current user (`UserRead`) or 401. Used by the SPA on boot to decide whether to redirect to `/login`.
- `GET  /api/auth/registration_allowed` — `{ allowed: bool }`. Public, no auth.
- `GET  /api/auth/password_requirements` — `{ min_length, require_upper, require_lower, require_digit, require_symbol, ... }`. Public.
- `POST /api/auth/login` — accepts `{ name, password, remember_me: bool }`. `remember_me=true` ⇒ cookie max-age = 14 days.
- `PATCH /api/users/{id}` — extended to accept `display_name`, `current_password`, `new_password` (re-auth required for password change).
- `DELETE /api/users/{id}` — delete own account.
- `GET    /api/users/{id}/sessions` — list of `{ id, created_at, last_used_at, ip, user_agent, is_current }`.
- `DELETE /api/users/{id}/sessions/{session_id}` — kill a specific session (the current one is **not** revocable via this endpoint; that's what logout is for).
- `DELETE /api/users/{id}/sessions?exclude_current=true` — "sign out everywhere else".
- `PATCH  /api/account/{aid}` — extended to accept `balance_factor` (int, 0–100).
- `GET    /api/account/{aid}/transactions/{tid}` — single transaction.
- `PATCH  /api/account/{aid}/transactions/{tid}` — accepts `{ note: str | null, category: TransactionCategory | null }`. `null` on `note` deletes the note. Setting `category` is treated as a **manual override** and is logged (see §2.5).
- `GET    /api/credentials/supported_banks` — wraps the existing `list_all_possible` output, **including a new `icon` field** per `BankProvider`.
- `PATCH  /api/users/{id}` — additionally accepts `language: "en" | "de"` (any locale that has a translation file shipped).
- `GET    /api/i18n/languages` — `{ languages: ["en", "de", ...] }`. Public. Returned list is derived from the translation files that actually ship with the backend, so the frontend selector is always in sync with what's implemented.

### 2.3 Model changes

- `User`: add `display_name: str | None`, `language: str` (default `"en"`, must be one of the implemented locales — validated against the translation files at write time).
- `Account`: add `balance_factor: int` (default 100, range 0–100).
- `Transaction`: add `note: str | None`, `category: TransactionCategory` (enum, default `UNKNOWN`).
- `Session`: add `ip: str | None`, `user_agent: str | None`, `last_used_at: datetime` (update on every authenticated request). `created_at` should already exist; if not, add.
- `BankProvider` (the data structure backing the `BANKS` SoT, per MEMORY): add an `icon` property (path to a static asset served by FastAPI under `/static/banks/<slug>.png`). **Enum member names stay UPPER** — only the data record gains a field; no DB migration of enum values.
- `TransactionCategory` (new enum): `UNKNOWN`, `GROCERIES`, `RESTAURANTS`, `TRANSPORT`, `FUEL`, `RENT`, `UTILITIES`, `INSURANCE`, `SALARY`, `SUBSCRIPTIONS`, `SHOPPING`, `HEALTH`, `ENTERTAINMENT`, `TRANSFER`, `CASH`, `FEES`, `OTHER`. Member names stay UPPER (same rule as `BankProvider`, per MEMORY — no DB migration of enum values once shipped).

### 2.4 Balance factor semantics

- `User.balance` becomes `sum(account.balance * account.balance_factor / 100 for account in user.accounts)`.
- The per-account daily balance history (used by `GET /api/account/{aid}/history`) is **not** scaled by `balance_factor` — it represents the real account balance over time.

### 2.5 Transaction category matching

- A pure function `categorize(other_party: str | None, purpose: str | None) -> TransactionCategory` lives in the backend (e.g. `source/backend/services/categorization.py`). It is the **single source of truth** for matching rules — used both at ingest time and during the startup re-scan.
- **Rules** are defined declaratively: a list of `(category, patterns)` where patterns match against `other_party` first, then `purpose`. Initial set is small and grows over time as the logs reveal new merchants. Matching is case-insensitive substring (or regex per rule — to be decided per rule).
- **At ingest time:** when a `Transaction` is persisted (initial sync or incremental), `category` is set via `categorize(...)`. No `UNKNOWN` rows are created intentionally — they only exist when no rule matched.
- **Startup re-scan:** on FastAPI startup, a background task iterates over all `Transaction` rows where `category == UNKNOWN` and re-runs `categorize(...)`. Any newly matched rows are updated in-place (no event/notification — silent backfill).
  - Runs once per process start. Streams in batches (e.g. 500 rows) to avoid loading everything at once.
  - Logged at `INFO`: `"category re-scan: checked N, updated M"` at the end.
- **Logging unknowns:** when `categorize(...)` returns `UNKNOWN` (both at ingest and during the re-scan), log at `INFO` the full `Transaction` object (per `[[feedback_log_objects]]` — every model has a safe `__repr__`, prefer `{tx}` over `{tx.id}`). The log line must make `other_party` and `purpose` directly visible so I can grep the logs for missing rules.
- **Manual override:** `PATCH /api/account/{aid}/transactions/{tid}` accepts `category`. When set, the transaction's `category` is updated and the override is logged at `INFO` with: the previous category, the new category, and the full `Transaction` object (so `other_party` + `purpose` are visible — same reasoning as above, this is what feeds new rules).
- Once manually set, a transaction's category is **not** touched by the startup re-scan (only `UNKNOWN` rows are revisited). A future "reset to auto" action can be added if needed (deferred).

---

## 3. Pages

Routing model: HTML5 History API. The server serves `index.html` for any non-`/api` URL.

### 3.1 `/` — Overview

- On mount: `GET /api/auth/me`. 401 ⇒ redirect to `/login?next=/`.
- Layout (top to bottom):
  1. `Hello, <display_name || name>` — heading.
  2. Total balance — larger, bold, prominent. Uses `UserRead.balance` (already balance-factor-scaled by the backend).
  3. List of accounts (all of them, including those with `balance_factor = 0`).
- Account row: bank icon · account name (left), balance (right, red + minus sign if negative).
- Sort: grouped by bank, banks alphabetical, accounts alphabetical within bank.
- Click on account row → navigate to `/account/<id>`.
- Pull-to-refresh on mobile triggers `POST /api/users/sync` (global sync). A slim progress bar at the top is shown while syncing.
- Top-right: cog icon → `/settings`.
- Empty state (no accounts yet): friendly message with a CTA button → `/settings/credentials` ("Connect your first bank").

### 3.2 `/login`

- A **toggle/button at the top** switches between Login and Register modes (different field sets, single page).
- Fields (Login): name, password, "Remember me" checkbox.
- Fields (Register): name, password, password (confirm), display name (optional). Live validation against `/api/auth/password_requirements`.
- After successful login/register: redirect to `?next=` if present, else `/`.
- If `GET /api/auth/registration_allowed` returns `false`: the Register toggle is **still visible**, but instead of the form it shows a message "Registration is currently disabled by the administrator."
- Errors are shown **inline** per field. A general top-level error banner exists only for server-side issues unrelated to a specific field (e.g. rate limit hit).

### 3.3 `/account/<id>` — Account detail

- Top-left: back button (also navigable via native back gesture; that's why each page has its own route).
- Top: current account balance (raw, no balance-factor scaling).
- Top-right: search/magnifier icon — non-functional for now, **TODO: backend search endpoint**.
- Below: transactions grouped by date (most recent first).
  - Each date gets a sticky-ish header: **left** the date (e.g. `Today`, `Yesterday`, `May 20, 2026`), **right** the account's end-of-day balance (no "Stand:" prefix; just the number).
  - Each transaction row: **left** other party (fallback `Unknown` when null), **right** amount in EUR (`€`). Red for outgoing (negative), green for incoming (positive).
- Infinite scroll: when the user nears the bottom, fetch the next page via the existing day-paginated `/api/account/{aid}/history`.

### 3.4 `/account/<id>/transactions/<id>` — Transaction detail

- Back button top-left.
- Top 1/3: the amount, colored (red/green).
- Bottom 2/3: a borderless table with the rest, in this order:
  - Other party
  - Date
  - Purpose
  - Type (raw enum value for now — **TODO: nicer labels via i18n**; an icon per type is rendered next to it)
  - Category — rendered with the localized label of the `TransactionCategory` enum. Clickable / dropdown-style editor: user can pick any category from the enum. Change is persisted via `PATCH /api/account/{aid}/transactions/{tid}` with `{ category }`. Backend logs the override (see §2.5).
  - Note — **inline editable**, auto-saved (debounced ~500 ms) via `PATCH /api/account/{aid}/transactions/{tid}`. Empty string ⇒ note is deleted (`null`).

### 3.5 `/settings`

- A settings index page with links to:
  - User settings → `/settings/user`
  - Credentials → `/settings/credentials`
  - Sessions → `/settings/user/sessions`
- At the bottom: **Logout** button.

### 3.6 `/settings/credentials` and `/settings/credentials/<id>`

- **List page:** all credentials of the user, each row shows bank icon, bank name, last sync timestamp, a sync button, and a delete button (delete opens a confirmation modal).
- **Add flow:** "Add credential" button → first a bank picker (from `GET /api/credentials/supported_banks`, rendered with icons), then a dynamically generated form whose fields come from `list_all_possible` for that bank. Submit → `POST /api/credentials`.
- **2FA flow:** when sync returns `TWO_FACTOR_REQUIRED`, a modal asks for the code. **TODO: full 2FA UX still to be designed.**
- **Detail page (`/settings/credentials/<id>`):** for now, only the **accounts** belonging to that credential are editable, and only the **balance_factor** per account. (Editing the credential's own bank password/etc. is out of scope for v1.)

### 3.7 `/settings/user`

- Change display name.
- Change password (requires current password + new password + confirm). Live-validated against the backend rules.
- **Language selector**: dropdown populated from `GET /api/i18n/languages` (so only languages that actually have a translation file are offered — currently `en`, `de`). Selection persisted via `PATCH /api/users/{id}` with `{ language }`. On success, i18next's active language is switched immediately (no reload).
- Delete account (with confirmation modal). **Requires a new API endpoint, see TODO.**

### 3.8 `/settings/user/sessions`

- Columns: Created, Last used, User-Agent (truncated, hover for full), IP, `Current` badge for the current session, action button.
- Action: "End session" — only available for non-current sessions.
- Top-right: "Sign out everywhere else" button.

---

## 4. Design

- **Theme:** dark mode only (for now). Modern, clean.
  - **Background:** `#1e1e1e`.
  - **Foreground (text):** white (`#ffffff`).
  - **Primary accent:** `#03ecfc` (cyan). Used for primary buttons, focus rings, links, and other "interactive emphasis" affordances.
  - Strong pleasant red and green are still used for negative/positive amounts. Accessibility for color-blindness deferred.
- **Typography:** TBD (modern system stack until decided — `Inter`, `Geist`, or similar).
- **Responsiveness:** mobile-first. Bottom-of-page actions on mobile, top-aligned controls on desktop. No hamburger; back navigation is either the top-left back button or the device's native back gesture.
- **Locale:** display locale is **`de-DE`** for numbers and dates (e.g. `1.234,56 €`, `20. Mai 2026`). i18n strings default to **English** (`en`), translations to German (`de`) provided. Language is auto-detected from the browser on first load (when `User.language` is not yet set), then overridable via `/settings/user` (see §3.7). The list of selectable languages comes from `GET /api/i18n/languages`.
- **Loading states:** skeletons (not spinners) for everything that has known layout.
- **Feedback:** toasts via `sonner` — small, bottom of the screen, green check on success, auto-dismiss after ~3 s.
- **Browser support:** modern evergreen only (last 2 versions of Chromium, Firefox, Safari).
- **PWA:** installable. Manifest, 192/512 icons, offline shell with a "you're offline" indicator that uses the last query cache. Push notifications deferred.
- **Branding:** working title "Finanzguru Clone". Favicon + manifest icons TBD.

---

## 5. Open / Deferred (linked from the TODO list below)

- 2FA UI flow.
- Transaction search/filter (UI + backend endpoint).
- Push notifications.
- Final color palette, typography, and logo.
- Light mode.

---

# TODO

## Backend — route move
- [x] Move all existing routers under the `/api` prefix.
- [x] Move `/login`, `/register`, `/logout` to `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`.
- [x] Update all tests and scripts referencing the old paths.

## Backend — new endpoints
- [x] `GET /api/auth/me`
- [x] `GET /api/auth/registration_allowed`
- [x] `GET /api/auth/password_requirements`
- [x] `POST /api/auth/login` — add `remember_me` field; 14-day cookie when true, session cookie otherwise.
- [x] `PATCH /api/users/{id}` — accept `display_name`, `current_password`, `new_password`.
- [x] `DELETE /api/users/{id}` — delete own account.
- [x] `GET /api/users/{id}/sessions`
- [x] `DELETE /api/users/{id}/sessions/{session_id}` (every session possible except the current one, use `/logout` for this)
- [x] `DELETE /api/users/{id}/sessions?exclude_current=true`
- [x] `PATCH /api/account/{aid}` — accept `balance_factor`.
- [x] `GET /api/account/{aid}/transactions/{tid}`
- [x] `PATCH /api/account/{aid}/transactions/{tid}` — `{ note }`.
- [x] `GET /api/credentials/supported_banks` — wrap `list_all_possible`, include `icon` field per bank.
- [x] `GET /api/i18n/languages` — derived from the translation files actually shipped.
- [x] `PATCH /api/users/{id}` — additionally accept `language` (validated against the implemented locales).
- [x] `PATCH /api/account/{aid}/transactions/{tid}` — additionally accept `category`; log the override per §2.5.

## Backend — models & migrations
- [x] `User.display_name: str | None` — Alembic migration.
- [x] `Account.balance_factor: int` default 100, range 0–100 — Alembic migration.
- [x] `Transaction.note: str | None` — Alembic migration.
- [x] `Session.ip`, `Session.user_agent`, `Session.last_used_at` — Alembic migration; update `last_used_at` in the auth dependency.
- [x] `BankProvider`: add an `icon` property to the `BANKS` data records. **Do not change Enum member names** (must stay UPPER, per MEMORY).
- [x] Update `User.balance` computation to apply `balance_factor`.
- [x] `User.language: str` default `"en"` — Alembic migration; validate against the implemented locales on write.
- [x] `TransactionCategory` enum + `Transaction.category` column (default `UNKNOWN`) — Alembic migration. Member names UPPER (per MEMORY); do not rename later.

## Backend — categorization
- [x] `TransactionCategory.from_transaction(...)` (in `source/backend/models/transaction_category.py`) with `TRANSACTION_TYPE_MAPPING: dict[TransactionCategory, list[str]]`; case-insensitive substring matching. Single source of truth for ingest + re-scan.
- [x] Call `from_transaction(...)` on every newly persisted `Transaction` (initial sync + incremental) via `Transaction.from_fetched`.
- [x] FastAPI startup background task: iterate `Transaction.category == UNKNOWN` in batches (~500), re-run categorization, update matched rows in place. Log `"category re-scan: checked N, updated M"` at the end.
- [x] Log at `INFO` whenever categorization returns `UNKNOWN` at ingest — logs the full `Transaction` object (per [[feedback_log_objects]]), so `other_party` + `purpose` are visible.
- [x] On manual override via `PATCH .../transactions/{tid}`: persist the new category, log at `INFO` the previous + new category + full `Transaction` object. Re-scan skips non-UNKNOWN rows (only `category == UNKNOWN` are revisited), so manual choices are never overwritten.

## Backend — security
- [x] CSRF middleware (double-submit token: `csrf_token` cookie + `X-CSRF-Token` header for mutations).
- [x] Set session cookie flags: `HttpOnly`, `Secure` (prod), `SameSite=Lax`.
- [x] Rate limiting middleware. Strict on `/api/auth/login`, `/api/auth/register`, `/api/auth/2fa`; looser global default. In-process token bucket, designed to be swappable for Redis later.
- [x] CSP response header.
- [x] Trust proxy headers (`uvicorn --proxy-headers`) so deployments behind a reverse proxy work correctly.

## Backend — static & serving
- [ ] Mount `source/frontend/dist/` as `StaticFiles` at `/`.
- [ ] Add a catch-all route that serves `index.html` for any non-`/api`, non-`/static` path (so HTML5 History routes work on refresh / deep link).
- [x] Serve `/static/banks/<slug>.png` for bank icons.

## Frontend — scaffolding
- [ ] Initialize `source/frontend/` with Vite + React + TS + pnpm.
- [ ] Configure Tailwind v4, shadcn/ui, ESLint, Prettier.
- [ ] Set up TanStack Router with HTML5 History API.
- [ ] Set up TanStack Query with a typed API client; CSRF header injection in mutations.
- [ ] i18n with `en` (default) and `de`; locale for numbers/dates: `de-DE`.
- [ ] PWA via `vite-plugin-pwa`: manifest, icons (192, 512), offline shell.
- [ ] Vitest + Testing Library setup; Playwright e2e harness.
- [ ] Vite dev proxy for `/api` → `localhost:8000`.

## Frontend — pages (in build order)
- [ ] Auth boot flow: call `GET /api/auth/me` on app start; redirect to `/login?next=…` on 401.
- [ ] `/login` page (toggle login/register; remember me; live password validation; inline errors).
- [ ] `/` overview (hello + total balance + accounts grouped by bank, alphabetical; pull-to-refresh triggers global sync).
- [ ] `/account/<id>` (back button; balance header; transactions grouped by date with day-end balance; infinite scroll; magnifier icon placeholder).
- [ ] `/account/<id>/transactions/<id>` (amount header; borderless table; inline-editable auto-saved note; **category dropdown** that PATCHes `category`).
- [ ] `/settings` index with logout.
- [ ] `/settings/user` (display name, password change, **language selector populated from `GET /api/i18n/languages`**, delete account).
- [ ] `/settings/user/sessions` (list + revoke + "sign out everywhere else").
- [ ] `/settings/credentials` (list, add via bank picker → dynamic form, delete with modal, sync button, last-sync timestamp).
- [ ] `/settings/credentials/<id>` (account list with `balance_factor` editor).

## Deferred / later
- [ ] 2FA UI flow (modal during sync when `TWO_FACTOR_REQUIRED`).
- [ ] Transaction search/filter — backend endpoint + frontend UI behind the magnifier icon.
- [ ] Push notifications (PWA).
- [ ] i18n-friendly labels for `TransactionType` enum (replace raw enum values in UI).
- [ ] Light mode.
- [ ] Final color palette, typography choice, logo / favicon, app name.
- [ ] Editing the credential's own bank-side credentials (not only the linked accounts).
