'use strict'

const { createSandbox } = require('../../../service-sandbox')

const { CredentialProvider } = require('../src/credentials')
const { mapAwsError, createLogger } = require('../src/errors')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')
const {
  buildAwsJsonRequest,
  buildRestJsonRequest,
  parseJsonResponse,
  parseXmlTag,
  parseXmlTags,
  jsonRequest,
  restJsonRequest,
} = require('../src/aws-client')

const ACCESS_KEY = 'AKIDEXAMPLE'
const SECRET_KEY = 'SECRETEXAMPLE'
const REGION = 'us-east-1'

const OUTBOUND_PATH = '/v2/email/outbound-emails'
const BULK_PATH = '/v2/email/outbound-bulk-emails'

describe('SES Service', () => {
  let sandbox
  let service
  let restMock
  let SES

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    // Required only after the sandbox installs global.Flowrunner so the service self-registers.
    ;({ SES } = require('../src/index.js'))

    service = sandbox.getService()
  })

  beforeEach(() => {
    restMock = jest.fn().mockResolvedValue({})
    service.deps.restJsonRequest = restMock
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the AWS config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'authenticationMethod',
        'region',
        'accessKeyId',
        'secretAccessKey',
        'roleArn',
        'externalId',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'authenticationMethod',
            type: 'CHOICE',
            required: true,
            shared: false,
            defaultValue: 'API Key',
            options: ['API Key', 'IAM Role'],
          }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
        ])
      )

      expect(configItems.every(item => item.shared === false)).toBe(true)
    })

    it('applies the region from config and a default region otherwise', () => {
      expect(service.region).toBe(REGION)
      expect(new SES().region).toBe('us-east-1')
      expect(new SES({ region: 'eu-west-1' }).region).toBe('eu-west-1')
    })

    it('builds a credential provider from config', () => {
      const ses = new SES({
        authenticationMethod: 'IAM Role',
        region: 'eu-west-1',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        roleArn: 'arn:aws:iam::1:role/R',
        externalId: 'X',
      })

      expect(ses.credentials).toBeInstanceOf(CredentialProvider)
      expect(ses.credentials.authenticationMethod).toBe('IAM Role')
      expect(ses.credentials.roleArn).toBe('arn:aws:iam::1:role/R')
      expect(ses.credentials.externalId).toBe('X')
      expect(ses.credentials.region).toBe('eu-west-1')
    })
  })

  // ── Transport ──

  describe('sendRest', () => {
    it('resolves credentials and forwards them to the rest client', async () => {
      restMock.mockResolvedValue({ ok: true })

      const result = await service.sendRest('POST', '/path', { A: 1 })

      expect(result).toEqual({ ok: true })
      expect(restMock).toHaveBeenCalledTimes(1)

      expect(restMock).toHaveBeenCalledWith(
        { region: REGION, service: 'ses', method: 'POST', path: '/path', body: { A: 1 } },
        { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }
      )
    })

    it('propagates credential resolution failures', async () => {
      const ses = new SES({ authenticationMethod: 'API Key' })

      await expect(ses.sendRest('GET', '/x')).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )
    })
  })

  // ── sendEmail ──

  describe('sendEmail', () => {
    it('sends a text email with the expected body', async () => {
      restMock.mockResolvedValue({ MessageId: 'msg-1' })

      const result = await service.sendEmail(
        'from@example.com',
        ['to@example.com'],
        null,
        null,
        'Subject line',
        'Text body',
        null,
        null
      )

      expect(result).toEqual({ messageId: 'msg-1' })

      const [opts] = restMock.mock.calls[0]

      expect(opts.method).toBe('POST')
      expect(opts.path).toBe(OUTBOUND_PATH)

      expect(opts.body).toEqual({
        FromEmailAddress: 'from@example.com',
        Destination: { ToAddresses: ['to@example.com'] },
        Content: {
          Simple: {
            Subject: { Data: 'Subject line' },
            Body: { Text: { Data: 'Text body' } },
          },
        },
      })
    })

    it('sends an html-only email', async () => {
      restMock.mockResolvedValue({ MessageId: 'msg-2' })

      await service.sendEmail('f@e.com', ['t@e.com'], null, null, 'S', null, '<h1>Hi</h1>', null)

      const body = restMock.mock.calls[0][0].body

      expect(body.Content.Simple.Body).toEqual({ Html: { Data: '<h1>Hi</h1>' } })
    })

    it('includes both text and html parts when both are provided', async () => {
      await service.sendEmail('f@e.com', ['t@e.com'], null, null, 'S', 'text', '<b>html</b>', null)

      const body = restMock.mock.calls[0][0].body

      expect(body.Content.Simple.Body).toEqual({
        Text: { Data: 'text' },
        Html: { Data: '<b>html</b>' },
      })
    })

    it('includes cc, bcc and reply-to when provided', async () => {
      await service.sendEmail(
        'f@e.com',
        ['t@e.com'],
        ['cc@e.com'],
        ['bcc@e.com'],
        'S',
        'text',
        null,
        ['reply@e.com']
      )

      const body = restMock.mock.calls[0][0].body

      expect(body.Destination).toEqual({
        ToAddresses: ['t@e.com'],
        CcAddresses: ['cc@e.com'],
        BccAddresses: ['bcc@e.com'],
      })

      expect(body.ReplyToAddresses).toEqual(['reply@e.com'])
    })

    it('omits cc, bcc and reply-to when not provided', async () => {
      await service.sendEmail('f@e.com', ['t@e.com'], null, null, 'S', 'text')

      const body = restMock.mock.calls[0][0].body

      expect(body.Destination).toEqual({ ToAddresses: ['t@e.com'] })
      expect(body).not.toHaveProperty('ReplyToAddresses')
    })

    it('validates the required parameters', async () => {
      await expect(service.sendEmail(null, ['t@e.com'], null, null, 'S', 'text'))
        .rejects.toThrow('fromEmailAddress is required.')

      await expect(service.sendEmail('f@e.com', [], null, null, 'S', 'text'))
        .rejects.toThrow('toAddresses must be a non-empty array.')

      await expect(service.sendEmail('f@e.com', 't@e.com', null, null, 'S', 'text'))
        .rejects.toThrow('toAddresses must be a non-empty array.')

      await expect(service.sendEmail('f@e.com', ['t@e.com'], null, null, null, 'text'))
        .rejects.toThrow('subject is required.')

      await expect(service.sendEmail('f@e.com', ['t@e.com'], null, null, 'S', null, null))
        .rejects.toThrow('At least one of textBody or htmlBody is required.')

      expect(restMock).not.toHaveBeenCalled()
    })
  })

  // ── sendTemplatedEmail ──

  describe('sendTemplatedEmail', () => {
    it('serializes the template data', async () => {
      restMock.mockResolvedValue({ MessageId: 'msg-3' })

      const result = await service.sendTemplatedEmail(
        'f@e.com',
        ['t@e.com'],
        null,
        null,
        'WelcomeTemplate',
        { name: 'Alice' },
        null
      )

      expect(result).toEqual({ messageId: 'msg-3' })

      const [opts] = restMock.mock.calls[0]

      expect(opts.path).toBe(OUTBOUND_PATH)

      expect(opts.body.Content).toEqual({
        Template: { TemplateName: 'WelcomeTemplate', TemplateData: '{"name":"Alice"}' },
      })
    })

    it('defaults template data to an empty object', async () => {
      await service.sendTemplatedEmail('f@e.com', ['t@e.com'], null, null, 'T')

      expect(restMock.mock.calls[0][0].body.Content.Template.TemplateData).toBe('{}')
    })

    it('includes cc, bcc and reply-to when provided', async () => {
      await service.sendTemplatedEmail(
        'f@e.com',
        ['t@e.com'],
        ['cc@e.com'],
        ['bcc@e.com'],
        'T',
        null,
        ['r@e.com']
      )

      const body = restMock.mock.calls[0][0].body

      expect(body.Destination.CcAddresses).toEqual(['cc@e.com'])
      expect(body.Destination.BccAddresses).toEqual(['bcc@e.com'])
      expect(body.ReplyToAddresses).toEqual(['r@e.com'])
    })

    it('validates the required parameters', async () => {
      await expect(service.sendTemplatedEmail(null, ['t@e.com'], null, null, 'T'))
        .rejects.toThrow('fromEmailAddress is required.')

      await expect(service.sendTemplatedEmail('f@e.com', null, null, null, 'T'))
        .rejects.toThrow('toAddresses must be a non-empty array.')

      await expect(service.sendTemplatedEmail('f@e.com', ['t@e.com'], null, null, null))
        .rejects.toThrow('templateName is required.')
    })
  })

  // ── sendBulkTemplatedEmail ──

  describe('sendBulkTemplatedEmail', () => {
    it('builds bulk entries and maps the results', async () => {
      restMock.mockResolvedValue({
        BulkEmailEntries: [
          { MessageId: 'b-1', Status: 'SUCCESS', Error: null },
          { MessageId: 'b-2', Status: 'FAILED', Error: 'MessageRejected' },
        ],
      })

      const result = await service.sendBulkTemplatedEmail(
        'f@e.com',
        'T',
        { brand: 'Acme' },
        [
          { toAddresses: ['a@e.com'], replacementData: { name: 'A' } },
          { toAddresses: ['b@e.com'] },
        ]
      )

      expect(result).toEqual({
        results: [
          { messageId: 'b-1', status: 'SUCCESS', error: null },
          { messageId: 'b-2', status: 'FAILED', error: 'MessageRejected' },
        ],
      })

      const [opts] = restMock.mock.calls[0]

      expect(opts.path).toBe(BULK_PATH)
      expect(opts.body.DefaultContent.Template.TemplateData).toBe('{"brand":"Acme"}')

      expect(opts.body.BulkEmailEntries).toEqual([
        {
          Destination: { ToAddresses: ['a@e.com'] },
          ReplacementEmailContent: {
            ReplacementTemplate: { ReplacementTemplateData: '{"name":"A"}' },
          },
        },
        {
          Destination: { ToAddresses: ['b@e.com'] },
          ReplacementEmailContent: {
            ReplacementTemplate: { ReplacementTemplateData: '{}' },
          },
        },
      ])
    })

    it('returns an empty result list when the response has no entries', async () => {
      restMock.mockResolvedValue({})

      const result = await service.sendBulkTemplatedEmail('f@e.com', 'T', null, [{ toAddresses: ['a@e.com'] }])

      expect(result).toEqual({ results: [] })
      expect(restMock.mock.calls[0][0].body.DefaultContent.Template.TemplateData).toBe('{}')
    })

    it('validates the required parameters', async () => {
      await expect(service.sendBulkTemplatedEmail(null, 'T', null, [{ toAddresses: [] }]))
        .rejects.toThrow('fromEmailAddress is required.')

      await expect(service.sendBulkTemplatedEmail('f@e.com', null, null, [{ toAddresses: [] }]))
        .rejects.toThrow('templateName is required.')

      await expect(service.sendBulkTemplatedEmail('f@e.com', 'T', null, []))
        .rejects.toThrow('entries must be a non-empty array.')

      await expect(service.sendBulkTemplatedEmail('f@e.com', 'T', null, null))
        .rejects.toThrow('entries must be a non-empty array.')
    })
  })

  // ── createEmailTemplate ──

  describe('createEmailTemplate', () => {
    it('creates a template with subject only', async () => {
      const result = await service.createEmailTemplate('WelcomeTemplate', 'Hello {{name}}')

      expect(result).toEqual({ templateName: 'WelcomeTemplate' })

      const [opts] = restMock.mock.calls[0]

      expect(opts.method).toBe('POST')
      expect(opts.path).toBe('/v2/email/templates')

      expect(opts.body).toEqual({
        TemplateName: 'WelcomeTemplate',
        TemplateContent: { Subject: 'Hello {{name}}' },
      })
    })

    it('includes text and html parts when provided', async () => {
      await service.createEmailTemplate('T', 'S', 'text part', '<p>html part</p>')

      expect(restMock.mock.calls[0][0].body.TemplateContent).toEqual({
        Subject: 'S',
        Text: 'text part',
        Html: '<p>html part</p>',
      })
    })

    it('validates the required parameters', async () => {
      await expect(service.createEmailTemplate(null, 'S')).rejects.toThrow('templateName is required.')
      await expect(service.createEmailTemplate('T', null)).rejects.toThrow('subject is required.')
    })
  })

  // ── Dictionaries ──

  describe('listTemplatesDictionary', () => {
    it('maps template names into dictionary items', async () => {
      restMock.mockResolvedValue({
        TemplatesMetadata: [{ TemplateName: 'Alpha' }, { TemplateName: 'Beta' }],
      })

      const result = await service.listTemplatesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Alpha', value: 'Alpha' },
          { label: 'Beta', value: 'Beta' },
        ],
        cursor: null,
      })

      const [opts] = restMock.mock.calls[0]

      expect(opts.method).toBe('GET')
      expect(opts.path).toBe('/v2/email/templates?PageSize=100')
      expect(opts.body).toBeUndefined()
    })

    it('filters case-insensitively by search', async () => {
      restMock.mockResolvedValue({
        TemplatesMetadata: [{ TemplateName: 'Alpha' }, { TemplateName: 'Beta' }],
      })

      const result = await service.listTemplatesDictionary({ search: 'ALP' })

      expect(result.items).toEqual([{ label: 'Alpha', value: 'Alpha' }])
    })

    it('appends the encoded cursor and returns the next token', async () => {
      restMock.mockResolvedValue({ TemplatesMetadata: [], NextToken: 'next-2' })

      const result = await service.listTemplatesDictionary({ cursor: 'a b/c' })

      expect(restMock.mock.calls[0][0].path).toBe('/v2/email/templates?PageSize=100&NextToken=a%20b%2Fc')
      expect(result).toEqual({ items: [], cursor: 'next-2' })
    })

    it('handles a null payload and a missing metadata list', async () => {
      restMock.mockResolvedValue({})

      await expect(service.listTemplatesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  describe('listIdentitiesDictionary', () => {
    it('maps identities with their type as a note', async () => {
      restMock.mockResolvedValue({
        EmailIdentities: [
          { IdentityName: 'example.com', IdentityType: 'DOMAIN' },
          { IdentityName: 'user@example.com', IdentityType: 'EMAIL_ADDRESS' },
        ],
      })

      const result = await service.listIdentitiesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'example.com', value: 'example.com', note: 'DOMAIN' },
          { label: 'user@example.com', value: 'user@example.com', note: 'EMAIL_ADDRESS' },
        ],
        cursor: null,
      })

      expect(restMock.mock.calls[0][0].path).toBe('/v2/email/identities?PageSize=100')
    })

    it('filters case-insensitively by search', async () => {
      restMock.mockResolvedValue({
        EmailIdentities: [
          { IdentityName: 'example.com', IdentityType: 'DOMAIN' },
          { IdentityName: 'other.org', IdentityType: 'DOMAIN' },
        ],
      })

      const result = await service.listIdentitiesDictionary({ search: 'OTHER' })

      expect(result.items).toEqual([{ label: 'other.org', value: 'other.org', note: 'DOMAIN' }])
    })

    it('appends the encoded cursor and returns the next token', async () => {
      restMock.mockResolvedValue({ EmailIdentities: [], NextToken: 'tok' })

      const result = await service.listIdentitiesDictionary({ cursor: 'a+b' })

      expect(restMock.mock.calls[0][0].path).toBe('/v2/email/identities?PageSize=100&NextToken=a%2Bb')
      expect(result.cursor).toBe('tok')
    })

    it('handles a null payload and a missing identities list', async () => {
      restMock.mockResolvedValue({})

      await expect(service.listIdentitiesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
    })
  })

  // ── Error mapping ──

  describe('error handling', () => {
    function awsError(name, message) {
      const error = new Error(message)

      error.name = name

      return error
    }

    it.each([
      ['MessageRejected', /^Message rejected: boom\./],
      ['MailFromDomainNotVerifiedException', /^Mail From domain not verified: boom\./],
      ['AccountSuspendedException', /^Account suspended: boom\./],
      ['SendingPausedException', /^Sending paused: boom\./],
      ['NotFoundException', /^Resource not found: boom\./],
      ['TooManyRequestsException', /^Too many requests: boom\./],
      ['ThrottlingException', /^Too many requests: boom\./],
    ])('translates %s into a guidance message', async (name, expected) => {
      restMock.mockRejectedValue(awsError(name, 'boom'))

      await expect(service.sendEmail('f@e.com', ['t@e.com'], null, null, 'S', 'text'))
        .rejects.toThrow(expected)
    })

    it('falls back to the generic AWS error mapper', async () => {
      restMock.mockRejectedValue(awsError('AccessDeniedException', 'nope'))

      await expect(service.createEmailTemplate('T', 'S')).rejects.toThrow(/^Access denied: nope\./)
    })

    it('propagates errors from the dictionary methods', async () => {
      restMock.mockRejectedValue(awsError('NotFoundException', 'missing'))

      await expect(service.listTemplatesDictionary({})).rejects.toThrow(/^Resource not found: missing\./)
      await expect(service.listIdentitiesDictionary({})).rejects.toThrow(/^Resource not found: missing\./)
    })

    it('propagates errors from the bulk and templated senders', async () => {
      restMock.mockRejectedValue(awsError('MessageRejected', 'rejected'))

      await expect(service.sendTemplatedEmail('f@e.com', ['t@e.com'], null, null, 'T'))
        .rejects.toThrow(/^Message rejected: rejected\./)

      await expect(service.sendBulkTemplatedEmail('f@e.com', 'T', null, [{ toAddresses: ['a@e.com'] }]))
        .rejects.toThrow(/^Message rejected: rejected\./)
    })
  })
})

