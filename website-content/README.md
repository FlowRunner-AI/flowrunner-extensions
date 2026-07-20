# website-content — FlowRunner integrations marketing package

Generated content package to hand to the **website/blog/content Claude Code project**. It turns the 329 FlowRunner integrations into structured data + a positioning brief so that project can build integration landing pages, category hubs, a comparison page, and a template gallery.

## Contents

```
website-content/
├── README.md                       ← this file
├── WEBSITE-WRITER-INSTRUCTIONS.md  ← START HERE: positioning + page templates + SEO playbook
├── integrations-index.json         ← catalog roll-up: totals, category counts, one row per service
├── integrations/                   ← one <slug>.json per service (rich, page-ready structured data)
│   ├── slack.json
│   ├── openai-ai.json
│   └── … (329 files)
└── generate-catalog.py             ← regenerates all of the above from the extensions repo
```

## How to use it (for the website project)

1. Read **`WEBSITE-WRITER-INSTRUCTIONS.md`** — it has the strategy (AI-agent tool library / verified / breadth-with-depth), the persona campaigns, the per-integration landing-page template, category/hub/comparison/template-gallery guidance, SEO specifics, and the voice/claims guardrails.
2. Treat the JSON as the **source of truth for facts** (actions, triggers, auth, counts). Write marketing prose on top; don't invent capabilities not in the records.
3. Copy the brand logos: each record's `iconFile` points at the real logo in the extensions repo (`services/<slug>/public/…`) — pull those into your asset pipeline.
4. Pull headline numbers **live** from `integrations-index.json` (they change as integrations are added) — don't hardcode counts.

## Snapshot (this build)

- **329 integrations · 7,382 actions · 286 triggers** (71 services with real-time/polling triggers)
- **76 OAuth services · 80 self-hostable**
- **24 categories**, every service classified (0 uncategorized)

See `integrations-index.json` for exact, current figures.

## Regenerating

Deterministic, no network, Python stdlib only. From the **extensions repo root**:

```bash
python3 website-content/generate-catalog.py
```

Re-run after adding/changing services, then re-copy `integrations-index.json` + `integrations/` into the website project. If a brand-new vendor doesn't match the taxonomy it lands in `"Other"` with `categorySource: "uncategorized"` — add its vendor keyword to `KEYWORD_CATEGORY` in the generator (or let the writer bucket it manually).

## Provenance

Data is extracted from each service's `src/index.js` JSDoc annotations (`@integrationName`, `@operationName`, `@category`, `@description`, `@registerAs`, `@requireOAuth`, `@integrationIcon`, …) and its `README.md` (description, Ideal Use Cases, Agent Ideas). Every record carries `sourcePaths` back to the originating files.
