'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')

const https = require('https')

const { createSandbox } = require('../../../service-sandbox')

const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
  buildQueryRequest,
  queryRequest,
} = require('../src/aws-client')

const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { awsConfigItems } = require('../src/config-items')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

// Drives the mocked `https.request` with a canned response (or a transport error).
function stubHttps({ statusCode = 200, body = '', error = null } = {}) {
  const captured = { options: null, written: [] }

  https.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)
    req.setTimeout = jest.fn()
    req.destroy = jest.fn()

    req.end = () => {
      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)
        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

describe('SNS Service', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: 'us-west-2',
      accessKeyId: CREDS.accessKeyId,
      secretAccessKey: CREDS.secretAccessKey,
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the AWS config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toBe(awsConfigItems)

      expect(configItems.map(item => item.name)).toEqual([
        'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
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
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false, defaultValue: 'us-east-1' }),
          expect.objectContaining({ name: 'accessKeyId', required: false, shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', required: false, shared: false }),
          expect.objectContaining({ name: 'roleArn', required: false, shared: false }),
          expect.objectContaining({ name: 'externalId', required: false, shared: false }),
        ])
      )

      expect(configItems.every(item => item.shared === false)).toBe(true)
    })

    it('stores the configured region and builds a credential provider', () => {
      expect(service.region).toBe('us-west-2')
      expect(service.credentials).toBeInstanceOf(CredentialProvider)
      expect(service.credentials.accessKeyId).toBe(CREDS.accessKeyId)
      expect(service.credentials.authenticationMethod).toBe('API Key')
    })

    it('defaults the region to us-east-1', () => {
      const { SNS } = require('../src/index.js')
      const bare = new SNS()

      expect(bare.region).toBe('us-east-1')
      expect(bare.credentials.region).toBe('us-east-1')
      expect(bare.credentials.authenticationMethod).toBe('API Key')
    })
  })

  // ── sendQuery ──

  describe('sendQuery', () => {
    it('resolves credentials and forwards the SNS action, version and region', async () => {
      const queryRequestSpy = jest.fn().mockResolvedValue({ statusCode: 200, body: '<ok/>' })

      service.deps.queryRequest = queryRequestSpy

      await service.sendQuery('ListTopics', { NextToken: 'abc' })

      expect(queryRequestSpy).toHaveBeenCalledWith(
        {
          region: 'us-west-2',
          service: 'sns',
          action: 'ListTopics',
          version: '2010-03-31',
          params: { NextToken: 'abc' },
        },
        { accessKeyId: CREDS.accessKeyId, secretAccessKey: CREDS.secretAccessKey }
      )
    })
  })

  // ── Actions ──

  describe('publish', () => {
    let queryRequestSpy

    beforeEach(() => {
      queryRequestSpy = jest.fn().mockResolvedValue({
        statusCode: 200,
        body: '<PublishResponse><PublishResult><MessageId>msg-1</MessageId></PublishResult></PublishResponse>',
      })

      service.deps.queryRequest = queryRequestSpy
    })

    it('publishes to a topic', async () => {
      const result = await service.publish('arn:aws:sns:us-west-2:1:Topic', undefined, 'Hello', 'Subject')

      expect(queryRequestSpy.mock.calls[0][0]).toMatchObject({
        action: 'Publish',
        params: {
          Message: 'Hello',
          TopicArn: 'arn:aws:sns:us-west-2:1:Topic',
          Subject: 'Subject',
        },
      })

      expect(result).toEqual({ messageId: 'msg-1' })
    })

    it('publishes an SMS when a phone number is supplied', async () => {
      await service.publish(undefined, '+15551234567', 'Hello')

      expect(queryRequestSpy.mock.calls[0][0].params).toEqual({
        Message: 'Hello',
        PhoneNumber: '+15551234567',
        Subject: undefined,
      })
    })

    it('prefers the phone number over the topic ARN when both are given', async () => {
      await service.publish('arn:aws:sns:us-west-2:1:Topic', '+15551234567', 'Hello')

      expect(queryRequestSpy.mock.calls[0][0].params).not.toHaveProperty('TopicArn')
      expect(queryRequestSpy.mock.calls[0][0].params.PhoneNumber).toBe('+15551234567')
    })

    it('requires a message', async () => {
      await expect(service.publish('arn', undefined, '')).rejects.toThrow('message is required.')
      expect(queryRequestSpy).not.toHaveBeenCalled()
    })

    it('requires a topic ARN or a phone number', async () => {
      await expect(service.publish(undefined, undefined, 'Hello')).rejects.toThrow(
        'Either topicArn or phoneNumber is required.'
      )

      expect(queryRequestSpy).not.toHaveBeenCalled()
    })

    it('returns a null message id when the response has no MessageId', async () => {
      service.deps.queryRequest = jest.fn().mockResolvedValue({ statusCode: 200, body: '<PublishResponse/>' })

      await expect(service.publish('arn', undefined, 'Hi')).resolves.toEqual({ messageId: null })
    })
  })

  describe('createTopic', () => {
    it('creates a topic and returns the ARN', async () => {
      const spy = jest.fn().mockResolvedValue({
        statusCode: 200,
        body: '<CreateTopicResponse><CreateTopicResult><TopicArn>arn:aws:sns:us-west-2:1:MyTopic</TopicArn></CreateTopicResult></CreateTopicResponse>',
      })

      service.deps.queryRequest = spy

      const result = await service.createTopic('MyTopic')

      expect(spy.mock.calls[0][0]).toMatchObject({ action: 'CreateTopic', params: { Name: 'MyTopic' } })
      expect(result).toEqual({ topicArn: 'arn:aws:sns:us-west-2:1:MyTopic' })
    })

    it('requires a name', async () => {
      await expect(service.createTopic('')).rejects.toThrow('name is required.')
    })
  })

  describe('deleteTopic', () => {
    it('deletes a topic', async () => {
      const spy = jest.fn().mockResolvedValue({ statusCode: 200, body: '<DeleteTopicResponse/>' })

      service.deps.queryRequest = spy

      await expect(service.deleteTopic('arn:aws:sns:us-west-2:1:MyTopic')).resolves.toEqual({ success: true })

      expect(spy.mock.calls[0][0]).toMatchObject({
        action: 'DeleteTopic',
        params: { TopicArn: 'arn:aws:sns:us-west-2:1:MyTopic' },
      })
    })

    it('requires a topic ARN', async () => {
      await expect(service.deleteTopic()).rejects.toThrow('topicArn is required.')
    })
  })

  describe('subscribe', () => {
    it('subscribes an endpoint and returns the subscription ARN', async () => {
      const spy = jest.fn().mockResolvedValue({
        statusCode: 200,
        body: '<SubscribeResponse><SubscribeResult><SubscriptionArn>arn:sub:1</SubscriptionArn></SubscribeResult></SubscribeResponse>',
      })

      service.deps.queryRequest = spy

      const result = await service.subscribe('arn:topic', 'email', 'user@example.com')

      expect(spy.mock.calls[0][0]).toMatchObject({
        action: 'Subscribe',
        params: {
          TopicArn: 'arn:topic',
          Protocol: 'email',
          Endpoint: 'user@example.com',
          ReturnSubscriptionArn: 'true',
        },
      })

      expect(result).toEqual({ subscriptionArn: 'arn:sub:1' })
    })

    it('validates its required parameters', async () => {
      await expect(service.subscribe('', 'email', 'a@b.com')).rejects.toThrow('topicArn is required.')
      await expect(service.subscribe('arn', '', 'a@b.com')).rejects.toThrow('protocol is required.')
      await expect(service.subscribe('arn', 'email', '')).rejects.toThrow('endpoint is required.')
    })
  })

  describe('unsubscribe', () => {
    it('removes a subscription', async () => {
      const spy = jest.fn().mockResolvedValue({ statusCode: 200, body: '<UnsubscribeResponse/>' })

      service.deps.queryRequest = spy

      await expect(service.unsubscribe('arn:sub:1')).resolves.toEqual({ success: true })
      expect(spy.mock.calls[0][0]).toMatchObject({ action: 'Unsubscribe', params: { SubscriptionArn: 'arn:sub:1' } })
    })

    it('requires a subscription ARN', async () => {
      await expect(service.unsubscribe()).rejects.toThrow('subscriptionArn is required.')
    })
  })

  // ── Dictionary ──

  describe('listTopicsDictionary', () => {
    const LIST_BODY =
      '<ListTopicsResponse><ListTopicsResult><Topics>' +
      '<member><TopicArn>arn:aws:sns:us-west-2:1:Alpha</TopicArn></member>' +
      '<member><TopicArn>arn:aws:sns:us-west-2:1:Beta</TopicArn></member>' +
      '</Topics></ListTopicsResult></ListTopicsResponse>'

    it('maps topic ARNs into dictionary items', async () => {
      const spy = jest.fn().mockResolvedValue({ statusCode: 200, body: LIST_BODY })

      service.deps.queryRequest = spy

      const result = await service.listTopicsDictionary({})

      expect(spy.mock.calls[0][0]).toMatchObject({ action: 'ListTopics', params: {} })

      expect(result).toEqual({
        items: [
          { label: 'Alpha', value: 'arn:aws:sns:us-west-2:1:Alpha' },
          { label: 'Beta', value: 'arn:aws:sns:us-west-2:1:Beta' },
        ],
        cursor: null,
      })
    })

    it('filters case-insensitively and handles a null payload', async () => {
      service.deps.queryRequest = jest.fn().mockResolvedValue({ statusCode: 200, body: LIST_BODY })

      const filtered = await service.listTopicsDictionary({ search: 'BET' })

      expect(filtered.items).toEqual([{ label: 'Beta', value: 'arn:aws:sns:us-west-2:1:Beta' }])

      const all = await service.listTopicsDictionary(null)

      expect(all.items).toHaveLength(2)
    })

    it('passes the cursor as NextToken and returns the next token', async () => {
      const spy = jest.fn().mockResolvedValue({
        statusCode: 200,
        body: '<ListTopicsResponse><ListTopicsResult><Topics/><NextToken>tok-2</NextToken></ListTopicsResult></ListTopicsResponse>',
      })

      service.deps.queryRequest = spy

      const result = await service.listTopicsDictionary({ cursor: 'tok-1' })

      expect(spy.mock.calls[0][0].params).toEqual({ NextToken: 'tok-1' })
      expect(result).toEqual({ items: [], cursor: 'tok-2' })
    })
  })

  // ── Error mapping in the service ──

  describe('error handling', () => {
    function rejectWith(name, message) {
      const error = new Error(message)

      error.name = name
      service.deps.queryRequest = jest.fn().mockRejectedValue(error)
    }

    it('explains NotFound errors', async () => {
      rejectWith('NotFound', 'Topic does not exist')

      await expect(service.deleteTopic('arn')).rejects.toThrow(
        'Resource not found: Topic does not exist. Check the topic or subscription ARN.'
      )
    })

    it('explains NotFoundException errors', async () => {
      rejectWith('NotFoundException', 'missing')

      await expect(service.unsubscribe('arn')).rejects.toThrow(/^Resource not found: missing/)
    })

    it('explains authorization errors', async () => {
      rejectWith('AuthorizationError', 'not authorized to perform sns:Publish')

      await expect(service.publish('arn', undefined, 'hi')).rejects.toThrow(
        'Authorization error: not authorized to perform sns:Publish. Verify IAM permissions for this operation.'
      )
    })

    it('explains invalid parameter errors', async () => {
      rejectWith('InvalidParameter', 'Invalid parameter: TopicArn')

      await expect(service.createTopic('x')).rejects.toThrow(/^Invalid parameter: Invalid parameter: TopicArn/)
    })

    it('explains throttling errors', async () => {
      rejectWith('Throttled', 'Rate exceeded')

      await expect(service.listTopicsDictionary({})).rejects.toThrow(
        'Request throttled: Rate exceeded. Retry with backoff.'
      )

      rejectWith('ThrottlingException', 'Slow down')

      await expect(service.listTopicsDictionary({})).rejects.toThrow(/^Request throttled: Slow down/)
    })

    it('falls back to the generic AWS error mapping', async () => {
      rejectWith('AccessDenied', 'User is not authorized')

      await expect(service.subscribe('arn', 'email', 'a@b.com')).rejects.toThrow(
        'Access denied: User is not authorized. Verify the IAM permissions for this operation.'
      )
    })
  })
})

// ── XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
  })

  it('returns null when the tag is absent', () => {
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
  })

  it('extracts all matching tags including multi-line values', () => {
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

// ── Request builders ──

describe('aws-client request builders', () => {
  it('builds a query (form-encoded) request and drops empty params', () => {
    const built = buildQueryRequest({
      region: 'eu-west-1',
      service: 'sns',
      action: 'Publish',
      version: '2010-03-31',
      params: { Message: 'a b&c', Subject: undefined, Empty: '', Nulled: null },
    })

    expect(built).toEqual({
      method: 'POST',
      url: 'https://sns.eu-west-1.amazonaws.com/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'Action=Publish&Version=2010-03-31&Message=a%20b%26c',
    })
  })

  it('defaults query params to an empty object', () => {
    const built = buildQueryRequest({ region: 'us-east-1', service: 'sns', action: 'ListTopics', version: '1' })

    expect(built.body).toBe('Action=ListTopics&Version=1')
  })

  it('builds an AWS JSON request with a target header', () => {
    const built = buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'dynamodb',
      target: 'DynamoDB_20120810.ListTables',
      body: { Limit: 1 },
      contentType: 'application/x-amz-json-1.0',
    })

    expect(built).toEqual({
      method: 'POST',
      url: 'https://dynamodb.us-east-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': 'DynamoDB_20120810.ListTables',
      },
      body: '{"Limit":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({ region: 'us-east-1', service: 'x', body: '{"a":1}', contentType: 'application/json' })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'x', contentType: 'application/json' }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns an empty object for an empty body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error for an error status', () => {
    expect(() => parseJsonResponse({
      statusCode: 400,
      body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}',
    })).toThrow('bad input')

    try {
      parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}' })
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.statusCode).toBe(400)
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
      expect(error.message).toBe('nope')
    }
  })
})

