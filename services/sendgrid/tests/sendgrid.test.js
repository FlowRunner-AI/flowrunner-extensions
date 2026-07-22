'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'SG.test-api-key'
const BASE = 'https://api.sendgrid.com/v3'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ API_KEY }`,
  'Content-Type': 'application/json',
}

describe('SendGrid Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
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
    it('registers the API key config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['apiKey'])

      expect(configItems[0]).toMatchObject({
        name: 'apiKey',
        displayName: 'API Key',
        type: 'STRING',
        required: true,
        shared: false,
      })
    })

    it('stores the API key on the instance', () => {
      expect(service.apiKey).toBe(API_KEY)
    })
  })

  // ── Email ──

  describe('sendEmail', () => {
    it('sends a minimal text email', async () => {
      mock.onPost(`${ BASE }/mail/send`).reply('')

      const result = await service.sendEmail(
        'from@example.com',
        null,
        'jane@example.com',
        null,
        null,
        'Hello',
        'Plain body'
      )

      expect(result).toEqual({ queued: true })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/mail/send`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)

      expect(mock.history[0].body).toEqual({
        personalizations: [{ to: [{ email: 'jane@example.com' }] }],
        from: { email: 'from@example.com' },
        subject: 'Hello',
        content: [{ type: 'text/plain', value: 'Plain body' }],
      })
    })

    it('supports arrays, comma-separated strings, cc/bcc, html and metadata', async () => {
      mock.onPost(`${ BASE }/mail/send`).reply('')

      await service.sendEmail(
        'from@example.com',
        'Acme',
        ['jane@example.com', ' john@example.com '],
        'cc1@example.com, cc2@example.com',
        ['bcc@example.com'],
        'Hello',
        'Plain body',
        '<p>HTML body</p>',
        'reply@example.com',
        null,
        1735689600,
        ['welcome'],
        { orderId: '123' }
      )

      expect(mock.history[0].body).toEqual({
        personalizations: [{
          to: [{ email: 'jane@example.com' }, { email: 'john@example.com' }],
          cc: [{ email: 'cc1@example.com' }, { email: 'cc2@example.com' }],
          bcc: [{ email: 'bcc@example.com' }],
        }],
        from: { email: 'from@example.com', name: 'Acme' },
        reply_to: { email: 'reply@example.com' },
        subject: 'Hello',
        content: [
          { type: 'text/plain', value: 'Plain body' },
          { type: 'text/html', value: '<p>HTML body</p>' },
        ],
        send_at: 1735689600,
        categories: ['welcome'],
        custom_args: { orderId: '123' },
      })
    })

    it('throws when neither text nor HTML content is provided', async () => {
      await expect(service.sendEmail('from@example.com', null, 'jane@example.com', null, null, 'Hi'))
        .rejects.toThrow('SendGrid API error: provide Text Content, HTML Content, or both')

      expect(mock.history).toHaveLength(0)
    })

    it('throws when no recipients resolve from the To value', async () => {
      await expect(service.sendEmail('from@example.com', null, '  ,  ', null, null, 'Hi', 'Body'))
        .rejects.toThrow('SendGrid API error: at least one "To" recipient is required')

      expect(mock.history).toHaveLength(0)
    })

    it('downloads attachments and encodes them as base64', async () => {
      mock.onGet('https://files.example.com/report.pdf').reply(Buffer.from('PDF-DATA', 'utf8'))
      mock.onPost(`${ BASE }/mail/send`).reply('')

      await service.sendEmail(
        'from@example.com',
        null,
        'jane@example.com',
        null,
        null,
        'Hello',
        'Body',
        null,
        null,
        ['https://files.example.com/report.pdf']
      )

      const download = mock.history[0]

      expect(download.method).toBe('get')
      expect(download.encoding).toBeNull()

      expect(mock.history[1].body.attachments).toEqual([{
        content: Buffer.from('PDF-DATA', 'utf8').toString('base64'),
        filename: 'report.pdf',
        type: 'application/pdf',
        disposition: 'attachment',
      }])
    })

    it('strips query strings, decodes filenames and falls back to octet-stream', async () => {
      mock.onGet('https://files.example.com/my%20file?token=1').reply('binary-bytes')
      mock.onPost(`${ BASE }/mail/send`).reply('')

      await service.sendEmail(
        'from@example.com',
        null,
        'jane@example.com',
        null,
        null,
        'Hello',
        'Body',
        null,
        null,
        ['https://files.example.com/my%20file?token=1']
      )

      expect(mock.history[1].body.attachments).toEqual([{
        content: Buffer.from('binary-bytes').toString('base64'),
        filename: 'my file',
        type: 'application/octet-stream',
        disposition: 'attachment',
      }])
    })

    it('throws when an attachment cannot be downloaded', async () => {
      mock.onGet('https://files.example.com/missing.pdf').replyWithError({ message: 'Not Found' })

      await expect(
        service.sendEmail(
          'from@example.com', null, 'jane@example.com', null, null, 'Hello', 'Body',
          null, null, ['https://files.example.com/missing.pdf']
        )
      ).rejects.toThrow('SendGrid API error: failed to download attachment from https://files.example.com/missing.pdf')
    })

    it('wraps SendGrid field errors from the API response', async () => {
      mock.onPost(`${ BASE }/mail/send`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ field: 'from.email', message: 'does not match verified sender' }] },
      })

      await expect(
        service.sendEmail('from@example.com', null, 'jane@example.com', null, null, 'Hi', 'Body')
      ).rejects.toThrow('SendGrid API error: from.email: does not match verified sender')
    })

    it('joins multiple errors and omits missing field names', async () => {
      mock.onPost(`${ BASE }/mail/send`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'first problem' }, { field: 'subject', message: 'second problem' }] },
      })

      await expect(
        service.sendEmail('from@example.com', null, 'jane@example.com', null, null, 'Hi', 'Body')
      ).rejects.toThrow('SendGrid API error: first problem; subject: second problem')
    })

    it('falls back to body.error and then to the raw message', async () => {
      mock.onPost(`${ BASE }/mail/send`).replyWithError({
        message: 'Bad Request',
        body: { error: 'plain error' },
      })

      await expect(
        service.sendEmail('from@example.com', null, 'jane@example.com', null, null, 'Hi', 'Body')
      ).rejects.toThrow('SendGrid API error: plain error')

      mock.reset()
      mock.onPost(`${ BASE }/mail/send`).replyWithError({ message: 'Network down' })

      await expect(
        service.sendEmail('from@example.com', null, 'jane@example.com', null, null, 'Hi', 'Body')
      ).rejects.toThrow('SendGrid API error: Network down')
    })
  })

  describe('sendTemplatedEmail', () => {
    it('sends a template id with dynamic data and no content block', async () => {
      mock.onPost(`${ BASE }/mail/send`).reply('')

      const result = await service.sendTemplatedEmail(
        'from@example.com',
        'Acme',
        'jane@example.com',
        null,
        null,
        'd-template-id',
        { firstName: 'Jane' }
      )

      expect(result).toEqual({ queued: true })

      expect(mock.history[0].body).toEqual({
        personalizations: [{
          to: [{ email: 'jane@example.com' }],
          dynamic_template_data: { firstName: 'Jane' },
        }],
        from: { email: 'from@example.com', name: 'Acme' },
        template_id: 'd-template-id',
      })
    })

    it('requires at least one recipient', async () => {
      await expect(service.sendTemplatedEmail('from@example.com', null, null, null, null, 'd-1'))
        .rejects.toThrow('SendGrid API error: at least one "To" recipient is required')
    })
  })

  // ── Contacts ──

  describe('upsertContacts', () => {
    it('sends a PUT with contacts only', async () => {
      mock.onPut(`${ BASE }/marketing/contacts`).reply({ job_id: 'job-1' })

      const result = await service.upsertContacts([{ email: 'jane@example.com' }])

      expect(result).toEqual({ job_id: 'job-1' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ contacts: [{ email: 'jane@example.com' }] })
    })

    it('includes list ids when provided', async () => {
      mock.onPut(`${ BASE }/marketing/contacts`).reply({ job_id: 'job-2' })

      await service.upsertContacts([{ email: 'jane@example.com' }], ['list-1'])

      expect(mock.history[0].body).toEqual({
        contacts: [{ email: 'jane@example.com' }],
        list_ids: ['list-1'],
      })
    })

    it('omits empty list ids', async () => {
      mock.onPut(`${ BASE }/marketing/contacts`).reply({ job_id: 'job-3' })

      await service.upsertContacts([{ email: 'jane@example.com' }], [])

      expect(mock.history[0].body).not.toHaveProperty('list_ids')
    })
  })

  describe('searchContacts', () => {
    it('posts an SGQL query', async () => {
      mock.onPost(`${ BASE }/marketing/contacts/search`).reply({ result: [], contact_count: 0 })

      const result = await service.searchContacts("email LIKE '%@example.com'")

      expect(result).toEqual({ result: [], contact_count: 0 })
      expect(mock.history[0].body).toEqual({ query: "email LIKE '%@example.com'" })
    })

    it('throws on API errors', async () => {
      mock.onPost(`${ BASE }/marketing/contacts/search`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'invalid query' }] },
      })

      await expect(service.searchContacts('nope')).rejects.toThrow('SendGrid API error: invalid query')
    })
  })

  describe('getContactByEmail', () => {
    it('posts the email inside an emails array', async () => {
      mock.onPost(`${ BASE }/marketing/contacts/search/emails`).reply({ result: {} })

      await service.getContactByEmail('jane@example.com')

      expect(mock.history[0].body).toEqual({ emails: ['jane@example.com'] })
    })
  })

  describe('deleteContacts', () => {
    it('deletes by comma-separated ids', async () => {
      mock.onDelete(`${ BASE }/marketing/contacts`).reply({ job_id: 'job-4' })

      const result = await service.deleteContacts(['a', 'b'])

      expect(result).toEqual({ job_id: 'job-4' })
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toEqual({ ids: 'a,b' })
    })

    it('deletes all contacts when the flag is enabled', async () => {
      mock.onDelete(`${ BASE }/marketing/contacts`).reply({ job_id: 'job-5' })

      await service.deleteContacts(null, true)

      expect(mock.history[0].query).toEqual({ delete_all_contacts: 'true' })
    })

    it('throws when neither ids nor the delete-all flag are provided', async () => {
      await expect(service.deleteContacts([]))
        .rejects.toThrow('SendGrid API error: provide Contact IDs or enable Delete All')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Lists ──

  describe('createList', () => {
    it('posts the list name', async () => {
      mock.onPost(`${ BASE }/marketing/lists`).reply({ id: 'list-1', name: 'Newsletter' })

      const result = await service.createList('Newsletter')

      expect(result).toEqual({ id: 'list-1', name: 'Newsletter' })
      expect(mock.history[0].body).toEqual({ name: 'Newsletter' })
    })
  })

  describe('getLists', () => {
    it('defaults the page size to 100', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({ result: [] })

      await service.getLists()

      expect(mock.history[0].query).toEqual({ page_size: 100 })
    })

    it('passes custom page size and token', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({ result: [] })

      await service.getLists(25, 'token-1')

      expect(mock.history[0].query).toEqual({ page_size: 25, page_token: 'token-1' })
    })
  })

  describe('deleteList', () => {
    it('deletes a list and returns a synthetic result when the API body is empty', async () => {
      mock.onDelete(`${ BASE }/marketing/lists/list-1`).reply('')

      const result = await service.deleteList('list-1')

      expect(result).toEqual({ deleted: true, listId: 'list-1' })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes the delete_contacts flag and url-encodes the list id', async () => {
      mock.onDelete(`${ BASE }/marketing/lists/list%2F1`).reply({ job_id: 'job-6' })

      const result = await service.deleteList('list/1', true)

      expect(result).toEqual({ job_id: 'job-6' })
      expect(mock.history[0].query).toEqual({ delete_contacts: 'true' })
    })
  })

  // ── Templates ──

  describe('listDynamicTemplates', () => {
    it('requests dynamic generations with default paging', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ result: [] })

      await service.listDynamicTemplates()

      expect(mock.history[0].query).toEqual({ generations: 'dynamic', page_size: 100 })
    })

    it('passes page size and token', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ result: [] })

      await service.listDynamicTemplates(10, 'tok')

      expect(mock.history[0].query).toEqual({ generations: 'dynamic', page_size: 10, page_token: 'tok' })
    })
  })

  // ── Suppressions ──

  describe('listGlobalUnsubscribes', () => {
    it('sends no query params when nothing is provided', async () => {
      mock.onGet(`${ BASE }/suppression/unsubscribes`).reply([])

      const result = await service.listGlobalUnsubscribes()

      expect(result).toEqual([])
      expect(mock.history[0].query).toEqual({})
    })

    it('sends the full time window and paging params', async () => {
      mock.onGet(`${ BASE }/suppression/unsubscribes`).reply([{ email: 'jane@example.com' }])

      await service.listGlobalUnsubscribes(1, 2, 10, 20)

      expect(mock.history[0].query).toEqual({ start_time: 1, end_time: 2, limit: 10, offset: 20 })
    })
  })

  describe('addGlobalUnsubscribes', () => {
    it('posts the recipient emails', async () => {
      mock.onPost(`${ BASE }/asm/suppressions/global`).reply({ recipient_emails: ['jane@example.com'] })

      const result = await service.addGlobalUnsubscribes(['jane@example.com'])

      expect(result).toEqual({ recipient_emails: ['jane@example.com'] })
      expect(mock.history[0].body).toEqual({ recipient_emails: ['jane@example.com'] })
    })
  })

  describe('deleteGlobalUnsubscribe', () => {
    it('deletes the encoded email and returns a confirmation', async () => {
      mock.onDelete(`${ BASE }/asm/suppressions/global/jane%40example.com`).reply('')

      const result = await service.deleteGlobalUnsubscribe('jane@example.com')

      expect(result).toEqual({ deleted: true, email: 'jane@example.com' })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('listBounces', () => {
    it('sends the optional time window', async () => {
      mock.onGet(`${ BASE }/suppression/bounces`).reply([])

      await service.listBounces(100, 200)

      expect(mock.history[0].query).toEqual({ start_time: 100, end_time: 200 })
    })
  })

  describe('deleteBounces', () => {
    it('deletes specific emails', async () => {
      mock.onDelete(`${ BASE }/suppression/bounces`).reply('')

      const result = await service.deleteBounces(['jane@example.com'])

      expect(result).toEqual({ deleted: true })
      expect(mock.history[0].body).toEqual({ emails: ['jane@example.com'] })
    })

    it('deletes all bounces when the flag is enabled', async () => {
      mock.onDelete(`${ BASE }/suppression/bounces`).reply('')

      await service.deleteBounces(null, true)

      expect(mock.history[0].body).toEqual({ delete_all: true })
    })

    it('throws when neither emails nor the delete-all flag are provided', async () => {
      await expect(service.deleteBounces())
        .rejects.toThrow('SendGrid API error: provide Emails or enable Delete All')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Statistics ──

  describe('getEmailStats', () => {
    it('maps the aggregation label to the API value', async () => {
      mock.onGet(`${ BASE }/stats`).reply([])

      await service.getEmailStats('2026-07-01', '2026-07-10', 'Week')

      expect(mock.history[0].query).toEqual({
        start_date: '2026-07-01',
        end_date: '2026-07-10',
        aggregated_by: 'week',
      })
    })

    it('passes through an unmapped aggregation value and omits missing params', async () => {
      mock.onGet(`${ BASE }/stats`).reply([])

      await service.getEmailStats('2026-07-01', null, 'day')

      expect(mock.history[0].query).toEqual({ start_date: '2026-07-01', aggregated_by: 'day' })
    })

    it('omits the aggregation when it is not provided', async () => {
      mock.onGet(`${ BASE }/stats`).reply([])

      await service.getEmailStats('2026-07-01')

      expect(mock.history[0].query).toEqual({ start_date: '2026-07-01' })
    })
  })

  // ── Validation ──

  describe('validateEmail', () => {
    it('posts the email only', async () => {
      mock.onPost(`${ BASE }/validations/email`).reply({ result: { verdict: 'Valid' } })

      const result = await service.validateEmail('jane@example.com')

      expect(result).toEqual({ result: { verdict: 'Valid' } })
      expect(mock.history[0].body).toEqual({ email: 'jane@example.com' })
    })

    it('includes the source when provided', async () => {
      mock.onPost(`${ BASE }/validations/email`).reply({ result: { verdict: 'Valid' } })

      await service.validateEmail('jane@example.com', 'signup')

      expect(mock.history[0].body).toEqual({ email: 'jane@example.com', source: 'signup' })
    })
  })

  // ── Senders ──

  describe('getVerifiedSenders', () => {
    it('sends no query params by default', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({ results: [] })

      await service.getVerifiedSenders()

      expect(mock.history[0].query).toEqual({})
    })

    it('sends limit and lastSeenID', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({ results: [] })

      await service.getVerifiedSenders(10, 5)

      expect(mock.history[0].query).toEqual({ limit: 10, lastSeenID: 5 })
    })
  })

  // ── Dictionaries ──

  describe('getListsDictionary', () => {
    it('maps lists to dictionary items with a contact-count note', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({
        result: [{ id: 'list-1', name: 'Newsletter', contact_count: 42 }],
        _metadata: {},
      })

      const result = await service.getListsDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Newsletter', value: 'list-1', note: '42 contacts' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ page_size: 100 })
    })

    it('handles a null payload and a missing result array', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({})

      const result = await service.getListsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('filters case-insensitively by name', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({
        result: [
          { id: '1', name: 'Newsletter' },
          { id: '2', name: 'Customers' },
        ],
      })

      const result = await service.getListsDictionary({ search: 'CUSTO' })

      expect(result.items).toEqual([{ label: 'Customers', value: '2', note: '0 contacts' }])
    })

    it('passes the cursor and extracts the next page token', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({
        result: [],
        _metadata: { next: `${ BASE }/marketing/lists?page_token=NEXT` },
      })

      const result = await service.getListsDictionary({ cursor: 'PREV' })

      expect(mock.history[0].query).toEqual({ page_size: 100, page_token: 'PREV' })
      expect(result.cursor).toBe('NEXT')
    })

    it('returns a null cursor when the next link is not a valid URL', async () => {
      mock.onGet(`${ BASE }/marketing/lists`).reply({ result: [], _metadata: { next: 'not-a-url' } })

      const result = await service.getListsDictionary({})

      expect(result.cursor).toBeNull()
    })
  })

  describe('getTemplatesDictionary', () => {
    it('maps templates and uses the active version subject as the note', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        result: [{
          id: 'd-1',
          name: 'Order Confirmation',
          versions: [
            { active: 0, subject: 'old' },
            { active: 1, subject: 'Your order is confirmed' },
          ],
        }],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({
        items: [{ label: 'Order Confirmation', value: 'd-1', note: 'Your order is confirmed' }],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ generations: 'dynamic', page_size: 100 })
    })

    it('falls back to the templates key and omits the note without an active version', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ templates: [{ id: 'd-2', name: 'Welcome' }] })

      const result = await service.getTemplatesDictionary(null)

      expect(result.items).toEqual([{ label: 'Welcome', value: 'd-2', note: undefined }])
    })

    it('filters templates by search text', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        result: [{ id: 'd-1', name: 'Welcome' }, { id: 'd-2', name: 'Receipt' }],
      })

      const result = await service.getTemplatesDictionary({ search: 'rece' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('d-2')
    })

    it('returns an empty list when the response has no templates', async () => {
      mock.onGet(`${ BASE }/templates`).reply({})

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getVerifiedSendersDictionary', () => {
    it('maps senders with a name-and-email label', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({
        results: [{ from_email: 'support@example.com', from_name: 'Example Support', nickname: 'Support' }],
      })

      const result = await service.getVerifiedSendersDictionary({})

      expect(result).toEqual({
        items: [{
          label: 'Example Support <support@example.com>',
          value: 'support@example.com',
          note: 'Support',
        }],
        cursor: null,
      })
    })

    it('marks unverified senders and falls back to the email as the label', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({
        results: [{ from_email: 'raw@example.com', verified: false }],
      })

      const result = await service.getVerifiedSendersDictionary(null)

      expect(result.items).toEqual([{
        label: 'raw@example.com',
        value: 'raw@example.com',
        note: 'NOT VERIFIED',
      }])
    })

    it('omits the note when there is nothing to show', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({
        results: [{ from_email: 'raw@example.com', verified: true }],
      })

      const result = await service.getVerifiedSendersDictionary({})

      expect(result.items[0].note).toBeUndefined()
    })

    it('filters by email, name or nickname', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({
        results: [
          { from_email: 'support@example.com', nickname: 'Support' },
          { from_email: 'sales@example.com', nickname: 'Sales' },
        ],
      })

      const result = await service.getVerifiedSendersDictionary({ search: 'SALES' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('sales@example.com')
    })

    it('handles a response with no results', async () => {
      mock.onGet(`${ BASE }/verified_senders`).reply({})

      const result = await service.getVerifiedSendersDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
