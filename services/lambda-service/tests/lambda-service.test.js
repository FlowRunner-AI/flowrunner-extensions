'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY_ID = 'test-access-key-id'
const SECRET_ACCESS_KEY = 'test-secret-access-key'
const REGION = 'us-west-2'

describe('AWS Lambda Service', () => {
  let sandbox
  let service
  let restJsonRequestMock
  let restRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()

    // The service uses its own HTTP client (Node https + SigV4), not Flowrunner.Request.
    // We mock deps.restJsonRequest and deps.restRequest which sendRest() and invokeRaw() delegate to.
    restJsonRequestMock = jest.fn()
    restRequestMock = jest.fn()
    service.deps.restJsonRequest = restJsonRequestMock
    service.deps.restRequest = restRequestMock
  })

  afterEach(() => {
    restJsonRequestMock.mockReset()
    restRequestMock.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessKeyId', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'secretAccessKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'roleArn', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'externalId', required: false, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('has exactly 6 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(6)
    })
  })

  // ── Invoke Function ──

  describe('invoke', () => {
    it('sends correct request with defaults (RequestResponse)', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ result: 'ok' }),
      })

      const result = await service.invoke('myFunction', { key: 'value' })

      expect(result).toEqual({
        statusCode: 200,
        functionError: null,
        payload: { result: 'ok' },
      })

      expect(restRequestMock).toHaveBeenCalledTimes(1)
      const [opts, creds] = restRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'lambda',
        method: 'POST',
        path: '/2015-03-31/functions/myFunction/invocations',
        body: { key: 'value' },
        headers: { 'x-amz-invocation-type': 'RequestResponse' },
      })

      expect(creds).toEqual({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY })
    })

    it('uses custom invocation type when provided', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 202,
        headers: {},
        body: '',
      })

      const result = await service.invoke('myFunction', null, 'Event')

      expect(result).toEqual({
        statusCode: 202,
        functionError: null,
        payload: null,
      })

      const [opts] = restRequestMock.mock.calls[0]

      expect(opts.headers['x-amz-invocation-type']).toBe('Event')
    })

    it('uses DryRun invocation type', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 204,
        headers: {},
        body: '',
      })

      await service.invoke('myFunction', null, 'DryRun')

      const [opts] = restRequestMock.mock.calls[0]

      expect(opts.headers['x-amz-invocation-type']).toBe('DryRun')
    })

    it('encodes function name in URL', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ ok: true }),
      })

      await service.invoke('my-namespace:myFunction')

      const [opts] = restRequestMock.mock.calls[0]

      expect(opts.path).toBe('/2015-03-31/functions/my-namespace%3AmyFunction/invocations')
    })

    it('returns functionError header when present', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: { 'x-amz-function-error': 'Unhandled' },
        body: JSON.stringify({ errorMessage: 'Something broke' }),
      })

      const result = await service.invoke('myFunction')

      expect(result).toEqual({
        statusCode: 200,
        functionError: 'Unhandled',
        payload: { errorMessage: 'Something broke' },
      })
    })

    it('returns body as string when JSON parsing fails', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: 'plain text response',
      })

      const result = await service.invoke('myFunction')

      expect(result).toEqual({
        statusCode: 200,
        functionError: null,
        payload: 'plain text response',
      })
    })

    it('returns null payload when body is empty', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 202,
        headers: {},
        body: '',
      })

      const result = await service.invoke('myFunction', null, 'Event')

      expect(result.payload).toBeNull()
    })

    it('returns null payload when body is null/undefined', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: null,
      })

      const result = await service.invoke('myFunction')

      expect(result.payload).toBeNull()
    })

    it('throws when functionName is not provided', async () => {
      await expect(service.invoke()).rejects.toThrow('functionName is required')
    })

    it('throws when functionName is empty string', async () => {
      await expect(service.invoke('')).rejects.toThrow('functionName is required')
    })

    it('calls parseJsonResponse for status >= 300 (error handling)', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 404,
        headers: {},
        body: JSON.stringify({ __type: 'ResourceNotFoundException', message: 'Function not found' }),
      })

      await expect(service.invoke('nonexistent')).rejects.toThrow()
    })

    it('passes payload as undefined when not provided', async () => {
      restRequestMock.mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: JSON.stringify({ result: 'ok' }),
      })

      await service.invoke('myFunction')

      const [opts] = restRequestMock.mock.calls[0]

      expect(opts.body).toBeUndefined()
    })
  })

  // ── Get Function ──

  describe('getFunction', () => {
    it('sends correct request and returns shaped response', async () => {
      restJsonRequestMock.mockResolvedValue({
        Configuration: {
          FunctionName: 'myFn',
          Runtime: 'nodejs20.x',
          Handler: 'index.handler',
          Description: 'My function',
          Timeout: 30,
          MemorySize: 128,
          CodeSize: 2048,
          LastModified: '2026-01-01T00:00:00.000+0000',
          State: 'Active',
          Version: '$LATEST',
          Role: 'arn:aws:iam::123456789012:role/my-role',
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:myFn',
        },
      })

      const result = await service.getFunction('myFn')

      expect(result).toEqual({
        functionName: 'myFn',
        runtime: 'nodejs20.x',
        handler: 'index.handler',
        description: 'My function',
        timeout: 30,
        memorySize: 128,
        codeSize: 2048,
        lastModified: '2026-01-01T00:00:00.000+0000',
        state: 'Active',
        version: '$LATEST',
        role: 'arn:aws:iam::123456789012:role/my-role',
        arn: 'arn:aws:lambda:us-east-1:123456789012:function:myFn',
      })

      expect(restJsonRequestMock).toHaveBeenCalledTimes(1)
      const [opts, creds] = restJsonRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'lambda',
        method: 'GET',
        path: '/2015-03-31/functions/myFn',
      })

      expect(creds).toEqual({ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY })
    })

    it('encodes function name in URL', async () => {
      restJsonRequestMock.mockResolvedValue({ Configuration: {} })

      await service.getFunction('arn:aws:lambda:us-east-1:123:function:myFn')

      const [opts] = restJsonRequestMock.mock.calls[0]

      expect(opts.path).toBe('/2015-03-31/functions/arn%3Aaws%3Alambda%3Aus-east-1%3A123%3Afunction%3AmyFn')
    })

    it('returns undefined fields when Configuration is empty', async () => {
      restJsonRequestMock.mockResolvedValue({ Configuration: {} })

      const result = await service.getFunction('myFn')

      expect(result).toEqual({
        functionName: undefined,
        runtime: undefined,
        handler: undefined,
        description: undefined,
        timeout: undefined,
        memorySize: undefined,
        codeSize: undefined,
        lastModified: undefined,
        state: undefined,
        version: undefined,
        role: undefined,
        arn: undefined,
      })
    })

    it('throws when functionName is not provided', async () => {
      await expect(service.getFunction()).rejects.toThrow('functionName is required')
    })

    it('throws when functionName is empty string', async () => {
      await expect(service.getFunction('')).rejects.toThrow('functionName is required')
    })

    it('handles ResourceNotFoundException', async () => {
      const err = new Error('Function not found: myFn')

      err.name = 'ResourceNotFoundException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Resource not found')
    })

    it('handles InvalidParameterValueException', async () => {
      const err = new Error('Bad param')

      err.name = 'InvalidParameterValueException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Invalid parameter')
    })

    it('handles TooManyRequestsException', async () => {
      const err = new Error('Rate exceeded')

      err.name = 'TooManyRequestsException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Too many requests')
    })

    it('handles ThrottlingException', async () => {
      const err = new Error('Rate exceeded')

      err.name = 'ThrottlingException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Too many requests')
    })

    it('handles ServiceException', async () => {
      const err = new Error('Internal error')

      err.name = 'ServiceException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Service error')
    })

    it('handles AccessDeniedException', async () => {
      const err = new Error('Not authorized')

      err.name = 'AccessDeniedException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Access denied')
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('Something went wrong')

      err.name = 'UnknownError'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.getFunction('myFn')).rejects.toThrow('Something went wrong')
    })
  })

  // ── List Functions Dictionary ──

  describe('listFunctionsDictionary', () => {
    it('sends correct request and returns shaped response', async () => {
      restJsonRequestMock.mockResolvedValue({
        Functions: [
          { FunctionName: 'fn1', Runtime: 'nodejs20.x' },
          { FunctionName: 'fn2', Runtime: 'python3.12' },
        ],
        NextMarker: null,
      })

      const result = await service.listFunctionsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'fn1', value: 'fn1', note: 'nodejs20.x' },
          { label: 'fn2', value: 'fn2', note: 'python3.12' },
        ],
        cursor: null,
      })

      expect(restJsonRequestMock).toHaveBeenCalledTimes(1)
      const [opts] = restJsonRequestMock.mock.calls[0]

      expect(opts).toMatchObject({
        region: REGION,
        service: 'lambda',
        method: 'GET',
        path: '/2015-03-31/functions?MaxItems=50',
      })
    })

    it('passes cursor as Marker query param', async () => {
      restJsonRequestMock.mockResolvedValue({ Functions: [], NextMarker: null })

      await service.listFunctionsDictionary({ cursor: 'abc123' })

      const [opts] = restJsonRequestMock.mock.calls[0]

      expect(opts.path).toBe('/2015-03-31/functions?MaxItems=50&Marker=abc123')
    })

    it('encodes cursor value in URL', async () => {
      restJsonRequestMock.mockResolvedValue({ Functions: [], NextMarker: null })

      await service.listFunctionsDictionary({ cursor: 'token with spaces' })

      const [opts] = restJsonRequestMock.mock.calls[0]

      expect(opts.path).toBe('/2015-03-31/functions?MaxItems=50&Marker=token%20with%20spaces')
    })

    it('returns NextMarker as cursor when present', async () => {
      restJsonRequestMock.mockResolvedValue({
        Functions: [{ FunctionName: 'fn1', Runtime: 'nodejs20.x' }],
        NextMarker: 'nextPage123',
      })

      const result = await service.listFunctionsDictionary({})

      expect(result.cursor).toBe('nextPage123')
    })

    it('filters functions by search string (case-insensitive)', async () => {
      restJsonRequestMock.mockResolvedValue({
        Functions: [
          { FunctionName: 'ProcessOrders', Runtime: 'nodejs20.x' },
          { FunctionName: 'SendEmail', Runtime: 'python3.12' },
          { FunctionName: 'processPayments', Runtime: 'nodejs20.x' },
        ],
      })

      const result = await service.listFunctionsDictionary({ search: 'process' })

      expect(result.items).toEqual([
        { label: 'ProcessOrders', value: 'ProcessOrders', note: 'nodejs20.x' },
        { label: 'processPayments', value: 'processPayments', note: 'nodejs20.x' },
      ])
    })

    it('returns empty items when search matches nothing', async () => {
      restJsonRequestMock.mockResolvedValue({
        Functions: [{ FunctionName: 'fn1', Runtime: 'nodejs20.x' }],
      })

      const result = await service.listFunctionsDictionary({ search: 'nonexistent' })

      expect(result.items).toEqual([])
    })

    it('returns empty items when no functions exist', async () => {
      restJsonRequestMock.mockResolvedValue({ Functions: [] })

      const result = await service.listFunctionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles missing Functions array in response', async () => {
      restJsonRequestMock.mockResolvedValue({})

      const result = await service.listFunctionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles null payload', async () => {
      restJsonRequestMock.mockResolvedValue({ Functions: [] })

      const result = await service.listFunctionsDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles undefined payload', async () => {
      restJsonRequestMock.mockResolvedValue({ Functions: [] })

      const result = await service.listFunctionsDictionary()

      expect(result).toEqual({ items: [], cursor: null })
    })

    it('handles ResourceNotFoundException', async () => {
      const err = new Error('Not found')

      err.name = 'ResourceNotFoundException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.listFunctionsDictionary({})).rejects.toThrow('Resource not found')
    })

    it('handles AccessDeniedException', async () => {
      const err = new Error('Not authorized')

      err.name = 'AccessDeniedException'
      restJsonRequestMock.mockRejectedValue(err)

      await expect(service.listFunctionsDictionary({})).rejects.toThrow('Access denied')
    })
  })
})

