'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Tally Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('tally')
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

  // ── Account ──

  describe('getCurrentUser', () => {
    it('returns the current user profile', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('subscriptionPlan')
    })
  })

  describe('listWorkspaces', () => {
    it('returns a paginated list of workspaces', async () => {
      const result = await service.listWorkspaces(1)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Forms CRUD ──

  describe('forms lifecycle', () => {
    let createdFormId

    it('creates a new form', async () => {
      const blocks = [
        {
          uuid: 'e2e-test-uuid-title',
          type: 'FORM_TITLE',
          groupUuid: 'e2e-test-group-uuid',
          groupType: 'TEXT',
          payload: { title: 'E2E Test Form', html: 'E2E Test Form' },
        },
      ]

      const result = await service.createForm('Draft', blocks)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
      createdFormId = result.id
    })

    it('lists forms including the created one', async () => {
      const result = await service.listForms(1, 50)

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (createdFormId) {
        const found = result.items.find(f => f.id === createdFormId)
        expect(found).toBeDefined()
      }
    })

    it('gets the created form by id', async () => {
      if (!createdFormId) {
        console.log('Skipping: no form was created')
        return
      }

      const result = await service.getForm(createdFormId)

      expect(result).toHaveProperty('id', createdFormId)
      expect(result).toHaveProperty('blocks')
    })

    it('updates the created form', async () => {
      if (!createdFormId) {
        console.log('Skipping: no form was created')
        return
      }

      const result = await service.updateForm(createdFormId, 'E2E Updated Form')

      expect(result).toHaveProperty('id', createdFormId)
    })

    it('deletes the created form', async () => {
      if (!createdFormId) {
        console.log('Skipping: no form was created')
        return
      }

      const result = await service.deleteForm(createdFormId)

      expect(result).toEqual({ deleted: true, formId: createdFormId })
    })
  })

  // ── Questions ──

  describe('listFormQuestions', () => {
    it('lists questions for a form', async () => {
      const { formId } = testValues

      if (!formId) {
        console.log('Skipping: testValues.formId not set')
        return
      }

      const result = await service.listFormQuestions(formId)

      expect(result).toHaveProperty('questions')
      expect(Array.isArray(result.questions)).toBe(true)
    })
  })

  // ── Submissions ──

  describe('listSubmissions', () => {
    it('lists submissions for a form', async () => {
      const { formId } = testValues

      if (!formId) {
        console.log('Skipping: testValues.formId not set')
        return
      }

      const result = await service.listSubmissions(formId, 'All', undefined, undefined, undefined, 1, 10)

      expect(result).toHaveProperty('submissions')
      expect(Array.isArray(result.submissions)).toBe(true)
    })
  })

  describe('getSubmission', () => {
    it('gets a specific submission', async () => {
      const { formId, submissionId } = testValues

      if (!formId || !submissionId) {
        console.log('Skipping: testValues.formId or testValues.submissionId not set')
        return
      }

      const result = await service.getSubmission(formId, submissionId)

      expect(result).toHaveProperty('submission')
      expect(result.submission).toHaveProperty('id', submissionId)
    })
  })

  // ── Webhooks ──

  describe('webhooks lifecycle', () => {
    let createdWebhookId
    const { formId } = {} // will be filled from testValues

    it('lists webhooks', async () => {
      const result = await service.listWebhooks(1, 25)

      expect(result).toHaveProperty('webhooks')
      expect(Array.isArray(result.webhooks)).toBe(true)
    })

    it('creates a webhook', async () => {
      const fId = testValues.formId

      if (!fId) {
        console.log('Skipping: testValues.formId not set')
        return
      }

      const result = await service.createWebhook(fId, 'https://e2e-test.example.com/webhook')

      expect(result).toHaveProperty('id')
      createdWebhookId = result.id
    })

    it('updates the created webhook', async () => {
      const fId = testValues.formId

      if (!fId || !createdWebhookId) {
        console.log('Skipping: no webhook was created or testValues.formId not set')
        return
      }

      const result = await service.updateWebhook(createdWebhookId, fId, 'https://e2e-test.example.com/webhook-updated', true)

      expect(result).toEqual({ updated: true, webhookId: createdWebhookId })
    })

    it('deletes the created webhook', async () => {
      if (!createdWebhookId) {
        console.log('Skipping: no webhook was created')
        return
      }

      const result = await service.deleteWebhook(createdWebhookId)

      expect(result).toEqual({ deleted: true, webhookId: createdWebhookId })
    })
  })

  // ── Dictionary ──

  describe('getFormsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.getFormsDictionary({ search: 'nonexistent-e2e-form-xyz' })

      expect(result).toHaveProperty('items')
      expect(result.items).toHaveLength(0)
    })
  })
})
