# Bring-Your-Own OAuth App (dual credentials) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer optionally supply their own OAuth app credentials on the 11 gated services, falling back to FlowRunner's shared app when they don't.

**Architecture:** Add two optional `shared:false` config items (`customClientId`, `customClientSecret`) to each service and a "both-or-neither" fallback in the constructor so `this.clientId`/`this.clientSecret` resolve to the customer's app only when both custom fields are set, else FlowRunner's shared app. Because every service already reads `this.clientId`/`this.clientSecret` in the connect/callback/refresh/API/PKCE paths, this one constructor change covers the whole lifecycle. Amazon Seller Central is bespoke: three app-scoped identifiers (LWA client id, LWA secret, application id) must switch together.

**Tech Stack:** FlowRunner-native JS services (Node, zero-dep for these), `Flowrunner.ServerCode.addService`. Verification via a small Node harness (stubs the `Flowrunner`/`logger` globals, captures the service class, asserts the constructor's credential resolution) plus `node --check` and scoped eslint.

## Global Constraints

- Do NOT change the house `shared` rule: `shared:true` stays only on the platform OAuth `clientId`/`clientSecret` (and, after Task 11, Amazon's `applicationId`); the new custom items are `shared:false`.
- New custom items are `required:false`, `defaultValue:''`, `type` STRING.
- Registered redirect/callback URL customers must whitelist in their own app: `https://app.flowrunner.ai/api/integration/oauth/callback` (verbatim, in every custom-field hint and README note).
- Scopes stay baked into each service — do NOT add scope-override config. The custom hint/README tells the customer their app must be granted the same permissions (already listed in the README).
- Config-item display labels: **"Your Own App Client ID"** / **"Your Own App Client Secret"**; internal `name`s: `customClientId` / `customClientSecret`.
- Per house rules: no `order` property on config items; `constructor(config)` only; `node --check` and `npx eslint services/<name> --fix` must pass before commit.
- One commit per service directly to `main` (Mark's workflow). No catalog/gap-doc changes — this is auth behavior, not a new service; `generate-catalog.py` is unaffected.
- README note is documentation only (no test); it is part of each service's task and its commit.

---

## Shared Edit Recipe (referenced by Tasks 1–10)

Every clean-service task applies these three edits. The code here is identical across all ten; only the per-service **Create-App hint sentence** (given in each task) differs.

**Edit A — add two config items.** In the `Flowrunner.ServerCode.addService(<Class>, [ ... ])` array, immediately AFTER the existing `clientSecret` item object, insert:

```js
  {
    displayName: 'Your Own App Client ID',
    defaultValue: '',
    name: 'customClientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Leave blank to use FlowRunner\'s built-in app. To run under your own OAuth app, <CREATE_APP_HINT> and paste its Client ID here. You must set BOTH this and Your Own App Client Secret (or leave both blank), and add this exact redirect URL to your app: https://app.flowrunner.ai/api/integration/oauth/callback',
  },
  {
    displayName: 'Your Own App Client Secret',
    defaultValue: '',
    name: 'customClientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. The Client Secret of your own OAuth app (see Your Own App Client ID). Your app must be granted the same permissions this integration uses, listed in the README. Leave blank to use FlowRunner\'s built-in app.',
  },
```

Replace `<CREATE_APP_HINT>` with the task's Create-App sentence.

**Edit B — constructor fallback.** Replace exactly these two lines:

```js
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
```

with:

```js
    const useCustomApp = Boolean(config.customClientId && config.customClientId.trim() && config.customClientSecret && config.customClientSecret.trim())

    this.clientId = useCustomApp ? config.customClientId.trim() : config.clientId
    this.clientSecret = useCustomApp ? config.customClientSecret.trim() : config.clientSecret
```

(Any other constructor lines — e.g. RingCentral's host derivation, TikTok's `this.scopes` — stay exactly as they are, below the replaced lines.)

**Edit C — README note.** Under the README's Authentication section, add:

```markdown
### Using your own OAuth app (optional)

By default this integration uses FlowRunner's built-in OAuth app — just click Connect. If you need scopes, rate limits, or an app review that the built-in app doesn't provide, you can supply your own:

1. <CREATE_APP_SENTENCE_FOR_README>
2. Add this exact redirect/callback URL to your app: `https://app.flowrunner.ai/api/integration/oauth/callback`
3. Grant your app the same permissions this integration uses (the scopes listed above).
4. Paste your app's Client ID and Client Secret into **Your Own App Client ID** and **Your Own App Client Secret**. Set both, or leave both blank to use the built-in app.
```

---

### Task 0: Verification harness

**Files:**
- Create: `docs/superpowers/verify-byo-credentials.js`

**Interfaces:**
- Produces: a CLI `node docs/superpowers/verify-byo-credentials.js <service-index-path> [triple]` that exits 0 and prints `PASS <path>` when the service's constructor resolves credentials correctly, non-zero with an assertion message otherwise. Tasks 1–10 run it in default mode; Task 11 runs it in `triple` mode.

- [ ] **Step 1: Create the harness**

```js
// Verifies the bring-your-own-OAuth-app "both-or-neither" fallback in a service
// constructor without needing the FlowRunner runtime. Stubs the Flowrunner/logger
// globals, captures the service class via addService, and asserts credential
// resolution across the fallback/override/half-filled cases.
//
// Usage:
//   node docs/superpowers/verify-byo-credentials.js services/etsy/src/index.js
//   node docs/superpowers/verify-byo-credentials.js services/amazon-seller-central/src/index.js triple
const path = require('path')
const assert = require('assert')

const target = process.argv[2]
const triple = process.argv[3] === 'triple'
if (!target) {
  console.error('usage: node verify-byo-credentials.js <service index.js path> [triple]')
  process.exit(2)
}

function deepProxy() {
  const fn = function () { return deepProxy() }
  return new Proxy(fn, {
    get: (_t, prop) => (prop === 'TYPES' ? new Proxy({}, { get: (_o, p) => String(p) }) : deepProxy()),
    apply: () => deepProxy(),
  })
}

let CapturedClass = null
global.logger = { debug() {}, info() {}, warn() {}, error() {} }
global.Flowrunner = new Proxy({}, {
  get(_t, prop) {
    if (prop === 'ServerCode') {
      return {
        ConfigItems: { TYPES: new Proxy({}, { get: (_o, p) => String(p) }) },
        addService: (cls) => { CapturedClass = cls },
      }
    }
    return deepProxy()
  },
})

require(path.resolve(target))
assert(CapturedClass, `${ target } did not call Flowrunner.ServerCode.addService`)

const build = (extra) => new CapturedClass(Object.assign(
  { clientId: 'FR_ID', clientSecret: 'FR_SECRET', applicationId: 'FR_APP', region: 'North America', environment: 'Production' },
  extra,
))

// Case A: no custom credentials -> FlowRunner's shared app
let s = build({})
assert.strictEqual(s.clientId, 'FR_ID', 'A: clientId must fall back to shared')
assert.strictEqual(s.clientSecret, 'FR_SECRET', 'A: clientSecret must fall back to shared')
if (triple) assert.strictEqual(s.applicationId, 'FR_APP', 'A: applicationId must fall back to shared')

// Case B: full custom set -> customer's app
const full = triple
  ? { customClientId: 'C_ID', customClientSecret: 'C_SECRET', customApplicationId: 'C_APP' }
  : { customClientId: 'C_ID', customClientSecret: 'C_SECRET' }
s = build(full)
assert.strictEqual(s.clientId, 'C_ID', 'B: clientId must use custom')
assert.strictEqual(s.clientSecret, 'C_SECRET', 'B: clientSecret must use custom')
if (triple) assert.strictEqual(s.applicationId, 'C_APP', 'B: applicationId must use custom')

// Case C: partial custom (missing one) -> both/all-or-neither falls back to shared
const partial = triple
  ? { customClientId: 'C_ID', customClientSecret: 'C_SECRET' } // missing customApplicationId
  : { customClientId: 'C_ID' } // missing customClientSecret
s = build(partial)
assert.strictEqual(s.clientId, 'FR_ID', 'C: partial custom must fall back to shared (clientId)')
assert.strictEqual(s.clientSecret, 'FR_SECRET', 'C: partial custom must fall back to shared (clientSecret)')
if (triple) assert.strictEqual(s.applicationId, 'FR_APP', 'C: partial custom must fall back to shared (applicationId)')

// Case D: the other half-filled variant -> falls back to shared
s = build({ customClientSecret: 'C_SECRET' })
assert.strictEqual(s.clientId, 'FR_ID', 'D: half-filled (secret only) must fall back to shared')
assert.strictEqual(s.clientSecret, 'FR_SECRET', 'D: half-filled (secret only) must fall back to shared')

console.log('PASS', target)
```

- [ ] **Step 2: Sanity-check the harness runs (against an unmodified service it should FAIL case B)**

Run: `node docs/superpowers/verify-byo-credentials.js services/etsy/src/index.js`
Expected: non-zero exit, `AssertionError` on `B: clientId must use custom` (Etsy has no custom handling yet — this confirms the harness detects the missing behavior).

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/verify-byo-credentials.js
git commit -m "Add BYO-OAuth-app credential verification harness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 1: Etsy

**Files:**
- Modify: `services/etsy/src/index.js` (constructor + `addService` config array)
- Modify: `services/etsy/README.md`

**Create-App hint** (`<CREATE_APP_HINT>` in Edit A): `create an app at https://www.etsy.com/developers/your-apps (its keystring is the Client ID)`
**Create-App sentence** (`<CREATE_APP_SENTENCE_FOR_README>` in Edit C): `Create an app in the [Etsy developer console](https://www.etsy.com/developers/your-apps) — the app's "keystring" is the Client ID.`

- [ ] **Step 1: Run the harness — expect FAIL (RED)**

Run: `node docs/superpowers/verify-byo-credentials.js services/etsy/src/index.js`
Expected: FAIL, `AssertionError: B: clientId must use custom`.

- [ ] **Step 2: Apply Edit A** (add the two config items after the `clientSecret` item, with the Etsy Create-App hint).

- [ ] **Step 3: Apply Edit B** (constructor both-or-neither fallback).

- [ ] **Step 4: Run the harness — expect PASS (GREEN)**

Run: `node docs/superpowers/verify-byo-credentials.js services/etsy/src/index.js`
Expected: `PASS services/etsy/src/index.js`.

- [ ] **Step 5: Syntax + lint**

Run: `node --check services/etsy/src/index.js && npx eslint services/etsy --fix`
Expected: exit 0 (eslint may print the React-version warning; that is expected and harmless).

- [ ] **Step 6: Apply Edit C** (README "Using your own OAuth app" note with the Etsy Create-App sentence).

- [ ] **Step 7: Commit**

```bash
git add services/etsy
git commit -m "Add bring-your-own OAuth app credentials to etsy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Meta Ads

**Files:** Modify `services/meta-ads/src/index.js`, `services/meta-ads/README.md`
**Create-App hint:** `create a Meta app at https://developers.facebook.com/apps`
**Create-App sentence (README):** `Create an app in the [Meta developer console](https://developers.facebook.com/apps) with the Marketing API product added.`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/meta-ads/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Meta Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — same command → `PASS services/meta-ads/src/index.js`.
- [ ] **Step 5:** `node --check services/meta-ads/src/index.js && npx eslint services/meta-ads --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Meta README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/meta-ads
git commit -m "Add bring-your-own OAuth app credentials to meta-ads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Instagram for Business

**Files:** Modify `services/instagram-business/src/index.js`, `services/instagram-business/README.md`
**Create-App hint:** `create a Meta app at https://developers.facebook.com/apps`
**Create-App sentence (README):** `Create an app in the [Meta developer console](https://developers.facebook.com/apps) with Instagram Graph API access; the account must be a Business/Creator account linked to a Facebook Page.`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/instagram-business/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Meta Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/instagram-business/src/index.js`.
- [ ] **Step 5:** `node --check services/instagram-business/src/index.js && npx eslint services/instagram-business --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Instagram README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/instagram-business
git commit -m "Add bring-your-own OAuth app credentials to instagram-business

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Facebook Messenger

**Files:** Modify `services/facebook-messenger/src/index.js`, `services/facebook-messenger/README.md`
**Create-App hint:** `create a Meta app at https://developers.facebook.com/apps`
**Create-App sentence (README):** `Create an app in the [Meta developer console](https://developers.facebook.com/apps) with the Messenger product added and your Page connected.`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/facebook-messenger/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Meta Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/facebook-messenger/src/index.js`.
- [ ] **Step 5:** `node --check services/facebook-messenger/src/index.js && npx eslint services/facebook-messenger --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Messenger README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/facebook-messenger
git commit -m "Add bring-your-own OAuth app credentials to facebook-messenger

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: TikTok

**Files:** Modify `services/tiktok/src/index.js`, `services/tiktok/README.md`
**Create-App hint:** `create an app at https://developers.tiktok.com (its "Client Key" is the Client ID)`
**Create-App sentence (README):** `Create an app in the [TikTok developer portal](https://developers.tiktok.com) — the app's "Client Key" is the Client ID.`
**Note:** TikTok's constructor has an extra `this.scopes = DEFAULT_SCOPE_STRING` line below the two credential lines — leave it in place; Edit B only replaces the two credential lines.

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/tiktok/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (TikTok Create-App hint).
- [ ] **Step 3:** Apply Edit B (preserve the `this.scopes` line below).
- [ ] **Step 4: GREEN** — `PASS services/tiktok/src/index.js`.
- [ ] **Step 5:** `node --check services/tiktok/src/index.js && npx eslint services/tiktok --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (TikTok README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/tiktok
git commit -m "Add bring-your-own OAuth app credentials to tiktok

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Pinterest

**Files:** Modify `services/pinterest/src/index.js`, `services/pinterest/README.md`
**Create-App hint:** `create an app at https://developers.pinterest.com/apps`
**Create-App sentence (README):** `Create an app in the [Pinterest developer console](https://developers.pinterest.com/apps).`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/pinterest/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Pinterest Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/pinterest/src/index.js`.
- [ ] **Step 5:** `node --check services/pinterest/src/index.js && npx eslint services/pinterest --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Pinterest README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/pinterest
git commit -m "Add bring-your-own OAuth app credentials to pinterest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: RingCentral

**Files:** Modify `services/ringcentral/src/index.js`, `services/ringcentral/README.md`
**Create-App hint:** `create an app at https://developers.ringcentral.com`
**Create-App sentence (README):** `Create an app in the [RingCentral developer console](https://developers.ringcentral.com) with the Auth Code (3-legged) flow enabled.`
**Note:** RingCentral's constructor has extra host-derivation lines (`this.platformHost = ...`, `this.apiBase = ...`, `this.teamMessagingBase = ...`) below the two credential lines — leave them in place; Edit B only replaces the two credential lines.

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/ringcentral/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (RingCentral Create-App hint).
- [ ] **Step 3:** Apply Edit B (preserve the host-derivation lines below).
- [ ] **Step 4: GREEN** — `PASS services/ringcentral/src/index.js`.
- [ ] **Step 5:** `node --check services/ringcentral/src/index.js && npx eslint services/ringcentral --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (RingCentral README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/ringcentral
git commit -m "Add bring-your-own OAuth app credentials to ringcentral

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Canva

**Files:** Modify `services/canva/src/index.js`, `services/canva/README.md`
**Create-App hint:** `create an integration at https://www.canva.com/developers/`
**Create-App sentence (README):** `Create an integration in the [Canva developer portal](https://www.canva.com/developers/) (Connect API).`
**Note:** Canva derives its PKCE verifier from `this.clientSecret` + `this.clientId` inside `getOAuth2ConnectionURL`/`executeCallback`; because Edit B reassigns those, the custom app's PKCE flows through automatically — no other change needed.

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/canva/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Canva Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/canva/src/index.js`.
- [ ] **Step 5:** `node --check services/canva/src/index.js && npx eslint services/canva --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Canva README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/canva
git commit -m "Add bring-your-own OAuth app credentials to canva

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Vimeo

**Files:** Modify `services/vimeo/src/index.js`, `services/vimeo/README.md`
**Create-App hint:** `create an app at https://developer.vimeo.com/apps`
**Create-App sentence (README):** `Create an app in the [Vimeo developer console](https://developer.vimeo.com/apps) (upload capability still requires Vimeo's separate upload-access grant).`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/vimeo/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Vimeo Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/vimeo/src/index.js`.
- [ ] **Step 5:** `node --check services/vimeo/src/index.js && npx eslint services/vimeo --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Vimeo README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/vimeo
git commit -m "Add bring-your-own OAuth app credentials to vimeo

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Trustpilot

**Files:** Modify `services/trustpilot/src/index.js`, `services/trustpilot/README.md`
**Create-App hint:** `register an app at https://developers.trustpilot.com (Business account with API access required)`
**Create-App sentence (README):** `Register an app in the [Trustpilot developer portal](https://developers.trustpilot.com) (requires a Business account with API access). Note the same Client ID is also used as the API key for public endpoints.`

- [ ] **Step 1: RED** — `node docs/superpowers/verify-byo-credentials.js services/trustpilot/src/index.js` → FAIL `B: clientId must use custom`.
- [ ] **Step 2:** Apply Edit A (Trustpilot Create-App hint).
- [ ] **Step 3:** Apply Edit B.
- [ ] **Step 4: GREEN** — `PASS services/trustpilot/src/index.js`.
- [ ] **Step 5:** `node --check services/trustpilot/src/index.js && npx eslint services/trustpilot --fix` → exit 0.
- [ ] **Step 6:** Apply Edit C (Trustpilot README sentence).
- [ ] **Step 7: Commit**

```bash
git add services/trustpilot
git commit -m "Add bring-your-own OAuth app credentials to trustpilot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Amazon Seller Central (bespoke — three identifiers)

Amazon's app has three identifiers that must come from the same app: `clientId` + `clientSecret` (LWA) + `applicationId` (SP-API solution id, used in the consent URL). The current build inconsistently marks `applicationId` as `shared:false` while the LWA pair is `shared:true`. This task reconciles them (all three shared for FlowRunner's app) and adds an all-three-or-none custom override. `region` and `draftApp` are genuinely per-connection and are NOT touched.

**Files:** Modify `services/amazon-seller-central/src/index.js`, `services/amazon-seller-central/README.md`

- [ ] **Step 1: RED** — run the triple-mode harness.

Run: `node docs/superpowers/verify-byo-credentials.js services/amazon-seller-central/src/index.js triple`
Expected: FAIL, `AssertionError: B: clientId must use custom`.

- [ ] **Step 2: Flip `applicationId` to shared.** In the `addService` array, change the existing `applicationId` config item's `shared: false` to `shared: true` (it is part of FlowRunner's app credentials, alongside the LWA pair). Update its hint to end with: `Provided by FlowRunner's built-in app; override with Your Own App fields below.`

- [ ] **Step 3: Add three custom config items** immediately AFTER the existing `applicationId` item:

```js
  {
    displayName: 'Your Own App Client ID',
    defaultValue: '',
    name: 'customClientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. Leave blank to use FlowRunner\'s built-in app. To run under your own SP-API app, register one in the Seller Central Developer Console and paste its LWA Client ID here. Set all three Your Own App fields together (or leave all blank), and add this redirect URL to your app: https://app.flowrunner.ai/api/integration/oauth/callback',
  },
  {
    displayName: 'Your Own App Client Secret',
    defaultValue: '',
    name: 'customClientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. The LWA Client Secret of your own SP-API app (see Your Own App Client ID). Set all three Your Own App fields together or leave all blank.',
  },
  {
    displayName: 'Your Own App Application ID',
    defaultValue: '',
    name: 'customApplicationId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Optional. The SP-API application id of your own app (format amzn1.sp.solution....). Required when using your own app. Set all three Your Own App fields together or leave all blank.',
  },
```

- [ ] **Step 4: Constructor — all-three-or-none fallback.** Replace exactly:

```js
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.applicationId = config.applicationId
```

with:

```js
    const useCustomApp = Boolean(
      config.customClientId && config.customClientId.trim() &&
      config.customClientSecret && config.customClientSecret.trim() &&
      config.customApplicationId && config.customApplicationId.trim(),
    )

    this.clientId = useCustomApp ? config.customClientId.trim() : config.clientId
    this.clientSecret = useCustomApp ? config.customClientSecret.trim() : config.clientSecret
    this.applicationId = useCustomApp ? config.customApplicationId.trim() : config.applicationId
```

(The `this.region` and `this.draftApp` lines below stay unchanged.)

- [ ] **Step 5: GREEN** — run the triple-mode harness.

Run: `node docs/superpowers/verify-byo-credentials.js services/amazon-seller-central/src/index.js triple`
Expected: `PASS services/amazon-seller-central/src/index.js`. (Confirms: no custom → all three shared; all three custom → all three custom; two-of-three custom → falls back to shared.)

- [ ] **Step 6: Syntax + lint**

Run: `node --check services/amazon-seller-central/src/index.js && npx eslint services/amazon-seller-central --fix`
Expected: exit 0.

- [ ] **Step 7: README note.** Add under Authentication:

```markdown
### Using your own OAuth app (optional)

By default this integration uses FlowRunner's built-in SP-API app — just click Connect. To run under your own SP-API app (e.g. for your own developer registration or scopes):

1. Register an app in the Seller Central Developer Console (Apps & Services -> Develop Apps). It provides an LWA Client ID, an LWA Client Secret, and an Application ID (`amzn1.sp.solution....`) — all three belong to that one app.
2. Add this exact redirect/callback URL to your app: `https://app.flowrunner.ai/api/integration/oauth/callback`
3. Paste all three into **Your Own App Client ID**, **Your Own App Client Secret**, and **Your Own App Application ID**. Set all three together, or leave all blank to use the built-in app.
```

- [ ] **Step 8: Commit**

```bash
git add services/amazon-seller-central
git commit -m "Add bring-your-own OAuth app credentials to amazon-seller-central (3 identifiers)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** ✅ Two optional `shared:false` config items (Edit A / Tasks 1–11). ✅ Both-or-neither constructor fallback (Edit B; all-three for Amazon Task 11). ✅ Hints carry when-to-use + both-required + callback URL + create-app pointer (Edit A per-task hints). ✅ README "Using your own OAuth app" note (Edit C / each task). ✅ Amazon three-identifier reconciliation incl. `applicationId` shared flip (Task 11). ✅ No catalog/gap-doc change (Global Constraints). ✅ Verification harness covers fallback + override + half-filled (Task 0). Every spec section maps to a task.

**Placeholder scan:** The only bracketed tokens are `<CREATE_APP_HINT>` / `<CREATE_APP_SENTENCE_FOR_README>` in the Shared Edit Recipe, and each Task 1–10 supplies the exact replacement text — not TODOs. No "TBD", no "add error handling", no undefined references.

**Type/name consistency:** Config `name`s `customClientId` / `customClientSecret` (+ `customApplicationId` for Amazon) are identical in Edit A, Edit B, the harness, and Task 11. The constructor flag `useCustomApp` and the `this.clientId`/`this.clientSecret`/`this.applicationId` targets match the harness's asserted properties. Harness modes (`default` vs `triple`) match Tasks 1–10 vs Task 11.
