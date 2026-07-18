# FlowRunner vs Make.com — Integration Gap Analysis

> Generated 2026-07-17 from Make's integrations sitemap (Wayback snapshot of
> `make.com/en/pw-api/sitemaps/integrations-sitemap.xml`, 2026-01-15, cross-checked against the live site)
> compared against `services/` in this repo. App-level comparison only; operation depth is checked
> per-service at build time (competitor operation list = floor, per the house coverage standard).
> Full per-app dispositions for all 3,092 catalog entries: `docs/make-catalog-classified.tsv`.

## Summary

| Metric | Count |
| --- | --- |
| FlowRunner services today | 329 |
| Make catalog apps (sitemap) | 3,092 |
| — Make community-built apps | 536 |
| — Make platform built-ins (HTTP/JSON/CSV/FTP/etc.) | 22 |
| — Verified third-party apps | 2,534 |
| Overlap — Make apps FlowRunner already covers | 273 (185 same-name + 76 renamed/family + 12 sub-apps) |
| **Make verified apps FlowRunner is missing (buildable)** | **2,216** |
| — Tier 1 (build: mainstream, verified must-haves) | 57 |
| — Tier 2 (solid established products) | 519 |
| — Tier 3 (long tail: regional/vertical/tiny) | 1,640 |
| Dead/discontinued Make listings | 27 |
| Infeasible for the HTTP runtime or Make-internal | 18 |
| FlowRunner exclusives Make has no verified app for | 75 |

Reconciliation: 2,534 verified = 261 covered (same-name + renamed/family) + 2,273 analyzed (12 sub-app-covered + 2,216 gaps + 27 dead + 18 infeasible).

## Key findings

- **The n8n parity effort already closed most of the ground.** Of Make's 2,534 verified apps, the
  2,216 we lack are dominated by long tail: 1,640 are regional/vertical/tiny (Czech invoicing,
  Slovak CRMs, single-purpose utilities). Only 57 survived adversarial verification as true Tier-1 gaps.
- **The biggest structural holes are categories n8n never pushed us into:** social publishing
  (TikTok, Instagram, Pinterest, Bluesky, Twitch), ads platforms (Meta Ads), BI (Power BI, Mixpanel,
  Amplitude), e-commerce/marketplaces (Etsy, Square, Amazon Seller Central, PrestaShop, Printful),
  e-signature beyond DocuSign (Adobe Sign, PandaDoc), and mainstream SaaS staples Make carries
  (Klaviyo, Confluence, Smartsheet, Basecamp, Canva, Datadog).
- **A large minority of Tier 1 is gated:** Meta/TikTok/Pinterest/Etsy/Amazon/Canva/RingCentral need
  developer-app registrations or reviews before production use. Registrations should start now,
  in parallel with the ungated waves (checklist below).
- **Make has no X/Twitter app** (discontinued in the 2023 API-pricing era) — FlowRunner's `x-twitter`
  is one of 75 exclusives. Make covers the classic DB drivers (MySQL/Postgres/MSSQL/MongoDB) but
  lacks our newer data tail (Redis, Oracle, DynamoDB, TimescaleDB, QuestDB, CrateDB, and the
  Milvus/Chroma/Weaviate/pgvector vector stores — Make has only Pinecone and Qdrant), 9 of our AWS
  services (Textract, Transcribe, Comprehend, Cognito, IAM, ELB, ACM, DynamoDB, SQS), the Azure
  storage family, Ollama, and the security/ITSM cluster (TheHive, Cortex, MISP, Splunk, Graph Security).
- **Make community apps mirror six of our native services** (affinity, billcom, halopsa, posthog, shipbob, uplead) — we cover
  those with first-party quality where Make only has community builds.

---

## Tier 1 — 57 confirmed gaps, grouped into build waves

Every candidate below survived a second-pass adversarial review (mainstream demand? self-serve API?
not already covered? alive?). ~33 first-pass nominations were demoted to Tier 2 in that review.

### MW1 — AI & agent utilities
_all API-key, zero-dep; clone the existing AI house style_

- [x] **Deepgram** (`services/deepgram`) (`deepgram`, apikey) — Authorization: Token <key>; POST /v1/listen accepts {url} JSON or raw binary; Aura TTS at /v1/speak; prerecorded fits HTTP, live WS streaming out of scope
- [x] **Qwen** (`services/qwen-ai`) (`qwen-ai`, apikey) — dashscope-intl.aliyuncs.com/compatible-mode/v1, OpenAI-compatible chat completions; key from Alibaba Cloud Model Studio
- [x] **Firecrawl** (`services/firecrawl`) (`firecrawl`, apikey) — api.firecrawl.dev REST; /scrape synchronous, /crawl async job with status polling; Bearer key
- [x] **Tavily** (`services/tavily`) (`tavily`, apikey) — simple REST POST /search at api.tavily.com returning agent-ready JSON; extract/crawl endpoints too
- [x] **Runway** (`services/runway`) (`runway-ml-api`, apikey) — api.dev.runwayml.com, Bearer key plus required X-Runway-Version date header; async task create-then-poll pattern
- [x] **HeyGen** (`services/heygen`) (`heygen`, apikey) — api.heygen.com v2; async video generation jobs, poll status or webhook callback; X-Api-Key header
- [x] **Vapi** (`services/vapi`) (`vapi`, apikey) — api.vapi.ai REST with Bearer key; calls/assistants/phone-numbers CRUD plus server-URL webhooks for call events

### MW2 — Analytics & observability
_mixed key/OAuth; google-search-console clones the Google OAuth pattern_

- [x] **Mixpanel** (`services/mixpanel`) (`mixpanel`, basic) — ingestion via project token, query/admin APIs via Service Account basic auth; US/EU/IN residency-specific base URLs
- [x] **Amplitude** (`services/amplitude`) (`amplitude`, apikey) — mixed auth: HTTP V2 event API passes api_key in body; Dashboard/Cohort REST uses basic api_key:secret_key; separate EU residency endpoints
- [x] **Datadog** (`services/datadog`) (`datadog`, apikey) — DD-API-KEY + DD-APPLICATION-KEY headers; site-specific domains (datadoghq.com, .eu, us5 etc.) must be configurable
- [x] **Google Search Console** (`services/google-search-console`) (`google-search-console`, oauth2) — searchanalytics.query, sitemaps, URL Inspection API; property(site)-scoped; standard Google OAuth

### MW3 — Microsoft & Google suite leftovers
_clone entra-id/teams Graph pattern and google-calendar OAuth pattern_

- [x] **Microsoft Power BI** (`services/microsoft-power-bi`) (`microsoft-power-bi`, oauth2) — api.powerbi.com; key ops are dataset refresh, push-dataset rows, export; push datasets have schema/row limits
- [x] **Microsoft Planner** (`services/microsoft-planner`) (`microsoft-planner`, oauth2) — MS Graph /planner endpoints; updates/deletes require If-Match ETag header (common failure point)
- [x] **Microsoft OneNote** (`services/microsoft-onenote`) (`onenote`, oauth2) — Microsoft Graph /me/onenote (notebooks/sections/pages), Notes.ReadWrite scopes; page content is HTML
- [x] **Google Meet** (`services/google-meet`) (`google-meet`, oauth2) — meet.googleapis.com/v2: create spaces, conferenceRecords artifacts (recordings/transcripts, 30-day retention); scheduling with invitees lives in Calendar API
- [x] **Google Maps Platform** (`services/google-maps`) (`google-maps`, apikey) — per-product endpoints (Geocoding, Places New, Routes); Places New requires X-Goog-Api-Key + X-Goog-FieldMask headers; needs GCP billing enabled

### MW4 — Payments & accounting
_key/basic auth REST, clone stripe/paypal patterns_

- [x] **Square** (`services/square`) (`square`, oauth2) — connect.squareup.com REST, date-versioned via Square-Version header; self-serve sandbox; personal access token or OAuth
- [x] **Mollie** (`services/mollie`) (`mollie`, apikey) — api.mollie.com/v2, Bearer live_/test_ keys; OAuth2 available for multi-account apps
- [x] **Razorpay** (`services/razorpay`) (`razorpay`, basic) — api.razorpay.com/v1, key_id:key_secret Basic auth; amounts in paise (minor units)
- [x] **Sage Accounting** (`services/sage-accounting`) (`sage-accounting`, oauth2) — api.accounting.sage.com/v3.1, OAuth2 via oauth.accounting.sage.com; access tokens expire in ~5 min so robust refresh handling is essential

### MW5 — Email & marketing
_mostly API-key; constant-contact OAuth with rotating refresh tokens_

