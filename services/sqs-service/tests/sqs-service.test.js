'use strict'

const { createSandbox } = require('../../../service-sandbox')

// The service signs and sends its own HTTPS requests (AWS SigV4) instead of using
// Flowrunner.Request, so node's `https` module is mocked to keep the transport
// layer deterministic and offline.
let mockHttpsCalls = []
let mockHttpsResponse = { statusCode: 200, body: '{}', headers: {} }
let mockHttpsError = null

jest.mock('https', () => ({
  request(options, callback) {
    const written = []
    const call = { options, written }

    mockHttpsCalls.push(call)

    const req = {
      on(event, handler) {
        if (event === 'error' && mockHttpsError) {
          call.emitError = () => handler(mockHttpsError)
        }

        return req
      },

      setTimeout() {
        return req
      },

      write(chunk) {
        written.push(chunk)

        return true
      },

      end() {
        if (mockHttpsError) {
          call.emitError()

          return
        }

        const res = {
          statusCode: mockHttpsResponse.statusCode,
          headers: mockHttpsResponse.headers || {},

          on(event, handler) {
            if (event === 'data') {
              handler(Buffer.from(mockHttpsResponse.body || ''))
            }

            if (event === 'end') {
              handler()
            }

            return res
          },
        }

        callback(res)
      },

      destroy() {},
    }

    return req
  },
}))

const { signRequest, generatePresignedUrl } = require('../src/sigv4')
const {
  parseXmlTag,
  parseXmlTags,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
  stsAssumeRole,
} = require('../src/aws-client')
const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { awsConfigItems } = require('../src/config-items')

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue'

