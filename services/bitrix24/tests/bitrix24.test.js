'use strict'

const { createSandbox } = require('../../../service-sandbox')

// Provide a webhook URL with a trailing slash to exercise the constructor's
// trailing-slash trimming; the service strips it, so all request URLs use BASE.
const WEBHOOK_URL = 'https://acme.bitrix24.com/rest/1/abc123token/'
const BASE = 'https://acme.bitrix24.com/rest/1/abc123token'

describe('Bitrix24 Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ webhookUrl: WEBHOOK_URL })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'webhookUrl',
          displayName: 'Inbound Webhook URL',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('trims trailing slashes and sends Content-Type header', async () => {
      mock.onPost(`${ BASE }/profile.json`).reply({ result: { ID: '1' } })

      await service.getCurrentUser()

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/profile.json`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/json' })
    })
  })

  // ── Leads ──

  describe('listLeads', () => {
    it('sends empty filter with no params', async () => {
      mock.onPost(`${ BASE }/crm.lead.list.json`).reply({ result: [], total: 0, next: null })

      const result = await service.listLeads()

      expect(result).toEqual({ items: [], total: 0, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('merges convenience filters and all params', async () => {
      mock.onPost(`${ BASE }/crm.lead.list.json`).reply({ result: [{ ID: '271' }], total: 1, next: 50 })

      const result = await service.listLeads(
        'NEW',
        '1',
        { '>=OPPORTUNITY': 1000 },
        { DATE_CREATE: 'DESC' },
        ['ID', 'TITLE'],
        50
      )

      expect(result).toEqual({ items: [{ ID: '271' }], total: 1, next: 50 })
      expect(mock.history[0].body).toEqual({
        filter: { STATUS_ID: 'NEW', ASSIGNED_BY_ID: '1', '>=OPPORTUNITY': 1000 },
        order: { DATE_CREATE: 'DESC' },
        select: ['ID', 'TITLE'],
        start: 50,
      })
    })

    it('omits an empty select array', async () => {
      mock.onPost(`${ BASE }/crm.lead.list.json`).reply({ result: [], total: 0 })

      await service.listLeads(undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('defaults next to null when the API omits it', async () => {
      mock.onPost(`${ BASE }/crm.lead.list.json`).reply({ result: [{ ID: '1' }], total: 1 })

      const result = await service.listLeads()

      expect(result.next).toBeNull()
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listLeads()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getLead', () => {
    it('sends the lead id', async () => {
      mock.onPost(`${ BASE }/crm.lead.get.json`).reply({ result: { ID: '271', TITLE: 'Website enquiry' } })

      const result = await service.getLead(271)

      expect(result).toEqual({ ID: '271', TITLE: 'Website enquiry' })
      expect(mock.history[0].body).toEqual({ id: 271 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.get.json`).replyWithError({ message: 'Not found' })

      await expect(service.getLead(999)).rejects.toThrow('Bitrix24 API error: Not found')
    })
  })

  describe('createLead', () => {
    it('sends required title only', async () => {
      mock.onPost(`${ BASE }/crm.lead.add.json`).reply({ result: 271 })

      const result = await service.createLead('Website enquiry')

      expect(result).toEqual({ id: 271 })
      expect(mock.history[0].body).toEqual({
        fields: { TITLE: 'Website enquiry' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('builds multi-fields and merges additional fields', async () => {
      mock.onPost(`${ BASE }/crm.lead.add.json`).reply({ result: 272 })

      await service.createLead(
        'Website enquiry',
        'John',
        'Doe',
        'john@example.com',
        '+15551234567',
        'NEW',
        'WEB',
        5000,
        'USD',
        'Interested',
        '1',
        { UF_CRM_CUSTOM: 'x', TITLE: 'Overridden' }
      )

      expect(mock.history[0].body).toEqual({
        fields: {
          TITLE: 'Overridden',
          NAME: 'John',
          LAST_NAME: 'Doe',
          EMAIL: [{ VALUE: 'john@example.com', VALUE_TYPE: 'WORK' }],
          PHONE: [{ VALUE: '+15551234567', VALUE_TYPE: 'WORK' }],
          STATUS_ID: 'NEW',
          SOURCE_ID: 'WEB',
          OPPORTUNITY: 5000,
          CURRENCY_ID: 'USD',
          COMMENTS: 'Interested',
          ASSIGNED_BY_ID: '1',
          UF_CRM_CUSTOM: 'x',
        },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createLead('X')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('updateLead', () => {
    it('sends id and fields', async () => {
      mock.onPost(`${ BASE }/crm.lead.update.json`).reply({ result: true })

      const result = await service.updateLead(271, { STATUS_ID: 'IN_PROCESS' })

      expect(result).toEqual({ success: true, id: 271 })
      expect(mock.history[0].body).toEqual({
        id: 271,
        fields: { STATUS_ID: 'IN_PROCESS' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('defaults fields to an empty object', async () => {
      mock.onPost(`${ BASE }/crm.lead.update.json`).reply({ result: true })

      await service.updateLead(271)

      expect(mock.history[0].body).toEqual({
        id: 271,
        fields: {},
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('reports success false when result is falsy', async () => {
      mock.onPost(`${ BASE }/crm.lead.update.json`).reply({ result: false })

      const result = await service.updateLead(271, {})

      expect(result).toEqual({ success: false, id: 271 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.update.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateLead(271, {})).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('deleteLead', () => {
    it('sends the lead id and reports success', async () => {
      mock.onPost(`${ BASE }/crm.lead.delete.json`).reply({ result: true })

      const result = await service.deleteLead(271)

      expect(result).toEqual({ success: true, id: 271 })
      expect(mock.history[0].body).toEqual({ id: 271 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.delete.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteLead(271)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getLeadFields', () => {
    it('sends no body and returns the schema', async () => {
      mock.onPost(`${ BASE }/crm.lead.fields.json`).reply({ result: { ID: { type: 'integer' } } })

      const result = await service.getLeadFields()

      expect(result).toEqual({ ID: { type: 'integer' } })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.lead.fields.json`).replyWithError({ message: 'Boom' })

      await expect(service.getLeadFields()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Contacts ──

  describe('listContacts', () => {
    it('sends empty filter with no params', async () => {
      mock.onPost(`${ BASE }/crm.contact.list.json`).reply({ result: [], total: 0, next: null })

      const result = await service.listContacts()

      expect(result).toEqual({ items: [], total: 0, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('merges convenience filter and all params', async () => {
      mock.onPost(`${ BASE }/crm.contact.list.json`).reply({ result: [{ ID: '84' }], total: 1, next: null })

      await service.listContacts('1', { '%LAST_NAME': 'Smith' }, { DATE_CREATE: 'DESC' }, ['ID', 'NAME'], 50)

      expect(mock.history[0].body).toEqual({
        filter: { ASSIGNED_BY_ID: '1', '%LAST_NAME': 'Smith' },
        order: { DATE_CREATE: 'DESC' },
        select: ['ID', 'NAME'],
        start: 50,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listContacts()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getContact', () => {
    it('sends the contact id', async () => {
      mock.onPost(`${ BASE }/crm.contact.get.json`).reply({ result: { ID: '84' } })

      const result = await service.getContact(84)

      expect(result).toEqual({ ID: '84' })
      expect(mock.history[0].body).toEqual({ id: 84 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.get.json`).replyWithError({ message: 'Boom' })

      await expect(service.getContact(84)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('createContact', () => {
    it('sends required first name only', async () => {
      mock.onPost(`${ BASE }/crm.contact.add.json`).reply({ result: 84 })

      const result = await service.createContact('Jane')

      expect(result).toEqual({ id: 84 })
      expect(mock.history[0].body).toEqual({
        fields: { NAME: 'Jane' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('builds multi-fields and merges additional fields', async () => {
      mock.onPost(`${ BASE }/crm.contact.add.json`).reply({ result: 85 })

      await service.createContact('Jane', 'Smith', 'jane@example.com', '+15559876543', 12, '1', 'Met at show', {
        UF_CRM_X: 'y',
      })

      expect(mock.history[0].body).toEqual({
        fields: {
          NAME: 'Jane',
          LAST_NAME: 'Smith',
          EMAIL: [{ VALUE: 'jane@example.com', VALUE_TYPE: 'WORK' }],
          PHONE: [{ VALUE: '+15559876543', VALUE_TYPE: 'WORK' }],
          COMPANY_ID: 12,
          ASSIGNED_BY_ID: '1',
          COMMENTS: 'Met at show',
          UF_CRM_X: 'y',
        },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createContact('Jane')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('updateContact', () => {
    it('sends id and fields', async () => {
      mock.onPost(`${ BASE }/crm.contact.update.json`).reply({ result: true })

      const result = await service.updateContact(84, { LAST_NAME: 'Smith' })

      expect(result).toEqual({ success: true, id: 84 })
      expect(mock.history[0].body).toEqual({
        id: 84,
        fields: { LAST_NAME: 'Smith' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('defaults fields to an empty object', async () => {
      mock.onPost(`${ BASE }/crm.contact.update.json`).reply({ result: true })

      await service.updateContact(84)

      expect(mock.history[0].body.fields).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.update.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateContact(84, {})).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('deleteContact', () => {
    it('sends the contact id', async () => {
      mock.onPost(`${ BASE }/crm.contact.delete.json`).reply({ result: true })

      const result = await service.deleteContact(84)

      expect(result).toEqual({ success: true, id: 84 })
      expect(mock.history[0].body).toEqual({ id: 84 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.delete.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteContact(84)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getContactFields', () => {
    it('returns the schema', async () => {
      mock.onPost(`${ BASE }/crm.contact.fields.json`).reply({ result: { NAME: { type: 'string' } } })

      const result = await service.getContactFields()

      expect(result).toEqual({ NAME: { type: 'string' } })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.contact.fields.json`).replyWithError({ message: 'Boom' })

      await expect(service.getContactFields()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Companies ──

  describe('listCompanies', () => {
    it('sends empty filter with no params', async () => {
      mock.onPost(`${ BASE }/crm.company.list.json`).reply({ result: [], total: 0, next: null })

      const result = await service.listCompanies()

      expect(result).toEqual({ items: [], total: 0, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('merges convenience filter and all params', async () => {
      mock.onPost(`${ BASE }/crm.company.list.json`).reply({ result: [{ ID: '12' }], total: 1, next: null })

      await service.listCompanies('1', { '%TITLE': 'Acme' }, { TITLE: 'ASC' }, ['ID', 'TITLE'], 0)

      // clean() preserves a start of 0, so it is sent as-is.
      expect(mock.history[0].body).toEqual({
        filter: { ASSIGNED_BY_ID: '1', '%TITLE': 'Acme' },
        order: { TITLE: 'ASC' },
        select: ['ID', 'TITLE'],
        start: 0,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listCompanies()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getCompany', () => {
    it('sends the company id', async () => {
      mock.onPost(`${ BASE }/crm.company.get.json`).reply({ result: { ID: '12' } })

      const result = await service.getCompany(12)

      expect(result).toEqual({ ID: '12' })
      expect(mock.history[0].body).toEqual({ id: 12 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.get.json`).replyWithError({ message: 'Boom' })

      await expect(service.getCompany(12)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('createCompany', () => {
    it('sends required title only', async () => {
      mock.onPost(`${ BASE }/crm.company.add.json`).reply({ result: 12 })

      const result = await service.createCompany('Acme Corp')

      expect(result).toEqual({ id: 12 })
      expect(mock.history[0].body).toEqual({
        fields: { TITLE: 'Acme Corp' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('builds multi-fields and merges additional fields', async () => {
      mock.onPost(`${ BASE }/crm.company.add.json`).reply({ result: 13 })

      await service.createCompany('Acme Corp', 'CUSTOMER', 'IT', 'info@acme.com', '+15550001111', '1', {
        UF_CRM_Z: 'z',
      })

      expect(mock.history[0].body).toEqual({
        fields: {
          TITLE: 'Acme Corp',
          COMPANY_TYPE: 'CUSTOMER',
          INDUSTRY: 'IT',
          EMAIL: [{ VALUE: 'info@acme.com', VALUE_TYPE: 'WORK' }],
          PHONE: [{ VALUE: '+15550001111', VALUE_TYPE: 'WORK' }],
          ASSIGNED_BY_ID: '1',
          UF_CRM_Z: 'z',
        },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createCompany('Acme')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('updateCompany', () => {
    it('sends id and fields', async () => {
      mock.onPost(`${ BASE }/crm.company.update.json`).reply({ result: true })

      const result = await service.updateCompany(12, { INDUSTRY: 'MANUFACTURING' })

      expect(result).toEqual({ success: true, id: 12 })
      expect(mock.history[0].body).toEqual({
        id: 12,
        fields: { INDUSTRY: 'MANUFACTURING' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.update.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateCompany(12, {})).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('deleteCompany', () => {
    it('sends the company id', async () => {
      mock.onPost(`${ BASE }/crm.company.delete.json`).reply({ result: true })

      const result = await service.deleteCompany(12)

      expect(result).toEqual({ success: true, id: 12 })
      expect(mock.history[0].body).toEqual({ id: 12 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.delete.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteCompany(12)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getCompanyFields', () => {
    it('returns the schema', async () => {
      mock.onPost(`${ BASE }/crm.company.fields.json`).reply({ result: { TITLE: { type: 'string' } } })

      const result = await service.getCompanyFields()

      expect(result).toEqual({ TITLE: { type: 'string' } })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.company.fields.json`).replyWithError({ message: 'Boom' })

      await expect(service.getCompanyFields()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Deals ──

  describe('listDeals', () => {
    it('sends empty filter with no params', async () => {
      mock.onPost(`${ BASE }/crm.deal.list.json`).reply({ result: [], total: 0, next: null })

      const result = await service.listDeals()

      expect(result).toEqual({ items: [], total: 0, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('merges convenience filters and all params', async () => {
      mock.onPost(`${ BASE }/crm.deal.list.json`).reply({ result: [{ ID: '98' }], total: 1, next: null })

      await service.listDeals(
        '0',
        'NEGOTIATION',
        '1',
        { CLOSED: 'N' },
        { OPPORTUNITY: 'DESC' },
        ['ID', 'TITLE'],
        50
      )

      expect(mock.history[0].body).toEqual({
        filter: { CATEGORY_ID: '0', STAGE_ID: 'NEGOTIATION', ASSIGNED_BY_ID: '1', CLOSED: 'N' },
        order: { OPPORTUNITY: 'DESC' },
        select: ['ID', 'TITLE'],
        start: 50,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listDeals()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getDeal', () => {
    it('sends the deal id', async () => {
      mock.onPost(`${ BASE }/crm.deal.get.json`).reply({ result: { ID: '98' } })

      const result = await service.getDeal(98)

      expect(result).toEqual({ ID: '98' })
      expect(mock.history[0].body).toEqual({ id: 98 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.get.json`).replyWithError({ message: 'Boom' })

      await expect(service.getDeal(98)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('createDeal', () => {
    it('sends required title only', async () => {
      mock.onPost(`${ BASE }/crm.deal.add.json`).reply({ result: 98 })

      const result = await service.createDeal('Acme Corp - Pro plan')

      expect(result).toEqual({ id: 98 })
      expect(mock.history[0].body).toEqual({
        fields: { TITLE: 'Acme Corp - Pro plan' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('builds all fields and merges additional fields', async () => {
      mock.onPost(`${ BASE }/crm.deal.add.json`).reply({ result: 99 })

      await service.createDeal(
        'Acme Corp - Pro plan',
        '0',
        'NEGOTIATION',
        84,
        12,
        12000,
        'USD',
        '2026-08-31',
        '1',
        'Renewal',
        { UF_CRM_A: 'b' }
      )

      expect(mock.history[0].body).toEqual({
        fields: {
          TITLE: 'Acme Corp - Pro plan',
          CATEGORY_ID: '0',
          STAGE_ID: 'NEGOTIATION',
          CONTACT_ID: 84,
          COMPANY_ID: 12,
          OPPORTUNITY: 12000,
          CURRENCY_ID: 'USD',
          CLOSEDATE: '2026-08-31',
          ASSIGNED_BY_ID: '1',
          COMMENTS: 'Renewal',
          UF_CRM_A: 'b',
        },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createDeal('X')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('updateDeal', () => {
    it('sends id and fields', async () => {
      mock.onPost(`${ BASE }/crm.deal.update.json`).reply({ result: true })

      const result = await service.updateDeal(98, { STAGE_ID: 'WON' })

      expect(result).toEqual({ success: true, id: 98 })
      expect(mock.history[0].body).toEqual({
        id: 98,
        fields: { STAGE_ID: 'WON' },
        params: { REGISTER_SONET_EVENT: 'Y' },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.update.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateDeal(98, {})).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('deleteDeal', () => {
    it('sends the deal id', async () => {
      mock.onPost(`${ BASE }/crm.deal.delete.json`).reply({ result: true })

      const result = await service.deleteDeal(98)

      expect(result).toEqual({ success: true, id: 98 })
      expect(mock.history[0].body).toEqual({ id: 98 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.delete.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteDeal(98)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getDealFields', () => {
    it('returns the schema', async () => {
      mock.onPost(`${ BASE }/crm.deal.fields.json`).reply({ result: { TITLE: { type: 'string' } } })

      const result = await service.getDealFields()

      expect(result).toEqual({ TITLE: { type: 'string' } })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.deal.fields.json`).replyWithError({ message: 'Boom' })

      await expect(service.getDealFields()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── CRM Reference Data ──

  describe('getStatusList', () => {
    it('resolves the entity type to a Bitrix entity id', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [{ STATUS_ID: 'NEW' }], total: 1 })

      const result = await service.getStatusList('Lead Statuses')

      expect(result).toEqual({ items: [{ STATUS_ID: 'NEW' }], total: 1 })
      expect(mock.history[0].body).toEqual({
        filter: { ENTITY_ID: 'STATUS' },
        order: { SORT: 'ASC' },
      })
    })

    it('defaults unknown entity types to STATUS entity id passthrough', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], total: 0 })

      await service.getStatusList('SOURCE')

      // Unmapped value passes through unchanged via #resolveChoice.
      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'SOURCE' })
    })

    it('scopes deal stages to a non-default pipeline', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], total: 0 })

      await service.getStatusList('Deal Stages', 9)

      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'DEAL_STAGE_9' })
    })

    it('uses the base deal stage entity for the default pipeline', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], total: 0 })

      await service.getStatusList('Deal Stages', '0')

      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'DEAL_STAGE' })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.getStatusList('Lead Statuses')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getDealCategories', () => {
    it('lists deal pipelines from the categories envelope', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).reply({
        result: { categories: [{ id: 0, name: 'General' }] },
        total: 1,
      })

      const result = await service.getDealCategories()

      expect(result).toEqual({ items: [{ id: 0, name: 'General' }], total: 1 })
      expect(mock.history[0].body).toEqual({ entityTypeId: 2 })
    })

    it('returns an empty list when categories are missing', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).reply({ result: {}, total: 0 })

      const result = await service.getDealCategories()

      expect(result).toEqual({ items: [], total: 0 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.getDealCategories()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Activities & Timeline ──

  describe('addTimelineComment', () => {
    it('resolves entity type and sends the comment', async () => {
      mock.onPost(`${ BASE }/crm.timeline.comment.add.json`).reply({ result: 501 })

      const result = await service.addTimelineComment('Deal', 98, 'Great progress')

      expect(result).toEqual({ id: 501 })
      expect(mock.history[0].body).toEqual({
        fields: {
          ENTITY_ID: 98,
          ENTITY_TYPE: 'deal',
          COMMENT: 'Great progress',
        },
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.timeline.comment.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.addTimelineComment('Deal', 98, 'x')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('createActivity', () => {
    it('sends required fields with resolved type maps', async () => {
      mock.onPost(`${ BASE }/crm.activity.add.json`).reply({ result: 301 })

      const result = await service.createActivity('Deal', 98, 'Call', 'Follow-up call')

      expect(result).toEqual({ id: 301 })
      expect(mock.history[0].body).toEqual({
        fields: {
          OWNER_TYPE_ID: 2,
          OWNER_ID: 98,
          TYPE_ID: 2,
          SUBJECT: 'Follow-up call',
        },
      })
    })

    it('includes all optional fields and communications', async () => {
      mock.onPost(`${ BASE }/crm.activity.add.json`).reply({ result: 302 })

      await service.createActivity(
        'Contact',
        84,
        'Meeting',
        'Kickoff',
        'Project kickoff',
        '2026-07-20T15:00:00+03:00',
        '2026-07-20T15:30:00+03:00',
        true,
        '1',
        [{ VALUE: '+15551234567' }]
      )

      expect(mock.history[0].body).toEqual({
        fields: {
          OWNER_TYPE_ID: 3,
          OWNER_ID: 84,
          TYPE_ID: 1,
          SUBJECT: 'Kickoff',
          DESCRIPTION: 'Project kickoff',
          START_TIME: '2026-07-20T15:00:00+03:00',
          END_TIME: '2026-07-20T15:30:00+03:00',
          COMPLETED: 'Y',
          RESPONSIBLE_ID: '1',
          COMMUNICATIONS: [{ VALUE: '+15551234567' }],
        },
      })
    })

    it('maps completed false to N', async () => {
      mock.onPost(`${ BASE }/crm.activity.add.json`).reply({ result: 303 })

      await service.createActivity('Lead', 271, 'Email', 'Intro', undefined, undefined, undefined, false)

      expect(mock.history[0].body.fields.COMPLETED).toBe('N')
      expect(mock.history[0].body.fields.OWNER_TYPE_ID).toBe(1)
      expect(mock.history[0].body.fields.TYPE_ID).toBe(4)
    })

    it('omits communications when the array is empty', async () => {
      mock.onPost(`${ BASE }/crm.activity.add.json`).reply({ result: 304 })

      await service.createActivity('Deal', 98, 'Call', 'Ring', undefined, undefined, undefined, undefined, undefined, [])

      expect(mock.history[0].body.fields).not.toHaveProperty('COMMUNICATIONS')
      expect(mock.history[0].body.fields).not.toHaveProperty('COMPLETED')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.activity.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createActivity('Deal', 98, 'Call', 'x')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('listActivities', () => {
    it('sends empty filter with no params', async () => {
      mock.onPost(`${ BASE }/crm.activity.list.json`).reply({ result: [], total: 0, next: null })

      const result = await service.listActivities()

      expect(result).toEqual({ items: [], total: 0, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('resolves owner type and merges filters', async () => {
      mock.onPost(`${ BASE }/crm.activity.list.json`).reply({ result: [{ ID: '301' }], total: 1, next: null })

      await service.listActivities('Deal', 98, { COMPLETED: 'N' }, { START_TIME: 'DESC' }, ['ID', 'SUBJECT'], 0)

      // clean() preserves a start of 0, so it is sent as-is.
      expect(mock.history[0].body).toEqual({
        filter: { OWNER_TYPE_ID: 2, OWNER_ID: 98, COMPLETED: 'N' },
        order: { START_TIME: 'DESC' },
        select: ['ID', 'SUBJECT'],
        start: 0,
      })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.activity.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listActivities()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Tasks ──

  describe('listTasks', () => {
    it('reads tasks from the tasks envelope', async () => {
      mock.onPost(`${ BASE }/tasks.task.list.json`).reply({ result: { tasks: [{ id: '612' }] }, total: 1, next: null })

      const result = await service.listTasks()

      expect(result).toEqual({ items: [{ id: '612' }], total: 1, next: null })
      expect(mock.history[0].body).toEqual({ filter: {} })
    })

    it('merges convenience filter and all params', async () => {
      mock.onPost(`${ BASE }/tasks.task.list.json`).reply({ result: { tasks: [] }, total: 0, next: null })

      await service.listTasks('1', { STATUS: 2 }, { DEADLINE: 'asc' }, ['ID', 'TITLE'], 50)

      expect(mock.history[0].body).toEqual({
        filter: { RESPONSIBLE_ID: '1', STATUS: 2 },
        order: { DEADLINE: 'asc' },
        select: ['ID', 'TITLE'],
        start: 50,
      })
    })

    it('returns an empty list when tasks are missing', async () => {
      mock.onPost(`${ BASE }/tasks.task.list.json`).reply({ result: {}, total: 0 })

      const result = await service.listTasks()

      expect(result.items).toEqual([])
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.listTasks()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getTask', () => {
    it('returns the task from the envelope', async () => {
      mock.onPost(`${ BASE }/tasks.task.get.json`).reply({ result: { task: { id: '612', title: 'Prepare' } } })

      const result = await service.getTask(612)

      expect(result).toEqual({ id: '612', title: 'Prepare' })
      expect(mock.history[0].body).toEqual({ taskId: 612 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.get.json`).replyWithError({ message: 'Boom' })

      await expect(service.getTask(612)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('createTask', () => {
    it('sends required title and responsible only', async () => {
      mock.onPost(`${ BASE }/tasks.task.add.json`).reply({ result: { task: { id: '612' } } })

      const result = await service.createTask('Prepare proposal', undefined, '1')

      expect(result).toEqual({ id: '612' })
      expect(mock.history[0].body).toEqual({
        fields: { TITLE: 'Prepare proposal', RESPONSIBLE_ID: '1' },
      })
    })

    it('resolves priority and merges additional fields', async () => {
      mock.onPost(`${ BASE }/tasks.task.add.json`).reply({ result: { task: { id: '613' } } })

      await service.createTask(
        'Prepare proposal',
        'Draft the proposal',
        '1',
        '2026-07-25T18:00:00+03:00',
        'High',
        17,
        { ACCOMPLICES: [2, 3] }
      )

      expect(mock.history[0].body).toEqual({
        fields: {
          TITLE: 'Prepare proposal',
          DESCRIPTION: 'Draft the proposal',
          RESPONSIBLE_ID: '1',
          DEADLINE: '2026-07-25T18:00:00+03:00',
          PRIORITY: 2,
          GROUP_ID: 17,
          ACCOMPLICES: [2, 3],
        },
      })
    })

    it('passes an unmapped priority through unchanged', async () => {
      mock.onPost(`${ BASE }/tasks.task.add.json`).reply({ result: { task: { id: '614' } } })

      await service.createTask('T', undefined, '1', undefined, '2')

      expect(mock.history[0].body.fields.PRIORITY).toBe('2')
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.add.json`).replyWithError({ message: 'Boom' })

      await expect(service.createTask('T', undefined, '1')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('updateTask', () => {
    it('sends taskId and fields and returns the task', async () => {
      mock.onPost(`${ BASE }/tasks.task.update.json`).reply({ result: { task: { id: '612', title: 'Updated' } } })

      const result = await service.updateTask(612, { TITLE: 'Updated' })

      expect(result).toEqual({ success: true, task: { id: '612', title: 'Updated' } })
      expect(mock.history[0].body).toEqual({ taskId: 612, fields: { TITLE: 'Updated' } })
    })

    it('returns a null task when the API omits it', async () => {
      mock.onPost(`${ BASE }/tasks.task.update.json`).reply({ result: {} })

      const result = await service.updateTask(612, {})

      expect(result).toEqual({ success: true, task: null })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.update.json`).replyWithError({ message: 'Boom' })

      await expect(service.updateTask(612, {})).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('completeTask', () => {
    it('sends taskId and returns success', async () => {
      mock.onPost(`${ BASE }/tasks.task.complete.json`).reply({ result: { task: {} } })

      const result = await service.completeTask(612)

      expect(result).toEqual({ success: true, id: 612 })
      expect(mock.history[0].body).toEqual({ taskId: 612 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.complete.json`).replyWithError({ message: 'Boom' })

      await expect(service.completeTask(612)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('deleteTask', () => {
    it('sends taskId and returns success', async () => {
      mock.onPost(`${ BASE }/tasks.task.delete.json`).reply({ result: { task: {} } })

      const result = await service.deleteTask(612)

      expect(result).toEqual({ success: true, id: 612 })
      expect(mock.history[0].body).toEqual({ taskId: 612 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/tasks.task.delete.json`).replyWithError({ message: 'Boom' })

      await expect(service.deleteTask(612)).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Users ──

  describe('listUsers', () => {
    it('defaults to active users only', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({ result: [{ ID: '1' }], total: 1, next: null })

      const result = await service.listUsers()

      expect(result).toEqual({ items: [{ ID: '1' }], total: 1, next: null })
      expect(mock.history[0].body).toEqual({ FILTER: { ACTIVE: true } })
    })

    it('drops the ACTIVE filter when active only is false', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({ result: [], total: 0 })

      await service.listUsers(false, { WORK_POSITION: 'CEO' }, 50)

      expect(mock.history[0].body).toEqual({
        FILTER: { WORK_POSITION: 'CEO' },
        start: 50,
      })
    })

    it('merges a custom filter with the active default', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({ result: [], total: 0 })

      await service.listUsers(true, { EMAIL: 'x@y.com' })

      expect(mock.history[0].body).toEqual({ FILTER: { ACTIVE: true, EMAIL: 'x@y.com' } })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/user.get.json`).replyWithError({ message: 'Boom' })

      await expect(service.listUsers()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('getCurrentUser', () => {
    it('returns the profile result', async () => {
      mock.onPost(`${ BASE }/profile.json`).reply({ result: { ID: '1', ADMIN: true } })

      const result = await service.getCurrentUser()

      expect(result).toEqual({ ID: '1', ADMIN: true })
      expect(mock.history[0].body).toEqual({})
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/profile.json`).replyWithError({ message: 'Boom' })

      await expect(service.getCurrentUser()).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  describe('searchUsers', () => {
    it('sends the query', async () => {
      mock.onPost(`${ BASE }/user.search.json`).reply({ result: [{ ID: '7' }], total: 1, next: null })

      const result = await service.searchUsers('Jane')

      expect(result).toEqual({ items: [{ ID: '7' }], total: 1, next: null })
      expect(mock.history[0].body).toEqual({ FIND: 'Jane' })
    })

    it('includes pagination offset', async () => {
      mock.onPost(`${ BASE }/user.search.json`).reply({ result: [], total: 0 })

      await service.searchUsers('Jane', 50)

      expect(mock.history[0].body).toEqual({ FIND: 'Jane', start: 50 })
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/user.search.json`).replyWithError({ message: 'Boom' })

      await expect(service.searchUsers('Jane')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Messaging ──

  describe('sendNotification', () => {
    it('uses the modern notify method when available', async () => {
      mock.onPost(`${ BASE }/im.notify.system.add.json`).reply({ result: 8642 })

      const result = await service.sendNotification('1', 'Hello there')

      expect(result).toEqual({ notificationId: 8642 })
      expect(mock.history[0].body).toEqual({ USER_ID: '1', MESSAGE: 'Hello there' })
    })

    it('falls back to im.notify when the modern method is missing', async () => {
      mock.onPost(`${ BASE }/im.notify.system.add.json`).replyWithError({
        message: 'Method not found',
        body: { error: 'ERROR_METHOD_NOT_FOUND', error_description: 'Method not found' },
      })
      mock.onPost(`${ BASE }/im.notify.json`).reply({ result: 9001 })

      const result = await service.sendNotification('1', 'Hello there')

      expect(result).toEqual({ notificationId: 9001 })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].url).toBe(`${ BASE }/im.notify.json`)
      expect(mock.history[1].body).toEqual({ to: '1', message: 'Hello there', type: 'SYSTEM' })
    })

    it('rethrows non method-not-found errors', async () => {
      mock.onPost(`${ BASE }/im.notify.system.add.json`).replyWithError({
        message: 'Access denied',
        body: { error: 'ACCESS_DENIED', error_description: 'Access denied' },
      })

      await expect(service.sendNotification('1', 'Hi')).rejects.toThrow('Bitrix24 API error: Access denied')
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Advanced ──

  describe('callRestMethod', () => {
    it('normalizes the method name and returns the raw envelope', async () => {
      mock.onPost(`${ BASE }/crm.product.list.json`).reply({ result: [{ ID: '5' }], total: 1 })

      const result = await service.callRestMethod('crm.product.list', { filter: { ID: 5 } })

      expect(result).toEqual({ result: [{ ID: '5' }], total: 1 })
      expect(mock.history[0].url).toBe(`${ BASE }/crm.product.list.json`)
      expect(mock.history[0].body).toEqual({ filter: { ID: 5 } })
    })

    it('strips slashes and a trailing .json from the method name', async () => {
      mock.onPost(`${ BASE }/department.get.json`).reply({ result: [] })

      await service.callRestMethod('/department.get.json/')

      expect(mock.history[0].url).toBe(`${ BASE }/department.get.json`)
      expect(mock.history[0].body).toEqual({})
    })

    it('throws when the method name is empty', async () => {
      await expect(service.callRestMethod('  ')).rejects.toThrow('Bitrix24 API error: REST method name is required')
      expect(mock.history).toHaveLength(0)
    })

    it('throws a wrapped error on API failure', async () => {
      mock.onPost(`${ BASE }/crm.product.list.json`).replyWithError({ message: 'Boom' })

      await expect(service.callRestMethod('crm.product.list')).rejects.toThrow('Bitrix24 API error: Boom')
    })
  })

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('lists active users when there is no search term', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({
        result: [{ ID: '1', NAME: 'John', LAST_NAME: 'Doe', WORK_POSITION: 'CEO' }],
        next: null,
      })

      const result = await service.getUsersDictionary({})

      expect(mock.history[0].url).toBe(`${ BASE }/user.get.json`)
      expect(mock.history[0].body).toEqual({ FILTER: { ACTIVE: true } })
      expect(result).toEqual({
        items: [{ label: 'John Doe', value: '1', note: 'CEO' }],
        cursor: null,
      })
    })

    it('searches users when a search term is provided', async () => {
      mock.onPost(`${ BASE }/user.search.json`).reply({
        result: [{ ID: '7', NAME: 'Jane', EMAIL: 'jane@x.com' }],
        next: 50,
      })

      const result = await service.getUsersDictionary({ search: 'Jane' })

      expect(mock.history[0].url).toBe(`${ BASE }/user.search.json`)
      expect(mock.history[0].body).toEqual({ FIND: 'Jane', ACTIVE: true })
      expect(result.items[0]).toEqual({ label: 'Jane', value: '7', note: 'jane@x.com' })
      expect(result.cursor).toBe('50')
    })

    it('passes the cursor as an offset', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({ result: [], next: null })

      await service.getUsersDictionary({ cursor: '50' })

      expect(mock.history[0].body).toEqual({ FILTER: { ACTIVE: true }, start: 50 })
    })

    it('falls back to email then id for the label', async () => {
      mock.onPost(`${ BASE }/user.get.json`).reply({
        result: [
          { ID: '3', EMAIL: 'only-email@x.com' },
          { ID: '4' },
        ],
        next: null,
      })

      const result = await service.getUsersDictionary(null)

      expect(result.items[0].label).toBe('only-email@x.com')
      expect(result.items[1].label).toBe('User 4')
    })
  })

  describe('getLeadStatusesDictionary', () => {
    it('maps statuses to items', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({
        result: [
          { STATUS_ID: 'NEW', NAME: 'Unsorted' },
          { STATUS_ID: 'IN_PROCESS', NAME: 'In progress' },
        ],
        next: null,
      })

      const result = await service.getLeadStatusesDictionary({})

      expect(mock.history[0].body).toEqual({
        filter: { ENTITY_ID: 'STATUS' },
        order: { SORT: 'ASC' },
      })
      expect(result).toEqual({
        items: [
          { label: 'Unsorted', value: 'NEW', note: 'ID: NEW' },
          { label: 'In progress', value: 'IN_PROCESS', note: 'ID: IN_PROCESS' },
        ],
        cursor: null,
      })
    })

    it('filters locally by search term', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({
        result: [
          { STATUS_ID: 'NEW', NAME: 'Unsorted' },
          { STATUS_ID: 'IN_PROCESS', NAME: 'In progress' },
        ],
        next: null,
      })

      const result = await service.getLeadStatusesDictionary({ search: 'progress' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('IN_PROCESS')
    })

    it('passes the cursor as an offset', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], next: null })

      await service.getLeadStatusesDictionary({ cursor: '50' })

      expect(mock.history[0].body).toEqual({
        filter: { ENTITY_ID: 'STATUS' },
        order: { SORT: 'ASC' },
        start: 50,
      })
    })
  })

  describe('getDealStagesDictionary', () => {
    it('uses the base deal stage entity without a pipeline', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({
        result: [{ STATUS_ID: 'NEGOTIATION', NAME: 'Negotiation' }],
        next: null,
      })

      const result = await service.getDealStagesDictionary({})

      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'DEAL_STAGE' })
      expect(result.items[0]).toEqual({ label: 'Negotiation', value: 'NEGOTIATION', note: 'ID: NEGOTIATION' })
    })

    it('scopes stages to a non-default pipeline via criteria', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], next: null })

      await service.getDealStagesDictionary({ criteria: { categoryId: '9' } })

      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'DEAL_STAGE_9' })
    })

    it('keeps the base entity for the default pipeline id', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({ result: [], next: null })

      await service.getDealStagesDictionary({ criteria: { categoryId: '0' } })

      expect(mock.history[0].body.filter).toEqual({ ENTITY_ID: 'DEAL_STAGE' })
    })

    it('filters locally by search term', async () => {
      mock.onPost(`${ BASE }/crm.status.list.json`).reply({
        result: [
          { STATUS_ID: 'NEW', NAME: 'New' },
          { STATUS_ID: 'WON', NAME: 'Won' },
        ],
        next: null,
      })

      const result = await service.getDealStagesDictionary({ search: 'won' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('WON')
    })
  })

  describe('getDealCategoriesDictionary', () => {
    it('maps categories with a default pipeline note', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).reply({
        result: { categories: [
          { id: 0, name: 'General', isDefault: 'Y' },
          { id: 9, name: 'Enterprise', isDefault: 'N' },
        ] },
        next: null,
      })

      const result = await service.getDealCategoriesDictionary({})

      expect(mock.history[0].body).toEqual({ entityTypeId: 2 })
      expect(result).toEqual({
        items: [
          { label: 'General', value: '0', note: 'Default pipeline' },
          { label: 'Enterprise', value: '9', note: 'ID: 9' },
        ],
        cursor: null,
      })
    })

    it('filters locally by search term', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).reply({
        result: { categories: [
          { id: 0, name: 'General', isDefault: 'Y' },
          { id: 9, name: 'Enterprise', isDefault: 'N' },
        ] },
        next: null,
      })

      const result = await service.getDealCategoriesDictionary({ search: 'enterprise' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('9')
    })

    it('passes the cursor as an offset and handles missing categories', async () => {
      mock.onPost(`${ BASE }/crm.category.list.json`).reply({ result: {}, next: null })

      const result = await service.getDealCategoriesDictionary({ cursor: '50' })

      expect(mock.history[0].body).toEqual({ entityTypeId: 2, start: 50 })
      expect(result.items).toEqual([])
    })
  })
})
