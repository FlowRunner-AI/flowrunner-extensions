'use strict'

const crypto = require('crypto')
const { EventEmitter } = require('events')

jest.mock('https')

const https = require('https')

const { createSandbox } = require('../../../service-sandbox')

const { signRequest, generatePresignedUrl } = require('../src/sigv4')
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

const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const REGION = 'us-east-1'

/**
 * Drives the mocked `https.request` with a canned response, a transport error,
 * or a mid-stream response error.
 */
function stubHttps({ statusCode = 200, body = '', error = null, responseError = null } = {}) {
  const captured = { options: null, written: [], request: null }

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
        res.headers = { 'content-type': 'application/json' }

        callback(res)

        if (responseError) {
          res.emit('error', responseError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    captured.request = req

    return req
  })

  return captured
}

describe('AWS Textract Service', () => {
  let sandbox
  let service
  let mock
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: REGION,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Replace the real jsonRequest with a Jest mock since the service
    // uses its own HTTP client (aws-client.js) rather than Flowrunner.Request.
    jsonRequestMock = jest.fn()
    service.deps.jsonRequest = jsonRequestMock
  })

  afterEach(() => {
    mock.reset()
    jsonRequestMock.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', type: 'CHOICE', required: true, shared: false }),
          expect.objectContaining({ name: 'region', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'accessKeyId', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'secretAccessKey', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'roleArn', type: 'STRING', shared: false }),
          expect.objectContaining({ name: 'externalId', type: 'STRING', shared: false }),
        ])
      )
    })
  })

  // ── Helpers ──

  function expectSendJson(operation, bodyMatcher) {
    expect(jsonRequestMock).toHaveBeenCalledTimes(1)

    const callArgs = jsonRequestMock.mock.calls[0]
    const opts = callArgs[0]

    expect(opts.service).toBe('textract')
    expect(opts.region).toBe(REGION)
    expect(opts.target).toBe(`Textract.${ operation }`)
    expect(opts.contentType).toBe('application/x-amz-json-1.1')

    if (bodyMatcher) {
      expect(opts.body).toMatchObject(bodyMatcher)
    }

    return opts.body
  }

  // ── Synchronous operations ──

  describe('detectDocumentText', () => {
    const mockBlocks = [
      { BlockType: 'PAGE', Id: 'p1' },
      { BlockType: 'LINE', Text: 'Hello World', Id: 'l1' },
      { BlockType: 'LINE', Text: 'Second line', Id: 'l2' },
      { BlockType: 'WORD', Text: 'Hello', Id: 'w1' },
    ]

    it('sends correct request with S3 reference', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: mockBlocks,
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.detectDocumentText(null, 'my-bucket', 'docs/invoice.png')

      expectSendJson('DetectDocumentText', {
        Document: { S3Object: { Bucket: 'my-bucket', Name: 'docs/invoice.png' } },
      })

      expect(result).toEqual({
        text: 'Hello World\nSecond line',
        blocks: mockBlocks,
        lineCount: 2,
        pages: 1,
      })
    })

    it('downloads file URL and sends inline bytes', async () => {
      const fakeBytes = Buffer.from('fake-pdf-content')

      mock.onGet('https://example.com/doc.png').reply(fakeBytes)

      jsonRequestMock.mockResolvedValue({
        Blocks: [{ BlockType: 'LINE', Text: 'OCR text', Id: 'l1' }],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.detectDocumentText('https://example.com/doc.png')

      expectSendJson('DetectDocumentText', {
        Document: { Bytes: fakeBytes.toString('base64') },
      })

      expect(result.text).toBe('OCR text')
      expect(result.lineCount).toBe(1)

      // Verify Flowrunner.Request.get was called with null encoding for binary
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBeNull()
    })

    it('throws when neither fileUrl nor S3 fields provided', async () => {
      await expect(service.detectDocumentText()).rejects.toThrow(
        'Provide either a File URL or both an S3 Bucket and S3 Object Name.'
      )
    })

    it('throws when file exceeds 5 MB limit', async () => {
      const largeBuffer = Buffer.alloc(6 * 1024 * 1024)

      mock.onGet('https://example.com/large.pdf').reply(largeBuffer)

      await expect(service.detectDocumentText('https://example.com/large.pdf')).rejects.toThrow(
        'exceeds the ~5 MB limit'
      )
    })

    it('handles empty blocks gracefully', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.detectDocumentText(null, 'bucket', 'key')

      expect(result).toEqual({
        text: '',
        blocks: [],
        lineCount: 0,
        pages: 1,
      })
    })

    it('defaults pages to 1 when DocumentMetadata is missing', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [] })

      const result = await service.detectDocumentText(null, 'bucket', 'key')

      expect(result.pages).toBe(1)
    })

    it('prefers S3 when both fileUrl and S3 fields are provided', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.detectDocumentText('https://example.com/doc.png', 'bucket', 'key')

      expectSendJson('DetectDocumentText', {
        Document: { S3Object: { Bucket: 'bucket', Name: 'key' } },
      })

      // Should NOT have called Flowrunner.Request.get
      expect(mock.history).toHaveLength(0)
    })
  })

  describe('analyzeDocument', () => {
    it('sends correct request with feature types and S3', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.analyzeDocument(['TABLES', 'FORMS'], null, 'bucket', 'key')

      const body = expectSendJson('AnalyzeDocument', {
        Document: { S3Object: { Bucket: 'bucket', Name: 'key' } },
        FeatureTypes: ['TABLES', 'FORMS'],
      })

      expect(body.QueriesConfig).toBeUndefined()
    })

    it('includes QueriesConfig when queries provided', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.analyzeDocument(
        ['QUERIES'],
        null, 'bucket', 'key',
        [
          { Text: 'What is the total?', Alias: 'total' },
          { text: 'Due date?', alias: 'due' },
        ]
      )

      const body = expectSendJson('AnalyzeDocument')

      expect(body.QueriesConfig).toEqual({
        Queries: [
          { Text: 'What is the total?', Alias: 'total' },
          { Text: 'Due date?', Alias: 'due' },
        ],
      })
    })

    it('handles query without alias', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.analyzeDocument(
        ['QUERIES'], null, 'bucket', 'key',
        [{ Text: 'What is the name?' }]
      )

      const body = expectSendJson('AnalyzeDocument')

      expect(body.QueriesConfig.Queries[0]).toEqual({ Text: 'What is the name?' })
      expect(body.QueriesConfig.Queries[0].Alias).toBeUndefined()
    })

    it('throws when featureTypes is empty', async () => {
      await expect(service.analyzeDocument([])).rejects.toThrow(
        'featureTypes is required'
      )
    })

    it('throws when featureTypes is not an array', async () => {
      await expect(service.analyzeDocument('TABLES')).rejects.toThrow(
        'featureTypes is required'
      )
    })

    it('extracts forms from KEY_VALUE_SET blocks', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: 'k1',
            Relationships: [
              { Type: 'CHILD', Ids: ['w1'] },
              { Type: 'VALUE', Ids: ['v1'] },
            ], 
          },
          {
            BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: 'v1',
            Relationships: [{ Type: 'CHILD', Ids: ['w2'] }], 
          },
          { BlockType: 'WORD', Text: 'Name', Id: 'w1' },
          { BlockType: 'WORD', Text: 'Ana', Id: 'w2' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['FORMS'], null, 'bucket', 'key')

      expect(result.forms).toEqual({ Name: 'Ana' })
    })

    it('extracts queries from QUERY blocks', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'QUERY', Id: 'q1', Query: { Text: 'What is the total?', Alias: 'total' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }], 
          },
          { BlockType: 'QUERY_RESULT', Id: 'qr1', Text: '$42.00' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['QUERIES'], null, 'bucket', 'key')

      expect(result.queries).toEqual({ total: '$42.00' })
    })

    it('extracts tables from TABLE/CELL blocks', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'TABLE', Id: 't1',
            Relationships: [{ Type: 'CHILD', Ids: ['c1', 'c2'] }], 
          },
          {
            BlockType: 'CELL', Id: 'c1', RowIndex: 1, ColumnIndex: 1,
            Relationships: [{ Type: 'CHILD', Ids: ['w1'] }], 
          },
          {
            BlockType: 'CELL', Id: 'c2', RowIndex: 1, ColumnIndex: 2,
            Relationships: [{ Type: 'CHILD', Ids: ['w2'] }], 
          },
          { BlockType: 'WORD', Text: 'Item', Id: 'w1' },
          { BlockType: 'WORD', Text: 'Price', Id: 'w2' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['TABLES'], null, 'bucket', 'key')

      expect(result.tables).toEqual([{ rows: [['Item', 'Price']] }])
    })

    it('returns text from LINE blocks', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          { BlockType: 'LINE', Text: 'Line 1', Id: 'l1' },
          { BlockType: 'LINE', Text: 'Line 2', Id: 'l2' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['FORMS'], null, 'bucket', 'key')

      expect(result.text).toBe('Line 1\nLine 2')
    })
  })

  describe('analyzeExpense', () => {
    it('sends correct request and flattens expense data', async () => {
      jsonRequestMock.mockResolvedValue({
        ExpenseDocuments: [
          {
            SummaryFields: [
              {
                Type: { Text: 'TOTAL' },
                LabelDetection: { Text: 'Total' },
                ValueDetection: { Text: '$42.00', Confidence: 98.7 },
              },
            ],
            LineItemGroups: [
              {
                LineItems: [
                  {
                    LineItemExpenseFields: [
                      { Type: { Text: 'ITEM' }, ValueDetection: { Text: 'Widget' } },
                      { Type: { Text: 'PRICE' }, ValueDetection: { Text: '$10.00' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeExpense(null, 'bucket', 'receipt.jpg')

      expectSendJson('AnalyzeExpense', {
        Document: { S3Object: { Bucket: 'bucket', Name: 'receipt.jpg' } },
      })

      expect(result.summaryFields).toEqual([
        { type: 'TOTAL', label: 'Total', value: '$42.00', confidence: 98.7 },
      ])

      expect(result.lineItems).toEqual([{ ITEM: 'Widget', PRICE: '$10.00' }])
      expect(result.pages).toBe(1)
    })

    it('handles empty expense documents', async () => {
      jsonRequestMock.mockResolvedValue({
        ExpenseDocuments: [],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeExpense(null, 'bucket', 'key')

      expect(result.summaryFields).toEqual([])
      expect(result.lineItems).toEqual([])
    })
  })

  describe('analyzeId', () => {
    it('sends correct request with DocumentPages wrapper and flattens identity fields', async () => {
      jsonRequestMock.mockResolvedValue({
        IdentityDocuments: [
          {
            IdentityDocumentFields: [
              {
                Type: { Text: 'FIRST_NAME' },
                ValueDetection: { Text: 'ANA', Confidence: 99.1 },
              },
              {
                Type: { Text: 'DATE_OF_BIRTH' },
                ValueDetection: { Text: '01/01/1990', Confidence: 98.2 },
              },
            ],
          },
        ],
      })

      const result = await service.analyzeId(null, 'bucket', 'id-card.jpg')

      // Verify the DocumentPages wrapper unique to analyzeId
      const body = expectSendJson('AnalyzeID')

      expect(body).toEqual({
        DocumentPages: [{ S3Object: { Bucket: 'bucket', Name: 'id-card.jpg' } }],
      })

      expect(result.fields).toEqual({
        FIRST_NAME: { value: 'ANA', confidence: 99.1 },
        DATE_OF_BIRTH: { value: '01/01/1990', confidence: 98.2 },
      })

      expect(result.documentCount).toBe(1)
      expect(result.identityDocuments).toHaveLength(1)
    })

    it('handles empty identity documents', async () => {
      jsonRequestMock.mockResolvedValue({ IdentityDocuments: [] })

      const result = await service.analyzeId(null, 'bucket', 'key')

      expect(result.fields).toEqual({})
      expect(result.documentCount).toBe(0)
    })
  })

  // ── Asynchronous operations ──

  describe('startDocumentTextDetection', () => {
    it('sends correct request with required params', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-123' })

      const result = await service.startDocumentTextDetection('bucket', 'docs/multi.pdf')

      expectSendJson('StartDocumentTextDetection', {
        DocumentLocation: { S3Object: { Bucket: 'bucket', Name: 'docs/multi.pdf' } },
      })

      expect(result).toEqual({ jobId: 'job-123' })
    })

    it('includes optional params when provided', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-456' })

      await service.startDocumentTextDetection('bucket', 'key', 'token-abc', 'my-tag')

      const body = expectSendJson('StartDocumentTextDetection')

      expect(body.ClientRequestToken).toBe('token-abc')
      expect(body.JobTag).toBe('my-tag')
    })

    it('omits optional params when not provided', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-789' })

      await service.startDocumentTextDetection('bucket', 'key')

      const body = expectSendJson('StartDocumentTextDetection')

      expect(body.ClientRequestToken).toBeUndefined()
      expect(body.JobTag).toBeUndefined()
    })

    it('throws when s3Bucket is missing', async () => {
      await expect(service.startDocumentTextDetection(null, 'key')).rejects.toThrow(
        's3Bucket and s3Name are required'
      )
    })

    it('throws when s3Name is missing', async () => {
      await expect(service.startDocumentTextDetection('bucket', '')).rejects.toThrow(
        's3Bucket and s3Name are required'
      )
    })
  })

  describe('getDocumentTextDetection', () => {
    it('returns results for a completed job', async () => {
      jsonRequestMock.mockResolvedValue({
        JobStatus: 'SUCCEEDED',
        Blocks: [
          { BlockType: 'LINE', Text: 'Page 1 text', Id: 'l1' },
        ],
        DocumentMetadata: { Pages: 3 },
      })

      const result = await service.getDocumentTextDetection('job-123')

      expectSendJson('GetDocumentTextDetection', {
        JobId: 'job-123',
        MaxResults: 1000,
      })

      expect(result.jobStatus).toBe('SUCCEEDED')
      expect(result.text).toBe('Page 1 text')
      expect(result.lineCount).toBe(1)
      expect(result.pages).toBe(3)
    })

    it('returns IN_PROGRESS status without paginating', async () => {
      jsonRequestMock.mockResolvedValue({
        JobStatus: 'IN_PROGRESS',
        Blocks: [],
      })

      const result = await service.getDocumentTextDetection('job-123')

      expect(result.jobStatus).toBe('IN_PROGRESS')
      expect(jsonRequestMock).toHaveBeenCalledTimes(1)
    })

    it('paginates through multiple result pages when SUCCEEDED', async () => {
      jsonRequestMock
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [{ BlockType: 'LINE', Text: 'Page 1', Id: 'l1' }],
          NextToken: 'token-2',
          DocumentMetadata: { Pages: 5 },
        })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [{ BlockType: 'LINE', Text: 'Page 2', Id: 'l2' }],
          DocumentMetadata: { Pages: 5 },
        })

      const result = await service.getDocumentTextDetection('job-123')

      expect(jsonRequestMock).toHaveBeenCalledTimes(2)
      expect(result.text).toBe('Page 1\nPage 2')
      expect(result.lineCount).toBe(2)
      expect(result.pages).toBe(5)

      // Second call should include NextToken
      const secondCallBody = jsonRequestMock.mock.calls[1][0].body

      expect(secondCallBody.NextToken).toBe('token-2')
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getDocumentTextDetection()).rejects.toThrow('jobId is required')
    })
  })

  describe('startDocumentAnalysis', () => {
    it('sends correct request with required params', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-abc' })

      const result = await service.startDocumentAnalysis(['TABLES'], 'bucket', 'doc.pdf')

      expectSendJson('StartDocumentAnalysis', {
        DocumentLocation: { S3Object: { Bucket: 'bucket', Name: 'doc.pdf' } },
        FeatureTypes: ['TABLES'],
      })

      expect(result).toEqual({ jobId: 'job-abc' })
    })

    it('includes queries config when provided', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-abc' })

      await service.startDocumentAnalysis(
        ['QUERIES'], 'bucket', 'doc.pdf',
        [{ Text: 'What is the total?', Alias: 'total' }]
      )

      const body = expectSendJson('StartDocumentAnalysis')

      expect(body.QueriesConfig).toEqual({
        Queries: [{ Text: 'What is the total?', Alias: 'total' }],
      })
    })

    it('includes optional clientRequestToken and jobTag', async () => {
      jsonRequestMock.mockResolvedValue({ JobId: 'job-abc' })

      await service.startDocumentAnalysis(
        ['FORMS'], 'bucket', 'doc.pdf',
        null, 'my-token', 'my-tag'
      )

      const body = expectSendJson('StartDocumentAnalysis')

      expect(body.ClientRequestToken).toBe('my-token')
      expect(body.JobTag).toBe('my-tag')
    })

    it('throws when featureTypes is empty', async () => {
      await expect(
        service.startDocumentAnalysis([], 'bucket', 'key')
      ).rejects.toThrow('featureTypes is required')
    })

    it('throws when s3Bucket is missing', async () => {
      await expect(
        service.startDocumentAnalysis(['TABLES'], null, 'key')
      ).rejects.toThrow('s3Bucket and s3Name are required')
    })
  })

  describe('getDocumentAnalysis', () => {
    it('returns full analysis results for a completed job', async () => {
      jsonRequestMock.mockResolvedValue({
        JobStatus: 'SUCCEEDED',
        Blocks: [
          { BlockType: 'LINE', Text: 'Some text', Id: 'l1' },
          {
            BlockType: 'QUERY', Id: 'q1', Query: { Text: 'Total?', Alias: 'total' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }], 
          },
          { BlockType: 'QUERY_RESULT', Id: 'qr1', Text: '$100' },
        ],
        DocumentMetadata: { Pages: 2 },
      })

      const result = await service.getDocumentAnalysis('job-xyz')

      expect(result.jobStatus).toBe('SUCCEEDED')
      expect(result.text).toBe('Some text')
      expect(result.queries).toEqual({ total: '$100' })
      expect(result.forms).toEqual({})
      expect(result.tables).toEqual([])
      expect(result.pages).toBe(2)
    })

    it('throws when jobId is missing', async () => {
      await expect(service.getDocumentAnalysis()).rejects.toThrow('jobId is required')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps InvalidS3ObjectException to descriptive message', async () => {
      const err = new Error('Bucket not found')

      err.name = 'InvalidS3ObjectException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectDocumentText(null, 'bad-bucket', 'key')).rejects.toThrow(
        'Unable to access the S3 object'
      )
    })

    it('maps UnsupportedDocumentException to descriptive message', async () => {
      const err = new Error('Format not supported')

      err.name = 'UnsupportedDocumentException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectDocumentText(null, 'bucket', 'key')).rejects.toThrow(
        'Unsupported document format'
      )
    })

    it('maps DocumentTooLargeException to descriptive message', async () => {
      const err = new Error('Too big')

      err.name = 'DocumentTooLargeException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectDocumentText(null, 'bucket', 'key')).rejects.toThrow(
        'Document too large'
      )
    })

    it('maps BadDocumentException to descriptive message', async () => {
      const err = new Error('Corrupt file')

      err.name = 'BadDocumentException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectDocumentText(null, 'bucket', 'key')).rejects.toThrow(
        'could not read the document'
      )
    })

    it('maps InvalidJobIdException to descriptive message', async () => {
      const err = new Error('Job not found')

      err.name = 'InvalidJobIdException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.getDocumentTextDetection('bad-id')).rejects.toThrow(
        'Invalid Job ID'
      )
    })

    it('maps InvalidParameterException to descriptive message', async () => {
      const err = new Error('Missing queries')

      err.name = 'InvalidParameterException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.analyzeDocument(['QUERIES'], null, 'bucket', 'key')).rejects.toThrow(
        'Invalid request'
      )
    })

    it('falls through to mapAwsError for unknown errors', async () => {
      const err = new Error('ThrottlingException: rate exceeded')

      err.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(err)

      await expect(service.detectDocumentText(null, 'bucket', 'key')).rejects.toThrow(
        'throttled'
      )
    })
  })

  // ── Edge cases for extraction helpers ──

  describe('extraction edge cases', () => {
    it('handles SELECTION_ELEMENT in collectChildText', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: 'k1',
            Relationships: [
              { Type: 'CHILD', Ids: ['sel1'] },
              { Type: 'VALUE', Ids: ['v1'] },
            ], 
          },
          {
            BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: 'v1',
            Relationships: [{ Type: 'CHILD', Ids: ['sel2'] }], 
          },
          { BlockType: 'SELECTION_ELEMENT', SelectionStatus: 'SELECTED', Id: 'sel1' },
          { BlockType: 'SELECTION_ELEMENT', SelectionStatus: 'NOT_SELECTED', Id: 'sel2' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['FORMS'], null, 'bucket', 'key')

      expect(result.forms).toEqual({ '[X]': '' })
    })

    it('handles QUERY without an ANSWER relationship', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          { BlockType: 'QUERY', Id: 'q1', Query: { Text: 'Unanswered?' } },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['QUERIES'], null, 'bucket', 'key')

      expect(result.queries).toEqual({ 'Unanswered?': null })
    })

    it('uses Query.Text as label when Alias is absent', async () => {
      jsonRequestMock.mockResolvedValue({
        Blocks: [
          {
            BlockType: 'QUERY', Id: 'q1', Query: { Text: 'What is the date?' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }], 
          },
          { BlockType: 'QUERY_RESULT', Id: 'qr1', Text: '2024-01-15' },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeDocument(['QUERIES'], null, 'bucket', 'key')

      expect(result.queries).toEqual({ 'What is the date?': '2024-01-15' })
    })

    it('handles expense with missing optional fields', async () => {
      jsonRequestMock.mockResolvedValue({
        ExpenseDocuments: [
          {
            SummaryFields: [
              { Type: null, LabelDetection: null, ValueDetection: null },
            ],
            LineItemGroups: [],
          },
        ],
        DocumentMetadata: { Pages: 1 },
      })

      const result = await service.analyzeExpense(null, 'bucket', 'key')

      expect(result.summaryFields).toEqual([
        { type: null, label: null, value: null, confidence: null },
      ])
    })

    it('handles identity document with missing Type.Text', async () => {
      jsonRequestMock.mockResolvedValue({
        IdentityDocuments: [
          {
            IdentityDocumentFields: [
              { Type: {}, ValueDetection: { Text: 'value', Confidence: 90 } },
            ],
          },
        ],
      })

      const result = await service.analyzeId(null, 'bucket', 'key')

      // Field with no key should be skipped
      expect(result.fields).toEqual({})
    })
  })

  // ── Error routing for the remaining operations ──

  describe('error routing', () => {
    it('routes every operation through the error mapper', async () => {
      const calls = [
        ['detectDocumentText', () => service.detectDocumentText(null, 'b', 'k')],
        ['analyzeDocument', () => service.analyzeDocument(['TABLES'], null, 'b', 'k')],
        ['analyzeExpense', () => service.analyzeExpense(null, 'b', 'k')],
        ['analyzeId', () => service.analyzeId(null, 'b', 'k')],
        ['startDocumentTextDetection', () => service.startDocumentTextDetection('b', 'k')],
        ['getDocumentTextDetection', () => service.getDocumentTextDetection('job-1')],
        ['startDocumentAnalysis', () => service.startDocumentAnalysis(['TABLES'], 'b', 'k')],
        ['getDocumentAnalysis', () => service.getDocumentAnalysis('job-1')],
      ]

      const logSpy = jest.spyOn(service.logger, 'error').mockImplementation(() => {})

      for (const [method, invoke] of calls) {
        const error = new Error('User is not authorized')

        error.name = 'AccessDeniedException'
        jsonRequestMock.mockReset()
        jsonRequestMock.mockRejectedValue(error)
        logSpy.mockClear()

        await expect(invoke()).rejects.toThrow('Access denied: User is not authorized')
        expect(logSpy).toHaveBeenCalledWith(`[${ method }]`, 'User is not authorized')
      }

      logSpy.mockRestore()
    })
  })

  // ── Document input handling ──

  describe('document input handling', () => {
    it('base64 encodes a non-Buffer download payload', async () => {
      mock.onGet('https://example.com/doc.png').reply('raw-document-bytes')
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.detectDocumentText('https://example.com/doc.png')

      expectSendJson('DetectDocumentText', {
        Document: { Bytes: Buffer.from('raw-document-bytes').toString('base64') },
      })
    })

    it('requires a document for every synchronous operation', async () => {
      await expect(service.analyzeDocument(['TABLES'])).rejects.toThrow(/Provide either a File URL/)
      await expect(service.analyzeExpense()).rejects.toThrow(/Provide either a File URL/)
      await expect(service.analyzeId()).rejects.toThrow(/Provide either a File URL/)
      expect(jsonRequestMock).not.toHaveBeenCalled()
    })
  })

  // ── Credential wiring ──

  describe('credential wiring', () => {
    it('resolves credentials before each request and forwards them', async () => {
      jsonRequestMock.mockResolvedValue({ Blocks: [], DocumentMetadata: { Pages: 1 } })

      await service.detectDocumentText(null, 'b', 'k')

      expect(jsonRequestMock.mock.calls[0][1]).toEqual({ accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY })
    })

    it('defaults the region and builds a credential provider', () => {
      const { Textract } = require('../src/index.js')
      const bare = new Textract()

      expect(bare.region).toBe('us-east-1')
      expect(bare.credentials).toBeInstanceOf(CredentialProvider)
      expect(bare.credentials.authenticationMethod).toBe('API Key')
      expect(typeof bare.deps.jsonRequest).toBe('function')
    })

    it('propagates credential resolution failures', async () => {
      const { Textract } = require('../src/index.js')
      const incomplete = new Textract({ region: 'eu-west-1', accessKeyId: 'AK' })

      await expect(incomplete.sendJson('DetectDocumentText', {})).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules: sigv4.js, aws-client.js, credentials.js, errors.js
//
// These modules are exercised directly — the service talks to them through
// `deps`, so the suites above never reach them.
// ─────────────────────────────────────────────────────────────────────────────

const CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' }

/** A fixed instant so every signature in these suites is reproducible. */
const FIXED_NOW = Date.UTC(2015, 7, 30, 12, 36, 0)
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

/**
 * An independent, from-the-spec SigV4 calculation used to verify the service's
 * own implementation. It follows the published AWS "Signature Version 4 signing
 * process" steps directly rather than mirroring `src/sigv4.js`, so agreement
 * between the two is meaningful.
 */
function referenceSignature({ method, url, signedHeaderValues, payload, credentials, region, service, amzDate }) {
  const parsed = new URL(url)
  const dateStamp = amzDate.slice(0, 8)

  const rfc3986 = value =>
    encodeURIComponent(value).replace(/[!'()*]/g, ch => `%${ ch.charCodeAt(0).toString(16).toUpperCase() }`)

  // Step 1 — canonical request.
  const canonicalUri = parsed.pathname
    .split('/')
    .map(segment => rfc3986(decodeURIComponent(segment)))
    .join('/') || '/'

  const canonicalQueryString = Array.from(parsed.searchParams.entries())
    .map(([key, value]) => [rfc3986(key), rfc3986(value)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([key, value]) => `${ key }=${ value }`)
    .join('&')

  const names = Object.keys(signedHeaderValues).map(name => name.toLowerCase()).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ String(signedHeaderValues[name]).trim() }\n`).join('')
  const signedHeaders = names.join(';')
  const payloadHash = crypto.createHash('sha256').update(payload || '').digest('hex')

  const canonicalRequest = [method, canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n')

  // Step 2 — string to sign.
  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  // Step 3 — signing key and signature.
  const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
  let key = hmac(`AWS4${ credentials.secretAccessKey }`, dateStamp)

  key = hmac(key, region)
  key = hmac(key, service)
  key = hmac(key, 'aws4_request')

  return { signature: hmac(key, stringToSign).toString('hex'), signedHeaders, scope, payloadHash }
}

describe('sigv4 signRequest', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('matches an independently calculated SigV4 signature', () => {
    const body = '{"CollectionId":"faces"}'
    const headers = { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' }

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, body, CREDENTIALS, 'us-east-1', 'svc')

    const expected = referenceSignature({
      method: 'POST',
      url: 'https://svc.us-east-1.amazonaws.com/',
      signedHeaderValues: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Svc.Op',
        'host': 'svc.us-east-1.amazonaws.com',
        'x-amz-date': FIXED_AMZ_DATE,
        'x-amz-content-sha256': crypto.createHash('sha256').update(body).digest('hex'),
      },
      payload: body,
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 'svc',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe('svc.us-east-1.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(expected.payloadHash)

    expect(headers['authorization']).toBe(
      `AWS4-HMAC-SHA256 Credential=${ CREDENTIALS.accessKeyId }/${ expected.scope }, ` +
      `SignedHeaders=${ expected.signedHeaders }, ` +
      `Signature=${ expected.signature }`
    )
  })

  it('matches the reference for temporary credentials, a path and a query string', () => {
    const credentials = { ...CREDENTIALS, sessionToken: 'SESSION-TOKEN' }
    const url = 'https://svc.eu-west-1.amazonaws.com/some/path.txt?b=2&a=1'
    const headers = {}

    signRequest('GET', url, headers, '', credentials, 'eu-west-1', 'svc')

    const expected = referenceSignature({
      method: 'GET',
      url,
      signedHeaderValues: {
        'host': 'svc.eu-west-1.amazonaws.com',
        'x-amz-date': FIXED_AMZ_DATE,
        'x-amz-content-sha256': crypto.createHash('sha256').update('').digest('hex'),
        'x-amz-security-token': 'SESSION-TOKEN',
      },
      payload: '',
      credentials,
      region: 'eu-west-1',
      service: 'svc',
      amzDate: FIXED_AMZ_DATE,
    })

    expect(headers['x-amz-security-token']).toBe('SESSION-TOKEN')

    expect(headers['authorization']).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toContain(`Signature=${ expected.signature }`)
  })

  it('uses the credential scope for the frozen date, region and service', () => {
    const headers = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(headers['authorization']).toContain(
      `Credential=${ CREDENTIALS.accessKeyId }/${ FIXED_DATE_STAMP }/us-east-1/svc/aws4_request`
    )
  })

  it('is stable for identical input and sensitive to payload, secret, region and service', () => {
    function sign(overrides = {}) {
      const headers = { 'content-type': 'application/x-amz-json-1.1' }

      signRequest(
        'POST',
        'https://svc.us-east-1.amazonaws.com/',
        headers,
        overrides.body !== undefined ? overrides.body : '{}',
        overrides.credentials || CREDENTIALS,
        overrides.region || 'us-east-1',
        overrides.service || 'svc'
      )

      return headers['authorization']
    }

    const baseline = sign()

    expect(sign()).toBe(baseline)
    expect(sign({ body: '{"a":1}' })).not.toBe(baseline)
    expect(sign({ credentials: { ...CREDENTIALS, secretAccessKey: 'other-secret' } })).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' })).not.toBe(baseline)
    expect(sign({ service: 'other' })).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is supplied', () => {
    const headers = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, undefined, CREDENTIALS, 'us-east-1', 'svc')

    expect(headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
  })

  it('keeps an explicit host header and adds the port for non-standard ports', () => {
    const explicit = { Host: 'custom.example.com' }

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', explicit, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    const ported = {}

    signRequest('POST', 'https://localhost:4566/', ported, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(ported['host']).toBe('localhost:4566')

    const standard = {}

    signRequest('POST', 'https://svc.us-east-1.amazonaws.com:443/', standard, '', CREDENTIALS, 'us-east-1', 'svc')

    expect(standard['host']).toBe('svc.us-east-1.amazonaws.com')
  })

  it('canonicalizes the path and sorts the query string', () => {
    const a = {}
    const b = {}

    signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?b=2&a=1', a, '', CREDENTIALS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.amazonaws.com/my bucket/a b.txt?a=1&b=2', b, '', CREDENTIALS, 'us-east-1', 's3')

    // Query ordering must not change the signature.
    expect(a['authorization']).toBe(b['authorization'])
    expect(a['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('sorts repeated query keys by value and encodes multi-byte characters', () => {
    const repeated = {}
    const unicode = {}

    signRequest('GET', 'https://s3.amazonaws.com/b?a=2&a=1&a=1', repeated, '', CREDENTIALS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.amazonaws.com/b/ü.txt', unicode, '', CREDENTIALS, 'us-east-1', 's3')

    expect(repeated['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
    expect(unicode['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('returns the same headers object it mutates', () => {
    const headers = {}

    expect(
      signRequest('POST', 'https://svc.us-east-1.amazonaws.com/', headers, '', CREDENTIALS, 'us-east-1', 'svc')
    ).toBe(headers)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('adds every SigV4 query parameter and matches an independent signature', () => {
    const presigned = generatePresignedUrl(
      'GET',
      'https://bucket.s3.us-east-1.amazonaws.com/key.txt',
      CREDENTIALS,
      'us-east-1',
      's3',
      900
    )

    const url = new URL(presigned)

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')

    expect(url.searchParams.get('X-Amz-Credential')).toBe(
      `${ CREDENTIALS.accessKeyId }/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`
    )

    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

    // Recompute the query-string signature independently, from the spec.
    const unsigned = new URL(presigned)

    unsigned.searchParams.delete('X-Amz-Signature')

    const canonicalQueryString = Array.from(unsigned.searchParams.entries())
      .map(([key, value]) => [encodeURIComponent(key), encodeURIComponent(value)])
      .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
      .map(([key, value]) => `${ key }=${ value }`)
      .join('&')

    const canonicalRequest = [
      'GET',
      '/key.txt',
      canonicalQueryString,
      'host:bucket.s3.us-east-1.amazonaws.com\n',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      FIXED_AMZ_DATE,
      `${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')

    const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest()
    let key = hmac(`AWS4${ CREDENTIALS.secretAccessKey }`, FIXED_DATE_STAMP)

    key = hmac(key, 'us-east-1')
    key = hmac(key, 's3')
    key = hmac(key, 'aws4_request')

    expect(url.searchParams.get('X-Amz-Signature')).toBe(hmac(key, stringToSign).toString('hex'))
  })

  it('includes the session token and reacts to the expiry window and the port', () => {
    const withToken = generatePresignedUrl(
      'PUT',
      'https://localhost:4566/bucket/key.txt',
      { ...CREDENTIALS, sessionToken: 'SESSION-TOKEN' },
      'us-east-1',
      's3',
      60
    )

    expect(new URL(withToken).searchParams.get('X-Amz-Security-Token')).toBe('SESSION-TOKEN')
    expect(new URL(withToken).searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)

    const short = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 60)
    const long = generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 3600)

    expect(short).toBe(generatePresignedUrl('GET', 'https://s3.amazonaws.com/b/k', CREDENTIALS, 'us-east-1', 's3', 60))

    expect(new URL(short).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(long).searchParams.get('X-Amz-Signature')
    )
  })
})

// ── aws-client.js: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag', () => {
    expect(parseXmlTag('<r><Code>Throttling</Code><Code>Other</Code></r>', 'Code')).toBe('Throttling')
  })

  it('returns null when the tag is absent', () => {
    expect(parseXmlTag('<r/>', 'Code')).toBeNull()
  })

  it('extracts every matching tag including multi-line values', () => {
    expect(parseXmlTags('<r><m>one</m><m>two\nlines</m></r>', 'm')).toEqual(['one', 'two\nlines'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parseXmlTags('<r/>', 'm')).toEqual([])
  })
})

