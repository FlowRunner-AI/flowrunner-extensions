'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MailerLite Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('mailerlite')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  const suffix = Date.now()

  // ── Fields ──

  describe('listFields', () => {
    it('returns fields with expected shape', async () => {
      const result = await service.listFields()

      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)

      if (result.fields.length > 0) {
        expect(result.fields[0]).toHaveProperty('key')
        expect(result.fields[0]).toHaveProperty('type')
      }
    })
  })

  // ── Groups ──

  describe('createGroup + listGroups + deleteGroup', () => {
    let groupId

    it('creates a group', async () => {
      const result = await service.createGroup(`E2E Group ${ suffix }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `E2E Group ${ suffix }`)
      groupId = result.id
    })

    it('lists groups and finds the created one', async () => {
      const result = await service.listGroups(`E2E Group ${ suffix }`)

      expect(result).toHaveProperty('groups')
      expect(Array.isArray(result.groups)).toBe(true)
      expect(result.groups.some(g => String(g.id) === String(groupId))).toBe(true)
    })

    it('deletes the created group', async () => {
      const result = await service.deleteGroup(groupId)

      expect(result).toEqual({ deleted: true, groupId: String(groupId) })
    })
  })

  // ── Subscribers ──

  describe('upsertSubscriber + getSubscriber + updateSubscriber + deleteSubscriber', () => {
    const email = `e2e-mailerlite-${ suffix }@example.com`
    let subscriberId

    it('creates a subscriber via upsert', async () => {
      const result = await service.upsertSubscriber(email, { name: 'E2E', last_name: 'Test' })

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', email)
      subscriberId = result.id
    })

    it('retrieves the subscriber by email', async () => {
      const result = await service.getSubscriber(email)

      expect(result).toHaveProperty('id', subscriberId)
      expect(result).toHaveProperty('email', email)
    })

    it('updates the subscriber fields', async () => {
      const result = await service.updateSubscriber(subscriberId, { name: 'Updated' })

      expect(result).toHaveProperty('id', subscriberId)
    })

    it('deletes the subscriber', async () => {
      const result = await service.deleteSubscriber(subscriberId)

      expect(result).toEqual({ deleted: true, subscriberId: String(subscriberId) })
    })
  })

  describe('listSubscribers', () => {
    it('returns subscribers with expected shape', async () => {
      const result = await service.listSubscribers(undefined, 5)

      expect(result).toHaveProperty('subscribers')
      expect(Array.isArray(result.subscribers)).toBe(true)
      expect(result).toHaveProperty('nextCursor')
      expect(result).toHaveProperty('prevCursor')
    })
  })

  // ── Group assignment ──

  describe('assignSubscriberToGroup + removeSubscriberFromGroup', () => {
    const email = `e2e-group-assign-${ suffix }@example.com`
    let subscriberId
    let groupId

    beforeAll(async () => {
      const sub = await service.upsertSubscriber(email, { name: 'GroupTest' })
      subscriberId = sub.id

      const grp = await service.createGroup(`E2E Assign Group ${ suffix }`)
      groupId = grp.id
    })

    it('assigns subscriber to group', async () => {
      const result = await service.assignSubscriberToGroup(subscriberId, groupId)

      expect(result).toHaveProperty('id')
    })

    it('removes subscriber from group', async () => {
      const result = await service.removeSubscriberFromGroup(subscriberId, groupId)

      expect(result).toEqual({
        removed: true,
        subscriberId: String(subscriberId),
        groupId: String(groupId),
      })
    })

    afterAll(async () => {
      try {
        await service.deleteSubscriber(subscriberId)
      } catch (e) { /* ignore */ }

      try {
        await service.deleteGroup(groupId)
      } catch (e) { /* ignore */ }
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns with expected shape', async () => {
      const result = await service.listCampaigns('Sent', 5)

      expect(result).toHaveProperty('campaigns')
      expect(Array.isArray(result.campaigns)).toBe(true)
      expect(result).toHaveProperty('total')
    })
  })

  // ── Dictionaries ──

  describe('getGroupsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