describe('queryRequest / jsonRequest with injected transport', () => {
  it('signs and sends a query request and returns the raw response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '<ok/>', headers: {} })

    const response = await queryRequest(
      { region: 'us-east-1', service: 'sns', action: 'ListTopics', version: '1', params: {} },
      CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://sns.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-www-form-urlencoded' },
      'Action=ListTopics&Version=1',
      CREDS,
      'us-east-1',
      'sns'
    )

    expect(send).toHaveBeenCalledTimes(1)
    expect(response).toEqual({ statusCode: 200, body: '<ok/>', headers: {} })
  })

  it('throws a named error built from the XML error body', async () => {
    const send = jest.fn().mockResolvedValue({
      statusCode: 400,
      body: '<ErrorResponse><Error><Code>InvalidParameter</Code><Message>Invalid parameter: TopicArn</Message></Error></ErrorResponse>',
    })

    const promise = queryRequest(
      { region: 'us-east-1', service: 'sns', action: 'Publish', version: '1' },
      CREDS,
      { signRequest: jest.fn(), httpRequest: send }
    )

    await expect(promise).rejects.toMatchObject({
      name: 'InvalidParameter',
      message: 'Invalid parameter: TopicArn',
      statusCode: 400,
    })
  })

  it('falls back to a generic error when the body has no Code or Message', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 503, body: '' })

    await expect(
      queryRequest({ region: 'us-east-1', service: 'sns', action: 'Publish', version: '1' }, CREDS, {
        signRequest: jest.fn(),
        httpRequest: send,
      })
    ).rejects.toMatchObject({ name: 'AwsError', message: 'Request failed with status 503' })
  })

  it('signs and sends a JSON request and parses the response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"TableNames":[]}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'dynamodb', target: 'X.Y', body: {}, contentType: 'application/x-amz-json-1.0' },
      CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ TableNames: [] })
    expect(sign).toHaveBeenCalledTimes(1)
  })
})

