'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * These e2e tests need a reachable Splunk instance.
 *
 * Fill in service-sandbox/e2e-config.json:
 *   "splunk": {
 *     "configs": {
 *       "managementUrl": "https://myhost:8089",
 *       "authToken": "<bearer token>",
 *       "hecUrl": "https://myhost:8088",
 *       "hecToken": "<hec token>"
 *     },
 *     "testValues": {
 *       "index": "main",
 *       "savedSearchName": "Errors last 24h"
 *     }
 *   }
 *
 * hecUrl / hecToken and every testValue are optional — the tests that need them
 * skip gracefully when they are absent.
 */
describe('Splunk Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('splunk')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Server ──

  describe('getServerInfo', () => {
    it('returns the server version and identity', async () => {
      const result = await service.getServerInfo()

      expect(result).toHaveProperty('entry')
      expect(Array.isArray(result.entry)).toBe(true)
      expect(result.entry[0]).toHaveProperty('content')
      expect(result.entry[0].content).toHaveProperty('version')
    })
  })

  // ── Indexes ──

  describe('indexes', () => {
    it('lists indexes with paging', async () => {
      const result = await service.listIndexes(5, 0)

      expect(Array.isArray(result.entry)).toBe(true)
      expect(result.entry.length).toBeLessThanOrEqual(5)
    })

    it('gets a single index by name', async () => {
      const name = (testValues && testValues.index) || 'main'
      const result = await service.getIndex(name)

      expect(Array.isArray(result.entry)).toBe(true)
      expect(result.entry[0]).toHaveProperty('name', name)
      expect(result.entry[0].content).toHaveProperty('totalEventCount')
    })

    it('fails for an unknown index', async () => {
      await expect(service.getIndex('no_such_index_e2e')).rejects.toThrow(/Splunk API error/)
    })
  })

  // ── Search ──

  describe('runOneshotSearch', () => {
    it('returns results in a single call', async () => {
      const result = await service.runOneshotSearch('| makeresults count=2', '-5m', 'now', 2)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('rejects invalid SPL', async () => {
      await expect(service.runOneshotSearch('this is not spl')).rejects.toThrow(/Splunk API error/)
    })
  })

  describe('search job lifecycle', () => {
    let sid

    it('creates a search job', async () => {
      const result = await service.createSearchJob('search index=_internal | head 5', '-15m', 'now')

      expect(result).toHaveProperty('sid')
      expect(typeof result.sid).toBe('string')

      sid = result.sid
    })

    it('reports the job status', async () => {
      if (!sid) {
        console.log('Skipping getSearchJobStatus: no sid was created')

        return
      }

      const result = await service.getSearchJobStatus(sid)

      expect(Array.isArray(result.entry)).toBe(true)
      expect(result.entry[0].content).toHaveProperty('dispatchState')
    })

    it('fetches the job results', async () => {
      if (!sid) {
        console.log('Skipping getSearchResults: no sid was created')

        return
      }

      // Poll until the job finishes so results are complete.
      for (let attempt = 0; attempt < 20; attempt++) {
        const status = await service.getSearchJobStatus(sid)
        const content = status.entry[0].content

        if (content.isDone === true || content.isDone === '1' || content.dispatchState === 'DONE') {
          break
        }

        await new Promise(resolve => setTimeout(resolve, 500))
      }

      const result = await service.getSearchResults(sid, 5, 0)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('cancels (and removes) the job', async () => {
      if (!sid) {
        console.log('Skipping cancelSearchJob: no sid was created')

        return
      }

      await expect(service.cancelSearchJob(sid)).resolves.toBeDefined()
    })
  })

  // ── Saved searches ──

  describe('saved searches', () => {
    it('lists saved searches', async () => {
      const result = await service.listSavedSearches(5, 0)

      expect(Array.isArray(result.entry)).toBe(true)
    })

    it('gets and dispatches a saved search', async () => {
      const name = testValues && testValues.savedSearchName

      if (!name) {
        console.log('Skipping saved search detail: testValues.savedSearchName not set')

        return
      }

      const detail = await service.getSavedSearch(name)

      expect(detail.entry[0]).toHaveProperty('name', name)

      const dispatched = await service.runSavedSearch(name, '-15m', 'now')

      expect(dispatched).toHaveProperty('sid')

      await service.cancelSearchJob(dispatched.sid)
    })
  })

  // ── HTTP Event Collector ──

  describe('HTTP Event Collector', () => {
    function hecReady() {
      return Boolean(service.hecUrl && service.hecToken)
    }

    it('sends a structured event', async () => {
      if (!hecReady()) {
        console.log('Skipping sendEvent: hecUrl / hecToken are not configured')

        return
      }

      const result = await service.sendEvent(
        JSON.stringify({ action: 'e2e-test', at: Date.now() }),
        '_json',
        testValues && testValues.index,
        'flowrunner-e2e'
      )

      expect(result).toHaveProperty('code', 0)
      expect(result).toHaveProperty('text', 'Success')
    })

    it('sends a raw event', async () => {
      if (!hecReady()) {
        console.log('Skipping sendRawEvent: hecUrl / hecToken are not configured')

        return
      }

      const result = await service.sendRawEvent(
        `flowrunner e2e raw event ${ Date.now() }`,
        undefined,
        testValues && testValues.index,
        'flowrunner-e2e'
      )

      expect(result).toHaveProperty('code', 0)
    })
  })
})
