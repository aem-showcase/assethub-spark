# Testing Guide — assethub-spark

> Read this before adding tests or running the test suite.
> For test infrastructure configuration, see `vitest.config.js` and `vitest.dom.setup.js`.

---

## Test Types

The project uses [Vitest](https://vitest.dev/) with four distinct test projects, each
targeting a different layer of the stack.

### 1. Unit Tests (`*.test.js`)

- **Environment:** Node.js
- **Pattern:** `**/*.test.js` (excluding `*.dom.test.js`)
- **Location:** Mirror the source path — `scripts/__tests__/`, `cloudflare/src/__tests__/`
- **What they test:** Pure functions, utilities, data transformers, URL param parsing
- **Run:** `npm test` (runs all test projects)

### 2. DOM Tests (`*.dom.test.js`)

- **Environment:** jsdom (browser DOM simulation)
- **Pattern:** `**/*.dom.test.js`
- **Setup:** `vitest.dom.setup.js`
- **What they test:** Block decoration logic, DOM manipulation, event handling
- **Run:** `npm test`

### 3. Integration Tests (`tests/integration/**`)

- **Environment:** Node.js
- **Pattern:** `tests/integration/**/*.test.js`
- **Timeout:** 30 seconds per test
- **What they test:** Live API endpoints hit with a real session cookie
- **Setup required:** A valid session cookie must be in `.env` (obtain by logging in)
- **Run:**
  ```bash
  npm run test:integration:local    # against local worker (wrangler dev)
  npm run test:integration          # against preview environment
  npm run test:integration:prod     # against production (use carefully)
  ```

### 4. AuthZ Tests (`tests/authz/**`)

- **Environment:** Node.js
- **Pattern:** `tests/authz/**/*.test.js`
- **Timeout:** 30 seconds per test
- **What they test:** Authorization rules using 13 real user personas impersonated via the SUDO mechanism
- **Personas tested:** admin, employee, partner (US), partner (JP), partner (no country), agency, customer, no-roles, restricted-brand employee, …
- **Setup required:** SUDO cookie configured in `.env`
- **Run:**
  ```bash
  npm run test:authz          # against preview environment
  npm run test:authz:no-report
  ```
- **Key validation:** Each persona must see exactly the assets/collections/pages that their
  role + country + brand restrictions allow. Brand filter bypass, country filter bypass,
  and collection ACL are all validated here.

---

## Running Tests

```bash
# All tests (unit + DOM)
npm test

# Watch mode (unit + DOM)
npm run test:watch

# Worker tests (Cloudflare-specific)
cd cloudflare && npm test

# Integration (pick environment)
npm run test:integration:local     # requires wrangler dev running
npm run test:integration           # preview
npm run test:integration:prod      # production

# AuthZ
npm run test:authz
```

---

## Where to Put New Tests

| What you're testing | Where to put the test |
|---------------------|----------------------|
| Pure utility function in `scripts/` | `scripts/__tests__/{filename}.test.js` |
| Block DOM behaviour | `blocks/{name}/__tests__/{name}.dom.test.js` |
| Cloudflare Worker handler | `cloudflare/src/__tests__/{handler}.test.js` |
| Live API endpoint | `tests/integration/{feature}.test.js` |
| Authorization rule for a user persona | `tests/authz/{feature}.test.js` |

---

## Naming Convention

Test names should encode: **what**, **under what condition**, **expected outcome**.

```js
// ✅ Good
it('returns zero results when user has no roles', ...)
it('injects country filter for partner users with restricted countries', ...)
it('renders asset card with download button when user has download permission', ...)

// ❌ Bad
it('test search', ...)
it('works correctly', ...)
```

---

## When to Add Which Test Type

| Change | Test to add |
|--------|-------------|
| New utility function | Unit test |
| New block / block DOM change | DOM test |
| New `/api/*` endpoint | Integration test |
| New authZ rule or role | AuthZ test with the affected persona |
| Bug fix | Regression test (same type as the bug's layer) in the same PR |

---

## No Coverage Gate (Current State)

There is no enforced coverage threshold in CI at this time. Add tests for the code you
change. If you find an untested critical path (especially in `cloudflare/src/`), add a test.
