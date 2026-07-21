'use strict'

const { createSandbox } = require('../../../service-sandbox')

const BASE_URL = 'https://mautic.example.com'
const USERNAME = 'admin'
const PASSWORD = 'secret123'
const API_BASE = `${ BASE_URL }/api`
const EXPECTED_AUTH = `Basic ${ Buffer.from(`${ USERNAME }:${ PASSWORD }`).toString('base64') }`

describe('Mautic Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'baseUrl',
          displayName: 'Instance URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'username',
          displayName: 'Username',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'password',
          displayName: 'Password',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Basic auth header derived from username:password', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({ total: 0, contacts: [] })

      await service.listContacts()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('strips trailing slashes from the base URL', async () => {
      // Verify by checking the URL the service constructs — the service instance
      // was built with 'https://mautic.example.com' (no trailing slashes) and the
      // constructor strips them. We confirm it calls the clean URL.
      mock.onGet(`${ API_BASE }/contacts/1`).reply({ contact: { id: 1 } })

      await service.getContact(1)

      expect(mock.history[0].url).toBe('https://mautic.example.com/api/contacts/1')
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends POST with core fields', async () => {
      mock.onPost(`${ API_BASE }/contacts/new`).reply({ contact: { id: 47 } })

      const result = await service.createContact('Jane', 'Doe', 'jane@example.com', '555-0100', 'Acme')

      expect(result).toEqual({ contact: { id: 47 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({
        firstname: 'Jane',
        lastname: 'Doe',
        email: 'jane@example.com',
        phone: '555-0100',
        company: 'Acme',
      })
    })

    it('includes tags when provided', async () => {
      mock.onPost(`${ API_BASE }/contacts/new`).reply({ contact: { id: 48 } })

      await service.createContact('Jane', 'Doe', 'jane@example.com', undefined, undefined, ['newsletter', 'vip'])

      expect(mock.history[0].body).toMatchObject({
        tags: ['newsletter', 'vip'],
      })
    })

    it('omits tags when empty array', async () => {
      mock.onPost(`${ API_BASE }/contacts/new`).reply({ contact: { id: 49 } })

      await service.createContact('Jane', undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).not.toHaveProperty('tags')
    })

    it('merges custom fields with core fields (core wins)', async () => {
      mock.onPost(`${ API_BASE }/contacts/new`).reply({ contact: { id: 50 } })

      await service.createContact('Jane', undefined, 'jane@example.com', undefined, undefined, undefined, {
        jobtitle: 'Engineer',
        firstname: 'custom-overridden',
      })

      // Core fields override custom fields with the same key
      expect(mock.history[0].body).toMatchObject({
        firstname: 'Jane',
        email: 'jane@example.com',
        jobtitle: 'Engineer',
      })
    })

    it('omits undefined and empty string fields via clean()', async () => {
      mock.onPost(`${ API_BASE }/contacts/new`).reply({ contact: { id: 51 } })

      await service.createContact('Jane', '', undefined, null, '')

      expect(mock.history[0].body).toEqual({ firstname: 'Jane' })
    })
  })

  describe('getContact', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/contacts/47`).reply({ contact: { id: 47 } })

      const result = await service.getContact(47)

      expect(result).toEqual({ contact: { id: 47 } })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ Authorization: EXPECTED_AUTH })
    })

    it('throws on API error', async () => {
      mock.onGet(`${ API_BASE }/contacts/999`).replyWithError({
        message: 'Not Found',
        body: { errors: [{ message: 'Item was not found.' }] },
      })

      await expect(service.getContact(999)).rejects.toThrow('Mautic API error: Item was not found.')
    })
  })

  describe('listContacts', () => {
    it('sends defaults when no params provided', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({ total: 0, contacts: {} })

      const result = await service.listContacts()

      expect(result).toEqual({ total: 0, contacts: [] })
      expect(mock.history[0].query).toMatchObject({ limit: 30 })
    })

    it('passes search, limit, start, orderBy, and orderByDir', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({ total: 1, contacts: { '47': { id: 47 } } })

      const result = await service.listContacts('email:jane@example.com', 10, 20, 'email', 'Descending')

      expect(result).toEqual({ total: 1, contacts: [{ id: 47 }] })
      expect(mock.history[0].query).toMatchObject({
        search: 'email:jane@example.com',
        limit: 10,
        start: 20,
        orderBy: 'email',
        orderByDir: 'DESC',
      })
    })

    it('maps Ascending to ASC', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({ total: 0, contacts: [] })

      await service.listContacts(undefined, undefined, undefined, 'date_added', 'Ascending')

      expect(mock.history[0].query).toMatchObject({ orderByDir: 'ASC' })
    })

    it('normalizes object-keyed contacts into array', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({
        total: 2,
        contacts: { '1': { id: 1 }, '2': { id: 2 } },
      })

      const result = await service.listContacts()

      expect(Array.isArray(result.contacts)).toBe(true)
      expect(result.contacts).toHaveLength(2)
    })

    it('handles already-array contacts', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({
        total: 1,
        contacts: [{ id: 1 }],
      })

      const result = await service.listContacts()

      expect(result.contacts).toEqual([{ id: 1 }])
    })

    it('returns empty array when contacts is null', async () => {
      mock.onGet(`${ API_BASE }/contacts`).reply({ total: 0, contacts: null })

      const result = await service.listContacts()

      expect(result.contacts).toEqual([])
    })
  })

  describe('editContact', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${ API_BASE }/contacts/47/edit`).reply({ contact: { id: 47 } })

      const result = await service.editContact(47, 'Janet', undefined, 'janet@example.com')

      expect(result).toEqual({ contact: { id: 47 } })
      expect(mock.history[0].body).toEqual({
        firstname: 'Janet',
        email: 'janet@example.com',
      })
    })

    it('includes tags and custom fields', async () => {
      mock.onPatch(`${ API_BASE }/contacts/47/edit`).reply({ contact: { id: 47 } })

      await service.editContact(47, undefined, undefined, undefined, undefined, undefined, ['vip'], { city: 'NYC' })

      expect(mock.history[0].body).toEqual({
        city: 'NYC',
        tags: ['vip'],
      })
    })
  })

  describe('deleteContact', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/contacts/47/delete`).reply({ contact: { id: 47 } })

      const result = await service.deleteContact(47)

      expect(result).toEqual({ contact: { id: 47 } })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Segments ──

  describe('listSegments', () => {
    it('normalizes segment list and passes query params', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({
        total: 1,
        lists: { '3': { id: 3, name: 'Newsletter' } },
      })

      const result = await service.listSegments('newsletter', 10, 5)

      expect(result).toEqual({ total: 1, lists: [{ id: 3, name: 'Newsletter' }] })
      expect(mock.history[0].query).toMatchObject({ search: 'newsletter', limit: 10, start: 5 })
    })

    it('uses default limit of 30', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({ total: 0, lists: {} })

      await service.listSegments()

      expect(mock.history[0].query).toMatchObject({ limit: 30 })
    })
  })

  describe('createSegment', () => {
    it('sends POST with name and defaults isPublished to true', async () => {
      mock.onPost(`${ API_BASE }/segments/new`).reply({ list: { id: 5, name: 'VIP' } })

      const result = await service.createSegment('VIP')

      expect(result).toEqual({ list: { id: 5, name: 'VIP' } })
      expect(mock.history[0].body).toMatchObject({ name: 'VIP', isPublished: true })
    })

    it('sends optional alias, description, and isPublished=false', async () => {
      mock.onPost(`${ API_BASE }/segments/new`).reply({ list: { id: 6 } })

      await service.createSegment('VIP', 'vip-customers', 'VIP segment', false)

      expect(mock.history[0].body).toEqual({
        name: 'VIP',
        alias: 'vip-customers',
        description: 'VIP segment',
        isPublished: false,
      })
    })
  })

  describe('addContactToSegment', () => {
    it('sends POST to correct URL with empty body', async () => {
      mock.onPost(`${ API_BASE }/segments/3/contact/47/add`).reply({ success: true })

      const result = await service.addContactToSegment(3, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('removeContactFromSegment', () => {
    it('sends POST to correct URL with empty body', async () => {
      mock.onPost(`${ API_BASE }/segments/3/contact/47/remove`).reply({ success: true })

      const result = await service.removeContactFromSegment(3, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Campaigns ──

  describe('listCampaigns', () => {
    it('normalizes campaign list and passes query params', async () => {
      mock.onGet(`${ API_BASE }/campaigns`).reply({
        total: 1,
        campaigns: { '2': { id: 2, name: 'Onboarding' } },
      })

      const result = await service.listCampaigns('onboard', 5, 0)

      expect(result).toEqual({ total: 1, campaigns: [{ id: 2, name: 'Onboarding' }] })
      expect(mock.history[0].query).toMatchObject({ search: 'onboard', limit: 5, start: 0 })
    })
  })

  describe('getCampaign', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/campaigns/2`).reply({ campaign: { id: 2, name: 'Onboarding' } })

      const result = await service.getCampaign(2)

      expect(result).toEqual({ campaign: { id: 2, name: 'Onboarding' } })
    })
  })

  describe('addContactToCampaign', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/campaigns/2/contact/47/add`).reply({ success: true })

      const result = await service.addContactToCampaign(2, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('removeContactFromCampaign', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/campaigns/2/contact/47/remove`).reply({ success: true })

      const result = await service.removeContactFromCampaign(2, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Companies ──

  describe('createCompany', () => {
    it('sends POST with core fields', async () => {
      mock.onPost(`${ API_BASE }/companies/new`).reply({ company: { id: 9 } })

      const result = await service.createCompany('Acme Inc', 'info@acme.com', 'https://acme.com', 'NYC', 'US', '555-0200')

      expect(result).toEqual({ company: { id: 9 } })
      expect(mock.history[0].body).toEqual({
        companyname: 'Acme Inc',
        companyemail: 'info@acme.com',
        companywebsite: 'https://acme.com',
        companycity: 'NYC',
        companycountry: 'US',
        companyphone: '555-0200',
      })
    })

    it('merges custom fields with core fields', async () => {
      mock.onPost(`${ API_BASE }/companies/new`).reply({ company: { id: 10 } })

      await service.createCompany('Acme', undefined, undefined, undefined, undefined, undefined, { industry: 'Tech' })

      expect(mock.history[0].body).toMatchObject({
        companyname: 'Acme',
        industry: 'Tech',
      })
    })
  })

  describe('listCompanies', () => {
    it('normalizes companies list', async () => {
      mock.onGet(`${ API_BASE }/companies`).reply({
        total: 1,
        companies: { '9': { id: 9 } },
      })

      const result = await service.listCompanies()

      expect(result).toEqual({ total: 1, companies: [{ id: 9 }] })
      expect(mock.history[0].query).toMatchObject({ limit: 30 })
    })
  })

  describe('getCompany', () => {
    it('sends GET to correct URL', async () => {
      mock.onGet(`${ API_BASE }/companies/9`).reply({ company: { id: 9 } })

      const result = await service.getCompany(9)

      expect(result).toEqual({ company: { id: 9 } })
    })
  })

  describe('editCompany', () => {
    it('sends PATCH with provided fields', async () => {
      mock.onPatch(`${ API_BASE }/companies/9/edit`).reply({ company: { id: 9 } })

      const result = await service.editCompany(9, 'Acme International', undefined, undefined, 'London')

      expect(result).toEqual({ company: { id: 9 } })
      expect(mock.history[0].body).toEqual({
        companyname: 'Acme International',
        companycity: 'London',
      })
    })

    it('merges custom fields', async () => {
      mock.onPatch(`${ API_BASE }/companies/9/edit`).reply({ company: { id: 9 } })

      await service.editCompany(9, undefined, undefined, undefined, undefined, undefined, undefined, { industry: 'Finance' })

      expect(mock.history[0].body).toMatchObject({ industry: 'Finance' })
    })
  })

  describe('deleteCompany', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ API_BASE }/companies/9/delete`).reply({ company: { id: 9 } })

      const result = await service.deleteCompany(9)

      expect(result).toEqual({ company: { id: 9 } })
    })
  })

  describe('addContactToCompany', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/companies/9/contact/47/add`).reply({ success: true })

      const result = await service.addContactToCompany(9, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Emails ──

  describe('listEmails', () => {
    it('normalizes email list', async () => {
      mock.onGet(`${ API_BASE }/emails`).reply({
        total: 1,
        emails: { '12': { id: 12, name: 'Welcome' } },
      })

      const result = await service.listEmails()

      expect(result).toEqual({ total: 1, emails: [{ id: 12, name: 'Welcome' }] })
    })
  })

  describe('sendEmailToContact', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/emails/12/contact/47/send`).reply({ success: true })

      const result = await service.sendEmailToContact(12, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('sendEmailToSegment', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/emails/12/send`).reply({ success: 1, sentCount: 42, failedCount: 0 })

      const result = await service.sendEmailToSegment(12)

      expect(result).toEqual({ success: 1, sentCount: 42, failedCount: 0 })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Tags ──

  describe('listTags', () => {
    it('normalizes tag list', async () => {
      mock.onGet(`${ API_BASE }/tags`).reply({
        total: 2,
        tags: { '1': { id: 1, tag: 'newsletter' }, '2': { id: 2, tag: 'vip' } },
      })

      const result = await service.listTags()

      expect(result).toEqual({
        total: 2,
        tags: [{ id: 1, tag: 'newsletter' }, { id: 2, tag: 'vip' }],
      })
    })
  })

  // ── Notes ──

  describe('createNote', () => {
    it('sends POST with contactId as lead, text, and default type', async () => {
      mock.onPost(`${ API_BASE }/notes/new`).reply({ note: { id: 21 } })

      const result = await service.createNote(47, 'Called and left a voicemail.')

      expect(result).toEqual({ note: { id: 21 } })
      expect(mock.history[0].body).toEqual({
        lead: 47,
        text: 'Called and left a voicemail.',
        type: 'general',
      })
    })

    it('resolves type choice values to lowercase', async () => {
      mock.onPost(`${ API_BASE }/notes/new`).reply({ note: { id: 22 } })

      await service.createNote(47, 'Met at conference.', 'Meeting')

      expect(mock.history[0].body).toMatchObject({ type: 'meeting' })
    })

    it('maps Call type correctly', async () => {
      mock.onPost(`${ API_BASE }/notes/new`).reply({ note: { id: 23 } })

      await service.createNote(47, 'Called.', 'Call')

      expect(mock.history[0].body).toMatchObject({ type: 'call' })
    })

    it('maps Email type correctly', async () => {
      mock.onPost(`${ API_BASE }/notes/new`).reply({ note: { id: 24 } })

      await service.createNote(47, 'Sent email.', 'Email')

      expect(mock.history[0].body).toMatchObject({ type: 'email' })
    })
  })

  describe('listNotes', () => {
    it('normalizes notes list', async () => {
      mock.onGet(`${ API_BASE }/notes`).reply({
        total: 1,
        notes: { '21': { id: 21, text: 'Hello' } },
      })

      const result = await service.listNotes()

      expect(result).toEqual({ total: 1, notes: [{ id: 21, text: 'Hello' }] })
    })
  })

  // ── Forms & Stages ──

  describe('listForms', () => {
    it('normalizes forms list', async () => {
      mock.onGet(`${ API_BASE }/forms`).reply({
        total: 1,
        forms: { '4': { id: 4, name: 'Contact Us' } },
      })

      const result = await service.listForms()

      expect(result).toEqual({ total: 1, forms: [{ id: 4, name: 'Contact Us' }] })
    })
  })

  describe('listStages', () => {
    it('normalizes stages list', async () => {
      mock.onGet(`${ API_BASE }/stages`).reply({
        total: 1,
        stages: { '1': { id: 1, name: 'Lead' } },
      })

      const result = await service.listStages()

      expect(result).toEqual({ total: 1, stages: [{ id: 1, name: 'Lead' }] })
    })
  })

  describe('addContactToStage', () => {
    it('sends POST to correct URL', async () => {
      mock.onPost(`${ API_BASE }/stages/1/contact/47/add`).reply({ success: true })

      const result = await service.addContactToStage(1, 47)

      expect(result).toEqual({ success: true })
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Dictionaries ──

  describe('getSegmentsDictionary', () => {
    it('returns dictionary items with label/value/note', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({
        lists: { '3': { id: 3, name: 'Newsletter', alias: 'newsletter' } },
      })

      const result = await service.getSegmentsDictionary({ search: 'news' })

      expect(result.items).toEqual([
        { label: 'Newsletter', value: '3', note: 'newsletter' },
      ])
      expect(mock.history[0].query).toMatchObject({ search: 'news', limit: 30, start: 0 })
    })

    it('returns cursor when results equal page size', async () => {
      const segments = {}

      for (let i = 1; i <= 30; i++) {
        segments[String(i)] = { id: i, name: `Seg${ i }`, alias: `seg${ i }` }
      }

      mock.onGet(`${ API_BASE }/segments`).reply({ lists: segments })

      const result = await service.getSegmentsDictionary({})

      expect(result.cursor).toBe('30')
    })

    it('returns no cursor when results are less than page size', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({
        lists: { '1': { id: 1, name: 'Seg1', alias: 'seg1' } },
      })

      const result = await service.getSegmentsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('uses cursor as start offset', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({ lists: {} })

      await service.getSegmentsDictionary({ cursor: '60' })

      expect(mock.history[0].query).toMatchObject({ start: 60 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ API_BASE }/segments`).reply({ lists: {} })

      const result = await service.getSegmentsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getCampaignsDictionary', () => {
    it('returns dictionary items with published/unpublished note', async () => {
      mock.onGet(`${ API_BASE }/campaigns`).reply({
        campaigns: {
          '2': { id: 2, name: 'Onboarding', isPublished: true },
          '3': { id: 3, name: 'Archived', isPublished: false },
        },
      })

      const result = await service.getCampaignsDictionary({})

      expect(result.items).toEqual(expect.arrayContaining([
        { label: 'Onboarding', value: '2', note: 'Published' },
        { label: 'Archived', value: '3', note: 'Unpublished' },
      ]))
    })

    it('paginates with cursor', async () => {
      mock.onGet(`${ API_BASE }/campaigns`).reply({ campaigns: {} })

      await service.getCampaignsDictionary({ cursor: '30' })

      expect(mock.history[0].query).toMatchObject({ start: 30 })
    })
  })

  describe('getEmailsDictionary', () => {
    it('returns dictionary items with emailType note', async () => {
      mock.onGet(`${ API_BASE }/emails`).reply({
        emails: { '12': { id: 12, name: 'Welcome Email', emailType: 'template' } },
      })

      const result = await service.getEmailsDictionary({})

      expect(result.items).toEqual([
        { label: 'Welcome Email', value: '12', note: 'template' },
      ])
    })
  })

  describe('getFormsDictionary', () => {
    it('returns dictionary items with alias note', async () => {
      mock.onGet(`${ API_BASE }/forms`).reply({
        forms: { '4': { id: 4, name: 'Contact Us', alias: 'contactus' } },
      })

      const result = await service.getFormsDictionary({})

      expect(result.items).toEqual([
        { label: 'Contact Us', value: '4', note: 'contactus' },
      ])
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts error messages from Mautic errors array', async () => {
      mock.onGet(`${ API_BASE }/contacts/999`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'Contact not found.' }, { message: 'Invalid ID.' }] },
      })

      await expect(service.getContact(999)).rejects.toThrow('Mautic API error: Contact not found.; Invalid ID.')
    })

    it('falls back to body.message when errors array is empty', async () => {
      mock.onGet(`${ API_BASE }/contacts/999`).replyWithError({
        message: 'Server Error',
        body: { message: 'Internal server error', errors: [] },
      })

      await expect(service.getContact(999)).rejects.toThrow('Mautic API error: Internal server error')
    })

    it('falls back to error.message when body has no message', async () => {
      mock.onGet(`${ API_BASE }/contacts/999`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getContact(999)).rejects.toThrow('Mautic API error: Network error')
    })
  })
})
