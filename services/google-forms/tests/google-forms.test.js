'use strict'

const mockDriveFilesList = jest.fn()
const mockDriveFilesDelete = jest.fn()
const mockFormsCreate = jest.fn()
const mockFormsBatchUpdate = jest.fn()
const mockFormsGet = jest.fn()
const mockFormsResponsesList = jest.fn()
const mockFormsResponsesGet = jest.fn()
const mockSetCredentials = jest.fn()

jest.mock('@googleapis/oauth2', () => ({
  auth: {
    OAuth2: jest.fn().mockImplementation(() => ({
      setCredentials: mockSetCredentials,
    })),
  },
}))

jest.mock('@googleapis/drive', () => ({
  drive: jest.fn().mockReturnValue({
    files: {
      list: mockDriveFilesList,
      delete: mockDriveFilesDelete,
    },
  }),
}))

jest.mock('@googleapis/forms', () => ({
  forms: jest.fn().mockReturnValue({
    forms: {
      create: mockFormsCreate,
      batchUpdate: mockFormsBatchUpdate,
      get: mockFormsGet,
      responses: {
        list: mockFormsResponsesList,
        get: mockFormsResponsesGet,
      },
    },
  }),
}))

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

describe('Google Forms Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    service.request = {
      headers: { 'oauth-access-token': ACCESS_TOKEN },
    }
  })

  afterEach(() => {
    mock.reset()
    mockDriveFilesList.mockReset()
    mockDriveFilesDelete.mockReset()
    mockFormsCreate.mockReset()
    mockFormsBatchUpdate.mockReset()
    mockFormsGet.mockReset()
    mockFormsResponsesList.mockReset()
    mockFormsResponsesGet.mockReset()
    mockSetCredentials.mockReset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })

    it('registers exactly two config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(2)
    })
  })

  // ── OAuth Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns authorization URL with correct parameters', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('access_type=offline')
      expect(url).toContain('prompt=consent')
      expect(url).toContain('scope=')
    })
  })

  describe('refreshToken', () => {
    it('sends POST to token URL and returns token data', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('test-refresh-token')

      expect(result).toEqual({
        token: 'new-access-token',
        expirationInSeconds: 3600,
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: 'test-refresh-token',
        grant_type: 'refresh_token',
      })
    })

    it('throws specific error for invalid_grant', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant' },
      })

      await expect(service.refreshToken('expired-token')).rejects.toThrow()
    })

    it('rethrows other errors', async () => {
      mock.onPost(TOKEN_URL).replyWithError({
        message: 'Server Error',
        body: { error: 'server_error' },
      })

      await expect(service.refreshToken('some-token')).rejects.toThrow()
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and fetches user profile', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(PROFILE_URL).reply({
        name: 'Test User',
        email: 'test@example.com',
        picture: 'https://example.com/photo.jpg',
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expirationInSeconds: 3600,
        overwrite: true,
        connectionIdentityName: 'Test User (test@example.com)',
        connectionIdentityImageURL: 'https://example.com/photo.jpg',
      })

      expect(mock.history).toHaveLength(2)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({
        Authorization: 'Bearer new-access-token',
      })
    })

    it('falls back to default identity name when profile fetch fails', async () => {
      mock.onPost(TOKEN_URL).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      })

      mock.onGet(PROFILE_URL).replyWithError({
        message: 'Forbidden',
        body: { error: 'forbidden' },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://example.com/callback',
      })

      expect(result.connectionIdentityName).toBe('Google Form User')
      expect(result.connectionIdentityImageURL).toBeUndefined()
    })
  })

  // ── Dictionary Methods ──

  describe('getFormsDictionary', () => {
    it('returns forms list with correct shape', async () => {
      mockDriveFilesList.mockResolvedValue({
        data: {
          files: [
            { id: 'form-1', name: 'My Form' },
            { id: 'form-2', name: 'Another Form' },
          ],
          nextPageToken: 'next-token',
        },
      })

      const result = await service.getFormsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'My Form', note: 'ID: form-1', value: 'form-1' },
          { label: 'Another Form', note: 'ID: form-2', value: 'form-2' },
        ],
        cursor: 'next-token',
      })

      expect(mockDriveFilesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "mimeType='application/vnd.google-apps.form'",
          pageSize: 100,
        })
      )
    })

    it('filters forms by search term', async () => {
      mockDriveFilesList.mockResolvedValue({
        data: {
          files: [
            { id: 'form-1', name: 'Contact Form' },
            { id: 'form-2', name: 'Order Form' },
          ],
        },
      })

      const result = await service.getFormsDictionary({ search: 'Contact' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Contact Form')
    })

    it('passes cursor as pageToken', async () => {
      mockDriveFilesList.mockResolvedValue({
        data: { files: [], nextPageToken: undefined },
      })

      await service.getFormsDictionary({ cursor: 'page-2-token' })

      expect(mockDriveFilesList).toHaveBeenCalledWith(
        expect.objectContaining({ pageToken: 'page-2-token' })
      )
    })

    it('handles empty payload', async () => {
      mockDriveFilesList.mockResolvedValue({
        data: { files: [] },
      })

      const result = await service.getFormsDictionary()

      expect(result.items).toEqual([])
    })

    it('throws on API error', async () => {
      mockDriveFilesList.mockRejectedValue(new Error('Drive API error'))

      await expect(service.getFormsDictionary({})).rejects.toThrow('Failed to retrieve forms dictionary')
    })
  })

  describe('getFormResponsesDictionary', () => {
    it('returns responses list with correct shape', async () => {
      mockFormsResponsesList.mockResolvedValue({
        data: {
          responses: [
            { responseId: 'resp-1' },
            { responseId: 'resp-2' },
          ],
          nextPageToken: 'next-token',
        },
      })

      const result = await service.getFormResponsesDictionary({
        criteria: { formId: 'form-1' },
      })

      expect(result).toEqual({
        items: [
          { label: 'resp-1', note: 'ID: resp-1', value: 'resp-1' },
          { label: 'resp-2', note: 'ID: resp-2', value: 'resp-2' },
        ],
        cursor: 'next-token',
      })
    })

    it('filters responses by search term', async () => {
      mockFormsResponsesList.mockResolvedValue({
        data: {
          responses: [
            { responseId: 'abc-123' },
            { responseId: 'xyz-456' },
          ],
        },
      })

      const result = await service.getFormResponsesDictionary({
        search: 'abc',
        criteria: { formId: 'form-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('abc-123')
    })

    it('handles null responses gracefully', async () => {
      mockFormsResponsesList.mockResolvedValue({
        data: { responses: null },
      })

      const result = await service.getFormResponsesDictionary({
        criteria: { formId: 'form-1' },
      })

      expect(result.items).toEqual([])
    })

    it('throws on API error', async () => {
      mockFormsResponsesList.mockRejectedValue(new Error('Forms API error'))

      await expect(
        service.getFormResponsesDictionary({ criteria: { formId: 'form-1' } })
      ).rejects.toThrow('Failed to retrieve form responses dictionary')
    })
  })

  // ── Action Methods ──

  describe('getFormsList', () => {
    it('returns list of forms from Drive', async () => {
      const files = [
        { id: 'form-1', name: 'Form One' },
        { id: 'form-2', name: 'Form Two' },
      ]

      mockDriveFilesList.mockResolvedValue({ data: { files } })

      const result = await service.getFormsList()

      expect(result).toEqual(files)
      expect(mockDriveFilesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "mimeType='application/vnd.google-apps.form'",
          fields: 'files(id, name)',
        })
      )
    })

    it('throws on API error', async () => {
      mockDriveFilesList.mockRejectedValue(new Error('Drive error'))

      await expect(service.getFormsList()).rejects.toThrow('Drive error')
    })
  })

  describe('deleteForm', () => {
    it('deletes form by ID', async () => {
      mockDriveFilesDelete.mockResolvedValue({ data: '' })

      const result = await service.deleteForm('form-123')

      expect(result).toBe('')
      expect(mockDriveFilesDelete).toHaveBeenCalledWith({ fileId: 'form-123' })
    })

    it('throws when formId is missing', async () => {
      await expect(service.deleteForm()).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockDriveFilesDelete.mockRejectedValue(new Error('Not found'))

      await expect(service.deleteForm('bad-id')).rejects.toThrow('Not found')
    })
  })

  describe('createForm', () => {
    it('creates a form with Empty template', async () => {
      const formData = {
        formId: 'new-form-id',
        revisionId: 'rev-1',
        info: { title: 'Test Form' },
      }

      mockFormsCreate.mockResolvedValue({ data: formData })

      const result = await service.createForm('Test Form', 'Empty')

      expect(result).toEqual(formData)
      expect(mockFormsCreate).toHaveBeenCalledWith({
        requestBody: { info: { title: 'Test Form' } },
      })
      expect(mockFormsBatchUpdate).not.toHaveBeenCalled()
    })

    it('creates a form with a predefined template', async () => {
      const createData = { formId: 'new-form-id', info: { title: 'Contact Form' } }
      const updateData = { form: { formId: 'new-form-id' }, replies: [{}] }

      mockFormsCreate.mockResolvedValue({ data: createData })
      mockFormsBatchUpdate.mockResolvedValue({ data: updateData })

      const result = await service.createForm('Contact Form', 'Contact Information')

      expect(result).toEqual(updateData)
      expect(mockFormsCreate).toHaveBeenCalled()
      expect(mockFormsBatchUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          formId: 'new-form-id',
          requestBody: expect.objectContaining({
            includeFormInResponse: true,
            requests: expect.any(Array),
          }),
        })
      )
    })

    it('throws when title is missing', async () => {
      await expect(service.createForm(null, 'Empty')).rejects.toThrow("'Form Title' is required")
    })

    it('throws on API error during creation', async () => {
      mockFormsCreate.mockRejectedValue(new Error('Create failed'))

      await expect(service.createForm('Test', 'Empty')).rejects.toThrow('Create failed')
    })
  })

  describe('updateFormAdvanced', () => {
    it('sends batchUpdate with provided body JSON', async () => {
      const bodyJSON = {
        requests: [{ updateFormInfo: { info: { title: 'Updated Title' } } }],
      }
      const responseData = { replies: [{}] }

      mockFormsBatchUpdate.mockResolvedValue({ data: responseData })

      const result = await service.updateFormAdvanced('form-123', bodyJSON)

      expect(result).toEqual(responseData)
      expect(mockFormsBatchUpdate).toHaveBeenCalledWith({
        formId: 'form-123',
        requestBody: bodyJSON,
      })
    })

    it('throws when formId is missing', async () => {
      await expect(service.updateFormAdvanced(null, {})).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsBatchUpdate.mockRejectedValue(new Error('Update failed'))

      await expect(service.updateFormAdvanced('form-123', {})).rejects.toThrow('Update failed')
    })
  })

  describe('moveFieldForm', () => {
    it('sends batchUpdate with moveItem request', async () => {
      const responseData = { replies: [{}], writeControl: { requiredRevisionId: 'rev-2' } }

      mockFormsBatchUpdate.mockResolvedValue({ data: responseData })

      const result = await service.moveFieldForm('form-123', 0, 2)

      expect(result).toEqual(responseData)
      expect(mockFormsBatchUpdate).toHaveBeenCalledWith({
        formId: 'form-123',
        requestBody: {
          requests: [
            {
              moveItem: {
                original_location: { index: 0 },
                newLocation: { index: 2 },
              },
            },
          ],
        },
      })
    })

    it('throws when formId is missing', async () => {
      await expect(service.moveFieldForm(null, 0, 1)).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsBatchUpdate.mockRejectedValue(new Error('Move failed'))

      await expect(service.moveFieldForm('form-123', 0, 1)).rejects.toThrow('Move failed')
    })
  })

  describe('deleteFieldForm', () => {
    it('sends batchUpdate with deleteItem request', async () => {
      const responseData = { replies: [{}], writeControl: { requiredRevisionId: 'rev-3' } }

      mockFormsBatchUpdate.mockResolvedValue({ data: responseData })

      const result = await service.deleteFieldForm('form-123', 2)

      expect(result).toEqual(responseData)
      expect(mockFormsBatchUpdate).toHaveBeenCalledWith({
        formId: 'form-123',
        requestBody: {
          requests: [{ deleteItem: { location: { index: 2 } } }],
        },
      })
    })

    it('throws when formId is missing', async () => {
      await expect(service.deleteFieldForm(null, 0)).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsBatchUpdate.mockRejectedValue(new Error('Delete field failed'))

      await expect(service.deleteFieldForm('form-123', 0)).rejects.toThrow('Delete field failed')
    })
  })

  describe('getFormDetails', () => {
    it('returns form details by ID', async () => {
      const formData = {
        formId: 'form-123',
        info: { title: 'My Form' },
        items: [{ itemId: 'item-1', title: 'Question 1' }],
      }

      mockFormsGet.mockResolvedValue({ data: formData })

      const result = await service.getFormDetails('form-123')

      expect(result).toEqual(formData)
      expect(mockFormsGet).toHaveBeenCalledWith({ formId: 'form-123' })
    })

    it('throws when formId is missing', async () => {
      await expect(service.getFormDetails()).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsGet.mockRejectedValue(new Error('Not found'))

      await expect(service.getFormDetails('bad-id')).rejects.toThrow('Not found')
    })
  })

  describe('getFormResponsesList', () => {
    it('returns responses for a form', async () => {
      const responseData = {
        responses: [
          { responseId: 'resp-1', createTime: '2024-01-01T00:00:00Z' },
        ],
      }

      mockFormsResponsesList.mockResolvedValue({ data: responseData })

      const result = await service.getFormResponsesList('form-123')

      expect(result).toEqual(responseData)
      expect(mockFormsResponsesList).toHaveBeenCalledWith({ formId: 'form-123' })
    })

    it('throws when formId is missing', async () => {
      await expect(service.getFormResponsesList()).rejects.toThrow("'Form ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsResponsesList.mockRejectedValue(new Error('Forbidden'))

      await expect(service.getFormResponsesList('form-123')).rejects.toThrow('Forbidden')
    })
  })

  describe('getFormResponseById', () => {
    it('returns a specific form response', async () => {
      const responseData = {
        responseId: 'resp-1',
        createTime: '2024-01-01T00:00:00Z',
        answers: { q1: { textAnswers: { answers: [{ value: 'Hello' }] } } },
      }

      mockFormsResponsesGet.mockResolvedValue({ data: responseData })

      const result = await service.getFormResponseById('form-123', 'resp-1')

      expect(result).toEqual(responseData)
      expect(mockFormsResponsesGet).toHaveBeenCalledWith({
        formId: 'form-123',
        responseId: 'resp-1',
      })
    })

    it('throws when formId is missing', async () => {
      await expect(service.getFormResponseById(null, 'resp-1')).rejects.toThrow("'Form ID' is required")
    })

    it('throws when responseId is missing', async () => {
      await expect(service.getFormResponseById('form-123', null)).rejects.toThrow("'Response ID' is required")
    })

    it('throws on API error', async () => {
      mockFormsResponsesGet.mockRejectedValue(new Error('Response not found'))

      await expect(service.getFormResponseById('form-123', 'bad-id')).rejects.toThrow('Response not found')
    })
  })
})