const BASE_CONFIG = {
  authenticationMethod: 'API Key',
  region: 'us-east-1',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

const CREDENTIALS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

/** A fixed instant so every signature in this suite is reproducible. */
const FIXED_NOW = Date.UTC(2015, 7, 30, 12, 36, 0)

describe('Amazon SQS Service', () => {
  let sandbox
  let service
  let sent

  /** Builds a fresh service instance with the given service configuration. */
  function build(config = BASE_CONFIG) {
    if (sandbox) {
      sandbox.cleanup()
    }

    jest.resetModules()

    sandbox = createSandbox(config)
    require('../src/index.js')

    service = sandbox.getService()
    sent = []

    // The service exposes its transport through `deps`, so the signed request is
    // captured without hitting the network.
    service.deps.jsonRequest = jest.fn(async (opts, credentials) => {
      sent.push({ opts, credentials })

      return sent.response || {}
    })

    return service
  }

  /** Configures what the stubbed transport resolves with for the next call. */
  function replyWith(response) {
    service.deps.jsonRequest = jest.fn(async (opts, credentials) => {
      sent.push({ opts, credentials })

      return response
    })
  }

  /** Configures the stubbed transport to reject with the given error. */
  function failWith(error) {
    service.deps.jsonRequest = jest.fn(async () => {
      throw error
    })
  }

  function lastCall() {
    return sent[sent.length - 1]
  }

  beforeEach(() => {
    mockHttpsCalls = []
    mockHttpsError = null
    mockHttpsResponse = { statusCode: 200, body: '{}', headers: {} }

    build()
  })

  afterEach(() => {
    sandbox.cleanup()
    sandbox = null
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers the AWS credential config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(awsConfigItems)

      expect(items.map(item => item.name)).toEqual([
        'authenticationMethod',
        'region',
        'accessKeyId',
        'secretAccessKey',
        'roleArn',
        'externalId',
      ])

      items.forEach(item => {
        expect(item.shared).toBe(false)
        expect(typeof item.hint).toBe('string')
      })

      const method = items.find(item => item.name === 'authenticationMethod')

      expect(method).toMatchObject({
        type: 'CHOICE',
        required: true,
        defaultValue: 'API Key',
        options: ['API Key', 'IAM Role'],
      })

      expect(items.find(item => item.name === 'region')).toMatchObject({
        required: true,
        defaultValue: 'us-east-1',
      })

      expect(items.filter(item => item.required === false).map(item => item.name)).toEqual([
        'accessKeyId',
        'secretAccessKey',
        'roleArn',
        'externalId',
      ])
    })

    it('defaults the region and the authentication method', () => {
      build({})

      expect(service.region).toBe('us-east-1')
      expect(service.credentials.authenticationMethod).toBe('API Key')
      expect(service.credentials.region).toBe('us-east-1')
    })

    it('passes the configured credentials to the credential provider', () => {
      build({
        ...BASE_CONFIG,
        region: 'eu-west-1',
        authenticationMethod: 'IAM Role',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        externalId: 'ext-1',
      })

      expect(service.region).toBe('eu-west-1')

      expect(service.credentials).toMatchObject({
        authenticationMethod: 'IAM Role',
        region: 'eu-west-1',
        roleArn: 'arn:aws:iam::123456789012:role/MyRole',
        externalId: 'ext-1',
      })
    })
  })

  // ── Transport wiring ──

  describe('sendJson', () => {
    it('targets the regional SQS endpoint with the AWS JSON protocol', async () => {
      await service.sendJson('ListQueues', { MaxResults: 10 })

      expect(lastCall().opts).toEqual({
        region: 'us-east-1',
        service: 'sqs',
        target: 'AmazonSQS.ListQueues',
        contentType: 'application/x-amz-json-1.0',
        body: { MaxResults: 10 },
      })

      expect(lastCall().credentials).toEqual(CREDENTIALS)
    })

    it('uses the configured region', async () => {
      build({ ...BASE_CONFIG, region: 'eu-central-1' })

      await service.sendJson('ListQueues', {})

      expect(lastCall().opts.region).toBe('eu-central-1')
    })

    it('propagates credential resolution failures', async () => {
      build({ authenticationMethod: 'API Key' })

      await expect(service.sendJson('ListQueues', {})).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )
    })
  })

  // ── Operations ──

  describe('sendMessage', () => {
    it('sends the message and maps the response', async () => {
      replyWith({ MessageId: '5fea7756-0ea4-451a-a703-a558b933e274' })

      const result = await service.sendMessage(QUEUE_URL, 'Hello World')

      expect(result).toEqual({
        messageId: '5fea7756-0ea4-451a-a703-a558b933e274',
        sequenceNumber: null,
      })

      expect(lastCall().opts.target).toBe('AmazonSQS.SendMessage')
      expect(lastCall().opts.body).toEqual({ QueueUrl: QUEUE_URL, MessageBody: 'Hello World' })
    })

    it('includes the delay and the FIFO fields when provided', async () => {
      replyWith({ MessageId: 'abc', SequenceNumber: '18849496460467696128' })

      const result = await service.sendMessage(QUEUE_URL, 'FIFO', 30, 'group-1', 'dedup-1')

      expect(result.sequenceNumber).toBe('18849496460467696128')

      expect(lastCall().opts.body).toEqual({
        QueueUrl: QUEUE_URL,
        MessageBody: 'FIFO',
        DelaySeconds: 30,
        MessageGroupId: 'group-1',
        MessageDeduplicationId: 'dedup-1',
      })
    })

    it('keeps an explicit zero delay', async () => {
      replyWith({ MessageId: 'abc' })

      await service.sendMessage(QUEUE_URL, 'now', 0)

      expect(lastCall().opts.body.DelaySeconds).toBe(0)
    })

    it('omits the optional fields when they are null', async () => {
      replyWith({ MessageId: 'abc' })

      await service.sendMessage(QUEUE_URL, 'plain', null, null, null)

      expect(Object.keys(lastCall().opts.body)).toEqual(['QueueUrl', 'MessageBody'])
    })

    it('validates the required arguments', async () => {
      await expect(service.sendMessage('', 'body')).rejects.toThrow('queueUrl is required.')
      await expect(service.sendMessage(QUEUE_URL, '')).rejects.toThrow('messageBody is required.')

      expect(sent).toHaveLength(0)
    })
  })

  describe('sendMessageBatch', () => {
    it('maps the entries and both result lists', async () => {
      replyWith({
        Successful: [{ Id: 'msg1', MessageId: 'aws-1' }],
        Failed: [{ Id: 'msg2', Code: 'InvalidParameterValue', Message: 'too big', SenderFault: true }],
      })

      const result = await service.sendMessageBatch(QUEUE_URL, [
        { id: 'msg1', messageBody: 'one' },
        { id: 'msg2', messageBody: 'two', delaySeconds: 5 },
      ])

      expect(result).toEqual({
        successful: [{ id: 'msg1', messageId: 'aws-1' }],
        failed: [
          { id: 'msg2', code: 'InvalidParameterValue', message: 'too big', senderFault: true },
        ],
      })

      expect(lastCall().opts.target).toBe('AmazonSQS.SendMessageBatch')

      expect(lastCall().opts.body).toEqual({
        QueueUrl: QUEUE_URL,
        Entries: [
          { Id: 'msg1', MessageBody: 'one' },
          { Id: 'msg2', MessageBody: 'two', DelaySeconds: 5 },
        ],
      })
    })

    it('defaults both result lists to empty arrays', async () => {
      replyWith({})

      const result = await service.sendMessageBatch(QUEUE_URL, [{ id: 'a', messageBody: 'b' }])

      expect(result).toEqual({ successful: [], failed: [] })
    })

    it('validates the required arguments', async () => {
      await expect(service.sendMessageBatch('', [{ id: 'a', messageBody: 'b' }])).rejects.toThrow(
        'queueUrl is required.'
      )

      await expect(service.sendMessageBatch(QUEUE_URL, [])).rejects.toThrow(
        'entries must be a non-empty array.'
      )

      await expect(service.sendMessageBatch(QUEUE_URL, null)).rejects.toThrow(
        'entries must be a non-empty array.'
      )

      expect(sent).toHaveLength(0)
    })
  })

  describe('receiveMessage', () => {
    it('always requests all system attributes and maps the messages', async () => {
      replyWith({
        Messages: [
          {
            MessageId: 'm-1',
            ReceiptHandle: 'handle-1',
            Body: 'Hello',
            MD5OfBody: 'e1d3',
            Attributes: { SentTimestamp: '1' },
          },
          { MessageId: 'm-2', ReceiptHandle: 'handle-2', Body: 'Bye', MD5OfBody: 'aaaa' },
        ],
      })

      const result = await service.receiveMessage(QUEUE_URL)

      expect(result.messages).toEqual([
        {
          messageId: 'm-1',
          receiptHandle: 'handle-1',
          body: 'Hello',
          md5OfBody: 'e1d3',
          attributes: { SentTimestamp: '1' },
        },
        {
          messageId: 'm-2',
          receiptHandle: 'handle-2',
          body: 'Bye',
          md5OfBody: 'aaaa',
          attributes: {},
        },
      ])

      expect(lastCall().opts.target).toBe('AmazonSQS.ReceiveMessage')

      expect(lastCall().opts.body).toEqual({
        QueueUrl: QUEUE_URL,
        MessageSystemAttributeNames: ['All'],
      })
    })

    it('passes the polling options through', async () => {
      replyWith({})

      await service.receiveMessage(QUEUE_URL, 10, 0, 0)

      expect(lastCall().opts.body).toEqual({
        QueueUrl: QUEUE_URL,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
        VisibilityTimeout: 0,
        MessageSystemAttributeNames: ['All'],
      })
    })

    it('returns an empty list when the queue is empty', async () => {
      replyWith({})

      await expect(service.receiveMessage(QUEUE_URL)).resolves.toEqual({ messages: [] })
    })

    it('validates the queue URL', async () => {
      await expect(service.receiveMessage('')).rejects.toThrow('queueUrl is required.')

      expect(sent).toHaveLength(0)
    })
  })

  describe('deleteMessage', () => {
    it('deletes by receipt handle', async () => {
      replyWith({})

      const result = await service.deleteMessage(QUEUE_URL, 'handle-1')

      expect(result).toEqual({ success: true })
      expect(lastCall().opts.target).toBe('AmazonSQS.DeleteMessage')
      expect(lastCall().opts.body).toEqual({ QueueUrl: QUEUE_URL, ReceiptHandle: 'handle-1' })
    })

    it('validates the required arguments', async () => {
      await expect(service.deleteMessage('', 'handle')).rejects.toThrow('queueUrl is required.')

      await expect(service.deleteMessage(QUEUE_URL, '')).rejects.toThrow(
        'receiptHandle is required.'
      )

      expect(sent).toHaveLength(0)
    })
  })

  describe('getQueueAttributes', () => {
    it('requests all attributes by default', async () => {
      replyWith({ Attributes: { ApproximateNumberOfMessages: '5' } })

      const result = await service.getQueueAttributes(QUEUE_URL)

      expect(result).toEqual({ attributes: { ApproximateNumberOfMessages: '5' } })
      expect(lastCall().opts.body).toEqual({ QueueUrl: QUEUE_URL, AttributeNames: ['All'] })
    })

    it('honours an explicit attribute list', async () => {
      replyWith({})

      const result = await service.getQueueAttributes(QUEUE_URL, ['QueueArn', 'VisibilityTimeout'])

      expect(result).toEqual({ attributes: {} })
      expect(lastCall().opts.body.AttributeNames).toEqual(['QueueArn', 'VisibilityTimeout'])
    })

    it('falls back to all attributes for an empty or non-array list', async () => {
      replyWith({})

      await service.getQueueAttributes(QUEUE_URL, [])
      expect(lastCall().opts.body.AttributeNames).toEqual(['All'])

      await service.getQueueAttributes(QUEUE_URL, 'QueueArn')
      expect(lastCall().opts.body.AttributeNames).toEqual(['All'])
    })

    it('validates the queue URL', async () => {
      await expect(service.getQueueAttributes('')).rejects.toThrow('queueUrl is required.')
    })
  })

  // ── Dictionary ──

  describe('listQueuesDictionary', () => {
    it('maps queue URLs onto label/value pairs', async () => {
      replyWith({
        QueueUrls: [
          'https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue',
          'https://sqs.us-east-1.amazonaws.com/123456789012/Other.fifo',
        ],
      })

      const result = await service.listQueuesDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'MyQueue', value: 'https://sqs.us-east-1.amazonaws.com/123456789012/MyQueue' },
          { label: 'Other.fifo', value: 'https://sqs.us-east-1.amazonaws.com/123456789012/Other.fifo' },
        ],
        cursor: null,
      })

      expect(lastCall().opts.target).toBe('AmazonSQS.ListQueues')
      expect(lastCall().opts.body).toEqual({ MaxResults: 100 })
    })

    it('handles a null payload', async () => {
      replyWith({})

      await expect(service.listQueuesDictionary(null)).resolves.toEqual({ items: [], cursor: null })
      expect(lastCall().opts.body).toEqual({ MaxResults: 100 })
    })

    it('passes the search prefix and the pagination cursor', async () => {
      replyWith({ QueueUrls: [], NextToken: 'next-page' })

      const result = await service.listQueuesDictionary({ search: 'My', cursor: 'page-1' })

      expect(result.cursor).toBe('next-page')

      expect(lastCall().opts.body).toEqual({
        MaxResults: 100,
        QueueNamePrefix: 'My',
        NextToken: 'page-1',
      })
    })
  })

  // ── Error mapping ──

  describe('error handling', () => {
    const cases = [
      ['QueueDoesNotExist', /^Queue not found: gone\./],
      ['AWS.SimpleQueueService.NonExistentQueue', /^Queue not found: gone\./],
      ['ReceiptHandleIsInvalid', /^Invalid receipt handle: gone\./],
      ['OverLimit', /^Request over limit: gone\./],
      ['AWS.SimpleQueueService.OverLimit', /^Request over limit: gone\./],
      ['AWS.SimpleQueueService.QueueDeletedRecently', /^Queue was recently deleted: gone\./],
    ]

    it.each(cases)('translates the %s error into guidance', async (name, expected) => {
      failWith(Object.assign(new Error('gone'), { name }))

      await expect(service.receiveMessage(QUEUE_URL)).rejects.toThrow(expected)
    })

    it('falls back to the generic AWS error mapping', async () => {
      failWith(Object.assign(new Error('rate exceeded'), { name: 'ThrottlingException' }))

      await expect(service.sendMessage(QUEUE_URL, 'x')).rejects.toThrow(
        /^Request was throttled by AWS: rate exceeded\./
      )
    })

    it('surfaces unknown errors unchanged', async () => {
      failWith(new Error('something odd'))

      await expect(service.getQueueAttributes(QUEUE_URL)).rejects.toThrow('something odd')
    })

    it('maps errors raised from every operation', async () => {
      failWith(Object.assign(new Error('gone'), { name: 'QueueDoesNotExist' }))

      await expect(service.sendMessage(QUEUE_URL, 'x')).rejects.toThrow(/Queue not found/)

      await expect(
        service.sendMessageBatch(QUEUE_URL, [{ id: 'a', messageBody: 'b' }])
      ).rejects.toThrow(/Queue not found/)

      await expect(service.deleteMessage(QUEUE_URL, 'h')).rejects.toThrow(/Queue not found/)
      await expect(service.getQueueAttributes(QUEUE_URL)).rejects.toThrow(/Queue not found/)
      await expect(service.listQueuesDictionary({})).rejects.toThrow(/Queue not found/)
    })
  })

  // ── errors.js ──

  describe('mapAwsError', () => {
    it.each([
      ['ThrottlingException', 'slow down', /^Request was throttled by AWS/],
      ['Throttling', 'slow down', /^Request was throttled by AWS/],
      ['ProvisionedThroughputExceededException', 'slow down', /^Request was throttled by AWS/],
      ['InvalidSignatureException', 'bad sig', /^Invalid AWS credentials/],
      ['UnrecognizedClientException', 'bad sig', /^Invalid AWS credentials/],
      ['InvalidClientTokenId', 'bad sig', /^Invalid AWS credentials/],
      ['SomethingElse', 'the credential is wrong', /^Invalid AWS credentials/],
      ['AccessDeniedException', 'nope', /^Access denied/],
      ['AccessDenied', 'nope', /^Access denied/],
      ['Whatever', 'Request timed out', /^Connection to AWS failed/],
    ])('maps %s to a helpful message', (name, message, expected) => {
      expect(mapAwsError(Object.assign(new Error(message), { name })).message).toMatch(expected)
    })

    it.each(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'])('maps the %s socket code', code => {
      expect(mapAwsError(Object.assign(new Error('socket'), { code })).message).toMatch(
        /^Connection to AWS failed/
      )
    })

    it('passes unknown errors through with the original as cause', () => {
      const original = new Error('mystery')
      const mapped = mapAwsError(original)

      expect(mapped.message).toBe('mystery')
      expect(mapped.cause).toBe(original)
    })

    it('defaults an empty error to "Unknown error"', () => {
      expect(mapAwsError({}).message).toBe('Unknown error')
    })
  })

  describe('createLogger', () => {
    it('prefixes every level with the service name', () => {
      const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
      const logger = createLogger('SQS')

      spy.mockClear()

      logger.info('a')
      logger.debug('b')
      logger.warn('c')
      logger.error('d')

      expect(spy.mock.calls).toEqual([
        ['[SQS Service]', 'info:', 'a'],
        ['[SQS Service]', 'debug:', 'b'],
        ['[SQS Service]', 'warn:', 'c'],
        ['[SQS Service]', 'error:', 'd'],
      ])

      spy.mockRestore()
    })
  })

  // ── credentials.js ──

  describe('CredentialProvider', () => {
    it('returns the static keys for API Key authentication', async () => {
      const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

      await expect(provider.resolve()).resolves.toEqual({
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
      })
    })

    it('requires both keys for API Key authentication', async () => {
      await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )

      await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )
    })

    it('requires a role ARN and base keys for IAM Role authentication', async () => {
      await expect(
        new CredentialProvider({ authenticationMethod: 'IAM Role' }).resolve()
      ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

      await expect(
        new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
      ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
    })

    it('assumes the role, caches the result and refreshes when it nears expiry', async () => {
      let now = 1000000
      let call = 0

      const stsAssumeRoleMock = jest.fn(async () => {
        call += 1

        return {
          accessKeyId: `AK${ call }`,
          secretAccessKey: `SK${ call }`,
          sessionToken: `ST${ call }`,
          expiration: new Date(now + 3600000),
        }
      })

      const provider = new CredentialProvider(
        {
          authenticationMethod: 'IAM Role',
          accessKeyId: 'BASE_AK',
          secretAccessKey: 'BASE_SK',
          region: 'eu-west-1',
          roleArn: 'arn:aws:iam::123456789012:role/MyRole',
          externalId: 'ext-1',
        },
        { stsAssumeRole: stsAssumeRoleMock, now: () => now }
      )

      const first = await provider.resolve()

      expect(first).toEqual({ accessKeyId: 'AK1', secretAccessKey: 'SK1', sessionToken: 'ST1' })

      expect(stsAssumeRoleMock).toHaveBeenCalledWith(
        { accessKeyId: 'BASE_AK', secretAccessKey: 'BASE_SK' },
        'eu-west-1',
        'arn:aws:iam::123456789012:role/MyRole',
        'flowrunner-sqs-1000000',
        'ext-1'
      )

      // Well inside the validity window: served from cache.
      now += 60000
      await expect(provider.resolve()).resolves.toBe(first)
      expect(stsAssumeRoleMock).toHaveBeenCalledTimes(1)

      // Inside the 5 minute expiry buffer: a fresh session is requested.
      now += 3400000
      const second = await provider.resolve()

      expect(second.accessKeyId).toBe('AK2')
      expect(stsAssumeRoleMock).toHaveBeenCalledTimes(2)
    })
  })

  // ── aws-client.js ──

  describe('buildAwsJsonRequest', () => {
    it('builds a signed-ready POST for the regional endpoint', () => {
      const built = buildAwsJsonRequest({
        region: 'eu-west-1',
        service: 'sqs',
        target: 'AmazonSQS.ListQueues',
        contentType: 'application/x-amz-json-1.0',
        body: { MaxResults: 1 },
      })

      expect(built).toEqual({
        method: 'POST',
        url: 'https://sqs.eu-west-1.amazonaws.com/',
        headers: {
          'content-type': 'application/x-amz-json-1.0',
          'x-amz-target': 'AmazonSQS.ListQueues',
        },
        body: '{"MaxResults":1}',
      })
    })

    it('keeps a pre-serialized body and omits the target when absent', () => {
      const built = buildAwsJsonRequest({
        region: 'us-east-1',
        service: 'sqs',
        contentType: 'application/json',
        body: '{"raw":true}',
      })

      expect(built.body).toBe('{"raw":true}')
      expect(built.headers).toEqual({ 'content-type': 'application/json' })
    })

    it('serializes a missing body as an empty object', () => {
      expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'sqs' }).body).toBe('{}')
    })
  })

  describe('parseJsonResponse', () => {
    it('parses a successful body', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
    })

    it('treats an empty body as an empty object', () => {
      expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
      expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
    })

    it('throws a named error for an AWS __type error body', () => {
      expect(() =>
        parseJsonResponse({
          statusCode: 400,
          body: '{"__type":"com.amazonaws.sqs#QueueDoesNotExist","message":"no queue"}',
        })
      ).toThrow('no queue')

      try {
        parseJsonResponse({
          statusCode: 400,
          body: '{"__type":"com.amazonaws.sqs#QueueDoesNotExist","message":"no queue"}',
        })
      } catch (error) {
        expect(error.name).toBe('QueueDoesNotExist')
        expect(error.statusCode).toBe(400)
      }
    })

    it('falls back to code, Message and a generic message', () => {
      try {
        parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
      } catch (error) {
        expect(error.name).toBe('AccessDenied')
        expect(error.message).toBe('nope')
      }

      try {
        parseJsonResponse({ statusCode: 500, body: '{}' })
      } catch (error) {
        expect(error.name).toBe('AwsError')
        expect(error.message).toBe('Request failed with status 500')
      }
    })
  })

  describe('jsonRequest', () => {
    it('signs and sends the built request through the injected transport', async () => {
      const signed = []
      const httpRequestMock = jest.fn(async (method, url, headers, body) => {
        signed.push({ method, url, headers, body })

        return { statusCode: 200, body: '{"QueueUrls":[]}' }
      })

      const signRequestMock = jest.fn((method, url, headers) => {
        headers.authorization = 'AWS4-HMAC-SHA256 signed'
      })

      const result = await jsonRequest(
        {
          region: 'us-east-1',
          service: 'sqs',
          target: 'AmazonSQS.ListQueues',
          contentType: 'application/x-amz-json-1.0',
          body: { MaxResults: 1 },
        },
        CREDENTIALS,
        { signRequest: signRequestMock, httpRequest: httpRequestMock }
      )

      expect(result).toEqual({ QueueUrls: [] })

      expect(signRequestMock).toHaveBeenCalledWith(
        'POST',
        'https://sqs.us-east-1.amazonaws.com/',
        expect.any(Object),
        '{"MaxResults":1}',
        CREDENTIALS,
        'us-east-1',
        'sqs'
      )

      expect(signed[0].headers).toMatchObject({
        'authorization': 'AWS4-HMAC-SHA256 signed',
        'x-amz-target': 'AmazonSQS.ListQueues',
      })
    })

    it('throws the parsed AWS error for a failed response', async () => {
      await expect(
        jsonRequest({ region: 'us-east-1', service: 'sqs', contentType: 'application/x-amz-json-1.0' }, CREDENTIALS, {
          signRequest: () => {},
          httpRequest: async () => ({ statusCode: 400, body: '{"__type":"x#OverLimit","message":"too many"}' }),
        })
      ).rejects.toThrow('too many')
    })
  })

  describe('XML helpers', () => {
    it('extracts single and repeated tags', () => {
      const xml = '<Root><Code>Denied</Code><Item>a</Item><Item>b</Item></Root>'

      expect(parseXmlTag(xml, 'Code')).toBe('Denied')
      expect(parseXmlTag(xml, 'Missing')).toBeNull()
      expect(parseXmlTags(xml, 'Item')).toEqual(['a', 'b'])
      expect(parseXmlTags(xml, 'Missing')).toEqual([])
    })
  })

  describe('stsAssumeRole', () => {
    const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

    it('signs the STS call and returns the temporary credentials', async () => {
      mockHttpsResponse = {
        statusCode: 200,
        body: `<AssumeRoleResponse><Credentials>
                 <AccessKeyId>ASIA1</AccessKeyId>
                 <SecretAccessKey>SECRET1</SecretAccessKey>
                 <SessionToken>TOKEN1</SessionToken>
                 <Expiration>2026-01-01T00:00:00Z</Expiration>
               </Credentials></AssumeRoleResponse>`,
      }

      const result = await stsAssumeRole(CREDENTIALS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

      expect(result).toEqual({
        accessKeyId: 'ASIA1',
        secretAccessKey: 'SECRET1',
        sessionToken: 'TOKEN1',
        expiration: new Date('2026-01-01T00:00:00Z'),
      })

      expect(mockHttpsCalls).toHaveLength(1)

      const call = mockHttpsCalls[0]

      expect(call.options).toMatchObject({
        hostname: 'sts.eu-west-1.amazonaws.com',
        port: 443,
        path: '/',
        method: 'POST',
      })

      expect(call.options.headers['content-type']).toBe('application/x-www-form-urlencoded')
      expect(call.options.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
      expect(call.options.headers['content-length']).toBeGreaterThan(0)

      expect(call.written.join('')).toBe(
        'Action=AssumeRole&Version=2011-06-15' +
          `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
          '&RoleSessionName=session-1' +
          '&ExternalId=ext-1'
      )
    })

    it('omits the external id when not provided', async () => {
      mockHttpsResponse = {
        statusCode: 200,
        body: '<r><AccessKeyId>A</AccessKeyId><SecretAccessKey>S</SecretAccessKey>' +
          '<SessionToken>T</SessionToken><Expiration>2026-01-01T00:00:00Z</Expiration></r>',
      }

      await stsAssumeRole(CREDENTIALS, 'us-east-1', ROLE_ARN, 'session-2')

      expect(mockHttpsCalls[0].written.join('')).not.toContain('ExternalId')
    })

    it('throws a named error for an STS error response', async () => {
      mockHttpsResponse = {
        statusCode: 403,
        body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>not allowed</Message></Error></ErrorResponse>',
      }

      await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow(
        'not allowed'
      )
    })

    it('throws when the response is missing credential fields', async () => {
      mockHttpsResponse = { statusCode: 200, body: '<r><AccessKeyId>A</AccessKeyId></r>' }

      await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow(
        /missing credential fields/
      )
    })

    it('rejects when the socket errors', async () => {
      mockHttpsError = new Error('socket hang up')

      await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow(
        'socket hang up'
      )
    })
  })

  // ── sigv4.js ──

  describe('signRequest', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: FIXED_NOW })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('produces a stable, fully specified authorization header', () => {
      const headers = { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'AmazonSQS.ListQueues' }

      signRequest('POST', 'https://sqs.us-east-1.amazonaws.com/', headers, '{}', CREDENTIALS, 'us-east-1', 'sqs')

      expect(headers['x-amz-date']).toBe('20150830T123600Z')
      expect(headers.host).toBe('sqs.us-east-1.amazonaws.com')

      // SHA256 of "{}"
      expect(headers['x-amz-content-sha256']).toBe(
        '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
      )

      expect(headers.authorization).toBe(
        'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/sqs/aws4_request, ' +
          'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target, ' +
          'Signature=f0dafb61e93812dad91eee6e1cd06055075e45e9e26f425e104f33460b8830f5'
      )
    })

    it('is deterministic for a fixed clock and sensitive to the payload and key', () => {
      function sign(body, credentials) {
        const headers = { 'content-type': 'application/x-amz-json-1.0' }

        signRequest('POST', 'https://sqs.us-east-1.amazonaws.com/', headers, body, credentials, 'us-east-1', 'sqs')

        return headers.authorization
      }

      expect(sign('{}', CREDENTIALS)).toBe(sign('{}', CREDENTIALS))
      expect(sign('{"a":1}', CREDENTIALS)).not.toBe(sign('{}', CREDENTIALS))
      expect(sign('{}', { ...CREDENTIALS, secretAccessKey: 'other' })).not.toBe(sign('{}', CREDENTIALS))
    })

    it('adds the security token header for temporary credentials', () => {
      const headers = {}

      signRequest(
        'POST',
        'https://sqs.us-east-1.amazonaws.com/',
        headers,
        '',
        { ...CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        'sqs'
      )

      expect(headers['x-amz-security-token']).toBe('SESSION')
      expect(headers.authorization).toContain('x-amz-security-token')
    })

    it('keeps an explicitly provided host header and includes the port for non-standard ports', () => {
      const provided = { Host: 'custom.example.com' }

      signRequest('POST', 'https://sqs.us-east-1.amazonaws.com/', provided, '', CREDENTIALS, 'us-east-1', 'sqs')

      expect(provided.host).toBeUndefined()
      expect(provided.Host).toBe('custom.example.com')

      const ported = {}

      signRequest('POST', 'https://localhost:4566/', ported, '', CREDENTIALS, 'us-east-1', 'sqs')

      expect(ported.host).toBe('localhost:4566')
    })

    it('canonicalizes the path and sorts the query string', () => {
      const a = {}
      const b = {}

      signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?b=2&a=1', a, '', CREDENTIALS, 'us-east-1', 's3')
      signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?a=1&b=2', b, '', CREDENTIALS, 'us-east-1', 's3')

      // Query ordering must not change the signature.
      expect(a.authorization).toBe(b.authorization)
    })
  })

  describe('generatePresignedUrl', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: FIXED_NOW })
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('adds every SigV4 query parameter', () => {
      const url = new URL(
        generatePresignedUrl('GET', 'https://s3.amazonaws.com/bucket/key.txt', CREDENTIALS, 'us-east-1', 's3', 900)
      )

      expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')

      expect(url.searchParams.get('X-Amz-Credential')).toBe(
        'AKIDEXAMPLE/20150830/us-east-1/s3/aws4_request'
      )

      expect(url.searchParams.get('X-Amz-Date')).toBe('20150830T123600Z')
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
      expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
    })

    it('includes the session token and reacts to the expiry window', () => {
      const withToken = generatePresignedUrl(
        'GET',
        'https://s3.amazonaws.com/bucket/key.txt',
        { ...CREDENTIALS, sessionToken: 'SESSION' },
        'us-east-1',
        's3',
        900
      )

      expect(new URL(withToken).searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

      const short = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 60)
      const long = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 3600)

      expect(new URL(short).searchParams.get('X-Amz-Signature')).not.toBe(
        new URL(long).searchParams.get('X-Amz-Signature')
      )
    })
  })
})