// ── aws-client.js: request building and response parsing ──

describe('buildAwsJsonRequest', () => {
  it('builds the regional endpoint, target header and serialized body', () => {
    expect(buildAwsJsonRequest({
      region: 'eu-west-1',
      service: 'svc',
      target: 'Svc.Operation',
      body: { A: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://svc.eu-west-1.amazonaws.com/',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Operation' },
      body: '{"A":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'svc',
      body: '{"a":1}',
      contentType: 'application/json',
    })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'svc', contentType: 'application/json' }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns an empty object for an empty or a missing body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '   ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error derived from the __type field', () => {
    expect.assertions(3)

    try {
      parseJsonResponse({
        statusCode: 400,
        body: '{"__type":"com.amazonaws.service#InvalidParameterException","message":"bad input"}',
      })
    } catch (error) {
      expect(error.name).toBe('InvalidParameterException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDeniedException","Message":"nope"}' })
    } catch (error) {
      expect(error.name).toBe('AccessDeniedException')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest with an injected transport', () => {
  it('signs the built request and parses the response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Items":[]}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: { A: 1 }, contentType: 'application/x-amz-json-1.1' },
      CREDENTIALS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ Items: [] })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://svc.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
      '{"A":1}',
      CREDENTIALS,
      'us-east-1',
      'svc'
    )

    expect(send).toHaveBeenCalledWith(
      'POST',
      'https://svc.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Svc.Op' },
      '{"A":1}'
    )
  })

  it('propagates an AWS error status as a named error', async () => {
    const send = jest.fn().mockResolvedValue({
      statusCode: 400,
      body: '{"__type":"#ValidationException","message":"bad"}',
    })

    await expect(
      jsonRequest(
        { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: {}, contentType: 'application/x-amz-json-1.1' },
        CREDENTIALS,
        { signRequest: jest.fn(), httpRequest: send }
      )
    ).rejects.toMatchObject({ name: 'ValidationException', message: 'bad', statusCode: 400 })
  })

  it('signs with the real signer when no transport override is given', async () => {
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' })

    await jsonRequest(
      { region: 'us-east-1', service: 'svc', target: 'Svc.Op', body: {}, contentType: 'application/x-amz-json-1.1' },
      CREDENTIALS,
      { httpRequest: send }
    )

    expect(send.mock.calls[0][2]['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
  })
})

// ── aws-client.js: low level HTTP transport ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const response = await httpRequest(
      'POST',
      'https://svc.us-east-1.amazonaws.com/?a=1',
      { 'content-type': 'application/x-amz-json-1.1' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'svc.us-east-1.amazonaws.com',
      port: 443,
      path: '/?a=1',
      method: 'POST',
      headers: { 'content-type': 'application/x-amz-json-1.1', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('registers a 30s timeout that destroys the request', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})

    expect(captured.request.setTimeout).toHaveBeenCalledWith(30000, expect.any(Function))

    captured.request.setTimeout.mock.calls[0][1]()

    expect(captured.request.destroy).toHaveBeenCalledWith(expect.objectContaining({ message: 'Request timed out' }))
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    stubHttps({ responseError: new Error('stream aborted') })

    await expect(httpRequest('GET', 'https://svc.us-east-1.amazonaws.com/', {})).rejects.toThrow('stream aborted')
  })
})

