# Task 2 Report: Connectivity Probe And VK Launch Validation

Status: DONE_WITH_CONCERNS

## Result

Implemented the Task 2 VK Mini App authentication and connectivity boundary for VK application `54751520` only.

The implementation adds:

- `verifyVkLaunchParams(searchParams, secret, maxAgeSeconds)` with canonical sorted `vk_*` parameters, SHA-256 HMAC verification, constant-time signature comparison, exact app ID enforcement, required user/timestamp validation, and bounded launch age;
- public `GET /api/vk-mini-app?action=health` health metadata with no secret or session content;
- `POST /api/vk-mini-app` session exchange for `{ action: "session", launchParams }`;
- a five-minute signed server session containing only user ID, app ID, issue time, and expiry;
- a browser `createApiClient()` with `health()`, `getJson()`, `postJson()`, bearer-session support, request timeout, JSON validation, and normalized HTTP/network/timeout errors;
- both the direct Vercel endpoint and the existing dynamic endpoint router entry.

The dedicated server-only environment variable is `VK_MINI_APP_SERVER_SECRET`. Its production value was not read, written, logged, returned, or committed. Tests use an explicit test-only fixture value.

Task 1 public shell and router behavior were not changed. The only existing source file modified is `api/[endpoint].js`, where one lazy route entry was added.

## TDD Evidence

RED:

`node --test tests/vk-mini-app-auth.test.mjs` exited 1 with 0 passing and 8 failing tests. Every failure was `ERR_MODULE_NOT_FOUND` for one of the required missing Task 2 modules: `shared/vkLaunchParams.js`, `api/_endpoints/vk-mini-app.js`, or `vk-mini-app/lib/api.js`.

GREEN:

`node --test tests/vk-mini-app-auth.test.mjs` exited 0 with 8 passing and 0 failing tests.

Covered behaviors:

- accepts a known valid VK HMAC fixture;
- rejects post-signature tampering;
- rejects a correctly signed non-`54751520` app launch;
- rejects a correctly signed expired launch;
- returns the exact public health shape without secret/session data;
- issues a five-minute server session after valid current launch verification;
- sends bearer sessions and normalizes HTTP failures;
- aborts timed-out requests and returns a normalized timeout error.

## Verification

- Focused Task 2 suite: 8 passed, 0 failed.
- Existing security suites (`static-files`, `seat-claims`, `admin-auth`, `admin-html`): 13 passed, 0 failed.
- Task 1 VK Mini App regression suite with real local Chrome: 10 passed, 0 failed, 0 skipped.
- Syntax checks for all Task 2 JavaScript files and `api/[endpoint].js`: passed.
- `git diff --check`: passed.

## Scope

Task 2 commit allowlist:

- `.superpowers/sdd/2026-09-03-vk-mini-app-author-shows/task-2-report.md`
- `shared/vkLaunchParams.js`
- `api/_endpoints/vk-mini-app.js`
- `api/vk-mini-app.js`
- `vk-mini-app/lib/api.js`
- `api/[endpoint].js`
- `tests/vk-mini-app-auth.test.mjs`

No unrelated working-tree modification is included.

## Concerns

- Production session exchange remains unavailable until `VK_MINI_APP_SERVER_SECRET` is configured server-side with the VK application protected key for app `54751520`; this task intentionally did not inspect or set that value.
- The repository-wide `npm test` command currently has unrelated failures in pre-existing modified concert pricing and browser layout surfaces. The four existing security test files requested for this task pass independently, and Task 1's VK Mini App browser regression passes independently.
- This task creates and returns signed session tokens but does not add a token-consuming protected business endpoint; later tasks must verify the token before trusting its claims.
