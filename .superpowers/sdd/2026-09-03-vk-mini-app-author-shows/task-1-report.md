# Task 1 Report: Isolated Mini App Shell And Routing

Status: DONE_WITH_CONCERNS

## Result

Implemented the isolated `vk-mini-app/` shell and its focused Node test. No existing public page, API, configuration, or unrelated user file was modified.

The shell includes:

- an immutable `SHOWS` map for `secret`, `huligan`, and `matvey`;
- `parseLaunchRoute(locationLike)` with catalog fallback for missing or unsupported `show` values;
- a three-show catalog and direct-show screen;
- initial loading and explicit unavailable states;
- VK WebView safe-area padding and responsive mobile-first layout;
- existing local show artwork and project fonts, without copied legacy Mini App code or a hard-coded VK application ID.

## TDD Evidence

RED:

`node --test tests/vk-mini-app.test.mjs` exited 1 with 0 passing and 3 failing tests. The failures were caused by the missing `vk-mini-app/` directory and missing `lib/shows.js` and `lib/router.js` exports.

GREEN:

`node --test tests/vk-mini-app.test.mjs` exited 0 with 3 passing, 0 failing tests.

Additional checks:

- `node --check vk-mini-app/app.js && node --check vk-mini-app/lib/router.js && node --check vk-mini-app/lib/shows.js` exited 0.
- `http://127.0.0.1:8899/vk-mini-app/` returned HTTP 200 with `text/html`.
- `http://127.0.0.1:8899/vk-mini-app/?show=secret` returned HTTP 200 with `text/html`.
- The staged file list was checked before commit and contained only the six Task 1 files.

## Commit

`4b9976e feat: add VK author shows app shell`

## Concern

The available Computer Use browser surfaces could not open a local tab, so a visual 375px/1440px browser pass was not completed. Automated contract, syntax, and local HTTP checks passed; no claim is made about visual verification in this environment.

## Fix Round 1

Status: DONE

Commit: `111ed75 fix: preserve VK launch routing context`

Review fixes:

- Added `buildLaunchHref()` so show navigation changes or removes only `show` while preserving every VK launch query parameter and the URL hash.
- Added `pushLaunchRoute()` and wired catalog cards and the detail back control through `history.pushState`; `popstate` continues to render the URL-selected route.
- Added `focusRouteHeading()` and moved focus to the new `h1` after dynamic click, back, popstate, and unavailable-state rendering.
- Replaced the broad `aria-live` main region with a focused loading `role="status"`/label and unavailable `role="alert"`.
- Expanded the focused test to cover launch-parameter preservation, history arguments, route focus, loading/unavailable/accessibility markers, all four VK safe-area insets, and existence of every referenced poster and font.
- Kept deployment dependencies local and explicit: packaging or serving this app must retain sibling `concerts/images/` and `vendor/fonts/` paths. The focused test fails when any dependency is absent.

TDD evidence:

- RED: `node --test tests/vk-mini-app.test.mjs` exited 1 with 5 passing and 4 failing tests. Failures were the three missing router/focus exports and missing accessibility state markers.
- GREEN: `node --test tests/vk-mini-app.test.mjs` exited 0 with 9 passing and 0 failing tests.

## Fix Round 2

Status: DONE

Commit: `1b29f89 test: cover VK shell history transitions`

Implementation and coverage:

- Extracted `createShellController()` inside the existing `vk-mini-app/app.js` file with injected root, location, history, and event target dependencies; browser startup uses the same controller.
- Added a dependency-free behavioral shell test using a small in-memory DOM/history boundary. It starts on the catalog, clicks into `secret`, performs browser back and forward popstate transitions, and activates `Все шоу`.
- The scenario asserts after each dynamic transition that `vk_user_id`, `vk_platform`, `sign`, and the hash remain intact; the expected catalog/detail `h1` is rendered; and the current route heading is the document active element.
- Removed the old source-string-only focus/popstate wiring assertions. Static source checks remain only for loading/unavailable semantic markup.

TDD evidence:

- RED: `node --test tests/vk-mini-app.test.mjs` exited 1 with 9 passing and 1 failing test because importing `app.js` required the unavailable global `document` and no injectable shell controller existed.
- GREEN: `node --test tests/vk-mini-app.test.mjs` exited 0 with 10 passing and 0 failing tests.

## Fix Round 3

Status: DONE

Commit: `8baf7b2 test: verify VK shell in real browser`

Browser coverage:

- Replaced the synthetic shell/history scenario with a real Puppeteer test using the installed `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` executable and existing `puppeteer-core` dependency.
- The test starts an ephemeral local static server rooted at the existing project, loads `/vk-mini-app/?vk_user_id=123&vk_app_id=54751520#launch`, and clicks the actual rendered `secret` card.
- It uses native `page.goBack()` and `page.goForward()`, then clicks the actual rendered `.show-detail__back` control.
- After every transition it reads the real browser URL and DOM, asserting preserved `vk_user_id`, `vk_app_id`, and hash; the expected catalog/detail heading; and `document.activeElement === document.querySelector('h1')`.
- If no supported local executable exists, the test uses `t.skip()` with the complete searched path list. Chrome was present in this environment, so the test ran and was not skipped.
- No DOM-emulation package or production-code change was added.

TDD and execution evidence:

- RED 1: sandboxed `node --test tests/vk-mini-app.test.mjs` exited 1 because local Chrome execution was blocked before page launch.
- RED 2: the approved real-Chrome run exited 1 with HTTP 404, exposing a trailing-slash bug in the new test server's project-root containment check.
- GREEN: approved `node --test tests/vk-mini-app.test.mjs` exited 0 with 10 passing, 0 failing, and 0 skipped tests; the real browser scenario completed in about 933 ms.

## Fix Round 4

Status: DONE

Browser coverage:

- Expanded the real Chrome launch URL with `sign`, `vk_language`, `vk_platform`, `vk_is_app_user`, and `vk_are_notifications_enabled` alongside the existing VK user and app IDs.
- Asserted the complete literal map of all seven non-`show` launch parameters, plus the hash, after catalog-to-detail, browser back, browser forward, and detail-to-catalog navigation.
- Added a separate real-browser direct launch with `show=huligan`; it asserts the initially rendered `Хулиган` detail, preserved launch context, URL route, hash, and focused `h1`.
- The direct-launch assertion exposed a genuine production accessibility defect: initial detail routes rendered without moving focus to their heading. `vk-mini-app/app.js` now focuses the heading only for a valid initial direct-show route; initial catalog behavior is unchanged.

TDD and execution evidence:

- RED: approved `node --test tests/vk-mini-app.test.mjs` exited 1 with 9 passing and 1 failing test. The real Chrome assertion received `focusedHeading: false` for the initial `show=huligan` route while the correct detail and every launch parameter were present.
- GREEN: approved `node --test tests/vk-mini-app.test.mjs` exited 0 with 10 passing, 0 failing, and 0 skipped tests; the real browser scenario completed in about 558 ms.
