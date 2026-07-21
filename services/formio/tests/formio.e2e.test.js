'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Form.io Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('formio')
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

  // ── Connection ──

  describe('getCurrentUser', () => {
    it('returns a response (may be null for project-level API keys)', async () => {
      const result = await service.getCurrentUser()

      // Project-level API keys return null or a user object
      expect(result === null || typeof result === 'object').toBe(true)
    })
  })

  // ── Roles ──

  describe('listRoles', () => {
    it('returns an array of roles', async () => {
      const result = await service.listRoles()

      expect(Array.isArray(result)).toBe(true)
      if (result.length > 0) {
        expect(result[0]).toHaveProperty('_id')
        expect(result[0]).toHaveProperty('title')
      }
    })
  })

  // ── Forms CRUD ──

  describe('forms lifecycle', () => {
    let createdFormId

    it('creates a form', async () => {
      const components = [
        { type: 'textfield', key: 'testName', label: 'Test Name', input: true },
        { type: 'email', key: 'testEmail', label: 'Test Email', input: true },
      ]

      const result = await service.createForm(
        'E2E Test Form',
        'e2eTestForm',
        `e2e-test-form-${Date.now()}`,
        components,
        'Form',
        'Form',
      )

      expect(result).toHaveProperty('_id')
      expect(result.title).toBe('E2E Test Form')
      expect(result.name).toBe('e2eTestForm')
      expect(Array.isArray(result.components)).toBe(true)
      createdFormId = result._id
    })

    it('lists forms and finds the created one', async () => {
      const result = await service.listForms('Form', 50)

      expect(Array.isArray(result)).toBe(true)
      const found = result.find(f => f._id === createdFormId)
      expect(found).toBeDefined()
    })

    it('gets the created form by id', async () => {
      const result = await service.getForm(createdFormId)

      expect(result._id).toBe(createdFormId)
      expect(result.title).toBe('E2E Test Form')
      expect(Array.isArray(result.components)).toBe(true)
    })

    it('updates the created form', async () => {
      const result = await service.updateForm(createdFormId, 'E2E Test Form Updated')

      expect(result._id).toBe(createdFormId)
      expect(result.title).toBe('E2E Test Form Updated')
    })

    it('lists form actions', async () => {
      const result = await service.listFormActions(createdFormId)

      expect(Array.isArray(result)).toBe(true)
    })

    // ── Submissions CRUD (nested inside form lifecycle) ──

    describe('submissions lifecycle', () => {
      let createdSubmissionId

      it('creates a submission', async () => {
        const data = { testName: 'Jane Doe', testEmail: 'jane@example.com' }
        const result = await service.createSubmission(createdFormId, data)

        expect(result).toHaveProperty('_id')
        expect(result.data).toMatchObject(data)
        createdSubmissionId = result._id
      })

      it('lists submissions', async () => {
        const result = await service.listSubmissions(createdFormId)

        expect(Array.isArray(result)).toBe(true)
        expect(result.length).toBeGreaterThan(0)
      })

      it('gets the created submission', async () => {
        const result = await service.getSubmission(createdFormId, createdSubmissionId)

        expect(result._id).toBe(createdSubmissionId)
        expect(result.data).toHaveProperty('testName')
      })

      it('updates the submission', async () => {
        const data = { testName: 'Janet Doe', testEmail: 'janet@example.com' }
        const result = await service.updateSubmission(createdFormId, createdSubmissionId, data)

        expect(result._id).toBe(createdSubmissionId)
        expect(result.data).toMatchObject(data)
      })

      it('lists submissions with filter', async () => {
        const result = await service.listSubmissions(
          createdFormId,
          undefined,
          undefined,
          undefined,
          `data.testEmail=janet@example.com`,
        )

        expect(Array.isArray(result)).toBe(true)
      })

      it('deletes the submission', async () => {
        const result = await service.deleteSubmission(createdFormId, createdSubmissionId)

        expect(result).toEqual({ success: true })
      })
    })

    // ── Dictionary ──

    describe('getFormsDictionary', () => {
      it('returns items in dictionary format', async () => {
        const result = await service.getFormsDictionary({})

        expect(result).toHaveProperty('items')
        expect(Array.isArray(result.items)).toBe(true)
        if (result.items.length > 0) {
          expect(result.items[0]).toHaveProperty('label')
          expect(result.items[0]).toHaveProperty('value')
        }
      })

      it('filters by search', async () => {
        const result = await service.getFormsDictionary({ search: 'E2E Test' })

        expect(Array.isArray(result.items)).toBe(true)
      })
    })

    // ── Cleanup: delete the form last ──

    it('deletes the created form', async () => {
      const result = await service.deleteForm(createdFormId)

      expect(result).toEqual({ success: true })
    })
  })
})
