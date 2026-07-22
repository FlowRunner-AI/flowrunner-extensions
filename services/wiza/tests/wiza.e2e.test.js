'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Wiza Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('wiza')
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

  describe('getCredits', () => {
    it('returns the account credit balances', async () => {
      const result = await service.getCredits()

      expect(result).toHaveProperty('credits')
    })
  })

  // ── Lists ──

  describe('getList', () => {
    it('returns the list identified by testValues.listId', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping getList: testValues.listId not set')

        return
      }

      const result = await service.getList(String(listId))

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
    })

    it('rejects a missing list id', async () => {
      await expect(service.getList()).rejects.toThrow('The "listId" parameter is required and must be a string.')
    })
  })

  describe('getListContacts', () => {
    it('returns contacts for the "people" segment', async () => {
      const { listId } = testValues

      if (!listId) {
        console.log('Skipping getListContacts: testValues.listId not set')

        return
      }

      const result = await service.getListContacts(String(listId), 'people')

      expect(result).toHaveProperty('data')
    })

    it('rejects an unsupported segment', async () => {
      await expect(service.getListContacts('1', 'everything')).rejects.toThrow(
        'The "segment" must be one of: people, valid, risky.'
      )
    })
  })

  // ── Individual reveals ──

  describe('getIndividualReveal', () => {
    it('returns a previously started reveal', async () => {
      const { revealId } = testValues

      if (!revealId) {
        console.log('Skipping getIndividualReveal: testValues.revealId not set')

        return
      }

      const result = await service.getIndividualReveal(String(revealId))

      expect(result).toHaveProperty('data')
    })

    it('rejects a missing reveal id', async () => {
      await expect(service.getIndividualReveal()).rejects.toThrow('The "revealId" parameter is required')
    })
  })

  describe('startIndividualReveal', () => {
    it('starts an enrichment for testValues.revealEmail', async () => {
      const { revealEmail } = testValues

      if (!revealEmail) {
        console.log('Skipping startIndividualReveal: testValues.revealEmail not set (consumes credits)')

        return
      }

      const result = await service.startIndividualReveal({ email: revealEmail }, 'none')

      expect(result).toHaveProperty('data')
      expect(result.data).toHaveProperty('id')
    })

    it('rejects a contact with no usable identifier', async () => {
      await expect(service.startIndividualReveal({ company: 'Acme' }, 'none')).rejects.toThrow(
        'Invalid contact format.'
      )
    })
  })

  // ── Prospect search ──

  describe('searchProspects', () => {
    it('returns matching prospect profiles', async () => {
      if (!testValues.runProspectSearch) {
        console.log('Skipping searchProspects: testValues.runProspectSearch not set (consumes credits)')

        return
      }

      const result = await service.searchProspects(['CEO'], ['Toronto'], undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, 1)

      expect(result).toHaveProperty('data')
    })
  })
})
