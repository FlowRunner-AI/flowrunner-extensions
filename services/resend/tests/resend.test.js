'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-resend-api-key'
const BASE = 'https://api.resend.com'

describe('Resend Service', () => {
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
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Emails ──

  describe('sendEmail', () => {
    it('sends correct request with required params', async () => {
      mock.onPost(`${BASE}/emails`).reply({ id: 'email-1' })

      const result = await service.sendEmail(
        'sender@example.com', ['to@example.com'], 'Subject', '<p>Hello</p>'
      )

      expect(result).toEqual({ id: 'email-1' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      })
      expect(mock.history[0].body).toEqual({
        from: 'sender@example.com',
        to: ['to@example.com'],
        subject: 'Subject',
        html: '<p>Hello</p>',
      })
    })

    it('sends all optional params when provided', async () => {
      mock.onPost(`${BASE}/emails`).reply({ id: 'email-2' })

      await service.sendEmail(
        'sender@example.com', ['to@example.com'], 'Subject', '<p>Hi</p>', 'plain text',
        ['cc@example.com'], ['bcc@example.com'], ['reply@example.com'],
        { 'X-Custom': 'val' }, '2026-08-01T00:00:00Z',
        [{ name: 'category', value: 'welcome' }],
        null, [{ path: 'https://example.com/file.pdf', filename: 'file.pdf' }]
      )

      expect(mock.history[0].body).toMatchObject({
        from: 'sender@example.com',
        to: ['to@example.com'],
        subject: 'Subject',
        html: '<p>Hi</p>',
        text: 'plain text',
        cc: ['cc@example.com'],
        bcc: ['bcc@example.com'],
        reply_to: ['reply@example.com'],
        headers: { 'X-Custom': 'val' },
        scheduled_at: '2026-08-01T00:00:00Z',
        tags: [{ name: 'category', value: 'welcome' }],
        attachments: [{ path: 'https://example.com/file.pdf', filename: 'file.pdf' }],
      })
    })

    it('wraps single recipient into array', async () => {
      mock.onPost(`${BASE}/emails`).reply({ id: 'email-3' })

      await service.sendEmail('s@example.com', 'one@example.com', 'Sub', '<p>Hi</p>')

      expect(mock.history[0].body.to).toEqual(['one@example.com'])
    })

    it('throws when no recipients provided', async () => {
      await expect(service.sendEmail('s@example.com', null, 'Sub', '<p>Hi</p>'))
        .rejects.toThrow('At least one recipient is required')
    })

    it('throws when recipients exceed 50', async () => {
      const recipients = Array.from({ length: 51 }, (_, i) => `r${i}@example.com`)

      await expect(service.sendEmail('s@example.com', recipients, 'Sub', '<p>Hi</p>'))
        .rejects.toThrow('at most 50 recipients')
    })

    it('throws when neither html nor text provided', async () => {
      await expect(service.sendEmail('s@example.com', ['to@example.com'], 'Sub'))
        .rejects.toThrow('Provide at least one of HTML Body or Text Body')
    })

    it('downloads and base64-encodes attachment file', async () => {
      const fileUrl = 'https://storage.example.com/report.pdf'
      const fakeBuffer = Buffer.from('pdf-content')

      mock.onGet(fileUrl).reply(fakeBuffer)
      mock.onPost(`${BASE}/emails`).reply({ id: 'email-att' })

      await service.sendEmail('s@example.com', ['to@example.com'], 'Sub', '<p>Hi</p>',
        null, null, null, null, null, null, null, fileUrl)

      expect(mock.history[1].body.attachments).toEqual([
        { filename: 'report.pdf', content: fakeBuffer.toString('base64') },
      ])
    })

    it('throws when remote attachment is missing path', async () => {
      await expect(
        service.sendEmail('s@example.com', ['to@example.com'], 'Sub', '<p>Hi</p>',
          null, null, null, null, null, null, null, null, [{ filename: 'f.pdf' }])
      ).rejects.toThrow('Each remote attachment must include a "path" URL')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/emails`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
      })

      await expect(service.sendEmail('s@example.com', ['to@example.com'], 'Sub', '<p>Hi</p>'))
        .rejects.toThrow('Resend API error')
    })
  })

  describe('getEmail', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/emails/email-123`).reply({ id: 'email-123', subject: 'Hi' })

      const result = await service.getEmail('email-123')

      expect(result).toEqual({ id: 'email-123', subject: 'Hi' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('updateEmail', () => {
    it('sends correct PATCH request', async () => {
      mock.onPatch(`${BASE}/emails/email-456`).reply({ object: 'email', id: 'email-456' })

      const result = await service.updateEmail('email-456', '2026-09-01T00:00:00Z')

      expect(result).toEqual({ object: 'email', id: 'email-456' })
      expect(mock.history[0].body).toEqual({ scheduled_at: '2026-09-01T00:00:00Z' })
    })
  })

  describe('cancelScheduledEmail', () => {
    it('sends correct POST request', async () => {
      mock.onPost(`${BASE}/emails/email-789/cancel`).reply({ object: 'email', id: 'email-789' })

      const result = await service.cancelScheduledEmail('email-789')

      expect(result).toEqual({ object: 'email', id: 'email-789' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('sendBatchEmails', () => {
    it('sends correct batch POST request', async () => {
      const emails = [
        { from: 'a@example.com', to: ['b@example.com'], subject: 'S1', html: '<p>1</p>' },
        { from: 'c@example.com', to: 'd@example.com', subject: 'S2', text: 'plain' },
      ]

      mock.onPost(`${BASE}/emails/batch`).reply({
        data: [{ id: 'b1' }, { id: 'b2' }],
      })

      const result = await service.sendBatchEmails(emails)

      expect(result.data).toHaveLength(2)
      expect(mock.history[0].body).toHaveLength(2)
      expect(mock.history[0].body[0].to).toEqual(['b@example.com'])
      expect(mock.history[0].body[1].to).toEqual(['d@example.com'])
    })

    it('throws when emails is empty', async () => {
      await expect(service.sendBatchEmails([])).rejects.toThrow('non-empty array')
    })

    it('throws when emails is not an array', async () => {
      await expect(service.sendBatchEmails('bad')).rejects.toThrow('non-empty array')
    })

    it('throws when batch exceeds 100', async () => {
      const emails = Array.from({ length: 101 }, (_, i) => ({
        from: `f${i}@example.com`, to: [`t${i}@example.com`], subject: `S${i}`,
      }))

      await expect(service.sendBatchEmails(emails)).rejects.toThrow('at most 100')
    })

    it('throws when a batch email is missing required fields', async () => {
      await expect(service.sendBatchEmails([{ from: 'a@b.com' }]))
        .rejects.toThrow('must include from, to, and subject')
    })
  })

  // ── Domains ──

  describe('createDomain', () => {
    it('sends correct POST request with defaults', async () => {
      mock.onPost(`${BASE}/domains`).reply({ id: 'dom-1', name: 'example.com' })

      const result = await service.createDomain('example.com')

      expect(result).toEqual({ id: 'dom-1', name: 'example.com' })
      expect(mock.history[0].body).toEqual({ name: 'example.com' })
    })

    it('resolves region choice label to API value', async () => {
      mock.onPost(`${BASE}/domains`).reply({ id: 'dom-2' })

      await service.createDomain('example.com', 'EU West (Ireland)')

      expect(mock.history[0].body).toEqual({ name: 'example.com', region: 'eu-west-1' })
    })
  })

  describe('listDomains', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/domains`).reply({ data: [{ id: 'dom-1', name: 'example.com' }] })

      const result = await service.listDomains()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('getDomain', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/domains/dom-1`).reply({ id: 'dom-1', name: 'example.com' })

      const result = await service.getDomain('dom-1')

      expect(result).toEqual({ id: 'dom-1', name: 'example.com' })
    })
  })

  describe('verifyDomain', () => {
    it('sends correct POST request', async () => {
      mock.onPost(`${BASE}/domains/dom-1/verify`).reply({ object: 'domain', id: 'dom-1' })

      const result = await service.verifyDomain('dom-1')

      expect(result).toEqual({ object: 'domain', id: 'dom-1' })
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('updateDomain', () => {
    it('sends correct PATCH request with all params', async () => {
      mock.onPatch(`${BASE}/domains/dom-1`).reply({ object: 'domain', id: 'dom-1' })

      await service.updateDomain('dom-1', true, false, 'Enforced')

      expect(mock.history[0].body).toEqual({
        click_tracking: true,
        open_tracking: false,
        tls: 'enforced',
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPatch(`${BASE}/domains/dom-1`).reply({ object: 'domain', id: 'dom-1' })

      await service.updateDomain('dom-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteDomain', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${BASE}/domains/dom-1`).reply({ object: 'domain', id: 'dom-1', deleted: true })

      const result = await service.deleteDomain('dom-1')

      expect(result).toEqual({ object: 'domain', id: 'dom-1', deleted: true })
    })
  })

  // ── API Keys ──

  describe('createApiKey', () => {
    it('sends correct POST request with defaults', async () => {
      mock.onPost(`${BASE}/api-keys`).reply({ id: 'key-1', token: 're_abc' })

      const result = await service.createApiKey('Production')

      expect(result).toEqual({ id: 'key-1', token: 're_abc' })
      expect(mock.history[0].body).toEqual({ name: 'Production' })
    })

    it('resolves permission choice and includes domainId', async () => {
      mock.onPost(`${BASE}/api-keys`).reply({ id: 'key-2', token: 're_def' })

      await service.createApiKey('Sending', 'Sending Access', 'dom-1')

      expect(mock.history[0].body).toEqual({
        name: 'Sending',
        permission: 'sending_access',
        domain_id: 'dom-1',
      })
    })
  })

  describe('listApiKeys', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/api-keys`).reply({ data: [{ id: 'key-1', name: 'Prod' }] })

      const result = await service.listApiKeys()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('deleteApiKey', () => {
    it('sends correct DELETE request and returns success', async () => {
      mock.onDelete(`${BASE}/api-keys/key-1`).reply(undefined)

      const result = await service.deleteApiKey('key-1')

      expect(result).toEqual({ success: true, id: 'key-1' })
    })
  })

  // ── Audiences ──

  describe('createAudience', () => {
    it('sends correct POST request', async () => {
      mock.onPost(`${BASE}/audiences`).reply({ object: 'audience', id: 'aud-1', name: 'Users' })

      const result = await service.createAudience('Users')

      expect(result).toEqual({ object: 'audience', id: 'aud-1', name: 'Users' })
      expect(mock.history[0].body).toEqual({ name: 'Users' })
    })
  })

  describe('listAudiences', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/audiences`).reply({ object: 'list', data: [{ id: 'aud-1' }] })

      const result = await service.listAudiences()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('getAudience', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/audiences/aud-1`).reply({ object: 'audience', id: 'aud-1', name: 'Users' })

      const result = await service.getAudience('aud-1')

      expect(result).toMatchObject({ id: 'aud-1', name: 'Users' })
    })
  })

  describe('deleteAudience', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${BASE}/audiences/aud-1`).reply({ object: 'audience', id: 'aud-1', deleted: true })

      const result = await service.deleteAudience('aud-1')

      expect(result).toMatchObject({ id: 'aud-1', deleted: true })
    })
  })

  // ── Contacts ──

  describe('createContact', () => {
    it('sends correct POST with required params', async () => {
      mock.onPost(`${BASE}/audiences/aud-1/contacts`).reply({ object: 'contact', id: 'con-1' })

      const result = await service.createContact('aud-1', 'user@example.com')

      expect(result).toMatchObject({ id: 'con-1' })
      expect(mock.history[0].body).toEqual({ email: 'user@example.com' })
    })

    it('includes optional name and unsubscribed fields', async () => {
      mock.onPost(`${BASE}/audiences/aud-1/contacts`).reply({ object: 'contact', id: 'con-2' })

      await service.createContact('aud-1', 'user@example.com', 'John', 'Doe', true)

      expect(mock.history[0].body).toEqual({
        email: 'user@example.com',
        first_name: 'John',
        last_name: 'Doe',
        unsubscribed: true,
      })
    })
  })

  describe('listContacts', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/audiences/aud-1/contacts`).reply({ object: 'list', data: [{ id: 'con-1' }] })

      const result = await service.listContacts('aud-1')

      expect(result.data).toHaveLength(1)
    })
  })

  describe('getContact', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/audiences/aud-1/contacts/con-1`).reply({ object: 'contact', id: 'con-1' })

      const result = await service.getContact('aud-1', 'con-1')

      expect(result).toMatchObject({ id: 'con-1' })
    })
  })

  describe('updateContact', () => {
    it('sends correct PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/audiences/aud-1/contacts/con-1`).reply({ object: 'contact', id: 'con-1' })

      await service.updateContact('aud-1', 'con-1', 'Jane', 'Smith', false)

      expect(mock.history[0].body).toEqual({
        first_name: 'Jane',
        last_name: 'Smith',
        unsubscribed: false,
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPatch(`${BASE}/audiences/aud-1/contacts/con-1`).reply({ object: 'contact', id: 'con-1' })

      await service.updateContact('aud-1', 'con-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteContact', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${BASE}/audiences/aud-1/contacts/con-1`).reply({ object: 'contact', id: 'con-1', deleted: true })

      const result = await service.deleteContact('aud-1', 'con-1')

      expect(result).toMatchObject({ deleted: true })
    })
  })

  // ── Broadcasts ──

  describe('createBroadcast', () => {
    it('sends correct POST with required params', async () => {
      mock.onPost(`${BASE}/broadcasts`).reply({ id: 'bc-1' })

      const result = await service.createBroadcast('aud-1', 'sender@example.com', 'Hello', '<p>World</p>')

      expect(result).toEqual({ id: 'bc-1' })
      expect(mock.history[0].body).toEqual({
        audience_id: 'aud-1',
        from: 'sender@example.com',
        subject: 'Hello',
        html: '<p>World</p>',
      })
    })

    it('sends all optional params', async () => {
      mock.onPost(`${BASE}/broadcasts`).reply({ id: 'bc-2' })

      await service.createBroadcast(
        'aud-1', 'sender@example.com', 'Hello', '<p>World</p>', 'plain',
        'My Broadcast', ['reply@example.com'], 'Preview text'
      )

      expect(mock.history[0].body).toMatchObject({
        text: 'plain',
        name: 'My Broadcast',
        reply_to: ['reply@example.com'],
        preview_text: 'Preview text',
      })
    })

    it('throws when neither html nor text provided', async () => {
      await expect(service.createBroadcast('aud-1', 'sender@example.com', 'Hello'))
        .rejects.toThrow('Provide at least one of HTML Body or Text Body')
    })
  })

  describe('listBroadcasts', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/broadcasts`).reply({ object: 'list', data: [{ id: 'bc-1' }] })

      const result = await service.listBroadcasts()

      expect(result.data).toHaveLength(1)
    })
  })

  describe('getBroadcast', () => {
    it('sends correct GET request', async () => {
      mock.onGet(`${BASE}/broadcasts/bc-1`).reply({ object: 'broadcast', id: 'bc-1' })

      const result = await service.getBroadcast('bc-1')

      expect(result).toMatchObject({ id: 'bc-1' })
    })
  })

  describe('updateBroadcast', () => {
    it('sends correct PATCH with provided fields', async () => {
      mock.onPatch(`${BASE}/broadcasts/bc-1`).reply({ id: 'bc-1' })

      await service.updateBroadcast('bc-1', 'aud-2', 'new@example.com', 'New Subject',
        '<p>New</p>', 'new text', 'Renamed', ['r@example.com'], 'Preview')

      expect(mock.history[0].body).toEqual({
        audience_id: 'aud-2',
        from: 'new@example.com',
        subject: 'New Subject',
        html: '<p>New</p>',
        text: 'new text',
        name: 'Renamed',
        reply_to: ['r@example.com'],
        preview_text: 'Preview',
      })
    })

    it('omits empty optional fields', async () => {
      mock.onPatch(`${BASE}/broadcasts/bc-1`).reply({ id: 'bc-1' })

      await service.updateBroadcast('bc-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('sendBroadcast', () => {
    it('sends correct POST request with scheduledAt', async () => {
      mock.onPost(`${BASE}/broadcasts/bc-1/send`).reply({ id: 'bc-1' })

      const result = await service.sendBroadcast('bc-1', '2026-09-01T00:00:00Z')

      expect(result).toEqual({ id: 'bc-1' })
      expect(mock.history[0].body).toEqual({ scheduled_at: '2026-09-01T00:00:00Z' })
    })

    it('sends without scheduledAt for immediate send', async () => {
      mock.onPost(`${BASE}/broadcasts/bc-1/send`).reply({ id: 'bc-1' })

      await service.sendBroadcast('bc-1')

      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('deleteBroadcast', () => {
    it('sends correct DELETE request', async () => {
      mock.onDelete(`${BASE}/broadcasts/bc-1`).reply({ object: 'broadcast', id: 'bc-1', deleted: true })

      const result = await service.deleteBroadcast('bc-1')

      expect(result).toMatchObject({ id: 'bc-1', deleted: true })
    })
  })

  // ── Dictionaries ──

  describe('getDomainsDictionary', () => {
    const domainsResponse = {
      data: [
        { id: 'dom-1', name: 'example.com', status: 'verified', region: 'us-east-1' },
        { id: 'dom-2', name: 'beta.com', status: 'not_started', region: 'eu-west-1' },
      ],
    }

    it('returns mapped items', async () => {
      mock.onGet(`${BASE}/domains`).reply(domainsResponse)

      const result = await service.getDomainsDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'example.com',
        value: 'dom-1',
        note: 'verified - us-east-1',
      })
      expect(result.cursor).toBeNull()
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/domains`).reply(domainsResponse)

      const result = await service.getDomainsDictionary({ search: 'BETA' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('dom-2')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/domains`).reply(domainsResponse)

      const result = await service.getDomainsDictionary(null)

      expect(result.items).toHaveLength(2)
    })

    it('handles empty data', async () => {
      mock.onGet(`${BASE}/domains`).reply({ data: null })

      const result = await service.getDomainsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getAudiencesDictionary', () => {
    it('returns mapped items with created_at note', async () => {
      mock.onGet(`${BASE}/audiences`).reply({
        data: [{ id: 'aud-1', name: 'Users', created_at: '2026-10-06T22:59:55.977Z' }],
      })

      const result = await service.getAudiencesDictionary({})

      expect(result.items).toEqual([{
        label: 'Users',
        value: 'aud-1',
        note: 'Created 2026-10-06',
      }])
      expect(result.cursor).toBeNull()
    })

    it('filters by search', async () => {
      mock.onGet(`${BASE}/audiences`).reply({
        data: [
          { id: 'aud-1', name: 'Users' },
          { id: 'aud-2', name: 'Admins' },
        ],
      })

      const result = await service.getAudiencesDictionary({ search: 'admin' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('aud-2')
    })
  })

  describe('getBroadcastsDictionary', () => {
    it('returns mapped items with status note', async () => {
      mock.onGet(`${BASE}/broadcasts`).reply({
        data: [{ id: 'bc-1', name: 'Weekly Update', status: 'draft' }],
      })

      const result = await service.getBroadcastsDictionary({})

      expect(result.items).toEqual([{
        label: 'Weekly Update',
        value: 'bc-1',
        note: 'draft',
      }])
    })

    it('uses subject as label fallback when name is missing', async () => {
      mock.onGet(`${BASE}/broadcasts`).reply({
        data: [{ id: 'bc-1', subject: 'Promo', status: 'sent' }],
      })

      const result = await service.getBroadcastsDictionary({})

      expect(result.items[0].label).toBe('Promo')
    })

    it('uses id as label fallback when both name and subject missing', async () => {
      mock.onGet(`${BASE}/broadcasts`).reply({
        data: [{ id: 'bc-1', status: 'draft' }],
      })

      const result = await service.getBroadcastsDictionary({})

      expect(result.items[0].label).toBe('bc-1')
    })

    it('filters by name or subject', async () => {
      mock.onGet(`${BASE}/broadcasts`).reply({
        data: [
          { id: 'bc-1', name: 'Weekly', subject: 'Updates', status: 'draft' },
          { id: 'bc-2', name: 'Monthly', subject: 'Report', status: 'sent' },
        ],
      })

      const result = await service.getBroadcastsDictionary({ search: 'report' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('bc-2')
    })
  })

  describe('getContactsDictionary', () => {
    it('returns empty when no audienceId in criteria', async () => {
      const result = await service.getContactsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('returns mapped items with name note', async () => {
      mock.onGet(`${BASE}/audiences/aud-1/contacts`).reply({
        data: [{
          id: 'con-1', email: 'user@example.com',
          first_name: 'John', last_name: 'Doe', unsubscribed: false,
        }],
      })

      const result = await service.getContactsDictionary({
        criteria: { audienceId: 'aud-1' },
      })

      expect(result.items).toEqual([{
        label: 'user@example.com',
        value: 'con-1',
        note: 'John Doe',
      }])
    })

    it('includes unsubscribed in note', async () => {
      mock.onGet(`${BASE}/audiences/aud-1/contacts`).reply({
        data: [{
          id: 'con-1', email: 'user@example.com',
          first_name: 'Jane', last_name: null, unsubscribed: true,
        }],
      })

      const result = await service.getContactsDictionary({
        criteria: { audienceId: 'aud-1' },
      })

      expect(result.items[0].note).toBe('Jane - unsubscribed')
    })

    it('filters by search across email, first_name, last_name', async () => {
      mock.onGet(`${BASE}/audiences/aud-1/contacts`).reply({
        data: [
          { id: 'c1', email: 'alpha@example.com', first_name: 'A', last_name: 'B', unsubscribed: false },
          { id: 'c2', email: 'beta@example.com', first_name: 'C', last_name: 'D', unsubscribed: false },
        ],
      })

      const result = await service.getContactsDictionary({
        search: 'alpha',
        criteria: { audienceId: 'aud-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('c1')
    })

    it('handles null payload', async () => {
      const result = await service.getContactsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts error message from error.body.message', async () => {
      mock.onGet(`${BASE}/domains`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Domain not found' },
      })

      await expect(service.listDomains()).rejects.toThrow('Resend API error: Domain not found')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onGet(`${BASE}/domains`).replyWithError({
        message: 'Network timeout',
      })

      await expect(service.listDomains()).rejects.toThrow('Resend API error: Network timeout')
    })
  })
})
