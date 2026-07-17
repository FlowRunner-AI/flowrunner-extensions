# Tavily FlowRunner Extension

Tavily is the web access layer for AI agents. This extension provides AI-optimized web search, page content extraction, website crawling and mapping, an asynchronous deep-research agent that produces cited reports, and API usage monitoring, all via the Tavily API (`https://api.tavily.com`). Authentication uses a Tavily API key (starts with `tvly-`).

## Ideal Use Cases

- Give an AI agent live, ranked web search results with relevance scores and content snippets instead of stale training data
- Extract clean markdown or text from a batch of URLs for LLM consumption
- Crawl or map documentation sites, knowledge bases, and blogs to ingest their content into a workflow
- Run a deep-research agent that plans, searches, and synthesizes a cited report on a complex question
- Monitor credit consumption to gate expensive operations in a flow

## List of Actions

### Search
- Search

### Extraction
- Extract Content

### Crawling
- Crawl Website
- Map Website

### Research
- Start Research
- Get Research Results

### Account
- Get API Usage

## List of Triggers

This service does not define any triggers.

## Configuration

| Item | Required | Description |
| --- | --- | --- |
| API Key | Yes | Your Tavily API key (starts with `tvly-`), from https://app.tavily.com under API Keys |

## Notes

- **Start Research** is asynchronous: it returns immediately with a request ID and a pending status. Poll **Get Research Results** until the status is `completed` to retrieve the cited report (a markdown string, or a JSON object when an output schema is provided). Mini tasks finish in under a minute; Pro tasks can take several minutes.
- Costs are billed in credits per endpoint (search, extract, crawl, map, research). Advanced extraction depth, crawl/map instructions, and larger result sets increase credit usage.

## Agent Ideas

- Use **Search** to gather current web results on a topic, then call **Notion** "Create Page" to save the ranked findings and source links into a research database
- Run **Start Research** followed by **Get Research Results** to produce a cited report, then use **Google Docs** "Create Document" to publish the finished markdown report as a shareable doc
- After a **Map Website** call discovers a site's pages, feed them into **Extract Content** and log each page's summary to **Airtable** via "Create Record" for a searchable content index
- When a **Crawl Website** run finishes ingesting a documentation site, post a completion summary with key links to a team channel using **Slack** "Send Message To Channel"