// ── Low level HTTP transport ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '<ok/>' })

    const response = await httpRequest('POST', 'https://sns.us-east-1.amazonaws.com/?a=1', { 'content-type': 'text/plain' }, 'hello')

    expect(captured.options).toMatchObject({
      hostname: 'sns.us-east-1.amazonaws.com',
      port: 443,
      path: '/?a=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '<ok/>' })
  })

  it('omits content-length when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://sns.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://sns.us-east-1.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })
})

describe('stsAssumeRole', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  it('assumes a role and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(CREDS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not provided', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse/>' })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSParseError',
    })
  })
})

// ── Credential provider ──

describe('CredentialProvider', () => {
  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({}).resolve()).rejects.toThrow(/API Key authentication/)
  })

  it('assumes the configured role and caches the result', async () => {
    let now = 1000000
    const stsAssumeRoleSpy = jest.fn().mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    })

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        roleArn: 'arn:role',
        externalId: 'ext',
      },
      { stsAssumeRole: stsAssumeRoleSpy, now: () => now }
    )

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

    expect(stsAssumeRoleSpy).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:role',
      `flowrunner-sns-${ now }`,
      'ext'
    )

    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Move past the expiry buffer — the credentials are refreshed.
    now += 3400000

    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })
})

// ── Error mapping ──

