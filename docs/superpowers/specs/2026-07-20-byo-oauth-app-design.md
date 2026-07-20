# Design: Bring-Your-Own OAuth App (dual credentials) for gated services

**Date:** 2026-07-20
**Status:** Approved (design), pending implementation plan
**Author:** Mark + Claude

## Context / problem

Several OAuth services shipped in the Make-parity rollout are **gated**: their
platform requires an app review/audit before the integration works at full scope
(public posting, ads management, upload, etc.). In practice, getting a single
FlowRunner-owned OAuth app approved across all these platforms is slow and
uncertain.

Today every `@requireOAuth` service stores its `clientId`/`clientSecret` as
`shared: true` config items — i.e. **one FlowRunner-owned app**, configured once
by the platform operator, used by every customer connection. That's the best
onboarding UX (customers just click "Connect"), but it puts the entire app-review
burden on FlowRunner.

We want a **dual-credential** behavior: keep FlowRunner's shared app as the
default, but let a customer optionally supply **their own** OAuth app credentials.
When they do, the service uses theirs; otherwise it falls back to FlowRunner's.
This lets a customer who has (or can get) their own approved/dev-mode app bypass
the FlowRunner-app gate for their own account, without changing anything for
customers who are happy with the default.

## Scope

**In scope — the 11 gated OAuth services only:**

| Service | Folder | Notes on app-scoped identifiers |
| --- | --- | --- |
| Meta Ads | `meta-ads` | clientId + clientSecret — clean 2-field |
| Instagram for Business | `instagram-business` | clientId + clientSecret — clean |
| Facebook Messenger | `facebook-messenger` | clientId + clientSecret — clean |
| TikTok | `tiktok` | clientId (displayed "Client Key") + clientSecret — clean (`this.clientId` is used as `client_key`) |
| Pinterest | `pinterest` | clientId + clientSecret — clean |
| Etsy | `etsy` | clientId (keystring, also sent as `x-api-key`) + clientSecret — clean (`this.clientId` covers both uses) |
| Amazon Seller Central | `amazon-seller-central` | **3 app-scoped identifiers** — clientId + clientSecret (LWA) + `applicationId`. Needs per-service handling (see Risks). |
| RingCentral | `ringcentral` | clientId + clientSecret — clean (`environment` is separate, unaffected) |
| Canva | `canva` | clientId + clientSecret — clean (PKCE verifier is derived from both, so an override flows through automatically) |
| Vimeo | `vimeo` | clientId + clientSecret — clean |
| Trustpilot | `trustpilot` | clientId (also the public-endpoint API key) + clientSecret — clean (`this.clientId` covers both) |

**Out of scope:** the other ~65 `@requireOAuth` services (Google/Microsoft/Zoho
families, Slack, HubSpot, etc.). Same pattern can roll to them later if this
proves out in production; not needed now.

## Design

### Config items (per service)

Add two **optional** config items alongside the existing shared pair. The existing
`clientId`/`clientSecret` stay `shared: true, required: true` (FlowRunner's app,
always present as the fallback).

```js
{
  displayName: 'Custom App Client ID',
  name: 'customClientId',
  type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
  required: false,
  shared: false,
  defaultValue: '',
  hint: '<see Hints below>'
},
{
  displayName: 'Custom App Client Secret',
  name: 'customClientSecret',
  type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
  required: false,
  shared: false,
  defaultValue: '',
  hint: '<see Hints below>'
}
```

This does **not** change the house rule that `shared: true` is only for OAuth
`clientId`/`clientSecret` — the new items are `shared: false` like every other
per-connection config item.

### Detection logic (constructor)

The only code change, identical in every service:

```js
constructor(config) {
  const useCustom = config.customClientId?.trim() && config.customClientSecret?.trim()
  this.clientId     = useCustom ? config.customClientId.trim()     : config.clientId
  this.clientSecret = useCustom ? config.customClientSecret.trim() : config.clientSecret
  // ...rest unchanged
}
```

**Both-or-neither** is the load-bearing rule: a half-filled pair (customer's ID +
FlowRunner's secret) would silently break the OAuth exchange, so we only switch to
the custom app when **both** custom fields are non-empty; otherwise we fall back
entirely to FlowRunner's shared app.

Because every service already reads `this.clientId` / `this.clientSecret` in the
connection URL, callback exchange, token refresh, PKCE derivation, and all
authenticated calls, this single constructor change covers the entire lifecycle
uniformly. No other method changes.

### Hints

Each custom field's hint must convey:

1. **When to use it:** "Optional. Leave blank to use FlowRunner's built-in app.
   Provide your own app's credentials if you need scopes/permissions or rate
   limits the built-in app doesn't offer, or to run under your own reviewed app."
2. **Both required together:** "Set both Custom App Client ID and Custom App
   Client Secret, or leave both blank."
3. **Redirect URI to register:** "In your app, add this exact redirect/callback
   URL: `https://app.flowrunner.ai/api/integration/oauth/callback`"
4. **Where to create the app + scopes:** short pointer to the provider's developer
   console and a note that the app must be granted the same permissions this
   integration uses (listed in the README).

Keep each hint concise; the redirect URL and the both-or-neither rule are the
non-negotiable parts.

### README addition

Each of the 11 READMEs gets a short **"Using your own OAuth app"** subsection under
Authentication: the two optional config items, the both-or-neither rule, the exact
redirect URL to register, and the note that the customer's app must request the
same scopes. This is documentation only.

## Risks / per-service attention

- **Amazon Seller Central** is the one non-uniform case. Its app has three
  identifiers that must all come from the same app: `clientId` + `clientSecret`
  (LWA) **and** `applicationId` (the SP-API solution id, used in the consent URL).
  In the current build `applicationId` is `shared: false` while the LWA pair is
  `shared: true`, which is already an inconsistent split. For the dual pattern,
  the custom-app decision must cover all three together (a `customApplicationId`
  that participates in the same both/neither switch, and reconciling the existing
  shared/non-shared split). This service gets an individual review during the
  build rather than the mechanical edit.
- **No new "neither set" error path needed:** because the shared pair stays
  `required: true`, there is always a working fallback. (A defensive check is
  unnecessary but harmless.)
- **Live OAuth round-trip** with a real customer app can only be verified in
  FlowRunner (same as every wave); the code change itself is verified by
  `node --check`, scoped eslint, and tracing the constructor for both the
  fallback and override branches.

## Delivery

Same proven wave workflow:
1. Parallel `flowrunner-service-engineer` agents make the mechanical edit
   (2 config items + constructor fallback + hints) per service; Amazon gets
   bespoke handling.
2. `readme-maintainer` (or inline) adds the "Using your own OAuth app" note.
3. Scoped `npx eslint services/<name> --fix`.
4. One commit per service to `main`.

No catalog/gap-doc changes (this is an auth-behavior change, not a new service);
`generate-catalog.py` counts are unaffected.

## Verification

- Per service: `node --check` and scoped eslint pass.
- Trace both branches: no custom set → `this.clientId === config.clientId`
  (unchanged behavior); both custom set → `this.clientId === config.customClientId`.
- Amazon: confirm all three app identifiers switch together.
- Manual smoke test in FlowRunner: connect one service with FlowRunner's app
  (default), then reconnect with a personal app's credentials and confirm the
  OAuth round-trip + a sample call both succeed.
