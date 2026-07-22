'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const DEFAULT_LINK = 'https://www.peekalink.io'

describe('Peekalink Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('peekalink')
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

  // ── Link Preview ──

  describe('checkAvailability', () => {
    it('reports availability for a previewable link', async () => {
      const link = testValues.link || DEFAULT_LINK

      const result = await service.checkAvailability(link)

      expect(result).toHaveProperty('isAvailable')
      expect(typeof result.isAvailable).toBe('boolean')
    })

    it('reports a non-previewable link as unavailable', async () => {
      const result = await service.checkAvailability('https://this-domain-does-not-exist-flowrunner.invalid')

      expect(result).toHaveProperty('isAvailable')
    })
  })

  describe('previewLink', () => {
    it('returns a rich preview for a link', async () => {
      const link = testValues.link || DEFAULT_LINK

      const result = await service.previewLink(link)

      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('domain')
      expect(result).toHaveProperty('type')
    })

    it('rejects an invalid link with a descriptive error', async () => {
      await expect(service.previewLink('not-a-valid-url')).rejects.toThrow(/Peekalink API error/)
    })
  })
})