// ── Credential provider ──

describe('CredentialProvider', () => {
  it('returns static credentials for API Key authentication', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API Key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve())
      .rejects.toThrow('Access Key and Secret Key are required for API Key authentication.')

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve())
      .rejects.toThrow('Access Key and Secret Key are required for API Key authentication.')
  })

  it('requires a role arn and keys for IAM Role authentication', async () => {
    await expect(new CredentialProvider({ authenticationMethod: 'IAM Role' }).resolve())
      .rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:x' }).resolve())
      .rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('assumes the role and caches the resulting credentials', async () => {
    const now = 1_000_000
    const stsAssumeRole = jest.fn().mockResolvedValue({
      accessKeyId: 'TEMP-AK',
      secretAccessKey: 'TEMP-SK',
      sessionToken: 'TOKEN',
      expiration: new Date(now + 3_600_000),
    })

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::1:role/R',
        externalId: 'EXT',
      },
      { stsAssumeRole, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'TEMP-AK', secretAccessKey: 'TEMP-SK', sessionToken: 'TOKEN' })

    expect(stsAssumeRole).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:aws:iam::1:role/R',
      `flowrunner-ses-${ now }`,
      'EXT'
    )

    await provider.resolve()

    expect(stsAssumeRole).toHaveBeenCalledTimes(1)
  })

  it('re-assumes the role once the cached credentials near expiry', async () => {
    let currentTime = 1_000_000

    const stsAssumeRole = jest.fn().mockImplementation(async () => ({
      accessKeyId: 'TEMP-AK',
      secretAccessKey: 'TEMP-SK',
      sessionToken: 'TOKEN',
      expiration: new Date(currentTime + 600_000),
    }))

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        roleArn: 'arn:aws:iam::1:role/R',
      },
      { stsAssumeRole, now: () => currentTime }
    )

    await provider.resolve()

    // Move past the 5-minute expiry buffer.
    currentTime += 400_000

    await provider.resolve()

    expect(stsAssumeRole).toHaveBeenCalledTimes(2)
  })
})

