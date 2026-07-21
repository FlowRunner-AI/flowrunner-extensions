'use strict'

const { createSandbox } = require('../../../service-sandbox')

const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const REGION = 'us-east-1'

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
          { BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: 'k1',
            Relationships: [
              { Type: 'CHILD', Ids: ['w1'] },
              { Type: 'VALUE', Ids: ['v1'] },
            ] },
          { BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: 'v1',
            Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
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
          { BlockType: 'QUERY', Id: 'q1', Query: { Text: 'What is the total?', Alias: 'total' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }] },
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
          { BlockType: 'TABLE', Id: 't1',
            Relationships: [{ Type: 'CHILD', Ids: ['c1', 'c2'] }] },
          { BlockType: 'CELL', Id: 'c1', RowIndex: 1, ColumnIndex: 1,
            Relationships: [{ Type: 'CHILD', Ids: ['w1'] }] },
          { BlockType: 'CELL', Id: 'c2', RowIndex: 1, ColumnIndex: 2,
            Relationships: [{ Type: 'CHILD', Ids: ['w2'] }] },
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
          { BlockType: 'QUERY', Id: 'q1', Query: { Text: 'Total?', Alias: 'total' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }] },
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
          { BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Id: 'k1',
            Relationships: [
              { Type: 'CHILD', Ids: ['sel1'] },
              { Type: 'VALUE', Ids: ['v1'] },
            ] },
          { BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Id: 'v1',
            Relationships: [{ Type: 'CHILD', Ids: ['sel2'] }] },
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
          { BlockType: 'QUERY', Id: 'q1', Query: { Text: 'What is the date?' },
            Relationships: [{ Type: 'ANSWER', Ids: ['qr1'] }] },
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
})
