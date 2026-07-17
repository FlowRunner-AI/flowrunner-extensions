const logger = {
  info: (...args) => console.log('[Firecrawl] info:', ...args),
  debug: (...args) => console.log('[Firecrawl] debug:', ...args),
  error: (...args) => console.log('[Firecrawl] error:', ...args),
  warn: (...args) => console.log('[Firecrawl] warn:', ...args),
}

const API_BASE_URL = 'https://api.firecrawl.dev/v2'

const POLL_INTERVAL_MS = 3000
const DEFAULT_WAIT_SECONDS = 240
const MAX_RESULT_CHUNKS = 5

const FORMAT_MAP = {
  'Markdown': 'markdown',
  'Summary': 'summary',
  'HTML': 'html',
  'Raw HTML': 'rawHtml',
  'Links': 'links',
  'Images': 'images',
  'Screenshot': 'screenshot',
  'Branding': 'branding',
  'Product': 'product',
  'Menu': 'menu',
}

const SITEMAP_MAP = { 'Include': 'include', 'Skip': 'skip', 'Only': 'only' }
const PROXY_MAP = { 'Auto': 'auto', 'Basic': 'basic', 'Enhanced': 'enhanced' }
const SOURCE_MAP = { 'Web': 'web', 'News': 'news', 'Images': 'images' }
const CATEGORY_MAP = { 'GitHub': 'github', 'Research': 'research', 'PDF': 'pdf' }