const SIGNING_URL = 'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions'
const SIGNING_BODY = '{"FunctionName":"my-fn"}'
const SIGNING_SERVICE = 'lambda'
const SESSION_NAME_PREFIX = 'flowrunner-lambda-'

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules (sigv4.js, aws-client.js, credentials.js, errors.js)
// ─────────────────────────────────────────────────────────────────────────────

const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')

const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { awsConfigItems } = require('../src/config-items')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

// Well-known credentials from the official AWS SigV4 test suite.
const SIGV4_CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
}

// The frozen clock used for every signature assertion. Signatures are only ever
// asserted under fake timers — never against a live clock.
const FIXED_NOW = new Date('2015-08-30T12:36:00Z')
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

// ── Independent SigV4 reference implementation ──
//
// Written from the AWS "Create a signed AWS API request" specification, NOT derived
// from src/sigv4.js. It is validated below against the published AWS SigV4 test-suite
// vector (`get-vanilla`), which makes it a trustworthy oracle for the service's signer.

const sha256Hex = data => crypto.createHash('sha256').update(data).digest('hex')
const hmacSha256 = (key, data) => crypto.createHmac('sha256', key).update(data).digest()

function rfc3986Encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase())
}

function referenceSign({ method, url, headers, payloadHash, credentials, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const canonicalUri =
    '/' + parsed.pathname.slice(1).split('/').map(seg => rfc3986Encode(decodeURIComponent(seg))).join('/')

  const canonicalQuery = [...parsed.searchParams.entries()]
    .map(([key, value]) => [rfc3986Encode(key), rfc3986Encode(value)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${ key }=${ value }`)
    .join('&')

  const lowered = Object.keys(headers)
    .map(key => [key.toLowerCase(), String(headers[key]).trim()])
    .sort()

  const canonicalHeaders = lowered.map(([key, value]) => `${ key }:${ value }\n`).join('')
  const signedHeaders = lowered.map(([key]) => key).join(';')

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = hmacSha256(
    hmacSha256(hmacSha256(hmacSha256('AWS4' + credentials.secretAccessKey, dateStamp), region), service),
    'aws4_request'
  )

  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  return {
    signature,
    signedHeaders,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
      `SignedHeaders=${ signedHeaders }, Signature=${ signature }`,
  }
}

// Drives the mocked `https.request` / `http.request` with a canned response.
function stubTransport({
  statusCode = 200,
  body = '',
  error = null,
  responseError = null,
  fireTimeout = false,
  transport = https,
} = {}) {
  const captured = { options: null, written: [], timeoutMs: null, destroyedWith: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.destroy = jest.fn(err => {
      captured.destroyedWith = err

      if (err) {
        process.nextTick(() => req.emit('error', err))
      }
    })

    req.setTimeout = jest.fn((ms, onTimeout) => {
      captured.timeoutMs = ms

      if (fireTimeout) {
        onTimeout()
      }
    })

    req.end = () => {
      if (fireTimeout) {
        return
      }

      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)

        if (responseError) {
          res.emit('error', responseError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

describe('config-items', () => {
  it('exposes the six AWS config items, none of them shared', () => {
    expect(awsConfigItems.map(item => item.name)).toEqual([
      'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
    ])

    expect(awsConfigItems.every(item => item.shared === false)).toBe(true)

    expect(awsConfigItems[0]).toMatchObject({
      type: 'CHOICE',
      required: true,
      defaultValue: 'API Key',
      options: ['API Key', 'IAM Role'],
    })

    expect(awsConfigItems[1]).toMatchObject({ type: 'STRING', required: true, defaultValue: 'us-east-1' })
  })
})

// ── sigv4.js ──

describe('sigv4 reference oracle', () => {
  it('reproduces the published AWS SigV4 test-suite vector (get-vanilla)', () => {
    const { authorization } = referenceSign({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': FIXED_AMZ_DATE },
      payloadHash: sha256Hex(''),
      credentials: SIGV4_CREDS,
      region: 'us-east-1',
      service: 'service',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
      'SignedHeaders=host;x-amz-date, ' +
      'Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31'
    )
  })
})

describe('sigv4 signRequest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-amz-json-1.1', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || SIGNING_URL,
      headers,
      overrides.body !== undefined ? overrides.body : SIGNING_BODY,
      overrides.credentials || SIGV4_CREDS,
      overrides.region || 'us-east-1',
      overrides.service || SIGNING_SERVICE
    )

    return headers
  }

  // Recomputes the expected authorization header with the independent reference.
  function expectedAuthorization(headers, { region = 'us-east-1', service = SIGNING_SERVICE, method = 'POST', url = SIGNING_URL, credentials = SIGV4_CREDS } = {}) {
    const signedInput = { ...headers }

    delete signedInput.authorization

    return referenceSign({
      method,
      url,
      headers: signedInput,
      payloadHash: headers['x-amz-content-sha256'],
      credentials,
      region,
      service,
      amzDate: headers['x-amz-date'],
    }).authorization
  }

  it('sets the deterministic SigV4 headers under a frozen clock', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe(new URL(SIGNING_URL).hostname)
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(SIGNING_BODY))

    expect(headers['authorization']).toMatch(
      new RegExp(
        `^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/${ SIGNING_SERVICE }/aws4_request, ` +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('matches the independently derived reference signature', () => {
    const headers = sign()

    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('matches the reference for a GET with a query string and an encoded path', () => {
    const url = `https://${ SIGNING_SERVICE }.eu-west-1.amazonaws.com/2015-03-31/functions/my%20fn?Marker=a&MaxItems=2`
    const headers = sign({ method: 'GET', url, body: '', region: 'eu-west-1' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, region: 'eu-west-1' }))
  })

  it('produces a stable signature for identical input', () => {
    expect(sign()['authorization']).toBe(sign()['authorization'])
  })

  it('changes the signature when the payload, secret, region or service change', () => {
    const baseline = sign()['authorization']

    expect(sign({ body: `${ SIGNING_BODY } ` })['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...SIGV4_CREDS, secretAccessKey: 'OTHER' } })['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })['authorization']).not.toBe(baseline)
    expect(sign({ service: 'other-service' })['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    expect(sign({ body: '' })['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(sign({ body: null })['x-amz-content-sha256']).toBe(sha256Hex(''))
  })

  it('adds the session token to the signed headers when present', () => {
    const headers = sign({ credentials: { ...SIGV4_CREDS, sessionToken: 'SESSION' } })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toBe(
      expectedAuthorization(headers, { credentials: { ...SIGV4_CREDS, sessionToken: 'SESSION' } })
    )
  })

  it('keeps an existing host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    expect(sign({ url: 'https://localhost:4566/' })['host']).toBe('localhost:4566')
    expect(sign({ url: 'https://localhost:443/' })['host']).toBe('localhost')
  })

  it('signs a body with multi-byte and reserved characters identically to the reference', () => {
    const body = 'Message=café & résumé (100%)'
    const headers = sign({ body })

    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(body))
    expect(headers['authorization']).toBe(expectedAuthorization(headers))
  })

  it('canonicalizes the path and is insensitive to query ordering', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/my bucket/a+b (1).txt?b=2&a=1'
    const reordered = 'https://s3.us-east-1.amazonaws.com/my bucket/a+b (1).txt?a=1&b=2'

    const first = sign({ method: 'GET', url, body: '', service: 's3' })
    const second = sign({ method: 'GET', url: reordered, body: '', service: 's3' })

    expect(first['authorization']).toBe(second['authorization'])
    expect(first['authorization']).toBe(expectedAuthorization(first, { method: 'GET', url, service: 's3' }))
  })

  it('sorts repeated query parameters by value', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/bucket?a=2&a=1'
    const headers = sign({ method: 'GET', url, body: '', service: 's3' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, service: 's3' }))
  })

  it('percent-encodes multi-byte characters in the path and query byte by byte', () => {
    const url = 'https://s3.us-east-1.amazonaws.com/bucket/r\u00e9sum\u00e9.txt?nom=caf\u00e9'
    const headers = sign({ method: 'GET', url, body: '', service: 's3' })

    expect(headers['authorization']).toBe(expectedAuthorization(headers, { method: 'GET', url, service: 's3' }))
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  // Re-derives the presigned signature from the produced URL using the independent reference.
  function referencePresignedSignature(presigned, { region = 'us-east-1', service = 's3', method = 'GET' } = {}) {
    const parsed = new URL(presigned)

    parsed.searchParams.delete('X-Amz-Signature')

    const port = parsed.port && parsed.port !== '443' && parsed.port !== '80' ? `:${ parsed.port }` : ''

    return referenceSign({
      method,
      url: parsed.toString(),
      headers: { host: `${ parsed.hostname }${ port }` },
      payloadHash: 'UNSIGNED-PAYLOAD',
      credentials: SIGV4_CREDS,
      region,
      service,
      amzDate: parsed.searchParams.get('X-Amz-Date'),
    }).signature
  }

  it('adds every SigV4 query parameter and a reference-verified signature', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      900
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`)
    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
    expect(url.searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('includes the session token and a non-standard port in the signature', () => {
    const presigned = generatePresignedUrl(
      'PUT',
      'https://localhost:4566/bucket/key',
      { ...SIGV4_CREDS, sessionToken: 'SESSION' },
      'us-east-1',
      's3',
      60
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('sorts repeated query parameters carried over from the source URL', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://b.s3.amazonaws.com/k?tag=2&tag=1',
      SIGV4_CREDS,
      'us-east-1',
      's3',
      60
    )

    expect(new URL(presigned).searchParams.get('X-Amz-Signature')).toBe(referencePresignedSignature(presigned))
  })

  it('is stable for identical input and sensitive to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 60)
    const longer = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', SIGV4_CREDS, 'us-east-1', 's3', 3600)

    expect(first).toBe(second)
    expect(longer).not.toBe(first)
  })
})

// ── aws-client.js: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag and returns null when absent', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
  })

  it('extracts every matching tag, including multi-line values', () => {
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

// ── aws-client.js: httpRequest ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubTransport({ statusCode: 200, body: '<ok/>' })

    const response = await httpRequest(
      'POST',
      'https://example.us-east-1.amazonaws.com/path?a=1',
      { 'content-type': 'text/plain' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'example.us-east-1.amazonaws.com',
      port: 443,
      path: '/path?a=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(captured.timeoutMs).toBe(30000)
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '<ok/>' })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubTransport({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://example.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('honours an explicit port', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'x' })

    await httpRequest('GET', 'https://localhost:4566/health', {})

    expect(captured.options.port).toBe('4566')
  })

  it('uses the http transport and port 80 for http URLs', async () => {
    const captured = stubTransport({ statusCode: 200, body: 'plain', transport: http })

    const response = await httpRequest('GET', 'http://localhost/health', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options.port).toBe(80)
    expect(response.body).toBe('plain')
  })

  it('rejects on a transport error', async () => {
    stubTransport({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    stubTransport({ responseError: new Error('stream aborted') })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('stream aborted')
  })

  it('destroys the request and rejects when the socket times out', async () => {
    const captured = stubTransport({ fireTimeout: true })

    await expect(httpRequest('GET', 'https://example.amazonaws.com/', {})).rejects.toThrow('Request timed out')

    expect(captured.destroyedWith).toBeInstanceOf(Error)
  })
})

// ── aws-client.js: stsAssumeRole ──

describe('stsAssumeRole', () => {
  const ROLE_ARN = 'arn:aws:iam::123456789012:role/MyRole'

  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  afterEach(() => {
    https.request.mockReset()
  })

  it('signs the STS call and returns the temporary credentials', async () => {
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(SIGV4_CREDS, 'eu-west-1', ROLE_ARN, 'session-1', 'ext-1')

    expect(captured.options).toMatchObject({
      hostname: 'sts.eu-west-1.amazonaws.com',
      port: 443,
      path: '/',
      method: 'POST',
    })

    expect(captured.options.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(captured.options.headers['content-length']).toBeGreaterThan(0)

    expect(captured.written.join('')).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      `&RoleArn=${ encodeURIComponent(ROLE_ARN) }` +
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
    const captured = stubTransport({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 'session-2')

    expect(captured.written.join('')).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubTransport({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body has no Code or Message', async () => {
    stubTransport({ statusCode: 500, body: '<html>gateway</html>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubTransport({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>A</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toMatchObject({
      name: 'STSParseError',
      message: expect.stringContaining('missing credential fields'),
    })
  })

  it('propagates a socket error', async () => {
    stubTransport({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(SIGV4_CREDS, 'us-east-1', ROLE_ARN, 's')).rejects.toThrow('socket hang up')
  })
})

// ── aws-client.js: AWS JSON protocol ──

describe('buildAwsJsonRequest', () => {
  it('builds a POST with the target header', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'lambda',
      target: 'Lambda.ListFunctions',
      body: { MaxResults: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://lambda.us-east-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Lambda.ListFunctions',
      },
      body: '{"MaxResults":1}',
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

  it('treats an empty or missing body as an empty object', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error for an AWS __type error body', () => {
    try {
      parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest', () => {
  it('signs and sends the built request through the injected transport', async () => {
    const signRequestMock = jest.fn((method, url, headers) => {
      headers.authorization = 'AWS4-HMAC-SHA256 signed'
    })

    const httpRequestMock = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Functions":[]}' })

    const result = await jsonRequest(
      {
        region: 'us-east-1',
        service: 'lambda',
        target: 'Lambda.ListFunctions',
        contentType: 'application/x-amz-json-1.1',
        body: { MaxResults: 1 },
      },
      SIGV4_CREDS,
      { signRequest: signRequestMock, httpRequest: httpRequestMock }
    )

    expect(result).toEqual({ Functions: [] })

    expect(signRequestMock).toHaveBeenCalledWith(
      'POST',
      'https://lambda.us-east-1.amazonaws.com/',
      expect.any(Object),
      '{"MaxResults":1}',
      SIGV4_CREDS,
      'us-east-1',
      'lambda'
    )

    expect(httpRequestMock.mock.calls[0][2]).toMatchObject({
      'authorization': 'AWS4-HMAC-SHA256 signed',
      'x-amz-target': 'Lambda.ListFunctions',
    })
  })

  it('throws the parsed AWS error for a failed response', async () => {
    await expect(
      jsonRequest({ region: 'us-east-1', service: 'lambda', contentType: 'application/x-amz-json-1.1' }, SIGV4_CREDS, {
        signRequest: () => {},
        httpRequest: async () => ({ statusCode: 400, body: '{"__type":"x#LimitExceededException","message":"too many"}' }),
      })
    ).rejects.toThrow('too many')
  })

  it('falls back to the real signer and transport when no deps are injected', async () => {
    const captured = stubTransport({ statusCode: 200, body: '{"ok":true}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'lambda', target: 'T.Op', contentType: 'application/x-amz-json-1.1', body: {} },
      SIGV4_CREDS
    )

    expect(result).toEqual({ ok: true })
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)

    https.request.mockReset()
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('accepts an empty config', async () => {
    await expect(new CredentialProvider().resolve()).rejects.toThrow(/API Key authentication/)
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes past the expiry buffer', async () => {
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
      `${ SESSION_NAME_PREFIX }${ now }`,
      'ext'
    )

    // Cache hit — still well inside the 5 minute expiry buffer.
    now += 1000

    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Past the expiry buffer — the credentials are refreshed.
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

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role', accessKeyId: 'AK' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('defaults to the real stsAssumeRole and Date.now', async () => {
    stubTransport({
      statusCode: 200,
      body:
        '<AssumeRoleResponse><Credentials><AccessKeyId>ASIA9</AccessKeyId>' +
        '<SecretAccessKey>SEC9</SecretAccessKey><SessionToken>TOK9</SessionToken>' +
        '<Expiration>2030-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResponse>',
    })

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      roleArn: 'arn:role',
    })

    await expect(provider.resolve()).resolves.toEqual({
      accessKeyId: 'ASIA9',
      secretAccessKey: 'SEC9',
      sessionToken: 'TOK9',
    })

    https.request.mockReset()
  })
})

// ── errors.js ──

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('Sample')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[Sample Service]', 'info:', 'a'],
      ['[Sample Service]', 'debug:', 'b'],
      ['[Sample Service]', 'warn:', 'c'],
      ['[Sample Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

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

// ── aws-client.js: REST JSON protocol (Lambda only) ──

const { buildRestJsonRequest, restJsonRequest, restRequest } = require('../src/aws-client')

describe('buildRestJsonRequest', () => {
  it('builds a request from a path, method, body and extra headers', () => {
    expect(buildRestJsonRequest({
      region: 'eu-west-1',
      service: 'lambda',
      method: 'POST',
      path: '/2015-03-31/functions/my-fn/invocations',
      body: { key: 'value' },
      headers: { 'x-amz-invocation-type': 'Event' },
    })).toEqual({
      method: 'POST',
      url: 'https://lambda.eu-west-1.amazonaws.com/2015-03-31/functions/my-fn/invocations',
      headers: { 'content-type': 'application/json', 'x-amz-invocation-type': 'Event' },
      body: '{"key":"value"}',
    })
  })

  it('defaults the method to POST, the path to / and the headers to content-type only', () => {
    expect(buildRestJsonRequest({ region: 'us-east-1', service: 'lambda' })).toEqual({
      method: 'POST',
      url: 'https://lambda.us-east-1.amazonaws.com/',
      headers: { 'content-type': 'application/json' },
      body: '',
    })
  })

  it('serializes a null or undefined body as an empty string and passes strings through', () => {
    expect(buildRestJsonRequest({ region: 'us-east-1', service: 'lambda', body: null }).body).toBe('')
    expect(buildRestJsonRequest({ region: 'us-east-1', service: 'lambda', body: '{"raw":1}' }).body).toBe('{"raw":1}')
  })

  it('allows an explicit content-type override', () => {
    const built = buildRestJsonRequest({
      region: 'us-east-1',
      service: 'lambda',
      headers: { 'content-type': 'application/octet-stream' },
    })

    expect(built.headers['content-type']).toBe('application/octet-stream')
  })
})

describe('restJsonRequest', () => {
  it('signs and sends the built request and parses the JSON response', async () => {
    const signRequestMock = jest.fn((method, url, headers) => {
      headers.authorization = 'AWS4-HMAC-SHA256 signed'
    })

    const httpRequestMock = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Functions":[]}' })

    const result = await restJsonRequest(
      { region: 'us-east-1', service: 'lambda', method: 'GET', path: '/2015-03-31/functions' },
      SIGV4_CREDS,
      { signRequest: signRequestMock, httpRequest: httpRequestMock }
    )

    expect(result).toEqual({ Functions: [] })

    expect(signRequestMock).toHaveBeenCalledWith(
      'GET',
      'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions',
      expect.any(Object),
      '',
      SIGV4_CREDS,
      'us-east-1',
      'lambda'
    )

    expect(httpRequestMock.mock.calls[0][2]).toMatchObject({ 'authorization': 'AWS4-HMAC-SHA256 signed' })
  })

  it('throws the parsed AWS error for a failed response', async () => {
    await expect(
      restJsonRequest({ region: 'us-east-1', service: 'lambda', path: '/x' }, SIGV4_CREDS, {
        signRequest: () => {},
        httpRequest: async () => ({
          statusCode: 404,
          body: '{"__type":"com.amazonaws.lambda#ResourceNotFoundException","message":"no function"}',
        }),
      })
    ).rejects.toThrow('no function')
  })

  it('falls back to the real signer and transport when no deps are injected', async () => {
    const captured = stubTransport({ statusCode: 200, body: '{"ok":true}' })

    await expect(
      restJsonRequest({ region: 'us-east-1', service: 'lambda', method: 'GET', path: '/ping' }, SIGV4_CREDS)
    ).resolves.toEqual({ ok: true })

    expect(captured.options.path).toBe('/ping')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)

    https.request.mockReset()
  })
})

describe('restRequest', () => {
  it('returns the raw response without parsing it', async () => {
    const httpRequestMock = jest.fn().mockResolvedValue({
      statusCode: 200,
      headers: { 'x-amz-function-error': 'Unhandled' },
      body: 'not json at all',
    })

    const result = await restRequest(
      {
        region: 'us-east-1',
        service: 'lambda',
        method: 'POST',
        path: '/2015-03-31/functions/fn/invocations',
        body: { a: 1 },
        headers: { 'x-amz-invocation-type': 'RequestResponse' },
      },
      SIGV4_CREDS,
      { signRequest: jest.fn(), httpRequest: httpRequestMock }
    )

    expect(result).toEqual({
      statusCode: 200,
      headers: { 'x-amz-function-error': 'Unhandled' },
      body: 'not json at all',
    })

    expect(httpRequestMock).toHaveBeenCalledWith(
      'POST',
      'https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/fn/invocations',
      expect.objectContaining({ 'x-amz-invocation-type': 'RequestResponse' }),
      '{"a":1}'
    )
  })

  it('does not throw for an error status — the caller inspects the raw response', async () => {
    const result = await restRequest({ region: 'us-east-1', service: 'lambda', path: '/x' }, SIGV4_CREDS, {
      signRequest: jest.fn(),
      httpRequest: async () => ({ statusCode: 500, headers: {}, body: '{"message":"boom"}' }),
    })

    expect(result.statusCode).toBe(500)
  })

  it('falls back to the real signer and transport when no deps are injected', async () => {
    const captured = stubTransport({ statusCode: 202, body: '' })

    const result = await restRequest(
      { region: 'us-east-1', service: 'lambda', path: '/invoke', body: 'raw' },
      SIGV4_CREDS
    )

    expect(result.statusCode).toBe(202)
    expect(captured.written).toEqual(['raw'])

    https.request.mockReset()
  })
})

// ── index.js: construction and remaining branches ──

describe('Lambda internals', () => {
  let Lambda

  // Required lazily: the entry file must only be loaded once the sandbox global exists.
  beforeAll(() => {
    ({ Lambda } = require('../src/index.js'))
  })

  function makeService() {
    const instance = new Lambda({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    instance.deps.restJsonRequest = jest.fn()
    instance.deps.restRequest = jest.fn()

    return instance
  }

  it('defaults the region to us-east-1 and builds a credential provider', () => {
    const bare = new Lambda()

    expect(bare.region).toBe('us-east-1')
    expect(bare.credentials).toBeInstanceOf(CredentialProvider)
    expect(bare.credentials.region).toBe('us-east-1')
    expect(bare.credentials.authenticationMethod).toBe('API Key')
    expect(typeof bare.deps.restJsonRequest).toBe('function')
    expect(typeof bare.deps.restRequest).toBe('function')
  })

  it('resolves credentials and forwards them to restJsonRequest', async () => {
    const instance = makeService()

    instance.deps.restJsonRequest.mockResolvedValue({ Functions: [] })

    await instance.listFunctionsDictionary({})

    expect(instance.deps.restJsonRequest).toHaveBeenCalledWith(
      expect.objectContaining({ region: 'us-east-1', service: 'lambda', method: 'GET' }),
      { accessKeyId: 'AK', secretAccessKey: 'SK' }
    )
  })

  it('resolves credentials and forwards them to restRequest for invocations', async () => {
    const instance = makeService()

    instance.deps.restRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: '{}' })

    await instance.invoke('my-fn', { a: 1 }, 'Event')

    expect(instance.deps.restRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'us-east-1',
        service: 'lambda',
        method: 'POST',
        path: '/2015-03-31/functions/my-fn/invocations',
        headers: { 'x-amz-invocation-type': 'Event' },
      }),
      { accessKeyId: 'AK', secretAccessKey: 'SK' }
    )
  })

  it('tolerates a getFunction response without a Configuration block', async () => {
    const instance = makeService()

    instance.deps.restJsonRequest.mockResolvedValue({})

    await expect(instance.getFunction('my-fn')).resolves.toEqual({
      functionName: undefined,
      runtime: undefined,
      handler: undefined,
      description: undefined,
      timeout: undefined,
      memorySize: undefined,
      codeSize: undefined,
      lastModified: undefined,
      state: undefined,
      version: undefined,
      role: undefined,
      arn: undefined,
    })
  })

  it('defaults the dictionary result to an empty list when the response omits Functions', async () => {
    const instance = makeService()

    instance.deps.restJsonRequest.mockResolvedValue({})

    await expect(instance.listFunctionsDictionary(null)).resolves.toEqual({ items: [], cursor: null })
  })

  it.each([
    ['ResourceNotFoundException', 'Resource not found: '],
    ['InvalidParameterValueException', 'Invalid parameter: '],
    ['TooManyRequestsException', 'Too many requests: '],
    ['ThrottlingException', 'Too many requests: '],
    ['ServiceException', 'Service error: '],
    ['AccessDeniedException', 'Access denied: '],
  ])('maps %s to a friendly message', async (name, prefix) => {
    const instance = makeService()
    const error = new Error('boom')

    error.name = name
    instance.deps.restJsonRequest.mockRejectedValue(error)

    await expect(instance.getFunction('my-fn')).rejects.toThrow(`${ prefix }boom`)
  })

  it('falls back to the generic AWS error mapping', async () => {
    const instance = makeService()

    instance.deps.restJsonRequest.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }))

    await expect(instance.getFunction('my-fn')).rejects.toThrow('Connection to AWS failed: nope')
  })
})
