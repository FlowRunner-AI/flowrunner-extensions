'use strict'

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