// ── AWS client helpers ──

describe('aws-client helpers', () => {
  describe('buildRestJsonRequest', () => {
    it('builds a signed-request descriptor for an object body', () => {
      const built = buildRestJsonRequest({ region: 'us-east-1', service: 'ses', path: '/v2/email', body: { A: 1 } })

      expect(built).toEqual({
        method: 'POST',
        url: 'https://ses.us-east-1.amazonaws.com/v2/email',
        headers: { 'content-type': 'application/json' },
        body: '{"A":1}',
      })
    })

    it('serializes an empty body for reads and passes strings through', () => {
      expect(buildRestJsonRequest({ region: 'r', service: 's', method: 'GET', path: '/p' }).body).toBe('')
      expect(buildRestJsonRequest({ region: 'r', service: 's', body: null }).body).toBe('')
      expect(buildRestJsonRequest({ region: 'r', service: 's', body: '{"raw":1}' }).body).toBe('{"raw":1}')
      expect(buildRestJsonRequest({ region: 'r', service: 's' }).url).toBe('https://s.r.amazonaws.com/')
    })
  })

  describe('buildAwsJsonRequest', () => {
    it('sets the target and content type headers', () => {
      const built = buildAwsJsonRequest({
        region: 'us-east-1',
        service: 'sts',
        target: 'Service.Op',
        body: { A: 1 },
        contentType: 'application/x-amz-json-1.1',
      })

      expect(built).toEqual({
        method: 'POST',
        url: 'https://sts.us-east-1.amazonaws.com/',
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Service.Op' },
        body: '{"A":1}',
      })
    })

    it('omits the target header and defaults the body when absent', () => {
      const built = buildAwsJsonRequest({ region: 'r', service: 's', contentType: 'application/json' })

      expect(built.headers).not.toHaveProperty('x-amz-target')
      expect(built.body).toBe('{}')
    })
  })

  describe('parseJsonResponse', () => {
    it('parses a successful body and tolerates an empty one', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '{"A":1}' })).toEqual({ A: 1 })
      expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
      expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
    })

    it('throws a named error for an error status', () => {
      expect.assertions(3)

      try {
        parseJsonResponse({
          statusCode: 400,
          body: JSON.stringify({ __type: 'com.amazonaws#MessageRejected', message: 'Email rejected' }),
        })
      } catch (error) {
        expect(error.name).toBe('MessageRejected')
        expect(error.message).toBe('Email rejected')
        expect(error.statusCode).toBe(400)
      }
    })

    it('falls back to a generic error name and message', () => {
      expect.assertions(2)

      try {
        parseJsonResponse({ statusCode: 500, body: '{}' })
      } catch (error) {
        expect(error.name).toBe('AwsError')
        expect(error.message).toBe('Request failed with status 500')
      }
    })
  })

  describe('xml parsing', () => {
    it('extracts a single tag and repeated tags', () => {
      const xml = '<Root><Code>Denied</Code><Item>a</Item><Item>b</Item></Root>'

      expect(parseXmlTag(xml, 'Code')).toBe('Denied')
      expect(parseXmlTag(xml, 'Missing')).toBeNull()
      expect(parseXmlTags(xml, 'Item')).toEqual(['a', 'b'])
      expect(parseXmlTags(xml, 'Missing')).toEqual([])
    })
  })

  describe('request senders', () => {
    it('signs and sends a rest json request', async () => {
      const sign = jest.fn()
      const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"MessageId":"m-1"}' })

      const result = await restJsonRequest(
        { region: 'us-east-1', service: 'ses', method: 'POST', path: '/v2/email', body: { A: 1 } },
        { accessKeyId: 'AK', secretAccessKey: 'SK' },
        { signRequest: sign, httpRequest: send }
      )

      expect(result).toEqual({ MessageId: 'm-1' })

      expect(sign).toHaveBeenCalledWith(
        'POST',
        'https://ses.us-east-1.amazonaws.com/v2/email',
        { 'content-type': 'application/json' },
        '{"A":1}',
        { accessKeyId: 'AK', secretAccessKey: 'SK' },
        'us-east-1',
        'ses'
      )

      expect(send).toHaveBeenCalledWith(
        'POST',
        'https://ses.us-east-1.amazonaws.com/v2/email',
        { 'content-type': 'application/json' },
        '{"A":1}'
      )
    })

    it('signs and sends an aws json request', async () => {
      const sign = jest.fn()
      const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"ok":true}' })

      const result = await jsonRequest(
        { region: 'r', service: 's', target: 'T', body: {}, contentType: 'application/json' },
        { accessKeyId: 'AK', secretAccessKey: 'SK' },
        { signRequest: sign, httpRequest: send }
      )

      expect(result).toEqual({ ok: true })
      expect(sign).toHaveBeenCalledTimes(1)
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('throws the parsed AWS error on a failure status', async () => {
      const send = jest.fn().mockResolvedValue({
        statusCode: 404,
        body: JSON.stringify({ __type: 'NotFoundException', message: 'no template' }),
      })

      await expect(
        restJsonRequest(
          { region: 'r', service: 's', path: '/p' },
          { accessKeyId: 'AK', secretAccessKey: 'SK' },
          { signRequest: jest.fn(), httpRequest: send }
        )
      ).rejects.toThrow('no template')
    })
  })
})

