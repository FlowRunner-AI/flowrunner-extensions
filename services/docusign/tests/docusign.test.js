'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const ACCOUNT_ID = 'test-account-id'
const BASE_URI = 'https://demo.docusign.net'
const DELIMITER = '::meta::'
const COMPOSITE_TOKEN = `${ACCESS_TOKEN}${DELIMITER}${ACCOUNT_ID}${DELIMITER}${BASE_URI}`
const API_BASE = `${BASE_URI}/restapi/v2.1/accounts/${ACCOUNT_ID}`
const OAUTH_HOST = 'https://account-d.docusign.com'

function setOAuthToken(service, token) {
  service.request = { headers: { 'oauth-access-token': token || COMPOSITE_TOKEN } }
}

describe('DocuSign Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      environment: 'Demo',
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
          expect.objectContaining({ name: 'environment', required: true }),
        ])
      )
    })

    it('environment config has CHOICE type with correct options', () => {
      const items = sandbox.getConfigItems()
      const envItem = items.find(i => i.name === 'environment')

      expect(envItem.type).toBe('CHOICE')
      expect(envItem.options).toEqual(['Production', 'Demo'])
      expect(envItem.defaultValue).toBe('Production')
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL for Demo environment', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${OAUTH_HOST}/oauth/auth`)
      expect(url).toContain('response_type=code')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('scope=signature+extended')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches user info', async () => {
      const tokenResponse = {
        access_token: 'new-access-token',
        expires_in: 3600,
        refresh_token: 'new-refresh-token',
      }

      const userInfoResponse = {
        name: 'Test User',
        email: 'test@example.com',
        accounts: [
          {
            account_id: 'acc-123',
            base_uri: 'https://demo.docusign.net',
            account_name: 'Test Account',
            is_default: true,
          },
        ],
      }

      mock.onPost(`${OAUTH_HOST}/oauth/token`).reply(tokenResponse)
      mock.onGet(`${OAUTH_HOST}/oauth/userinfo`).reply(userInfoResponse)

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result.token).toContain('new-access-token')
      expect(result.token).toContain(`${DELIMITER}acc-123${DELIMITER}https://demo.docusign.net`)
      expect(result.expirationInSeconds).toBe(3600)
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.connectionIdentityName).toBe('Test User')
      expect(result.overwrite).toBe(true)
      expect(result.userData).toEqual({
        accountId: 'acc-123',
        baseUri: 'https://demo.docusign.net',
        accountName: 'Test Account',
        email: 'test@example.com',
      })

      // Verify token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${OAUTH_HOST}/oauth/token`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
      expect(mock.history[0].headers.Authorization).toMatch(/^Basic /)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain('code=auth-code-123')

      // Verify userinfo request
      expect(mock.history[1].url).toBe(`${OAUTH_HOST}/oauth/userinfo`)
      expect(mock.history[1].headers.Authorization).toBe('Bearer new-access-token')
    })

    it('uses first account when no default account found', async () => {
      mock.onPost(`${OAUTH_HOST}/oauth/token`).reply({
        access_token: 'at-1',
        expires_in: 3600,
        refresh_token: 'rt-1',
      })

      mock.onGet(`${OAUTH_HOST}/oauth/userinfo`).reply({
        name: 'User',
        email: 'user@test.com',
        accounts: [
          {
            account_id: 'first-acc',
            base_uri: 'https://demo.docusign.net',
            account_name: 'First',
            is_default: false,
          },
        ],
      })

      const result = await service.executeCallback({ code: 'c', redirectURI: 'https://cb' })

      expect(result.userData.accountId).toBe('first-acc')
    })

    it('throws when no accounts found', async () => {
      mock.onPost(`${OAUTH_HOST}/oauth/token`).reply({
        access_token: 'at-1',
        expires_in: 3600,
        refresh_token: 'rt-1',
      })

      mock.onGet(`${OAUTH_HOST}/oauth/userinfo`).reply({
        name: 'User',
        accounts: [],
      })

      await expect(
        service.executeCallback({ code: 'c', redirectURI: 'https://cb' })
      ).rejects.toThrow('No DocuSign account found')
    })

    it('throws when token exchange fails', async () => {
      mock.onPost(`${OAUTH_HOST}/oauth/token`).replyWithError({
        message: 'invalid_grant',
        body: { error: 'invalid_grant', error_description: 'The authorization code has expired' },
      })

      await expect(
        service.executeCallback({ code: 'bad-code', redirectURI: 'https://cb' })
      ).rejects.toThrow('DocuSign token exchange failed')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the token and returns composite token', async () => {
      setOAuthToken(service)

      mock.onPost(`${OAUTH_HOST}/oauth/token`).reply({
        access_token: 'refreshed-access-token',
        expires_in: 7200,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toContain('refreshed-access-token')
      expect(result.token).toContain(`${DELIMITER}${ACCOUNT_ID}${DELIMITER}${BASE_URI}`)
      expect(result.expirationInSeconds).toBe(7200)
      expect(result.refreshToken).toBe('new-refresh-token')

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
    })

    it('keeps old refresh token when new one is not provided', async () => {
      setOAuthToken(service)

      mock.onPost(`${OAUTH_HOST}/oauth/token`).reply({
        access_token: 'refreshed-at',
        expires_in: 3600,
      })

      const result = await service.refreshToken('keep-this-token')

      expect(result.refreshToken).toBe('keep-this-token')
    })
  })

  // ── Dictionary Methods ──

  describe('getTemplatesDictionary', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('returns formatted template list', async () => {
      mock.onGet(`${API_BASE}/templates`).reply({
        envelopeTemplates: [
          { name: 'NDA Template', templateId: 'tmpl-123' },
          { name: 'Contract Template', templateId: 'tmpl-456' },
        ],
        nextUri: null,
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'NDA Template',
        value: 'tmpl-123',
        note: 'ID: tmpl-123',
      })
      expect(result.cursor).toBeNull()
    })

    it('passes search text to query', async () => {
      mock.onGet(`${API_BASE}/templates`).reply({ envelopeTemplates: [], nextUri: null })

      await service.getTemplatesDictionary({ search: 'NDA' })

      expect(mock.history[0].query).toMatchObject({ search_text: 'NDA' })
    })

    it('handles pagination cursor', async () => {
      mock.onGet(`${API_BASE}/templates`).reply({
        envelopeTemplates: [{ name: 'T', templateId: 't-1' }],
        nextUri: '/next',
      })

      const result = await service.getTemplatesDictionary({ cursor: '50' })

      expect(mock.history[0].query).toMatchObject({ start_position: '50' })
      expect(result.cursor).toBe('100')
    })

    it('returns empty items when no templates exist', async () => {
      mock.onGet(`${API_BASE}/templates`).reply({ nextUri: null })

      const result = await service.getTemplatesDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeNull()
    })

    it('uses "Unnamed Template" for templates without name', async () => {
      mock.onGet(`${API_BASE}/templates`).reply({
        envelopeTemplates: [{ templateId: 't-1' }],
        nextUri: null,
      })

      const result = await service.getTemplatesDictionary({})

      expect(result.items[0].label).toBe('Unnamed Template')
    })
  })

  describe('getEnvelopesDictionary', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('returns formatted envelope list', async () => {
      mock.onGet(`${API_BASE}/envelopes`).reply({
        envelopes: [
          { emailSubject: 'NDA - John', envelopeId: 'env-123', status: 'sent' },
        ],
        nextUri: null,
      })

      const result = await service.getEnvelopesDictionary({})

      expect(result.items).toHaveLength(1)
      expect(result.items[0]).toEqual({
        label: 'NDA - John',
        value: 'env-123',
        note: 'Status: sent',
      })
      expect(result.cursor).toBeNull()

      expect(mock.history[0].query).toMatchObject({
        order_by: 'last_modified',
        order: 'desc',
      })
      expect(mock.history[0].query.from_date).toBeDefined()
    })

    it('uses envelope ID prefix when no subject', async () => {
      mock.onGet(`${API_BASE}/envelopes`).reply({
        envelopes: [{ envelopeId: 'abcdef12-3456-7890', status: 'completed' }],
        nextUri: null,
      })

      const result = await service.getEnvelopesDictionary({})

      expect(result.items[0].label).toBe('Envelope abcdef12')
    })

    it('handles pagination', async () => {
      mock.onGet(`${API_BASE}/envelopes`).reply({
        envelopes: [{ emailSubject: 'E', envelopeId: 'e-1', status: 'sent' }],
        nextUri: '/next',
      })

      const result = await service.getEnvelopesDictionary({ cursor: '0' })

      expect(result.cursor).toBe('50')
    })
  })

  describe('getTemplateRolesDictionary', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('returns roles from template', async () => {
      mock.onGet(`${API_BASE}/templates/tmpl-123`).reply({
        recipients: {
          signers: [
            { roleName: 'Signer 1' },
            { roleName: 'Manager' },
          ],
        },
      })

      const result = await service.getTemplateRolesDictionary({
        criteria: { templateId: 'tmpl-123' },
      })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        label: 'Signer 1',
        value: 'Signer 1',
        note: 'Role Name',
      })
      expect(result.cursor).toBeNull()
    })

    it('returns empty items when no templateId provided', async () => {
      const result = await service.getTemplateRolesDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
      expect(mock.history).toHaveLength(0)
    })

    it('filters roles by search text', async () => {
      mock.onGet(`${API_BASE}/templates/tmpl-1`).reply({
        recipients: {
          signers: [
            { roleName: 'Signer 1' },
            { roleName: 'Manager' },
          ],
        },
      })

      const result = await service.getTemplateRolesDictionary({
        search: 'sign',
        criteria: { templateId: 'tmpl-1' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Signer 1')
    })

    it('handles roles without roleName', async () => {
      mock.onGet(`${API_BASE}/templates/tmpl-1`).reply({
        recipients: { signers: [{}] },
      })

      const result = await service.getTemplateRolesDictionary({
        criteria: { templateId: 'tmpl-1' },
      })

      expect(result.items[0].label).toBe('Unnamed Role')
    })
  })

  // ── Envelopes ──

  describe('sendEnvelopeFromTemplate', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('sends envelope with correct body', async () => {
      const response = { envelopeId: 'env-1', status: 'sent', uri: '/envelopes/env-1' }
      mock.onPost(`${API_BASE}/envelopes`).reply(response)

      const result = await service.sendEnvelopeFromTemplate(
        'tmpl-1', 'Please sign', 'signer@test.com', 'Jane Doe', 'Signer 1', undefined, undefined
      )

      expect(result).toEqual(response)
      expect(mock.history[0].body).toEqual({
        templateId: 'tmpl-1',
        emailSubject: 'Please sign',
        status: 'sent',
        templateRoles: [
          { email: 'signer@test.com', name: 'Jane Doe', roleName: 'Signer 1' },
        ],
      })
    })

    it('includes optional emailBody and status', async () => {
      mock.onPost(`${API_BASE}/envelopes`).reply({ envelopeId: 'env-2' })

      await service.sendEnvelopeFromTemplate(
        'tmpl-1', 'Subject', 's@t.com', 'Name', 'Role', 'Custom body text', 'created'
      )

      expect(mock.history[0].body).toMatchObject({
        emailBlurb: 'Custom body text',
        status: 'created',
      })
    })

    it('sets auth header correctly', async () => {
      mock.onPost(`${API_BASE}/envelopes`).reply({ envelopeId: 'env-3' })

      await service.sendEnvelopeFromTemplate('t', 's', 'e@e.com', 'n', 'r')

      expect(mock.history[0].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
      expect(mock.history[0].headers.Accept).toBe('application/json')
      expect(mock.history[0].headers['Content-Type']).toBe('application/json')
    })

    it('throws when templateId is missing', async () => {
      await expect(service.sendEnvelopeFromTemplate(null, 's', 'e', 'n', 'r'))
        .rejects.toThrow('"Template" is required.')
    })

    it('throws when emailSubject is missing', async () => {
      await expect(service.sendEnvelopeFromTemplate('t', null, 'e', 'n', 'r'))
        .rejects.toThrow('"Email Subject" is required.')
    })

    it('throws when signerEmail is missing', async () => {
      await expect(service.sendEnvelopeFromTemplate('t', 's', null, 'n', 'r'))
        .rejects.toThrow('"Signer Email" is required.')
    })

    it('throws when signerName is missing', async () => {
      await expect(service.sendEnvelopeFromTemplate('t', 's', 'e', null, 'r'))
        .rejects.toThrow('"Signer Name" is required.')
    })

    it('throws when roleName is missing', async () => {
      await expect(service.sendEnvelopeFromTemplate('t', 's', 'e', 'n', null))
        .rejects.toThrow('"Role Name" is required.')
    })
  })

  describe('sendEnvelopeWithDocument', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('downloads document, base64-encodes it, and sends envelope', async () => {
      const docBytes = Buffer.from('fake-pdf-content')
      mock.onGet('https://files.example.com/doc.pdf').reply(docBytes)
      mock.onPost(`${API_BASE}/envelopes`).reply({ envelopeId: 'env-doc-1', status: 'sent' })

      const result = await service.sendEnvelopeWithDocument(
        'https://files.example.com/doc.pdf', 'contract.pdf', 'Sign this',
        'signer@test.com', 'Jane', undefined, undefined
      )

      expect(result).toEqual({ envelopeId: 'env-doc-1', status: 'sent' })

      // First request is the document download
      expect(mock.history[0].url).toBe('https://files.example.com/doc.pdf')
      expect(mock.history[0].encoding).toBeNull()

      // Second request is the envelope creation
      const body = mock.history[1].body

      expect(body.emailSubject).toBe('Sign this')
      expect(body.status).toBe('sent')
      expect(body.documents).toHaveLength(1)
      expect(body.documents[0].name).toBe('contract.pdf')
      expect(body.documents[0].fileExtension).toBe('pdf')
      expect(body.documents[0].documentId).toBe('1')
      expect(body.documents[0].documentBase64).toBe(docBytes.toString('base64'))
      expect(body.recipients.signers).toHaveLength(1)
      expect(body.recipients.signers[0]).toEqual({
        email: 'signer@test.com',
        name: 'Jane',
        recipientId: '1',
        routingOrder: '1',
      })
    })

    it('includes optional emailBody and status', async () => {
      mock.onGet('https://f.com/d.pdf').reply(Buffer.from('x'))
      mock.onPost(`${API_BASE}/envelopes`).reply({ envelopeId: 'e-1' })

      await service.sendEnvelopeWithDocument(
        'https://f.com/d.pdf', 'doc.pdf', 'Sub', 'e@t.com', 'N', 'Body text', 'created'
      )

      const body = mock.history[1].body

      expect(body.emailBlurb).toBe('Body text')
      expect(body.status).toBe('created')
    })

    it('throws when documentUrl is missing', async () => {
      await expect(service.sendEnvelopeWithDocument(null, 'n', 's', 'e', 'n'))
        .rejects.toThrow('"Document URL" is required.')
    })

    it('throws when documentName is missing', async () => {
      await expect(service.sendEnvelopeWithDocument('u', null, 's', 'e', 'n'))
        .rejects.toThrow('"Document Name" is required.')
    })

    it('throws when emailSubject is missing', async () => {
      await expect(service.sendEnvelopeWithDocument('u', 'n', null, 'e', 'n'))
        .rejects.toThrow('"Email Subject" is required.')
    })

    it('throws when signerEmail is missing', async () => {
      await expect(service.sendEnvelopeWithDocument('u', 'n', 's', null, 'n'))
        .rejects.toThrow('"Signer Email" is required.')
    })

    it('throws when signerName is missing', async () => {
      await expect(service.sendEnvelopeWithDocument('u', 'n', 's', 'e', null))
        .rejects.toThrow('"Signer Name" is required.')
    })
  })

  describe('getEnvelopeStatus', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('returns envelope status', async () => {
      const response = { envelopeId: 'env-1', status: 'completed', emailSubject: 'Sign' }
      mock.onGet(`${API_BASE}/envelopes/env-1`).reply(response)

      const result = await service.getEnvelopeStatus('env-1')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${API_BASE}/envelopes/env-1`)
      expect(mock.history[0].headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.getEnvelopeStatus(null)).rejects.toThrow('"Envelope" is required.')
    })

    it('throws on API error', async () => {
      mock.onGet(`${API_BASE}/envelopes/bad-id`).replyWithError({
        message: 'Not Found',
        body: { message: 'Envelope not found' },
      })

      await expect(service.getEnvelopeStatus('bad-id')).rejects.toThrow('Envelope not found')
    })
  })

  describe('listEnvelopes', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('lists envelopes with required fromDate', async () => {
      const response = { envelopes: [{ envelopeId: 'e-1' }], totalSetSize: '1', resultSetSize: '1' }
      mock.onGet(`${API_BASE}/envelopes`).reply(response)

      const result = await service.listEnvelopes('2024-01-01')

      expect(result).toEqual(response)
      expect(mock.history[0].query).toMatchObject({
        from_date: '2024-01-01',
        order_by: 'last_modified',
        order: 'desc',
      })
    })

    it('passes optional filters', async () => {
      mock.onGet(`${API_BASE}/envelopes`).reply({ envelopes: [] })

      await service.listEnvelopes('2024-01-01', 'completed', 'NDA', 10)

      expect(mock.history[0].query).toMatchObject({
        from_date: '2024-01-01',
        status: 'completed',
        search_text: 'NDA',
        count: '10',
      })
    })

    it('omits optional params when not provided', async () => {
      mock.onGet(`${API_BASE}/envelopes`).reply({ envelopes: [] })

      await service.listEnvelopes('2024-01-01')

      const query = mock.history[0].query

      expect(query.status).toBeUndefined()
      expect(query.search_text).toBeUndefined()
      expect(query.count).toBeUndefined()
    })

    it('throws when fromDate is missing', async () => {
      await expect(service.listEnvelopes(null)).rejects.toThrow('"From Date" is required.')
    })
  })

  describe('voidEnvelope', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('voids an envelope with reason', async () => {
      mock.onPut(`${API_BASE}/envelopes/env-1`).reply({ envelopeId: 'env-1', status: 'voided' })

      const result = await service.voidEnvelope('env-1', 'Terms changed')

      expect(result).toEqual({ envelopeId: 'env-1', status: 'voided' })
      expect(mock.history[0].body).toEqual({
        status: 'voided',
        voidedReason: 'Terms changed',
      })
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.voidEnvelope(null, 'reason')).rejects.toThrow('"Envelope" is required.')
    })

    it('throws when voidReason is missing', async () => {
      await expect(service.voidEnvelope('env-1', null)).rejects.toThrow('"Void Reason" is required.')
    })
  })

  describe('resendEnvelope', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('resends envelope notifications', async () => {
      mock.onPut(`${API_BASE}/envelopes/env-1`).reply({ envelopeId: 'env-1' })

      const result = await service.resendEnvelope('env-1')

      expect(result).toEqual({ envelopeId: 'env-1' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toMatchObject({ resend_envelope: 'true' })
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.resendEnvelope(null)).rejects.toThrow('"Envelope" is required.')
    })
  })

  // ── Documents ──

  describe('downloadDocument', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('downloads document and returns content with contentType', async () => {
      const pdfData = Buffer.from('pdf-binary-data')
      mock.onGet(`${API_BASE}/envelopes/env-1/documents/1`).reply(pdfData)

      const result = await service.downloadDocument('env-1', '1')

      expect(result.contentType).toBe('application/pdf')
      expect(result.content).toEqual(pdfData)
      expect(mock.history[0].headers.Accept).toBe('application/pdf')
      expect(mock.history[0].encoding).toBeNull()
    })

    it('supports combined and certificate document IDs', async () => {
      mock.onGet(`${API_BASE}/envelopes/env-1/documents/combined`).reply(Buffer.from('combined'))

      const result = await service.downloadDocument('env-1', 'combined')

      expect(result.contentType).toBe('application/pdf')
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.downloadDocument(null, '1')).rejects.toThrow('"Envelope" is required.')
    })

    it('throws when documentId is missing', async () => {
      await expect(service.downloadDocument('env-1', null)).rejects.toThrow('"Document ID" is required.')
    })
  })

  describe('listEnvelopeDocuments', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('lists documents in an envelope', async () => {
      const response = {
        envelopeId: 'env-1',
        envelopeDocuments: [{ documentId: '1', name: 'Contract.pdf', type: 'content' }],
      }

      mock.onGet(`${API_BASE}/envelopes/env-1/documents`).reply(response)

      const result = await service.listEnvelopeDocuments('env-1')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${API_BASE}/envelopes/env-1/documents`)
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.listEnvelopeDocuments(null)).rejects.toThrow('"Envelope" is required.')
    })
  })

  // ── Recipients ──

  describe('getEnvelopeRecipients', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('returns recipients for an envelope', async () => {
      const response = {
        signers: [{ email: 'signer@test.com', name: 'Signer', status: 'completed' }],
        carbonCopies: [],
      }

      mock.onGet(`${API_BASE}/envelopes/env-1/recipients`).reply(response)

      const result = await service.getEnvelopeRecipients('env-1')

      expect(result).toEqual(response)
      expect(mock.history[0].url).toBe(`${API_BASE}/envelopes/env-1/recipients`)
    })

    it('throws when envelopeId is missing', async () => {
      await expect(service.getEnvelopeRecipients(null)).rejects.toThrow('"Envelope" is required.')
    })
  })

  // ── Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('creates a new connect configuration', async () => {
      mock.onPost(`${API_BASE}/connect`).reply({ connectId: 'conn-123' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flowrunner.com/callback',
        events: [{ name: 'onEnvelopeCompleted' }, { name: 'onEnvelopeSent' }],
        connectionId: 'cx-1',
      })

      expect(result).toEqual({ webhookData: { connectId: 'conn-123' } })

      const body = mock.history[0].body

      expect(body.urlToPublishTo).toBe('https://flowrunner.com/callback?connectionId=cx-1')
      expect(body.envelopeEvents).toEqual(['completed', 'sent'])
      expect(body.configurationType).toBe('custom')
      expect(body.deliveryMode).toBe('SIM')
      expect(body.eventData).toMatchObject({ version: 'restv2.1', format: 'json' })
    })

    it('deletes old connect config before creating new one', async () => {
      mock.onDelete(`${API_BASE}/connect/old-conn`).reply({})
      mock.onPost(`${API_BASE}/connect`).reply({ connectId: 'new-conn' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://flowrunner.com/cb',
        events: [{ name: 'onEnvelopeCompleted' }],
        webhookData: { connectId: 'old-conn' },
      })

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/connect/old-conn`)
      expect(result.webhookData.connectId).toBe('new-conn')
    })

    it('continues if old connect deletion fails', async () => {
      mock.onDelete(`${API_BASE}/connect/gone`).replyWithError({ message: 'Not found' })
      mock.onPost(`${API_BASE}/connect`).reply({ connectId: 'new-c' })

      const result = await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.com',
        events: [{ name: 'onEnvelopeSent' }],
        webhookData: { connectId: 'gone' },
      })

      expect(result.webhookData.connectId).toBe('new-c')
    })

    it('appends connectionId with & when URL already has query params', async () => {
      mock.onPost(`${API_BASE}/connect`).reply({ connectId: 'c-1' })

      await service.handleTriggerUpsertWebhook({
        callbackUrl: 'https://cb.com/hook?existing=true',
        events: [{ name: 'onEnvelopeCompleted' }],
        connectionId: 'cx-2',
      })

      expect(mock.history[0].body.urlToPublishTo).toBe('https://cb.com/hook?existing=true&connectionId=cx-2')
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('resolves envelope-completed event', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          event: 'envelope-completed',
          data: {
            envelopeId: 'env-1',
            status: 'completed',
            emailSubject: 'Sign this',
            sentDateTime: '2024-01-15T10:30:00Z',
            completedDateTime: '2024-01-16T14:20:00Z',
            sender: { email: 'sender@test.com', userName: 'Sender' },
            recipients: {
              signers: [{ email: 'signer@test.com', name: 'Signer', status: 'completed', signedDateTime: '2024-01-16T14:20:00Z' }],
            },
          },
        },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onEnvelopeCompleted')
      expect(result.events[0].data).toMatchObject({
        envelopeId: 'env-1',
        status: 'completed',
        emailSubject: 'Sign this',
      })
      expect(result.events[0].data.sender).toEqual({ email: 'sender@test.com', name: 'Sender' })
      expect(result.events[0].data.recipients[0]).toMatchObject({
        email: 'signer@test.com',
        name: 'Signer',
        status: 'completed',
      })
    })

    it('resolves envelope-sent event', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          event: 'envelope-sent',
          data: { envelopeId: 'env-2', status: 'sent', recipients: { signers: [] } },
        },
      })

      expect(result.events[0].name).toBe('onEnvelopeSent')
    })

    it('resolves envelope-declined event', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          event: 'envelope-declined',
          data: { envelopeId: 'env-3', status: 'declined', recipients: { signers: [] } },
        },
      })

      expect(result.events[0].name).toBe('onEnvelopeDeclined')
    })

    it('resolves envelope-voided event', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: {
          event: 'envelope-voided',
          data: { envelopeId: 'env-4', status: 'voided', voidedReason: 'Cancelled', recipients: { signers: [] } },
        },
      })

      expect(result.events[0].name).toBe('onEnvelopeVoided')
      expect(result.events[0].data.voidedReason).toBe('Cancelled')
    })

    it('returns empty events for unknown event type', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { event: 'unknown-event', data: {} },
      })

      expect(result.events).toEqual([])
    })

    it('returns empty events when body has no event', async () => {
      const result = await service.handleTriggerResolveEvents({ body: {} })

      expect(result.events).toEqual([])
    })

    it('returns empty events when body is missing', async () => {
      const result = await service.handleTriggerResolveEvents({})

      expect(result.events).toEqual([])
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns all trigger IDs', async () => {
      const result = await service.handleTriggerSelectMatched({
        triggers: [{ id: 't-1' }, { id: 't-2' }, { id: 't-3' }],
      })

      expect(result.ids).toEqual(['t-1', 't-2', 't-3'])
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    beforeEach(() => {
      setOAuthToken(service)
    })

    it('deletes connect configuration', async () => {
      mock.onDelete(`${API_BASE}/connect/conn-123`).reply({})

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { connectId: 'conn-123' },
      })

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${API_BASE}/connect/conn-123`)
      expect(result).toEqual({ webhookData: {} })
    })

    it('returns empty webhookData when no connectId', async () => {
      const result = await service.handleTriggerDeleteWebhook({ webhookData: {} })

      expect(result).toEqual({ webhookData: {} })
      expect(mock.history).toHaveLength(0)
    })

    it('does not throw when delete fails', async () => {
      mock.onDelete(`${API_BASE}/connect/gone`).replyWithError({ message: 'Not Found' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { connectId: 'gone' },
      })

      expect(result).toEqual({ webhookData: {} })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws when access token is missing', async () => {
      service.request = { headers: {} }

      await expect(service.getEnvelopeStatus('env-1')).rejects.toThrow(
        'Access token is not available'
      )
    })

    it('extracts error message from API error body', async () => {
      setOAuthToken(service)
      mock.onGet(`${API_BASE}/envelopes/bad`).replyWithError({
        message: 'Bad Request',
        body: { message: 'Invalid envelope ID format' },
      })

      await expect(service.getEnvelopeStatus('bad')).rejects.toThrow('Invalid envelope ID format')
    })

    it('extracts errorCode from API error body', async () => {
      setOAuthToken(service)
      mock.onGet(`${API_BASE}/envelopes/bad`).replyWithError({
        message: 'Error',
        body: { errorCode: 'ENVELOPE_NOT_FOUND' },
      })

      await expect(service.getEnvelopeStatus('bad')).rejects.toThrow('ENVELOPE_NOT_FOUND')
    })

    it('falls back to error message from mock when no body details', async () => {
      setOAuthToken(service)
      mock.onGet(`${API_BASE}/envelopes/bad`).replyWithError({})

      await expect(service.getEnvelopeStatus('bad')).rejects.toThrow()
    })
  })
})