- [x] **Klaviyo** (`services/klaviyo`) (`klaviyo`, apikey) — a.klaviyo.com JSON:API-style REST; requires date-based revision header on every call; Klaviyo-API-Key auth
- [x] **Resend** (`services/resend`) (`resend`, apikey) — api.resend.com, Bearer key; simple JSON REST for emails, domains, audiences, broadcasts
- [x] **Constant Contact** (`services/constant-contact`) (`constant-contact`, oauth2) — v3 REST; OAuth2 auth-code with rotating refresh tokens; legacy v2 API retired
- [x] **ManyChat** (`services/manychat`) (`manychat`, apikey) — api.manychat.com REST, subscriber-centric (find/set fields, tags, send flows); channel 24h-window rules limit outbound sends
- [x] **Trustpilot** (`services/trustpilot`) (`trustpilot`, oauth2) **[GATED]** — api.trustpilot.com; public read endpoints need only apikey header, private endpoints use OAuth2; customer must have API module

### MW6 — PM & productivity
_confluence clones the jira-issues Atlassian pattern_

- [x] **Confluence** (`services/confluence`) (`confluence`, oauth2) — Cloud REST v2 via api.atlassian.com/ex/confluence/{cloudId}; OAuth 3LO or email+API-token basic; ADF/storage-format bodies are the main quirk
- [x] **Basecamp** (`services/basecamp3`) (`basecamp3`, oauth2) — bc3-api JSON; OAuth2 via launchpad.37signals.com; mandatory descriptive User-Agent header; 50 req/10s rate limit
- [x] **Smartsheet** (`services/smartsheet`) (`smartsheet`, oauth2) — api.smartsheet.com/2.0, Bearer PAT or OAuth2; sheet/row/column object model with bulk row operations
- [x] **Tally** (`services/tally`) (`tally`, apikey) — api.tally.so with Bearer API key from settings; forms + submissions + webhooks; 100 req/min
- [x] **Wix** (`services/wix`) (`wix`, apikey) — www.wixapis.com REST; self-serve account-level API keys (wix-account-id/wix-site-id headers); OAuth only needed for marketplace apps

### MW7 — CRM, support & comms
_zoho-desk clones the zoho-crm OAuth family_

- [x] **Bitrix24** (`services/bitrix24`) (`bitrix24`, oauth2) — per-portal REST {portal}.bitrix24.xx/rest; simplest auth is inbound-webhook token URL; OAuth for multi-portal apps; batch endpoint for bulk calls
- [x] **Salesloft** (`services/salesloft`) (`salesloft`, oauth2) — api.salesloft.com/v2 JSON REST, OAuth2 auth-code (PATs also available); consistent paginated list endpoints
- [x] **Zoho Desk** (`services/zoho-desk`) (`zoho-desk`, oauth2) — desk.zoho.com/api/v1 with Zoho accounts OAuth; region-specific DC endpoints and orgId header, same pattern as shipped Zoho services
- [x] **OneSignal** (`services/onesignal`) (`onesignal`, apikey) — api.onesignal.com, per-app REST API key (Authorization: Key/Bearer); app_id in every call
- [x] **RingCentral** (`services/ringcentral`) (`ringcentral`, oauth2) **[GATED]** — platform.ringcentral.com REST, OAuth2 auth-code; build in sandbox, then 'Apply for Production' review (min successful-call thresholds per endpoint)

### MW8 — Docs, e-sign & media
_async job patterns (canva/cloudconvert); cloudinary signed uploads_

- [ ] **Adobe Acrobat Sign** (`adobe-sign`, oauth2) — REST v6 with region-sharded base URI (discover via /baseUris); OAuth app created in-account, Integration Key option for server-to-server
- [ ] **PandaDoc** (`pandadoc`, oauth2) **[GATED]** — api.pandadoc.com REST, OAuth2 or API-Key; free sandbox key for dev, production requires plan activation via support/sales
- [ ] **Canva** (`canva`, oauth2) **[GATED]** — Connect REST; OAuth2 with PKCE mandatory; async job pattern for design export; preview-tier APIs barred from public integrations
- [ ] **Cloudinary** (`cloudinary`, basic) — Upload API (params signed with api_secret) + Admin API (basic api_key:api_secret); cloud_name embedded in URL path
- [ ] **CloudConvert** (`cloudconvert`, apikey) — REST v2 job/task graph (import→convert→export tasks); Bearer key; sandbox env; FR service will need @usesFileStorage

### MW9 — E-commerce & marketplaces
_two gated (Etsy app approval, Amazon SP-API registration) — start registrations early_

- [ ] **Etsy** (`etsy`, oauth2) **[GATED]** — Open API v3: OAuth2 PKCE plus x-api-key header; Personal App approval then manual Commercial Access review for multi-seller apps
- [ ] **PrestaShop** (`prestashop`, apikey) — self-hosted Webservice API, WS key sent as Basic-auth username; XML by default, JSON via output_format=JSON param
- [ ] **Printful** (`printful`, token) — api.printful.com (v2 rolling out), private Bearer token from dashboard; OAuth only needed for public apps
- [ ] **Amazon Seller Central (SP-API)** (`amazon-seller-central`, oauth2) **[GATED]** — LWA OAuth2 only (AWS SigV4 requirement dropped in 2023); regional endpoints; Restricted Data Tokens for PII

### MW10 — Social & video (self-serve)
_bluesky app-password XRPC; twitch/vimeo standard OAuth_

- [ ] **Bluesky** (`bluesky`, token) — AT Protocol XRPC; app-password createSession JWT is the pragmatic path; official OAuth is nonstandard (DPoP + client metadata doc); ~5k points/hr rate limit
- [ ] **Twitch** (`twitch`, oauth2) — api.twitch.tv/helix REST with Client-ID header; app vs user access tokens; EventSub webhooks for triggers
- [ ] **Vimeo** (`vimeo`, oauth2) **[GATED]** — api.vimeo.com REST, self-serve app creation; upload capability requires requesting approval from Vimeo (routine but manual)

### MW11 — Social & ads (all gated)
_Meta/TikTok/Pinterest developer-app approvals required — begin registrations while MW1 ships_

- [ ] **Facebook/Meta Ads** (`facebook-ads-cm`, oauth2) **[GATED]** — Meta Marketing API on Graph (/act_{id} campaign/adset/ad CRUD); Standard/Advanced access requires Meta App Review
- [ ] **Instagram for Business** (`instagram-business`, oauth2) **[GATED]** — Graph API two-step container create then publish flow; instagram_content_publish needs Advanced Access review; newer Instagram-Login API variant exists
- [ ] **Facebook Messenger** (`facebook-messenger`, oauth2) **[GATED]** — Send API with Page access token; pages_messaging needs App Review advanced access; 24-hour messaging window rules
- [ ] **TikTok** (`tiktok`, oauth2) **[GATED]** — open.tiktokapis.com v2 (Login Kit + Content Posting + Display APIs); production visibility requires app audit; Marketing API is a separate approval
- [ ] **Pinterest** (`pinterest`, oauth2) **[GATED]** — api.pinterest.com/v5 REST; trial tier is rate-limited/own-account, Standard tier via business-day review process

### MW12 — HR, dev & infra (+ SFTP spike)
_sftp = ssh2 driver spike (same connect-per-call pattern as the DB family); ADP is partner-gated, build last_

- [ ] **Greenhouse** (`greenhouse`, basic) — Harvest API: API key as basic-auth username, empty password; writes require On-Behalf-Of user-ID header
- [ ] **Kajabi** (`kajabi`, oauth2) — OAuth2 client_credentials against /v1/oauth/token using per-account client_id/secret from Settings > Public API (customer-supplied creds, no app review)
- [ ] **Azure DevOps** (`azure-devops`, oauth2) — legacy Azure DevOps OAuth closed to new apps Apr 2025 (EOL 2026) — register via Microsoft Entra ID; PAT basic-auth fallback; dev.azure.com/{org} REST 7.x
- [ ] **SFTP** (`sftp`, basic) — no HTTP API — use ssh2/ssh2-sftp-client npm dependency, password or private-key auth; service needs @usesFileStorage for file handoff
- [ ] **ADP Workforce Now** (`adp-workforce-now`, oauth2) **[GATED]** — OAuth2 client-credentials over mutual TLS to accounts.adp.com/api.adp.com; client cert issued/registered via ADP partner portal

### Gated-app registration checklist (start immediately, before MW9/MW11)

- [ ] Meta developer app with Advanced Access: Marketing API (`facebook-ads-cm`), `instagram_content_publish`, `pages_messaging` (Messenger)
- [ ] TikTok developer app + Content Posting API approval
- [ ] Pinterest developer app: trial tier immediately, Standard-access application for production
- [ ] Etsy Personal App approval (then commercial access request)
- [ ] Amazon SP-API developer registration (Seller Central developer profile)
- [ ] Canva Connect integration + review for public availability
- [ ] RingCentral production-app graduation (sandbox first)
- [ ] PandaDoc production API key (sandbox key is instant)
- [ ] Vimeo upload-capability request (basic API is instant)
- [ ] Trustpilot business account for private-API credentials (public read APIs are key-only)
- [ ] ADP partner program + mutual-TLS certificates — heavy; defer `adp-workforce-now` until demand justifies it