const TBS_MAP = {
  'Past Hour': 'qdr:h',
  'Past 24 Hours': 'qdr:d',
  'Past Week': 'qdr:w',
  'Past Month': 'qdr:m',
  'Past Year': 'qdr:y',
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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
 * @integrationName Firecrawl
 * @integrationIcon /icon.png
 */
class FirecrawlService {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
        })
        .query(clean(query) || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.error || error.body?.message ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Firecrawl API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoices(values, mapping) {
    if (!Array.isArray(values) || values.length === 0) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping))
  }

  #buildFormats(formats, jsonPrompt, jsonSchema) {
    const resolved = []

    for (const format of formats || []) {
      if (format === 'Screenshot (Full Page)') {
        resolved.push({ type: 'screenshot', fullPage: true })
      } else {
        resolved.push(this.#resolveChoice(format, FORMAT_MAP))
      }
    }

    if (jsonPrompt || jsonSchema) {
      resolved.push(clean({ type: 'json', prompt: jsonPrompt, schema: jsonSchema }))
    }

    return resolved.length ? resolved : undefined
  }

  #assertFirecrawlUrl(url) {
    if (url && !url.startsWith('https://api.firecrawl.dev')) {
      throw new Error('Firecrawl API error: nextPageUrl must be a https://api.firecrawl.dev URL returned in a previous status response')
    }
  }

  async #collectRemainingData(status, logTag) {
    const data = Array.isArray(status.data) ? [...status.data] : []
    let next = status.next || null
    let chunks = 0

    while (next && chunks < MAX_RESULT_CHUNKS) {
      this.#assertFirecrawlUrl(next)

      const page = await this.#apiRequest({ logTag, url: next, method: 'get' })

      if (Array.isArray(page.data)) {
        data.push(...page.data)
      }

      next = page.next || null
      chunks++
    }

    return { ...status, data, next }
  }

  async #waitForJob({ statusUrl, jobId, jobLabel, maxWaitSeconds, logTag }) {
    const waitSeconds = maxWaitSeconds || DEFAULT_WAIT_SECONDS
    const deadline = Date.now() + waitSeconds * 1000

    for (;;) {
      const status = await this.#apiRequest({ logTag, url: statusUrl, method: 'get' })

      if (status.status === 'completed') {
        return status
      }

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(`Firecrawl ${ jobLabel } ${ jobId } ${ status.status }${ status.error ? `: ${ status.error }` : '' }`)
      }

      if (Date.now() >= deadline) {
        throw new Error(`Firecrawl ${ jobLabel } ${ jobId } did not complete within ${ waitSeconds }s (last status: ${ status.status }). The job is still running - retrieve results later with the matching status action.`)
      }

      await sleep(POLL_INTERVAL_MS)
    }
  }

  /**
   * @operationName Scrape URL
   * @category Scraping
   * @description Scrapes a single URL synchronously and returns its content in the requested formats: clean Markdown, an LLM-generated summary, HTML, raw HTML, page links, image URLs, screenshots, or structured JSON extracted with a prompt and/or JSON Schema. Handles JavaScript rendering, PDFs, proxies, and caching (maxAge) automatically, and supports browser actions (click, scroll, type, wait) before capture. Costs 1 credit per page for basic formats; JSON extraction and enhanced proxying cost more.
   * @route POST /scrape
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 180
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The URL to scrape, e.g. https://example.com/page."}
   * @paramDef {"type":"Array<String>","label":"Formats","name":"formats","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Summary","HTML","Raw HTML","Links","Images","Screenshot","Screenshot (Full Page)","Branding","Product","Menu"]}},"description":"Output formats to return. Defaults to Markdown when empty. Screenshot (Full Page) captures the entire page height. Combine with JSON Prompt / JSON Schema to also extract structured data."}
   * @paramDef {"type":"Boolean","label":"Only Main Content","name":"onlyMainContent","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), strips headers, navigation bars, and footers so only the main page content is returned."}
   * @paramDef {"type":"String","label":"JSON Prompt","name":"jsonPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language prompt describing the structured data to extract from the page. Adds a JSON extraction format to the request; the result appears in data.json."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema object defining the exact structure for JSON extraction, e.g. {\"type\":\"object\",\"properties\":{\"price\":{\"type\":\"number\"}}}. Can be combined with JSON Prompt."}
   * @paramDef {"type":"Array<String>","label":"Include Tags","name":"includeTags","description":"HTML tags, classes, or ids to include in the output, e.g. [\"article\", \".post-body\"]."}
   * @paramDef {"type":"Array<String>","label":"Exclude Tags","name":"excludeTags","description":"HTML tags, classes, or ids to exclude from the output, e.g. [\"nav\", \"#ads\"]."}
   * @paramDef {"type":"Number","label":"Wait For (ms)","name":"waitFor","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Milliseconds to wait for the page to load before capturing content. Use for JavaScript-heavy pages. Default 0."}
   * @paramDef {"type":"Boolean","label":"Mobile","name":"mobile","uiComponent":{"type":"TOGGLE"},"description":"Emulate a mobile device (viewport and user agent). Default false."}
   * @paramDef {"type":"Number","label":"Max Cache Age (ms)","name":"maxAge","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Return a cached version if it is newer than this many milliseconds (default 172800000 = 2 days). Set 0 to always fetch fresh content."}
   * @paramDef {"type":"Number","label":"Timeout (ms)","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Request timeout in milliseconds (1000-300000). Default 60000."}
   * @paramDef {"type":"String","label":"Proxy","name":"proxy","uiComponent":{"type":"DROPDOWN","options":{"values":["Auto","Basic","Enhanced"]}},"description":"Proxy tier. Auto (default) retries with Enhanced if Basic fails; Enhanced targets hard-to-scrape sites and costs additional credits."}
   * @paramDef {"type":"Array<Object>","label":"Actions","name":"actions","description":"Browser actions to perform before capture, e.g. [{\"type\":\"wait\",\"milliseconds\":2000},{\"type\":\"click\",\"selector\":\"#load-more\"},{\"type\":\"scroll\",\"direction\":\"down\"}]. Supported types include wait, click, write, press, scroll, screenshot, executeJavascript, pdf."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Geographic context for the request, e.g. {\"country\":\"DE\",\"languages\":[\"de\"]}."}
   * @paramDef {"type":"Object","label":"Additional Options","name":"additionalOptions","description":"Advanced Firecrawl scrape options merged into the request body (e.g. {\"blockAds\":false,\"removeBase64Images\":false,\"parsers\":[\"pdf\"],\"headers\":{...}}). Keys here override the other parameters."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":{"markdown":"# Example Domain\n\nThis domain is for use in illustrative examples in documents.","links":["https://www.iana.org/domains/example"],"metadata":{"title":"Example Domain","description":"Example Domain","sourceURL":"https://example.com","url":"https://example.com/","statusCode":200,"contentType":"text/html"}}}
   */
  async scrapeUrl(url, formats, onlyMainContent, jsonPrompt, jsonSchema, includeTags, excludeTags, waitFor, mobile, maxAge, timeout, proxy, actions, location, additionalOptions) {
    const logTag = '[scrapeUrl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/scrape`,
      method: 'post',
      body: clean({
        url,
        formats: this.#buildFormats(formats, jsonPrompt, jsonSchema),
        onlyMainContent,
        includeTags,
        excludeTags,
        waitFor,
        mobile,
        maxAge,
        timeout,
        proxy: this.#resolveChoice(proxy, PROXY_MAP),
        actions,
        location,
        ...(additionalOptions || {}),
      }),
    })
  }

  /**
   * @operationName Start Batch Scrape
   * @category Batch Scraping
   * @description Starts an asynchronous batch scrape of multiple URLs and returns a job id immediately. Each URL is scraped with the same options (formats, main-content filtering, JSON extraction). Retrieve progress and results with Get Batch Scrape Status, or use Batch Scrape and Wait for a one-step synchronous version. Supports an optional webhook that fires on started, page, completed, and failed events.
   * @route POST /batch-scrape
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"Array<String>","label":"URLs","name":"urls","required":true,"description":"List of URLs to scrape, e.g. [\"https://example.com\", \"https://firecrawl.dev\"]."}
   * @paramDef {"type":"Array<String>","label":"Formats","name":"formats","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Summary","HTML","Raw HTML","Links","Images","Screenshot","Screenshot (Full Page)","Branding","Product","Menu"]}},"description":"Output formats for every scraped page. Defaults to Markdown when empty."}
   * @paramDef {"type":"Boolean","label":"Only Main Content","name":"onlyMainContent","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), strips headers, navigation bars, and footers from every page."}
   * @paramDef {"type":"String","label":"JSON Prompt","name":"jsonPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language prompt for structured JSON extraction applied to every page."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema object defining the structure for JSON extraction applied to every page."}
   * @paramDef {"type":"Number","label":"Max Concurrency","name":"maxConcurrency","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of URLs scraped in parallel. Defaults to your plan limit."}
   * @paramDef {"type":"Boolean","label":"Ignore Invalid URLs","name":"ignoreInvalidURLs","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), malformed URLs are skipped and reported in invalidURLs instead of failing the whole job."}
   * @paramDef {"type":"Object","label":"Webhook","name":"webhook","description":"Webhook configuration, e.g. {\"url\":\"https://example.com/hook\",\"events\":[\"completed\",\"failed\"],\"headers\":{},\"metadata\":{}}."}
   * @paramDef {"type":"Object","label":"Additional Options","name":"additionalOptions","description":"Advanced scrape options merged into the request body (e.g. {\"waitFor\":2000,\"proxy\":\"enhanced\",\"maxAge\":0}). Keys here override the other parameters."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"5c4b56dd-3a9f-4f0b-9f2e-0f9d6ab12345","url":"https://api.firecrawl.dev/v2/batch/scrape/5c4b56dd-3a9f-4f0b-9f2e-0f9d6ab12345","invalidURLs":[]}
   */
  async startBatchScrape(urls, formats, onlyMainContent, jsonPrompt, jsonSchema, maxConcurrency, ignoreInvalidURLs, webhook, additionalOptions) {
    const logTag = '[startBatchScrape]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/batch/scrape`,
      method: 'post',
      body: clean({
        urls,
        formats: this.#buildFormats(formats, jsonPrompt, jsonSchema),
        onlyMainContent,
        maxConcurrency,
        ignoreInvalidURLs,
        webhook,
        ...(additionalOptions || {}),
      }),
    })
  }

  /**
   * @operationName Get Batch Scrape Status
   * @category Batch Scraping
   * @description Returns the status and results of a batch scrape job started with Start Batch Scrape. While running, status is "scraping" with progress counters; when finished it is "completed" or "failed" and data contains the scraped documents. Large result sets are chunked (about 10MB per response) - when next is a URL, pass it as Next Page URL in a follow-up call to fetch the remaining documents.
   * @route GET /batch-scrape-status
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The batch scrape job id returned by Start Batch Scrape."}
   * @paramDef {"type":"String","label":"Next Page URL","name":"nextPageUrl","description":"The next URL from a previous status response. When provided, fetches that results chunk instead of the first page."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","total":2,"completed":2,"creditsUsed":2,"expiresAt":"2026-08-01T00:00:00.000Z","next":null,"data":[{"markdown":"# Example Domain","metadata":{"title":"Example Domain","sourceURL":"https://example.com","statusCode":200}}]}
   */
  async getBatchScrapeStatus(id, nextPageUrl) {
    const logTag = '[getBatchScrapeStatus]'

    this.#assertFirecrawlUrl(nextPageUrl)

    return await this.#apiRequest({
      logTag,
      url: nextPageUrl || `${ API_BASE_URL }/batch/scrape/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Batch Scrape and Wait
   * @category Batch Scraping
   * @description Scrapes multiple URLs in one synchronous step: starts a batch scrape job, polls until it completes, and returns all scraped documents. Follows result pagination automatically (up to 5 chunks of about 10MB; a remaining next URL is returned if there is even more data). Fails with a descriptive error if the job does not finish within Max Wait Seconds - the job keeps running and can still be read with Get Batch Scrape Status. Best for small to medium URL lists; use Start Batch Scrape with a webhook for very large jobs.
   * @route POST /batch-scrape-and-wait
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"URLs","name":"urls","required":true,"description":"List of URLs to scrape, e.g. [\"https://example.com\", \"https://firecrawl.dev\"]."}
   * @paramDef {"type":"Array<String>","label":"Formats","name":"formats","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Summary","HTML","Raw HTML","Links","Images","Screenshot","Screenshot (Full Page)","Branding","Product","Menu"]}},"description":"Output formats for every scraped page. Defaults to Markdown when empty."}
   * @paramDef {"type":"Boolean","label":"Only Main Content","name":"onlyMainContent","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), strips headers, navigation bars, and footers from every page."}
   * @paramDef {"type":"String","label":"JSON Prompt","name":"jsonPrompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language prompt for structured JSON extraction applied to every page."}
   * @paramDef {"type":"Object","label":"JSON Schema","name":"jsonSchema","description":"JSON Schema object defining the structure for JSON extraction applied to every page."}
   * @paramDef {"type":"Number","label":"Max Concurrency","name":"maxConcurrency","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of URLs scraped in parallel. Defaults to your plan limit."}
   * @paramDef {"type":"Object","label":"Additional Options","name":"additionalOptions","description":"Advanced scrape options merged into the request body (e.g. {\"waitFor\":2000,\"proxy\":\"enhanced\"}). Keys here override the other parameters."}
   * @paramDef {"type":"Number","label":"Max Wait Seconds","name":"maxWaitSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long to wait for the job to complete before failing. Default 240."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","total":2,"completed":2,"creditsUsed":2,"expiresAt":"2026-08-01T00:00:00.000Z","next":null,"data":[{"markdown":"# Example Domain","metadata":{"title":"Example Domain","sourceURL":"https://example.com","statusCode":200}}],"id":"5c4b56dd-3a9f-4f0b-9f2e-0f9d6ab12345"}
   */
  async batchScrapeAndWait(urls, formats, onlyMainContent, jsonPrompt, jsonSchema, maxConcurrency, additionalOptions, maxWaitSeconds) {
    const logTag = '[batchScrapeAndWait]'

    const job = await this.startBatchScrape(urls, formats, onlyMainContent, jsonPrompt, jsonSchema, maxConcurrency, undefined, undefined, additionalOptions)

    const status = await this.#waitForJob({
      logTag,
      statusUrl: `${ API_BASE_URL }/batch/scrape/${ job.id }`,
      jobId: job.id,
      jobLabel: 'batch scrape job',
      maxWaitSeconds,
    })

    const result = await this.#collectRemainingData(status, logTag)

    return { ...result, id: job.id }
  }

  /**
   * @operationName Start Crawl
   * @category Crawling
   * @description Starts an asynchronous crawl of a website and returns a job id immediately. Firecrawl discovers pages from the start URL (optionally guided by a natural-language prompt), follows links up to the page limit, and scrapes each page with the given scrape options. Supports include/exclude path regex filters, sitemap handling, subdomain and external-link traversal, crawl delay, concurrency limits, and completion webhooks. Retrieve results with Get Crawl Status, or use Crawl and Wait for a one-step synchronous version.
   * @route POST /crawl
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The starting URL for the crawl, e.g. https://docs.example.com."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional natural-language description of what to crawl; Firecrawl derives crawler options (paths, limits) from it automatically."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pages to crawl. Default 10000. Each scraped page consumes credits, so set this deliberately."}
   * @paramDef {"type":"Number","label":"Max Discovery Depth","name":"maxDiscoveryDepth","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum link depth to follow from the start URL, based on discovery order."}
   * @paramDef {"type":"Array<String>","label":"Include Paths","name":"includePaths","description":"Regex patterns for URL pathnames to include, e.g. [\"^/blog/.*\"]. Only matching URLs are crawled."}
   * @paramDef {"type":"Array<String>","label":"Exclude Paths","name":"excludePaths","description":"Regex patterns for URL pathnames to exclude, e.g. [\"^/admin/.*\", \".*\\\\?print=1\"]."}
   * @paramDef {"type":"String","label":"Sitemap","name":"sitemap","uiComponent":{"type":"DROPDOWN","options":{"values":["Include","Skip","Only"]}},"defaultValue":"Include","description":"How to use the site's sitemap: Include (default) combines sitemap URLs with link discovery, Skip ignores the sitemap, Only crawls just the sitemap URLs."}
   * @paramDef {"type":"Boolean","label":"Crawl Entire Domain","name":"crawlEntireDomain","uiComponent":{"type":"TOGGLE"},"description":"Follow sibling and parent URLs, not only child paths of the start URL. Default false."}
   * @paramDef {"type":"Boolean","label":"Allow External Links","name":"allowExternalLinks","uiComponent":{"type":"TOGGLE"},"description":"Follow links to other domains. Default false."}
   * @paramDef {"type":"Boolean","label":"Allow Subdomains","name":"allowSubdomains","uiComponent":{"type":"TOGGLE"},"description":"Follow links to subdomains of the main domain. Default false."}
   * @paramDef {"type":"Number","label":"Delay (seconds)","name":"delay","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Delay in seconds between page scrapes, to respect rate limits of the target site."}
   * @paramDef {"type":"Number","label":"Max Concurrency","name":"maxConcurrency","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of pages scraped in parallel. Defaults to your plan limit."}
   * @paramDef {"type":"Object","label":"Scrape Options","name":"scrapeOptions","description":"Scrape options applied to every crawled page, e.g. {\"formats\":[\"markdown\"],\"onlyMainContent\":true,\"maxAge\":172800000}."}
   * @paramDef {"type":"Object","label":"Webhook","name":"webhook","description":"Webhook configuration, e.g. {\"url\":\"https://example.com/hook\",\"events\":[\"completed\",\"failed\"],\"headers\":{},\"metadata\":{}}."}
   * @paramDef {"type":"Object","label":"Additional Options","name":"additionalOptions","description":"Advanced crawler options merged into the request body (e.g. {\"ignoreQueryParameters\":true,\"regexOnFullURL\":true}). Keys here override the other parameters."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"aa6c2b1f-84a4-4b0a-9f6e-7f1c2d312345","url":"https://api.firecrawl.dev/v2/crawl/aa6c2b1f-84a4-4b0a-9f6e-7f1c2d312345"}
   */
  async startCrawl(url, prompt, limit, maxDiscoveryDepth, includePaths, excludePaths, sitemap, crawlEntireDomain, allowExternalLinks, allowSubdomains, delay, maxConcurrency, scrapeOptions, webhook, additionalOptions) {
    const logTag = '[startCrawl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl`,
      method: 'post',
      body: clean({
        url,
        prompt,
        limit,
        maxDiscoveryDepth,
        includePaths,
        excludePaths,
        sitemap: this.#resolveChoice(sitemap, SITEMAP_MAP),
        crawlEntireDomain,
        allowExternalLinks,
        allowSubdomains,
        delay,
        maxConcurrency,
        scrapeOptions,
        webhook,
        ...(additionalOptions || {}),
      }),
    })
  }

  /**
   * @operationName Get Crawl Status
   * @category Crawling
   * @description Returns the status and results of a crawl job started with Start Crawl. While running, status is "scraping" with total/completed progress counters; when finished it is "completed" or "failed" and data contains the scraped pages. Large result sets are chunked (about 10MB per response) - when next is a URL, pass it as Next Page URL in a follow-up call to fetch the remaining pages. Crawl results expire about 24 hours after completion.
   * @route GET /crawl-status
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"dictionary":"activeCrawlsDictionary","description":"The crawl job id returned by Start Crawl. Select a running crawl from the list or bind an id."}
   * @paramDef {"type":"String","label":"Next Page URL","name":"nextPageUrl","description":"The next URL from a previous status response. When provided, fetches that results chunk instead of the first page."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","total":25,"completed":25,"creditsUsed":25,"expiresAt":"2026-08-01T00:00:00.000Z","next":null,"data":[{"markdown":"# Getting Started","metadata":{"title":"Getting Started","sourceURL":"https://docs.example.com/start","statusCode":200}}]}
   */
  async getCrawlStatus(id, nextPageUrl) {
    const logTag = '[getCrawlStatus]'

    this.#assertFirecrawlUrl(nextPageUrl)

    return await this.#apiRequest({
      logTag,
      url: nextPageUrl || `${ API_BASE_URL }/crawl/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Crawl and Wait
   * @category Crawling
   * @description Crawls a website in one synchronous step: starts a crawl job, polls until it completes, and returns all scraped pages. Follows result pagination automatically (up to 5 chunks of about 10MB; a remaining next URL is returned if there is even more data). Fails with a descriptive error if the crawl does not finish within Max Wait Seconds - the job keeps running and can still be read with Get Crawl Status. Best for small crawls (set a low Limit); use Start Crawl with a webhook for large sites.
   * @route POST /crawl-and-wait
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The starting URL for the crawl, e.g. https://docs.example.com."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"defaultValue":10,"description":"Maximum number of pages to crawl. Default 10 for the synchronous version - keep it small so the crawl finishes within the wait window."}
   * @paramDef {"type":"Array<String>","label":"Include Paths","name":"includePaths","description":"Regex patterns for URL pathnames to include, e.g. [\"^/blog/.*\"]."}
   * @paramDef {"type":"Array<String>","label":"Exclude Paths","name":"excludePaths","description":"Regex patterns for URL pathnames to exclude, e.g. [\"^/admin/.*\"]."}
   * @paramDef {"type":"String","label":"Sitemap","name":"sitemap","uiComponent":{"type":"DROPDOWN","options":{"values":["Include","Skip","Only"]}},"defaultValue":"Include","description":"How to use the site's sitemap: Include (default), Skip, or Only (crawl just the sitemap URLs)."}
   * @paramDef {"type":"Boolean","label":"Crawl Entire Domain","name":"crawlEntireDomain","uiComponent":{"type":"TOGGLE"},"description":"Follow sibling and parent URLs, not only child paths of the start URL. Default false."}
   * @paramDef {"type":"Boolean","label":"Allow External Links","name":"allowExternalLinks","uiComponent":{"type":"TOGGLE"},"description":"Follow links to other domains. Default false."}
   * @paramDef {"type":"Object","label":"Scrape Options","name":"scrapeOptions","description":"Scrape options applied to every crawled page, e.g. {\"formats\":[\"markdown\"],\"onlyMainContent\":true}."}
   * @paramDef {"type":"Object","label":"Additional Options","name":"additionalOptions","description":"Advanced crawler options merged into the request body (e.g. {\"maxDiscoveryDepth\":2,\"delay\":1}). Keys here override the other parameters."}
   * @paramDef {"type":"Number","label":"Max Wait Seconds","name":"maxWaitSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long to wait for the crawl to complete before failing. Default 240."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","total":10,"completed":10,"creditsUsed":10,"expiresAt":"2026-08-01T00:00:00.000Z","next":null,"data":[{"markdown":"# Getting Started","metadata":{"title":"Getting Started","sourceURL":"https://docs.example.com/start","statusCode":200}}],"id":"aa6c2b1f-84a4-4b0a-9f6e-7f1c2d312345"}
   */
  async crawlAndWait(url, limit, includePaths, excludePaths, sitemap, crawlEntireDomain, allowExternalLinks, scrapeOptions, additionalOptions, maxWaitSeconds) {
    const logTag = '[crawlAndWait]'

    const job = await this.startCrawl(url, undefined, limit || 10, undefined, includePaths, excludePaths, sitemap, crawlEntireDomain, allowExternalLinks, undefined, undefined, undefined, scrapeOptions, undefined, additionalOptions)

    const status = await this.#waitForJob({
      logTag,
      statusUrl: `${ API_BASE_URL }/crawl/${ job.id }`,
      jobId: job.id,
      jobLabel: 'crawl job',
      maxWaitSeconds,
    })

    const result = await this.#collectRemainingData(status, logTag)

    return { ...result, id: job.id }
  }

  /**
   * @operationName Cancel Crawl
   * @category Crawling
   * @description Cancels a running crawl job. Pages scraped before cancellation remain available through Get Crawl Status until the job expires. Credits already consumed are not refunded.
   * @route DELETE /crawl
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"dictionary":"activeCrawlsDictionary","description":"The crawl job id to cancel. Select a running crawl from the list or bind an id."}
   *
   * @returns {Object}
   * @sampleResult {"status":"cancelled"}
   */
  async cancelCrawl(id) {
    const logTag = '[cancelCrawl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl/${ id }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Get Crawl Errors
   * @category Crawling
   * @description Returns the per-URL errors of a crawl job and the list of URLs that were blocked by robots.txt. Use it to diagnose why a crawl returned fewer pages than expected.
   * @route GET /crawl-errors
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"dictionary":"activeCrawlsDictionary","description":"The crawl job id to inspect. Select a running crawl from the list or bind an id."}
   *
   * @returns {Object}
   * @sampleResult {"errors":[{"id":"err_01","timestamp":"2026-07-17T10:00:00.000Z","url":"https://example.com/broken","error":"Page returned status code 404"}],"robotsBlocked":["https://example.com/admin"]}
   */
  async getCrawlErrors(id) {
    const logTag = '[getCrawlErrors]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl/${ id }/errors`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Active Crawls
   * @category Crawling
   * @description Lists all crawl jobs of your team that are currently running, including each job's id, start URL, and crawler options. Useful for monitoring long crawls or finding a job id to cancel.
   * @route GET /active-crawls
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @returns {Object}
   * @sampleResult {"success":true,"crawls":[{"id":"aa6c2b1f-84a4-4b0a-9f6e-7f1c2d312345","teamId":"team_123","url":"https://docs.example.com","options":{"limit":100,"scrapeOptions":{"formats":["markdown"]}}}]}
   */
  async getActiveCrawls() {
    const logTag = '[getActiveCrawls]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl/active`,
      method: 'get',
    })
  }

  /**
   * @operationName Map Website
   * @category Mapping
   * @description Discovers the URLs of a website extremely fast, combining sitemap parsing and link discovery, and returns them as a list with titles and descriptions. Optionally ranks results by relevance to a search term. Ideal for choosing which pages to scrape before running a crawl, or for building site inventories. Returns up to 100,000 links.
   * @route POST /map
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The website to map, e.g. https://docs.example.com."}
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional term to rank the discovered URLs by relevance, e.g. \"pricing\"."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of links to return (up to 100000). Default 5000."}
   * @paramDef {"type":"String","label":"Sitemap","name":"sitemap","uiComponent":{"type":"DROPDOWN","options":{"values":["Include","Skip","Only"]}},"defaultValue":"Include","description":"How to use the site's sitemap: Include (default) combines sitemap URLs with link discovery, Skip ignores the sitemap, Only returns just the sitemap URLs."}
   * @paramDef {"type":"Boolean","label":"Include Subdomains","name":"includeSubdomains","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Include URLs from subdomains of the main domain. Default true."}
   * @paramDef {"type":"Boolean","label":"Ignore Query Parameters","name":"ignoreQueryParameters","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"Treat URLs that differ only by query parameters as the same URL. Default true."}
   * @paramDef {"type":"Number","label":"Timeout (ms)","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Request timeout in milliseconds."}
   * @paramDef {"type":"Object","label":"Location","name":"location","description":"Geographic context for the request, e.g. {\"country\":\"DE\",\"languages\":[\"de\"]}."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"links":[{"url":"https://docs.example.com/getting-started","title":"Getting Started","description":"Set up your account in minutes."},{"url":"https://docs.example.com/pricing","title":"Pricing"}]}
   */
  async mapUrl(url, search, limit, sitemap, includeSubdomains, ignoreQueryParameters, timeout, location) {
    const logTag = '[mapUrl]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/map`,
      method: 'post',
      body: clean({
        url,
        search,
        limit,
        sitemap: this.#resolveChoice(sitemap, SITEMAP_MAP),
        includeSubdomains,
        ignoreQueryParameters,
        timeout,
        location,
      }),
    })
  }

  /**
   * @operationName Search Web
   * @category Search
   * @description Searches the web and returns organic results from web pages, news, and images, optionally scraping the full content of each result in one call. Supports time-range filters, category filters (GitHub, Research, PDF), geo-targeting, and per-result scrape formats such as Markdown. When Formats or Scrape Options are provided, every result is scraped and includes its content; otherwise only titles, descriptions, and URLs are returned (faster and cheaper).
   * @route POST /search
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"The search query (max 500 characters). Supports operators like site:, inurl:, and quoted phrases."}
   * @paramDef {"type":"Array<String>","label":"Sources","name":"sources","uiComponent":{"type":"DROPDOWN","options":{"values":["Web","News","Images"]}},"description":"Result sources to include. Defaults to Web only."}
   * @paramDef {"type":"Array<String>","label":"Categories","name":"categories","uiComponent":{"type":"DROPDOWN","options":{"values":["GitHub","Research","PDF"]}},"description":"Optional category filters that restrict results to GitHub repositories, research papers, or PDF documents."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of results per source (1-100). Default 10."}
   * @paramDef {"type":"String","label":"Time Range","name":"timeRange","uiComponent":{"type":"DROPDOWN","options":{"values":["Past Hour","Past 24 Hours","Past Week","Past Month","Past Year"]}},"description":"Restrict results to a recency window. Leave empty for all time. Custom Google tbs strings (e.g. sbd:1,qdr:w) can be bound directly."}
   * @paramDef {"type":"String","label":"Location","name":"location","description":"Geo-target the search results, e.g. \"San Francisco,California,United States\" or \"Germany\"."}
   * @paramDef {"type":"Array<String>","label":"Formats","name":"formats","uiComponent":{"type":"DROPDOWN","options":{"values":["Markdown","Summary","HTML","Raw HTML","Links","Images","Screenshot"]}},"description":"When set, each search result is also scraped and returned in these formats (consumes scraping credits per result)."}
   * @paramDef {"type":"Object","label":"Scrape Options","name":"scrapeOptions","description":"Advanced scrape options for result scraping, e.g. {\"onlyMainContent\":true,\"maxAge\":172800000}. Merged with Formats."}
   * @paramDef {"type":"Number","label":"Timeout (ms)","name":"timeout","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Request timeout in milliseconds (1000-300000). Default 60000."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":{"web":[{"title":"Firecrawl - The Web Data API for AI","description":"Turn websites into LLM-ready data.","url":"https://www.firecrawl.dev/","position":1}],"news":[],"images":[]},"creditsUsed":2}
   */
  async search(query, sources, categories, limit, timeRange, location, formats, scrapeOptions, timeout) {
    const logTag = '[search]'

    const builtFormats = this.#buildFormats(formats)
    const mergedScrapeOptions = builtFormats || scrapeOptions
      ? clean({ formats: builtFormats, ...(scrapeOptions || {}) })
      : undefined

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/search`,
      method: 'post',
      body: clean({
        query,
        sources: this.#resolveChoices(sources, SOURCE_MAP),
        categories: this.#resolveChoices(categories, CATEGORY_MAP),
        limit,
        tbs: this.#resolveChoice(timeRange, TBS_MAP),
        location,
        timeout,
        scrapeOptions: mergedScrapeOptions,
      }),
    })
  }

  /**
   * @operationName Start Extract
   * @category Extraction
   * @description Starts an asynchronous LLM extraction job that pulls structured data from one or more URLs based on a prompt and/or JSON Schema, and returns a job id immediately. URLs support glob patterns (e.g. https://example.com/blog/*) to extract across whole site sections, and web search enrichment can fill in data missing from the pages. Retrieve the extracted data with Get Extract Status, or use Extract and Wait for a one-step synchronous version.
   * @route POST /extract
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"Array<String>","label":"URLs","name":"urls","required":true,"description":"URLs to extract from. Glob patterns are supported, e.g. [\"https://example.com/products/*\"]."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language description of the data to extract, e.g. \"Extract the product name, price, and availability\". Required if no Schema is provided."}
   * @paramDef {"type":"Object","label":"Schema","name":"schema","description":"JSON Schema object defining the structure of the extracted data, e.g. {\"type\":\"object\",\"properties\":{\"price\":{\"type\":\"number\"}},\"required\":[\"price\"]}. Required if no Prompt is provided."}
   * @paramDef {"type":"Boolean","label":"Enable Web Search","name":"enableWebSearch","uiComponent":{"type":"TOGGLE"},"description":"Allow the extraction to follow links and search the web for additional data beyond the provided URLs. Default false."}
   * @paramDef {"type":"Boolean","label":"Show Sources","name":"showSources","uiComponent":{"type":"TOGGLE"},"description":"Include the source URLs used for each extracted value in the response. Default false."}
   * @paramDef {"type":"Boolean","label":"Ignore Invalid URLs","name":"ignoreInvalidURLs","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When enabled (default), malformed URLs are skipped instead of failing the whole job."}
   * @paramDef {"type":"Object","label":"Scrape Options","name":"scrapeOptions","description":"Advanced scrape options applied while reading the pages, e.g. {\"onlyMainContent\":true,\"waitFor\":2000}."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":"e2f1a9c3-7b5d-4a1e-8c3f-2d4b6a812345","invalidURLs":[]}
   */
  async startExtract(urls, prompt, schema, enableWebSearch, showSources, ignoreInvalidURLs, scrapeOptions) {
    const logTag = '[startExtract]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/extract`,
      method: 'post',
      body: clean({
        urls,
        prompt,
        schema,
        enableWebSearch,
        showSources,
        ignoreInvalidURLs,
        scrapeOptions,
      }),
    })
  }

  /**
   * @operationName Get Extract Status
   * @category Extraction
   * @description Returns the status and result of an LLM extraction job started with Start Extract. While running, status is "processing"; when finished it is "completed" (data contains the extracted object), "failed", or "cancelled". Extraction results expire after some time, so read them promptly.
   * @route GET /extract-status
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @paramDef {"type":"String","label":"Job ID","name":"id","required":true,"description":"The extraction job id returned by Start Extract."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","data":{"companyName":"Firecrawl","pricingPlans":[{"name":"Hobby","priceUsd":16}]},"expiresAt":"2026-07-18T10:00:00.000Z"}
   */
  async getExtractStatus(id) {
    const logTag = '[getExtractStatus]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/extract/${ id }`,
      method: 'get',
    })
  }

  /**
   * @operationName Extract and Wait
   * @category Extraction
   * @description Extracts structured data from one or more URLs in one synchronous step: starts an LLM extraction job, polls until it completes, and returns the extracted object. URLs support glob patterns (e.g. https://example.com/blog/*), and web search enrichment can fill in missing data. Fails with a descriptive error if the job does not finish within Max Wait Seconds - the job keeps running and can still be read with Get Extract Status. Best for a handful of URLs; use Start Extract for large site-wide extractions.
   * @route POST /extract-and-wait
   * @appearanceColor #FA5D19 #FF8A5B
   * @executionTimeoutInSeconds 300
   *
   * @paramDef {"type":"Array<String>","label":"URLs","name":"urls","required":true,"description":"URLs to extract from. Glob patterns are supported, e.g. [\"https://example.com/products/*\"]."}
   * @paramDef {"type":"String","label":"Prompt","name":"prompt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Natural-language description of the data to extract. Required if no Schema is provided."}
   * @paramDef {"type":"Object","label":"Schema","name":"schema","description":"JSON Schema object defining the structure of the extracted data. Required if no Prompt is provided."}
   * @paramDef {"type":"Boolean","label":"Enable Web Search","name":"enableWebSearch","uiComponent":{"type":"TOGGLE"},"description":"Allow the extraction to follow links and search the web for additional data. Default false."}
   * @paramDef {"type":"Boolean","label":"Show Sources","name":"showSources","uiComponent":{"type":"TOGGLE"},"description":"Include the source URLs used for each extracted value in the response. Default false."}
   * @paramDef {"type":"Object","label":"Scrape Options","name":"scrapeOptions","description":"Advanced scrape options applied while reading the pages, e.g. {\"onlyMainContent\":true}."}
   * @paramDef {"type":"Number","label":"Max Wait Seconds","name":"maxWaitSeconds","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"How long to wait for the extraction to complete before failing. Default 240."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"status":"completed","data":{"companyName":"Firecrawl","pricingPlans":[{"name":"Hobby","priceUsd":16}]},"expiresAt":"2026-07-18T10:00:00.000Z","id":"e2f1a9c3-7b5d-4a1e-8c3f-2d4b6a812345"}
   */
  async extractAndWait(urls, prompt, schema, enableWebSearch, showSources, scrapeOptions, maxWaitSeconds) {
    const logTag = '[extractAndWait]'

    const job = await this.startExtract(urls, prompt, schema, enableWebSearch, showSources, undefined, scrapeOptions)

    const status = await this.#waitForJob({
      logTag,
      statusUrl: `${ API_BASE_URL }/extract/${ job.id }`,
      jobId: job.id,
      jobLabel: 'extract job',
      maxWaitSeconds,
    })

    return { ...status, id: job.id }
  }

  /**
   * @operationName Get Credit Usage
   * @category Account
   * @description Returns the remaining and total scraping credits of your team for the current billing period, including the billing period start and end dates. Use it to monitor consumption before running large crawls or batch scrapes.
   * @route GET /credit-usage
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":{"remainingCredits":47605,"planCredits":100000,"billingPeriodStart":"2026-07-01T00:00:00.000Z","billingPeriodEnd":"2026-08-01T00:00:00.000Z"}}
   */
  async getCreditUsage() {
    const logTag = '[getCreditUsage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/team/credit-usage`,
      method: 'get',
    })
  }

  /**
   * @operationName Get Token Usage
   * @category Account
   * @description Returns the remaining and total extraction tokens of your team for the current billing period, including the billing period start and end dates. Tokens are consumed by LLM-powered features such as Extract and JSON-format scraping.
   * @route GET /token-usage
   * @appearanceColor #FA5D19 #FF8A5B
   *
   * @returns {Object}
   * @sampleResult {"success":true,"data":{"remainingTokens":984560,"planTokens":1000000,"billingPeriodStart":"2026-07-01T00:00:00.000Z","billingPeriodEnd":"2026-08-01T00:00:00.000Z"}}
   */
  async getTokenUsage() {
    const logTag = '[getTokenUsage]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/team/token-usage`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} activeCrawlsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to the crawl start URL."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. The active crawls endpoint returns all jobs in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Active Crawls Dictionary
   * @description Lists the currently running crawl jobs of your team for selecting a job id in Get Crawl Status, Cancel Crawl, and Get Crawl Errors. The option value is the crawl job id.
   * @route POST /active-crawls-dictionary
   * @paramDef {"type":"activeCrawlsDictionary__payload","label":"Payload","name":"payload","description":"Contains the search string used to filter active crawls by start URL."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"https://docs.example.com","value":"aa6c2b1f-84a4-4b0a-9f6e-7f1c2d312345","note":"Active crawl"}],"cursor":null}
   */
  async activeCrawlsDictionary(payload) {
    const { search } = payload || {}
    const logTag = '[activeCrawlsDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/crawl/active`,
      method: 'get',
    })

    const crawls = response.crawls || []
    const needle = (search || '').toLowerCase()

    const items = crawls
      .filter(crawl => !needle || (crawl.url || '').toLowerCase().includes(needle))
      .map(crawl => ({
        label: crawl.url || crawl.id,
        value: crawl.id,
        note: 'Active crawl',
      }))

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(FirecrawlService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Firecrawl API key (starts with fc-). Get it at https://www.firecrawl.dev/app/api-keys',
  },
])
