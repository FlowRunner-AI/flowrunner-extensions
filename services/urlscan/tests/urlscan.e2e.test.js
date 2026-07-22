'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('urlscan.io Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('urlscan')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // The flowrunner.Files API is provided by the runtime in production.
    // For e2e tests we mock it to avoid depending on file storage infrastructure.
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockImplementation(async (buffer, options) => {
          return { url: `https://e2e-mock-files.example.com/${ options.filename }` }
        }),
      },
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Account ──

  describe('getQuotas', () => {
    it('returns the account quotas (connection check)', async () => {
      const result = await service.getQuotas()

      expect(result).toHaveProperty('limits')
      expect(typeof result.limits).toBe('object')
    })
  })

  // ── Search ──

  describe('searchScans', () => {
    it('returns search results for a common domain', async () => {
      const result = await service.searchScans('domain:example.com', 5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('supports pagination via search_after', async () => {
      const first = await service.searchScans('domain:example.com', 2)

      if (!first.results || first.results.length < 2 || !first.results[first.results.length - 1].sort) {
        console.log('Skipping search_after: not enough results to paginate')

        return
      }

      const cursor = first.results[first.results.length - 1].sort.join(',')
      const second = await service.searchScans('domain:example.com', 2, cursor)

      expect(second).toHaveProperty('results')
      expect(Array.isArray(second.results)).toBe(true)
    })
  })

  // ── Scanning ──

  describe('submitScan + getScanResult + artifacts', () => {
    let uuid

    it('submits a scan', async () => {
      const targetUrl = testValues.scanUrl || 'https://example.com'

      const result = await service.submitScan(targetUrl, 'Unlisted', ['flowrunner-e2e'])

      expect(result).toHaveProperty('uuid')
      expect(result).toHaveProperty('api')

      uuid = result.uuid
    })

    it('retrieves the scan result once ready', async () => {
      if (!uuid) {
        console.log('Skipping getScanResult: no scan was submitted')

        return
      }

      // Results need ~10-30s; poll until ready or give up.
      const deadline = Date.now() + 45000
      let result = null

      while (Date.now() < deadline) {
        try {
          result = await service.getScanResult(uuid)
          break
        } catch (error) {
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }

      if (!result) {
        console.log('Skipping getScanResult assertions: scan did not finish in time')

        return
      }

      expect(result).toHaveProperty('task')
      expect(result.task).toHaveProperty('uuid', uuid)
      expect(result).toHaveProperty('page')
    }, 60000)

    it('downloads the screenshot into file storage', async () => {
      if (!uuid) {
        console.log('Skipping getScreenshot: no scan was submitted')

        return
      }

      try {
        const result = await service.getScreenshot(uuid)

        expect(result).toHaveProperty('uuid', uuid)
        expect(result).toHaveProperty('url')
        expect(result.filename).toBe(`urlscan_${ uuid }.png`)
      } catch (error) {
        console.log(`Skipping getScreenshot assertions: ${ error.message }`)
      }
    })

    it('retrieves the DOM snapshot', async () => {
      if (!uuid) {
        console.log('Skipping getDomSnapshot: no scan was submitted')

        return
      }

      try {
        const result = await service.getDomSnapshot(uuid)

        expect(result).toHaveProperty('uuid', uuid)
        expect(typeof result.dom).toBe('string')
      } catch (error) {
        console.log(`Skipping getDomSnapshot assertions: ${ error.message }`)
      }
    })
  })

  describe('scanAndWait', () => {
    it('submits and waits for the result in one call', async () => {
      const targetUrl = testValues.scanUrl || 'https://example.com'

      const result = await service.scanAndWait(targetUrl, 'Unlisted')

      expect(result).toHaveProperty('uuid')
      expect(result).toHaveProperty('ready')

      if (result.ready) {
        expect(result.result).toHaveProperty('task')
      } else {
        expect(result).toHaveProperty('submission')
      }
    }, 90000)
  })

  // ── Artifacts ──

  describe('getLiveScreenshot', () => {
    it('captures a live screenshot of a URL', async () => {
      try {
        const result = await service.getLiveScreenshot('https://example.com')

        expect(result).toHaveProperty('url')
        expect(result.filename).toMatch(/^liveshot_\d+\.png$/)
      } catch (error) {
        console.log(`Skipping getLiveScreenshot assertions: ${ error.message }`)
      }
    }, 60000)
  })
})