---

## Tier 2 — 519 established products (build after Tier 1, cluster by exemplar)

Real user bases and buildable APIs; second-tier demand or overlapping an existing covered category.

### ai (62)

- [ ] AI21 Labs (`ai21-labs`) — LLM provider (Jamba/Jurassic models)
- [ ] AssemblyAI (`assembly-ai`) — Speech-to-text and audio intelligence API
- [ ] Azure AI Foundry (`azure-ai-foundry`) — Microsoft unified AI model and agent platform
- [ ] Base64.ai (`base64-ai`) — AI document data extraction and OCR
- [ ] Bland AI (`bland`) — AI phone-calling agent platform
- [ ] Botpress (`botpress`) — Open-source AI chatbot and agent platform
- [ ] Cerebras (`cerebras-ai`) — Ultra-fast LLM inference API
- [ ] Chatbase (`chatbase`) — Custom AI chatbots trained on your data
- [ ] ChatBot.com (`chatbot`) — Chatbot builder from LiveChat family
- [ ] Clarifai (`clarifai`) — Computer vision and AI model platform
- [ ] Clipdrop (`clipdrop`) — AI image editing API: background removal, upscaling
- [ ] Copy.ai (`copy-ai`) — AI copywriting and GTM workflows
- [ ] Copy.ai (`copy.ai`) — Duplicate Make listing of Copy.ai
- [ ] Coveo (`coveo`) — Enterprise AI search and relevance platform
- [ ] Coze (`coze`) — ByteDance no-code AI agent/bot builder
- [ ] Creatify (`creatify-ai`) — AI video ad generation platform
- [ ] DataRobot (`datarobot`) — Enterprise AutoML and AI platform
- [ ] DeepInfra (`deepinfra`) — Serverless inference hosting for open AI models
- [ ] Dify (`dify`) — Open-source LLM app and agent platform
- [ ] Dust (`dust`) — Enterprise AI agent building platform
- [ ] E2B (`e2b`) — Cloud sandboxes for AI agent code execution
- [ ] Eden AI (`edenai`) — Aggregator API for multiple AI providers
- [ ] Exa (`exa-ai`) — AI-native web search API
- [ ] fal.ai (`fal-ai`) — Fast generative media model inference API
- [ ] Fathom (`fathom`) — AI meeting notetaker
- [ ] Fliki (`fliki`) — AI text-to-video and voiceover generator
- [ ] Dialogflow (`google-cloud-dialogflow`) — Google conversational AI chatbot platform
- [ ] Google Cloud Speech-to-Text (`google-cloud-speech`) — Google speech recognition API
- [ ] Google Cloud Text-to-Speech (`google-cloud-tts`) — Google speech synthesis API
- [ ] Google Cloud Vision (`googlecloudvision`) — Image analysis and OCR API
- [ ] Ideogram (`ideogram`) — AI image generation with strong text rendering
- [ ] Jasper (`jasper-ai`) — AI marketing content generation
- [ ] Kimi (Moonshot AI) (`kimi`) — Moonshot AI chatbot/LLM API, China-origin
- [ ] Leonardo.Ai (`leonardo-ai`) — AI image generation platform, Canva-owned
- [ ] Meta Llama (`llama`) — Meta's Llama LLM API
- [ ] Luma AI (`luma-ai`) — Dream Machine AI video generation API
- [ ] MCP Client (`mcp-client`) — Make app for calling Model Context Protocol servers
- [ ] MeetGeek (`meetgeekai`) — AI meeting recorder, transcripts and insights
- [ ] Mem0 (`mem0`) — Memory layer API for AI agents
- [ ] MindStudio (`mindstudio-ai`) — No-code AI agent and app builder
- [ ] Murf AI (`murf-ai`) — AI voice-over and text-to-speech
- [ ] Nanonets (`nanonets`) — AI document OCR and data extraction
- [ ] NVIDIA (`nvidia`) — NVIDIA NIM cloud APIs for AI inference
- [ ] PhotoRoom (`photoroom`) — AI photo editing and background removal API
- [ ] PlayHT (`playht`) — AI text-to-speech voice generation platform
- [ ] Read AI (`read`) — AI meeting notes, summaries and analytics
- [ ] Relevance AI (`relevance`) — AI agent workforce building platform
- [ ] remove.bg (`removebg`) — AI image background removal API, Canva-owned
- [ ] Retell AI (`retell-ai`) — AI voice agent platform for phone calls
- [ ] Rossum (`rossum-elis`) — AI invoice/document data extraction (Elis API)
- [ ] SambaNova (`sambanova`) — high-speed AI inference cloud
- [ ] Speechmatics (`speechmatics`) — Speech-to-text API platform
- [ ] Stability AI (`stability-ai`) — Stable Diffusion image generation API
- [ ] Stable Diffusion (`stable-diffusion`) — Duplicate Make app for Stability image API
- [ ] Suno (`suno`) — AI music generation platform
- [ ] Synthesia (`synthesia`) — AI avatar video generation platform
- [ ] Synthflow AI (`synthflow-ai-phone-calling`) — No-code AI voice phone agents
- [ ] Together AI (`together-ai`) — Open-model AI inference cloud
- [ ] Trint (`trint`) — AI transcription and captioning platform
- [ ] Vercel AI Gateway (`vercel-ai-gateway`) — Unified gateway API to many LLM providers
- [ ] IBM watsonx.ai (`watsonx-ai`) — IBM enterprise generative AI platform
- [ ] You.com (`you`) — AI search and LLM API platform

### marketing (51)

- [ ] Attentive (`attentive`) — SMS and email marketing for ecommerce brands
- [ ] Birdeye (`birdeye`) — Reputation and review management platform
- [ ] Braze (`braze`) — Enterprise customer engagement and messaging platform
- [ ] Clay (`clay`) — GTM data enrichment and prospecting workspace
- [ ] ClickFunnels (`click-funnels`) — Sales funnel builder (classic 1.0)
- [ ] ClickFunnels 2.0 (`click-funnels-2`) — Funnel, site, and e-commerce platform
- [ ] Dotdigital (`dotdigital`) — Omnichannel marketing automation platform
- [ ] Dub (`dub`) — Open-source link management and attribution platform
- [ ] Encharge (`encharge`) — Marketing automation for SaaS
- [ ] Facebook Conversions API (`facebook-conversions-api`) — Meta server-side event tracking (CAPI)
- [ ] Facebook Custom Audiences (`facebook-custom-audiences`) — Meta ads audience list management
- [ ] FirstPromoter (`firstpromoter`) — Affiliate and referral tracking for SaaS
- [ ] FullEnrich (`fullenrich`) — Waterfall B2B contact enrichment API
- [ ] Hyros (`hyros`) — Ad attribution and tracking for marketers
- [ ] Instapage (`instapage`) — Landing page builder for ad campaigns
- [ ] Kartra (`kartra`) — All-in-one marketing and funnel platform
- [ ] Klenty (`klenty`) — Sales engagement and outreach platform
- [ ] LinkedIn Ads Campaign Management (`linkedin-ads-campaign-mgmt`) — LinkedIn advertising campaign management API
- [ ] LinkedIn Lead Gen Forms (`linkedin-lead-forms`) — LinkedIn lead-gen form responses API
- [ ] Lusha (`lusha`) — B2B contact and company data enrichment
- [ ] Mailshake (`mailshake`) — Cold email outreach and sales engagement
- [ ] Salesforce Marketing Cloud (`marketing-cloud`) — Salesforce enterprise marketing automation suite
- [ ] Microsoft Advertising Campaign Management (`microsoft-ad-campaign-mgmt`) — Bing/Microsoft ads campaign management API
- [ ] Microsoft Advertising Reports (`microsoft-advertising-reports`) — Bing/Microsoft ads reporting API
- [ ] Mixmax (`mixmax`) — Sales engagement and email productivity
- [ ] Microsoft Advertising Offline Conversions (`ms-advertising-conversions`) — Bing/Microsoft ads offline conversion uploads
- [ ] Omnisend (`omnisend`) — Ecommerce email and SMS marketing automation
- [ ] Ontraport (`ontraport`) — Marketing automation and CRM platform
- [ ] Oracle Eloqua (`oracle-eloqua`) — Enterprise marketing automation platform
- [ ] Postalytics (`postalytics`) — Direct mail automation platform
- [ ] PostGrid (`postgrid`) — Print-and-mail API with address verification
- [ ] PushEngage (`pushengage`) — Web push notification marketing platform
- [ ] Pushwoosh (`pushwoosh`) — Mobile push and omnichannel messaging platform
- [ ] RD Station (`rd-station`) — Brazilian marketing automation leader (Brazil)
- [ ] Pardot (Marketing Cloud Account Engagement) (`salesforce-pardot`) — Salesforce B2B marketing automation; renamed Account Engagement
- [ ] SALESmanago (`salesmanago`) — European marketing automation and CDP, Poland-based
- [ ] SE Ranking (`se-ranking`) — SEO platform for rank tracking and audits
- [ ] Semrush (`semrush`) — leading SEO and marketing intelligence platform
- [ ] SharpSpring (`sharpspring`) — Marketing automation CRM, now Constant Contact Lead Gen & CRM
- [ ] Snapchat Ads (`snapchat-campaign-management`) — Snapchat Marketing API campaign management
- [ ] Snapchat Conversions API (`snapchat-conversions`) — Server-side event tracking for Snapchat Ads
- [ ] Snov.io (`snovio`) — Email finder and cold outreach platform
- [ ] Systeme.io (`systeme-io`) — All-in-one marketing funnels and email platform
- [ ] TikTok Audiences (`tiktok-audiences`) — TikTok Ads custom audience management
- [ ] TikTok Conversions (`tiktok-conversions`) — TikTok Events API for conversion tracking
- [ ] TikTok Lead Forms (`tiktok-lead-forms`) — TikTok lead generation form retrieval
- [ ] TikTok Reports (`tiktok-reports`) — TikTok Ads reporting API
- [ ] Unbounce (`unbounce`) — Landing page builder with conversion tools
- [ ] User.com (`usercom`) — Marketing automation and engagement platform
- [ ] Yotpo Loyalty (`yotpo-loyalty`) — Ecommerce loyalty and rewards module of Yotpo
- [ ] Zoho Campaigns (`zoho-campaigns`) — Email marketing in Zoho suite

