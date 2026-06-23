# Front Inbound Attachment Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Front flows read inbound email attachments — expose a clean attachment list on the trigger/message-list, and add a Get Attachment action that downloads the file into FlowRunner Files and returns its URL.

**Architecture:** All changes are in the single service file `services/front-service/src/index.js`. Two module-level helpers (`normalizeAttachment`) and one private method (`#downloadBinary`) support a new `getAttachment` action and an attachment-normalizing pass inside the existing `onNewInboundMessage` trigger. Downloads reuse the service's existing `this.apiKey` Bearer auth; files are stored via the global `Flowrunner.Files.saveFile`.

**Tech Stack:** Node.js (FlowRunner-native service), `Flowrunner.Request`, `Flowrunner.Files`, JSDoc service annotations, ESLint (`eslint-config-backendless`).

## Global Constraints

- All changes confined to `services/front-service/` (per CLAUDE.md service-scope rule).
- This service uses the **global** `Flowrunner` runtime — there is no `this.flowrunner`. Use `Flowrunner.Files.saveFile(directory, name, buffer, true)` (returns a URL string), matching `box`/`dropbox`.
- Methods with `@paramDef` use individual positional parameters, not a destructured object.
- `Flowrunner.Request` returns the response body directly on success; for binary use `.setEncoding(null).unwrapBody(false)` so `response.body` is a Buffer and `response.headers` is available.
- Each `@paramDef` value must be valid JSON on one line.
- No unit-test harness exists (`scripts: {}`; services are tested in FlowRunner). Per-task verification = JSON/JSDoc validity by inspection + `npx eslint services/front-service --fix` clean + manual reasoning. Do **not** run repo-wide `npm run lint` (it reformats unrelated services).
- API base constant already defined: `const API_BASE_URL = 'https://api2.frontapp.com'`.

---

### Task 1: Get Attachment action (download → FlowRunner Files)

**Files:**
- Modify: `services/front-service/src/index.js` — add `#downloadBinary` private method after `#buildMessageFormData` (ends at line 124); add a new `// -------------------- Attachments --------------------` section with the `getAttachment` method after `replyToConversation` (ends at line 624), before the `// -------------------- Comments --------------------` marker (line 626).

**Interfaces:**
- Consumes: existing `this.apiKey`, module constant `API_BASE_URL`, `logger`, global `Flowrunner`.
- Produces:
  - `#downloadBinary({ url, logTag }) -> Promise<{ buffer: Buffer, contentType: string }>`
  - `getAttachment(attachment, fileName, targetDirectory) -> Promise<{ url: string }>`

- [ ] **Step 1: Add the `#downloadBinary` private helper**

Insert immediately after the closing brace of `#buildMessageFormData` (after line 124, before `// -------------------- Dictionaries --------------------`):

```js
  async #downloadBinary({ url, logTag }) {
    logger.debug(`${ logTag } - downloading binary from ${ url }`)

    const response = await Flowrunner.Request
      .get(url)
      .set({ Authorization: `Bearer ${ this.apiKey }` })
      .setEncoding(null)
      .unwrapBody(false)

    return {
      buffer: response.body,
      contentType: response.headers['content-type'] || 'application/octet-stream',
    }
  }
```

- [ ] **Step 2: Add the `getAttachment` action**

Insert after the closing brace of `replyToConversation` (after line 624), before the `// -------------------- Comments --------------------` comment:

