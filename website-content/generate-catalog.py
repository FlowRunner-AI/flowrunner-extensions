#!/usr/bin/env python3
"""
Generate structured marketing catalog data for every FlowRunner integration.

Reads each services/<slug>/src/index.js (JSDoc annotations) + README.md and emits:
  website-content/integrations/<slug>.json   -- one structured record per service
  website-content/integrations-index.json    -- summary array + category/stat rollups

Re-run any time services are added:  python3 website-content/generate-catalog.py
Deterministic; no network; no dependencies beyond the Python stdlib.
"""
import json, os, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICES = os.path.join(ROOT, "services")
OUT = os.path.join(ROOT, "website-content")
OUT_INT = os.path.join(OUT, "integrations")
GAP = os.path.join(ROOT, "docs", "n8n-gap-analysis.md")

# @registerAs values that are NOT user-facing actions
NON_ACTION = {"SYSTEM", "DICTIONARY", "SAMPLE_RESULT_LOADER", "PARAM_SCHEMA_DEFINITION"}
TRIGGER_KINDS = {"POLLING_TRIGGER", "REALTIME_TRIGGER"}

BLOCK_RE = re.compile(r"/\*\*(.*?)\*/", re.DOTALL)


def clean_multiline(text):
    lines = [re.sub(r"^\s*\*\s?", "", ln) for ln in text.split("\n")]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


def first(pattern, text):
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def parse_index(src):
    name = first(r"@integrationName[ \t]+(.+)", src)
    if name:
        name = name.strip().strip('"').strip("'").strip()
    icon = first(r"@integrationIcon[ \t]+(\S+)", src)
    actions, triggers, op_categories = [], [], []
    for block in BLOCK_RE.findall(src):
        if "@operationName" not in block:
            continue
        op = first(r"@operationName[ \t]+(.+)", block)
        if not op:
            continue
        op = op.strip()
        cat = first(r"@category[ \t]+(.+)", block)
        cat = cat.strip() if cat else None
        reg = first(r"@registerAs[ \t]+(\S+)", block)
        dm = re.search(r"@description[ \t]+(.*?)(?:\n\s*\*\s*@|\Z)", block, re.DOTALL)
        desc = clean_multiline(dm.group(1)) if dm else None
        rec = {"name": op, "category": cat, "description": desc}
        if reg in TRIGGER_KINDS:
            triggers.append(rec)
        elif reg in NON_ACTION:
            continue
        else:
            actions.append(rec)
            if cat:
                op_categories.append(cat)
    # dedupe operation categories preserving order
    seen = set()
    op_cats = [c for c in op_categories if not (c in seen or seen.add(c))]
    return {
        "name": name,
        "icon": icon,
        "requiresOAuth": "@requireOAuth" in src,
        "usesFileStorage": "@usesFileStorage" in src,
        "triggerScope": first(r"@integrationTriggersScope[ \t]+(\S+)", src),
        "actions": actions,
        "triggers": triggers,
        "operationCategories": op_cats,
        "selfHostedCapable": bool(
            re.search(r"\b(serverUrl|baseUrl|instanceUrl|siteUrl|resourceUrl|workspaceUrl|homeserverUrl|bridgeIp)\b", src)
        ),
    }


def read_readme(path):
    if not os.path.exists(path):
        return {}
    text = open(path, encoding="utf-8").read()
    lines = text.split("\n")

    # short description = first paragraph after the H1
    short = None
    i = 0
    while i < len(lines) and not lines[i].startswith("# "):
        i += 1
    i += 1
    while i < len(lines) and not lines[i].strip():
        i += 1
    para = []
    while i < len(lines) and lines[i].strip() and not lines[i].startswith("#"):
        para.append(lines[i].strip())
        i += 1
    if para:
        short = re.sub(r"\s+", " ", " ".join(para)).strip()

    def section_bullets(title):
        pat = re.compile(r"^#{2,3}\s+" + re.escape(title) + r"\s*$", re.IGNORECASE)
        out, capture = [], False
        for ln in lines:
            if pat.match(ln.strip()):
                capture = True
                continue
            if capture and re.match(r"^#{1,3}\s", ln):
                break
            if capture:
                m = re.match(r"^\s*[-*]\s+(.*)", ln)
                if m:
                    out.append(m.group(1).strip())
        return out

    triggers_txt = " ".join(section_bullets("List of Triggers")).lower()
    return {
        "shortDescription": short,
        "idealUseCases": section_bullets("Ideal Use Cases"),
        "agentIdeas": section_bullets("Agent Ideas"),
        "readmeTriggerBullets": []
        if "does not define any trigger" in triggers_txt or "no triggers" in triggers_txt
        else section_bullets("List of Triggers"),
    }