### dev-tools (31)

- [ ] Algolia (`algolia-com`) — Hosted search-as-a-service API
- [ ] Apify (`apify`) — Web scraping and automation actor platform
- [ ] Google AppSheet (`appsheet`) — Google no-code app builder with API
- [ ] Automation Anywhere (`automation-anywhere`) — Enterprise RPA platform
- [ ] Azure Service Bus (`azure-service-bus`) — Microsoft cloud message broker
- [ ] Bright Data (`brightdata`) — Web scraping and proxy data platform
- [ ] Browse AI (`browse-ai`) — No-code website scraping and monitoring
- [ ] cPanel (`cpanel`) — Web hosting control panel with UAPI/WHM API
- [ ] Crowdin (`crowdin`) — Localization and translation management platform
- [ ] Filestack (`filestack`) — File upload and processing API
- [ ] Glide (`glide`) — No-code app builder on spreadsheets and tables
- [ ] Google Cloud Pub/Sub (`google-cloud-pubsub`) — GCP messaging and event streaming service
- [ ] IONOS (`ionos`) — European hosting/cloud provider; domains, DNS, servers
- [ ] Lokalise (`lokalise`) — Software localization management platform
- [ ] Mailtrap (`mailtrap`) — Email testing and delivery platform
- [ ] Oxylabs (`oxylabs`) — Proxy network and web scraping APIs
- [ ] Pingdom (`pingdom`) — Website uptime and performance monitoring (SolarWinds)
- [ ] ScrapeGraphAI (`scrapegraphai`) — LLM-powered structured web scraping API
- [ ] ScrapingBee (`scrapingbee`) — popular web scraping API
- [ ] SerpApi (`serpapi`) — Google and search-engine results API
- [ ] Site24x7 (`site24x7`) — Zoho website and server monitoring suite
- [ ] Stack Exchange (`stackexchange`) — Stack Overflow Q&A network API
- [ ] Atlassian Statuspage (`statuspage`) — Hosted status pages for incident comms
- [ ] HCP Terraform (`terraform-cloud`) — Terraform Cloud infrastructure-as-code platform
- [ ] Transloadit (`transloadit`) — File uploading and media encoding API
- [ ] UiPath (`uipath`) — Leading enterprise RPA automation platform
- [ ] Uploadcare (`uploadcare`) — File upload, processing and CDN platform
- [ ] Wappalyzer (`wappalyzer`) — Website technology stack detection API
- [ ] Xano (`xano`) — No-code scalable backend platform
- [ ] ZenRows (`zenrows`) — Web scraping and anti-bot API
- [ ] Zoho Creator (`zoho-creator`) — Low-code app platform in Zoho suite

### crm (29)

- [ ] Attio (`attio`) — Modern data-driven CRM
- [ ] Bigin by Zoho CRM (`bigin-by-zoho`) — Zoho's SMB pipeline CRM, separate API
- [ ] Capsule CRM (`capsule-crm`) — UK-born SMB CRM with global base
- [ ] Crossbeam (`crossbeam`) — Partner ecosystem account-mapping platform
- [ ] Custify (`custify`) — Customer success platform for SaaS
- [ ] EngageBay (`engagebay`) — All-in-one CRM, marketing and support suite
- [ ] EspoCRM (`espo-crm`) — Open-source self-hosted CRM
- [ ] FluentCRM (`fluentcrm`) — Self-hosted WordPress CRM and email automation plugin
- [ ] folk (`folk`) — Modern relationship-centric CRM
- [ ] Insightly (`insightly`) — Mid-market CRM and project platform
- [ ] LeadSquared (`leadsquared`) — CRM and marketing automation, India-origin
- [ ] Neon CRM (`neoncrm`) — Nonprofit donor management CRM
- [ ] NetHunt CRM (`nethunt`) — Gmail-native CRM
- [ ] Nimble (`nimble`) — Social relationship CRM
- [ ] noCRM.io (`nocrm-io`) — Lead management sales CRM (France-origin)
- [ ] Nutshell (`nutshell`) — SMB sales CRM
- [ ] Pipeliner CRM (`pipelinercrm`) — Visual sales CRM for pipeline management
- [ ] Reply.io (`reply-io`) — sales engagement and cold outreach automation platform
- [ ] RocketReach (`rocketreach`) — contact and company data enrichment
- [ ] Salesflare (`salesflare`) — automated CRM for small businesses
- [ ] Streak (`streak`) — CRM built into Gmail
- [ ] SugarCRM (`sugarcrm11`) — Established enterprise CRM platform (v11 API)
- [ ] SuiteCRM 7 (`suitecrm7`) — Open-source CRM, SugarCRM fork
- [ ] SuperOffice (`superoffice`) — European CRM for mid-size companies
- [ ] Teamleader (`teamleader`) — Belgian CRM, invoicing and work management
- [ ] Vitally (`vitally`) — Customer success management platform
- [ ] Vtiger CRM (`vtiger`) — Open-source-rooted all-in-one CRM
- [ ] Zendesk Sell (`zendesk-sell`) — Zendesk sales CRM (ex Base CRM), separate API
- [ ] ZoomInfo (`zoominfo`) — B2B contact and company intelligence; license-gated API

### email (26)

- [ ] AWeber (`aweber`) — Long-running email marketing platform
- [ ] beehiiv (`beehiiv`) — Fast-growing newsletter publishing platform
- [ ] Campaign Monitor (`campaign-monitor`) — Established email marketing platform
- [ ] CleverReach (`cleverreach`) — Email marketing leader in Germany/DACH
- [ ] Drip (`drip`) — Ecommerce email marketing automation
- [ ] Elastic Email (`elastic-email`) — Email delivery and marketing platform
- [ ] EmailOctopus (`email-octopus`) — Affordable email marketing platform
- [ ] Emailable (`emailable`) — Email verification API
- [ ] Emma by Marigold (`emma`) — Email marketing platform
- [ ] Flodesk (`flodesk`) — Email marketing platform for creators
- [ ] Kickbox (`kickbox`) — Email verification and deliverability service
- [ ] Loops (`loops`) — Email marketing for SaaS startups
- [ ] Mailmodo (`mailmodo`) — Interactive AMP email marketing
- [ ] Moosend (`moosend`) — Email marketing platform (Sitecore)
- [ ] NeverBounce (`neverbounce`) — Email verification service (ZoomInfo)
- [ ] Sender (`sender`) — budget email and SMS marketing platform
- [ ] SendFox (`sendfox`) — budget email marketing for creators
- [ ] Sendlane (`sendlane`) — ecommerce email and SMS marketing automation
- [ ] SendPulse (`sendpulse`) — multichannel email, SMS and chatbot marketing
- [ ] Smartlead (`smartleadai`) — Cold email outreach at scale
- [ ] SMTP2GO (`smtp2go`) — Transactional email and SMTP relay service
- [ ] SparkPost (`sparkpost`) — Transactional email service, now part of Bird
- [ ] Woodpecker.co (`woodpecker`) — Cold email outreach and follow-up automation
- [ ] ZeroBounce (`zerobounce`) — Email validation and deliverability service
- [ ] Zoho Mail (`zoho-mail`) — Business email hosting in Zoho suite
- [ ] Zoho ZeptoMail (`zoho-zeptomail`) — Transactional email service by Zoho

### project-management (24)

