const logger = {
  info: (...args) => console.log('[Tavily] info:', ...args),
  debug: (...args) => console.log('[Tavily] debug:', ...args),
  error: (...args) => console.log('[Tavily] error:', ...args),
  warn: (...args) => console.log('[Tavily] warn:', ...args),
}

const API_BASE_URL = 'https://api.tavily.com'

const SEARCH_DEPTHS = { 'Basic': 'basic', 'Advanced': 'advanced', 'Fast': 'fast', 'Ultra Fast': 'ultra-fast' }
const TOPICS = { 'General': 'general', 'News': 'news', 'Finance': 'finance' }
const TIME_RANGES = { 'Day': 'day', 'Week': 'week', 'Month': 'month', 'Year': 'year' }
const ANSWER_MODES = { 'Basic': 'basic', 'Advanced': 'advanced' }
const RAW_CONTENT_FORMATS = { 'Markdown': 'markdown', 'Text': 'text' }
const EXTRACT_DEPTHS = { 'Basic': 'basic', 'Advanced': 'advanced' }
const CONTENT_FORMATS = { 'Markdown': 'markdown', 'Text': 'text' }
const RESEARCH_MODELS = { 'Auto': 'auto', 'Mini': 'mini', 'Pro': 'pro' }
const CITATION_FORMATS = { 'Numbered': 'numbered', 'MLA': 'mla', 'APA': 'apa', 'Chicago': 'chicago' }
const OUTPUT_LENGTHS = { 'Short': 'short', 'Standard': 'standard', 'Long': 'long' }

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value === undefined || value === null || value === '') {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    result[key] = value
  }

  return result
}

/**
 * @integrationName Tavily
 * @integrationIcon /icon.png
 */
