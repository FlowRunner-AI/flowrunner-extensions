# FlowRunner Competitive Claims — Verified Library (vs Make.com and n8n)

**Audience:** the website/marketing writer project (E-E-A-T contract: publish only verified, sourced claims) and the investor-deck author. Same fact base serves both; Section G is the investor digest.

**Contract:** every claim below carries a status, the evidence artifact, the method behind it, and usage guidance. Publish the claim wording as-is or rewrite it, but do not strengthen it beyond its stated scope. Anything in Section F must not be claimed at all.

**As-of date: 2026-07-17.** Catalog numbers move as waves ship — always re-pull live totals from `integrations-index.json` before publishing, and re-stamp the as-of date. Competitor numbers are point-in-time snapshots (dates given per claim).

---

## Provenance & method (cite this on comparison pages)

- **FlowRunner numbers** are generated deterministically from the extensions repo (`generate-catalog.py` reads each service's code and JSDoc; no hand counts).
- **n8n comparison** (2026-07-13): enumerated n8n's open-source repository (`packages/nodes-base/nodes` + `packages/@n8n/nodes-langchain`), app integrations only (core/utility nodes excluded), mapped item-by-item against `services/`. Artifact: `docs/n8n-gap-analysis.md` (246 tracked items, checkbox state = build status).
- **Make comparison** (2026-07-17): enumerated Make's own public integrations sitemap (3,092 app listings; 2026-01-15 snapshot cross-checked against the live site in July 2026), classified every listing (first-party vs community-built vs platform built-in; alive vs dead; mainstream vs long-tail), then adversarially re-verified every "major gap" nomination in a second review pass. Artifacts: `docs/make-gap-analysis.md` + full per-app dispositions in `docs/make-catalog-classified.tsv`.
- Spot-checks of the classification were validated against live make.com integration pages.

Honest-method one-liner for public pages: *"We enumerated Make's public app directory and n8n's open-source node repository and mapped both against our catalog, app by app. The full methodology and data are in our repo."*

---

## A. Catalog scale & velocity

### A1 — The tool library
> "329 verified integrations exposing 7,382 callable actions and 286 triggers — every one built and documented as an AI-agent tool."

- **Status:** Verified (2026-07-17).
- **Evidence:** `integrations-index.json` roll-up (`totalIntegrations` 329, `totalActions` 7382, `totalTriggers` 286); generated from service code.
- **Usage:** website + deck. Re-pull live numbers at publish time (MW1 wave in progress will raise them).

### A2 — Triggers and self-hosting
> "71 integrations ship real-time or polling triggers; 80 work with self-hosted / on-prem instances."

- **Status:** Verified (2026-07-17). Evidence: `integrations-index.json` (`triggerEnabledServices`, `selfHostedServices`).
- **Usage:** website + deck.

### A3 — Build velocity (the execution story)
> "FlowRunner's catalog grew from 95 to 329 integrations in five days (July 13–17, 2026)."

- **Status:** Verified. Evidence: `docs/n8n-gap-analysis.md` (committed 2026-07-13, records "FlowRunner services today: 95"); current `services/` count 329; git history shows 306 commits on July 13–14 alone, one commit per service.
- **Method note:** agent-assisted engineering pipeline with a human (Mark) testing and directing each wave.
- **Usage:** deck (headline velocity/execution slide). Website: use sparingly — velocity reads as investor material; if used publicly, phrase as "234 integrations shipped in a single release week."

### A4 — Accuracy audit
> "The catalog went through a reference-accuracy audit: services were re-verified against each vendor's official live API documentation, and every discrepancy was fixed — including services rebuilt onto the vendor's current API version."

- **Status:** Verified (audit completed 2026-07-14; 24 services re-verified line-by-line, 18 fixed, all fixes committed individually).
- **Usage:** website + deck. This is Pillar 2 in the website brief. Wording guardrail: "verified against the official API reference," never "live-tested against production accounts" (see F4).

---

## B. Versus n8n (snapshot 2026-07-13)

### B1 — Catalog coverage
> "n8n ships roughly 330 built-in app integrations. FlowRunner offers an equivalent for effectively all of them — 228 of the 246 tracked gap items were built and shipped; the remainder are message brokers that require persistent consumer connections (Kafka, RabbitMQ, MQTT, AMQP), plus a short tail of dead or ultra-niche products."

- **Status:** Verified. Evidence: `docs/n8n-gap-analysis.md` — 228 items checked `[x]` with service paths, 2 explicitly excluded `[~]` (Kafka, RabbitMQ), 16 unchecked (documented as dead/niche/excluded in the doc's final section).
- **Usage:** website comparison page + deck. MUST keep the broker exception — n8n does have Kafka/RabbitMQ/MQTT and core SSH/FTP/Git nodes that FlowRunner does not (SFTP is on the committed roadmap, wave MW12).

### B2 — Beyond n8n's catalog
> "FlowRunner carries 40+ integrations n8n has no built-in node for — including Databricks, Snowflake SQL API, the Azure storage family (Blob, Cosmos DB, Table), nine additional AWS services, Oracle Database, and a complete security/ITSM stack."

- **Status:** Verified. Evidence: `docs/n8n-gap-analysis.md` "FlowRunner exclusives" section (~38 at time of writing) plus services added since (okta, entra-id, google-workspace-admin, azure-cosmos-db, azure-blob-storage, azure-table-storage, oracle-database, ldap and others), each absent from n8n's nodes-base enumeration.
- **Usage:** website + deck. Keep the count at "40+" (conservative floor), don't inflate.

### B3 — AI depth vs n8n
> "For AI providers, FlowRunner covers the provider's full current API surface — for example, 39 OpenAI actions including the Responses API, Sora video, and vector stores, and 28 Gemini actions including grounding, Veo, and TTS — where typical workflow tools ship a thin chat-completion node."

- **Status:** Verified for the FlowRunner half (action counts and coverage from the service code/READMEs). The "typical workflow tools" contrast is fair comment; the specific observation that n8n's AI nodes lagged the providers' current APIs was true at build time (2026-07-13) but is a moving target.
- **Usage:** website + deck. Phrase the competitor half generically ("typical workflow tools"), not as a specific current n8n deficiency, unless re-verified on publish day.

---

## C. Versus Make.com (snapshot: sitemap 2026-01-15, analysis 2026-07-17)

### C1 — What "3,000+ apps" actually contains
> "Make advertises 3,000+ apps. Our audit of Make's own public app directory found 3,092 listings — of which 536 (17%) are community-built apps, 22 are Make's internal utility modules, and 27 are discontinued products that no longer exist (including Google+, Skype, and Pocket). That leaves ~2,534 verified first-party apps, of which our classification rates 1,640 (65%) as regional, vertical, or single-purpose long-tail."

- **Status:** Verified counts (sitemap enumeration + per-app classification, spot-checked against live pages). The 65% long-tail figure is an internal, agent-assisted classification — label it "our classification" wherever used.
- **Evidence:** `docs/make-gap-analysis.md` summary table; `docs/make-catalog-classified.tsv` (all 3,092 dispositions).
- **Usage:** deck: yes, as stated. Website: use the factual counts, keep the tone neutral (house guardrail: don't disparage) — e.g. "catalog size isn't tool quality: 17% of Make's directory is community-built and 65% of its verified apps serve regional or niche verticals (our audit, Jan 2026 snapshot)."

### C2 — Mainstream coverage parity
> "After auditing all 3,092 Make listings, only 57 mainstream, actively-maintained, publicly-buildable apps remained that FlowRunner doesn't cover — and all 57 are on a committed 12-wave roadmap (first wave in progress)."

- **Status:** Verified. Each of the 57 survived an adversarial second-pass review (mainstream demand, self-serve API, product alive, not already covered); 33 first-pass nominations were demoted in that review.
- **Evidence:** `docs/make-gap-analysis.md` Tier-1 section + wave plan.
- **Usage:** deck: yes — this is the "gap to the market leader is small and closing" slide. Website: do NOT publish the 57-item list or the wave plan (competitive roadmap intel, F6); the safe public form is "our audit found fewer than 60 mainstream apps we don't yet cover, all on the roadmap."

### C3 — FlowRunner exclusives vs Make
> "75 FlowRunner integrations have no verified equivalent in Make's directory — including X/Twitter (Make discontinued theirs in 2023 and never returned), Redis, Oracle Database, DynamoDB, SQS, the Milvus/Chroma/Weaviate/pgvector vector stores, Ollama, Databricks, Grafana, Splunk, CircleCI, Travis CI, and a complete security/ITSM stack (TheHive, Cortex, MISP, Microsoft Graph Security)."

- **Status:** Verified. Evidence: `docs/make-gap-analysis.md` exclusives section (name-by-name absence from Make's sitemap, alias-checked — e.g. we matched Make's `prosperworks`→Copper, `sms77`→seven, so absences are not naming artifacts). X/Twitter absence re-confirmed on the live directory July 2026.
- **Usage:** website + deck. For six of the 75 (Affinity, Bill.com, HaloPSA, PostHog, ShipBob, UpLead) Make has community-built apps only — if citing those six, say "no first-party Make app."

### C4 — Databases and data infrastructure
> "Make integrates four classic databases (MySQL, PostgreSQL, SQL Server, MongoDB). FlowRunner's data layer spans 25 databases and warehouses — those four plus Redis, Oracle, DynamoDB, TimescaleDB, QuestDB, CrateDB, pgvector, BigQuery, Snowflake, Databricks, the Azure storage family, and every major vector store."

- **Status:** Verified. Evidence: Make sitemap dispositions (`mysql`, `postgres`, `mssql`, `mongodb` covered-alias; Make also has Pinecone/Qdrant and Redshift — phrase as "classic databases" exactly as above, which is accurate); FlowRunner side from `integrations-index.json` ("Databases & Warehouses": 25).
- **Usage:** website (Data & platform persona page) + deck.

### C5 — The AI-tool-library reframe (positioning, not a stat)
> "Make and n8n are workflow-first: apps exist to be steps in a scenario. FlowRunner is agent-first: every action ships the structured, AI-readable metadata an LLM needs to call it as a tool — 7,382 tools, one catalog, usable by agents and workflows alike."

- **Status:** Verified for the FlowRunner half (every action carries JSDoc descriptions, typed parameters, sample results — enforced by the service standard). The competitor characterization is positioning, kept factual (their public materials market scenario/workflow building).
- **Usage:** lead message on every comparison surface (per website brief Pillar 1).

---

## D. Depth & quality standard

### D1 — Coverage floor
> "When FlowRunner ships an integration a competitor also has, the competitor's operation list is treated as the floor, not the target — and for AI providers, the standard is the vendor's full current API surface."

- **Status:** Verified as the documented engineering standard applied across the July 2026 build-out (recorded in the repo's build docs and evidenced by action counts: e.g. OpenAI 39 actions, Gemini 28, MongoDB 23 including Atlas Vector Search).
- **Usage:** website + deck.

### D2 — Real logos, real docs
> "Every integration ships with the vendor's real logomark and a generated, human-reviewed README documenting every action and parameter."

- **Status:** Verified with minor exceptions — a handful of icons are brand-colored fallbacks where the official mark was unobtainable (documented in-repo). Say "virtually every" or drop the logo half if space is tight.
- **Usage:** website (supporting detail), not deck-worthy.

---

## E. Complete-stack claims (persona pages)

Each verified against `integrations-index.json` categories (2026-07-17):

- **E1 Security/identity:** "The complete identity and SOC stack: Okta, Microsoft Entra ID, LDAP, Google Workspace Admin, TheHive, Cortex, MISP, Splunk, urlscan.io, SecurityScorecard, Microsoft Graph Security." (16 Identity & Security + 14 Dev Tools & Observability services.)
- **E2 Data:** "25 databases and warehouses, 8 vector stores and AI-infra services, one runtime." (See C4.)
- **E3 AI:** "33 AI & LLM integrations at full API surface — OpenAI, Anthropic, Gemini, Vertex, Bedrock, Azure OpenAI, Mistral, Groq, DeepSeek, Perplexity, xAI, Cohere, HuggingFace, OpenRouter, Ollama and more."
- **Status:** Verified (category counts + service lists from the index). **Usage:** website persona pages + deck "complete stacks" slide.

---

## F. Do-NOT-claim guardrails (binding)

- **F1** — Never claim "more integrations than Make." Make's verified first-party catalog (~2,534) is larger than ours; our claims are about verification, mainstream coverage, depth, and the agent-tool layer.
- **F2** — Never claim vector-store or self-hosted-LLM superiority **vs n8n** (n8n covers these via LangChain nodes). Those exclusives are vs Make only (C3/C4).
- **F3** — Never present Make's 3,092 raw listings as their "real" catalog without the community/built-in/dead breakdown — and conversely never say "Make only has 2,534 apps" without noting that's their verified first-party count from our audit.
- **F4** — Never claim live end-to-end production testing of every integration. The verified claim is built-and-audited-against-the-official-API-reference (A4).
- **F5** — Never claim a full n8n superset. Keep the broker/SSH/FTP exceptions of B1.
- **F6** — Do not publish the 57-item Tier-1 gap list, the 12-wave plan, or `docs/make-catalog-classified.tsv` contents on public surfaces (roadmap/competitive intel). Investor materials: fine.
- **F7** — Dead-listing examples (Google+, Skype, Pocket): cite factually and neutrally; no mockery (house voice guardrail).
- **F8** — Don't overclaim MCP; "agent-ready tools" until engineering confirms an MCP surface ships (existing brief rule).

---

## G. Investor-deck digest

**Positioning line:** *"FlowRunner is the verified tool library for AI agents — the integration breadth of a mature iPaaS, rebuilt agent-first, at a build velocity competitors can't match."*

**The three numbers (as of 2026-07-17, refresh before use):**

| | FlowRunner | n8n (OSS, 2026-07-13) | Make (directory, 2026-01 snapshot) |
|---|---|---|---|
| Catalog | **329 verified integrations / 7,382 actions** | ~330 built-in app nodes | 3,092 listings → ~2,534 verified first-party |
| Of which mainstream | agent-first, full-surface standard | — | ~35% (65% long-tail per our audit) |
| Agent-tool metadata per action | **Yes — all actions** | No (workflow nodes) | No (scenario modules) |

**Slide-ready facts (all sections above):**
1. **Velocity:** 95 → 329 integrations in five days; 306 single-service commits in the first 48 hours (A3). The pipeline is agent-assisted engineering with human verification — a structural cost advantage.
2. **n8n:** catalog equivalence achieved in one week; 40+ integrations n8n lacks; exceptions are architectural (message brokers) not effort (B1/B2).
3. **Make:** of 3,092 directory listings, only **57** mainstream buildable apps remain uncovered — all on a 12-wave roadmap already in execution (C1/C2). Gap to the market-leading catalog is small, enumerated, and closing on a known schedule.
4. **Moats:** (a) verified-against-official-API contract incl. a completed accuracy audit (A4); (b) per-action AI-tool metadata — the layer agent platforms need and workflow-first incumbents don't have (C5); (c) full-surface AI-provider coverage (B3); (d) complete vertical stacks — security, identity, data (E1–E3).
5. **Honesty inventory for diligence:** known exclusions (Kafka/RabbitMQ/MQTT persistent consumers), gated Tier-1 apps requiring platform app-review approvals (Meta, TikTok, Pinterest, Amazon SP-API — registrations in progress), and the F-section guardrails. Diligence artifacts: `docs/n8n-gap-analysis.md`, `docs/make-gap-analysis.md`, `docs/make-catalog-classified.tsv`, git history.

**Same doc or separate?** This document is the single source; the deck should lift Section G and cite Sections A–E as backup slides. If the deck team wants a standalone one-pager, export G + the table + facts 1–4 verbatim.