- [ ] Accelo (`accelo`) — Professional services automation: projects, CRM, billing
- [ ] Adobe Workfront (`adobe-workfront`) — Enterprise work and marketing project management
- [ ] Aha! (`aha-io`) — Product roadmap and idea management
- [ ] Clubhouse.io (`clubhouse`) — Rebranded to Shortcut; software project management
- [ ] Fibery (`fibery`) — Connected work management workspace
- [ ] Float (`float`) — Resource scheduling and capacity planning
- [ ] Flowlu (`flowlu`) — All-in-one business management: CRM, projects, invoicing
- [ ] Hive (`hive`) — Project management and collaboration platform
- [ ] Kissflow (`kissflow`) — Low-code workflow and BPM platform
- [ ] Mavenlink (Kantata) (`mavenlink`) — Professional services automation, rebranded Kantata OX
- [ ] MeisterTask (`meistertask`) — Kanban task management by Meister
- [ ] Pipefy (`pipefy`) — No-code business process and workflow management platform
- [ ] Podio (`podio`) — Progress Podio work management and app builder
- [ ] Process Street (`process-street`) — Checklist and SOP workflow platform
- [ ] ProdPad (`prodpad`) — Product roadmap and idea management
- [ ] Productboard (`productboard`) — Product management and prioritization platform
- [ ] ProofHub (`proofhub`) — Project management and team collaboration tool
- [ ] Redmine (`redmine`) — Open-source project management and issue tracker
- [ ] Resource Guru (`resource-guru`) — team resource scheduling and capacity planning
- [ ] SmartSuite (`smartsuite`) — No-code work management platform
- [ ] Teamwork.com (`teamwork`) — Established project management for client work
- [ ] Wrike (`wrike`) — Enterprise work and project management
- [ ] Ziflow (`ziflow`) — Creative proofing and review platform
- [ ] Zoho Projects (`zoho-projects`) — Project management in Zoho suite

### communication (24)

- [ ] Aircall (`aircall`) — Cloud phone system and call center
- [ ] Bettermode (`bettermode`) — Customer community platform, formerly Tribe
- [ ] Chatfuel (`chatfuel`) — Messenger, Instagram, WhatsApp bot platform
- [ ] Circle (`circle-so`) — Community platform for creators and brands
- [ ] CloudTalk (`cloudtalk`) — Cloud call center and phone system
- [ ] Dialpad (`dialpad`) — AI-powered business phone and UCaaS platform
- [ ] 8x8 (`eight-x-eight`) — Business VoIP, SMS and contact center APIs
- [ ] Firebase Cloud Messaging (`fcm`) — Google mobile push notification service
- [ ] Freshchat (`freshchat`) — Freshworks customer messaging and chat product
- [ ] JivoChat (`jivochat`) — Live chat; strong in Brazil and Russia
- [ ] JustCall (`justcall`) — Cloud phone and SMS for sales teams
- [ ] Kixie (`kixie`) — Sales dialer and call automation platform
- [ ] Landbot (`landbot`) — No-code chatbot builder
- [ ] Missive (`missive`) — Team email and shared inbox app
- [ ] Olark (`olark`) — Live chat for sales and support
- [ ] OpenPhone (`open-phone`) — Modern business phone system for teams
- [ ] Respond.io (`respond-io`) — omnichannel customer messaging platform
- [ ] Ringover (`ringover`) — European cloud telephony and contact center
- [ ] SignalWire (`signalwire`) — Programmable voice/SMS/video cloud, Twilio alternative
- [ ] Sinch Engage (`sinch-engage`) — WhatsApp/messaging marketing, ex-MessengerPeople
- [ ] SleekFlow (`sleekflow`) — Omnichannel social commerce messaging platform
- [ ] WeChat (`wechat`) — Chinese messaging super-app (China); API needs China verification
- [ ] Whereby (`whereby`) — Browser video meetings with embeddable rooms API
- [ ] Zoho Cliq (`zoho-cliq`) — Team chat in Zoho suite

### ecommerce (23)

- [ ] Big Cartel (`big-cartel`) — Ecommerce storefronts for artists and makers
- [ ] Cin7 (`cin7`) — Inventory and order management (Core/Omni)
- [ ] DEAR Inventory (Cin7 Core) (`dear-inventory`) — Inventory management, rebranded as Cin7 Core
- [ ] Digistore24 (`digistore`) — Online sales and affiliate platform (DACH-focused)
- [ ] Facebook Catalogs (`facebook-catalogs`) — Meta commerce product catalog management
- [ ] Google Merchant Center (`google-shopping`) — Product feed management for Google Shopping
- [ ] Hotmart (`hotmart`) — Digital product and course selling platform, Brazil-origin
- [ ] Judge.me (`judge-me`) — Product reviews app for Shopify stores
- [ ] Lightspeed eCom (`lightspeed-ecom`) — E-commerce platform (Lightspeed C-Series)
- [ ] Loyverse (`loyverse`) — Free POS system for small businesses
- [ ] Memberful (`memberful`) — Membership subscriptions platform owned by Patreon
- [ ] MemberPress (`memberpress`) — WordPress membership and paywall plugin
- [ ] Mirakl (`mirakl`) — Enterprise marketplace platform
- [ ] OLX (`olx`) — Classifieds marketplace across Europe, LatAm, Asia
- [ ] OpenCart (`opencart`) — Open-source ecommerce shopping cart platform
- [ ] Order Desk (`order-desk`) — Ecommerce order management and routing
- [ ] Printify (`printify`) — Major print-on-demand marketplace
- [ ] SamCart (`samcart`) — ecommerce checkout and funnel platform
- [ ] Sellercloud (`sellercloud`) — omnichannel ecommerce inventory and order ERP
- [ ] Stamped (`stamped`) — Ecommerce reviews and loyalty platform
- [ ] SureCart (`surecart`) — WordPress e-commerce and checkout platform
- [ ] ThriveCart (`thrivecart`) — Popular checkout and cart platform for creators
- [ ] VTEX (`vtex`) — Enterprise digital commerce platform

### productivity (21)

- [ ] Any.do Workspace (`anydo-workspace`) — Team task management from Any.do
- [ ] Canny (`canny`) — User feedback and feature request management
- [ ] Copilot (`copilot`) — Client portal platform for service businesses
- [ ] Everhour (`everhour`) — Team time tracking and budgeting
- [ ] Evernote (`evernote`) — Note-taking app, now Bending Spoons
- [ ] Feedly (`feedly`) — RSS/news aggregation with AI feeds
- [ ] Gamma (`gamma-app`) — AI presentation and document generator
- [ ] Guru (`getguru`) — AI-powered company knowledge base and wiki
- [ ] Hubstaff (`hubstaff`) — Time tracking and workforce analytics
- [ ] Inoreader (`inoreader`) — RSS reader with content automation
- [ ] Jibble (`jibble`) — Free time and attendance tracking
- [ ] Lark Base (`larksuitebase`) — Airtable-like database in ByteDance Lark suite
- [ ] Mailparser (`mailparser-io`) — Extracts structured data from inbound emails
- [ ] Miro (`miro`) — Online collaborative whiteboard
- [ ] Mural (`mural`) — Digital whiteboard for team collaboration
- [ ] Outline (`outline`) — Team knowledge base and wiki
- [ ] RescueTime (`rescuetime`) — automatic time-tracking and productivity analytics
- [ ] Rows (`rows`) — modern spreadsheet with built-in integrations
- [ ] TickTick (`ticktick`) — Popular cross-platform to-do and task app
- [ ] Time Doctor (`time-doctor`) — Employee time tracking and monitoring
- [ ] TimeCamp (`timecamp`) — Time tracking and timesheet software

### forms-surveys (21)

- [ ] Cognito Forms (`cognitoforms`) — Advanced online form builder
- [ ] Contact Form 7 (`contact-form-seven`) — Most-installed WordPress form plugin
- [ ] Delighted (`delighted`) — NPS and customer feedback surveys (Qualtrics)
- [ ] Fillout (`fillout`) — Modern form builder with deep integrations
- [ ] Formbricks (`formbricks`) — Open-source survey and experience management
- [ ] Formidable Forms (`formidable-forms`) — Popular WordPress form builder plugin
- [ ] Formsite (`formsite`) — Long-running online form and survey builder
- [ ] Formspree (`formspree`) — Form backend API for static sites
- [ ] Fulcrum (`fulcrum`) — Mobile field data collection platform
- [ ] GoCanvas (`gocanvas`) — Mobile forms for field operations
- [ ] Ninja Forms (`ninja-forms`) — WordPress form builder plugin
- [ ] 123FormBuilder (`one-two-three-form-builder`) — Online form and survey builder
- [ ] Paperform (`paperform`) — Online form and payment page builder
- [ ] Qualtrics (`qualtrics`) — Enterprise survey and experience management platform
- [ ] Retently (`retently`) — NPS and customer feedback surveys
- [ ] SurveySparrow (`surveysparrow`) — Conversational survey and feedback platform
- [ ] Survicate (`survicate`) — Customer feedback and NPS surveys
- [ ] Typebot (`typebot`) — Open-source conversational chatbot and form builder
- [ ] VideoAsk (`videoask`) — Interactive video forms by Typeform
- [ ] WPForms (`wpforms`) — Leading WordPress form builder plugin
- [ ] Zoho Forms (`zoho-forms`) — Form builder in Zoho suite

