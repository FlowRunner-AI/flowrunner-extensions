'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const AUTH_HEADER = `Basic ${ Buffer.from(`api:${ API_KEY }`).toString('base64') }`
const BASE = 'https://api.mailgun.net'

describe('Mailgun Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, region: 'US' })
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

  // ── Helpers ──

  /** Extracts form fields from a call record's formData into a plain object for assertions. */
  function formFields(callRecord) {
    const fields = {}

    for (const { name, value, filename } of callRecord.formData._fields) {
      if (filename) {
        // File attachment — store as marker
        fields[name] = fields[name] || []
        fields[name].push({ filename: filename.filename || filename, isBuffer: Buffer.isBuffer(value) })
      } else if (fields[name] !== undefined) {
        // Repeated key (e.g. o:tag) — accumulate into an array
        if (!Array.isArray(fields[name])) {
          fields[name] = [fields[name]]
        }

        fields[name].push(value)
      } else {
        fields[name] = value
      }
    }

    return fields
  }

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'region',
          displayName: 'Region',
          required: true,
          shared: false,
          type: 'CHOICE',
          options: ['US', 'EU'],
          defaultValue: 'US',
        }),
      ])
    })

    it('sends the Basic Authorization header on requests', async () => {
      mock.onGet(`${ BASE }/v3/domains`).reply({ items: [], total_count: 0 })

      await service.listDomains()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
      })
    })
  })

  // ── Messages ──

  describe('sendEmail', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/messages`

    it('sends with required params only', async () => {
      mock.onPost(url).reply({ id: '<msg-id@mg.example.com>', message: 'Queued. Thank you.' })

      const result = await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello'
      )

      expect(result).toEqual({ id: '<msg-id@mg.example.com>', message: 'Queued. Thank you.' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ Authorization: AUTH_HEADER })

      const fields = formFields(mock.history[0])

      expect(fields.from).toBe('sender@mg.example.com')
      expect(fields.to).toBe('to@example.com')
      expect(fields.subject).toBe('Hello')
    })

    it('includes text and html body when provided', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'Plain text body', '<p>HTML body</p>'
      )

      const fields = formFields(mock.history[0])

      expect(fields.text).toBe('Plain text body')
      expect(fields.html).toBe('<p>HTML body</p>')
    })

    it('includes cc, bcc, reply-to when provided', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined,
        'cc@example.com', 'bcc@example.com', 'reply@example.com'
      )

      const fields = formFields(mock.history[0])

      expect(fields.cc).toBe('cc@example.com')
      expect(fields.bcc).toBe('bcc@example.com')
      expect(fields['h:Reply-To']).toBe('reply@example.com')
    })

    it('appends tags as repeated o:tag fields', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, ['welcome', 'onboarding']
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:tag']).toEqual(['welcome', 'onboarding'])
    })

    it('sets test mode when enabled', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, true
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:testmode']).toBe('yes')
    })

    it('sets tracking clicks and opens overrides', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, true, false
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:tracking-clicks']).toBe('yes')
      expect(fields['o:tracking-opens']).toBe('no')
    })

    it('downloads and attaches files from attachment URLs', async () => {
      const fileBuffer = Buffer.from('file-content')

      mock.onGet('https://files.example.com/report.pdf').reply(fileBuffer)
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        ['https://files.example.com/report.pdf']
      )

      // First call is the file download, second is the send
      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe('https://files.example.com/report.pdf')

      const fields = formFields(mock.history[1])

      expect(fields.attachment).toEqual([
        expect.objectContaining({ filename: 'report.pdf', isBuffer: true }),
      ])
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Forbidden' })

      await expect(
        service.sendEmail(domain, 'sender@mg.example.com', 'to@example.com', 'Hello', 'text')
      ).rejects.toThrow('Mailgun API error: Forbidden')
    })
  })

  describe('sendTemplatedEmail', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/messages`

    it('sends with required params only', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      const result = await service.sendTemplatedEmail(
        domain, 'welcome-template', 'sender@mg.example.com', 'to@example.com', 'Hello'
      )

      expect(result).toEqual({ id: '<msg-id>', message: 'Queued.' })

      const fields = formFields(mock.history[0])

      expect(fields.template).toBe('welcome-template')
      expect(fields.from).toBe('sender@mg.example.com')
      expect(fields.to).toBe('to@example.com')
      expect(fields.subject).toBe('Hello')
    })

    it('includes template variables as JSON header', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendTemplatedEmail(
        domain, 'welcome', 'sender@mg.example.com', 'to@example.com', 'Hello',
        { firstName: 'Ada', plan: 'Pro' }
      )

      const fields = formFields(mock.history[0])

      expect(fields['h:X-Mailgun-Variables']).toBe(JSON.stringify({ firstName: 'Ada', plan: 'Pro' }))
    })

    it('omits template variables header when empty object', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendTemplatedEmail(
        domain, 'welcome', 'sender@mg.example.com', 'to@example.com', 'Hello', {}
      )

      const fields = formFields(mock.history[0])

      expect(fields['h:X-Mailgun-Variables']).toBeUndefined()
    })

    it('includes cc, bcc, reply-to, tags, test mode', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendTemplatedEmail(
        domain, 'welcome', 'sender@mg.example.com', 'to@example.com', 'Hello',
        undefined,
        'cc@example.com', 'bcc@example.com', 'reply@example.com',
        ['tag1'], undefined, true
      )

      const fields = formFields(mock.history[0])

      expect(fields.cc).toBe('cc@example.com')
      expect(fields.bcc).toBe('bcc@example.com')
      expect(fields['h:Reply-To']).toBe('reply@example.com')
      expect(fields['o:tag']).toBe('tag1')
      expect(fields['o:testmode']).toBe('yes')
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Template not found' })

      await expect(
        service.sendTemplatedEmail(domain, 'bad', 'sender@mg.example.com', 'to@example.com', 'Hi')
      ).rejects.toThrow('Mailgun API error: Template not found')
    })
  })

  // ── Events ──

  describe('getEvents', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/events`

    it('sends request with defaults', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.getEvents(domain)

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('maps event type dropdown value to API value', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, 'Delivered')

      expect(mock.history[0].query).toMatchObject({ event: 'delivered' })
    })

    it('includes recipient and time range', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      // Use epoch seconds for begin/end
      await service.getEvents(domain, undefined, 'user@example.com', '1700000000', '1700100000')

      expect(mock.history[0].query).toMatchObject({
        recipient: 'user@example.com',
        begin: 1700000000,
        end: 1700100000,
      })
    })

    it('sets ascending when only begin time is given', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, undefined, undefined, '1700000000')

      expect(mock.history[0].query).toMatchObject({
        begin: 1700000000,
        ascending: 'yes',
      })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, undefined, undefined, undefined, undefined, 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Unauthorized' })

      await expect(service.getEvents(domain)).rejects.toThrow('Mailgun API error: Unauthorized')
    })
  })

  // ── Email Validation ──

  describe('validateEmailAddress', () => {
    const url = `${ BASE }/v4/address/validate`

    it('sends address as query parameter', async () => {
      mock.onGet(url).reply({
        address: 'user@example.com',
        result: 'deliverable',
        risk: 'low',
      })

      const result = await service.validateEmailAddress('user@example.com')

      expect(result).toEqual({
        address: 'user@example.com',
        result: 'deliverable',
        risk: 'low',
      })
      expect(mock.history[0].query).toMatchObject({ address: 'user@example.com' })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Forbidden' })

      await expect(service.validateEmailAddress('bad')).rejects.toThrow('Mailgun API error: Forbidden')
    })
  })

  // ── Mailing Lists ──

  describe('createMailingList', () => {
    const url = `${ BASE }/v3/lists`

    it('sends with required params only', async () => {
      mock.onPost(url).reply({ list: { address: 'news@mg.example.com' }, message: 'Mailing list has been created' })

      const result = await service.createMailingList('news@mg.example.com')

      expect(result.message).toBe('Mailing list has been created')
      expect(mock.history[0].method).toBe('post')

      const fields = formFields(mock.history[0])

      expect(fields.address).toBe('news@mg.example.com')
    })

    it('includes name, description, and access level', async () => {
      mock.onPost(url).reply({ list: {}, message: 'Created' })

      await service.createMailingList('news@mg.example.com', 'Newsletter', 'Monthly news', 'Members')

      const fields = formFields(mock.history[0])

      expect(fields.name).toBe('Newsletter')
      expect(fields.description).toBe('Monthly news')
      expect(fields.access_level).toBe('members')
    })

    it('maps access level choices correctly', async () => {
      mock.onPost(url).reply({ list: {}, message: 'Created' })

      await service.createMailingList('news@mg.example.com', undefined, undefined, 'Read Only')

      const fields = formFields(mock.history[0])

      expect(fields.access_level).toBe('readonly')
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Duplicate' })

      await expect(service.createMailingList('dup@mg.example.com')).rejects.toThrow('Mailgun API error: Duplicate')
    })
  })

  describe('listMailingLists', () => {
    const url = `${ BASE }/v3/lists/pages`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.listMailingLists()

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listMailingLists(25)

      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listMailingLists()).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('getMailingList', () => {
    it('fetches by list address', async () => {
      const url = `${ BASE }/v3/lists/news%40mg.example.com`

      mock.onGet(url).reply({ list: { address: 'news@mg.example.com' } })

      const result = await service.getMailingList('news@mg.example.com')

      expect(result.list.address).toBe('news@mg.example.com')
      expect(mock.history[0].url).toBe(url)
    })

    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/v3/lists/bad%40mg.example.com`).replyWithError({ message: 'Not found' })

      await expect(service.getMailingList('bad@mg.example.com')).rejects.toThrow('Mailgun API error: Not found')
    })
  })

  describe('deleteMailingList', () => {
    it('sends delete request', async () => {
      const url = `${ BASE }/v3/lists/news%40mg.example.com`

      mock.onDelete(url).reply({ address: 'news@mg.example.com', message: 'Removed' })

      const result = await service.deleteMailingList('news@mg.example.com')

      expect(result.message).toBe('Removed')
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${ BASE }/v3/lists/bad%40mg.example.com`).replyWithError({ message: 'Boom' })

      await expect(service.deleteMailingList('bad@mg.example.com')).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('addListMember', () => {
    const url = `${ BASE }/v3/lists/news%40mg.example.com/members`

    it('sends with required params only', async () => {
      mock.onPost(url).reply({ member: { address: 'user@example.com' }, message: 'Created' })

      const result = await service.addListMember('news@mg.example.com', 'user@example.com')

      expect(result.message).toBe('Created')

      const fields = formFields(mock.history[0])

      expect(fields.address).toBe('user@example.com')
    })

    it('includes name, vars, subscribed, and upsert', async () => {
      mock.onPost(url).reply({ member: {}, message: 'Created' })

      await service.addListMember(
        'news@mg.example.com', 'user@example.com', 'Ada',
        { city: 'Austin' }, true, true
      )

      const fields = formFields(mock.history[0])

      expect(fields.name).toBe('Ada')
      expect(fields.vars).toBe(JSON.stringify({ city: 'Austin' }))
      expect(fields.subscribed).toBe('yes')
      expect(fields.upsert).toBe('yes')
    })

    it('sets subscribed to no when false', async () => {
      mock.onPost(url).reply({ member: {}, message: 'Created' })

      await service.addListMember(
        'news@mg.example.com', 'user@example.com', undefined, undefined, false
      )

      const fields = formFields(mock.history[0])

      expect(fields.subscribed).toBe('no')
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Already exists' })

      await expect(
        service.addListMember('news@mg.example.com', 'user@example.com')
      ).rejects.toThrow('Mailgun API error: Already exists')
    })
  })

  describe('listMembers', () => {
    const url = `${ BASE }/v3/lists/news%40mg.example.com/members/pages`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.listMembers('news@mg.example.com')

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('maps subscription status to API value', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listMembers('news@mg.example.com', 'Subscribed')

      expect(mock.history[0].query).toMatchObject({ subscribed: 'yes' })
    })

    it('maps Unsubscribed status', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listMembers('news@mg.example.com', 'Unsubscribed')

      expect(mock.history[0].query).toMatchObject({ subscribed: 'no' })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listMembers('news@mg.example.com', undefined, 25)

      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listMembers('news@mg.example.com')).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('deleteListMember', () => {
    it('sends delete request', async () => {
      const url = `${ BASE }/v3/lists/news%40mg.example.com/members/user%40example.com`

      mock.onDelete(url).reply({ member: { address: 'user@example.com' }, message: 'Deleted' })

      const result = await service.deleteListMember('news@mg.example.com', 'user@example.com')

      expect(result.message).toBe('Deleted')
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      const url = `${ BASE }/v3/lists/news%40mg.example.com/members/bad%40example.com`

      mock.onDelete(url).replyWithError({ message: 'Not found' })

      await expect(
        service.deleteListMember('news@mg.example.com', 'bad@example.com')
      ).rejects.toThrow('Mailgun API error: Not found')
    })
  })

  // ── Suppressions ──

  describe('listBounces', () => {
    const url = `${ BASE }/v3/mg.example.com/bounces`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.listBounces('mg.example.com')

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listBounces('mg.example.com', 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listBounces('mg.example.com')).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('deleteBounce', () => {
    it('sends delete request', async () => {
      const url = `${ BASE }/v3/mg.example.com/bounces/bounced%40example.com`

      mock.onDelete(url).reply({ address: 'bounced@example.com', message: 'Removed' })

      const result = await service.deleteBounce('mg.example.com', 'bounced@example.com')

      expect(result.message).toBe('Removed')
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      const url = `${ BASE }/v3/mg.example.com/bounces/bad%40example.com`

      mock.onDelete(url).replyWithError({ message: 'Not found' })

      await expect(
        service.deleteBounce('mg.example.com', 'bad@example.com')
      ).rejects.toThrow('Mailgun API error: Not found')
    })
  })

  describe('listUnsubscribes', () => {
    const url = `${ BASE }/v3/mg.example.com/unsubscribes`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.listUnsubscribes('mg.example.com')

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listUnsubscribes('mg.example.com', 25)

      expect(mock.history[0].query).toMatchObject({ limit: 25 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listUnsubscribes('mg.example.com')).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('addUnsubscribe', () => {
    const url = `${ BASE }/v3/mg.example.com/unsubscribes`

    it('sends with required params only', async () => {
      mock.onPost(url).reply({ message: 'Address has been added', address: 'user@example.com' })

      const result = await service.addUnsubscribe('mg.example.com', 'user@example.com')

      expect(result.message).toBe('Address has been added')

      const fields = formFields(mock.history[0])

      expect(fields.address).toBe('user@example.com')
    })

    it('includes tag when provided', async () => {
      mock.onPost(url).reply({ message: 'Added' })

      await service.addUnsubscribe('mg.example.com', 'user@example.com', 'newsletter')

      const fields = formFields(mock.history[0])

      expect(fields.tag).toBe('newsletter')
    })

    it('throws on API error', async () => {
      mock.onPost(url).replyWithError({ message: 'Boom' })

      await expect(
        service.addUnsubscribe('mg.example.com', 'user@example.com')
      ).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('deleteUnsubscribe', () => {
    it('sends delete request', async () => {
      const url = `${ BASE }/v3/mg.example.com/unsubscribes/user%40example.com`

      mock.onDelete(url).reply({ address: 'user@example.com', message: 'Removed' })

      const result = await service.deleteUnsubscribe('mg.example.com', 'user@example.com')

      expect(result.message).toBe('Removed')
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      const url = `${ BASE }/v3/mg.example.com/unsubscribes/bad%40example.com`

      mock.onDelete(url).replyWithError({ message: 'Not found' })

      await expect(
        service.deleteUnsubscribe('mg.example.com', 'bad@example.com')
      ).rejects.toThrow('Mailgun API error: Not found')
    })
  })

  describe('listComplaints', () => {
    const url = `${ BASE }/v3/mg.example.com/complaints`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      const result = await service.listComplaints('mg.example.com')

      expect(result).toEqual({ items: [], paging: {} })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.listComplaints('mg.example.com', 50)

      expect(mock.history[0].query).toMatchObject({ limit: 50 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listComplaints('mg.example.com')).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  // ── Statistics ──

  describe('getStats', () => {
    it('builds query with repeated event params and duration', async () => {
      const url = `${ BASE }/v3/mg.example.com/stats/total?event=accepted&event=delivered&duration=30d`

      mock.onGet(url).reply({ start: '', end: '', resolution: 'day', stats: [] })

      const result = await service.getStats(['Accepted', 'Delivered'], 'mg.example.com', '30d')

      expect(result).toHaveProperty('stats')
      expect(mock.history).toHaveLength(1)
    })

    it('uses start/end time instead of duration when provided', async () => {
      const url = `${ BASE }/v3/mg.example.com/stats/total?event=delivered&start=1700000000&end=1700100000`

      mock.onGet(url).reply({ start: '', end: '', resolution: 'day', stats: [] })

      await service.getStats(['Delivered'], 'mg.example.com', undefined, '1700000000', '1700100000')

      expect(mock.history).toHaveLength(1)
    })

    it('throws on API error', async () => {
      // Match any URL for this test since query string building is dynamic
      mock.onAny().replyWithError({ message: 'Boom' })

      await expect(
        service.getStats(['Delivered'], 'mg.example.com', '7d')
      ).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  // ── Domains ──

  describe('listDomains', () => {
    const url = `${ BASE }/v3/domains`

    it('sends with default limit', async () => {
      mock.onGet(url).reply({ items: [], total_count: 0 })

      const result = await service.listDomains()

      expect(result).toEqual({ items: [], total_count: 0 })
      expect(mock.history[0].query).toMatchObject({ limit: 100 })
    })

    it('passes custom limit and skip', async () => {
      mock.onGet(url).reply({ items: [], total_count: 0 })

      await service.listDomains(25, 10)

      expect(mock.history[0].query).toMatchObject({ limit: 25, skip: 10 })
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Boom' })

      await expect(service.listDomains()).rejects.toThrow('Mailgun API error: Boom')
    })
  })

  describe('getDomain', () => {
    const url = `${ BASE }/v3/domains/mg.example.com`

    it('fetches domain details', async () => {
      mock.onGet(url).reply({
        domain: { name: 'mg.example.com', state: 'active' },
        sending_dns_records: [],
        receiving_dns_records: [],
      })

      const result = await service.getDomain('mg.example.com')

      expect(result.domain.name).toBe('mg.example.com')
      expect(mock.history[0].url).toBe(url)
    })

    it('throws on API error', async () => {
      mock.onGet(url).replyWithError({ message: 'Not found' })

      await expect(service.getDomain('mg.example.com')).rejects.toThrow('Mailgun API error: Not found')
    })
  })

  // ── Dictionaries ──

  describe('getDomainsDictionary', () => {
    const url = `${ BASE }/v3/domains`

    it('maps domains to dictionary items', async () => {
      mock.onGet(url).reply({
        items: [
          { name: 'mg.example.com', state: 'active', type: 'custom' },
          { name: 'sandbox123.mailgun.org', state: 'active', type: 'sandbox' },
        ],
        total_count: 2,
      })

      const result = await service.getDomainsDictionary({})

      expect(result.items).toEqual([
        { label: 'mg.example.com', value: 'mg.example.com', note: 'active - custom' },
        { label: 'sandbox123.mailgun.org', value: 'sandbox123.mailgun.org', note: 'active - sandbox' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(url).reply({
        items: [
          { name: 'mg.example.com', state: 'active', type: 'custom' },
          { name: 'sandbox123.mailgun.org', state: 'active', type: 'sandbox' },
        ],
        total_count: 2,
      })

      const result = await service.getDomainsDictionary({ search: 'sandbox' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('sandbox123.mailgun.org')
    })

    it('returns cursor when more pages available', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        name: `domain${ i }.com`,
        state: 'active',
        type: 'custom',
      }))

      mock.onGet(url).reply({ items, total_count: 200 })

      const result = await service.getDomainsDictionary({})

      expect(result.cursor).toBe('100')
    })

    it('uses cursor as skip offset', async () => {
      mock.onGet(url).reply({ items: [], total_count: 200 })

      await service.getDomainsDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ limit: 100, skip: 100 })
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({ items: [], total_count: 0 })

      const result = await service.getDomainsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getMailingListsDictionary', () => {
    const url = `${ BASE }/v3/lists/pages`

    it('maps mailing lists to dictionary items', async () => {
      mock.onGet(url).reply({
        items: [
          { address: 'news@mg.example.com', name: 'Newsletter', members_count: 42 },
          { address: 'alerts@mg.example.com', name: '', members_count: 5 },
        ],
      })

      const result = await service.getMailingListsDictionary({})

      expect(result.items).toEqual([
        { label: 'Newsletter (news@mg.example.com)', value: 'news@mg.example.com', note: '42 members' },
        { label: 'alerts@mg.example.com', value: 'alerts@mg.example.com', note: '5 members' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term on address and name', async () => {
      mock.onGet(url).reply({
        items: [
          { address: 'news@mg.example.com', name: 'Newsletter', members_count: 42 },
          { address: 'alerts@mg.example.com', name: 'Alerts', members_count: 5 },
        ],
      })

      const result = await service.getMailingListsDictionary({ search: 'alert' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('alerts@mg.example.com')
    })

    it('uses cursor as URL for pagination', async () => {
      const nextUrl = 'https://api.mailgun.net/v3/lists/pages?page=next&address=news@mg.example.com'

      mock.onGet(nextUrl).reply({ items: [] })

      await service.getMailingListsDictionary({ cursor: nextUrl })

      expect(mock.history[0].url).toBe(nextUrl)
    })

    it('returns cursor when page is full', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        address: `list${ i }@mg.example.com`,
        members_count: i,
      }))
      const nextUrl = 'https://api.mailgun.net/v3/lists/pages?page=next'

      mock.onGet(url).reply({ items, paging: { next: nextUrl } })

      const result = await service.getMailingListsDictionary({})

      expect(result.cursor).toBe(nextUrl)
    })

    it('handles null payload', async () => {
      mock.onGet(url).reply({ items: [] })

      const result = await service.getMailingListsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Edge Cases & Branch Coverage ──

  describe('sendEmail (delivery time)', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/messages`

    it('converts ISO 8601 delivery time to RFC 2822', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, '2026-01-15T12:00:00Z'
      )

      const fields = formFields(mock.history[0])

      // Should be converted to UTC string (RFC 2822 format)
      expect(fields['o:deliverytime']).toBeDefined()
      expect(fields['o:deliverytime']).toContain('2026')
    })

    it('converts epoch seconds delivery time to RFC 2822', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, '1700000000'
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:deliverytime']).toBeDefined()
    })

    it('converts epoch milliseconds delivery time to RFC 2822', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, '1700000000000'
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:deliverytime']).toBeDefined()
    })

    it('throws on invalid delivery time', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await expect(
        service.sendEmail(
          domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
          'text', undefined, undefined, undefined, undefined,
          undefined, undefined, 'not-a-date'
        )
      ).rejects.toThrow('invalid delivery time')
    })

    it('does not set tracking-clicks when not a boolean', async () => {
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined
      )

      const fields = formFields(mock.history[0])

      expect(fields['o:tracking-clicks']).toBeUndefined()
      expect(fields['o:tracking-opens']).toBeUndefined()
    })
  })

  describe('getEvents (time conversion branches)', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/events`

    it('converts ISO 8601 begin time to epoch seconds', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, undefined, undefined, '2026-01-15T12:00:00Z')

      const query = mock.history[0].query

      expect(query.begin).toBe(Math.floor(Date.parse('2026-01-15T12:00:00Z') / 1000))
      expect(query.ascending).toBe('yes')
    })

    it('converts epoch milliseconds begin time to epoch seconds', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, undefined, undefined, '1700000000000')

      expect(mock.history[0].query.begin).toBe(1700000000)
    })

    it('does not set ascending when both begin and end are given', async () => {
      mock.onGet(url).reply({ items: [], paging: {} })

      await service.getEvents(domain, undefined, undefined, '1700000000', '1700100000')

      const query = mock.history[0].query

      expect(query.ascending).toBeUndefined()
    })

    it('throws on invalid begin time value', async () => {
      await expect(
        service.getEvents(domain, undefined, undefined, 'not-a-timestamp')
      ).rejects.toThrow('invalid timestamp')
    })
  })

  describe('getStats (edge cases)', () => {
    it('uses start time only (no end, no duration)', async () => {
      const url = `${ BASE }/v3/mg.example.com/stats/total?event=delivered&start=1700000000`

      mock.onGet(url).reply({ start: '', end: '', resolution: 'day', stats: [] })

      await service.getStats(['Delivered'], 'mg.example.com', undefined, '1700000000')

      expect(mock.history).toHaveLength(1)
    })

    it('ignores duration when start time is provided', async () => {
      const url = `${ BASE }/v3/mg.example.com/stats/total?event=delivered&start=1700000000`

      mock.onGet(url).reply({ stats: [] })

      await service.getStats(['Delivered'], 'mg.example.com', '30d', '1700000000')

      // Duration should not appear when start is set
      expect(mock.history[0].url).not.toContain('duration')
    })
  })

  describe('getDomainsDictionary (edge cases)', () => {
    const url = `${ BASE }/v3/domains`

    it('handles domains with missing state or type in note', async () => {
      mock.onGet(url).reply({
        items: [
          { name: 'nodesc.com' },
        ],
        total_count: 1,
      })

      const result = await service.getDomainsDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })

    it('returns null cursor when fetched count is less than page limit', async () => {
      mock.onGet(url).reply({
        items: [{ name: 'only-one.com', state: 'active', type: 'custom' }],
        total_count: 1,
      })

      const result = await service.getDomainsDictionary({})

      expect(result.cursor).toBeNull()
    })

    it('returns null cursor when total_count is missing', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        name: `domain${ i }.com`,
        state: 'active',
        type: 'custom',
      }))

      mock.onGet(url).reply({ items })

      const result = await service.getDomainsDictionary({})

      // total_count is 0 (default), so hasMore is false
      expect(result.cursor).toBeNull()
    })
  })

  describe('getMailingListsDictionary (edge cases)', () => {
    const url = `${ BASE }/v3/lists/pages`

    it('handles lists without name (uses address as label)', async () => {
      mock.onGet(url).reply({
        items: [
          { address: 'no-name@mg.example.com', members_count: 3 },
        ],
      })

      const result = await service.getMailingListsDictionary({})

      expect(result.items[0].label).toBe('no-name@mg.example.com')
      expect(result.items[0].note).toBe('3 members')
    })

    it('handles lists without members_count', async () => {
      mock.onGet(url).reply({
        items: [
          { address: 'test@mg.example.com', name: 'Test' },
        ],
      })

      const result = await service.getMailingListsDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })

    it('returns null cursor when paging.next is missing', async () => {
      const items = Array.from({ length: 100 }, (_, i) => ({
        address: `list${ i }@mg.example.com`,
        members_count: i,
      }))

      mock.onGet(url).reply({ items, paging: {} })

      const result = await service.getMailingListsDictionary({})

      expect(result.cursor).toBeNull()
    })

    it('filters by name when search matches name but not address', async () => {
      mock.onGet(url).reply({
        items: [
          { address: 'abc@mg.example.com', name: 'Newsletter', members_count: 5 },
          { address: 'xyz@mg.example.com', name: 'Alerts', members_count: 2 },
        ],
      })

      const result = await service.getMailingListsDictionary({ search: 'Newsletter' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('abc@mg.example.com')
    })
  })

  describe('sendEmail (multiple attachments)', () => {
    const domain = 'mg.example.com'
    const url = `${ BASE }/v3/mg.example.com/messages`

    it('handles multiple attachment URLs', async () => {
      mock.onGet('https://files.example.com/file1.pdf').reply(Buffer.from('pdf-content'))
      mock.onGet('https://files.example.com/file2.txt').reply(Buffer.from('txt-content'))
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        ['https://files.example.com/file1.pdf', 'https://files.example.com/file2.txt']
      )

      // Two file downloads + one POST
      expect(mock.history).toHaveLength(3)

      const fields = formFields(mock.history[2])

      expect(fields.attachment).toHaveLength(2)
      expect(fields.attachment[0].filename).toBe('file1.pdf')
      expect(fields.attachment[1].filename).toBe('file2.txt')
    })

    it('uses fallback filename when URL has no file name', async () => {
      mock.onGet('https://files.example.com/').reply(Buffer.from('data'))
      mock.onPost(url).reply({ id: '<msg-id>', message: 'Queued.' })

      await service.sendEmail(
        domain, 'sender@mg.example.com', 'to@example.com', 'Hello',
        'text', undefined, undefined, undefined, undefined,
        ['https://files.example.com/']
      )

      const fields = formFields(mock.history[1])

      expect(fields.attachment[0].filename).toBe('attachment_1')
    })
  })

  describe('addListMember (edge cases)', () => {
    const url = `${ BASE }/v3/lists/news%40mg.example.com/members`

    it('omits vars when empty object', async () => {
      mock.onPost(url).reply({ member: {}, message: 'Created' })

      await service.addListMember('news@mg.example.com', 'user@example.com', undefined, {})

      const fields = formFields(mock.history[0])

      expect(fields.vars).toBeUndefined()
    })

    it('does not set upsert when false', async () => {
      mock.onPost(url).reply({ member: {}, message: 'Created' })

      await service.addListMember('news@mg.example.com', 'user@example.com', undefined, undefined, undefined, false)

      const fields = formFields(mock.history[0])

      expect(fields.upsert).toBeUndefined()
    })
  })

  describe('createMailingList (access level Everyone)', () => {
    const url = `${ BASE }/v3/lists`

    it('maps Everyone access level correctly', async () => {
      mock.onPost(url).reply({ list: {}, message: 'Created' })

      await service.createMailingList('news@mg.example.com', undefined, undefined, 'Everyone')

      const fields = formFields(mock.history[0])

      expect(fields.access_level).toBe('everyone')
    })
  })

  // ── EU Region ──

  describe('EU region', () => {
    let euSandbox
    let euService
    let euMock

    beforeAll(() => {
      euSandbox = createSandbox({ apiKey: API_KEY, region: 'EU' })
      jest.resetModules()
      require('../src/index.js')
      euService = euSandbox.getService()
      euMock = euSandbox.getRequestMock()
    })

    afterEach(() => {
      euMock.reset()
    })

    afterAll(() => {
      euSandbox.cleanup()
    })

    it('uses the EU base URL', async () => {
      const euBase = 'https://api.eu.mailgun.net'

      euMock.onGet(`${ euBase }/v3/domains`).reply({ items: [], total_count: 0 })

      await euService.listDomains()

      expect(euMock.history[0].url).toBe(`${ euBase }/v3/domains`)
    })
  })
})