// ── aws-client.js: STS AssumeRole ──

describe('stsAssumeRole', () => {
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

  it('posts a signed AssumeRole form and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(CREDENTIALS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')
    expect(captured.options.headers['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//)
    expect(captured.options.headers['authorization']).toContain('/sts/aws4_request')

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

  it('omits the external id when it is not supplied', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body carries no Code or Message', async () => {
    stubHttps({ statusCode: 500, body: '' })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>A</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSParseError',
    })
  })

  it('rejects when the socket errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(CREDENTIALS, 'us-east-1', 'arn:role', 'session')).rejects.toThrow('socket hang up')
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('applies the documented defaults', () => {
    const provider = new CredentialProvider()

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')
    expect(typeof provider._stsAssumeRole).toBe('function')
    expect(typeof provider._now()).toBe('number')
  })

  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes inside the expiry buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockImplementation(async () => ({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    }))

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
      `flowrunner-dynamodb-${ now }`,
      'ext'
    )

    // Well inside the validity window — served from the cache.
    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Within the 5 minute refresh buffer before expiry — assumed again.
    now += 3400000

    await provider.resolve()

    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for IAM Role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })
})

// ── errors.js ──

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

  it('handles an error without a name or a message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('Example')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[Example Service]', 'info:', 'a'],
      ['[Example Service]', 'debug:', 'b'],
      ['[Example Service]', 'warn:', 'c'],
      ['[Example Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

// ── config-items.js ──

describe('awsConfigItems', () => {
  it('declares the six AWS credential items in order and never shares them', () => {
    expect(awsConfigItems.map(item => item.name)).toEqual([
      'authenticationMethod', 'region', 'accessKeyId', 'secretAccessKey', 'roleArn', 'externalId',
    ])

    expect(awsConfigItems.every(item => item.shared === false)).toBe(true)
    expect(awsConfigItems.every(item => typeof item.hint === 'string')).toBe(true)

    expect(awsConfigItems[0]).toMatchObject({
      type: 'CHOICE',
      required: true,
      defaultValue: 'API Key',
      options: ['API Key', 'IAM Role'],
    })

    expect(awsConfigItems[1]).toMatchObject({ type: 'STRING', required: true, defaultValue: 'us-east-1' })
    expect(awsConfigItems.some(item => Object.prototype.hasOwnProperty.call(item, 'order'))).toBe(false)
  })
})
