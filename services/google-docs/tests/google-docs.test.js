'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'
const DOCS_API_BASE = 'https://docs.googleapis.com/v1'
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const DOC_ID = '1x2y3z4a5b6c7d8e9f0g'

describe('Google Docs Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }

    // Mock the flowrunner.Files API
    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.pro/exported.pdf' })
    service.flowrunner = {
      Files: {
        uploadFile: uploadFileMock,
      },
    }
  })

  afterEach(() => {
    mock.reset()
    uploadFileMock.mockClear()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'clientId',
          required: true,
          shared: true,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'clientSecret',
          required: true,
          shared: true,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a connection URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${ encodeURIComponent(CLIENT_ID) }`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/documents'))
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/drive'))
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user info', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: {
          name: 'Test User',
          email: 'test@example.com',
          picture: 'https://example.com/photo.jpg',
        },
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      const body = mock.history[0].body
      expect(body).toContain(`client_id=${ CLIENT_ID }`)
      expect(body).toContain('code=auth-code-123')
      expect(body).toContain(`client_secret=${ CLIENT_SECRET }`)
      expect(body).toContain('grant_type=authorization_code')
    })

    it('uses email as identity name when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'test@example.com',
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x' })

      expect(result.connectionIdentityName).toBe('test@example.com')
      expect(result.connectionIdentityImageURL).toBeNull()
    })

    it('falls back to default identity when user info call fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'tok',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Unauthorized' })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://x' })

      expect(result.connectionIdentityName).toBe('Google Docs Account')
      expect(result.connectionIdentityImageURL).toBeNull()
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: 'old-refresh-token',
      })
    })

    it('throws a re-authenticate error on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Bad Request',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('re-throws other errors as-is', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow('Server Error')
    })
  })

  // ── Dictionary ──

  describe('getDocumentsDictionary', () => {
    it('lists documents with default parameters', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({
        nextPageToken: 'next-page',
        files: [
          { id: 'doc1', name: 'My Doc', modifiedTime: '2025-01-15T14:30:00.000Z' },
        ],
      })

      const result = await service.getDocumentsDictionary({})

      expect(result).toEqual({
        cursor: 'next-page',
        items: [
          { label: 'My Doc', value: 'doc1', note: 'Modified 2025-01-15T14:30:00.000Z' },
        ],
      })

      expect(mock.history[0].query).toMatchObject({
        q: "mimeType='application/vnd.google-apps.document' and trashed=false",
        pageSize: 100,
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
    })

    it('applies search filter', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({ files: [] })

      await service.getDocumentsDictionary({ search: 'Marketing' })

      expect(mock.history[0].query.q).toContain("name contains 'Marketing'")
    })

    it('escapes special characters in search', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({ files: [] })

      await service.getDocumentsDictionary({ search: "O'Brien" })

      expect(mock.history[0].query.q).toContain("name contains 'O\\'Brien'")
    })

    it('passes cursor as pageToken', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({ files: [] })

      await service.getDocumentsDictionary({ cursor: 'page-token-2' })

      expect(mock.history[0].query.pageToken).toBe('page-token-2')
    })

    it('handles empty file list', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({})

      const result = await service.getDocumentsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('handles null payload', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files`).reply({ files: [] })

      const result = await service.getDocumentsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  // ── Documents ──

  describe('createDocument', () => {
    it('creates a document without initial text', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents`).reply({
        documentId: DOC_ID,
        title: 'New Doc',
        revisionId: 'rev-1',
      })

      const result = await service.createDocument('New Doc')

      expect(result).toEqual({
        documentId: DOC_ID,
        title: 'New Doc',
        revisionId: 'rev-1',
        documentUrl: `https://docs.google.com/document/d/${ DOC_ID }/edit`,
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].body).toEqual({ title: 'New Doc' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ OAUTH_TOKEN }`,
      })
    })

    it('creates a document with initial text', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents`).reply({
        documentId: DOC_ID,
        title: 'New Doc',
        revisionId: 'rev-1',
      })

      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        writeControl: { requiredRevisionId: 'rev-2' },
      })

      const result = await service.createDocument('New Doc', 'Hello World')

      expect(result.revisionId).toBe('rev-2')
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].body).toEqual({
        requests: [
          { insertText: { endOfSegmentLocation: {}, text: 'Hello World' } },
        ],
      })
    })

    it('throws when title is missing', async () => {
      await expect(service.createDocument('')).rejects.toThrow('"Title" is required')
    })
  })

  describe('getDocument', () => {
    it('retrieves a document by ID and extracts text', async () => {
      mock.onGet(`${ DOCS_API_BASE }/documents/${ DOC_ID }`).reply({
        documentId: DOC_ID,
        title: 'My Doc',
        revisionId: 'rev-1',
        body: {
          content: [
            {
              paragraph: {
                elements: [{ textRun: { content: 'Hello ' } }, { textRun: { content: 'World' } }],
              },
            },
          ],
        },
      })

      const result = await service.getDocument(DOC_ID)

      expect(result.documentId).toBe(DOC_ID)
      expect(result.text).toBe('Hello World')
      expect(result.documentUrl).toBe(`https://docs.google.com/document/d/${ DOC_ID }/edit`)
    })

    it('normalizes a full Google Docs URL to document ID', async () => {
      mock.onGet(`${ DOCS_API_BASE }/documents/${ DOC_ID }`).reply({
        documentId: DOC_ID,
        title: 'My Doc',
        body: { content: [] },
      })

      await service.getDocument(`https://docs.google.com/document/d/${ DOC_ID }/edit`)

      expect(mock.history[0].url).toBe(`${ DOCS_API_BASE }/documents/${ DOC_ID }`)
    })

    it('extracts text from tables', async () => {
      mock.onGet(`${ DOCS_API_BASE }/documents/${ DOC_ID }`).reply({
        documentId: DOC_ID,
        title: 'Table Doc',
        body: {
          content: [
            {
              table: {
                tableRows: [
                  {
                    tableCells: [
                      {
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Cell1' } }] } },
                        ],
                      },
                      {
                        content: [
                          { paragraph: { elements: [{ textRun: { content: 'Cell2' } }] } },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      })

      const result = await service.getDocument(DOC_ID)

      expect(result.text).toBe('Cell1Cell2')
    })

    it('extracts text from table of contents', async () => {
      mock.onGet(`${ DOCS_API_BASE }/documents/${ DOC_ID }`).reply({
        documentId: DOC_ID,
        title: 'TOC Doc',
        body: {
          content: [
            {
              tableOfContents: {
                content: [
                  { paragraph: { elements: [{ textRun: { content: 'Chapter 1\n' } }] } },
                ],
              },
            },
          ],
        },
      })

      const result = await service.getDocument(DOC_ID)

      expect(result.text).toBe('Chapter 1\n')
    })

    it('throws when documentId is missing', async () => {
      await expect(service.getDocument('')).rejects.toThrow('"Document" is required')
    })

    it('throws on API error', async () => {
      mock.onGet(`${ DOCS_API_BASE }/documents/${ DOC_ID }`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Document not found' } },
      })

      await expect(service.getDocument(DOC_ID)).rejects.toThrow('Google Docs API error: Document not found')
    })
  })

  describe('deleteDocument', () => {
    it('deletes a document by ID', async () => {
      mock.onDelete(`${ DRIVE_API_BASE }/files/${ DOC_ID }`).reply({})

      const result = await service.deleteDocument(DOC_ID)

      expect(result).toEqual({
        success: true,
        message: 'Document deleted successfully',
        documentId: DOC_ID,
      })

      expect(mock.history[0].query).toMatchObject({ supportsAllDrives: true })
    })

    it('normalizes a URL before deleting', async () => {
      mock.onDelete(`${ DRIVE_API_BASE }/files/${ DOC_ID }`).reply({})

      await service.deleteDocument(`https://docs.google.com/document/d/${ DOC_ID }/edit`)

      expect(mock.history[0].url).toBe(`${ DRIVE_API_BASE }/files/${ DOC_ID }`)
    })

    it('throws when documentId is missing', async () => {
      await expect(service.deleteDocument(null)).rejects.toThrow('"Document" is required')
    })
  })

  // ── Text Editing ──

  describe('appendText', () => {
    it('appends text to the end of a document', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{}],
        writeControl: { requiredRevisionId: 'rev-3' },
      })

      const result = await service.appendText(DOC_ID, '\nNew paragraph')

      expect(result.writeControl).toEqual({ requiredRevisionId: 'rev-3' })
      expect(result.documentUrl).toBe(`https://docs.google.com/document/d/${ DOC_ID }/edit`)

      expect(mock.history[0].body).toEqual({
        requests: [
          { insertText: { endOfSegmentLocation: {}, text: '\nNew paragraph' } },
        ],
      })
    })

    it('throws when text is missing', async () => {
      await expect(service.appendText(DOC_ID, '')).rejects.toThrow('"Text" is required')
    })
  })

  describe('insertText', () => {
    it('inserts text at a specific index', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{}],
        writeControl: { requiredRevisionId: 'rev-4' },
      })

      const result = await service.insertText(DOC_ID, 'Inserted!', 5)

      expect(result.documentUrl).toContain(DOC_ID)

      expect(mock.history[0].body).toEqual({
        requests: [
          { insertText: { location: { index: 5 }, text: 'Inserted!' } },
        ],
      })
    })

    it('throws when text is missing', async () => {
      await expect(service.insertText(DOC_ID, '', 1)).rejects.toThrow('"Text" is required')
    })

    it('throws when index is less than 1', async () => {
      await expect(service.insertText(DOC_ID, 'text', 0))
        .rejects.toThrow('"Index" must be an integer greater than or equal to 1')
    })

    it('throws when index is not an integer', async () => {
      await expect(service.insertText(DOC_ID, 'text', 1.5))
        .rejects.toThrow('"Index" must be an integer greater than or equal to 1')
    })

    it('throws when index is NaN', async () => {
      await expect(service.insertText(DOC_ID, 'text', 'abc'))
        .rejects.toThrow('"Index" must be an integer greater than or equal to 1')
    })
  })

  describe('replaceAllText', () => {
    it('replaces all occurrences with case-sensitive matching by default', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 3 } }],
        writeControl: { requiredRevisionId: 'rev-5' },
      })

      const result = await service.replaceAllText(DOC_ID, 'old', 'new')

      expect(result).toEqual({
        documentId: DOC_ID,
        occurrencesChanged: 3,
        writeControl: { requiredRevisionId: 'rev-5' },
        documentUrl: `https://docs.google.com/document/d/${ DOC_ID }/edit`,
      })

      expect(mock.history[0].body).toEqual({
        requests: [
          {
            replaceAllText: {
              containsText: { text: 'old', matchCase: true },
              replaceText: 'new',
            },
          },
        ],
      })
    })

    it('uses case-insensitive matching when matchCase is false', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 1 } }],
        writeControl: {},
      })

      await service.replaceAllText(DOC_ID, 'old', 'new', false)

      expect(mock.history[0].body.requests[0].replaceAllText.containsText.matchCase).toBe(false)
    })

    it('uses empty string when replaceText is not provided', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 2 } }],
        writeControl: {},
      })

      await service.replaceAllText(DOC_ID, 'delete-me')

      expect(mock.history[0].body.requests[0].replaceAllText.replaceText).toBe('')
    })

    it('returns 0 occurrencesChanged when replies are empty', async () => {
      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{}],
        writeControl: {},
      })

      const result = await service.replaceAllText(DOC_ID, 'nonexistent', 'x')

      expect(result.occurrencesChanged).toBe(0)
    })

    it('throws when findText is missing', async () => {
      await expect(service.replaceAllText(DOC_ID, '')).rejects.toThrow('"Find Text" is required')
    })
  })

  describe('batchUpdate', () => {
    it('sends raw batch update requests', async () => {
      const requests = [
        { insertText: { location: { index: 1 }, text: 'Hello' } },
        { updateTextStyle: { range: { startIndex: 1, endIndex: 6 }, textStyle: { bold: true }, fields: 'bold' } },
      ]

      mock.onPost(`${ DOCS_API_BASE }/documents/${ DOC_ID }:batchUpdate`).reply({
        replies: [{}, {}],
        writeControl: { requiredRevisionId: 'rev-6' },
      })

      const result = await service.batchUpdate(DOC_ID, requests)

      expect(result.replies).toHaveLength(2)
      expect(result.documentUrl).toContain(DOC_ID)

      expect(mock.history[0].body).toEqual({ requests })
    })

    it('throws when requests is not an array', async () => {
      await expect(service.batchUpdate(DOC_ID, 'not-array'))
        .rejects.toThrow('"Requests" must be a non-empty array')
    })

    it('throws when requests is an empty array', async () => {
      await expect(service.batchUpdate(DOC_ID, []))
        .rejects.toThrow('"Requests" must be a non-empty array')
    })
  })

  // ── Templates ──

  describe('createFromTemplate', () => {
    it('copies a template and applies replacements', async () => {
      mock.onPost(`${ DRIVE_API_BASE }/files/${ DOC_ID }/copy`).reply({
        id: 'new-doc-id',
        name: 'Invoice INV-42',
      })

      mock.onPost(`${ DOCS_API_BASE }/documents/new-doc-id:batchUpdate`).reply({
        replies: [
          { replaceAllText: { occurrencesChanged: 2 } },
          { replaceAllText: { occurrencesChanged: 1 } },
        ],
      })

      const result = await service.createFromTemplate(DOC_ID, 'Invoice INV-42', {
        name: 'Acme Corp',
        date: '2025-01-15',
      })

      expect(result).toEqual({
        documentId: 'new-doc-id',
        name: 'Invoice INV-42',
        documentUrl: 'https://docs.google.com/document/d/new-doc-id/edit',
        replacements: [
          { placeholder: '{{name}}', occurrencesChanged: 2 },
          { placeholder: '{{date}}', occurrencesChanged: 1 },
        ],
      })

      // Verify copy request
      expect(mock.history[0].url).toBe(`${ DRIVE_API_BASE }/files/${ DOC_ID }/copy`)
      expect(mock.history[0].body).toEqual({ name: 'Invoice INV-42' })
      expect(mock.history[0].query).toMatchObject({ supportsAllDrives: true })

      // Verify batch update with replacements
      const batchBody = mock.history[1].body
      expect(batchBody.requests).toHaveLength(2)
      expect(batchBody.requests[0].replaceAllText.containsText.text).toBe('{{name}}')
      expect(batchBody.requests[0].replaceAllText.replaceText).toBe('Acme Corp')
      expect(batchBody.requests[1].replaceAllText.containsText.text).toBe('{{date}}')
    })

    it('preserves already-wrapped placeholder keys', async () => {
      mock.onPost(`${ DRIVE_API_BASE }/files/${ DOC_ID }/copy`).reply({
        id: 'new-doc-id',
        name: 'Doc',
      })

      mock.onPost(`${ DOCS_API_BASE }/documents/new-doc-id:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 1 } }],
      })

      await service.createFromTemplate(DOC_ID, 'Doc', {
        '{{already_wrapped}}': 'value',
      })

      const batchBody = mock.history[1].body
      expect(batchBody.requests[0].replaceAllText.containsText.text).toBe('{{already_wrapped}}')
    })

    it('replaces null values with empty strings', async () => {
      mock.onPost(`${ DRIVE_API_BASE }/files/${ DOC_ID }/copy`).reply({
        id: 'new-doc-id',
        name: 'Doc',
      })

      mock.onPost(`${ DOCS_API_BASE }/documents/new-doc-id:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 0 } }],
      })

      await service.createFromTemplate(DOC_ID, 'Doc', { key: null })

      const batchBody = mock.history[1].body
      expect(batchBody.requests[0].replaceAllText.replaceText).toBe('')
    })

    it('creates without replacements when none provided', async () => {
      mock.onPost(`${ DRIVE_API_BASE }/files/${ DOC_ID }/copy`).reply({
        id: 'new-doc-id',
        name: 'Copy',
      })

      const result = await service.createFromTemplate(DOC_ID, 'Copy')

      expect(result.replacements).toEqual([])
      expect(mock.history).toHaveLength(1) // Only the copy request, no batch update
    })

    it('throws when name is missing', async () => {
      await expect(service.createFromTemplate(DOC_ID, ''))
        .rejects.toThrow('"New Document Name" is required')
    })
  })

  // ── Export ──

  describe('exportDocument', () => {
    it('exports a document as PDF and uploads to file storage', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-content')

      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(pdfBuffer)

      const result = await service.exportDocument(DOC_ID, 'PDF', 'report.pdf')

      expect(result).toEqual({
        url: 'https://files.flowrunner.pro/exported.pdf',
        fileName: 'report.pdf',
        format: 'PDF',
        mimeType: 'application/pdf',
        size: pdfBuffer.length,
      })

      // Verify binary request
      expect(mock.history[0].query).toMatchObject({ mimeType: 'application/pdf' })
      expect(mock.history[0].encoding).toBeNull()

      // Verify file upload
      expect(uploadFileMock).toHaveBeenCalledWith(expect.any(Buffer), {
        filename: 'report.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })
    })

    it('uses default format PDF when format is not specified', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(Buffer.from('pdf'))

      await service.exportDocument(DOC_ID)

      expect(mock.history[0].query).toMatchObject({ mimeType: 'application/pdf' })
    })

    it('appends extension if not present in fileName', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(Buffer.from('text'))

      await service.exportDocument(DOC_ID, 'Plain Text', 'myfile')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'myfile.txt' }),
      )
    })

    it('does not double-add extension', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(Buffer.from('docx'))

      await service.exportDocument(DOC_ID, 'Word (DOCX)', 'report.docx')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: 'report.docx' }),
      )
    })

    it('generates default fileName when not provided', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(Buffer.from('html'))

      jest.spyOn(Date, 'now').mockReturnValue(1700000000000)

      await service.exportDocument(DOC_ID, 'HTML')

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ filename: `document_${ DOC_ID }_1700000000000.html` }),
      )

      Date.now.mockRestore()
    })

    it('passes fileOptions to uploadFile when provided', async () => {
      mock.onGet(`${ DRIVE_API_BASE }/files/${ DOC_ID }/export`).reply(Buffer.from('pdf'))

      await service.exportDocument(DOC_ID, 'PDF', 'report.pdf', { scope: 'GLOBAL' })

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({ scope: 'GLOBAL' }),
      )
    })

    it('throws on invalid format', async () => {
      await expect(service.exportDocument(DOC_ID, 'JPEG'))
        .rejects.toThrow('"Format" must be one of: PDF, Plain Text, Word (DOCX), HTML')
    })
  })
})
