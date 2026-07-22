'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Salesmate Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('salesmate')
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

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('lists active users', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('cursor', null)
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists pipelines', async () => {
      const result = await service.getPipelinesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists the stages of the first pipeline', async () => {
      const pipelines = await service.getPipelinesDictionary({})

      if (!pipelines.items.length) {
        console.log('Skipping getStagesDictionary: no pipelines in the workspace')

        return
      }

      const result = await service.getStagesDictionary({ criteria: { pipeline: pipelines.items[0].value } })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns an empty list without pipeline criteria', async () => {
      await expect(service.getStagesDictionary({})).resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ── Contacts ──

  describe('contacts lifecycle', () => {
    let contactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        `E2E Contact ${ SUFFIX }`,
        `e2e-contact-${ SUFFIX }@example.com`,
        undefined,
        undefined,
        'QA Engineer'
      )

      expect(result).toHaveProperty('id')

      contactId = result.id
    })

    it('reads the created contact back', async () => {
      if (!contactId) {
        console.log('Skipping getContact: contact was not created')

        return
      }

      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
    })

    it('lists contacts', async () => {
      const result = await service.listContacts(undefined, undefined, undefined, 'Descending', 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the contact', async () => {
      if (!contactId) {
        console.log('Skipping updateContact: contact was not created')

        return
      }

      const result = await service.updateContact(contactId, `E2E Contact ${ SUFFIX } Updated`)

      expect(result).toBeDefined()
    })

    it('deletes the contact', async () => {
      if (!contactId) {
        console.log('Skipping deleteContact: contact was not created')

        return
      }

      await expect(service.deleteContact(contactId)).resolves.toEqual({ deleted: true, id: contactId })
    })
  })

  // ── Companies ──

  describe('companies lifecycle', () => {
    let companyId

    it('creates a company', async () => {
      const result = await service.createCompany(`E2E Company ${ SUFFIX }`, undefined, undefined, 'https://example.com')

      expect(result).toHaveProperty('id')

      companyId = result.id
    })

    it('reads the created company back', async () => {
      if (!companyId) {
        console.log('Skipping getCompany: company was not created')

        return
      }

      const result = await service.getCompany(companyId)

      expect(result).toHaveProperty('id', companyId)
    })

    it('lists companies', async () => {
      const result = await service.listCompanies(undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the company', async () => {
      if (!companyId) {
        console.log('Skipping updateCompany: company was not created')

        return
      }

      const result = await service.updateCompany(companyId, `E2E Company ${ SUFFIX } Updated`)

      expect(result).toBeDefined()
    })

    it('deletes the company', async () => {
      if (!companyId) {
        console.log('Skipping deleteCompany: company was not created')

        return
      }

      await expect(service.deleteCompany(companyId)).resolves.toEqual({ deleted: true, id: companyId })
    })
  })

  // ── Deals ──

  describe('deals lifecycle', () => {
    let dealId

    it('creates a deal', async () => {
      const { pipelineId, stageId } = testValues
      const result = await service.createDeal(`E2E Deal ${ SUFFIX }`, pipelineId, stageId, 1000)

      expect(result).toHaveProperty('id')

      dealId = result.id
    })

    it('reads the created deal back', async () => {
      if (!dealId) {
        console.log('Skipping getDeal: deal was not created')

        return
      }

      const result = await service.getDeal(dealId)

      expect(result).toHaveProperty('id', dealId)
    })

    it('lists deals', async () => {
      const result = await service.listDeals(undefined, undefined, undefined, undefined, 1, 5)

      expect(result).toBeDefined()
    })

    it('updates the deal status', async () => {
      if (!dealId) {
        console.log('Skipping updateDeal: deal was not created')

        return
      }

      const result = await service.updateDeal(dealId, undefined, undefined, 2000, 'Open')

      expect(result).toBeDefined()
    })

    it('deletes the deal', async () => {
      if (!dealId) {
        console.log('Skipping deleteDeal: deal was not created')

        return
      }

      await expect(service.deleteDeal(dealId)).resolves.toEqual({ deleted: true, id: dealId })
    })
  })

  // ── Activities ──

  describe('activities', () => {
    it('creates an activity and lists activities', async () => {
      const created = await service.createActivity(`E2E Activity ${ SUFFIX }`, 'Task', new Date().toISOString())

      expect(created).toHaveProperty('id')

      const list = await service.listActivities(undefined, undefined, undefined, undefined, 1, 5)

      expect(list).toBeDefined()
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for a missing contact', async () => {
      await expect(service.getContact(999999999)).rejects.toThrow(/Salesmate API error/)
    })
  })
})
