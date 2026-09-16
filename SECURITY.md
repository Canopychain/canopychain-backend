# Security Policy

The Canopychain backend holds the attestor key that confirms milestones
on-chain, and serves the admin endpoints that approve and reject projects.
A vulnerability here can cause funds to be released against plots that
never grew. If you find one, please report it privately so it can be fixed
before it's disclosed publicly.

## Scope

This policy covers the indexer, the satellite-polling worker, and the API
in this repository.

Vulnerabilities in the Soroban contracts themselves belong in
[canopychain-contracts](https://github.com/Canopychain/canopychain-contracts),
and browser-side issues in
[canopychain-frontend](https://github.com/Canopychain/canopychain-frontend).
Report those against the relevant repository instead.

## Reporting a vulnerability

**Do not open a public GitHub issue for a security vulnerability.**

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Canopychain/canopychain-backend/security) of this repository.
2. Click "Report a vulnerability" to open a private advisory.
3. Describe the issue, including steps to reproduce, the affected endpoint
   or worker, and the potential impact.

If you're unable to use GitHub's private reporting for any reason, contact
a maintainer directly rather than filing a public issue.

## What to expect

- We'll acknowledge new reports as soon as we can and work with you to
  understand and confirm the issue.
- We'll aim to keep you updated as a fix is developed and let you know
  before any public disclosure.
- Please give us a reasonable amount of time to address the issue before
  disclosing it publicly.

## What qualifies

Examples of in-scope issues:

- Bypassing SEP-53 admin signature verification, or replaying a captured
  admin request, to reach an admin-only endpoint.
- Causing an attestation to be submitted for a milestone whose forest-cover
  threshold was not actually met, including by manipulating the polled
  satellite data or the stored polygon it is measured against.
- Indexer flaws that let crafted on-chain events corrupt mirrored state,
  such as misattributing a donation to the wrong donor or project.
- Exposure of the attestor secret key, database credentials, or other
  configured secrets, whether through logs, API responses, or errors.
- Unauthenticated access to data that should require an admin signature.

Out of scope: issues that only affect an already-compromised admin or
attestor key, since those roles are trusted by design, and the accuracy of
Global Forest Watch's own data, which is an upstream dependency rather than
a flaw in this service.
