---
title: Package-level install attestation for automated and human consumers
number: null
status: proposed
created: null
accepted_at: null
implemented_at: null
withdrawn_at: null
implementation: null
---

# Package-level install attestation for automated and human consumers

## Summary

This RFC proposes an **opt-in, registry-side** mechanism that lets package
publishers request a lightweight "human-or-automation" signal before a tarball
is served. The registry's package endpoint behaves as a per-package policy
proxy: it recognizes legitimate automation through an explicit token type, logs
the request, and serves the tarball immediately; it directs human-driven
installs through a one-time browser attestation. The design preserves the
non-interactive install path for CI, does not run any code on the consumer's
machine, and only affects packages that explicitly opt in.

## Motivation

1. **Download noise.** npm's public download counts are inflated by mirrors,
   scrapers, malware sandboxes, and misconfigured CI loops. Publishers cannot
   tell whether a spike represents real users, automated abuse, or
   infrastructure traffic.
2. **Trust-sensitive packages.** Packages such as security tooling, MCP
   servers, or certificate/identity libraries may want a "human in the loop"
   signal for first-time installs without breaking CI that pulls an exact
   version on every run.
3. **Existing tools are inadequate.**
   - Global rate limits punish everyone and do not let a publisher distinguish
     abuse for their specific package.
   - `postinstall` scripts cannot reliably detect a terminal, are disabled with
     `--ignore-scripts`, and cannot safely gate access to the tarball.
   - Client-side wrappers (`npx <pkg>-install`) are trivially bypassed.
4. **A registry-side gate is the right place.** The registry already serves the
   tarball. Adding an optional, policy-driven check there is enforceable,
   transparent, and does not require changes to the package contents or to
   unrelated packages.

## Detailed Explanation

### 1. Package policy

A new optional package-level setting controls the gate. It can live in the
registry package document and be set from `package.json` at publish time:

```jsonc
{
  "publishConfig": {
    "attestation": "require"   // or "audit" or "none" (default)
  }
}
```

Allowed values:

- `"none"` (default): the existing install flow is unchanged.
- `"audit"`: the registry records an `install-attestation` event for every
  tarball fetch but does not block the install.
- `"require"`: the registry requires a valid attestation token before serving
  the tarball.

### 2. Token kinds

Granular access tokens gain an explicit `kind` field:

- `"personal"` (default): bound to a user, may be used interactively.
- `"automation"`: intended for CI/CD. Created with
  `npm token create --kind=automation --packages <pkg>`. The token is
  read-only and scoped to a package or set of packages.
- `"service"`: intended for mirrors and indexers. Rate-limited separately and
  may be required to identify themselves in a registry API.

Automation tokens are not interactive. They are logged, rate-limited, and
allowed to pass through the gate for packages in their scope without a human
attestation.

### 3. Install flow (`attestation: "require"`)

```text
Client GET /:pkg/-/:pkg-:version.tgz
       Authorization: Bearer <token>  (optional)

Registry:
  if token.kind == "automation" and package in token.packages:
       emit install-attestation event
       return tarball (fast path, no interruption)

  if token.kind == "personal" or no auth:
       return 428 Precondition Required
              + { error: "ATTESTATION_REQUIRED",
                  attestation_url: "https://www.npmjs.com/attest/install?..." }

CLI (npm >= version that advertises attestation support):
  if terminal has a browser:
       open attestation_url
  else:
       print URL and wait for user

  User completes lightweight proof-of-humanity
  (passkey press, OAuth re-auth, or challenge).

  Registry returns a short-lived, opaque install-attestation token
  bound to the package scope.

  CLI retries tarball request with header:
       Authorization: Attestation <token>
  Registry validates token and returns tarball.
```

The attestation token is cached locally by the CLI (for example in
`~/.npm/_attestations`) with a TTL and is reused for the same package scope
within the session.

For headless or SSH environments the user can run:

```bash
npm attest --package <name>
```

ahead of time to obtain a token, then set it via environment variable or config.

### 4. Compatibility with old clients

The registry gates installs **only** when the client advertises support via an
`npm-attestation: 1` request header or a new CLI user-agent version. Clients that
do not advertise support continue to receive the tarball or, if the publisher
has enabled `attestation: "require"`, receive a `429 Too Many Requests` with a
helpful message rather than a blocking `428`. This keeps the feature opt-in and
prevents breaking existing tooling.

### 5. Rate limits and logging

- Automation tokens receive a distinct, higher per-token rate limit.
- Service/mirror tokens receive a lower per-token rate limit and may be
  required to register.
- Unauthenticated requests for `"require"` packages count against the anonymous
  rate limit; passing attestation exempts the request from that limit.