```js
  // -------------------- Attachments --------------------

  /**
   * @operationName Get Attachment
   * @description Downloads a Front message attachment and stores it in FlowRunner Files, returning a URL to the stored file. Accepts either an attachment id (e.g. fil_123) from a message's attachments list, or the attachment's full Front download URL.
   * @category Attachments
   * @route POST /get-attachment
   * @appearanceColor #A777E3 #C39FE9
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Attachment","name":"attachment","required":true,"description":"Attachment id (e.g. fil_231iuypv) or the full Front download URL from a message's attachments list."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Optional name to store the file under. Defaults to the name in the URL or 'attachment'."}
   * @paramDef {"type":"String","label":"Target Directory","name":"targetDirectory","description":"Optional folder in FlowRunner Files. Defaults to /front-attachments."}
   *
   * @returns {Object}
   * @sampleResult {"url":"https://backendlessappcontent.com/APP-ID/REST-KEY/files/front-attachments/invoice.pdf"}
   */
  async getAttachment(attachment, fileName, targetDirectory) {
    const logTag = '[getAttachment]'

    if (!attachment) {
      throw new Error('Attachment is required')
    }

    let downloadUrl

    if (/^https?:\/\//i.test(attachment)) {
      let parsed

      try {
        parsed = new URL(attachment)
      } catch (error) {
        throw new Error('Attachment URL is not a valid URL')
      }

      const host = parsed.hostname.toLowerCase()

      if (parsed.protocol !== 'https:' || (host !== 'frontapp.com' && !host.endsWith('.frontapp.com'))) {
        throw new Error('Attachment URL must be a Front (frontapp.com) download link')
      }

      downloadUrl = parsed.href
    } else {
      downloadUrl = `${ API_BASE_URL }/download/${ encodeURIComponent(attachment) }`
    }

    const { buffer } = await this.#downloadBinary({ url: downloadUrl, logTag })

    const name = fileName || (downloadUrl.split('/').pop() || 'attachment').split('?')[0]
    const directory = targetDirectory || '/front-attachments'

    const url = await Flowrunner.Files.saveFile(directory, name, buffer, true)

    return { url }
  }
```

- [ ] **Step 3: Verify JSON/JSDoc validity**

Confirm by inspection that each `@paramDef` line is valid JSON and that `getAttachment(attachment, fileName, targetDirectory)` lists parameters individually (matching the three `@paramDef` `name` values in order). Confirm the `@route` is `POST /get-attachment` and category is `Attachments`.

- [ ] **Step 4: Lint**

Run: `npx eslint services/front-service --fix`
Expected: exits 0, no errors. (Auto-fix may adjust spacing only.)

- [ ] **Step 5: Commit**

```bash
git add services/front-service/src/index.js
git commit -m "feat(front): add Get Attachment action to download attachments into FlowRunner Files"
```

---

### Task 2: Surface attachments on the inbound trigger and message list

**Files:**
- Modify: `services/front-service/src/index.js` — add module-level `normalizeAttachment` helper after `splitCsv` (ends at line 38); use it in `onNewInboundMessage` (the `newMessages.push(...)` at line 1076); update `@sampleResult` of `onNewInboundMessage` (line 1039) and `listConversationMessages` (line 486).

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `normalizeAttachment(att) -> { id, filename, content_type, size, url, is_inline }` (module-level, available to all methods).

- [ ] **Step 1: Add the `normalizeAttachment` module-level helper**

Insert after the closing brace of `splitCsv` (after line 38), before the `/** @integrationName Front ... */` block:

```js
function normalizeAttachment(att) {
  return {
    id: att.id,
    filename: att.filename,
    content_type: att.content_type,
    size: att.size,
    url: att.url,
    is_inline: att.metadata?.is_inline ?? false,
  }
}
```

- [ ] **Step 2: Normalize attachments on emitted inbound messages**

In `onNewInboundMessage`, replace the existing push (line 1076):

```js
          newMessages.push({ ...msg, conversation_id: conv.id, senderEmail: sender?.handle || null })
```

with:

```js
          newMessages.push({
            ...msg,
            conversation_id: conv.id,
            senderEmail: sender?.handle || null,
            attachments: (msg.attachments || []).map(normalizeAttachment),
          })
```

- [ ] **Step 3: Document attachments in the `onNewInboundMessage` sample result**

Replace the `@sampleResult` line at 1039:

```js
   * @sampleResult {"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure</p>","conversation_id":"cnv_abc","senderEmail":"alice@example.com","recipients":[{"handle":"alice@example.com","role":"from"}]}
```

with (adds the `attachments` array):

