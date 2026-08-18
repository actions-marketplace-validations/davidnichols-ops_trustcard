---
name: testing-trustcard-rfc
description: Verify RFC documentation and HTML mockup assets for the trustcard npm install trust check RFC.
---

# Testing trustcard RFC docs and UI mockups

Use this skill when a PR touches `docs/RFC-npm-package-install-trust-check.md` or `docs/rfc-assets/trust-check-ui-mockup.html`.

## Devin Secrets Needed

None. All checks are local.

## Environment

- Repo root: `/home/ubuntu/repos/trustcard` (or current checkout).
- Chrome for Testing is available at `google-chrome`.
- Node >=18 and `npm` are needed to run `npm test`.

## Quick checks

Render the mockup in Chrome and capture a clean screenshot:

```bash
google-chrome --no-sandbox --disable-gpu --headless \
  --window-size=1280,900 --hide-scrollbars \
  --screenshot=/tmp/trust-check-screenshot.png \
  "file:///home/ubuntu/repos/trustcard/docs/rfc-assets/trust-check-ui-mockup.html"
```

Open it in a visible Chrome window for recording:

```bash
google-chrome --no-sandbox --disable-gpu --new-window \
  "file:///home/ubuntu/repos/trustcard/docs/rfc-assets/trust-check-ui-mockup.html"
```

Then run the test suite:

```bash
cd /home/ubuntu/repos/trustcard
npm test
```

## What to verify

- The rendered page shows the `trustcard-logo.png` as the centered hero mark.
- The yellow notice explains the zero-config heuristic automation pass and mentions IP/ASN, User-Agent, and the `X-NPM-Trust-Check-Challenge` header.
- The primary button reads `Verify with passkey / Touch ID / Windows Hello`.
- The secondary fallback reads `Email a one-time link` and includes a note that the total flow is two clicks (request + verify in email).
- No element or text on the page contains the substring `CAPTCHA`.
- `npm test` exits 0 with `# fail 0`.
- `docs/RFC-npm-package-install-trust-check.md` contains sections for:
  - Heuristic automation pass
  - Hardware-bound human trust check
  - `spam_user` hard-block classification
  - Reputation fast pass
  - A standalone `## Dead CAPTCHA Rationale` section.

## Common pitfalls

- Chrome may print DBus errors in headless mode; these are harmless as long as the screenshot file is non-empty.
- The mockup references `trustcard-logo.png` with a relative path, so load it from `docs/rfc-assets/` or the logo will be broken.
- `npm test` must be run from the repo root and uses the `test/*.test.js` glob.
