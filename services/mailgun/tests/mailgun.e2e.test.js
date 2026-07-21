'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mailgun Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('mailgun')
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

  const suffix = Date.now()

  // ── Domains ──

  describe('listDomains', () => {
    it('returns domains with expected shape', async () => {
      const result = await service.listDomains(5, 0)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('total_count')
    })
  })

  describe('getDomain', () => {
    it('returns domain details when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping getDomain: set testValues.domain')
        return
      }

      const result = await service.getDomain(testValues.domain)

      expect(result).toHaveProperty('domain')
      expect(result.domain).toHaveProperty('name', testValues.domain)
      expect(result).toHaveProperty('sending_dns_records')
      expect(result).toHaveProperty('receiving_dns_records')
    })
  })

  describe('getDomainsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDomainsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Events ──

  describe('getEvents', () => {
    it('returns events with expected shape when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping getEvents: set testValues.domain')
        return
      }

      const result = await service.getEvents(testValues.domain, undefined, undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('paging')
    })
  })

  // ── Suppressions ──

  describe('listBounces', () => {
    it('returns bounces with expected shape when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping listBounces: set testValues.domain')
        return
      }

      const result = await service.listBounces(testValues.domain, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listUnsubscribes', () => {
    it('returns unsubscribes with expected shape when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping listUnsubscribes: set testValues.domain')
        return
      }

      const result = await service.listUnsubscribes(testValues.domain, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('addUnsubscribe + deleteUnsubscribe', () => {
    const testAddress = `e2e-unsub-${ Date.now() }@example.com`

    it('adds an unsubscribe when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping addUnsubscribe: set testValues.domain')
        return
      }

      const result = await service.addUnsubscribe(testValues.domain, testAddress)

      expect(result).toHaveProperty('message')
    })

    it('removes the unsubscribe', async () => {
      if (!testValues.domain) {
        console.log('Skipping deleteUnsubscribe: set testValues.domain')
        return
      }

      const result = await service.deleteUnsubscribe(testValues.domain, testAddress)

      expect(result).toHaveProperty('message')
    })
  })

  describe('listComplaints', () => {
    it('returns complaints with expected shape when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping listComplaints: set testValues.domain')
        return
      }

      const result = await service.listComplaints(testValues.domain, 5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Statistics ──

  describe('getStats', () => {
    it('returns stats with expected shape when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping getStats: set testValues.domain')
        return
      }

      const result = await service.getStats(['Delivered'], testValues.domain, '7d')

      expect(result).toHaveProperty('stats')
      expect(Array.isArray(result.stats)).toBe(true)
    })
  })

  // ── Mailing Lists ──

  describe('createMailingList + getMailingList + listMembers + addListMember + deleteListMember + deleteMailingList', () => {
    let listAddress

    it('creates a mailing list when domain is configured', async () => {
      if (!testValues.domain) {
        console.log('Skipping mailing list lifecycle: set testValues.domain')
        return
      }

      listAddress = `e2e-list-${ suffix }@${ testValues.domain }`

      const result = await service.createMailingList(listAddress, `E2E List ${ suffix }`, 'E2E test list', 'Read Only')

      expect(result).toHaveProperty('list')
      expect(result.list).toHaveProperty('address', listAddress)
      expect(result).toHaveProperty('message')
    })

    it('retrieves the created mailing list', async () => {
      if (!listAddress) {
        return
      }

      const result = await service.getMailingList(listAddress)

      expect(result).toHaveProperty('list')
      expect(result.list).toHaveProperty('address', listAddress)
    })

    it('adds a member to the mailing list', async () => {
      if (!listAddress) {
        return
      }

      const result = await service.addListMember(listAddress, 'e2e-member@example.com', 'E2E Member', { role: 'tester' }, true, false)

      expect(result).toHaveProperty('member')
      expect(result.member).toHaveProperty('address', 'e2e-member@example.com')
    })

    it('lists members of the mailing list', async () => {
      if (!listAddress) {
        return
      }

      const result = await service.listMembers(listAddress)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThanOrEqual(1)
    })

    it('deletes the member from the mailing list', async () => {
      if (!listAddress) {
        return
      }

      const result = await service.deleteListMember(listAddress, 'e2e-member@example.com')

      expect(result).toHaveProperty('member')
    })

    it('deletes the mailing list', async () => {
      if (!listAddress) {
        return
      }

      const result = await service.deleteMailingList(listAddress)

      expect(result).toHaveProperty('message')
    })
  })

  describe('listMailingLists', () => {
    it('returns mailing lists with expected shape', async () => {
      const result = await service.listMailingLists(5)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getMailingListsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getMailingListsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Email Sending ──

  describe('sendEmail', () => {
    it('sends an email in test mode when domain and sender are configured', async () => {
      if (!testValues.domain || !testValues.senderEmail) {
        console.log('Skipping sendEmail: set testValues.domain and testValues.senderEmail')
        return
      }

      const recipientEmail = testValues.recipientEmail || testValues.senderEmail

      const result = await service.sendEmail(
        testValues.domain,
        testValues.senderEmail,
        recipientEmail,
        `E2E Test ${ suffix }`,
        'This is an automated e2e test email.',
        '<p>This is an automated <strong>e2e test</strong> email.</p>',
        undefined, undefined, undefined,
        undefined, ['e2e-test'], undefined,
        true // test mode
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('message')
    })
  })
})
