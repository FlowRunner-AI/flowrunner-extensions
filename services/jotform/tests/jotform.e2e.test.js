'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Jotform Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('jotform')
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

  // ── User Account ──

  describe('getMonthlyUserUsage', () => {
    it('returns usage data with expected shape', async () => {
      const result = await service.getMonthlyUserUsage()

      expect(result).toHaveProperty('content')
      expect(result.content).toHaveProperty('username')
      expect(result.content).toHaveProperty('submissions')
      expect(result.content).toHaveProperty('form_count')
    })
  })

  // ── Dictionary ──

  describe('getUserFormsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getUserFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters forms by search term without error', async () => {
      const result = await service.getUserFormsDictionary({ search: 'zzzz-no-match' })

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('supports pagination via cursor', async () => {
      const result = await service.getUserFormsDictionary({ cursor: 0 })

      expect(result).toHaveProperty('cursor')
      expect(typeof result.cursor).toBe('number')
    })
  })

  // ── User Submissions ──

  describe('getUserSubmissions', () => {
    it('returns submissions with expected shape', async () => {
      const result = await service.getUserSubmissions(0, 5)

      expect(result).toHaveProperty('content')
      expect(Array.isArray(result.content)).toBe(true)
      expect(result).toHaveProperty('resultSet')
    })
  })

  // ── Form-specific operations (require a formId in testValues) ──

  describe('form-specific operations', () => {
    it('getFormQuestions returns questions for a form', async () => {
      if (!testValues.formId) {
        console.log('Skipping getFormQuestions: set testValues.formId in e2e-config.json')
        return
      }

      const result = await service.getFormQuestions(testValues.formId)

      expect(result).toHaveProperty('content')
      expect(typeof result.content).toBe('object')
    })

    it('getFormSubmissions returns submissions for a form', async () => {
      if (!testValues.formId) {
        console.log('Skipping getFormSubmissions: set testValues.formId in e2e-config.json')
        return
      }

      const result = await service.getFormSubmissions(testValues.formId, 0, 5)

      expect(result).toHaveProperty('content')
      expect(Array.isArray(result.content)).toBe(true)
      expect(result).toHaveProperty('resultSet')
    })
  })

  // ── Form lifecycle: create + add questions + delete ──

  describe('createForm + addQuestionsToForm', () => {
    let createdFormId

    it('creates a new form', async () => {
      const questions = [
        { type: 'control_textbox', text: 'E2E Test Field', order: 1, name: 'e2eField1' },
      ]

      const result = await service.createForm(`E2E Test Form ${Date.now()}`, questions)

      expect(result).toHaveProperty('content')
      expect(result.content).toHaveProperty('id')
      expect(result.content).toHaveProperty('status', 'ENABLED')
      createdFormId = result.content.id
    })

    it('adds questions to the created form', async () => {
      if (!createdFormId) {
        console.log('Skipping addQuestionsToForm: no form was created')
        return
      }

      const newQuestions = [
        { type: 'control_email', text: 'Email Address', order: 3, name: 'email3' },
      ]

      const result = await service.addQuestionsToForm(createdFormId, newQuestions)

      expect(result).toHaveProperty('content')
    })

    it('retrieves questions from the created form', async () => {
      if (!createdFormId) {
        console.log('Skipping getFormQuestions: no form was created')
        return
      }

      const result = await service.getFormQuestions(createdFormId)

      expect(result).toHaveProperty('content')
      expect(typeof result.content).toBe('object')
    })

    // Note: Jotform API does not have a delete form endpoint exposed in this service,
    // so the created form will remain in the account. The developer should clean up
    // test forms manually if needed.
  })
})