### docs-files-esign (20)

- [ ] Aspose Cloud (`aspose`) — Document conversion and processing APIs
- [ ] Carbone (`carbone`) — Template-based document and PDF generation API
- [ ] Docparser (`docparser`) — Extracts structured data from PDFs and documents
- [ ] DocuSeal (`docuseal`) — Open-source document e-signing platform
- [ ] DocuWare (`docuware`) — Enterprise document management and workflow (Ricoh)
- [ ] Egnyte (`egnyte`) — Enterprise cloud file sharing and governance
- [ ] Files.com (`files-com`) — Cloud file transfer/MFT automation platform
- [ ] GetAccept (`getaccept`) — Digital sales room and e-signature platform
- [ ] Dropbox Sign (`hellosign`) — E-signature platform, rebranded from HelloSign
- [ ] iLovePDF (`ilovepdf`) — PDF conversion and processing tools API
- [ ] Klippa (`klippa`) — OCR document processing and expense API
- [ ] pCloud (`pcloud`) — Cloud file storage (Switzerland-based, global)
- [ ] Plumsail Documents (`plumsail-documents`) — Document generation from templates API
- [ ] Qwilr (`qwilr`) — Interactive proposal and quote documents
- [ ] Scrive (`scrive`) — Nordic/European e-signature and identification platform, Sweden-based
- [ ] ShareFile (`sharefile`) — Progress (ex-Citrix) secure file sharing platform
- [ ] SignNow (`signnow`) — airSlate mainstream e-signature platform
- [ ] Zamzar (`zamzar`) — File conversion API service
- [ ] Zoho Sign (`zoho-sign`) — E-signature app in Zoho suite
- [ ] Zoho WorkDrive (`zoho-workdrive`) — Cloud file storage in Zoho suite

### payments-finance (19)

- [ ] Avalara AvaTax (`avalara-avatax`) — Sales tax calculation and compliance API
- [ ] Binance (`binance`) — World's largest cryptocurrency exchange
- [ ] Braintree (`braintree`) — PayPal-owned payment gateway
- [ ] Brex (`brex`) — Corporate cards and spend management
- [ ] Clover (`clover-pos`) — Fiserv's leading SMB point-of-sale platform
- [ ] CoinMarketCap (`coinmarketcap`) — Leading crypto market data API
- [ ] Coupa (`coupa`) — Enterprise procurement and spend management platform
- [ ] Donorbox (`donorbox`) — Nonprofit donation and fundraising platform
- [ ] Lemon Squeezy (`lemon-squeezy`) — Merchant of record for digital products; Stripe-owned
- [ ] Mangopay (`mangopay`) — European marketplace payment infrastructure
- [ ] Paystack (`paystack`) — Leading African payment gateway, Stripe-owned (Nigeria)
- [ ] Qonto (`qonto`) — European business banking neobank
- [ ] Recharge (`recharge`) — Subscription payments for Shopify merchants
- [ ] Recurly (`recurly`) — Subscription billing and revenue platform
- [ ] Solana (`solana`) — Solana blockchain JSON-RPC
- [ ] Splitwise (`splitwise`) — Shared expense splitting app
- [ ] Tremendous (`tremendous`) — Gift card and rewards payout platform
- [ ] YNAB (`ynab`) — Personal budgeting app with public API
- [ ] Zuora (`zuora`) — Enterprise subscription billing platform

### hr-recruiting (15)

- [ ] Bonusly (`bonusly`) — Employee recognition and rewards platform
- [ ] Bullhorn (`bullhorn-api`) — Staffing industry ATS/CRM standard
- [ ] Checkr (`checkr`) — Background check API platform
- [ ] Cornerstone OnDemand (`cornerstone`) — Enterprise learning and talent management
- [ ] Deputy (`deputy`) — Employee shift scheduling and workforce management
- [ ] Factorial (`factorial`) — HR management platform, Spanish unicorn
- [ ] HiBob (`hibob`) — Modern HRIS for mid-size companies
- [ ] Oracle Fusion Cloud HCM (`oracle-fusion-cloud-hcm`) — Enterprise HR and payroll cloud suite
- [ ] Paylocity (`paylocity`) — US payroll and HCM platform
- [ ] SAP SuccessFactors (`sap-successfactors`) — enterprise HCM and HR suite
- [ ] TestGorilla (`test-gorilla`) — Pre-employment skills testing platform
- [ ] Trainual (`trainual`) — Employee training, SOP and onboarding platform
- [ ] When I Work (`when-i-work`) — Employee shift scheduling and time clock
- [ ] Workday (`workday`) — Enterprise HCM and finance suite
- [ ] Zoho People (`zoho-people`) — HR management in Zoho suite

### accounting-invoicing (14)

- [ ] Deskera (`deskera`) — All-in-one SMB ERP: accounting, inventory, payroll
- [ ] Dext (`dext`) — Receipt/invoice capture for accountants (ex Receipt Bank)
- [ ] Exact Online (`exact-online`) — Dutch cloud ERP/accounting leader (Netherlands)
- [ ] Expensify (`expensify`) — Expense reports and corporate cards
- [ ] Fortnox (`fortnox`) — Dominant Swedish cloud accounting platform
- [ ] FreeAgent (`freeagent`) — UK accounting software for small businesses
- [ ] Invoiced (`invoiced`) — Accounts receivable automation (Flywire)
- [ ] lexware office (lexoffice) (`lexoffice`) — SMB accounting and invoicing, Germany
- [ ] Dynamics 365 Business Central (`microsoft-d365-bc`) — Microsoft SMB ERP and accounting
- [ ] Oracle Fusion Cloud ERP (`oracle-fusion-cloud-erp`) — Enterprise cloud ERP suite with REST APIs
- [ ] Peppol e-invoicing (`peppol-e-invoicing`) — EU e-invoicing network document exchange
- [ ] Wave (`wave`) — Free SMB accounting and invoicing software
- [ ] WHMCS (`whmcs`) — Web hosting billing and client management
- [ ] Zoho Invoice (`zoho-invoice`) — Invoicing app in Zoho suite

### helpdesk-support (12)

- [ ] Atera (`atera`) — All-in-one RMM/PSA for MSPs and IT
- [ ] Crisp (`crisp`) — Customer messaging and live chat platform
- [ ] Document360 (`document360`) — Knowledge base and documentation platform
- [ ] Groove (GrooveHQ) (`groove`) — Shared inbox helpdesk for small businesses
- [ ] HappyFox Help Desk (`happyfox-help-desk`) — Help desk ticketing software
- [ ] LiveAgent (`liveagent`) — Help desk and live chat software
- [ ] LiveChat (`livechat`) — Leading live chat and customer engagement platform
- [ ] Re:amaze (`reamaze`) — Helpdesk and live chat, GoDaddy-owned
- [ ] SolarWinds Service Desk (`solarwinds`) — ITSM platform, formerly Samanage
- [ ] tawk.to (`tawkto`) — Free live chat, very widely deployed
- [ ] Trengo (`trengo`) — Omnichannel customer conversation inbox
- [ ] Zoho SalesIQ (`zoho-salesiq`) — Live chat and visitor tracking in Zoho suite

### utility (12)

- [ ] ConvertAPI (`convertapi`) — File conversion REST API
- [ ] Foursquare (`foursquare`) — Location data and Places APIs
- [ ] Google Custom Search (`google-search`) — Programmable Search JSON API wrapper
- [ ] HERE (`here`) — Maps, geocoding and location APIs
- [ ] Lob (`lob`) — Direct mail and address verification API
- [ ] Loqate (`loqate`) — Global address verification and geocoding (GBG)
- [ ] Placid (`placid-app`) — Template-based image, PDF and video generation API
- [ ] PrintNode (`printnode`) — Cloud printing API to local printers
- [ ] Rebrandly (`rebrandly`) — Branded link shortening platform
- [ ] Smartcat (`smartcat`) — Translation management and linguist marketplace
- [ ] TeamViewer (`teamviewer`) — Remote access; API covers management functions
- [ ] Tinify (`tinify`) — TinyPNG image compression API

### media-video (12)

