'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Formstack Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('formstack')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Folders ──

  describe('listFolders', () => {
    it('returns folders with expected shape', async () => {
      const result = await service.listFolders()

      expect(result).toHaveProperty('folders')
      expect(Array.isArray(result.folders)).toBe(true)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('returns paginated forms list', async () => {
      const result = await service.listForms(undefined, undefined, 1, 10)

      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('forms')
      expect(Array.isArray(result.forms)).toBe(true)
      expect(result.page).toHaveProperty('pageNumber')
      expect(result.page).toHaveProperty('totalElements')
    })
  })

  describe('form lifecycle (create, get, copy, delete)', () => {
    let createdFormId
    let copiedFormId

    it('creates a new form', async () => {
      const result = await service.createForm('E2E Test Form')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
      createdFormId = String(result.id)
    })

    it('retrieves the created form', async () => {
      const result = await service.getForm(createdFormId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })

    it('copies the created form', async () => {
      const result = await service.copyForm(createdFormId)

      expect(result).toHaveProperty('id')
      copiedFormId = String(result.id)
    })

    it('deletes the copied form', async () => {
      const result = await service.deleteForm(copiedFormId)

      expect(result).toHaveProperty('success')
    })

    it('deletes the created form', async () => {
      const result = await service.deleteForm(createdFormId)

      expect(result).toHaveProperty('success')
    })
  })

  // ── Fields ──

  describe('field lifecycle (create form, add field, list fields, delete form)', () => {
    let formId

    it('creates a form for field testing', async () => {
      const result = await service.createForm('E2E Field Test Form')

      expect(result).toHaveProperty('id')
      formId = String(result.id)
    })

    it('creates a text field on the form', async () => {
      const result = await service.createField(formId, 'Text', 'Test Text Field')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('label')
    })

    it('creates an email field on the form', async () => {
      const result = await service.createField(formId, 'Email', 'Test Email Field')

      expect(result).toHaveProperty('id')
    })

    it('lists fields on the form', async () => {
      const result = await service.listFormFields(formId)

      expect(result).toHaveProperty('fields')
      expect(Array.isArray(result.fields)).toBe(true)
      expect(result.fields.length).toBeGreaterThanOrEqual(2)
    })

    it('cleans up the test form', async () => {
      await service.deleteForm(formId)
    })
  })

  // ── Submissions ──

  describe('submission lifecycle', () => {
    let formId
    let textFieldId
    let submissionId

    it('creates a form with a text field for submission testing', async () => {
      const form = await service.createForm('E2E Submission Test Form')

      formId = String(form.id)

      const field = await service.createField(formId, 'Text', 'Notes')

      textFieldId = String(field.id)
    })

    it('creates a submission', async () => {
      const result = await service.createSubmission(formId, [
        { field: textFieldId, value: 'E2E test submission value' },
      ])

      expect(result).toHaveProperty('id')
      submissionId = String(result.id)
    })

    it('lists submissions for the form', async () => {
      const result = await service.listSubmissions(formId, undefined, undefined, undefined, undefined, true)

      expect(result).toHaveProperty('submissions')
      expect(Array.isArray(result.submissions)).toBe(true)
      expect(result.submissions.length).toBeGreaterThanOrEqual(1)
    })

    it('retrieves the submission by id', async () => {
      const result = await service.getSubmission(submissionId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('data')
    })

    it('deletes the submission', async () => {
      const result = await service.deleteSubmission(submissionId)

      expect(result).toHaveProperty('success')
    })

    it('cleans up the test form', async () => {
      await service.deleteForm(formId)
    })
  })

  // ── Webhooks ──

  describe('webhook lifecycle', () => {
    let formId
    let webhookId

    it('creates a form for webhook testing', async () => {
      const form = await service.createForm('E2E Webhook Test Form')

      formId = String(form.id)
    })

    it('creates a webhook', async () => {
      const result = await service.createWebhook(formId, 'https://example.com/e2e-test-hook')

      expect(result).toHaveProperty('id')
      webhookId = String(result.id)
    })

    it('lists webhooks for the form', async () => {
      const result = await service.listWebhooks(formId)

      expect(result).toHaveProperty('webhooks')
      expect(Array.isArray(result.webhooks)).toBe(true)
      expect(result.webhooks.length).toBeGreaterThanOrEqual(1)
    })

    it('deletes the webhook', async () => {
      const result = await service.deleteWebhook(formId, webhookId)

      expect(result).toHaveProperty('success')
    })

    it('cleans up the test form', async () => {
      await service.deleteForm(formId)
    })
  })

  // ── Confirmations ──

  describe('listConfirmations', () => {
    let formId

    it('creates a form for confirmation testing', async () => {
      const form = await service.createForm('E2E Confirmation Test Form')

      formId = String(form.id)
    })

    it('lists confirmations for the form', async () => {
      const result = await service.listConfirmations(formId)

      expect(result).toHaveProperty('confirmations')
    })

    it('cleans up the test form', async () => {
      await service.deleteForm(formId)
    })
  })

  // ── Dictionaries ──

  describe('getFormsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getFoldersDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getFoldersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })
  })
})
