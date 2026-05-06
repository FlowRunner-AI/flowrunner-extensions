# DataForSEO FlowRunner Extension

Pull SEO, SERP, and keyword research data from DataForSEO into AI workflows for rank tracking, keyword analysis, and competitive intelligence.

## Ideal Use Cases

- Rank monitoring across Google, Bing, and Google Maps for tracked queries
- Keyword research at scale: expand a seed term, score difficulty, rank by opportunity
- Competitive SERP snapshots for content briefs and gap analysis
- Discovering what queries a competitor's domain ranks for
- Content calendar generation grounded in real search intent and difficulty
- Continuous keyword refresh feeding a downstream content pipeline

## List of Actions

### SERP

- Google Organic Search
- Google Maps Search
- Bing Organic Search

### Keywords Data

- Get Keyword Search Volume

### Keyword Research

- Get Keyword Overview
- Get Bulk Keyword Difficulty
- Get Related Keywords
- Get Keyword Suggestions
- Get Keywords For Site

## Agent Ideas

- **Weekly keyword refresh**: trigger a scheduled FlowRunner run that reads seed terms from a config, expands them via *Get Keyword Suggestions* and *Get Related Keywords*, scores the combined pool with *Get Bulk Keyword Difficulty*, and writes ranked opportunities to a Google Sheet for review and prioritization.
- **Competitor gap analysis**: when *Slack* "On Mention" fires with a competitor domain, call *Get Keywords For Site* and reply in-thread with their top-50 ranking keywords and difficulties.
- **Brief generator**: when a *Notion* "On New Page" trigger fires in the content-briefs database, run *Google Organic Search* and *Get Keyword Overview* for the page title, then patch the Notion page with top SERP results and keyword metrics.