class TavilyService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'post', body, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.detail?.error ||
        error.body?.detail ||
        error.body?.error ||
        error.body?.message ||
        error.message

      const messageText = typeof message === 'string' ? message : JSON.stringify(message)

      logger.error(`${ logTag } - Request failed: ${ messageText }`)

      throw new Error(`Tavily API error: ${ messageText }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #formatDate(value) {
    if (!value) {
      return undefined
    }

    const str = String(value)

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      return str
    }

    const date = new Date(typeof value === 'number' ? value : str)

    return isNaN(date.getTime()) ? str : date.toISOString().slice(0, 10)
  }

  /**
   * @operationName Search
   * @category Search
   * @description Runs an AI-optimized web search and returns ranked, agent-ready results with relevance scores and content snippets. Supports general, news, and finance topics, optional LLM-generated answers, raw page content (markdown or text), image results with descriptions, domain include/exclude filters (up to 300/150 domains), date filtering (relative time range or explicit start/end dates), country boosting for the general topic, and exact phrase matching. Set Auto Parameters to let Tavily choose the optimal search settings for the query automatically (explicitly set values still take precedence). Returns up to 20 results per call.
   * @route GET /search
   * @appearanceColor #468BFF #6BA6FF
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query to execute, e.g. 'latest developments in quantum computing'."}
   * @paramDef {"type":"String","label":"Search Depth","name":"searchDepth","uiComponent":{"type":"DROPDOWN","options":{"values":["Basic","Advanced","Fast","Ultra Fast"]}},"defaultValue":"Basic","description":"Search quality/speed trade-off. Basic (1 credit) returns generic snippets. Advanced (2 credits) retrieves the most query-relevant content chunks for higher relevance. Fast and Ultra Fast prioritize response speed over depth."}
   * @paramDef {"type":"String","label":"Topic","name":"topic","uiComponent":{"type":"DROPDOWN","options":{"values":["General","News","Finance"]}},"defaultValue":"General","description":"Search category. News pulls from curated news sources and includes published dates; Finance targets financial sources; General searches the broad web. Defaults to General."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of search results to return (0-20). Defaults to 5."}
   * @paramDef {"type":"String","label":"Include Answer","name":"includeAnswer","uiComponent":{"type":"DROPDOWN","options":{"values":["Basic","Advanced"]}},"description":"Include an LLM-generated answer to the query in the response. Basic returns a quick answer; Advanced returns a more detailed one. Leave empty for no answer."}
   * @paramDef {"type":"String","label":"Include Raw Content","name":"includeRawContent","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Text"]}},"description":"Include the cleaned full page content of each result, as Markdown or plain Text. Leave empty to omit raw content (snippets are always returned)."}
   * @paramDef {"type":"Boolean","label":"Include Images","name":"includeImages","uiComponent":{"type":"TOGGLE"},"description":"Also perform an image search and include image URLs in the response. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Image Descriptions","name":"includeImageDescriptions","uiComponent":{"type":"TOGGLE"},"description":"When Include Images is enabled, adds a descriptive caption for each image. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Favicons","name":"includeFavicon","uiComponent":{"type":"TOGGLE"},"description":"Include each result's favicon URL in the response. Defaults to false."}
   * @paramDef {"type":"Array<String>","label":"Include Domains","name":"includeDomains","description":"Restrict results to these domains only, e.g. ['nature.com','sciencedirect.com']. Up to 300 domains."}
   * @paramDef {"type":"Array<String>","label":"Exclude Domains","name":"excludeDomains","description":"Exclude results from these domains, e.g. ['pinterest.com']. Up to 150 domains."}
   * @paramDef {"type":"String","label":"Time Range","name":"timeRange","uiComponent":{"type":"DROPDOWN","options":{"values":["Day","Week","Month","Year"]}},"description":"Only return results published within this period back from the current date. Leave empty for no time filter."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return results published on or after this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_PICKER"},"description":"Only return results published on or before this date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"Boost results from a specific country (General topic only). Use the full lowercase country name, e.g. 'united states', 'germany', 'japan'."}
   * @paramDef {"type":"Number","label":"Chunks Per Source","name":"chunksPerSource","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of content chunks (~500 characters each) returned per source (1-3). Only applies when Search Depth is Advanced. Defaults to 3."}
   * @paramDef {"type":"Boolean","label":"Auto Parameters","name":"autoParameters","uiComponent":{"type":"TOGGLE"},"description":"Let Tavily automatically pick the optimal search parameters (depth, topic, etc.) based on the query intent. Explicitly set parameters still override the automatic choices. May consume 2 credits if advanced depth is selected automatically. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Exact Match","name":"exactMatch","uiComponent":{"type":"TOGGLE"},"description":"Only return results that contain the query as an exact phrase. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Usage","name":"includeUsage","uiComponent":{"type":"TOGGLE"},"description":"Include the number of API credits consumed by this request in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"query":"latest developments in quantum computing","answer":"Recent breakthroughs include error-corrected logical qubits and new superconducting processors.","images":[],"results":[{"title":"Quantum computing milestone reached","url":"https://example.com/quantum-milestone","content":"Researchers announced a major step toward fault-tolerant quantum computing...","score":0.98,"raw_content":null}],"auto_parameters":null,"response_time":1.42,"request_id":"1b2c3d4e-5f6a-7b8c-9d0e-1f2a3b4c5d6e"}
   */
  async search(
    query, searchDepth, topic, maxResults, includeAnswer, includeRawContent, includeImages,
    includeImageDescriptions, includeFavicon, includeDomains, excludeDomains, timeRange,
    startDate, endDate, country, chunksPerSource, autoParameters, exactMatch, includeUsage
  ) {
    const logTag = '[search]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'post',
      body: clean({
        query,
        search_depth: this.#resolveChoice(searchDepth, SEARCH_DEPTHS),
        topic: this.#resolveChoice(topic, TOPICS),
        max_results: maxResults,
        include_answer: this.#resolveChoice(includeAnswer, ANSWER_MODES),
        include_raw_content: this.#resolveChoice(includeRawContent, RAW_CONTENT_FORMATS),
        include_images: includeImages,
        include_image_descriptions: includeImageDescriptions,
        include_favicon: includeFavicon,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
        time_range: this.#resolveChoice(timeRange, TIME_RANGES),
        start_date: this.#formatDate(startDate),
        end_date: this.#formatDate(endDate),
        country: country ? String(country).toLowerCase() : undefined,
        chunks_per_source: chunksPerSource,
        auto_parameters: autoParameters,
        exact_match: exactMatch,
        include_usage: includeUsage,
      }),
    })
  }

  /**
   * @operationName Extract Content
   * @category Extraction
   * @description Extracts the page content from up to 20 URLs in a single call and returns it as clean markdown or plain text, ready for LLM consumption. Advanced depth additionally retrieves tables and embedded content at 2 credits per 5 successful extractions (Basic costs 1 credit per 5). Optionally provide a query to rerank the extracted content chunks by relevance to it. URLs that cannot be extracted are listed in failed_results with an error message instead of failing the whole call.
   * @route GET /extract
   * @appearanceColor #468BFF #6BA6FF
   * @executionTimeoutInSeconds 90
   *
   * @paramDef {"type":"Array<String>","label":"URLs","name":"urls","required":true,"description":"The URLs to extract content from, e.g. ['https://en.wikipedia.org/wiki/Artificial_intelligence']. Maximum 20 URLs per request."}
   * @paramDef {"type":"String","label":"Extract Depth","name":"extractDepth","uiComponent":{"type":"DROPDOWN","options":{"values":["Basic","Advanced"]}},"defaultValue":"Basic","description":"Extraction depth. Advanced retrieves more data, including tables and embedded content, with higher success on complex pages, but costs twice as much and may increase latency. Defaults to Basic."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Text"]}},"defaultValue":"Markdown","description":"Output format of the extracted content. Text may increase latency. Defaults to Markdown."}
   * @paramDef {"type":"String","label":"Query","name":"query","description":"Optional query used to rerank the extracted content chunks by relevance, e.g. 'pricing information'."}
   * @paramDef {"type":"Number","label":"Chunks Per Source","name":"chunksPerSource","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of reranked content chunks returned per URL (1-5). Only applies when a Query is provided. Defaults to 3."}
   * @paramDef {"type":"Boolean","label":"Include Images","name":"includeImages","uiComponent":{"type":"TOGGLE"},"description":"Also extract image URLs found on each page. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Favicons","name":"includeFavicon","uiComponent":{"type":"TOGGLE"},"description":"Include each page's favicon URL in the response. Defaults to false."}
   * @paramDef {"type":"Number","label":"Timeout","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum time in seconds to wait for extraction before timing out (1-60). If omitted, Tavily sets it automatically based on Extract Depth."}
   * @paramDef {"type":"Boolean","label":"Include Usage","name":"includeUsage","uiComponent":{"type":"TOGGLE"},"description":"Include the number of API credits consumed by this request in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"results":[{"url":"https://en.wikipedia.org/wiki/Artificial_intelligence","raw_content":"# Artificial intelligence\n\nArtificial intelligence (AI) is the capability of computational systems...","images":[]}],"failed_results":[],"response_time":0.87,"request_id":"2c3d4e5f-6a7b-8c9d-0e1f-2a3b4c5d6e7f"}
   */
  async extractContent(urls, extractDepth, format, query, chunksPerSource, includeImages, includeFavicon, timeout, includeUsage) {
    const logTag = '[extractContent]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/extract`,
      method: 'post',
      body: clean({
        urls,
        extract_depth: this.#resolveChoice(extractDepth, EXTRACT_DEPTHS),
        format: this.#resolveChoice(format, CONTENT_FORMATS),
        query,
        chunks_per_source: chunksPerSource,
        include_images: includeImages,
        include_favicon: includeFavicon,
        timeout,
        include_usage: includeUsage,
      }),
    })
  }

  /**
   * @operationName Crawl Website
   * @category Crawling
   * @description Crawls a website starting from a base URL, following internal links up to the configured depth and breadth, and returns the extracted content of every crawled page. Supports natural-language instructions to focus the crawl (e.g. 'find all pages about the Python SDK'; doubles the per-page cost), regex filters on paths and domains, and markdown or text output. Crawling costs 1 credit per 10 pages extracted (2 with instructions), plus extraction costs when Advanced depth is used. Suited for ingesting documentation sites, knowledge bases, or blogs into an AI workflow.
   * @route GET /crawl
   * @appearanceColor #468BFF #6BA6FF
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The root URL to begin crawling from, e.g. 'https://docs.tavily.com'."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language guidance for the crawler, e.g. 'Find all pages about the JavaScript SDK'. When provided, the crawl costs 2 credits per 10 pages instead of 1."}
   * @paramDef {"type":"Number","label":"Max Depth","name":"maxDepth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many link levels deep to explore from the base URL (1-5). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Breadth","name":"maxBreadth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of links to follow per page level (1-500). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of links the crawler will process before stopping. Defaults to 50."}
   * @paramDef {"type":"Array<String>","label":"Select Paths","name":"selectPaths","description":"Regex patterns to only crawl URLs with matching paths, e.g. ['/docs/.*','/api/v1.*']."}
   * @paramDef {"type":"Array<String>","label":"Select Domains","name":"selectDomains","description":"Regex patterns to only crawl matching domains or subdomains, e.g. ['^docs\\.example\\.com$']."}
   * @paramDef {"type":"Array<String>","label":"Exclude Paths","name":"excludePaths","description":"Regex patterns to skip URLs with matching paths, e.g. ['/private/.*','/admin/.*']."}
   * @paramDef {"type":"Array<String>","label":"Exclude Domains","name":"excludeDomains","description":"Regex patterns to skip matching domains or subdomains, e.g. ['^private\\.example\\.com$']."}
   * @paramDef {"type":"Boolean","label":"Allow External","name":"allowExternal","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether to include links that lead to external domains. Defaults to true."}
   * @paramDef {"type":"String","label":"Extract Depth","name":"extractDepth","uiComponent":{"type":"DROPDOWN","options":{"values":["Basic","Advanced"]}},"defaultValue":"Basic","description":"Content extraction depth for each crawled page. Advanced retrieves more data, including tables and embedded content, at a higher cost. Defaults to Basic."}
   * @paramDef {"type":"String","label":"Format","name":"format","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Text"]}},"defaultValue":"Markdown","description":"Output format of the extracted page content. Defaults to Markdown."}
   * @paramDef {"type":"Number","label":"Chunks Per Source","name":"chunksPerSource","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of content chunks returned per page (1-5). Only applies when Instructions are provided. Defaults to 3."}
   * @paramDef {"type":"Boolean","label":"Include Images","name":"includeImages","uiComponent":{"type":"TOGGLE"},"description":"Also extract image URLs from the crawled pages. Defaults to false."}
   * @paramDef {"type":"Boolean","label":"Include Favicons","name":"includeFavicon","uiComponent":{"type":"TOGGLE"},"description":"Include each page's favicon URL in the response. Defaults to false."}
   * @paramDef {"type":"Number","label":"Timeout","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum time in seconds to wait for the crawl before timing out (10-150). Defaults to 150."}
   * @paramDef {"type":"Boolean","label":"Include Usage","name":"includeUsage","uiComponent":{"type":"TOGGLE"},"description":"Include the number of API credits consumed by this request in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"base_url":"docs.tavily.com","results":[{"url":"https://docs.tavily.com/welcome","raw_content":"# Welcome to Tavily\n\nTavily is a search engine built for AI agents..."}],"response_time":4.63,"request_id":"3d4e5f6a-7b8c-9d0e-1f2a-3b4c5d6e7f8a"}
   */
  async crawlWebsite(
    url, instructions, maxDepth, maxBreadth, limit, selectPaths, selectDomains, excludePaths,
    excludeDomains, allowExternal, extractDepth, format, chunksPerSource, includeImages,
    includeFavicon, timeout, includeUsage
  ) {
    const logTag = '[crawlWebsite]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl`,
      method: 'post',
      body: clean({
        url,
        instructions,
        max_depth: maxDepth,
        max_breadth: maxBreadth,
        limit,
        select_paths: selectPaths,
        select_domains: selectDomains,
        exclude_paths: excludePaths,
        exclude_domains: excludeDomains,
        allow_external: allowExternal,
        extract_depth: this.#resolveChoice(extractDepth, EXTRACT_DEPTHS),
        format: this.#resolveChoice(format, CONTENT_FORMATS),
        chunks_per_source: chunksPerSource,
        include_images: includeImages,
        include_favicon: includeFavicon,
        timeout,
        include_usage: includeUsage,
      }),
    })
  }

  /**
   * @operationName Map Website
   * @category Crawling
   * @description Traverses a website starting from a base URL and returns the list of discovered page URLs without extracting their content, producing a sitemap-style overview of the site structure. Supports natural-language instructions to focus the traversal (doubles the per-page cost), regex filters on paths and domains, and depth/breadth limits. Costs 1 credit per 10 pages mapped (2 with instructions). Use it to discover pages before a targeted Extract Content or Crawl Website call.
   * @route GET /map
   * @appearanceColor #468BFF #6BA6FF
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The root URL to begin mapping from, e.g. 'https://docs.tavily.com'."}
   * @paramDef {"type":"String","label":"Instructions","name":"instructions","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language guidance for the mapper, e.g. 'Only find pages related to pricing'. When provided, mapping costs 2 credits per 10 pages instead of 1."}
   * @paramDef {"type":"Number","label":"Max Depth","name":"maxDepth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How many link levels deep to explore from the base URL (1-5). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Max Breadth","name":"maxBreadth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of links to follow per page level (1-500). Defaults to 20."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Total number of links the mapper will process before stopping. Defaults to 50."}
   * @paramDef {"type":"Array<String>","label":"Select Paths","name":"selectPaths","description":"Regex patterns to only map URLs with matching paths, e.g. ['/docs/.*']."}
   * @paramDef {"type":"Array<String>","label":"Select Domains","name":"selectDomains","description":"Regex patterns to only map matching domains or subdomains, e.g. ['^docs\\.example\\.com$']."}
   * @paramDef {"type":"Array<String>","label":"Exclude Paths","name":"excludePaths","description":"Regex patterns to skip URLs with matching paths, e.g. ['/private/.*']."}
   * @paramDef {"type":"Array<String>","label":"Exclude Domains","name":"excludeDomains","description":"Regex patterns to skip matching domains or subdomains, e.g. ['^legacy\\.example\\.com$']."}
   * @paramDef {"type":"Boolean","label":"Allow External","name":"allowExternal","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Whether to include links that lead to external domains. Defaults to true."}
   * @paramDef {"type":"Number","label":"Timeout","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum time in seconds to wait for the mapping before timing out (10-150). Defaults to 150."}
   * @paramDef {"type":"Boolean","label":"Include Usage","name":"includeUsage","uiComponent":{"type":"TOGGLE"},"description":"Include the number of API credits consumed by this request in the response. Defaults to false."}
   *
   * @returns {Object}
   * @sampleResult {"base_url":"docs.tavily.com","results":["https://docs.tavily.com/welcome","https://docs.tavily.com/documentation/api-reference/endpoint/search","https://docs.tavily.com/documentation/quickstart"],"response_time":2.19,"request_id":"4e5f6a7b-8c9d-0e1f-2a3b-4c5d6e7f8a9b"}
   */
  async mapWebsite(
    url, instructions, maxDepth, maxBreadth, limit, selectPaths, selectDomains,
    excludePaths, excludeDomains, allowExternal, timeout, includeUsage
  ) {
    const logTag = '[mapWebsite]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/map`,
      method: 'post',
      body: clean({
        url,
        instructions,
        max_depth: maxDepth,
        max_breadth: maxBreadth,
        limit,
        select_paths: selectPaths,
        select_domains: selectDomains,
        exclude_paths: excludePaths,
        exclude_domains: excludeDomains,
        allow_external: allowExternal,
        timeout,
        include_usage: includeUsage,
      }),
    })
  }

  /**
   * @operationName Start Research
   * @category Research
   * @description Starts an asynchronous deep-research task in which a Tavily research agent plans, searches, and synthesizes a cited report on the given question. Returns immediately with a request ID and a pending status; retrieve the finished report with Get Research Results. Choose the Mini model for speed, Pro for exhaustive depth, or Auto to let Tavily decide per task. Supports soft domain preferences, hard domain blocklists (up to 20 each), citation formatting, report length control, and an optional JSON Schema for structured output instead of a markdown report.
   * @route POST /research
   * @appearanceColor #468BFF #6BA6FF
   *
   * @paramDef {"type":"String","label":"Research Question","name":"input","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The research task or question to investigate, e.g. 'Compare the pricing and capabilities of the leading vector database providers in 2026'."}
   * @paramDef {"type":"String","label":"Model","name":"model","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Mini","Pro"]}},"defaultValue":"Auto","description":"Research agent to use. Mini is fastest and cheapest, Pro performs the deepest multi-step research, Auto lets Tavily pick per task. Defaults to Auto."}
   * @paramDef {"type":"String","label":"Output Length","name":"outputLength","uiComponent":{"type":"DROPDOWN","options":{"values":["Short","Standard","Long"]}},"defaultValue":"Standard","description":"Target length of the research report. Defaults to Standard."}
   * @paramDef {"type":"String","label":"Citation Format","name":"citationFormat","uiComponent":{"type":"DROPDOWN","options":{"values":["Numbered","MLA","APA","Chicago"]}},"defaultValue":"Numbered","description":"Citation style used in the report. Defaults to Numbered."}
   * @paramDef {"type":"Array<String>","label":"Include Domains","name":"includeDomains","description":"Domains the researcher should prefer as sources (soft preference, not a guarantee), e.g. ['arxiv.org']. Up to 20 domains."}
   * @paramDef {"type":"Array<String>","label":"Exclude Domains","name":"excludeDomains","description":"Domains the researcher must not use as sources (hard blocklist), e.g. ['reddit.com']. Up to 20 domains."}
   * @paramDef {"type":"Object","label":"Output Schema","name":"outputSchema","description":"Optional JSON Schema describing the desired structured output. When provided, the research result content is a JSON object matching this schema instead of a markdown report."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"5f6a7b8c-9d0e-1f2a-3b4c-5d6e7f8a9b0c","created_at":"2026-07-17T12:00:00Z","status":"pending","input":"Compare the leading vector database providers","model":"auto"}
   */
  async startResearch(input, model, outputLength, citationFormat, includeDomains, excludeDomains, outputSchema) {
    const logTag = '[startResearch]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/research`,
      method: 'post',
      body: clean({
        input,
        model: this.#resolveChoice(model, RESEARCH_MODELS),
        output_length: this.#resolveChoice(outputLength, OUTPUT_LENGTHS),
        citation_format: this.#resolveChoice(citationFormat, CITATION_FORMATS),
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
        output_schema: outputSchema,
        stream: false,
      }),
    })
  }

  /**
   * @operationName Get Research Results
   * @category Research
   * @description Retrieves the status and results of a research task started with Start Research. While the task is still running the response status is 'pending' or 'in_progress' and contains no content; poll again after a delay. When the status is 'completed', the response contains the research report content (a markdown string, or a JSON object if an output schema was provided) along with the list of sources used. Research tasks typically take from under a minute (Mini) to several minutes (Pro).
   * @route GET /research-results
   * @appearanceColor #468BFF #6BA6FF
   *
   * @paramDef {"type":"String","label":"Request ID","name":"requestId","required":true,"description":"The request ID returned by Start Research."}
   *
   * @returns {Object}
   * @sampleResult {"request_id":"5f6a7b8c-9d0e-1f2a-3b4c-5d6e7f8a9b0c","created_at":"2026-07-17T12:00:00Z","status":"completed","content":"## Vector Database Landscape 2026\n\nThe market is led by...","sources":[{"title":"Vector DB Benchmarks","url":"https://example.com/benchmarks","favicon":"https://example.com/favicon.ico"}],"response_time":184}
   */
  async getResearchResults(requestId) {
    const logTag = '[getResearchResults]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/research/${ encodeURIComponent(requestId) }`,
      method: 'get',
    })
  }

  /**
   * @operationName Get API Usage
   * @category Account
   * @description Returns credit usage for the current API key and the overall account for the current billing cycle. Key-level metrics include total credits used, the key limit (null if unlimited), and a per-endpoint breakdown (search, extract, crawl, map, research). Account-level metrics include the current plan name, plan usage and limit, pay-as-you-go usage and limit, and the same per-endpoint breakdown. Use it to monitor consumption or gate expensive operations in a flow.
   * @route GET /usage
   * @appearanceColor #468BFF #6BA6FF
   *
   * @returns {Object}
   * @sampleResult {"key":{"usage":1250,"limit":null,"search_usage":900,"extract_usage":200,"crawl_usage":100,"map_usage":30,"research_usage":20},"account":{"current_plan":"Bootstrap","plan_usage":1250,"plan_limit":15000,"paygo_usage":0,"paygo_limit":0,"search_usage":900,"extract_usage":200,"crawl_usage":100,"map_usage":30,"research_usage":20}}
   */
  async getUsage() {
    const logTag = '[getUsage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/usage`,
      method: 'get',
    })
  }
}

Flowrunner.ServerCode.addService(TavilyService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Tavily API key (starts with tvly-). Get it from https://app.tavily.com under API Keys.',
  },
])
