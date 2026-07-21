'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SITE_URL = 'https://example.com'
const CONSUMER_KEY = 'ck_test_consumer_key'
const CONSUMER_SECRET = 'cs_test_consumer_secret'
const BASE = `${ SITE_URL }/wp-json/gf/v2`
const EXPECTED_AUTH = 'Basic ' + Buffer.from(`${ CONSUMER_KEY }:${ CONSUMER_SECRET }`).toString('base64')

describe('Gravity Forms Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      siteUrl: SITE_URL,
      consumerKey: CONSUMER_KEY,
      consumerSecret: CONSUMER_SECRET,
    })
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
        expect.objectContaining({ name: 'siteUrl', displayName: 'Site URL', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'consumerKey', displayName: 'Consumer Key', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'consumerSecret', displayName: 'Consumer Secret', required: true, type: 'STRING' }),
      ])
    })

    it('builds the base URL as {siteUrl}/wp-json/gf/v2 without a trailing slash', async () => {
      mock.onGet(`${ BASE }/forms/1`).reply({ id: '1', title: 'T' })

      await service.getForm('1')

      expect(mock.history[0].url).toBe(`${ SITE_URL }/wp-json/gf/v2/forms/1`)
      expect(mock.history[0].url).not.toContain('//wp-json')
    })

  })

  // ── Auth ──

  describe('authentication', () => {
    it('sends HTTP Basic auth built from consumer key and secret', async () => {
      mock.onGet(`${ BASE }/forms/1`).reply({ id: '1', title: 'Contact Form' })

      await service.getForm('1')

      expect(mock.history[0].headers).toMatchObject({
        Authorization: EXPECTED_AUTH,
        'Content-Type': 'application/json',
      })
    })

    it('base64-encodes credentials in the form consumerKey:consumerSecret', () => {
      const decoded = Buffer.from(EXPECTED_AUTH.replace('Basic ', ''), 'base64').toString('utf8')
      expect(decoded).toBe(`${ CONSUMER_KEY }:${ CONSUMER_SECRET }`)
    })
  })

  // ── Form Management ──

  describe('createForm', () => {
    it('sends POST with the form data as body', async () => {
      const formData = { title: 'Contact Form', fields: [{ type: 'text', label: 'Name' }] }
      mock.onPost(`${ BASE }/forms`).reply({ id: '15', title: 'Contact Form' })

      const result = await service.createForm(formData)

      expect(result).toEqual({ id: '15', title: 'Contact Form' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/forms`)
      expect(mock.history[0].body).toEqual(formData)
    })

    it('throws when form data is not a non-empty object', async () => {
      await expect(service.createForm({})).rejects.toThrow('Form Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when form data has no title', async () => {
      await expect(service.createForm({ fields: [] })).rejects.toThrow('Form Data must include a title property')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/forms`).replyWithError({ message: 'Bad Request' })

      await expect(service.createForm({ title: 'X' })).rejects.toThrow('Failed to create Gravity Forms form')
    })
  })

  describe('getForm', () => {
    it('sends GET to the form endpoint', async () => {
      mock.onGet(`${ BASE }/forms/15`).reply({ id: '15', title: 'Contact Form' })

      const result = await service.getForm('15')

      expect(result).toEqual({ id: '15', title: 'Contact Form' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15`)
    })

    it('throws when id is empty', async () => {
      await expect(service.getForm('')).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/forms/99`).replyWithError({ message: 'Not Found' })

      await expect(service.getForm('99')).rejects.toThrow('Failed to retrieve Gravity Forms form 99')
    })
  })

  describe('deleteForm', () => {
    it('moves to trash (force=0) by default', async () => {
      mock.onDelete(`${ BASE }/forms/15`).reply({ deleted: true })

      const result = await service.deleteForm('15')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15`)
      expect(mock.history[0].query).toEqual({ force: 0 })
    })

    it('permanently deletes (force=1) when force is true', async () => {
      mock.onDelete(`${ BASE }/forms/15`).reply({ deleted: true })

      await service.deleteForm('15', true)

      expect(mock.history[0].query).toEqual({ force: 1 })
    })

    it('throws when id is empty', async () => {
      await expect(service.deleteForm('')).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/forms/15`).replyWithError({ message: 'Server Error' })

      await expect(service.deleteForm('15')).rejects.toThrow('Failed to delete Gravity Forms form 15')
    })
  })

  describe('getFormsList', () => {
    it('returns Object.values of the keyed forms response', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        15: { id: '15', title: 'Contact Form' },
        16: { id: '16', title: 'Newsletter' },
      })

      const result = await service.getFormsList()

      expect(mock.history[0].url).toBe(`${ BASE }/forms`)
      expect(result).toEqual([
        { id: '15', title: 'Contact Form' },
        { id: '16', title: 'Newsletter' },
      ])
    })

    it('returns an empty array when there are no forms', async () => {
      mock.onGet(`${ BASE }/forms`).reply({})

      const result = await service.getFormsList()

      expect(result).toEqual([])
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/forms`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getFormsList()).rejects.toThrow('Failed to retrieve Gravity Forms list')
    })
  })

  describe('updateForm', () => {
    it('sends PUT with the form data as body', async () => {
      const formData = { title: 'Updated Contact Form', fields: [] }
      mock.onPut(`${ BASE }/forms/15`).reply({ id: '15', title: 'Updated Contact Form' })

      const result = await service.updateForm('15', formData)

      expect(result).toEqual({ id: '15', title: 'Updated Contact Form' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15`)
      expect(mock.history[0].body).toEqual(formData)
    })

    it('throws when id is empty', async () => {
      await expect(service.updateForm('', { title: 'X' })).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when form data is not a non-empty object', async () => {
      await expect(service.updateForm('15', {})).rejects.toThrow('Form Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPut(`${ BASE }/forms/15`).replyWithError({ message: 'Conflict' })

      await expect(service.updateForm('15', { title: 'X' })).rejects.toThrow('Failed to update Gravity Forms form 15')
    })
  })

  // ── Form Submission ──

  describe('submitEntry', () => {
    it('POSTs submission data to the submissions endpoint', async () => {
      const submissionData = { input_1: 'John Doe', input_2: 'john@example.com' }
      mock.onPost(`${ BASE }/forms/15/submissions`).reply({ is_valid: true, form_id: '15' })

      const result = await service.submitEntry('15', submissionData)

      expect(result).toEqual({ is_valid: true, form_id: '15' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15/submissions`)
      expect(mock.history[0].body).toEqual(submissionData)
      expect(mock.history[0].query).toEqual({})
    })

    it('throws when form id is empty', async () => {
      await expect(service.submitEntry('', { input_1: 'x' })).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when submission data is empty', async () => {
      await expect(service.submitEntry('15', {})).rejects.toThrow('Submission Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/forms/15/submissions`).replyWithError({ message: 'Bad Request' })

      await expect(service.submitEntry('15', { input_1: 'x' })).rejects.toThrow('Failed to submit entry to Gravity Forms form 15')
    })
  })

  describe('validateSubmission', () => {
    it('POSTs with the _validate_only query flag', async () => {
      const submissionData = { input_1: 'John Doe' }
      mock.onPost(`${ BASE }/forms/15/submissions`).reply({ is_valid: true, is_spam: false })

      const result = await service.validateSubmission('15', submissionData)

      expect(result).toEqual({ is_valid: true, is_spam: false })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15/submissions`)
      expect(mock.history[0].body).toEqual(submissionData)
      expect(mock.history[0].query).toEqual({ _validate_only: 1 })
    })

    it('logs spam status without altering the response', async () => {
      mock.onPost(`${ BASE }/forms/15/submissions`).reply({ is_valid: false, is_spam: true })

      const result = await service.validateSubmission('15', { input_1: 'spam' })

      expect(result).toEqual({ is_valid: false, is_spam: true })
    })

    it('throws when form id is empty', async () => {
      await expect(service.validateSubmission('', { input_1: 'x' })).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when submission data is empty', async () => {
      await expect(service.validateSubmission('15', {})).rejects.toThrow('Submission Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/forms/15/submissions`).replyWithError({ message: 'Bad Request' })

      await expect(service.validateSubmission('15', { input_1: 'x' })).rejects.toThrow('Failed to validate submission for Gravity Forms form 15')
    })
  })

  // ── Entry Management ──

  describe('createEntry', () => {
    it('POSTs entry data to the form entries endpoint', async () => {
      const entryData = { 1: 'John Doe', 2: 'john@example.com', form_id: '15' }
      mock.onPost(`${ BASE }/forms/15/entries`).reply({ id: '125', form_id: '15' })

      const result = await service.createEntry('15', entryData)

      expect(result).toEqual({ id: '125', form_id: '15' })
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15/entries`)
      expect(mock.history[0].body).toEqual(entryData)
    })

    it('throws when form id is empty', async () => {
      await expect(service.createEntry('', { 1: 'x' })).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when entry data is empty', async () => {
      await expect(service.createEntry('15', {})).rejects.toThrow('Entry Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/forms/15/entries`).replyWithError({ message: 'Bad Request' })

      await expect(service.createEntry('15', { 1: 'x' })).rejects.toThrow('Failed to create entry for Gravity Forms form 15')
    })
  })

  describe('updateEntry', () => {
    it('PUTs entry data to the entries endpoint', async () => {
      const entryData = { 1: 'Jane Smith' }
      mock.onPut(`${ BASE }/entries/125`).reply({ id: '125', 1: 'Jane Smith' })

      const result = await service.updateEntry('125', entryData)

      expect(result).toEqual({ id: '125', 1: 'Jane Smith' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/entries/125`)
      expect(mock.history[0].body).toEqual(entryData)
    })

    it('throws when entry id is empty', async () => {
      await expect(service.updateEntry('', { 1: 'x' })).rejects.toThrow('Entry ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('throws when entry data is empty', async () => {
      await expect(service.updateEntry('125', {})).rejects.toThrow('Entry Data must be provided as a non-empty object')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPut(`${ BASE }/entries/125`).replyWithError({ message: 'Not Found' })

      await expect(service.updateEntry('125', { 1: 'x' })).rejects.toThrow('Failed to update Gravity Forms entry 125')
    })
  })

  describe('getEntry', () => {
    it('GETs the entry endpoint', async () => {
      mock.onGet(`${ BASE }/entries/125`).reply({ id: '125', form_id: '15' })

      const result = await service.getEntry('125')

      expect(result).toEqual({ id: '125', form_id: '15' })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/entries/125`)
    })

    it('throws when entry id is empty', async () => {
      await expect(service.getEntry('')).rejects.toThrow('Entry ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/entries/125`).replyWithError({ message: 'Not Found' })

      await expect(service.getEntry('125')).rejects.toThrow('Failed to retrieve Gravity Forms entry 125')
    })
  })

  describe('deleteEntry', () => {
    it('moves to trash (force=0) by default', async () => {
      mock.onDelete(`${ BASE }/entries/125`).reply({ deleted: true })

      const result = await service.deleteEntry('125')

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/entries/125`)
      expect(mock.history[0].query).toEqual({ force: 0 })
    })

    it('permanently deletes (force=1) when force is true', async () => {
      mock.onDelete(`${ BASE }/entries/125`).reply({ deleted: true })

      await service.deleteEntry('125', true)

      expect(mock.history[0].query).toEqual({ force: 1 })
    })

    it('throws when entry id is empty', async () => {
      await expect(service.deleteEntry('')).rejects.toThrow('Entry ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onDelete(`${ BASE }/entries/125`).replyWithError({ message: 'Server Error' })

      await expect(service.deleteEntry('125')).rejects.toThrow('Failed to delete Gravity Forms entry 125')
    })
  })

  describe('getFormEntries', () => {
    it('GETs with default paging (page_size=20, current_page=1)', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({ entries: [{ id: '125' }], total_count: 1 })

      const result = await service.getFormEntries('15')

      expect(result).toEqual({ entries: [{ id: '125' }], total_count: 1 })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(`${ BASE }/forms/15/entries`)
      expect(mock.history[0].query).toEqual({
        'paging[page_size]': 20,
        'paging[current_page]': 1,
      })
    })

    it('passes custom page size and page', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({ entries: [], total_count: 0 })

      await service.getFormEntries('15', 50, 3)

      expect(mock.history[0].query).toEqual({
        'paging[page_size]': 50,
        'paging[current_page]': 3,
      })
    })

    it('handles a response without an entries array', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({ total_count: 0 })

      const result = await service.getFormEntries('15')

      expect(result).toEqual({ total_count: 0 })
    })

    it('throws when form id is empty', async () => {
      await expect(service.getFormEntries('')).rejects.toThrow('Form ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getFormEntries('15')).rejects.toThrow('Failed to retrieve entries for Gravity Forms form 15')
    })
  })

  // ── Notification Management ──

  describe('sendEntryNotification', () => {
    it('POSTs to the entry notifications endpoint with no body', async () => {
      mock.onPost(`${ BASE }/entries/125/notifications`).reply(['admin_notify_1', 'user_confirm_2'])

      const result = await service.sendEntryNotification('125', '15')

      expect(result).toEqual(['admin_notify_1', 'user_confirm_2'])
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/entries/125/notifications`)
      expect(mock.history[0].body).toBeUndefined()
    })

    it('works without a formId argument', async () => {
      mock.onPost(`${ BASE }/entries/125/notifications`).reply([])

      const result = await service.sendEntryNotification('125')

      expect(result).toEqual([])
    })

    it('throws when entry id is empty', async () => {
      await expect(service.sendEntryNotification('')).rejects.toThrow('Entry ID must be provided and cannot be empty')
      expect(mock.history).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onPost(`${ BASE }/entries/125/notifications`).replyWithError({ message: 'Server Error' })

      await expect(service.sendEntryNotification('125')).rejects.toThrow('Failed to send notifications for Gravity Forms entry 125')
    })
  })

  // ── Dictionary Methods ──

  describe('getFormsListDictionary', () => {
    const formsResponse = {
      15: { id: '15', title: 'Contact Form', entries: '25', is_active: '1', date_created: '2024-08-01 10:30:00' },
      16: { id: '16', title: 'Newsletter Signup', entries: '142', is_active: '1', date_created: '2024-07-28 14:15:00' },
      17: { id: '17', title: 'Product Inquiry', entries: '8', is_active: '0', date_created: '2024-07-25 09:45:00' },
    }

    it('maps all forms to dictionary items', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/forms`)
      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(3)
      expect(result.items[0]).toEqual({
        label: 'Contact Form (25 entries)',
        value: '15',
        note: 'Active form created on 2024-08-01',
      })
      expect(result.items[2]).toEqual({
        label: 'Product Inquiry (8 entries)',
        value: '17',
        note: 'Inactive form created on 2024-07-25',
      })
    })

    it('handles a null payload', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary(null)

      expect(result.items).toHaveLength(3)
    })

    it('filters by search term (case-insensitive, title match)', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary({ search: 'newsletter' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('16')
    })

    it('filters by criteria.isActive', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary({ criteria: { isActive: true } })

      expect(result.items).toHaveLength(2)
      expect(result.items.map(i => i.value)).toEqual(['15', '16'])
    })

    it('filters inactive forms when criteria.isActive is false', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary({ criteria: { isActive: false } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('17')
    })

    it('filters by criteria.minEntries', async () => {
      mock.onGet(`${ BASE }/forms`).reply(formsResponse)

      const result = await service.getFormsListDictionary({ criteria: { minEntries: 20 } })

      expect(result.items.map(i => i.value)).toEqual(['15', '16'])
    })

    it('defaults entries to 0 and shows unknown date when fields are missing', async () => {
      mock.onGet(`${ BASE }/forms`).reply({
        20: { id: '20', title: 'Bare Form' },
      })

      const result = await service.getFormsListDictionary({})

      expect(result.items[0]).toEqual({
        label: 'Bare Form (0 entries)',
        value: '20',
        note: 'Inactive form created on unknown date',
      })
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/forms`).replyWithError({ message: 'Unauthorized' })

      await expect(service.getFormsListDictionary({})).rejects.toThrow('Failed to retrieve Gravity Forms dictionary')
    })
  })

  describe('getFormEntriesDictionary', () => {
    const entriesResponse = {
      entries: [
        {
          id: '125',
          1: 'John Doe',
          2: 'john@example.com',
          date_created: '2024-08-01 15:30:00',
          status: 'active',
          is_starred: '0',
          is_read: '0',
        },
        {
          id: '126',
          1: 'Jane Smith',
          2: 'jane@example.com',
          date_created: '2024-08-01 16:15:00',
          status: 'active',
          is_starred: '1',
          is_read: '1',
        },
      ],
      total_count: 2,
    }

    it('requests entries for the form id from criteria and maps them', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply(entriesResponse)

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15' } })

      expect(mock.history[0].url).toBe(`${ BASE }/forms/15/entries`)
      expect(mock.history[0].query).toEqual({
        'paging[page_size]': 50,
        'paging[current_page]': 1,
      })
      expect(result.cursor).toBeNull()
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Entry #125 - John Doe (2024-08-01)',
        value: '125',
        note: 'john@example.com - Status: active',
      })
      expect(result.items[1]).toEqual({
        label: 'Entry #126 - Jane Smith (2024-08-01)',
        value: '126',
        note: 'jane@example.com - Status: active - Starred',
      })
    })

    it('throws when form id is missing from criteria', async () => {
      await expect(service.getFormEntriesDictionary({})).rejects.toThrow('Form ID is required for entries dictionary')
      expect(mock.history).toHaveLength(0)
    })

    it('handles a null payload by throwing the form-id requirement', async () => {
      await expect(service.getFormEntriesDictionary(null)).rejects.toThrow('Form ID is required for entries dictionary')
    })

    it('filters entries by search across field values', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply(entriesResponse)

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15' }, search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('126')
    })

    it('filters entries by criteria.status', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({
        entries: [
          { id: '1', 1: 'A', status: 'active', date_created: '2024-08-01 10:00:00' },
          { id: '2', 1: 'B', status: 'trash', date_created: '2024-08-01 11:00:00' },
        ],
      })

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15', status: 'trash' } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('2')
    })

    it('filters entries by criteria.isStarred', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply(entriesResponse)

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15', isStarred: true } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('126')
    })

    it('filters entries by criteria.isRead', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply(entriesResponse)

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15', isRead: false } })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('125')
    })

    it('falls back to Entry #id label and a default note when fields are sparse', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({
        entries: [{ id: '300' }],
      })

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15' } })

      expect(result.items[0]).toEqual({
        label: 'Entry #300 - Entry #300 (unknown date)',
        value: '300',
        note: 'Form 15 entry',
      })
    })

    it('handles an empty entries array', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).reply({ entries: [] })

      const result = await service.getFormEntriesDictionary({ criteria: { formId: '15' } })

      expect(result.items).toHaveLength(0)
    })

    it('wraps API errors', async () => {
      mock.onGet(`${ BASE }/forms/15/entries`).replyWithError({ message: 'Unauthorized' })

      await expect(
        service.getFormEntriesDictionary({ criteria: { formId: '15' } })
      ).rejects.toThrow('Failed to retrieve entries dictionary for Gravity Forms form 15')
    })
  })
})
