'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('PandaDoc Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('pandadoc')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Members ──

  describe('members', () => {
    let membershipId

    it('lists workspace members', async () => {
      const result = await service.listMembers()

      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)

      membershipId = result.results[0].membership_id
    })

    it('gets a single member', async () => {
      const result = await service.getMember(membershipId)

      expect(result).toHaveProperty('membership_id', membershipId)
      expect(result).toHaveProperty('email')
    })
  })

  // ── Documents (read) ──

  describe('documents (read)', () => {
    it('lists documents', async () => {
      const result = await service.listDocuments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 5)

      expect(Array.isArray(result.results)).toBe(true)
    })

    it('gets the status and details of a document', async () => {
      const list = await service.listDocuments(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 1)

      if (!list.results.length) {
        console.log('Skipping document status/details: the workspace has no documents')

        return
      }

      const documentId = list.results[0].id

      const status = await service.getDocumentStatus(documentId)

      expect(status).toHaveProperty('id', documentId)
      expect(status).toHaveProperty('status')

      const details = await service.getDocumentDetails(documentId)

      expect(details).toHaveProperty('id', documentId)
      expect(details).toHaveProperty('recipients')
    })
  })

  // ── Templates ──

  describe('templates', () => {
    it('lists templates', async () => {
      const result = await service.listTemplates(undefined, undefined, undefined, 5)

      expect(Array.isArray(result.results)).toBe(true)
    })

    it('gets template details', async () => {
      const list = await service.listTemplates(undefined, undefined, undefined, 1)

      if (!list.results.length) {
        console.log('Skipping getTemplateDetails: the workspace has no templates')

        return
      }

      const result = await service.getTemplateDetails(list.results[0].id)

      expect(result).toHaveProperty('id', list.results[0].id)
      expect(result).toHaveProperty('roles')
    })
  })

  // ── Contacts lifecycle ──

  describe('contacts', () => {
    let contactId

    it('creates a contact', async () => {
      const result = await service.createContact(
        `e2e+${ SUFFIX }@flowrunner.test`,
        'E2E',
        'Tester',
        'FlowRunner',
        'QA'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email', `e2e+${ SUFFIX }@flowrunner.test`)

      contactId = result.id
    })

    it('lists contacts filtered by email', async () => {
      const result = await service.listContacts(`e2e+${ SUFFIX }@flowrunner.test`)

      expect(Array.isArray(result.results)).toBe(true)
    })

    it('gets the created contact', async () => {
      const result = await service.getContact(contactId)

      expect(result).toHaveProperty('id', contactId)
    })

    it('updates the created contact', async () => {
      const result = await service.updateContact(contactId, undefined, undefined, undefined, undefined, 'VP Engineering')

      expect(result).toHaveProperty('job_title', 'VP Engineering')
    })

    it('deletes the created contact', async () => {
      const result = await service.deleteContact(contactId)

      expect(result).toEqual({ success: true, contactId })
    })
  })

  // ── Folders ──

  describe('folders', () => {
    it('creates a document folder and lists it back', async () => {
      const created = await service.createDocumentFolder(`E2E Folder ${ SUFFIX }`)

      expect(created).toHaveProperty('uuid')

      const list = await service.listDocumentFolders(undefined, 100)

      expect(Array.isArray(list.results)).toBe(true)
    })

    it('lists template folders', async () => {
      const result = await service.listTemplateFolders(undefined, 10)

      expect(Array.isArray(result.results)).toBe(true)
    })
  })

  // ── Webhooks lifecycle ──

  describe('webhook subscriptions', () => {
    let webhookUuid

    it('creates a webhook subscription', async () => {
      const result = await service.createWebhookSubscription(
        `E2E Hook ${ SUFFIX }`,
        'https://example.com/flowrunner-e2e-hook',
        ['Document State Changed'],
        ['Fields']
      )

      expect(result).toHaveProperty('uuid')
      expect(result.triggers).toContain('document_state_changed')

      webhookUuid = result.uuid
    })

    it('lists webhook subscriptions', async () => {
      const result = await service.listWebhookSubscriptions()

      expect(result).toBeDefined()
    })

    it('deletes the created webhook subscription', async () => {
      const result = await service.deleteWebhookSubscription(webhookUuid)

      expect(result).toEqual({ success: true, uuid: webhookUuid })
    })
  })

  // ── API logs ──

  describe('api logs', () => {
    it('lists api log events and fetches one', async () => {
      const list = await service.listApiLogEvents(undefined, undefined, undefined, undefined, 5)

      expect(Array.isArray(list.results)).toBe(true)

      if (!list.results.length) {
        console.log('Skipping getApiLogEvent: no log events available')

        return
      }

      const result = await service.getApiLogEvent(list.results[0].id)

      expect(result).toHaveProperty('id', list.results[0].id)
    })
  })

  // ── Document lifecycle from a template ──

  describe('document lifecycle', () => {
    let documentId

    it('creates a document from a template', async () => {
      const { templateId, recipientEmail } = testValues

      if (!templateId || !recipientEmail) {
        console.log('Skipping createDocumentFromTemplate: testValues.templateId or testValues.recipientEmail not set')

        return
      }

      const result = await service.createDocumentFromTemplate(
        `E2E Document ${ SUFFIX }`,
        templateId,
        [{ email: recipientEmail, first_name: 'E2E', last_name: 'Tester', role: testValues.templateRole }]
      )

      expect(result).toHaveProperty('id')

      documentId = result.id
    })

    it('renames the created document', async () => {
      if (!documentId) {
        console.log('Skipping updateDocumentName: no document was created')

        return
      }

      // A freshly created document must reach document.draft before it can be renamed.
      for (let attempt = 0; attempt < 15; attempt++) {
        const status = await service.getDocumentStatus(documentId)

        if (status.status !== 'document.uploaded') {
          break
        }

        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      const result = await service.updateDocumentName(documentId, `E2E Document ${ SUFFIX } (renamed)`)

      expect(result).toMatchObject({ success: true, documentId })
    }, 60000)

    it('sends the created document silently and creates a signing link', async () => {
      const { recipientEmail } = testValues

      if (!documentId) {
        console.log('Skipping sendDocument: no document was created')

        return
      }

      const sent = await service.sendDocument(documentId, 'E2E test', 'Please review', true)

      expect(sent).toHaveProperty('status')

      const link = await service.createDocumentLink(documentId, recipientEmail, 3600)

      expect(link).toHaveProperty('sessionId')
      expect(link.shareLink).toContain(link.sessionId)
    }, 60000)

    it('deletes the created document', async () => {
      if (!documentId) {
        console.log('Skipping deleteDocument: no document was created')

        return
      }

      const result = await service.deleteDocument(documentId)

      expect(result).toEqual({ success: true, documentId })
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('returns templates for selection', async () => {
      const result = await service.getTemplatesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns document folders for selection', async () => {
      const result = await service.getDocumentFoldersDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('returns contacts for selection', async () => {
      const result = await service.getContactsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('returns documents for selection', async () => {
      const result = await service.getDocumentsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('throws a formatted error for a missing document', async () => {
      await expect(service.getDocumentStatus('this-document-does-not-exist'))
        .rejects.toThrow(/PandaDoc API error/)
    })
  })
})
