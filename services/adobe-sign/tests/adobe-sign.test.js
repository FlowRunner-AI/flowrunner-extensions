'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const SHARD = 'na1'
const ACCESS_TOKEN = 'test-access-token'
const API_ACCESS_POINT = 'https://api.na1.adobesign.com/'
const COMPOSITE_TOKEN = `${ACCESS_TOKEN}::sign::${API_ACCESS_POINT}`
const BASE = `${API_ACCESS_POINT}api/rest/v6`
const OAUTH_API_HOST = `https://api.${SHARD}.adobesign.com`

function setOAuthToken(service, token) {
  service.request = { headers: { 'oauth-access-token': token || COMPOSITE_TOKEN } }
}

function setFlowrunnerFiles(service, uploadResult) {
  service.flowrunner = {
    Files: {
      uploadFile: jest.fn().mockResolvedValue(uploadResult || { url: 'https://files.flowrunner.com/test.pdf' }),
    },
  }
}

describe('Adobe Acrobat Sign Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      shard: SHARD,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
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
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'shard', required: true, shared: false }),
        ])
      )
    })

    it('shard config has CHOICE type with correct options', () => {
      const items = sandbox.getConfigItems()
      const shardItem = items.find(i => i.name === 'shard')

      expect(shardItem.type).toBe('CHOICE')
      expect(shardItem.options).toEqual(['na1', 'na2', 'na3', 'na4', 'eu1', 'eu2', 'jp1', 'au1', 'in1', 'sg1'])
      expect(shardItem.defaultValue).toBe('na1')
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL with shard and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`https://secure.${SHARD}.adobesign.com/public/oauth/v2`)
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
      expect(url).toContain('user_read%3Aself')
      expect(url).toContain('agreement_write%3Aself')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and resolves apiAccessPoint', async () => {
      const callbackObject = { code: 'auth-code-123', redirectURI: 'https://app.flowrunner.com/callback' }

      // 1. Token exchange
      mock.onPost(`${OAUTH_API_HOST}/oauth/v2/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      // 2. Resolve baseUris
      mock.onGet(`${OAUTH_API_HOST}/api/rest/v6/baseUris`).reply({
        apiAccessPoint: 'https://api.na1.adobesign.com/',
      })

      // 3. Get user identity
      mock.onGet(`${API_ACCESS_POINT}api/rest/v6/users/me`).reply({
        firstName: 'Alex',
        lastName: 'Morgan',
        email: 'alex@example.com',
      })

      const result = await service.executeCallback(callbackObject)

      expect(result.token).toBe('new-access-token::sign::https://api.na1.adobesign.com/')
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.connectionIdentityName).toBe('Alex Morgan')
      expect(result.overwrite).toBe(true)

      // Verify token exchange request body
      const tokenCall = mock.history[0]

      expect(tokenCall.method).toBe('post')
      expect(tokenCall.body).toContain('grant_type=authorization_code')
      expect(tokenCall.body).toContain(`code=${callbackObject.code}`)
      expect(tokenCall.body).toContain(`client_id=${CLIENT_ID}`)
      expect(tokenCall.body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('returns null identity when user fetch fails', async () => {
      const callbackObject = { code: 'auth-code-456', redirectURI: 'https://app.flowrunner.com/callback' }

      mock.onPost(`${OAUTH_API_HOST}/oauth/v2/token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${OAUTH_API_HOST}/api/rest/v6/baseUris`).reply({
        apiAccessPoint: 'https://api.na1.adobesign.com/',
      })

      mock.onGet(`${API_ACCESS_POINT}api/rest/v6/users/me`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Not allowed' },
      })

      const result = await service.executeCallback(callbackObject)

      expect(result.connectionIdentityName).toBeNull()
      expect(result.token).toContain('::sign::')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token and re-resolves apiAccessPoint', async () => {
      setOAuthToken(service)

      mock.onPost(`${OAUTH_API_HOST}/oauth/v2/refresh`).reply({
        access_token: 'refreshed-access-token',
        expires_in: 3600,
      })

      mock.onGet(`${OAUTH_API_HOST}/api/rest/v6/baseUris`).reply({
        apiAccessPoint: 'https://api.na1.adobesign.com/',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe('refreshed-access-token::sign::https://api.na1.adobesign.com/')
      expect(result.expirationInSeconds).toBe(3600)
      // When no refresh_token is returned, falls back to the provided one
      expect(result.refreshToken).toBe('old-refresh-token')

      // Verify refresh request body
      const refreshCall = mock.history[0]

      expect(refreshCall.body).toContain('grant_type=refresh_token')
      expect(refreshCall.body).toContain('refresh_token=old-refresh-token')
    })

    it('falls back to stored access point when baseUris fails', async () => {
      setOAuthToken(service)

      mock.onPost(`${OAUTH_API_HOST}/oauth/v2/refresh`).reply({
        access_token: 'refreshed-token-2',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      })

      mock.onGet(`${OAUTH_API_HOST}/api/rest/v6/baseUris`).replyWithError({
        message: 'Service unavailable',
      })

      const result = await service.refreshToken('old-refresh')

      expect(result.token).toBe(`refreshed-token-2::sign::${API_ACCESS_POINT}`)
      expect(result.refreshToken).toBe('new-refresh')
    })
  })

  // ── Transient Documents ──

  describe('uploadTransientDocument', () => {
    it('uploads a file via FormData', async () => {
      setOAuthToken(service)

      // Mock downloading the file
      const fileBytes = Buffer.from('fake-pdf-content')

      mock.onGet('https://files.flowrunner.com/source.pdf').reply(fileBytes)
      mock.onPost(`${BASE}/transientDocuments`).reply({ transientDocumentId: 'tdoc-123' })

      const result = await service.uploadTransientDocument('https://files.flowrunner.com/source.pdf', 'Contract.pdf', 'application/pdf')

      expect(result).toEqual({ transientDocumentId: 'tdoc-123' })

      // Check the upload call
      const uploadCall = mock.history[1]

      expect(uploadCall.method).toBe('post')
      expect(uploadCall.url).toBe(`${BASE}/transientDocuments`)
      expect(uploadCall.headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
      expect(uploadCall.formData).toBeDefined()
    })

    it('throws when fileUrl is not provided', async () => {
      setOAuthToken(service)
      await expect(service.uploadTransientDocument()).rejects.toThrow('File is required.')
    })
  })

  // ── Agreements ──

  describe('sendAgreement', () => {
    it('sends agreement with transient document and recipient emails', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'agreement-123' })

      const result = await service.sendAgreement(
        'Test NDA',
        ['alice@example.com', 'bob@example.com'],
        'tdoc-456',
        undefined,     // templateId
        'Signer',      // recipientRole
        'Please sign', // message
        ['cc@example.com'],
        '2026-12-31T23:59:59Z',
        'Daily Until Signed',
        'ext-id-789',
        undefined      // participantSetsInfo
      )

      expect(result).toEqual({ id: 'agreement-123' })

      const body = mock.history[0].body

      expect(body.name).toBe('Test NDA')
      expect(body.state).toBe('IN_PROCESS')
      expect(body.signatureType).toBe('ESIGN')
      expect(body.fileInfos).toEqual([{ transientDocumentId: 'tdoc-456' }])
      expect(body.participantSetsInfo).toEqual([
        { memberInfos: [{ email: 'alice@example.com' }], order: 1, role: 'SIGNER' },
        { memberInfos: [{ email: 'bob@example.com' }], order: 2, role: 'SIGNER' },
      ])
      expect(body.message).toBe('Please sign')
      expect(body.ccs).toEqual([{ email: 'cc@example.com' }])
      expect(body.expirationTime).toBe('2026-12-31T23:59:59Z')
      expect(body.reminderFrequency).toBe('DAILY_UNTIL_SIGNED')
      expect(body.externalId).toEqual({ id: 'ext-id-789' })
    })

    it('sends agreement with library template instead of transient document', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'agreement-456' })

      await service.sendAgreement('Template NDA', ['signer@example.com'], undefined, 'lib-template-1')

      const body = mock.history[0].body

      expect(body.fileInfos).toEqual([{ libraryDocumentId: 'lib-template-1' }])
    })

    it('uses participantSetsInfo override when provided', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'agreement-789' })

      const customSets = [
        { memberInfos: [{ email: 'a@b.com' }], order: 1, role: 'SIGNER' },
        { memberInfos: [{ email: 'c@d.com' }], order: 2, role: 'APPROVER' },
      ]

      await service.sendAgreement('Custom Agreement', undefined, 'tdoc-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, customSets)

      const body = mock.history[0].body

      expect(body.participantSetsInfo).toEqual(customSets)
    })

    it('maps friendly recipient role to API value', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'a-1' })

      await service.sendAgreement('Test', ['x@y.com'], 'tdoc-1', undefined, 'Approver')

      expect(mock.history[0].body.participantSetsInfo[0].role).toBe('APPROVER')
    })

    it('maps friendly reminder frequency to API value', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'a-2' })

      await service.sendAgreement('Test', ['x@y.com'], 'tdoc-1', undefined, undefined, undefined, undefined, undefined, 'Weekly Until Signed')

      expect(mock.history[0].body.reminderFrequency).toBe('WEEKLY_UNTIL_SIGNED')
    })

    it('throws when neither transient document nor template provided', async () => {
      setOAuthToken(service)

      await expect(
        service.sendAgreement('Test', ['x@y.com'])
      ).rejects.toThrow('Provide a document')
    })

    it('throws when both transient document and template provided', async () => {
      setOAuthToken(service)

      await expect(
        service.sendAgreement('Test', ['x@y.com'], 'tdoc-1', 'template-1')
      ).rejects.toThrow('Provide only one document source')
    })

    it('throws when no recipients and no participantSetsInfo', async () => {
      setOAuthToken(service)

      await expect(
        service.sendAgreement('Test', undefined, 'tdoc-1')
      ).rejects.toThrow('Recipient Emails is required')
    })

    it('throws when name is missing', async () => {
      setOAuthToken(service)

      await expect(
        service.sendAgreement(undefined, ['x@y.com'], 'tdoc-1')
      ).rejects.toThrow('Agreement Name is required')
    })
  })

  describe('createDraftAgreement', () => {
    it('creates draft with state DRAFT', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements`).reply({ id: 'draft-123' })

      const result = await service.createDraftAgreement('Draft NDA', ['signer@example.com'], 'tdoc-1')

      expect(result).toEqual({ id: 'draft-123' })

      const body = mock.history[0].body

      expect(body.state).toBe('DRAFT')
      expect(body.name).toBe('Draft NDA')
    })
  })

  describe('listAgreements', () => {
    it('lists agreements with default page size', async () => {
      setOAuthToken(service)

      const response = { userAgreementList: [{ id: 'a-1', name: 'NDA' }], page: { nextCursor: 'cursor-1' } }

      mock.onGet(`${BASE}/agreements`).reply(response)

      const result = await service.listAgreements()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ pageSize: 20 })
    })

    it('passes custom page size and cursor', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements`).reply({ userAgreementList: [], page: {} })

      await service.listAgreements(50, 'next-cursor')

      expect(mock.history[0].query).toMatchObject({ pageSize: 50, cursor: 'next-cursor' })
    })
  })

  describe('getAgreement', () => {
    it('fetches agreement by ID', async () => {
      setOAuthToken(service)

      const response = { id: 'agr-1', name: 'NDA', status: 'SIGNED' }

      mock.onGet(`${BASE}/agreements/agr-1`).reply(response)

      const result = await service.getAgreement('agr-1')

      expect(result).toEqual(response)
      expect(mock.history[0].headers).toMatchObject({ Authorization: `Bearer ${ACCESS_TOKEN}` })
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getAgreement()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('cancelAgreement', () => {
    it('cancels agreement with comment and notify', async () => {
      setOAuthToken(service)

      mock.onPut(`${BASE}/agreements/agr-1/state`).reply({})

      const result = await service.cancelAgreement('agr-1', 'No longer needed', true)

      expect(result).toEqual({ cancelled: true, agreementId: 'agr-1' })

      const body = mock.history[0].body

      expect(body.state).toBe('CANCELLED')
      expect(body.agreementCancellationInfo.comment).toBe('No longer needed')
      expect(body.agreementCancellationInfo.notifyOthers).toBe(true)
    })

    it('cancels agreement without optional fields', async () => {
      setOAuthToken(service)

      mock.onPut(`${BASE}/agreements/agr-1/state`).reply({})

      const result = await service.cancelAgreement('agr-1')

      expect(result).toEqual({ cancelled: true, agreementId: 'agr-1' })

      const body = mock.history[0].body

      expect(body.agreementCancellationInfo.comment).toBeUndefined()
      expect(body.agreementCancellationInfo.notifyOthers).toBeUndefined()
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.cancelAgreement()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('getSigningUrls', () => {
    it('fetches signing URLs for agreement', async () => {
      setOAuthToken(service)

      const response = {
        signingUrlSetInfos: [{
          signingUrlSetName: 'Signers',
          signingUrls: [{ email: 'jane@example.com', esignUrl: 'https://secure.na1.adobesign.com/sign' }],
        }],
      }

      mock.onGet(`${BASE}/agreements/agr-1/signingUrls`).reply(response)

      const result = await service.getSigningUrls('agr-1')

      expect(result).toEqual(response)
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getSigningUrls()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('getAgreementMembers', () => {
    it('fetches members without includeNextParticipantSet', async () => {
      setOAuthToken(service)

      const response = { participantSets: [{ id: 'ps-1', role: 'SIGNER' }] }

      mock.onGet(`${BASE}/agreements/agr-1/members`).reply(response)

      const result = await service.getAgreementMembers('agr-1')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toEqual({})
    })

    it('includes includeNextParticipantSet query param when true', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements/agr-1/members`).reply({ participantSets: [] })

      await service.getAgreementMembers('agr-1', true)

      expect(mock.history[0].query).toMatchObject({ includeNextParticipantSet: true })
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getAgreementMembers()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('getAgreementEvents', () => {
    it('fetches agreement event history', async () => {
      setOAuthToken(service)

      const response = { events: [{ type: 'CREATED', date: '2026-07-01T10:00:00Z' }] }

      mock.onGet(`${BASE}/agreements/agr-1/events`).reply(response)

      const result = await service.getAgreementEvents('agr-1')

      expect(result).toEqual(response)
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getAgreementEvents()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('sendReminder', () => {
    it('sends reminder with note', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements/agr-1/reminders`).reply({
        id: 'rem-1',
        status: 'ACTIVE',
        recipientParticipantIds: ['ps-1'],
      })

      const result = await service.sendReminder('agr-1', ['ps-1'], 'Please sign soon')

      expect(result).toHaveProperty('id', 'rem-1')

      const body = mock.history[0].body

      expect(body.recipientParticipantIds).toEqual(['ps-1'])
      expect(body.status).toBe('ACTIVE')
      expect(body.note).toBe('Please sign soon')
    })

    it('sends reminder without note', async () => {
      setOAuthToken(service)

      mock.onPost(`${BASE}/agreements/agr-1/reminders`).reply({ id: 'rem-2', status: 'ACTIVE' })

      await service.sendReminder('agr-1', ['ps-1', 'ps-2'])

      const body = mock.history[0].body

      expect(body.recipientParticipantIds).toEqual(['ps-1', 'ps-2'])
      expect(body.note).toBeUndefined()
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.sendReminder(undefined, ['ps-1'])).rejects.toThrow('Agreement is required.')
    })

    it('throws when recipientParticipantIds is empty', async () => {
      setOAuthToken(service)
      await expect(service.sendReminder('agr-1', [])).rejects.toThrow('At least one Recipient Participant ID is required')
    })
  })

  describe('getFormData', () => {
    it('fetches and parses CSV form data', async () => {
      setOAuthToken(service)

      const csvText = 'completed,email,role\n2026-07-02,jane@example.com,SIGNER'

      mock.onGet(`${BASE}/agreements/agr-1/formData`).reply(csvText)

      const result = await service.getFormData('agr-1')

      expect(result.csv).toBe(csvText)
      expect(result.rows).toEqual([
        { completed: '2026-07-02', email: 'jane@example.com', role: 'SIGNER' },
      ])

      // Verify Accept header is text/csv
      expect(mock.history[0].headers).toMatchObject({ Accept: 'text/csv' })
    })

    it('returns null rows when CSV has only headers', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements/agr-1/formData`).reply('completed,email')

      const result = await service.getFormData('agr-1')

      expect(result.csv).toBe('completed,email')
      expect(result.rows).toBeNull()
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getFormData()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('downloadAgreementPdf', () => {
    it('downloads combined PDF and uploads to file storage', async () => {
      setOAuthToken(service)

      const pdfBytes = Buffer.from('fake-pdf-bytes')

      mock.onGet(`${BASE}/agreements/agr-1/combinedDocument`).reply(pdfBytes)
      setFlowrunnerFiles(service, { url: 'https://files.flowrunner.com/agreement_agr-1.pdf' })

      const result = await service.downloadAgreementPdf('agr-1')

      expect(result.url).toBe('https://files.flowrunner.com/agreement_agr-1.pdf')
      expect(result.filename).toBe('agreement_agr-1.pdf')
      expect(result.sizeBytes).toBe(pdfBytes.length)
      expect(result.agreementId).toBe('agr-1')

      // Verify query params defaults
      expect(mock.history[0].query).toMatchObject({
        attachSupportingDocuments: true,
        attachAuditReport: false,
      })
    })

    it('passes custom attach options', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements/agr-1/combinedDocument`).reply(Buffer.from('pdf'))
      setFlowrunnerFiles(service, { url: 'https://files.flowrunner.com/test.pdf' })

      await service.downloadAgreementPdf('agr-1', false, true)

      expect(mock.history[0].query).toMatchObject({
        attachSupportingDocuments: false,
        attachAuditReport: true,
      })
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.downloadAgreementPdf()).rejects.toThrow('Agreement is required.')
    })
  })

  describe('downloadAuditTrail', () => {
    it('downloads audit trail PDF and uploads to file storage', async () => {
      setOAuthToken(service)

      const pdfBytes = Buffer.from('audit-trail-bytes')

      mock.onGet(`${BASE}/agreements/agr-1/auditTrail`).reply(pdfBytes)
      setFlowrunnerFiles(service, { url: 'https://files.flowrunner.com/audit_trail_agr-1.pdf' })

      const result = await service.downloadAuditTrail('agr-1')

      expect(result.url).toBe('https://files.flowrunner.com/audit_trail_agr-1.pdf')
      expect(result.filename).toBe('audit_trail_agr-1.pdf')
      expect(result.sizeBytes).toBe(pdfBytes.length)
      expect(result.agreementId).toBe('agr-1')
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.downloadAuditTrail()).rejects.toThrow('Agreement is required.')
    })
  })

  // ── Library Templates ──

  describe('listLibraryDocuments', () => {
    it('lists library documents with default page size', async () => {
      setOAuthToken(service)

      const response = { libraryDocumentList: [{ id: 'lib-1', name: 'NDA Template' }], page: {} }

      mock.onGet(`${BASE}/libraryDocuments`).reply(response)

      const result = await service.listLibraryDocuments()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ pageSize: 20 })
    })

    it('passes custom page size and cursor', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/libraryDocuments`).reply({ libraryDocumentList: [], page: {} })

      await service.listLibraryDocuments(50, 'cursor-abc')

      expect(mock.history[0].query).toMatchObject({ pageSize: 50, cursor: 'cursor-abc' })
    })
  })

  describe('getLibraryDocument', () => {
    it('fetches library document by ID', async () => {
      setOAuthToken(service)

      const response = { id: 'lib-1', name: 'NDA Template', status: 'ACTIVE' }

      mock.onGet(`${BASE}/libraryDocuments/lib-1`).reply(response)

      const result = await service.getLibraryDocument('lib-1')

      expect(result).toEqual(response)
    })

    it('throws when libraryDocumentId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getLibraryDocument()).rejects.toThrow('Library Template is required.')
    })
  })

  // ── Web Forms ──

  describe('listWebForms', () => {
    it('lists web forms with default page size', async () => {
      setOAuthToken(service)

      const response = { userWidgetList: [{ id: 'w-1', name: 'Waiver' }], page: {} }

      mock.onGet(`${BASE}/widgets`).reply(response)

      const result = await service.listWebForms()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ pageSize: 20 })
    })

    it('passes custom page size and cursor', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/widgets`).reply({ userWidgetList: [], page: {} })

      await service.listWebForms(30, 'c-1')

      expect(mock.history[0].query).toMatchObject({ pageSize: 30, cursor: 'c-1' })
    })
  })

  describe('getWebForm', () => {
    it('fetches web form by ID', async () => {
      setOAuthToken(service)

      const response = { id: 'w-1', name: 'Waiver', status: 'ACTIVE' }

      mock.onGet(`${BASE}/widgets/w-1`).reply(response)

      const result = await service.getWebForm('w-1')

      expect(result).toEqual(response)
    })

    it('throws when widgetId is missing', async () => {
      setOAuthToken(service)
      await expect(service.getWebForm()).rejects.toThrow('Web Form ID is required.')
    })
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('fetches current user profile', async () => {
      setOAuthToken(service)

      const response = { id: 'user-1', email: 'alex@example.com', firstName: 'Alex' }

      mock.onGet(`${BASE}/users/me`).reply(response)

      const result = await service.getCurrentUser()

      expect(result).toEqual(response)
    })
  })

  describe('listUsers', () => {
    it('lists users with default page size', async () => {
      setOAuthToken(service)

      const response = { userInfoList: [{ id: 'user-1', email: 'a@b.com' }], page: {} }

      mock.onGet(`${BASE}/users`).reply(response)

      const result = await service.listUsers()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ pageSize: 20 })
    })

    it('passes custom page size and cursor', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/users`).reply({ userInfoList: [], page: {} })

      await service.listUsers(10, 'user-cursor')

      expect(mock.history[0].query).toMatchObject({ pageSize: 10, cursor: 'user-cursor' })
    })
  })

  // ── Groups ──

  describe('listGroups', () => {
    it('lists groups with default page size', async () => {
      setOAuthToken(service)

      const response = { groupInfoList: [{ groupId: 'g-1', groupName: 'Sales' }], page: {} }

      mock.onGet(`${BASE}/groups`).reply(response)

      const result = await service.listGroups()

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({ pageSize: 20 })
    })

    it('passes custom page size and cursor', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/groups`).reply({ groupInfoList: [], page: {} })

      await service.listGroups(40, 'g-cursor')

      expect(mock.history[0].query).toMatchObject({ pageSize: 40, cursor: 'g-cursor' })
    })
  })

  // ── List Agreement Documents ──

  describe('listAgreementDocuments', () => {
    it('lists documents for an agreement', async () => {
      setOAuthToken(service)

      const response = { documents: [{ id: 'doc-1', name: 'NDA.pdf', numPages: 4 }] }

      mock.onGet(`${BASE}/agreements/agr-1/documents`).reply(response)

      const result = await service.listAgreementDocuments('agr-1')

      expect(result).toEqual(response)
    })

    it('throws when agreementId is missing', async () => {
      setOAuthToken(service)
      await expect(service.listAgreementDocuments()).rejects.toThrow('Agreement is required.')
    })
  })

  // ── Dictionaries ──

  describe('getLibraryDocumentsDictionary', () => {
    it('returns formatted items from library documents', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/libraryDocuments`).reply({
        libraryDocumentList: [
          { id: 'lib-1', name: 'NDA Template', status: 'ACTIVE' },
          { id: 'lib-2', name: 'Offer Letter', status: 'ACTIVE' },
        ],
        page: { nextCursor: 'next-page' },
      })

      const result = await service.getLibraryDocumentsDictionary({})

      expect(result.items).toEqual([
        { label: 'NDA Template', value: 'lib-1', note: 'ACTIVE' },
        { label: 'Offer Letter', value: 'lib-2', note: 'ACTIVE' },
      ])
      expect(result.cursor).toBe('next-page')
      expect(mock.history[0].query).toMatchObject({ pageSize: 100 })
    })

    it('filters items by search term', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/libraryDocuments`).reply({
        libraryDocumentList: [
          { id: 'lib-1', name: 'NDA Template', status: 'ACTIVE' },
          { id: 'lib-2', name: 'Offer Letter', status: 'ACTIVE' },
        ],
        page: {},
      })

      const result = await service.getLibraryDocumentsDictionary({ search: 'nda' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('lib-1')
    })

    it('handles empty list', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/libraryDocuments`).reply({ libraryDocumentList: [], page: {} })

      const result = await service.getLibraryDocumentsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })
  })

  describe('getAgreementsDictionary', () => {
    it('returns formatted items from agreements', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements`).reply({
        userAgreementList: [
          { id: 'agr-1', name: 'NDA', status: 'SIGNED' },
        ],
        page: {},
      })

      const result = await service.getAgreementsDictionary({})

      expect(result.items).toEqual([
        { label: 'NDA', value: 'agr-1', note: 'SIGNED' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements`).reply({
        userAgreementList: [
          { id: 'agr-1', name: 'NDA', status: 'SIGNED' },
          { id: 'agr-2', name: 'Contract', status: 'OUT_FOR_SIGNATURE' },
        ],
        page: {},
      })

      const result = await service.getAgreementsDictionary({ search: 'contract' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('agr-2')
    })
  })

  describe('getGroupsDictionary', () => {
    it('returns formatted items from groups', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/groups`).reply({
        groupInfoList: [
          { groupId: 'g-1', groupName: 'Sales', isDefaultGroup: true },
          { groupId: 'g-2', groupName: 'Legal', isDefaultGroup: false },
        ],
        page: { nextCursor: 'g-next' },
      })

      const result = await service.getGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'Sales', value: 'g-1', note: 'Default group' },
        { label: 'Legal', value: 'g-2', note: undefined },
      ])
      expect(result.cursor).toBe('g-next')
    })

    it('filters by search term', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/groups`).reply({
        groupInfoList: [
          { groupId: 'g-1', groupName: 'Sales', isDefaultGroup: true },
          { groupId: 'g-2', groupName: 'Legal', isDefaultGroup: false },
        ],
        page: {},
      })

      const result = await service.getGroupsDictionary({ search: 'legal' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('g-2')
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws with hint for known status codes', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements/bad-id`).replyWithError({
        message: 'Not Found',
        body: { message: 'Agreement not found', code: 'INVALID_AGREEMENT_ID' },
        status: 404,
      })

      await expect(service.getAgreement('bad-id')).rejects.toThrow('Not found')
    })

    it('throws raw message for unknown status codes', async () => {
      setOAuthToken(service)

      mock.onGet(`${BASE}/agreements/bad-id`).replyWithError({
        message: 'Internal Server Error',
        body: { message: 'Something broke' },
        status: 500,
      })

      await expect(service.getAgreement('bad-id')).rejects.toThrow('Something broke')
    })

    it('throws when access token is missing', async () => {
      service.request = { headers: {} }

      await expect(service.getCurrentUser()).rejects.toThrow('Access token is not available')
    })

    it('throws when composite token has no api access point', async () => {
      service.request = { headers: { 'oauth-access-token': 'token-only-no-delimiter' } }

      await expect(service.getCurrentUser()).rejects.toThrow('API access point is unavailable')
    })
  })
})
