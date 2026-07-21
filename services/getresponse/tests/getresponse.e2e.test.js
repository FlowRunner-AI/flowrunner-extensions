'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('GetResponse Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('getresponse')
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

  // A unique-ish suffix so repeated e2e runs don't collide, plus a lowercase
  // variant for resources (campaigns, custom fields) that require lowercase names.
  const suffix = Date.now()
  const lcSuffix = String(suffix)

  // ── Campaigns (Lists) ──

  describe('listCampaigns', () => {
    it('returns campaigns as an array', async () => {
      const response = await service.listCampaigns()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCampaign', () => {
    // Needs an existing campaign. Uses testValues.campaignId when provided,
    // otherwise the first campaign returned by the account.
    it('returns a campaign with expected shape', async () => {
      let campaignId = testValues.campaignId

      if (!campaignId) {
        const campaigns = await service.listCampaigns()

        if (!campaigns.length) {
          console.log('Skipping getCampaign: no campaigns in account and no testValues.campaignId')
          return
        }

        campaignId = campaigns[0].campaignId
      }

      const response = await service.getCampaign(campaignId)

      expect(response).toHaveProperty('campaignId', campaignId)
      expect(response).toHaveProperty('name')
    })
  })

  // ── Contacts ──

  // Resolves a campaign to add contacts to: testValues.campaignId or the first
  // campaign in the account. Contacts always require a target campaign (list).
  const resolveCampaignId = async () => {
    if (testValues.campaignId) return testValues.campaignId

    const campaigns = await service.listCampaigns()

    return campaigns.length ? campaigns[0].campaignId : undefined
  }

  describe('createContact + searchContacts + getContact + updateContact + deleteContact', () => {
    let campaignId
    let contactId
    const email = `e2e-contact-${ suffix }@example.com`

    it('creates a contact', async () => {
      campaignId = await resolveCampaignId()

      if (!campaignId) {
        console.log('Skipping contact lifecycle: no campaign available (set testValues.campaignId)')
        return
      }

      const response = await service.createContact(email, campaignId, 'E2E Tester')

      // A successful create returns HTTP 202 (empty body) → synthetic success object.
      expect(response).toBeDefined()
    })

    it('finds the contact by email', async () => {
      if (!campaignId) return

      // Adds may be processed asynchronously; retry a few times before giving up.
      let matches = []

      for (let attempt = 0; attempt < 5 && !matches.length; attempt++) {
        matches = await service.searchContacts(email)

        if (!matches.length) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      expect(Array.isArray(matches)).toBe(true)

      if (matches.length) {
        contactId = matches[0].contactId
        expect(matches[0]).toHaveProperty('email')
      } else {
        console.log('Contact not yet searchable (double opt-in or processing delay); skipping rest')
      }
    })

    it('retrieves the created contact', async () => {
      if (!contactId) return

      const response = await service.getContact(contactId)

      expect(response).toHaveProperty('contactId', contactId)
      expect(response).toHaveProperty('email')
    })

    it('updates the contact', async () => {
      if (!contactId) return

      const response = await service.updateContact(contactId, 'E2E Tester Updated')

      expect(response).toHaveProperty('contactId', contactId)
    })

    afterAll(async () => {
      if (contactId) {
        try {
          await service.deleteContact(contactId)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  describe('deleteContact', () => {
    it('returns success shape for a delete call', async () => {
      const campaignId = await resolveCampaignId()

      if (!campaignId) {
        console.log('Skipping deleteContact: no campaign available')
        return
      }

      const email = `e2e-delete-${ suffix }@example.com`
      await service.createContact(email, campaignId, 'E2E Delete')

      // Locate the created contact, then delete it and assert the success shape.
      let matches = []

      for (let attempt = 0; attempt < 5 && !matches.length; attempt++) {
        matches = await service.searchContacts(email)

        if (!matches.length) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }

      if (!matches.length) {
        console.log('Skipping deleteContact assertion: contact not searchable in time')
        return
      }

      const response = await service.deleteContact(matches[0].contactId)

      expect(response).toEqual({ success: true, contactId: matches[0].contactId })
    })
  })

  describe('listContacts', () => {
    it('returns contacts as an array', async () => {
      const response = await service.listContacts(undefined, undefined, undefined, 5, 1)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Tags ──

  describe('getTagsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getTagsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listTags', () => {
    it('returns tags as an array', async () => {
      const response = await service.listTags()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createTag + deleteTag', () => {
    let tagId

    it('creates a tag', async () => {
      const response = await service.createTag(`e2e_tag_${ lcSuffix }`, 'Blue')

      expect(response).toHaveProperty('tagId')
      tagId = response.tagId
    })

    it('deletes the tag', async () => {
      if (!tagId) return

      const response = await service.deleteTag(tagId)

      expect(response).toEqual({ success: true, tagId })
    })
  })

  // ── Custom Fields ──

  describe('getCustomFieldsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCustomFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listCustomFields', () => {
    it('returns custom fields as an array', async () => {
      const response = await service.listCustomFields(5, 1)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createCustomField', () => {
    it('creates a text custom field', async () => {
      // Custom field names must be lowercase letters, numbers, and underscores.
      const response = await service.createCustomField(`e2e_field_${ lcSuffix }`, 'Text')

      expect(response).toHaveProperty('customFieldId')
    })
  })

  // ── From Fields ──

  describe('getFromFieldsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFromFieldsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listFromFields', () => {
    it('returns from-fields as an array', async () => {
      const response = await service.listFromFields(5, 1)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Newsletters ──

  describe('listNewsletters', () => {
    it('returns newsletters as an array', async () => {
      const response = await service.listNewsletters(5, 1)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getNewsletter', () => {
    it('returns a newsletter with expected shape when one exists', async () => {
      const newsletters = await service.listNewsletters(1, 1)

      if (!newsletters.length) {
        console.log('Skipping getNewsletter: no newsletters in account')
        return
      }

      const response = await service.getNewsletter(newsletters[0].newsletterId)

      expect(response).toHaveProperty('newsletterId', newsletters[0].newsletterId)
    })
  })

  describe('createNewsletter', () => {
    // Sending a real newsletter needs a verified from-field and a campaign, and it
    // actually broadcasts, so this only runs when the developer opts in by supplying
    // testValues.fromFieldId and testValues.campaignId.
    const canSend = () => Boolean(testValues.fromFieldId && testValues.campaignId)

    it('creates and enqueues a newsletter when configured', async () => {
      if (!canSend()) {
        console.log('Skipping createNewsletter: set testValues.fromFieldId and testValues.campaignId')
        return
      }

      const response = await service.createNewsletter(
        `E2E Newsletter ${ suffix }`,
        testValues.fromFieldId,
        testValues.campaignId,
        '<p>This is an automated e2e test newsletter.</p>'
      )

      expect(response).toHaveProperty('newsletterId')
    })
  })

  // ── Autoresponders ──

  describe('listAutoresponders', () => {
    it('returns autoresponders as an array', async () => {
      const response = await service.listAutoresponders(5, 1)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getAutoresponder', () => {
    it('returns an autoresponder with expected shape when one exists', async () => {
      const autoresponders = await service.listAutoresponders(1, 1)

      if (!autoresponders.length) {
        console.log('Skipping getAutoresponder: no autoresponders in account')
        return
      }

      const response = await service.getAutoresponder(autoresponders[0].autoresponderId)

      expect(response).toHaveProperty('autoresponderId', autoresponders[0].autoresponderId)
    })
  })

  // ── Campaign creation (mutating; opt-in) ──

  describe('createCampaign', () => {
    // Creating a campaign leaves a durable list in the account that cannot be
    // deleted via this service, so it only runs when explicitly opted in.
    it('creates a campaign when opted in via testValues.allowCampaignCreate', async () => {
      if (!testValues.allowCampaignCreate) {
        console.log('Skipping createCampaign: set testValues.allowCampaignCreate to true to run')
        return
      }

      const response = await service.createCampaign(`e2e-list-${ lcSuffix }`)

      expect(response).toHaveProperty('campaignId')
      expect(response).toHaveProperty('name')
    })
  })
})
