'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Gravity Forms Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('gravity-forms')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // A minimal but valid Gravity Forms form object (title + one text + one email field).
  const buildFormData = title => ({
    title,
    description: 'Created by the FlowRunner e2e test suite',
    labelPlacement: 'top_label',
    button: { type: 'text', text: 'Submit' },
    fields: [
      { id: 1, type: 'text', label: 'Name', isRequired: false },
      { id: 2, type: 'email', label: 'Email', isRequired: false },
    ],
  })

  // ── Forms: list & dictionary ──

  describe('getFormsList', () => {
    it('returns an array of forms', async () => {
      const result = await service.getFormsList()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getFormsListDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getFormsListDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  // ── Form lifecycle: create → get → update → delete ──

  describe('createForm + getForm + updateForm + deleteForm', () => {
    let formId

    it('creates a form', async () => {
      const result = await service.createForm(buildFormData(`E2E Form ${ suffix }`))

      expect(result).toHaveProperty('id')
      formId = String(result.id)
    })

    it('retrieves the created form', async () => {
      const result = await service.getForm(formId)

      expect(result).toHaveProperty('id')
      expect(String(result.id)).toBe(formId)
      expect(result).toHaveProperty('title', `E2E Form ${ suffix }`)
    })

    it('updates the form', async () => {
      const updated = buildFormData(`E2E Form Updated ${ suffix }`)
      const result = await service.updateForm(formId, updated)

      expect(result).toBeDefined()
    })

    it('permanently deletes the form', async () => {
      const result = await service.deleteForm(formId, true)

      expect(result).toBeDefined()
    })

    afterAll(async () => {
      if (formId) {
        try {
          await service.deleteForm(formId, true)
        } catch (e) {
          // already deleted — ignore
        }
      }
    })
  })

  // ── Submission, entries & notifications ──
  //
  // These operate on a dedicated throwaway form created here so the suite is
  // self-contained. testValues.formId can point at a pre-existing form if the
  // developer prefers to test against real data.

  describe('submission, entries and notifications lifecycle', () => {
    let formId
    let ownForm = false
    let entryId

    beforeAll(async () => {
      if (testValues.formId) {
        formId = String(testValues.formId)
      } else {
        const form = await service.createForm(buildFormData(`E2E Entry Form ${ suffix }`))
        formId = String(form.id)
        ownForm = true
      }
    })

    afterAll(async () => {
      if (ownForm && formId) {
        try {
          await service.deleteForm(formId, true)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })

    it('validates a submission without creating an entry', async () => {
      const result = await service.validateSubmission(formId, {
        input_1: 'Validation Only',
        input_2: 'validate@example.com',
      })

      expect(result).toHaveProperty('is_valid')
    })

    it('submits an entry through the full submission process', async () => {
      const result = await service.submitEntry(formId, {
        input_1: 'E2E Submitter',
        input_2: 'submit@example.com',
      })

      expect(result).toHaveProperty('is_valid')
    })

    it('creates an entry directly', async () => {
      const result = await service.createEntry(formId, {
        1: 'Direct Entry',
        2: 'direct@example.com',
      })

      expect(result).toHaveProperty('id')
      entryId = String(result.id)
    })

    it('retrieves the created entry', async () => {
      const result = await service.getEntry(entryId)

      expect(result).toHaveProperty('id')
      expect(String(result.id)).toBe(entryId)
    })

    it('updates the entry', async () => {
      const result = await service.updateEntry(entryId, { 1: 'Updated Direct Entry' })

      expect(result).toBeDefined()
    })

    it('lists entries for the form', async () => {
      const result = await service.getFormEntries(formId, 10, 1)

      expect(result).toHaveProperty('entries')
      expect(Array.isArray(result.entries)).toBe(true)
    })

    it('returns the entries dictionary for the form', async () => {
      const result = await service.getFormEntriesDictionary({ criteria: { formId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })

    it('sends notifications for the entry', async () => {
      const result = await service.sendEntryNotification(entryId, formId)

      // The API returns an array of processed notification ids (possibly empty
      // when the form has no notifications configured).
      expect(Array.isArray(result)).toBe(true)
    })

    it('permanently deletes the entry', async () => {
      const result = await service.deleteEntry(entryId, true)

      expect(result).toBeDefined()
    })
  })
})