- [ ] Creatomate (`creatomate`) — API for automated video and image generation
- [ ] Frame.io (`frame-io`) — Adobe video review and collaboration platform
- [ ] Freepik (`freepik`) — Stock assets and AI image generation APIs
- [ ] GIPHY (`giphy`) — GIF search and media API
- [ ] Google Photos (`google-photos`) — Photo library API; 2025 scope restrictions
- [ ] JW Player (`jw-player`) — Online video hosting and streaming (JWP)
- [ ] Picsart (`picsart`) — Photo and design editing platform with creative APIs
- [ ] Pictory (`pictory`) — AI video creation from text and scripts
- [ ] Shotstack (`shotstack`) — Cloud video editing and rendering API
- [ ] SoundCloud (`soundcloud`) — Music hosting platform; API app access gated
- [ ] Unsplash (`unsplash`) — Free stock photography API
- [ ] Wistia (`wistia`) — B2B video hosting and marketing platform

### events-webinar (11)

- [ ] Airmeet (`airmeet`) — Virtual and hybrid events platform
- [ ] BigMarker (`bigmarker`) — Webinar and virtual event platform
- [ ] ClickMeeting (`clickmeeting`) — Webinar and online meeting platform
- [ ] EverWebinar (`everwebinar`) — Automated evergreen webinar platform
- [ ] Humanitix (`humanitix`) — Nonprofit event ticketing platform, Australia-origin
- [ ] Livestorm (`livestorm`) — Webinar and virtual event platform
- [ ] Meetup (`meetup`) — Event and community meetup platform
- [ ] Swapcard (`swapcard`) — Event and community engagement platform
- [ ] Swoogo (`swoogo`) — Event management and registration software
- [ ] Ticket Tailor (`ticket-tailor`) — Independent event ticketing platform
- [ ] WebinarJam (`webinarjam`) — Webinar hosting platform by Genesis Digital

### sms-messaging (11)

- [ ] Clickatell (`clickatell`) — Global SMS and WhatsApp messaging platform
- [ ] GREEN-API (`green-api`) — Unofficial WhatsApp gateway API
- [ ] Infobip (`infobip`) — Global omnichannel CPaaS: SMS, WhatsApp, voice
- [ ] Kaleyra (`kaleyra`) — CPaaS messaging; now part of Tata Communications
- [ ] Sakari (`sakari-sms`) — business SMS messaging platform
- [ ] Salesmsg (`salesmsg`) — two-way business texting and calling
- [ ] SimpleTexting (`simpletexting`) — US SMS marketing platform
- [ ] SlickText (`slicktext`) — US SMS marketing platform
- [ ] SlickText (`slicktext-v2`) — Duplicate v2 Make app for SlickText
- [ ] Telnyx (`telnyx`) — CPaaS for SMS, voice, wireless
- [ ] TextMagic (`textmagic`) — Established business SMS service

### social (11)

- [ ] ContentStudio (`content-studio`) — Social media management and scheduling
- [ ] Flickr (`flickr`) — Photo hosting and sharing, SmugMug-owned
- [ ] Hootsuite (`hootsuite`) — Social media management and scheduling
- [ ] Mastodon (`mastodon`) — Decentralized open-source social network
- [ ] Metricool (`metricool`) — Social media scheduling and analytics
- [ ] Patreon (`patreon`) — Creator membership and monetization platform
- [ ] Product Hunt (`product-hunt`) — Tech product launch community with GraphQL API
- [ ] SocialBee (`socialbee`) — Social media scheduling and management
- [ ] Tumblr (`tumblr`) — Microblogging and social publishing platform
- [ ] Vista Social (`vista-social`) — Social media management and scheduling platform
- [ ] Yelp (`yelp`) — Local business reviews and search API

### data-db (10)

- [ ] Amazon Redshift (`aws-redshift`) — AWS cloud data warehouse
- [ ] Caspio (`caspio`) — Low-code online database application builder
- [ ] Diffbot (`diffbot`) — Web scraping and knowledge graph extraction APIs
- [ ] Keboola (`keboola`) — Data operations and ETL platform
- [ ] Kintone (`kintone`) — Cybozu no-code business app/database platform
- [ ] Knack (`knack`) — No-code online database app builder
- [ ] Ninox (`ninox`) — Low-code database platform
- [ ] People Data Labs (`people-data-labs`) — B2B person and company enrichment data API
- [ ] Wasabi (`wasabi`) — S3-compatible hot cloud object storage
- [ ] Xata (`xata`) — Serverless Postgres data platform

### analytics-bi (9)

- [ ] Anaplan (`anaplan`) — Enterprise planning and FP&A platform
- [ ] CallRail (`callrail`) — Call tracking and marketing attribution
- [ ] ChartMogul (`chartmogul`) — Subscription revenue analytics platform
- [ ] Databox (`databox`) — KPI dashboards aggregating business data sources
- [ ] Geckoboard (`geckoboard`) — KPI dashboard software with datasets API
- [ ] RudderStack (`rudderstack`) — open-source customer data pipeline (CDP)
- [ ] Tableau (`tableau`) — Salesforce-owned market-leading BI platform
- [ ] Voluum (`voluum`) — Performance and affiliate ad tracking platform
- [ ] WhatConverts (`whatconverts`) — Lead and call tracking attribution platform

### security (9)

- [ ] Auth0 (`auth0`) — Developer identity and authentication platform (Okta)
- [ ] AWS KMS (`aws-kms`) — AWS key management, encrypt/decrypt/sign
- [ ] Bitwarden (`bitwarden`) — Open-source password manager, organization API
- [ ] Microsoft Intune (`intunes`) — Microsoft device and endpoint management via Graph
- [ ] IPQualityScore (`ipqualityscore`) — Fraud scoring and email/IP reputation API
- [ ] KnowBe4 (`knowbe4`) — Security awareness training platform
- [ ] LastPass (`lastpass`) — Password manager; enterprise provisioning API only
- [ ] Cisco Meraki (`meraki`) — Cloud-managed networking dashboard API
- [ ] Twilio Verify (`twilio-verify`) — OTP and 2FA phone verification API

### vertical-other (9)

- [ ] SafetyCulture (`iauditor`) — Inspections and safety audits; rebranded from iAuditor
- [ ] Katana (`katana-mrp`) — Cloud manufacturing and inventory management
- [ ] MaintainX (`maintainx`) — Work order and maintenance management (CMMS)
- [ ] SAP S/4HANA (`sap-s4hana`) — SAP flagship enterprise ERP
- [ ] ServiceTitan (`service-titan`) — leading field-service management for trades
- [ ] ServiceM8 (`servicem8`) — field service app for small trades
- [ ] Snappy (`snappy`) — Corporate gifting platform
- [ ] Steam (`steam`) — Valve gaming platform with Web API for player/game data
- [ ] Wild Apricot (`wild-apricot`) — Membership management for associations and nonprofits

### cms-website (8)

- [ ] Blogger (`blogger`) — Google's legacy blogging platform
- [ ] Drupal (`drupal`) — Major open-source CMS with JSON:API
- [ ] Elementor (`elementor`) — Leading WordPress website builder, form lead capture
- [ ] GoDaddy (`godaddy`) — Domain registrar and hosting with domains API
- [ ] Joomla (`joomla`) — Open-source website CMS
- [ ] Memberstack (`memberstack`) — Membership and auth for no-code websites
- [ ] Softr (`softr`) — No-code app builder on Airtable and databases
- [ ] Tilda (`tilda`) — Popular website builder; limited API plus webhooks

### logistics-shipping (7)

- [ ] AfterShip (`aftership`) — Shipment tracking across 1000+ carriers
- [ ] Sendcloud (`sendcloud`) — European shipping automation platform, Netherlands-based
- [ ] Sendle (`sendle`) — carrier-neutral small-business shipping, Australia and US
- [ ] Ship24 (`ship24`) — Multi-carrier package tracking API
- [ ] Shipday (`shipday`) — Local delivery dispatch for restaurants
- [ ] ShipHero (`shiphero`) — Warehouse management and fulfillment platform
- [ ] Tookan (`tookan`) — Delivery management and last-mile logistics by Jungleworks

### education (7)

- [ ] Canvas LMS (`canvas-lms`) — Leading learning management system by Instructure
- [ ] LearnWorlds (`learnworlds`) — Online course creation platform
- [ ] Moodle (`moodle`) — Leading open-source learning management system
- [ ] Skool (`skool`) — Community and courses platform for creators
- [ ] TalentLMS (`talentlms`) — Popular corporate learning management system
- [ ] Teachable (`teachable`) — Mainstream online course platform
- [ ] Thinkific (`thinkific`) — Mainstream online course platform

### scheduling-calendar (5)

- [ ] Motion (`motion`) — AI calendar, task and project scheduling
- [ ] Reclaim.ai (`reclaim-ai`) — AI calendar scheduling assistant, Dropbox-owned
- [ ] OnceHub (ScheduleOnce) (`scheduleonce`) — scheduling platform, rebranded to OnceHub
- [ ] SimplyBook.me (`simplybook`) — Appointment booking system
- [ ] YouCanBookMe (`youcanbookme`) — Booking pages scheduling tool

