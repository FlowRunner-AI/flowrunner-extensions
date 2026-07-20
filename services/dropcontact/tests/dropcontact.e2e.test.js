'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Dropcontact Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('dropcontact')
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

  // ── Validation (no credits consumed) ──

  describe('enrichContacts validation', () => {
    it('rejects when no usable contact data is provided', async () => {
      await expect(service.enrichContacts()).rejects.toThrow(/provide at least an email/)
    })
  })

  describe('getEnrichmentResult validation', () => {
    it('rejects when requestId is missing', async () => {
      await expect(service.getEnrichmentResult()).rejects.toThrow(/requestId is required/)
    })
  })

  // ── Submit + poll (consumes 1 credit) ──
  //
  // These submit a real enrichment batch, so they only run when the developer
  // supplies testValues.enrichEmail (opt-in to spending a Dropcontact credit).

  describe('enrichContacts + getEnrichmentResult', () => {
    const canEnrich = () => Boolean(testValues.enrichEmail)
    let requestId

    it('submits a contact and returns a request_id', async () => {
      if (!canEnrich()) {
        console.log('Skipping enrichContacts submit: set testValues.enrichEmail to run a real enrichment')
        return
      }

      const response = await service.enrichContacts(testValues.enrichEmail)

      expect(response).toHaveProperty('request_id')
      expect(typeof response.request_id).toBe('string')
      requestId = response.request_id
    })

    it('fetches the result for the submitted request_id', async () => {
      if (!canEnrich() || !requestId) {
        console.log('Skipping getEnrichmentResult: no request_id from submit step')
        return
      }

      // Enrichment is async; the result may not be ready immediately. We only
      // assert on the response shape (success flag present), not on the data.
      const response = await service.getEnrichmentResult(requestId)

      expect(response).toHaveProperty('success')
    })
  })

  // ── Convenience submit + internal poll (consumes 1 credit, may take ~90s) ──
  //
  // enrichAndWait polls internally for up to ~90 seconds. It only runs when the
  // developer opts in via testValues.enrichAndWait (a truthy flag) AND provides
  // testValues.enrichEmail. The test timeout is raised to accommodate polling.

  describe('enrichAndWait', () => {
    const canRun = () => Boolean(testValues.enrichEmail && testValues.enrichAndWait)

    it(
      'returns a completed or pending status with a request_id',
      async () => {
        if (!canRun()) {
          console.log(
            'Skipping enrichAndWait: set testValues.enrichEmail and testValues.enrichAndWait=true to run (may take ~90s)'
          )
          return
        }

        const response = await service.enrichAndWait(testValues.enrichEmail)

        expect(response).toHaveProperty('status')
        expect(['completed', 'pending']).toContain(response.status)
        expect(response).toHaveProperty('request_id')
      },
      120000
    )
  })
})
