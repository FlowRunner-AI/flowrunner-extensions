'use strict'

const { createSandbox } = require('../../../service-sandbox')

const SERVER_TOKEN = 'test-server-token'
const BASE = 'https://api.postmarkapp.com'

const AUTH_HEADERS = {
  'X-Postmark-Server-Token': SERVER_TOKEN,
  'Accept': 'application/json',
  'Content-Type': 'application/json',
}

describe('Postmark Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ serverToken: SERVER_TOKEN })
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
    it('registers the server token config item', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['serverToken'])

      expect(configItems[0]).toMatchObject({
        name: 'serverToken',
        displayName: 'Server API Token',
        type: 'STRING',
        required: true,
        shared: false,
      })
    })
  })

  // ── Email sending ──

  describe('sendEmail', () => {
    it('sends a minimal email with the default message stream', async () => {
      mock.onPost(`${ BASE }/email`).reply({ MessageID: 'msg-1', ErrorCode: 0, Message: 'OK' })

      const result = await service.sendEmail(
        'sender@example.com',
        'john@example.com',
        'Hello',
        '<p>Hi</p>'
      )

      expect(result).toEqual({ MessageID: 'msg-1', ErrorCode: 0, Message: 'OK' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/email`)
      expect(mock.history[0].headers).toMatchObject(AUTH_HEADERS)

      expect(mock.history[0].body).toEqual({
        From: 'sender@example.com',
        To: 'john@example.com',
        Subject: 'Hello',
        HtmlBody: '<p>Hi</p>',
        MessageStream: 'outbound',
      })
    })

    it('sends all optional envelope fields and maps the track links choice', async () => {
      mock.onPost(`${ BASE }/email`).reply({ MessageID: 'msg-2' })

      await service.sendEmail(
        'sender@example.com',
        'john@example.com',
        'Hello',
        '<p>Hi</p>',
        'Hi',
        'cc@example.com',
        'bcc@example.com',
        'reply@example.com',
        'welcome-email',
        true,
        'Html And Text',
        'broadcast',
        { 'order-id': '12345' }
      )

      expect(mock.history[0].body).toEqual({
        From: 'sender@example.com',
        To: 'john@example.com',
        Cc: 'cc@example.com',
        Bcc: 'bcc@example.com',
        Subject: 'Hello',
        HtmlBody: '<p>Hi</p>',
        TextBody: 'Hi',
        ReplyTo: 'reply@example.com',
        Tag: 'welcome-email',
        TrackOpens: true,
        TrackLinks: 'HtmlAndText',
        MessageStream: 'broadcast',
        Metadata: { 'order-id': '12345' },
      })
    })

    it('passes an unmapped track links value through unchanged', async () => {
      mock.onPost(`${ BASE }/email`).reply({ MessageID: 'msg-3' })

      await service.sendEmail('a@b.com', 'c@d.com', 'S', undefined, 'Text', undefined, undefined, undefined, undefined, undefined, 'HtmlOnly')

      expect(mock.history[0].body.TrackLinks).toBe('HtmlOnly')
    })

    it('downloads attachment URLs and encodes them as base64', async () => {
      const fileUrl = 'https://files.example.com/reports/summary%20q1.pdf?token=abc'

      mock.onGet(fileUrl).reply(Buffer.from('PDF-CONTENT'))
      mock.onPost(`${ BASE }/email`).reply({ MessageID: 'msg-4' })

      await service.sendEmail(
        'sender@example.com',
        'john@example.com',
        'Report',
        undefined,
        'See attached',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        [fileUrl]
      )

      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].url).toBe(fileUrl)
      expect(mock.history[0].encoding).toBeNull()

      expect(mock.history[1].body.Attachments).toEqual([
        {
          Name: 'summary q1.pdf',
          Content: Buffer.from('PDF-CONTENT').toString('base64'),
          ContentType: 'application/pdf',
        },
      ])
    })

    it('falls back to octet-stream for unknown extensions', async () => {
      const fileUrl = 'https://files.example.com/data.unknownext'

      mock.onGet(fileUrl).reply('raw-bytes')
      mock.onPost(`${ BASE }/email`).reply({ MessageID: 'msg-5' })

      await service.sendEmail(
        'a@b.com', 'c@d.com', 'S', undefined, 'Text',
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        [fileUrl]
      )

      expect(mock.history[1].body.Attachments[0]).toMatchObject({
        Name: 'data.unknownext',
        ContentType: 'application/octet-stream',
      })
    })

    it('throws when neither HTML nor text body is provided', async () => {
      await expect(service.sendEmail('a@b.com', 'c@d.com', 'Subject'))
        .rejects.toThrow('provide at least one of HTML Body or Text Body')

      expect(mock.history).toHaveLength(0)
    })

    it('wraps Postmark errors with the error code', async () => {
      mock.onPost(`${ BASE }/email`).replyWithError({
        message: 'Unprocessable Entity',
        body: { ErrorCode: 300, Message: "Error parsing 'To': Illegal email address." },
      })

      await expect(service.sendEmail('a@b.com', 'bad', 'S', 'x'))
        .rejects.toThrow("Postmark API error: Error parsing 'To': Illegal email address. (ErrorCode: 300)")
    })

    it('falls back to the transport error message when no body is returned', async () => {
      mock.onPost(`${ BASE }/email`).replyWithError({ message: 'Network timeout' })

      await expect(service.sendEmail('a@b.com', 'c@d.com', 'S', 'x'))
        .rejects.toThrow('Postmark API error: Network timeout')
    })
  })

  describe('sendEmailWithTemplate', () => {
    it('sends with a numeric template id', async () => {
      mock.onPost(`${ BASE }/email/withTemplate`).reply({ MessageID: 'msg-6' })

      const result = await service.sendEmailWithTemplate(
        'sender@example.com',
        'john@example.com',
        '1234',
        undefined,
        { name: 'John' }
      )

      expect(result).toEqual({ MessageID: 'msg-6' })

      expect(mock.history[0].body).toEqual({
        TemplateId: 1234,
        TemplateModel: { name: 'John' },
        From: 'sender@example.com',
        To: 'john@example.com',
        MessageStream: 'outbound',
      })
    })

    it('sends with a template alias when no id is given', async () => {
      mock.onPost(`${ BASE }/email/withTemplate`).reply({ MessageID: 'msg-7' })

      await service.sendEmailWithTemplate('a@b.com', 'c@d.com', undefined, 'welcome-email')

      expect(mock.history[0].body).toEqual({
        TemplateAlias: 'welcome-email',
        TemplateModel: {},
        From: 'a@b.com',
        To: 'c@d.com',
        MessageStream: 'outbound',
      })
    })

    it('prefers the template id and ignores the alias when both are provided', async () => {
      mock.onPost(`${ BASE }/email/withTemplate`).reply({ MessageID: 'msg-8' })

      await service.sendEmailWithTemplate('a@b.com', 'c@d.com', '99', 'welcome-email', {})

      expect(mock.history[0].body.TemplateId).toBe(99)
      expect(mock.history[0].body).not.toHaveProperty('TemplateAlias')
    })

    it('sends the optional envelope fields and attachments', async () => {
      const fileUrl = 'https://files.example.com/invoice.png'

      mock.onGet(fileUrl).reply(Buffer.from('PNG'))
      mock.onPost(`${ BASE }/email/withTemplate`).reply({ MessageID: 'msg-9' })

      await service.sendEmailWithTemplate(
        'a@b.com', 'c@d.com', '1', undefined, { x: 1 },
        'cc@e.com', 'bcc@e.com', 'reply@e.com', 'tagged', false, 'Text Only', 'broadcast',
        { k: 'v' }, [fileUrl]
      )

      expect(mock.history[1].body).toMatchObject({
        Cc: 'cc@e.com',
        Bcc: 'bcc@e.com',
        ReplyTo: 'reply@e.com',
        Tag: 'tagged',
        TrackOpens: false,
        TrackLinks: 'TextOnly',
        MessageStream: 'broadcast',
        Metadata: { k: 'v' },
      })

      expect(mock.history[1].body.Attachments[0]).toMatchObject({
        Name: 'invoice.png',
        ContentType: 'image/png',
      })
    })

    it('throws when neither template id nor alias is provided', async () => {
      await expect(service.sendEmailWithTemplate('a@b.com', 'c@d.com'))
        .rejects.toThrow('provide either Template ID or Template Alias')

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('sendBatchEmails', () => {
    it('posts the raw messages array', async () => {
      const messages = [{ From: 'a@b.com', To: 'c@d.com', Subject: 'S', TextBody: 'T' }]

      mock.onPost(`${ BASE }/email/batch`).reply([{ ErrorCode: 0, MessageID: 'msg-10' }])

      const result = await service.sendBatchEmails(messages)

      expect(result).toEqual([{ ErrorCode: 0, MessageID: 'msg-10' }])
      expect(mock.history[0].body).toEqual(messages)
    })

    it('throws when messages is not a non-empty array', async () => {
      await expect(service.sendBatchEmails([])).rejects.toThrow('Messages must be a non-empty array')
      await expect(service.sendBatchEmails('nope')).rejects.toThrow('Messages must be a non-empty array')
      await expect(service.sendBatchEmails()).rejects.toThrow('Messages must be a non-empty array')

      expect(mock.history).toHaveLength(0)
    })
  })

  // ── Templates ──

  describe('listTemplates', () => {
    it('applies the default page size and offset', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ TotalCount: 0, Templates: [] })

      const result = await service.listTemplates()

      expect(result).toEqual({ TotalCount: 0, Templates: [] })
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].query).toEqual({ Count: 50, Offset: 0 })
      expect(mock.history[0].body).toBeUndefined()
    })

    it('passes count, offset and template type', async () => {
      mock.onGet(`${ BASE }/templates`).reply({ TotalCount: 1, Templates: [] })

      await service.listTemplates(10, 20, 'Layout')

      expect(mock.history[0].query).toEqual({ Count: 10, Offset: 20, TemplateType: 'Layout' })
    })
  })

  describe('getTemplate', () => {
    it('URL-encodes the template identifier', async () => {
      mock.onGet(`${ BASE }/templates/welcome%20email`).reply({ TemplateId: 1234 })

      const result = await service.getTemplate('welcome email')

      expect(result).toEqual({ TemplateId: 1234 })
    })

    it('wraps a not-found error', async () => {
      mock.onGet(`${ BASE }/templates/999`).replyWithError({
        message: 'Not Found',
        body: { ErrorCode: 1101, Message: 'The template does not exist.' },
      })

      await expect(service.getTemplate('999'))
        .rejects.toThrow('Postmark API error: The template does not exist. (ErrorCode: 1101)')
    })
  })

  // ── Outbound messages ──

  describe('searchOutboundMessages', () => {
    it('applies the default paging', async () => {
      mock.onGet(`${ BASE }/messages/outbound`).reply({ TotalCount: 0, Messages: [] })

      await service.searchOutboundMessages()

      expect(mock.history[0].query).toEqual({ count: 50, offset: 0 })
    })

    it('maps the status choice and passes every filter', async () => {
      mock.onGet(`${ BASE }/messages/outbound`).reply({ TotalCount: 0, Messages: [] })

      await service.searchOutboundMessages(
        'john@example.com',
        'sender@example.com',
        'welcome-email',
        'Processed',
        'Welcome!',
        '2026-07-01',
        '2026-07-13',
        'outbound',
        25,
        50
      )

      expect(mock.history[0].query).toEqual({
        recipient: 'john@example.com',
        fromemail: 'sender@example.com',
        tag: 'welcome-email',
        status: 'processed',
        subject: 'Welcome!',
        fromdate: '2026-07-01',
        todate: '2026-07-13',
        messagestream: 'outbound',
        count: 25,
        offset: 50,
      })
    })

    it('passes an unmapped status through unchanged', async () => {
      mock.onGet(`${ BASE }/messages/outbound`).reply({ Messages: [] })

      await service.searchOutboundMessages(undefined, undefined, undefined, 'sent')

      expect(mock.history[0].query.status).toBe('sent')
    })
  })

  describe('getMessageDetails', () => {
    it('URL-encodes the message id', async () => {
      mock.onGet(`${ BASE }/messages/outbound/msg-1/details`).reply({ MessageID: 'msg-1' })

      const result = await service.getMessageDetails('msg-1')

      expect(result).toEqual({ MessageID: 'msg-1' })
    })
  })

  // ── Statistics ──

  describe('getOutboundOverview', () => {
    it('sends no filters by default', async () => {
      mock.onGet(`${ BASE }/stats/outbound`).reply({ Sent: 615 })

      const result = await service.getOutboundOverview()

      expect(result).toEqual({ Sent: 615 })
      expect(mock.history[0].query).toEqual({})
    })

    it('passes tag, date range and message stream', async () => {
      mock.onGet(`${ BASE }/stats/outbound`).reply({ Sent: 10 })

      await service.getOutboundOverview('welcome-email', '2026-07-01', '2026-07-13', 'outbound')

      expect(mock.history[0].query).toEqual({
        tag: 'welcome-email',
        fromdate: '2026-07-01',
        todate: '2026-07-13',
        messagestream: 'outbound',
      })
    })
  })

  describe('getDeliveryStats', () => {
    it('requests the delivery stats endpoint', async () => {
      mock.onGet(`${ BASE }/deliverystats`).reply({ InactiveMails: 192, Bounces: [] })

      const result = await service.getDeliveryStats()

      expect(result).toEqual({ InactiveMails: 192, Bounces: [] })
      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Bounces ──

  describe('searchBounces', () => {
    it('applies the default paging', async () => {
      mock.onGet(`${ BASE }/bounces`).reply({ TotalCount: 0, Bounces: [] })

      await service.searchBounces()

      expect(mock.history[0].query).toEqual({ count: 50, offset: 0 })
    })

    it('maps the bounce type choice and passes every filter', async () => {
      mock.onGet(`${ BASE }/bounces`).reply({ TotalCount: 0, Bounces: [] })

      await service.searchBounces(
        'Hard Bounce',
        true,
        'john@example.com',
        'welcome-email',
        'msg-1',
        '2026-07-01',
        '2026-07-13',
        'outbound',
        5,
        10
      )

      expect(mock.history[0].query).toEqual({
        type: 'HardBounce',
        inactive: true,
        emailFilter: 'john@example.com',
        tag: 'welcome-email',
        messageID: 'msg-1',
        fromdate: '2026-07-01',
        todate: '2026-07-13',
        messagestream: 'outbound',
        count: 5,
        offset: 10,
      })
    })

    it('passes an unmapped bounce type through unchanged', async () => {
      mock.onGet(`${ BASE }/bounces`).reply({ Bounces: [] })

      await service.searchBounces('SoftBounce')

      expect(mock.history[0].query.type).toBe('SoftBounce')
    })
  })

  describe('getBounce', () => {
    it('requests the bounce by id', async () => {
      mock.onGet(`${ BASE }/bounces/692560173`).reply({ ID: 692560173 })

      const result = await service.getBounce('692560173')

      expect(result).toEqual({ ID: 692560173 })
    })
  })

  describe('activateBounce', () => {
    it('PUTs to the activate endpoint with an empty body', async () => {
      mock.onPut(`${ BASE }/bounces/692560173/activate`).reply({ Message: 'OK', Bounce: { ID: 692560173 } })

      const result = await service.activateBounce('692560173')

      expect(result).toEqual({ Message: 'OK', Bounce: { ID: 692560173 } })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })
  })

  // ── Suppressions ──

  describe('listSuppressions', () => {
    it('requests the suppression dump for the stream', async () => {
      mock.onGet(`${ BASE }/message-streams/outbound/suppressions/dump`).reply({ Suppressions: [] })

      const result = await service.listSuppressions('outbound')

      expect(result).toEqual({ Suppressions: [] })
      expect(mock.history[0].query).toEqual({})
    })

    it('maps the suppression reason and passes every filter', async () => {
      mock.onGet(`${ BASE }/message-streams/outbound/suppressions/dump`).reply({ Suppressions: [] })

      await service.listSuppressions(
        'outbound',
        'Manual Suppression',
        'Customer',
        'john@example.com',
        '2026-07-01',
        '2026-07-13'
      )

      expect(mock.history[0].query).toEqual({
        SuppressionReason: 'ManualSuppression',
        Origin: 'Customer',
        EmailAddress: 'john@example.com',
        fromdate: '2026-07-01',
        todate: '2026-07-13',
      })
    })
  })

  describe('createSuppression', () => {
    it('wraps the addresses in the Suppressions payload', async () => {
      mock.onPost(`${ BASE }/message-streams/outbound/suppressions`).reply({
        Suppressions: [{ EmailAddress: 'john@example.com', Status: 'Suppressed' }],
      })

      const result = await service.createSuppression('outbound', ['john@example.com', 'jane@example.com'])

      expect(result.Suppressions).toHaveLength(1)

      expect(mock.history[0].body).toEqual({
        Suppressions: [
          { EmailAddress: 'john@example.com' },
          { EmailAddress: 'jane@example.com' },
        ],
      })
    })

    it('throws when the address list is empty', async () => {
      await expect(service.createSuppression('outbound', []))
        .rejects.toThrow('Email Addresses must be a non-empty array')

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteSuppression', () => {
    it('posts to the suppressions delete endpoint', async () => {
      mock.onPost(`${ BASE }/message-streams/outbound/suppressions/delete`).reply({
        Suppressions: [{ EmailAddress: 'john@example.com', Status: 'Deleted' }],
      })

      await service.deleteSuppression('outbound', ['john@example.com'])

      expect(mock.history[0].body).toEqual({ Suppressions: [{ EmailAddress: 'john@example.com' }] })
    })

    it('throws when the address list is missing', async () => {
      await expect(service.deleteSuppression('outbound'))
        .rejects.toThrow('Email Addresses must be a non-empty array')
    })
  })

  // ── Message streams ──

  describe('listMessageStreams', () => {
    it('defaults to all stream types and omits the archived flag', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({ MessageStreams: [], TotalCount: 0 })

      const result = await service.listMessageStreams()

      expect(result).toEqual({ MessageStreams: [], TotalCount: 0 })
      expect(mock.history[0].query).toEqual({ MessageStreamType: 'All' })
    })

    it('passes the stream type and archived flag', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({ MessageStreams: [] })

      await service.listMessageStreams('Broadcasts', true)

      expect(mock.history[0].query).toEqual({
        MessageStreamType: 'Broadcasts',
        IncludeArchivedStreams: 'true',
      })
    })

    it('omits the archived flag when explicitly false', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({ MessageStreams: [] })

      await service.listMessageStreams('Inbound', false)

      expect(mock.history[0].query).toEqual({ MessageStreamType: 'Inbound' })
    })
  })

  // ── Dictionaries ──

  describe('getTemplatesDictionary', () => {
    it('maps standard templates to dictionary items', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        TotalCount: 2,
        Templates: [
          { TemplateId: 1234, Name: 'Welcome Email', Alias: 'welcome-email' },
          { TemplateId: 5678, Name: 'Receipt', Alias: null },
        ],
      })

      const result = await service.getTemplatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Welcome Email', value: '1234', note: 'Alias: welcome-email' },
          { label: 'Receipt', value: '5678', note: undefined },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ Count: 100, Offset: 0, TemplateType: 'Standard' })
    })

    it('filters case-insensitively by name or alias', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        TotalCount: 2,
        Templates: [
          { TemplateId: 1, Name: 'Welcome Email', Alias: 'welcome-email' },
          { TemplateId: 2, Name: 'Receipt', Alias: 'receipt' },
        ],
      })

      const result = await service.getTemplatesDictionary({ search: 'RECE' })

      expect(result.items).toEqual([{ label: 'Receipt', value: '2', note: 'Alias: receipt' }])
    })

    it('returns the next offset as the cursor when more templates remain', async () => {
      mock.onGet(`${ BASE }/templates`).reply({
        TotalCount: 250,
        Templates: Array.from({ length: 100 }, (_, index) => ({
          TemplateId: index + 1,
          Name: `T${ index + 1 }`,
          Alias: null,
        })),
      })

      const result = await service.getTemplatesDictionary({ cursor: '100' })

      expect(mock.history[0].query).toMatchObject({ Offset: 100 })
      expect(result.cursor).toBe('200')
      expect(result.items).toHaveLength(100)
    })

    it('handles a null payload and a missing Templates array', async () => {
      mock.onGet(`${ BASE }/templates`).reply({})

      const result = await service.getTemplatesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  describe('getMessageStreamsDictionary', () => {
    it('maps streams to dictionary items', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({
        MessageStreams: [
          { ID: 'outbound', Name: 'Default Transactional Stream', MessageStreamType: 'Transactional' },
          { ID: 'broadcast', Name: 'Default Broadcast Stream', MessageStreamType: 'Broadcasts' },
        ],
      })

      const result = await service.getMessageStreamsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Default Transactional Stream', value: 'outbound', note: 'Transactional' },
          { label: 'Default Broadcast Stream', value: 'broadcast', note: 'Broadcasts' },
        ],
        cursor: null,
      })

      expect(mock.history[0].query).toEqual({ MessageStreamType: 'All' })
    })

    it('filters case-insensitively by name or stream id', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({
        MessageStreams: [
          { ID: 'outbound', Name: 'Default Transactional Stream', MessageStreamType: 'Transactional' },
          { ID: 'broadcast', Name: 'Default Broadcast Stream', MessageStreamType: 'Broadcasts' },
        ],
      })

      const result = await service.getMessageStreamsDictionary({ search: 'BROAD' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('broadcast')
    })

    it('handles a null payload and a missing MessageStreams array', async () => {
      mock.onGet(`${ BASE }/message-streams`).reply({})

      const result = await service.getMessageStreamsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