### legal (2)

- [ ] Clio Manage (`clio-manage`) — Leading legal practice management software
- [ ] PracticePanther (`practicepanther`) — Legal practice management software

### iot-devices (2)

- [ ] Smartcar (`smartcar`) — Connected-car API platform
- [ ] Samsung SmartThings (`smartthings`) — Samsung smart home cloud platform

### real-estate (1)

- [ ] Follow Up Boss (`follow-up-boss`) — Real estate CRM and lead management

### travel-hospitality (1)

- [ ] Navan (`navan`) — Corporate travel and expense, formerly TripActions

---

## Tier 3 — 1,640 long-tail apps (not itemized here)

Regional players, narrow verticals, and tiny utilities. Full list with classifications in
`docs/make-catalog-classified.tsv` (disposition `T3`) — mine it if a customer asks for something specific.

| Category | Count | | Category | Count |
| --- | --- | --- | --- | --- |
| utility | 172 | | media-video | 33 |
| ai | 150 | | education | 29 |
| marketing | 144 | | scheduling-calendar | 28 |
| communication | 99 | | hr-recruiting | 26 |
| sms-messaging | 80 | | logistics-shipping | 25 |
| vertical-other | 75 | | cms-website | 23 |
| crm | 74 | | social | 23 |
| docs-files-esign | 66 | | analytics-bi | 20 |
| project-management | 65 | | events-webinar | 17 |
| email | 62 | | helpdesk-support | 15 |
| accounting-invoicing | 58 | | iot-devices | 15 |
| productivity | 55 | | security | 13 |
| payments-finance | 54 | | travel-hospitality | 12 |
| dev-tools | 51 | | real-estate | 11 |
| ecommerce | 49 | | legal | 6 |
| forms-surveys | 49 | | healthcare | 2 |
| data-db | 39 | |  |  |

---

## Excluded from the gap count

### Dead or discontinued (27)

- Alexa Internet (`alexa-internet`) — Website ranking service; shut down 2022
- atSpoke (`atspoke`) — Internal ticketing; acquired by Okta, shut down
- Automizy (`automizy`) — Email marketing; acquired by Brevo, discontinued
- Axosoft (`axosoft`) — Agile scrum PM tool, sunset by GitKraken
- Bing Spell Check (`bing-spell-check`) — Retired Microsoft Cognitive spell-check API
- Boost Hub (`boost-hub`) — BoostIO collaborative docs; service discontinued
- EET (`eet`) — Czech electronic sales registration, abolished 2023 (Czech Republic)
- Fauna (`fauna`) — Serverless database; cloud service shut down 2025
- Freshping (`freshping`) — Freshworks uptime monitoring; discontinued
- Google+ (`google-plus`) — Social network shut down in 2019
- IEX Cloud (`iex-cloud`) — Financial market data API; shut down 2024
- Interseller (`interseller`) — Outreach tool folded into Greenhouse; standalone retired
- LevelUp Demo (`levelup-demo`) — Make demo/training app, not a real product
- Magic Meal Kits (`magic-meal-kits`) — Make Academy training demo app, not real product
- MonkeyLearn (`monkeylearn`) — Text-analysis ML API, sunset after Medallia acquisition
- OneSaas (`onesaas`) — Integration platform; acquired by Intuit, discontinued
- Orbit (`orbit`) — Community growth platform; shut down after Postman acquisition
- PeerBoard (`peerboard`) — Embeddable community platform; shut down 2024
- Pivotal Tracker (`pivotal-tracker`) — Agile project tracker; discontinued by Broadcom 2025
- Pocket (`pocket`) — Read-it-later service; Mozilla shut it down 2025
- Runkeeper (`runkeeper`) — ASICS fitness tracking app; public API discontinued
- SignRequest (`signrequest`) — E-signature; sunset and absorbed into Box Sign
- Skype (`skype`) — Microsoft retired Skype in May 2025
- SpaceX API (`space-x`) — Unofficial SpaceX data API, unmaintained since 2022
- Twilio Autopilot (`twilio-autopilot`) — Twilio conversational bot builder; retired 2023
- Wootric (`wootric`) — NPS surveys; folded into InMoment, standalone discontinued
- WP Webhooks (`wp-webhooks`) — WordPress webhooks plugin; merged into SureTriggers/OttoKit

### Infeasible for the HTTP runtime, or Make-internal (18)

- Make AI Agents (`ai-agent`) — Make-native AI agents platform feature
- Make AI Local Agent (`ai-local-agent`) — Make agent running on user's local machine
- Android (Make app) (`android`) — Push/device integration via Make mobile app
- Buffer (`buffer`) — Social scheduler; public API closed to new apps
- Google Chrome (`chrome`) — Browser extension trigger; not a cloud API
- Citibank (`citibank`) — US bank; open API gated to approved partners
- Forms for Make (`forms-for-make---the-forms-for-ai`) — Forms companion built specifically for Make platform
- HTTP Agent (Make) (`http-agent`) — Make enterprise on-premises HTTP agent module
- iOS (Make app) (`ios`) — Make mobile companion app for iOS devices
- MoreLogin (`morelogin`) — Anti-detect browser with localhost-only API
- RabbitMQ (`rabbitmq`) — Message broker; AMQP persistent consumers unfit HTTP runtime
- Apple Safari (`safari`) — browser; Make-internal push channel, no standalone server API
- Sage 50 Accounts (HyperExt) (`sage-50-accounts-hyperext`) — desktop accounting bridged via HyperExt local connector
- SAP ECC Agent (`sap-agent`) — SAP ECC via Make on-premises agent, Enterprise-only
- Scenarios (Make) (`scenario-service`) — Make-internal subscenario orchestration app; platform-specific
- Apple Shortcuts (`shortcuts`) — Apple device automation; no server-side public API
- SSH (`ssh`) — Generic SSH remote command module; persistent-socket protocol
- UniFi Access (`unifi-access`) — Ubiquiti door access control; controller API is local-network

### Already covered by an existing service under another name (12)

- `dataforseo-keywords-data-api` → `services/dataforseo`
- `dataforseo-labs-api` → `services/dataforseo`
- `dataforseo-serp-api` → `services/dataforseo`
- `digitalocean-spaces` → `services/s3`
- `facebook-insights` → `services/facebook`
- `facebook-pages` → `services/facebook`
- `mailerlite2` → `services/mailerlite`
- `vertex` → `services/google-vertex-ai`
- `weather` → `services/openweathermap`
- `xero-projects` → `services/xero`
- `zendesk-guide` → `services/zendesk`
- `zoom-user` → `services/zoom`

### Make platform built-ins (22) — FlowRunner platform features, not services

`ai-tools`, `archive`, `barcode`, `csv`, `datastore`, `email`, `ftp`, `gateway`, `http`, `image`, `json`, `make`, `make-ai-extractors`, `make-ai-web-search`, `make-forms`, `make-nodes-late`, `markdown`, `math`, `regexp`, `rss`, `util`, `xml`

(Make's built-in `email`/SMTP app maps to `services/mailbox`; `ftp` has no FlowRunner equivalent —
the `sftp` Tier-1 spike in MW12 covers that ground.)

### Make community-built apps (536) — tracked, not classified

Third-party community apps of very mixed quality; slugs in `docs/make-catalog-classified.tsv`
(disposition `community`). Demand signal: Make users get affinity, billcom, halopsa, posthog, shipbob, uplead only as community
apps — all six are first-party FlowRunner services.

## FlowRunner exclusives — 75 services with no verified Make app

`acumatica`, `affinity`, `ai-image-generator`, `ai-vision`, `aws-acm`, `aws-cognito`, `aws-comprehend`, `aws-elb`, `aws-iam`, `aws-textract`, `aws-transcribe`, `azure-ai-search`, `azure-blob-storage`, `azure-cosmos-db`, `azure-table-storage`, `billcom`, `brandfetch`, `chroma`, `circleci`, `cockpit`, `coingecko`, `cortex`, `cratedb`, `databricks`, `dynamodb-service`, `erpnext`, `filemaker`, `formio`, `google-books`, `gotify`, `grafana`, `hackernews`, `halopsa`, `kobotoolbox`, `ldap`, `leafy-plant`, `lingvanex`, `marketstack`, `medium`, `milvus`, `misp`, `monica`, `ms-graph-security`, `msg91`, `ollama`, `openthesaurus`, `oracle-database`, `oura`, `peekalink`, `pgvector`, `philips-hue`, `posthog`, `questdb`, `ramp-service`, `redis`, `rundeck`, `sap-business-one`, `securityscorecard`, `shipbob`, `splunk`, `sqs-service`, `storyblok`, `strapi`, `taiga`, `thehive`, `timescaledb`, `travis-ci`, `turbodocx-service`, `uplead`, `uptimerobot`, `urlscan`, `weaviate`, `wekan`, `wiza`, `x-twitter`