describe('mapAwsError', () => {
  function mapped(name, message, extra = {}) {
    return mapAwsError(Object.assign(new Error(message), { name }, extra))
  }

  it('maps throttling errors', () => {
    expect(mapped('ThrottlingException', 'Rate exceeded').message).toMatch(/throttled by AWS: Rate exceeded/)
    expect(mapped('Throttling', 'x').message).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x').message).toMatch(/throttled by AWS/)
  })

  it('maps credential errors', () => {
    expect(mapped('InvalidSignatureException', 'bad sig').message).toMatch(/Invalid AWS credentials: bad sig/)
    expect(mapped('UnrecognizedClientException', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('InvalidClientTokenId', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('SomethingElse', 'The security credential is invalid').message).toMatch(/Invalid AWS credentials/)
  })

  it('maps access denied errors', () => {
    expect(mapped('AccessDeniedException', 'nope').message).toMatch(/Access denied: nope/)
    expect(mapped('AccessDenied', 'nope').message).toMatch(/Access denied/)
  })

  it('maps connectivity errors', () => {
    expect(mapped('Error', 'Request timed out').message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ECONNREFUSED' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ENOTFOUND' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ETIMEDOUT' }).message).toMatch(/Connection to AWS failed/)
  })

  it('passes unknown errors through with the original as the cause', () => {
    const original = new Error('something odd')
    const result = mapAwsError(original)

    expect(result.message).toBe('something odd')
    expect(result.cause).toBe(original)
  })

  it('handles an error without a name or message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('SNS')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[SNS Service]', 'info:', 'a'],
      ['[SNS Service]', 'debug:', 'b'],
      ['[SNS Service]', 'warn:', 'c'],
      ['[SNS Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

// ── SigV4 ──

describe('sigv4 signRequest', () => {
  const FIXED_ISO = '2024-01-15T12:30:45.123Z'

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || 'https://sns.us-east-1.amazonaws.com/',
      headers,
      overrides.body !== undefined ? overrides.body : 'Action=ListTopics&Version=2010-03-31',
      overrides.credentials || CREDS,
      overrides.region || 'us-east-1',
      overrides.service || 'sns'
    )

    return headers
  }

  it('sets the deterministic SigV4 headers', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe('20240115T123045Z')
    expect(headers['host']).toBe('sns.us-east-1.amazonaws.com')

    expect(headers['x-amz-content-sha256']).toBe(
      crypto.createHash('sha256').update('Action=ListTopics&Version=2010-03-31').digest('hex')
    )

    expect(headers['authorization']).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20240115\/us-east-1\/sns\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/
    )
  })

  it('produces a stable signature for identical input', () => {
    expect(sign()['authorization']).toBe(sign()['authorization'])
  })

  it('changes the signature when the payload, secret, region or service change', () => {
    const baseline = sign()['authorization']

    expect(sign({ body: 'Action=ListTopics&Version=2010-03-32' })['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...CREDS, secretAccessKey: 'OTHER' } })['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })['authorization']).not.toBe(baseline)
    expect(sign({ service: 'sqs' })['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    const headers = sign({ body: '' })

    expect(headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
  })

  it('adds the session token to the signed headers when present', () => {
    const headers = sign({ credentials: { ...CREDS, sessionToken: 'SESSION' } })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )
  })

  it('keeps an existing host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    const ported = sign({ url: 'https://localhost:4566/' })

    expect(ported['host']).toBe('localhost:4566')
  })

  it('canonicalizes query parameters and path segments', () => {
    const headers = sign({
      method: 'GET',
      url: 'https://s3.us-east-1.amazonaws.com/my bucket/a+b?b=2&a=1&a=0',
      body: '',
      service: 's3',
    })

    expect(headers['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date('2024-01-15T12:30:45.123Z'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('adds the SigV4 query parameters and a signature', () => {
    const url = new URL(
      generatePresignedUrl('GET', 'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt', CREDS, 'us-east-1', 's3', 900)
    )

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20240115/us-east-1/s3/aws4_request')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20240115T123045Z')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
  })

  it('includes the session token and reacts to a non-standard port', () => {
    const withToken = new URL(
      generatePresignedUrl('PUT', 'https://localhost:4566/bucket/key', { ...CREDS, sessionToken: 'SESSION' }, 'us-east-1', 's3', 60)
    )

    expect(withToken.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')
    expect(withToken.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a stable signature for identical input', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)

    expect(first).toBe(second)

    const different = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 120)

    expect(different).not.toBe(first)
  })
})
