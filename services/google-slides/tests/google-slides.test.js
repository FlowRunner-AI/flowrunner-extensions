'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const OAUTH_TOKEN = 'test-oauth-access-token'

const SLIDES_BASE = 'https://slides.googleapis.com/v1'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const USER_INFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const PRESENTATION_ID = 'abc123-presentation-id'
const PAGE_OBJECT_ID = 'slide-page-1'

describe('Google Slides Service', () => {
  let sandbox
  let service
  let mock
  let uploadFileMock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = { headers: { 'oauth-access-token': OAUTH_TOKEN } }

    uploadFileMock = jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.pro/test-file.png' })
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
    it('returns a correctly formed OAuth URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(OAUTH_URL)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
      expect(url).toContain('presentations')
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
        redirectURI: 'https://flowrunner.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
        overwrite: true,
        userData: expect.objectContaining({ name: 'Test User', email: 'test@example.com' }),
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(TOKEN_URL)
    })

    it('falls back to email-only identity when name is missing', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).reply({
        email: 'only@email.com',
      })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://example.com' })

      expect(result.connectionIdentityName).toBe('only@email.com')
    })

    it('uses default identity name when user info fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'token',
        expires_in: 3600,
      })

      mock.onGet(USER_INFO_URL).replyWithError({ message: 'Network error' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://example.com' })

      expect(result.connectionIdentityName).toBe('Google Slides Account')
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

    it('throws a specific message on invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Token expired',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token'))
        .rejects.toThrow('Refresh token expired or invalid, please re-authenticate.')
    })

    it('rethrows other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server error',
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Dictionaries ──

  describe('getPresentationsDictionary', () => {
    it('lists presentations with default parameters', async () => {
      mock.onGet(`${DRIVE_BASE}/files`).reply({
        nextPageToken: 'page2token',
        files: [
          { id: 'pres-1', name: 'My Deck', modifiedTime: '2025-06-01T10:00:00.000Z' },
        ],
      })

      const result = await service.getPresentationsDictionary({})

      expect(result.cursor).toBe('page2token')
      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'My Deck',
        value: 'pres-1',
        note: 'Modified 2025-06-01T10:00:00.000Z',
      })

      expect(mock.history[0].query).toMatchObject({
        orderBy: 'modifiedTime desc',
        pageSize: 50,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      })
      expect(mock.history[0].query.q).toContain("mimeType='application/vnd.google-apps.presentation'")
      expect(mock.history[0].query.q).toContain('trashed=false')
    })

    it('includes search text in the Drive query', async () => {
      mock.onGet(`${DRIVE_BASE}/files`).reply({ files: [] })

      await service.getPresentationsDictionary({ search: 'Budget' })

      expect(mock.history[0].query.q).toContain("name contains 'Budget'")
    })

    it('passes cursor as pageToken', async () => {
      mock.onGet(`${DRIVE_BASE}/files`).reply({ files: [] })

      await service.getPresentationsDictionary({ cursor: 'nextToken123' })

      expect(mock.history[0].query.pageToken).toBe('nextToken123')
    })

    it('returns empty items when files is missing', async () => {
      mock.onGet(`${DRIVE_BASE}/files`).reply({})

      const result = await service.getPresentationsDictionary({})

      expect(result.items).toEqual([])
    })
  })

  describe('getSlidesDictionary', () => {
    it('returns empty items when no presentationId is provided', async () => {
      const result = await service.getSlidesDictionary({})

      expect(result).toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('lists slides with titles from the presentation', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}`).reply({
        slides: [
          {
            objectId: 'slide-1',
            pageElements: [
              {
                shape: {
                  placeholder: { type: 'TITLE' },
                  text: { textElements: [{ textRun: { content: 'Overview' } }] },
                },
              },
            ],
          },
          {
            objectId: 'slide-2',
            pageElements: [],
          },
        ],
      })

      const result = await service.getSlidesDictionary({
        criteria: { presentationId: PRESENTATION_ID },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Slide 1 — Overview',
        value: 'slide-1',
        note: 'Index 0',
      })
      expect(result.items[1]).toEqual({
        label: 'Slide 2',
        value: 'slide-2',
        note: 'Index 1',
      })
    })

    it('filters slides by search text', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}`).reply({
        slides: [
          {
            objectId: 'slide-a',
            pageElements: [
              {
                shape: {
                  placeholder: { type: 'TITLE' },
                  text: { textElements: [{ textRun: { content: 'Revenue' } }] },
                },
              },
            ],
          },
          {
            objectId: 'slide-b',
            pageElements: [
              {
                shape: {
                  placeholder: { type: 'CENTERED_TITLE' },
                  text: { textElements: [{ textRun: { content: 'Expenses' } }] },
                },
              },
            ],
          },
        ],
      })

      const result = await service.getSlidesDictionary({
        search: 'Revenue',
        criteria: { presentationId: PRESENTATION_ID },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toContain('Revenue')
    })
  })

  // ── Presentations ──

  describe('createPresentation', () => {
    it('creates a presentation and returns summary', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations`).reply({
        presentationId: 'new-pres-id',
        title: 'My Presentation',
        slides: [{ objectId: 'p' }],
      })

      const result = await service.createPresentation('My Presentation')

      expect(result).toEqual({
        presentationId: 'new-pres-id',
        title: 'My Presentation',
        slideCount: 1,
        firstSlideObjectId: 'p',
        url: 'https://docs.google.com/presentation/d/new-pres-id/edit',
      })

      expect(mock.history[0].body).toEqual({ title: 'My Presentation' })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${OAUTH_TOKEN}`,
      })
    })

    it('throws when title is not provided', async () => {
      await expect(service.createPresentation('')).rejects.toThrow('"Title" is required')
    })
  })

  describe('getPresentation', () => {
    it('retrieves presentation summary without full details', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}`).reply({
        presentationId: PRESENTATION_ID,
        title: 'Test Deck',
        revisionId: 'rev-1',
        pageSize: { width: { magnitude: 9144000, unit: 'EMU' } },
        slides: [
          { objectId: 'p', pageElements: [] },
          { objectId: 'g1', pageElements: [] },
        ],
      })

      const result = await service.getPresentation(PRESENTATION_ID, false)

      expect(result.presentationId).toBe(PRESENTATION_ID)
      expect(result.slideCount).toBe(2)
      expect(result.slides).toHaveLength(2)
      expect(result).not.toHaveProperty('presentation')
      expect(result.url).toBe(`https://docs.google.com/presentation/d/${PRESENTATION_ID}/edit`)
    })

    it('includes full details when requested', async () => {
      const fullPresentation = {
        presentationId: PRESENTATION_ID,
        title: 'Full Deck',
        revisionId: 'rev-2',
        pageSize: {},
        slides: [{ objectId: 'p', pageElements: [] }],
        layouts: [],
        masters: [],
      }

      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}`).reply(fullPresentation)

      const result = await service.getPresentation(PRESENTATION_ID, true)

      expect(result).toHaveProperty('presentation')
      expect(result.presentation).toEqual(fullPresentation)
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.getPresentation('')).rejects.toThrow('"Presentation" is required')
    })
  })

  describe('createFromTemplate', () => {
    const templateId = 'template-pres-id'

    it('copies template and replaces placeholders', async () => {
      mock.onPost(`${DRIVE_BASE}/files/${templateId}/copy`).reply({
        id: 'copied-pres-id',
        name: 'Acme Proposal',
      })

      mock.onPost(`${SLIDES_BASE}/presentations/copied-pres-id:batchUpdate`).reply({
        replies: [
          { replaceAllText: { occurrencesChanged: 3 } },
          { replaceAllText: { occurrencesChanged: 1 } },
        ],
      })

      const result = await service.createFromTemplate(templateId, 'Acme Proposal', {
        customerName: 'Acme Corp',
        '{{date}}': 'July 2026',
      })

      expect(result).toEqual({
        presentationId: 'copied-pres-id',
        title: 'Acme Proposal',
        url: 'https://docs.google.com/presentation/d/copied-pres-id/edit',
        replacements: {
          '{{customerName}}': 3,
          '{{date}}': 1,
        },
      })

      // Verify the copy request body
      expect(mock.history[0].body).toEqual({ name: 'Acme Proposal' })
      expect(mock.history[0].query).toMatchObject({ supportsAllDrives: true })
    })

    it('copies without replacements when none provided', async () => {
      mock.onPost(`${DRIVE_BASE}/files/${templateId}/copy`).reply({
        id: 'copy-id',
        name: 'Plain Copy',
      })

      const result = await service.createFromTemplate(templateId, 'Plain Copy', null)

      expect(result.replacements).toEqual({})
      expect(mock.history).toHaveLength(1) // only the copy request, no batchUpdate
    })

    it('throws when title is missing', async () => {
      await expect(service.createFromTemplate(templateId, '')).rejects.toThrow('"Title" is required')
    })

    it('throws when templatePresentationId is missing', async () => {
      await expect(service.createFromTemplate('', 'Title')).rejects.toThrow('"Presentation" is required')
    })
  })

  describe('exportPresentation', () => {
    it('exports as PDF and uploads to file storage', async () => {
      const pdfBuffer = Buffer.from('fake-pdf-content')

      mock.onGet(`${DRIVE_BASE}/files/${PRESENTATION_ID}/export`).reply(pdfBuffer)

      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.pro/exported.pdf' })

      const result = await service.exportPresentation(PRESENTATION_ID, 'PDF', 'my-export', null)

      expect(result.format).toBe('PDF')
      expect(result.mimeType).toBe('application/pdf')
      expect(result.url).toBe('https://files.flowrunner.pro/exported.pdf')
      expect(result.presentationId).toBe(PRESENTATION_ID)

      expect(mock.history[0].query).toMatchObject({ mimeType: 'application/pdf' })
      expect(mock.history[0].encoding).toBeNull()

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: 'my-export.pdf',
          generateUrl: true,
          overwrite: true,
        })
      )
    })

    it('exports as PowerPoint (PPTX)', async () => {
      mock.onGet(`${DRIVE_BASE}/files/${PRESENTATION_ID}/export`).reply(Buffer.from('fake-pptx'))

      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.pro/exported.pptx' })

      const result = await service.exportPresentation(PRESENTATION_ID, 'PowerPoint (PPTX)', null, null)

      expect(result.format).toBe('PowerPoint (PPTX)')
      expect(result.fileName).toMatch(/^presentation_\d+\.pptx$/)
    })

    it('throws on unsupported format', async () => {
      await expect(service.exportPresentation(PRESENTATION_ID, 'DOCX'))
        .rejects.toThrow('Unsupported export format')
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.exportPresentation('', 'PDF')).rejects.toThrow('"Presentation" is required')
    })
  })

  describe('deletePresentation', () => {
    it('deletes presentation via Drive API', async () => {
      mock.onDelete(`${DRIVE_BASE}/files/${PRESENTATION_ID}`).reply({})

      const result = await service.deletePresentation(PRESENTATION_ID)

      expect(result).toEqual({
        success: true,
        message: 'Presentation deleted successfully',
        presentationId: PRESENTATION_ID,
      })

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].query).toMatchObject({ supportsAllDrives: true })
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.deletePresentation('')).rejects.toThrow('"Presentation" is required')
    })
  })

  // ── Slides ──

  describe('addSlide', () => {
    it('adds a blank slide at the end by default', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ createSlide: { objectId: 'new-slide-id' } }],
      })

      const result = await service.addSlide(PRESENTATION_ID)

      expect(result).toEqual({
        presentationId: PRESENTATION_ID,
        slideObjectId: 'new-slide-id',
        layout: 'BLANK',
      })

      const body = mock.history[0].body
      expect(body.requests[0].createSlide.slideLayoutReference.predefinedLayout).toBe('BLANK')
      expect(body.requests[0].createSlide).not.toHaveProperty('insertionIndex')
    })

    it('adds a slide with specific layout and insertion index', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ createSlide: { objectId: 'inserted-slide' } }],
      })

      const result = await service.addSlide(PRESENTATION_ID, 'Title And Body', 2)

      expect(result.layout).toBe('TITLE_AND_BODY')

      const body = mock.history[0].body
      expect(body.requests[0].createSlide.insertionIndex).toBe(2)
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.addSlide('')).rejects.toThrow('"Presentation" is required')
    })
  })

  describe('deleteSlide', () => {
    it('deletes a slide by page object ID', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({})

      const result = await service.deleteSlide(PRESENTATION_ID, PAGE_OBJECT_ID)

      expect(result).toEqual({
        success: true,
        message: 'Slide deleted successfully',
        presentationId: PRESENTATION_ID,
        pageObjectId: PAGE_OBJECT_ID,
      })

      const body = mock.history[0].body
      expect(body.requests[0].deleteObject.objectId).toBe(PAGE_OBJECT_ID)
    })

    it('throws when pageObjectId is missing', async () => {
      await expect(service.deleteSlide(PRESENTATION_ID, '')).rejects.toThrow('"Slide" is required')
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.deleteSlide('', 'slide-1')).rejects.toThrow('"Presentation" is required')
    })
  })

  describe('getSlideThumbnail', () => {
    it('fetches thumbnail, downloads image, and uploads to file storage', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}/pages/${PAGE_OBJECT_ID}/thumbnail`).reply({
        contentUrl: 'https://thumbnails.google.com/thumb.png',
        width: 1600,
        height: 900,
      })

      mock.onGet('https://thumbnails.google.com/thumb.png').reply(Buffer.from('fake-png'))

      uploadFileMock.mockResolvedValue({ url: 'https://files.flowrunner.pro/thumb.png' })

      const result = await service.getSlideThumbnail(PRESENTATION_ID, PAGE_OBJECT_ID, 'Large', null)

      expect(result).toMatchObject({
        url: 'https://files.flowrunner.pro/thumb.png',
        width: 1600,
        height: 900,
        presentationId: PRESENTATION_ID,
        pageObjectId: PAGE_OBJECT_ID,
      })

      // Verify thumbnail request query
      expect(mock.history[0].query).toMatchObject({
        'thumbnailProperties.mimeType': 'PNG',
        'thumbnailProperties.thumbnailSize': 'LARGE',
      })

      // Verify binary download
      expect(mock.history[1].encoding).toBeNull()

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          filename: expect.stringMatching(/^slide_slide-page-1_\d+\.png$/),
          generateUrl: true,
          overwrite: true,
        })
      )
    })

    it('throws when pageObjectId is missing', async () => {
      await expect(service.getSlideThumbnail(PRESENTATION_ID, '')).rejects.toThrow('"Slide" is required')
    })

    it('throws when contentUrl is not returned', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}/pages/${PAGE_OBJECT_ID}/thumbnail`).reply({
        width: 100,
        height: 75,
      })

      await expect(service.getSlideThumbnail(PRESENTATION_ID, PAGE_OBJECT_ID))
        .rejects.toThrow('Thumbnail generation did not return a content URL')
    })
  })

  // ── Content ──

  describe('insertTextBox', () => {
    it('creates a text box with default position and size', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({})

      const result = await service.insertTextBox(PRESENTATION_ID, PAGE_OBJECT_ID, 'Hello World')

      expect(result).toMatchObject({
        presentationId: PRESENTATION_ID,
        pageObjectId: PAGE_OBJECT_ID,
        text: 'Hello World',
      })
      expect(result.textBoxObjectId).toMatch(/^TextBox_\d+_\d+$/)

      const requests = mock.history[0].body.requests
      expect(requests).toHaveLength(2)

      // createShape request
      const createShape = requests[0].createShape
      expect(createShape.shapeType).toBe('TEXT_BOX')
      expect(createShape.elementProperties.pageObjectId).toBe(PAGE_OBJECT_ID)
      expect(createShape.elementProperties.size.width.magnitude).toBe(350)
      expect(createShape.elementProperties.size.height.magnitude).toBe(100)
      expect(createShape.elementProperties.transform.translateX).toBe(50)
      expect(createShape.elementProperties.transform.translateY).toBe(50)

      // insertText request
      expect(requests[1].insertText.text).toBe('Hello World')
      expect(requests[1].insertText.insertionIndex).toBe(0)
    })

    it('uses custom position and size when provided', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({})

      await service.insertTextBox(PRESENTATION_ID, PAGE_OBJECT_ID, 'Custom', 100, 200, 500, 150)

      const createShape = mock.history[0].body.requests[0].createShape
      expect(createShape.elementProperties.transform.translateX).toBe(100)
      expect(createShape.elementProperties.transform.translateY).toBe(200)
      expect(createShape.elementProperties.size.width.magnitude).toBe(500)
      expect(createShape.elementProperties.size.height.magnitude).toBe(150)
    })

    it('throws when text is missing', async () => {
      await expect(service.insertTextBox(PRESENTATION_ID, PAGE_OBJECT_ID, ''))
        .rejects.toThrow('"Text" is required')
    })

    it('throws when slide is missing', async () => {
      await expect(service.insertTextBox(PRESENTATION_ID, '', 'Text'))
        .rejects.toThrow('"Slide" is required')
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.insertTextBox('', PAGE_OBJECT_ID, 'Text'))
        .rejects.toThrow('"Presentation" is required')
    })
  })

  describe('replaceAllText', () => {
    it('replaces text with case-sensitive match by default', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 5 } }],
      })

      const result = await service.replaceAllText(PRESENTATION_ID, '{{name}}', 'Acme Corp')

      expect(result).toEqual({
        presentationId: PRESENTATION_ID,
        findText: '{{name}}',
        occurrencesChanged: 5,
      })

      const request = mock.history[0].body.requests[0].replaceAllText
      expect(request.containsText.text).toBe('{{name}}')
      expect(request.containsText.matchCase).toBe(true)
      expect(request.replaceText).toBe('Acme Corp')
    })

    it('uses empty string when replaceText is not provided', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 2 } }],
      })

      await service.replaceAllText(PRESENTATION_ID, 'old-text')

      const request = mock.history[0].body.requests[0].replaceAllText
      expect(request.replaceText).toBe('')
    })

    it('supports case-insensitive matching', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ replaceAllText: { occurrencesChanged: 1 } }],
      })

      await service.replaceAllText(PRESENTATION_ID, 'hello', 'world', false)

      const request = mock.history[0].body.requests[0].replaceAllText
      expect(request.containsText.matchCase).toBe(false)
    })

    it('returns 0 occurrences when replies are empty', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{}],
      })

      const result = await service.replaceAllText(PRESENTATION_ID, '{{none}}', 'value')

      expect(result.occurrencesChanged).toBe(0)
    })

    it('throws when findText is missing', async () => {
      await expect(service.replaceAllText(PRESENTATION_ID, ''))
        .rejects.toThrow('"Find Text" is required')
    })
  })

  describe('replaceTextWithImage', () => {
    it('replaces shapes containing text with an image', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ replaceAllShapesWithImage: { occurrencesChanged: 2 } }],
      })

      const result = await service.replaceTextWithImage(
        PRESENTATION_ID,
        '{{logo}}',
        'https://example.com/logo.png',
        'Fit Inside',
        true
      )

      expect(result).toEqual({
        presentationId: PRESENTATION_ID,
        containsText: '{{logo}}',
        occurrencesChanged: 2,
      })

      const request = mock.history[0].body.requests[0].replaceAllShapesWithImage
      expect(request.containsText.text).toBe('{{logo}}')
      expect(request.containsText.matchCase).toBe(true)
      expect(request.imageUrl).toBe('https://example.com/logo.png')
      expect(request.imageReplaceMethod).toBe('CENTER_INSIDE')
    })

    it('uses Crop To Fill replace method', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [{ replaceAllShapesWithImage: { occurrencesChanged: 1 } }],
      })

      await service.replaceTextWithImage(
        PRESENTATION_ID,
        '{{photo}}',
        'https://example.com/photo.jpg',
        'Crop To Fill'
      )

      const request = mock.history[0].body.requests[0].replaceAllShapesWithImage
      expect(request.imageReplaceMethod).toBe('CENTER_CROP')
    })

    it('throws when containsText is missing', async () => {
      await expect(service.replaceTextWithImage(PRESENTATION_ID, '', 'https://img.com/x.png'))
        .rejects.toThrow('"Contains Text" is required')
    })

    it('throws when imageUrl is missing', async () => {
      await expect(service.replaceTextWithImage(PRESENTATION_ID, '{{logo}}', ''))
        .rejects.toThrow('"Image URL" is required')
    })
  })

  // ── Advanced ──

  describe('batchUpdate', () => {
    it('passes raw requests array to the Slides API', async () => {
      const rawRequests = [
        { createSlide: { slideLayoutReference: { predefinedLayout: 'BLANK' } } },
        { replaceAllText: { containsText: { text: '{{name}}' }, replaceText: 'Acme' } },
      ]

      mock.onPost(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}:batchUpdate`).reply({
        replies: [
          { createSlide: { objectId: 'new-slide' } },
          {},
        ],
        writeControl: { requiredRevisionId: 'rev-5' },
      })

      const result = await service.batchUpdate(PRESENTATION_ID, rawRequests)

      expect(result.replies).toHaveLength(2)
      expect(result.writeControl.requiredRevisionId).toBe('rev-5')
      expect(mock.history[0].body).toEqual({ requests: rawRequests })
    })

    it('throws when requests is empty', async () => {
      await expect(service.batchUpdate(PRESENTATION_ID, []))
        .rejects.toThrow('"Requests" must be a non-empty array')
    })

    it('throws when requests is not an array', async () => {
      await expect(service.batchUpdate(PRESENTATION_ID, 'invalid'))
        .rejects.toThrow('"Requests" must be a non-empty array')
    })

    it('throws when presentationId is missing', async () => {
      await expect(service.batchUpdate('', [{ createSlide: {} }]))
        .rejects.toThrow('"Presentation" is required')
    })
  })

  // ── API Error Handling ──

  describe('API error handling', () => {
    it('wraps API errors with descriptive message', async () => {
      mock.onGet(`${SLIDES_BASE}/presentations/${PRESENTATION_ID}`).replyWithError({
        message: 'Not Found',
        body: { error: { message: 'Requested entity was not found.' } },
      })

      await expect(service.getPresentation(PRESENTATION_ID))
        .rejects.toThrow('Google Slides API error: Requested entity was not found.')
    })

    it('falls back to error.message when body is missing', async () => {
      mock.onPost(`${SLIDES_BASE}/presentations`).replyWithError({
        message: 'Network failure',
      })

      await expect(service.createPresentation('Title'))
        .rejects.toThrow('Google Slides API error: Network failure')
    })
  })
})
