'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('SES Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('ses-service')
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

  // ── Dictionaries ──

  describe('listIdentitiesDictionary', () => {
    it('returns verified identities', async () => {
      const result = await service.listIdentitiesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters identities by search', async () => {
      const all = await service.listIdentitiesDictionary({})

      if (!all.items.length) {
        console.log('Skipping identity search: no verified identities on the account')

        return
      }

      const search = all.items[0].value.slice(0, 3)
      const filtered = await service.listIdentitiesDictionary({ search })

      expect(filtered.items.length).toBeGreaterThan(0)
    })
  })

  describe('listTemplatesDictionary', () => {
    it('returns templates', async () => {
      const result = await service.listTemplatesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Templates ──

  describe('createEmailTemplate', () => {
    it('creates a template and lists it back', async () => {
      const templateName = `flowrunner-e2e-${ Date.now() }`

      const created = await service.createEmailTemplate(
        templateName,
        'Hello {{name}}',
        'Hi {{name}}, this is a FlowRunner e2e test.',
        '<p>Hi {{name}}, this is a FlowRunner e2e test.</p>'
      )

      expect(created).toEqual({ templateName })

      const listed = await service.listTemplatesDictionary({ search: templateName })

      expect(listed.items.map(item => item.value)).toContain(templateName)
    })
  })

  // ── Sending ──

  describe('sendEmail', () => {
    it('sends a plain text email', async () => {
      const { fromEmail, toEmail } = testValues

      if (!fromEmail || !toEmail) {
        console.log('Skipping sendEmail: testValues.fromEmail or testValues.toEmail not set')

        return
      }

      const result = await service.sendEmail(
        fromEmail,
        [toEmail],
        null,
        null,
        'FlowRunner e2e test',
        'This is a FlowRunner e2e test message.',
        null,
        null
      )

      expect(result).toHaveProperty('messageId')
      expect(typeof result.messageId).toBe('string')
    })

    it('rejects an invalid parameter set before calling AWS', async () => {
      await expect(service.sendEmail('from@example.com', [], null, null, 'S', 'text'))
        .rejects.toThrow('toAddresses must be a non-empty array.')
    })
  })

  describe('sendTemplatedEmail', () => {
    it('sends a templated email', async () => {
      const { fromEmail, toEmail, templateName } = testValues

      if (!fromEmail || !toEmail || !templateName) {
        console.log('Skipping sendTemplatedEmail: testValues.fromEmail/toEmail/templateName not set')

        return
      }

      const result = await service.sendTemplatedEmail(
        fromEmail,
        [toEmail],
        null,
        null,
        templateName,
        { name: 'FlowRunner' },
        null
      )

      expect(result).toHaveProperty('messageId')
    })
  })

  describe('sendBulkTemplatedEmail', () => {
    it('sends a bulk templated email', async () => {
      const { fromEmail, toEmail, templateName } = testValues

      if (!fromEmail || !toEmail || !templateName) {
        console.log('Skipping sendBulkTemplatedEmail: testValues.fromEmail/toEmail/templateName not set')

        return
      }

      const result = await service.sendBulkTemplatedEmail(
        fromEmail,
        templateName,
        { name: 'FlowRunner' },
        [{ toAddresses: [toEmail], replacementData: { name: 'Bulk' } }]
      )

      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBe(1)
    })
  })
})