- Each tarball fetch emits a standardized `install-attestation` event:

```json
{
  "package": "mcp-trustcard",
  "version": "3.0.3",
  "timestamp": "2026-08-18T00:00:00Z",
  "tokenKind": "automation",
  "attestationIdHash": "sha256:...",
  "userAgent": "npm/12.0.0",
  "ipHash": "sha256:..."
}
```

No raw IP or token value is retained.

### 6. Privacy and security

- Attestation tokens are opaque, signed, short-lived (e.g. one hour), and
  package-scope-bound.
- The attestation page reuses the existing npm account session where possible.
- The feature must not collect new PII beyond what npm already holds for
  accounts.
- Proof-of-humanity options should be privacy-preserving; passkey/WebAuthn is
  preferred, OAuth re-auth is acceptable, and a conventional CAPTCHA is a
  fallback for accessibility.

### 7. Abuse prevention

To prevent typosquatters or malicious packages from using `"require"` to force
ads or harvest behavior:

- `"require"` may only be enabled for packages with provenance or that have
  existed for a minimum period (e.g. 30 days).
- A publisher cannot switch from `"none"` to `"require"` without a version bump
  and a deprecation notice.
- Scoped packages and organizations may enable it immediately; unscoped public
  packages must meet the maturity requirement.

## Rationale and Alternatives

1. **Do nothing / rely on global rate limits.** Global limits do not give
   publishers visibility into whether traffic is human or automated, and they
   cannot apply a per-package policy.
2. **Package `postinstall` challenge.** Rejected: lifecycle scripts can be
   disabled with `--ignore-scripts`, cannot reliably detect a terminal, and are
   a poor security boundary. They also create hostile UX and cannot stop the
   tarball from being downloaded.
3. **Client-side wrapper (`npx <pkg>-install`).** Rejected: trivially bypassed
   and does not protect the registry or the publisher's metrics.
4. **Mandatory attestation for all public packages.** Rejected: would be
   catastrophically disruptive and harm npm adoption. The feature must be
   publisher-opt-in.

The chosen design is a registry-side, per-package gate. It is enforceable,
preserves CI workflows, gives humans a single one-time prompt, and keeps the
default install experience unchanged.

## Implementation

### Registry

- Add `attestation` to the package document schema in the registry database.
- Update the tarball endpoint to classify the request and emit
  `install-attestation` events.
- Implement `428 Precondition Required` and the attestation issuance service.
- Add token-kind enforcement to granular access tokens.

### CLI

- Add support for `428 ATTESTATION_REQUIRED` in `npm install`.
- Add `npm attest --package <name>` for headless environments.
- Cache attestation tokens locally.
- Add `npm token create --kind=automation|--kind=service`.

### Web

- Build the `/attest/install` endpoint.
- Integrate with existing npm account/auth.
- Support passkey, OAuth, and CAPTCHA flows.

### Documentation

- Update registry API documentation, access-token docs, and the acceptable-use
  policy to describe the new behavior and rate-limit classes.

## Prior Art

- **Docker Hub** unauthenticated pull limits and authenticated rate tiers.
- **PyPI** project file-size and bandwidth limits.
- **GitHub Packages** scoped tokens and OIDC trusted publishing.
- **npm provenance / Sigstore** (publish-time attestation): this RFC is
  complementary — provenance says *where* a package was built; install
  attestation says *who* requested the install.
- **Cloudflare** "Under Attack" mode and challenge pages for web endpoints.

## Unresolved Questions and Bikeshedding

1. Which proof-of-humanity mechanism should be the default? Passkey is most
   privacy-preserving but has low adoption; CAPTCHA is accessible but more
   intrusive; OAuth re-auth is simplest but requires an npm account.
2. Should the attestation token be scoped per-version, per-package, or
   per-scope? Per-package is likely the right balance.
3. How long should attestation tokens live? One hour is proposed, but CI
   containers that install many packages may need a longer session.
4. Should old npm clients be served tarballs for `"require"` packages at all,
   or should they always get a `429` with a manual URL? Keeping them served
   avoids breaking legacy workflows but weakens the gate.
5. Should `install-attestation` events be published to a public transparency
   log? Doing so would help audit abuse but raises storage/privacy questions.
6. Should the gate apply to package metadata (`GET /:pkg`) or only to tarball
   fetches? Applying only to tarballs limits impact but may be bypassed by
   mirrors that already have the metadata.
7. What is the path for CI providers that cannot create granular tokens, such
   as public forks without repository secrets? A possible answer: public
   package installs from unauthenticated sources default to `"audit"` and never
   `"require"` unless the publisher additionally opts into blocking anonymous
   traffic.
