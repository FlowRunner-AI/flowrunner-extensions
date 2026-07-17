# Firecrawl FlowRunner Extension

FlowRunner integration for [Firecrawl](https://www.firecrawl.dev) — the web data API that turns any website into clean, LLM-ready Markdown or structured data. Covers the full Firecrawl v2 API: scraping, batch scraping, crawling, URL mapping, web search, and LLM-powered structured extraction, plus account credit/token usage. Authenticated with your Firecrawl API key.

## Ideal Use Cases

- Convert any web page or PDF into clean Markdown or an LLM summary for RAG and agent context
- Crawl an entire site or section and extract structured data with a prompt or JSON Schema
- Discover a site's URLs fast (map) to plan targeted scrapes before running a full crawl
- Search the web and scrape the top results' full content in a single call
- Monitor Firecrawl credit and token consumption before running large jobs

## List of Actions

### Scraping
- Scrape URL

### Batch Scraping
- Start Batch Scrape
- Get Batch Scrape Status
- Batch Scrape and Wait

### Crawling
- Start Crawl
- Get Crawl Status
- Crawl and Wait
- Cancel Crawl
- Get Crawl Errors
- Get Active Crawls

### Mapping
- Map Website

### Search
- Search Web

### Extraction
- Start Extract
- Get Extract Status
- Extract and Wait

### Account
- Get Credit Usage
- Get Token Usage

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| API Key | Yes | Your Firecrawl API key (starts with `fc-`). Get it at https://www.firecrawl.dev/app/api-keys |

## Notes

- Large crawl/batch results are chunked by the API (~10MB per page); the "and Wait" actions follow up to 5 chunks automatically and return `next` if more data remains.
- A dictionary of active crawls powers job-id selection in Get Crawl Status, Cancel Crawl, and Get Crawl Errors.

## Agent Ideas

- Use **Firecrawl** "Extract and Wait" with a JSON Schema to pull structured lead or pricing data from a list of URLs, then call **Google Sheets** "Add Rows" to append each extracted record into a tracking spreadsheet.
- After a **Firecrawl** "Crawl and Wait" job scrapes a documentation site, use **Notion** "Create Page" to publish each page's clean Markdown into a knowledge base.
- Use **Firecrawl** "Search Web" to gather and scrape the top results on a topic, then post a **Slack** "Send Message To Channel" summary with the key findings and source links.
