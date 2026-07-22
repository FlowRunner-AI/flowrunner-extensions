'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('uProc Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('uproc')
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

  // ── Account ──

  describe('getProfile', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getProfile()

      expect(result).toBeDefined()
      expect(typeof result).toBe('object')
    })
  })

  // ── Catalog ──

  describe('listGroups', () => {
    it('returns the tool groups', async () => {
      const result = await service.listGroups()

      expect(result).toBeDefined()
    })
  })

  describe('listTools', () => {
    it('returns all tools', async () => {
      const result = await service.listTools()

      expect(result).toBeDefined()
    })

    it('returns tools filtered by group', async () => {
      const result = await service.listTools('email')

      expect(result).toBeDefined()
    })
  })

  // ── Tools ──

  describe('runTool', () => {
    it('runs an arbitrary processor by name', async () => {
      const email = testValues.email

      if (!email) {
        console.log('Skipping runTool: testValues.email not set')

        return
      }

      const result = await service.runTool('email-check-exists', { email })

      expect(result).toHaveProperty('processor', 'email-check-exists')
      expect(result).toHaveProperty('raw')
    })

    it('throws for an unknown processor', async () => {
      await expect(
        service.runTool('definitely-not-a-real-tool', { foo: 'bar' })
      ).rejects.toThrow(/uProc API error/)
    })
  })

  describe('verifyEmail', () => {
    it('verifies an email address', async () => {
      const email = testValues.email

      if (!email) {
        console.log('Skipping verifyEmail: testValues.email not set')

        return
      }

      const result = await service.verifyEmail(email)

      expect(result).toHaveProperty('processor', 'email-check-exists')
      expect(result).toHaveProperty('result')
    })
  })

  describe('verifyPhone', () => {
    it('verifies a phone number', async () => {
      const { phone, country } = testValues

      if (!phone || !country) {
        console.log('Skipping verifyPhone: testValues.phone or country not set')

        return
      }

      const result = await service.verifyPhone(phone, country)

      expect(result).toHaveProperty('processor', 'phone-check-exists')
      expect(result).toHaveProperty('result')
    })
  })

  describe('getGenderByName', () => {
    it('infers gender for a first name', async () => {
      const name = testValues.firstName

      if (!name) {
        console.log('Skipping getGenderByName: testValues.firstName not set')

        return
      }

      const result = await service.getGenderByName(name)

      expect(result).toHaveProperty('processor', 'name-get-gender')
      expect(result).toHaveProperty('result')
    })
  })

  describe('companySearch', () => {
    it('searches for a company by name', async () => {
      const { companyName, country } = testValues

      if (!companyName || !country) {
        console.log('Skipping companySearch: testValues.companyName or country not set')

        return
      }

      const result = await service.companySearch(companyName, country)

      expect(result).toHaveProperty('processor', 'company-search-by-name')
      expect(result).toHaveProperty('result')
    })
  })
})