# ---------------------------------------------------------------------------
# Canonical public taxonomy. Order matters: more specific buckets first.
# Each service lands in exactly one bucket via keyword match on slug + name +
# operation categories + short description. The website writer can re-bucket
# any edge cases; this gives a clean, consistent starting taxonomy.
# ---------------------------------------------------------------------------
KEYWORD_CATEGORY = [
    # Vendor-priority overrides: explicit slugs whose op categories would
    # otherwise match a generic keyword in a wrong bucket further down.
    (r"\bmixpanel\b|power-bi", "Analytics & Data"),
    (r"\bresend\b|manychat|trustpilot", "Marketing & Email"),
    (r"onesignal", "SMS, Voice & Push"),
    (r"zoho-desk", "Helpdesk & ITSM"),
    (r"azure-devops", "Dev Tools & Observability"),
    (r"kajabi", "CMS & Content"),
    (r"facebook-messenger", "Chat & Messaging"),
    (r"\bcanva\b|bluesky|twitch|vimeo", "Social & Media Generation"),
    (r"\betsy\b|printful|amazon-seller-central", "E-commerce"),
    (r"cloudinary", "Storage & Files"),
    (r"cloudconvert", "Utilities & Personal"),
    (r"onenote|planner", "Productivity & PM"),
    (r"google-meet|\btally\b", "Forms, Scheduling & Events"),
    (r"google-maps", "Utilities & Personal"),
    (r"pinecone|qdrant|weaviate|chroma|milvus|pgvector|\bzep\b|azure-ai-search", "Vector Stores & AI Infra"),
    (r"openai|openrouter|\bjina\b|anthropic|claude|gemini|\bgpt\b|mistral|groq|cohere|huggingface|deepseek|perplexity|\bxai\b|grok|ollama|azure-openai|replicate|stability|elevenlabs|assembly|deepgram|ai-vision|vertex-ai|bedrock|rekognition|textract|comprehend|transcribe|\bdeepl\b|mindee|natural-language|perspective|lingvanex|google-translate|parseur|airtop|leafy-plant|fireflies|firecrawl|tavily|heygen|\brunway\b|\bvapi\b|\bqwen\b|\bnlp\b|\bllm\b|\bai-", "AI & LLMs"),
    (r"postgres|mysql|mongo|redis|oracle|cratedb|questdb|cassandra|couchbase|dynamodb|cosmos|table-storage|timescale|elasticsearch|snowflake|bigquery|databricks|supabase|firestore|realtime-database|baserow|nocodb|seatable|grist|stackby|quickbase|filemaker|\bsql\b", "Databases & Warehouses"),
    (r"hubspot|salesforce|pipedrive|zoho|copper|keap|close-crm|salesmate|affinity|outreach|salesloft|apollo|\bgong\b|drift|mautic|agile-crm|freshworks-crm|monica|marketo|google-contacts|\bcrm\b", "CRM & Sales"),
    (r"sales-?intelligence|clearbit|hunter|dropcontact|uplead|phantombuster|apollo|enrichment|lusha|brandfetch", "Sales Intelligence & Enrichment"),
    (r"gmail|outlook|sendgrid|mailgun|mailchimp|mailerlite|mailer-?send|postmark|mailjet|sendy|mandrill|brevo|sendinblue|\bkit\b|convertkit|activecampaign|customerio|getresponse|iterable|lemlist|ortto|tapfiliate|klaviyo|constantcontact|\bvero\b|emelia|mailbox|ses-service|amazon-ses|newsletter|campaign|\bemail\b", "Marketing & Email"),
    (r"twilio|vonage|messagebird|plivo|mocean|msg91|nexmo|clicksend|telnyx|bandwidth|pushover|pushbullet|pushcut|signl4|gotify|\bsms\b|\bvoice\b|\bpush\b", "SMS, Voice & Push"),
    (r"slack|discord|teams|google-chat|telegram|mattermost|rocket|webex|\bline\b|matrix|zulip|twist|whatsapp", "Chat & Messaging"),
    (r"zendesk|freshdesk|freshservice|helpscout|help-scout|intercom|gorgias|zammad|servicenow|halopsa|syncro|kayako|\bfront\b|liveagent|helpdesk|\bitsm\b", "Helpdesk & ITSM"),
    (r"github|gitlab|bitbucket|jenkins|circleci|travis|sentry|posthog|cloudflare|netlify|vercel|datadog|grafana|metabase|splunk|uptimerobot|rundeck|pagerduty|opsgenie|sonar|bugsnag|rollbar", "Dev Tools & Observability"),
    (r"okta|entra|\bldap\b|auth0|workspace-admin|onelogin|jumpcloud|thehive|cortex|misp|urlscan|securityscorecard|graph-security|bitwarden|1password|vault|cognito|\biam\b|\bacm\b|identity|security", "Identity & Security"),
    (r"\bs3\b|blob-storage|google-drive|dropbox|\bbox\b|onedrive|nextcloud|sharepoint|cloud-storage|filestack|uploadcare|\bftp\b|\bfiles\b|\bstorage\b", "Storage & Files"),
    (r"stripe|paypal|chargebee|paddle|wise|\bsquare\b|quickbooks|xero|sage-intacct|\bsage\b|braintree|razorpay|mollie|plaid|gocardless|profitwell|recurly|\bbill\b|invoice-ninja|\bramp\b|payment|billing", "Payments & Finance"),
    (r"shopify|woocommerce|magento|bigcommerce|gumroad|prestashop|squarespace|etsy|ecwid|snipcart|commerce", "E-commerce"),
    (r"odoo|erpnext|netsuite|\bsap\b|acumatica|dynamics-365|unleashed|onfleet|shippo|easypost|easyship|\bdhl\b|shipstation|\berp\b|inventory|shipping", "ERP & Operations"),
    (r"workable|greenhouse|lever|bamboohr|personio|recruit|\bats\b|applicant|kobotoolbox|action-network", "HR & Recruiting"),
    (r"notion|airtable|coda|clickup|asana|trello|monday|todoist|wekan|taiga|basecamp|smartsheet|wrike|shortcut|linear|\bjira\b|confluence|evernote|google-tasks|microsoft-todo|google-sheets|microsoft-excel|\bexcel\b|harvest|toggl|clockify|time-track", "Productivity & PM"),
    (r"typeform|jotform|google-forms|wufoo|formstack|surveymonkey|calendly|cal-com|acuity|\bzoom\b|webinar|demio|gotowebinar|eventbrite|savvycal|scheduling|\bform\b|\bsurvey\b|calendar", "Forms, Scheduling & Events"),
    (r"docusign|turbodocx|pandadoc|hellosign|dropbox-sign|adobe-sign|google-docs|google-slides|e-?sign|\bpdf\b", "Documents & E-signature"),
    (r"contentful|strapi|ghost|wordpress|storyblok|cockpit|webflow|sanity|prismic|directus|hygraph|butter|\bmedium\b|\bcms\b", "CMS & Content"),
    (r"twitter|facebook|linkedin|instagram|reddit|bluesky|mastodon|youtube|tiktok|pinterest|buffer|hootsuite|disqus|discourse|bannerbear|apitemplate|quickchart|\bmedia\b|\bsocial\b", "Social & Media Generation"),
    (r"mixpanel|amplitude|segment|\bga4\b|google-analytics|matomo|\bheap\b|marketstack|coingecko|\bnasa\b|openweather|hacker-?news|google-books|openthesaurus|dataforseo|analytics", "Analytics & Data"),
    (r"raindrop|bookmark|pocket|instapaper|beeminder|oura|strava|spotify|peekalink|one-simple-api|\byourls\b|\bnpm\b|bitly|\butility\b", "Utilities & Personal"),
    (r"\baws\b|azure|google-cloud|\bgcp\b|lambda|\bsqs\b|\bsns\b|\bec2\b|\belb\b|home-assistant|philips-hue|bubble|adalo|retool|infrastructure", "Cloud & Infrastructure"),
]


