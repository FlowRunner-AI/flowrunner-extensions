'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Wufoo Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('wufoo')
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

  // ── Forms ──

  describe('forms', () => {
    it('lists forms', async () => {
      const result = await service.listForms()

      expect(result).toHaveProperty('Forms')
      expect(Array.isArray(result.Forms)).toBe(true)
    })

    it('lists forms with paging and today counts', async () => {
      const result = await service.listForms(1, 5, true)

      expect(Array.isArray(result.Forms)).toBe(true)
    })

    it('gets a single form', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping getForm: testValues.formIdentifier not set')

        return
      }

      const result = await service.getForm(formIdentifier)

      expect(result).toHaveProperty('Forms')
      expect(result.Forms.length).toBeGreaterThan(0)
    })

    it('lists the form fields', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping listFormFields: testValues.formIdentifier not set')

        return
      }

      const result = await service.listFormFields(formIdentifier)

      expect(result).toHaveProperty('Fields')
      expect(Array.isArray(result.Fields)).toBe(true)
    })

    it('lists the form fields including system fields', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping listFormFields (system): testValues.formIdentifier not set')

        return
      }

      const result = await service.listFormFields(formIdentifier, true)

      expect(Array.isArray(result.Fields)).toBe(true)
    })
  })

  // ── Entries ──

  describe('entries', () => {
    it('lists entries', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping listEntries: testValues.formIdentifier not set')

        return
      }

      const result = await service.listEntries(formIdentifier, 0, 5)

      expect(result).toHaveProperty('Entries')
      expect(Array.isArray(result.Entries)).toBe(true)
    })

    it('lists entries sorted descending by entry id', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping sorted listEntries: testValues.formIdentifier not set')

        return
      }

      const result = await service.listEntries(formIdentifier, 0, 5, 'EntryId', 'Descending')

      expect(Array.isArray(result.Entries)).toBe(true)
    })

    it('lists entries with a filter', async () => {
      const { formIdentifier, filterField, filterValue } = testValues

      if (!formIdentifier || !filterField || !filterValue) {
        console.log('Skipping filtered listEntries: testValues.formIdentifier, filterField or filterValue not set')

        return
      }

      const result = await service.listEntries(
        formIdentifier,
        undefined,
        undefined,
        undefined,
        undefined,
        filterField,
        'Contains',
        filterValue
      )

      expect(Array.isArray(result.Entries)).toBe(true)
    })

    it('gets the entry count', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping getEntryCount: testValues.formIdentifier not set')

        return
      }

      const result = await service.getEntryCount(formIdentifier)

      expect(result).toHaveProperty('EntryCount')
    })

    it('creates an entry', async () => {
      const { formIdentifier, entryFieldValues } = testValues

      if (!formIdentifier || !entryFieldValues) {
        console.log('Skipping createEntry: testValues.formIdentifier or entryFieldValues not set')

        return
      }

      const result = await service.createEntry(formIdentifier, entryFieldValues)

      expect(result).toHaveProperty('Success')
      expect(Number(result.Success)).toBe(1)
      expect(result).toHaveProperty('EntryId')
    })
  })

  // ── Reports ──

  describe('reports', () => {
    it('lists reports', async () => {
      const result = await service.listReports()

      expect(result).toHaveProperty('Reports')
      expect(Array.isArray(result.Reports)).toBe(true)
    })

    it('gets a single report', async () => {
      const { reportIdentifier } = testValues

      if (!reportIdentifier) {
        console.log('Skipping getReport: testValues.reportIdentifier not set')

        return
      }

      const result = await service.getReport(reportIdentifier)

      expect(result).toHaveProperty('Reports')
    })

    it('gets the report entries', async () => {
      const { reportIdentifier } = testValues

      if (!reportIdentifier) {
        console.log('Skipping getReportEntries: testValues.reportIdentifier not set')

        return
      }

      const result = await service.getReportEntries(reportIdentifier, 0, 5)

      expect(result).toHaveProperty('Entries')
    })

    it('gets the report widgets', async () => {
      const { reportIdentifier } = testValues

      if (!reportIdentifier) {
        console.log('Skipping getReportWidgets: testValues.reportIdentifier not set')

        return
      }

      const result = await service.getReportWidgets(reportIdentifier)

      expect(result).toHaveProperty('Widgets')
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('lists the account users', async () => {
      const result = await service.listUsers()

      expect(result).toHaveProperty('Users')
      expect(Array.isArray(result.Users)).toBe(true)
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    let webhookHash

    it('adds a webhook', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier) {
        console.log('Skipping addWebhook: testValues.formIdentifier not set')

        return
      }

      const result = await service.addWebhook(
        formIdentifier,
        `https://example.com/flowrunner-e2e/${ SUFFIX }`,
        `e2e-${ SUFFIX }`,
        true
      )

      expect(result).toHaveProperty('WebHookPutResult')

      webhookHash = result.WebHookPutResult.Hash
    })

    it('deletes the webhook', async () => {
      const { formIdentifier } = testValues

      if (!formIdentifier || !webhookHash) {
        console.log('Skipping deleteWebhook: no webhook was created')

        return
      }

      const result = await service.deleteWebhook(formIdentifier, webhookHash)

      expect(result).toHaveProperty('WebHookDeleteResult')
    })
  })

  // ── Dictionary ──

  describe('getFormsDictionary', () => {
    it('returns form dictionary items', async () => {
      const result = await service.getFormsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('filters the dictionary by search text', async () => {
      const result = await service.getFormsDictionary({ search: 'zzz-no-such-form-zzz' })

      expect(result.items).toEqual([])
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown form', async () => {
      await expect(service.getForm(`no-such-form-${ SUFFIX }`)).rejects.toThrow('Wufoo API error')
    })
  })
})
