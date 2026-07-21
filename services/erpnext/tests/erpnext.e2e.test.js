'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('ERPNext Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('erpnext')
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

  // ToDo is a core Frappe DocType present on every site, is not submittable,
  // and only needs a `description` — ideal for a self-contained CRUD lifecycle.
  // Developers can override via testValues.crudDoctype / crudFields if desired.
  const crudDoctype = () => testValues.crudDoctype || 'ToDo'
  const crudCreateFields = (description) =>
    testValues.crudFields
      ? { ...testValues.crudFields, description }
      : { description }

  // ── List / Query ──

  describe('listDocuments', () => {
    it('lists documents of a DocType with the data array shape', async () => {
      const response = await service.listDocuments('User', undefined, ['name'], 5, 0)

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })

    it('applies filters and field selection', async () => {
      const response = await service.listDocuments(
        'User',
        [['enabled', '=', 1]],
        ['name', 'enabled'],
        5,
        0,
        'name asc'
      )

      expect(response).toHaveProperty('data')
      expect(Array.isArray(response.data)).toBe(true)
    })
  })

  describe('countDocuments', () => {
    it('returns a numeric count under message', async () => {
      const response = await service.countDocuments('User')

      expect(response).toHaveProperty('message')
      expect(typeof response.message).toBe('number')
    })

    it('counts with filters', async () => {
      const response = await service.countDocuments('User', [['enabled', '=', 1]])

      expect(response).toHaveProperty('message')
      expect(typeof response.message).toBe('number')
    })
  })

  describe('getValue', () => {
    it('reads a field array from the first matching document', async () => {
      // Administrator always exists on an ERPNext site.
      const response = await service.getValue('User', ['name', 'enabled'], [['name', '=', 'Administrator']])

      expect(response).toHaveProperty('message')
    })
  })

  // ── CRUD lifecycle (create → get → update → delete) ──

  describe('createDocument + getDocument + updateDocument + deleteDocument', () => {
    let docName

    it('creates a document', async () => {
      const response = await service.createDocument(
        crudDoctype(),
        crudCreateFields(`E2E ToDo ${ suffix }`)
      )

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('name')
      docName = response.data.name
    })

    it('retrieves the created document', async () => {
      const response = await service.getDocument(crudDoctype(), docName)

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('name', docName)
    })

    it('updates the document', async () => {
      const response = await service.updateDocument(crudDoctype(), docName, {
        description: `E2E ToDo updated ${ suffix }`,
      })

      expect(response).toHaveProperty('data')
      expect(response.data).toHaveProperty('name', docName)
    })

    it('deletes the document', async () => {
      const response = await service.deleteDocument(crudDoctype(), docName)

      // Frappe returns { message: "ok" } on delete.
      expect(response).toHaveProperty('message')
    })

    afterAll(async () => {
      // Best-effort cleanup in case a later step failed before delete ran.
      if (docName) {
        try {
          await service.deleteDocument(crudDoctype(), docName)
        } catch (e) {
          // already deleted or never created — ignore
        }
      }
    })
  })

  // ── runMethod (advanced) ──

  describe('runMethod', () => {
    it('calls a whitelisted server method', async () => {
      // frappe.client.get_list is whitelisted and returns a list under message.
      const response = await service.runMethod('frappe.client.get_list', {
        doctype: 'User',
        limit_page_length: 3,
        fields: ['name'],
      })

      expect(response).toHaveProperty('message')
      expect(Array.isArray(response.message)).toBe(true)
    })
  })

  // ── Submit / Cancel lifecycle (optional, submittable DocType required) ──

  describe('submitDocument + cancelDocument', () => {
    // Submitting requires a submittable DocType (e.g. Sales Order) plus valid
    // field values, which vary per site. Only runs when the developer supplies
    // testValues.submittableDoctype and testValues.submittableFields.
    const canRun = () =>
      Boolean(testValues.submittableDoctype && testValues.submittableFields)

    let docName

    it('creates and submits a submittable document', async () => {
      if (!canRun()) {
        console.log(
          'Skipping submit/cancel: set testValues.submittableDoctype and testValues.submittableFields'
        )
        return
      }

      const created = await service.createDocument(
        testValues.submittableDoctype,
        testValues.submittableFields
      )
      docName = created.data.name

      const submitted = await service.submitDocument({
        doctype: testValues.submittableDoctype,
        name: docName,
      })

      expect(submitted).toHaveProperty('message')
      expect(submitted.message).toHaveProperty('docstatus', 1)
    })

    it('cancels the submitted document', async () => {
      if (!canRun() || !docName) {
        return
      }

      const cancelled = await service.cancelDocument(testValues.submittableDoctype, docName)

      expect(cancelled).toHaveProperty('message')
      expect(cancelled.message).toHaveProperty('docstatus', 2)
    })

    afterAll(async () => {
      if (canRun() && docName) {
        try {
          await service.deleteDocument(testValues.submittableDoctype, docName)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })
})
