'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const DEMO_BASE = 'https://api.coingecko.com/api/v3'
const PRO_BASE = 'https://pro-api.coingecko.com/api/v3'

describe('CoinGecko Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items in order', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: false,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'plan',
          displayName: 'Plan',
          required: false,
          shared: false,
          type: 'CHOICE',
          options: ['Demo', 'Pro'],
          defaultValue: 'Demo',
        }),
      ])
    })

    it('defaults to the demo base url and demo api-key header', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).reply({ gecko_says: '(V3) To the Moon!' })

      await service.ping()

      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/ping`)
      expect(mock.history[0].headers).toMatchObject({
        'x-cg-demo-api-key': API_KEY,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].headers).not.toHaveProperty('x-cg-pro-api-key')
    })
  })

  // ── Ping ──

  describe('ping', () => {
    it('sends a GET to /ping and returns the response', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).reply({ gecko_says: '(V3) To the Moon!' })

      const result = await service.ping()

      expect(result).toEqual({ gecko_says: '(V3) To the Moon!' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).replyWithError({ message: 'Service unavailable' })

      await expect(service.ping()).rejects.toThrow('CoinGecko API error: Service unavailable')
    })
  })

  // ── Simple ──

  describe('getPrice', () => {
    it('sends required params and omits optional flags', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/price`).reply({ bitcoin: { usd: 67890 } })

      const result = await service.getPrice('bitcoin,ethereum', 'usd,eur')

      expect(result).toEqual({ bitcoin: { usd: 67890 } })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/simple/price`)
      expect(mock.history[0].query).toEqual({
        ids: 'bitcoin,ethereum',
        vs_currencies: 'usd,eur',
      })
    })

    it('includes market cap and 24h change flags as strings when enabled', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/price`).reply({ bitcoin: { usd: 1 } })

      await service.getPrice('bitcoin', 'usd', true, true)

      expect(mock.history[0].query).toEqual({
        ids: 'bitcoin',
        vs_currencies: 'usd',
        include_market_cap: 'true',
        include_24hr_change: 'true',
      })
    })

    it('omits flags when explicitly false', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/price`).reply({ bitcoin: { usd: 1 } })

      await service.getPrice('bitcoin', 'usd', false, false)

      expect(mock.history[0].query).toEqual({ ids: 'bitcoin', vs_currencies: 'usd' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/price`).replyWithError({ message: 'Bad request' })

      await expect(service.getPrice('bitcoin', 'usd')).rejects.toThrow(
        'CoinGecko API error: Bad request'
      )
    })
  })

  describe('getTokenPriceByContract', () => {
    it('url-encodes the platform and sends contract query', async () => {
      mock
        .onGet(`${ DEMO_BASE }/simple/token_price/ethereum`)
        .reply({ '0xdac17f958d2ee523a2206206994597c13d831ec7': { usd: 1 } })

      const result = await service.getTokenPriceByContract(
        'ethereum',
        '0xdac17f958d2ee523a2206206994597c13d831ec7',
        'usd'
      )

      expect(result).toEqual({ '0xdac17f958d2ee523a2206206994597c13d831ec7': { usd: 1 } })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/simple/token_price/ethereum`)
      expect(mock.history[0].query).toEqual({
        contract_addresses: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        vs_currencies: 'usd',
      })
    })

    it('encodes special characters in the platform id', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/token_price/binance%2Fsmart`).reply({})

      await service.getTokenPriceByContract('binance/smart', '0xabc', 'usd')

      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/simple/token_price/binance%2Fsmart`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/token_price/ethereum`).replyWithError({ message: 'Not found' })

      await expect(
        service.getTokenPriceByContract('ethereum', '0xabc', 'usd')
      ).rejects.toThrow('CoinGecko API error: Not found')
    })
  })

  describe('getSupportedVsCurrencies', () => {
    it('sends a GET to /simple/supported_vs_currencies', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/supported_vs_currencies`).reply(['btc', 'eth', 'usd'])

      const result = await service.getSupportedVsCurrencies()

      expect(result).toEqual(['btc', 'eth', 'usd'])
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/simple/supported_vs_currencies`)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/simple/supported_vs_currencies`).replyWithError({ message: 'Boom' })

      await expect(service.getSupportedVsCurrencies()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  // ── Coins ──

  describe('listCoins', () => {
    it('omits include_platform when not requested', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/list`).reply([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }])

      const result = await service.listCoins()

      expect(result).toEqual([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin' }])
      expect(mock.history[0].query).toEqual({})
    })

    it('includes include_platform when requested', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/list`).reply([])

      await service.listCoins(true)

      expect(mock.history[0].query).toEqual({ include_platform: 'true' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/list`).replyWithError({ message: 'Boom' })

      await expect(service.listCoins()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('coinsMarkets', () => {
    it('sends only the required vs_currency when nothing else is provided', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/markets`).reply([{ id: 'bitcoin' }])

      const result = await service.coinsMarkets('usd')

      expect(result).toEqual([{ id: 'bitcoin' }])
      expect(mock.history[0].query).toEqual({ vs_currency: 'usd' })
    })

    it('maps the order label to the API value and passes pagination', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/markets`).reply([])

      await service.coinsMarkets('usd', 'bitcoin,ethereum', 'Volume (High to Low)', 50, 2, '7d')

      expect(mock.history[0].query).toEqual({
        vs_currency: 'usd',
        ids: 'bitcoin,ethereum',
        order: 'volume_desc',
        per_page: 50,
        page: 2,
        price_change_percentage: '7d',
      })
    })

    it('passes an unmapped order value through unchanged', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/markets`).reply([])

      await service.coinsMarkets('usd', undefined, 'gecko_desc')

      expect(mock.history[0].query).toEqual({ vs_currency: 'usd', order: 'gecko_desc' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/markets`).replyWithError({ message: 'Boom' })

      await expect(service.coinsMarkets('usd')).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('getCoinData', () => {
    it('sends default toggle values (market data true, rest false)', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin`).reply({ id: 'bitcoin' })

      const result = await service.getCoinData('bitcoin')

      expect(result).toEqual({ id: 'bitcoin' })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/bitcoin`)
      expect(mock.history[0].query).toEqual({
        localization: 'false',
        tickers: 'false',
        market_data: 'true',
        community_data: 'false',
      })
    })

    it('honors all toggles when provided', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin`).reply({ id: 'bitcoin' })

      await service.getCoinData('bitcoin', true, true, false, true)

      expect(mock.history[0].query).toEqual({
        localization: 'true',
        tickers: 'true',
        market_data: 'false',
        community_data: 'true',
      })
    })

    it('url-encodes the coin id', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/wrapped%20btc`).reply({})

      await service.getCoinData('wrapped btc')

      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/wrapped%20btc`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin`).replyWithError({ message: 'Boom' })

      await expect(service.getCoinData('bitcoin')).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('getCoinMarketChart', () => {
    it('sends required params and omits automatic interval', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/market_chart`).reply({ prices: [] })

      const result = await service.getCoinMarketChart('bitcoin', 'usd', '7')

      expect(result).toEqual({ prices: [] })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/bitcoin/market_chart`)
      expect(mock.history[0].query).toEqual({ vs_currency: 'usd', days: '7' })
    })

    it('maps the interval label to the API value', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/market_chart`).reply({ prices: [] })

      await service.getCoinMarketChart('bitcoin', 'usd', '30', 'Daily')

      expect(mock.history[0].query).toEqual({ vs_currency: 'usd', days: '30', interval: 'daily' })
    })

    it('omits the interval when Automatic is chosen (maps to empty string)', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/market_chart`).reply({ prices: [] })

      await service.getCoinMarketChart('bitcoin', 'usd', '1', 'Automatic (granularity based on range)')

      expect(mock.history[0].query).toEqual({ vs_currency: 'usd', days: '1' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/market_chart`).replyWithError({ message: 'Boom' })

      await expect(service.getCoinMarketChart('bitcoin', 'usd', '7')).rejects.toThrow(
        'CoinGecko API error: Boom'
      )
    })
  })

  describe('getCoinOHLC', () => {
    it('sends vs_currency and days', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/ohlc`).reply([[1712000000000, 67000, 68200, 66800, 67890]])

      const result = await service.getCoinOHLC('bitcoin', 'usd', '7')

      expect(result).toEqual([[1712000000000, 67000, 68200, 66800, 67890]])
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/bitcoin/ohlc`)
      expect(mock.history[0].query).toEqual({ vs_currency: 'usd', days: '7' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/ohlc`).replyWithError({ message: 'Boom' })

      await expect(service.getCoinOHLC('bitcoin', 'usd', '7')).rejects.toThrow(
        'CoinGecko API error: Boom'
      )
    })
  })

  describe('getCoinHistory', () => {
    it('sends the date query and url-encodes the id', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/history`).reply({ id: 'bitcoin' })

      const result = await service.getCoinHistory('bitcoin', '30-12-2023')

      expect(result).toEqual({ id: 'bitcoin' })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/bitcoin/history`)
      expect(mock.history[0].query).toEqual({ date: '30-12-2023' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/bitcoin/history`).replyWithError({ message: 'Boom' })

      await expect(service.getCoinHistory('bitcoin', '30-12-2023')).rejects.toThrow(
        'CoinGecko API error: Boom'
      )
    })
  })

  // ── Search & Trending ──

  describe('search', () => {
    it('sends the query param', async () => {
      mock.onGet(`${ DEMO_BASE }/search`).reply({ coins: [{ id: 'bitcoin' }] })

      const result = await service.search('bitcoin')

      expect(result).toEqual({ coins: [{ id: 'bitcoin' }] })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/search`)
      expect(mock.history[0].query).toEqual({ query: 'bitcoin' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/search`).replyWithError({ message: 'Boom' })

      await expect(service.search('bitcoin')).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('getTrending', () => {
    it('sends a GET to /search/trending', async () => {
      mock.onGet(`${ DEMO_BASE }/search/trending`).reply({ coins: [], nfts: [], categories: [] })

      const result = await service.getTrending()

      expect(result).toEqual({ coins: [], nfts: [], categories: [] })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/search/trending`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/search/trending`).replyWithError({ message: 'Boom' })

      await expect(service.getTrending()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  // ── Global ──

  describe('getGlobalData', () => {
    it('sends a GET to /global', async () => {
      mock.onGet(`${ DEMO_BASE }/global`).reply({ data: { active_cryptocurrencies: 12345 } })

      const result = await service.getGlobalData()

      expect(result).toEqual({ data: { active_cryptocurrencies: 12345 } })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/global`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/global`).replyWithError({ message: 'Boom' })

      await expect(service.getGlobalData()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('getGlobalDefiData', () => {
    it('sends a GET to /global/decentralized_finance_defi', async () => {
      mock
        .onGet(`${ DEMO_BASE }/global/decentralized_finance_defi`)
        .reply({ data: { defi_market_cap: '95000000000' } })

      const result = await service.getGlobalDefiData()

      expect(result).toEqual({ data: { defi_market_cap: '95000000000' } })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/global/decentralized_finance_defi`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/global/decentralized_finance_defi`).replyWithError({ message: 'Boom' })

      await expect(service.getGlobalDefiData()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  // ── Exchanges ──

  describe('listExchanges', () => {
    it('omits pagination when not provided', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges`).reply([{ id: 'binance' }])

      const result = await service.listExchanges()

      expect(result).toEqual([{ id: 'binance' }])
      expect(mock.history[0].query).toEqual({})
    })

    it('passes per_page and page when provided', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges`).reply([])

      await service.listExchanges(25, 2)

      expect(mock.history[0].query).toEqual({ per_page: 25, page: 2 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges`).replyWithError({ message: 'Boom' })

      await expect(service.listExchanges()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  describe('getExchange', () => {
    it('fetches an exchange by id', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges/binance`).reply({ name: 'Binance' })

      const result = await service.getExchange('binance')

      expect(result).toEqual({ name: 'Binance' })
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/exchanges/binance`)
    })

    it('url-encodes the exchange id', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges/gate%20io`).reply({})

      await service.getExchange('gate io')

      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/exchanges/gate%20io`)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/exchanges/binance`).replyWithError({ message: 'Boom' })

      await expect(service.getExchange('binance')).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  // ── Categories ──

  describe('listCategories', () => {
    it('sends no query params when no order is provided', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/categories`).reply([{ id: 'layer-1' }])

      const result = await service.listCategories()

      expect(result).toEqual([{ id: 'layer-1' }])
      expect(mock.history[0].url).toBe(`${ DEMO_BASE }/coins/categories`)
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the order label to the API value', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/categories`).reply([])

      await service.listCategories('24h Change (High to Low)')

      expect(mock.history[0].query).toEqual({ order: 'market_cap_change_24h_desc' })
    })

    it('passes an unmapped order value through unchanged', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/categories`).reply([])

      await service.listCategories('name_asc')

      expect(mock.history[0].query).toEqual({ order: 'name_asc' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onGet(`${ DEMO_BASE }/coins/categories`).replyWithError({ message: 'Boom' })

      await expect(service.listCategories()).rejects.toThrow('CoinGecko API error: Boom')
    })
  })

  // ── Error message shaping ──

  describe('error message shaping', () => {
    it('prefers the CoinGecko status.error_message and includes the HTTP status', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).replyWithError({
        status: 400,
        body: { status: { error_message: 'coin not found' } },
      })

      await expect(service.ping()).rejects.toThrow('CoinGecko API error: coin not found (HTTP 400)')
    })

    it('appends a rate-limit hint on HTTP 429', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).replyWithError({
        statusCode: 429,
        body: { status: { error_message: 'Too Many Requests' } },
      })

      await expect(service.ping()).rejects.toThrow(
        /Too Many Requests \(HTTP 429\) - Rate limit exceeded/
      )
    })

    it('falls back to error.body.error when no status message is present', async () => {
      mock.onGet(`${ DEMO_BASE }/ping`).replyWithError({
        status: 401,
        body: { error: 'invalid api key' },
      })

      await expect(service.ping()).rejects.toThrow('CoinGecko API error: invalid api key (HTTP 401)')
    })
  })
})

// ── Pro tier ──

describe('CoinGecko Service (Pro tier)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({ apiKey: API_KEY, plan: 'Pro' })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('uses the pro base url and the pro api-key header', async () => {
    mock.onGet(`${ PRO_BASE }/ping`).reply({ gecko_says: '(V3) To the Moon!' })

    await service.ping()

    expect(mock.history[0].url).toBe(`${ PRO_BASE }/ping`)
    expect(mock.history[0].headers).toMatchObject({
      'x-cg-pro-api-key': API_KEY,
      'Content-Type': 'application/json',
    })
    expect(mock.history[0].headers).not.toHaveProperty('x-cg-demo-api-key')
  })

  it('builds pro-tier urls for path methods', async () => {
    mock.onGet(`${ PRO_BASE }/coins/bitcoin/market_chart`).reply({ prices: [] })

    await service.getCoinMarketChart('bitcoin', 'usd', '7')

    expect(mock.history[0].url).toBe(`${ PRO_BASE }/coins/bitcoin/market_chart`)
  })
})

// ── No API key (free public tier) ──

describe('CoinGecko Service (no API key)', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    jest.resetModules()
    sandbox = createSandbox({})
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  it('sends no api-key header when no key is configured', async () => {
    mock.onGet(`${ DEMO_BASE }/ping`).reply({ gecko_says: '(V3) To the Moon!' })

    await service.ping()

    expect(mock.history[0].headers).toEqual({ 'Content-Type': 'application/json' })
    expect(mock.history[0].url).toBe(`${ DEMO_BASE }/ping`)
  })
})