```js
   * @sampleResult {"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure</p>","conversation_id":"cnv_abc","senderEmail":"alice@example.com","recipients":[{"handle":"alice@example.com","role":"from"}],"attachments":[{"id":"fil_231iuypv","filename":"invoice.pdf","content_type":"application/pdf","size":84210,"url":"https://api2.frontapp.com/download/fil_231iuypv","is_inline":false}]}
```

- [ ] **Step 4: Document attachments in the `listConversationMessages` sample result**

Replace the `@sampleResult` line at 486:

```js
   * @sampleResult {"_results":[{"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure, here's the info</p>","text":"Sure, here's the info","author":null,"recipients":[{"handle":"alice@example.com","role":"from"}]}],"_pagination":{"next":null}}
```

with (adds an `attachments` array on the message):

```js
   * @sampleResult {"_results":[{"id":"msg_zzz","type":"email","is_inbound":true,"created_at":1718210000,"subject":"Re: Invoice question","body":"<p>Sure, here's the info</p>","text":"Sure, here's the info","author":null,"recipients":[{"handle":"alice@example.com","role":"from"}],"attachments":[{"id":"fil_231iuypv","filename":"invoice.pdf","url":"https://api2.frontapp.com/download/fil_231iuypv","content_type":"application/pdf","size":84210,"metadata":{"is_inline":false}}]}],"_pagination":{"next":null}}
```

(Note: `listConversationMessages` returns the raw Front response unchanged — its message attachments keep Front's native shape with `metadata.is_inline`; only the trigger normalizes to the flat shape. The two sample results intentionally differ for this reason.)

- [ ] **Step 5: Verify JSON validity**

Confirm by inspection that both replaced `@sampleResult` values are single-line valid JSON.

- [ ] **Step 6: Lint**

Run: `npx eslint services/front-service --fix`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add services/front-service/src/index.js
git commit -m "feat(front): surface inbound message attachments on trigger and message list"
```

---

### Task 3: Update README

**Files:**
- Modify: `services/front-service/README.md`

**Interfaces:**
- Consumes: the final `services/front-service/src/index.js` from Tasks 1–2.
- Produces: documentation only.

- [ ] **Step 1: Regenerate/update the README**

Dispatch the `readme-maintainer` agent for `services/front-service` so the README reflects: the new **Get Attachment** action (params: Attachment, File Name, Target Directory; returns `{ url }`), and that **On New Inbound Message** and **List Conversation Messages** now expose an `attachments` list. If the agent is unavailable, hand-edit `README.md` to add a Get Attachment row to the methods/operations list and note the attachments field on the two read methods.

- [ ] **Step 2: Verify**

Confirm `README.md` mentions Get Attachment and the attachments field, and contains no stale/placeholder text.

- [ ] **Step 3: Commit**

```bash
git add services/front-service/README.md
git commit -m "docs(front): document Get Attachment and inbound attachments"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (normalize + document attachments on trigger and message list) → Task 2 (steps 1–4).
- Spec §2 (Get Attachment action: id-or-URL input, fileName, targetDirectory, binary download, `Flowrunner.Files.saveFile`, returns `{url}`) → Task 1.
- Spec §2 URL validation (https + `frontapp.com`/`.frontapp.com`, throw before request, bare-id path safe) → Task 1 Step 2 (the `/^https?/` branch with `new URL`, protocol and hostname checks; else-branch builds api2 URL).
- Spec §3 reuse (`#downloadBinary` helper, module-level `normalizeAttachment`) → Task 1 Step 1, Task 2 Step 1.
- Spec "Testing" (lint, manual FlowRunner verification, README via readme-maintainer) → per-task lint steps + Task 3.

**Placeholder scan:** No TBD/TODO; every code step shows full code; validation logic is concrete, not "add validation".

**Type consistency:** `#downloadBinary` returns `{ buffer, contentType }`; `getAttachment` destructures `{ buffer }` — consistent. `normalizeAttachment` returns `{id, filename, content_type, size, url, is_inline}`; the trigger maps `msg.attachments` through it and the trigger sample result matches that exact flat shape. `getAttachment` returns `{ url }` matching its `@sampleResult`.

**Note on validation:** `new URL` / `URL` are Node globals available in the FlowRunner runtime; no import needed.