def keyword_category(slug, name, ops):
    # Classify on structured, vendor-specific signals only (slug + display name +
    # operation categories). Descriptions / use-cases name OTHER vendors ("sync to
    # HubSpot", "push to your CRM") and would cause massive false positives.
    hay = " ".join([slug, name or "", " ".join(ops)]).lower()
    for pat, cat in KEYWORD_CATEGORY:
        if re.search(pat, hay):
            return cat
    return "Other"


def main():
    os.makedirs(OUT_INT, exist_ok=True)

    index, cat_counts = [], {}
    total_actions = total_triggers = oauth_count = 0

    for d in sorted(glob.glob(os.path.join(SERVICES, "*/"))):
        slug = os.path.basename(d.rstrip("/"))
        src_path = os.path.join(d, "src", "index.js")
        if not os.path.exists(src_path):
            continue
        idx = parse_index(open(src_path, encoding="utf-8").read())
        rm = read_readme(os.path.join(d, "README.md"))
        name = idx["name"] or slug.replace("-", " ").title()

        marketing_cat = keyword_category(slug, name, idx["operationCategories"])
        cat_src = "keyword" if marketing_cat != "Other" else "uncategorized"

        icon = idx["icon"]
        icon_file = (
            os.path.join("services", slug, "public", icon.lstrip("/")) if icon else None
        )

        rec = {
            "slug": slug,
            "name": name,
            "marketingCategory": marketing_cat,
            "categorySource": cat_src,
            "auth": "OAuth2" if idx["requiresOAuth"] else "API Key / Token",
            "requiresOAuth": idx["requiresOAuth"],
            "selfHostedCapable": idx["selfHostedCapable"],
            "usesFileStorage": idx["usesFileStorage"],
            "shortDescription": rm.get("shortDescription"),
            "actionCount": len(idx["actions"]),
            "triggerCount": len(idx["triggers"]),
            "operationCategories": idx["operationCategories"],
            "actions": idx["actions"],
            "triggers": [t["name"] for t in idx["triggers"]] or rm.get("readmeTriggerBullets", []),
            "idealUseCases": rm.get("idealUseCases", []),
            "agentIdeas": rm.get("agentIdeas", []),
            "icon": icon,
            "iconFile": icon_file,
            "sourcePaths": {
                "service": f"services/{slug}",
                "readme": f"services/{slug}/README.md",
                "index": f"services/{slug}/src/index.js",
            },
        }
        with open(os.path.join(OUT_INT, f"{slug}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, indent=2, ensure_ascii=False)

        total_actions += rec["actionCount"]
        total_triggers += rec["triggerCount"]
        oauth_count += 1 if rec["requiresOAuth"] else 0
        cat_counts[marketing_cat] = cat_counts.get(marketing_cat, 0) + 1
        index.append(
            {
                "slug": slug,
                "name": name,
                "marketingCategory": marketing_cat,
                "auth": rec["auth"],
                "actionCount": rec["actionCount"],
                "triggerCount": rec["triggerCount"],
                "hasTriggers": rec["triggerCount"] > 0,
                "selfHostedCapable": rec["selfHostedCapable"],
                "shortDescription": rec["shortDescription"],
                "icon": icon,
                "iconFile": icon_file,
            }
        )

    summary = {
        "totalIntegrations": len(index),
        "totalActions": total_actions,
        "totalTriggers": total_triggers,
        "oauthServices": oauth_count,
        "triggerEnabledServices": sum(1 for r in index if r["hasTriggers"]),
        "selfHostedServices": sum(1 for r in index if r["selfHostedCapable"]),
        "categories": dict(sorted(cat_counts.items(), key=lambda kv: -kv[1])),
        "integrations": sorted(index, key=lambda r: r["name"].lower()),
    }
    with open(os.path.join(OUT, "integrations-index.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"integrations: {len(index)}")
    print(f"total actions: {total_actions}  total triggers: {total_triggers}  oauth: {oauth_count}")
    print(f"categories ({len(cat_counts)}):")
    for c, n in sorted(cat_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {n:3d}  {c}")


if __name__ == "__main__":
    main()
