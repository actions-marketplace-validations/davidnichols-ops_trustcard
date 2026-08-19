---
name: testing-trustcard-rfc
description: Verify RFC documentation and HTML mockup assets for the trustcard npm install trust check RFC.
---

# Testing trustcard RFC docs and UI mockups

Use this skill when a PR touches the npm install trust-check RFC or its mockup assets.

Current locations (PR #9 onward):
- RFC: `npm/rfc/0000-package-install-trust-check.md`
- Mockup: `npm/rfc/assets/trust-check-ui-mockup.html`
- Logo: `npm/rfc/assets/trustcard-logo.png`
- Screenshot asset: `npm/rfc/assets/trust-check-ui-mockup.png`

Legacy locations (older PRs may still use):
- `docs/RFC-npm-package-install-attestation.md` / `docs/rfc-assets/attestation-ui-mockup.html`
- `docs/RFC-npm-package-install-trust-check.md` / `docs/rfc-assets/trust-check-ui-mockup.html`

## Devin Secrets Needed

None. All checks are local.

## Environment

- Repo root: `/home/ubuntu/repos/trustcard` (or current checkout).
- Chrome for Testing is available at `google-chrome`.
- Node >=18 and `npm` are needed to run `npm test`.

## Quick checks

Render the mockup in Chrome and capture a clean screenshot (replace the path with the PR's mockup location):

```bash
google-chrome --no-sandbox --disable-gpu --headless \
  --window-size=1280,900 --hide-scrollbars \
  --screenshot=/tmp/trust-check-screenshot.png \
  "file:///home/ubuntu/repos/trustcard/npm/rfc/assets/trust-check-ui-mockup.html"
```

Open it in a visible Chrome window for recording:

```bash
google-chrome --no-sandbox --disable-gpu --new-window \
  "file:///home/ubuntu/repos/trustcard/npm/rfc/assets/trust-check-ui-mockup.html"
```

Then run the test suite:

```bash
cd /home/ubuntu/repos/trustcard
npm test
```

## What to verify

- The rendered page shows `trustcard-logo.png` as the centered hero mark.
- The yellow notice explains the zero-config heuristic automation pass and mentions IP/ASN, User-Agent, and the `X-NPM-Trust-Check-Challenge` header.
- The primary button reads `Verify with passkey / Touch ID / Windows Hello`.
- The secondary fallback reads `Email a one-time link` and includes a note that the total flow is two clicks (request + verify in email).
- No element or text on the page contains the substring `CAPTCHA`.
- `npm test` exits 0 with `# fail 0`.
- The RFC markdown contains sections for:
  - Heuristic automation pass
  - Hardware-bound human trust check
  - `blocked` / `spam_user` classification (the RFC may use `blocked` or `spam_user`; check the PR's term)
  - Reputation fast pass
  - Dead-CAPTCHA rationale (this may be a standalone `## Dead CAPTCHA Rationale` section or a subsection such as `### Why visual and cognitive CAPTCHA is not acceptable here`)
- CAPTCHA is explicitly deprecated and not recommended as a primary or fallback mechanism.

## Common pitfalls

- Chrome may print DBus errors in headless mode; these are harmless as long as the screenshot file is non-empty.
- The mockup references `trustcard-logo.png` with a relative path, so load it from the same directory or the logo will be broken.
- `npm test` must be run from the repo root and uses the `test/*.test.js` glob; bare `node --test` can hang on fixture servers.
- Two similar RFCs exist (`attestation` and `trust-check`). Read the PR diff to confirm which file is being added or modified.
