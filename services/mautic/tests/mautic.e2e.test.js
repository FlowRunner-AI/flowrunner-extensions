'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Mautic Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('mautic')
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

  // ── Contacts lifecycle ──

  describe('contact lifecycle: create -> get -> edit -> delete', () => {
    let createdContactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        'E2ETest',
        'Runner',
        `e2e-${ Date.now() }@test.example.com`,
        '555-0199',
        'TestCorp',
        ['e2e-test'],
      )

      expect(result).toHaveProperty('contact')
      expect(result.contact).toHaveProperty('id')
      createdContactId = result.contact.id
    })

    it('retrieves the created contact', async () => {
      const result = await service.getContact(createdContactId)

      expect(result).toHaveProperty('contact')
      expect(result.contact).toHaveProperty('id', createdContactId)
    })

    it('edits the created contact', async () => {
      const result = await service.editContact(createdContactId, 'E2EUpdated')

      expect(result).toHaveProperty('contact')
      expect(result.contact).toHaveProperty('id', createdContactId)
    })

    it('deletes the created contact', async () => {
      const result = await service.deleteContact(createdContactId)

      expect(result).toHaveProperty('contact')
    })
  })

  // ── List Contacts ──

  describe('listContacts', () => {
    it('returns contacts array with total', async () => {
      const result = await service.listContacts(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })

    it('supports search parameter', async () => {
      const result = await service.listContacts('is:anonymous', 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('contacts')
      expect(Array.isArray(result.contacts)).toBe(true)
    })
  })

  // ── Segments lifecycle ──

  describe('segment lifecycle: create -> addContact -> removeContact', () => {
    let segmentId
    let contactId

    it('creates a segment', async () => {
      const result = await service.createSegment(`E2E Segment ${ Date.now() }`, undefined, 'E2E test segment')

      expect(result).toHaveProperty('list')
      expect(result.list).toHaveProperty('id')
      segmentId = result.list.id
    })

    it('creates a contact for segment tests', async () => {
      const result = await service.createContact('SegTest', 'User', `seg-${ Date.now() }@test.example.com`)

      expect(result).toHaveProperty('contact')
      contactId = result.contact.id
    })

    it('adds the contact to the segment', async () => {
      const result = await service.addContactToSegment(segmentId, contactId)

      expect(result).toHaveProperty('success', 1)
    })

    it('removes the contact from the segment', async () => {
      const result = await service.removeContactFromSegment(segmentId, contactId)

      expect(result).toHaveProperty('success', 1)
    })

    it('cleans up the contact', async () => {
      await service.deleteContact(contactId)
    })

    // Note: Mautic segments cannot be deleted via API, so we leave the segment.
  })

  // ── List Segments ──

  describe('listSegments', () => {
    it('returns segments array with total', async () => {
      const result = await service.listSegments(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('lists')
      expect(Array.isArray(result.lists)).toBe(true)
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('returns campaigns array with total', async () => {
      const result = await service.listCampaigns(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('campaigns')
      expect(Array.isArray(result.campaigns)).toBe(true)
    })
  })

  // ── Companies lifecycle ──

  describe('company lifecycle: create -> get -> edit -> delete', () => {
    let companyId

    it('creates a company', async () => {
      const result = await service.createCompany(`E2E Corp ${ Date.now() }`, 'e2e@testcorp.example.com')

      expect(result).toHaveProperty('company')
      expect(result.company).toHaveProperty('id')
      companyId = result.company.id
    })

    it('retrieves the created company', async () => {
      const result = await service.getCompany(companyId)

      expect(result).toHaveProperty('company')
      expect(result.company).toHaveProperty('id', companyId)
    })

    it('edits the created company', async () => {
      const result = await service.editCompany(companyId, `E2E Corp Updated ${ Date.now() }`)

      expect(result).toHaveProperty('company')
      expect(result.company).toHaveProperty('id', companyId)
    })

    it('deletes the created company', async () => {
      const result = await service.deleteCompany(companyId)

      expect(result).toHaveProperty('company')
    })
  })

  // ── List Companies ──

  describe('listCompanies', () => {
    it('returns companies array with total', async () => {
      const result = await service.listCompanies(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('companies')
      expect(Array.isArray(result.companies)).toBe(true)
    })
  })

  // ── Add Contact to Company ──

  describe('addContactToCompany', () => {
    let companyId
    let contactId

    it('creates test company and contact', async () => {
      const companyResult = await service.createCompany(`AssocTest Corp ${ Date.now() }`)

      companyId = companyResult.company.id

      const contactResult = await service.createContact('AssocTest', 'User', `assoc-${ Date.now() }@test.example.com`)

      contactId = contactResult.contact.id
    })

    it('adds contact to company', async () => {
      const result = await service.addContactToCompany(companyId, contactId)

      expect(result).toHaveProperty('success', true)
    })

    it('cleans up test data', async () => {
      await service.deleteContact(contactId)
      await service.deleteCompany(companyId)
    })
  })

  // ── Emails ──

  describe('listEmails', () => {
    it('returns emails array with total', async () => {
      const result = await service.listEmails(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('emails')
      expect(Array.isArray(result.emails)).toBe(true)
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('returns tags array with total', async () => {
      const result = await service.listTags(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)
    })
  })

  // ── Notes lifecycle ──

  describe('note lifecycle: create contact -> create note -> list notes -> delete contact', () => {
    let contactId

    it('creates a contact for note tests', async () => {
      const result = await service.createContact('NoteTest', 'User', `note-${ Date.now() }@test.example.com`)

      contactId = result.contact.id
    })

    it('creates a note on the contact', async () => {
      const result = await service.createNote(contactId, 'E2E test note content.', 'General')

      expect(result).toHaveProperty('note')
      expect(result.note).toHaveProperty('id')
      expect(result.note).toHaveProperty('text', 'E2E test note content.')
    })

    it('lists notes', async () => {
      const result = await service.listNotes(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('notes')
      expect(Array.isArray(result.notes)).toBe(true)
    })

    it('cleans up the contact', async () => {
      await service.deleteContact(contactId)
    })
  })

  // ── Forms & Stages ──

  describe('listForms', () => {
    it('returns forms array with total', async () => {
      const result = await service.listForms(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('forms')
      expect(Array.isArray(result.forms)).toBe(true)
    })
  })

  describe('listStages', () => {
    it('returns stages array with total', async () => {
      const result = await service.listStages(undefined, 5)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('stages')
      expect(Array.isArray(result.stages)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getSegmentsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getSegmentsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      }
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getCampaignsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      }
    })
  })

  describe('getEmailsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getEmailsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      }
    })
  })

  describe('getFormsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        const item = result.items[0]

        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
        expect(item).toHaveProperty('note')
      }
    })
  })
})