// ── SigV4 ──

describe('sigv4 signing', () => {
  const CREDS = { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY }

  beforeEach(() => {
    // The signature is time-derived; freeze the clock so it is fully deterministic.
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'))
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('sets the date, payload hash and authorization headers deterministically', () => {
    const headers = { 'content-type': 'application/json' }

    signRequest('POST', 'https://ses.us-east-1.amazonaws.com/v2/email/outbound-emails', headers, '{"A":1}', CREDS, REGION, 'ses')

    expect(headers['x-amz-date']).toBe('20240101T000000Z')
    expect(headers['host']).toBe('ses.us-east-1.amazonaws.com')

    // sha256 of '{"A":1}'
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)

    expect(headers['authorization']).toContain(
      `AWS4-HMAC-SHA256 Credential=${ ACCESS_KEY }/20240101/${ REGION }/ses/aws4_request`
    )

    expect(headers['authorization']).toContain('SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date')
    expect(headers['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('produces a stable signature for identical inputs', () => {
    const a = {}
    const b = {}

    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/v2/email/templates?PageSize=100', a, '', CREDS, REGION, 'ses')
    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/v2/email/templates?PageSize=100', b, '', CREDS, REGION, 'ses')

    expect(a['authorization']).toBe(b['authorization'])
  })

  it('changes the signature when the request differs', () => {
    const a = {}
    const b = {}

    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/v2/email/templates', a, '', CREDS, REGION, 'ses')
    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/v2/email/identities', b, '', CREDS, REGION, 'ses')

    expect(a['authorization']).not.toBe(b['authorization'])
  })

  it('adds the security token header for temporary credentials', () => {
    const headers = {}

    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/', headers, '', { ...CREDS, sessionToken: 'TOKEN' }, REGION, 'ses')

    expect(headers['x-amz-security-token']).toBe('TOKEN')
    expect(headers['authorization']).toContain('x-amz-security-token')
  })

  it('keeps an explicitly provided host header and includes a non-standard port', () => {
    const explicit = { Host: 'custom.example.com' }

    signRequest('GET', 'https://ses.us-east-1.amazonaws.com/', explicit, '', CREDS, REGION, 'ses')

    expect(explicit).not.toHaveProperty('host')
    expect(explicit.Host).toBe('custom.example.com')

    const ported = {}

    signRequest('GET', 'https://localhost:8443/path', ported, '', CREDS, REGION, 'ses')

    expect(ported['host']).toBe('localhost:8443')
  })

  it('generates a presigned url with the expected query parameters', () => {
    const url = generatePresignedUrl(
      'GET',
      'https://ses.us-east-1.amazonaws.com/v2/email/templates',
      CREDS,
      REGION,
      'ses',
      900
    )

    const parsed = new URL(url)

    expect(parsed.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(parsed.searchParams.get('X-Amz-Credential')).toBe(`${ ACCESS_KEY }/20240101/${ REGION }/ses/aws4_request`)
    expect(parsed.searchParams.get('X-Amz-Date')).toBe('20240101T000000Z')
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(parsed.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('includes the session token in a presigned url', () => {
    const url = generatePresignedUrl(
      'GET',
      'https://ses.us-east-1.amazonaws.com/v2/email/templates',
      { ...CREDS, sessionToken: 'TOKEN' },
      REGION,
      'ses',
      60
    )

    expect(new URL(url).searchParams.get('X-Amz-Security-Token')).toBe('TOKEN')
  })
})

// ── Errors module ──

describe('errors module', () => {
  it('maps throttling, credential, access and connectivity failures', () => {
    const named = (name, message, extra = {}) => Object.assign(new Error(message), { name, ...extra })

    expect(mapAwsError(named('ThrottlingException', 'slow down')).message)
      .toMatch(/^Request was throttled by AWS: slow down\./)

    expect(mapAwsError(named('InvalidSignatureException', 'bad sig')).message)
      .toMatch(/^Invalid AWS credentials: bad sig\./)

    expect(mapAwsError(named('SomethingElse', 'the credential is wrong')).message)
      .toMatch(/^Invalid AWS credentials:/)

    expect(mapAwsError(named('AccessDenied', 'no perms')).message)
      .toMatch(/^Access denied: no perms\./)

    expect(mapAwsError(named('Whatever', 'Request timed out')).message)
      .toMatch(/^Connection to AWS failed:/)

    expect(mapAwsError(named('Whatever', 'socket', { code: 'ENOTFOUND' })).message)
      .toMatch(/^Connection to AWS failed: socket\./)
  })

  it('returns a wrapped error with the original cause by default', () => {
    const original = Object.assign(new Error('weird'), { name: 'Unmapped' })
    const mapped = mapAwsError(original)

    expect(mapped.message).toBe('weird')
    expect(mapped.cause).toBe(original)
  })

  it('handles an error object with no name or message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })

  it('creates a prefixed logger', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})

    spy.mockClear()

    const logger = createLogger('SES')

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy).toHaveBeenCalledTimes(4)
    expect(spy.mock.calls[0][0]).toBe('[SES Service]')

    spy.mockRestore()
  })
})
