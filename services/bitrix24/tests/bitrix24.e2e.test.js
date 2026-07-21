'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bitrix24 Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bitrix24')
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

  // ── Users ──

  describe('getCurrentUser', () => {
    it('returns the webhook owner profile', async () => {
      const response = await service.getCurrentUser()

      expect(response).toHaveProperty('ID')
      expect(response).toHaveProperty('NAME')
    })
  })

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const response = await service.listUsers(true, undefined, 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('searchUsers', () => {
    it('returns matching users with expected shape', async () => {
      const response = await service.searchUsers(testValues.userSearchQuery || 'a')

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── CRM Reference Data ──

  describe('getStatusList', () => {
    it('returns lead statuses with expected shape', async () => {
      const response = await service.getStatusList('Lead Statuses')

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getDealCategories', () => {
    it('returns deal pipelines with expected shape', async () => {
      const response = await service.getDealCategories()

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  describe('getLeadStatusesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getLeadStatusesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDealStagesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDealStagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getDealCategoriesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getDealCategoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Field Schemas ──

  describe('field schemas', () => {
    it('returns the lead field schema', async () => {
      const response = await service.getLeadFields()

      expect(response).toHaveProperty('ID')
      expect(response).toHaveProperty('TITLE')
    })

    it('returns the contact field schema', async () => {
      const response = await service.getContactFields()

      expect(response).toHaveProperty('ID')
      expect(response).toHaveProperty('NAME')
    })

    it('returns the company field schema', async () => {
      const response = await service.getCompanyFields()

      expect(response).toHaveProperty('ID')
      expect(response).toHaveProperty('TITLE')
    })

    it('returns the deal field schema', async () => {
      const response = await service.getDealFields()

      expect(response).toHaveProperty('ID')
      expect(response).toHaveProperty('TITLE')
    })
  })

  // ── Leads ──

  describe('createLead + getLead + updateLead + addTimelineComment + createActivity + deleteLead', () => {
    let leadId

    it('creates a lead', async () => {
      const response = await service.createLead(
        `E2E Lead ${ suffix }`,
        'E2E',
        'Tester',
        `e2e-lead-${ suffix }@example.com`,
        '+15550000000'
      )

      expect(response).toHaveProperty('id')
      leadId = response.id
    })

    it('retrieves the created lead', async () => {
      const response = await service.getLead(leadId)

      expect(response).toHaveProperty('ID', String(leadId))
      expect(response).toHaveProperty('TITLE', `E2E Lead ${ suffix }`)
    })

    it('updates the lead', async () => {
      const response = await service.updateLead(leadId, { COMMENTS: 'Updated by e2e test' })

      expect(response).toEqual({ success: true, id: leadId })
    })

    it('adds a timeline comment to the lead', async () => {
      const response = await service.addTimelineComment('Lead', leadId, 'E2E timeline comment')

      expect(response).toHaveProperty('id')
    })

    it('creates an activity on the lead', async () => {
      const response = await service.createActivity('Lead', leadId, 'Meeting', `E2E meeting ${ suffix }`)

      expect(response).toHaveProperty('id')
    })

    it('lists activities on the lead', async () => {
      const response = await service.listActivities('Lead', leadId)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })

    it('deletes the lead', async () => {
      const response = await service.deleteLead(leadId)

      expect(response).toEqual({ success: true, id: leadId })
    })
  })

  describe('listLeads', () => {
    it('returns leads with expected shape', async () => {
      const response = await service.listLeads(undefined, undefined, undefined, undefined, ['ID', 'TITLE'], 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Contacts ──

  describe('createContact + getContact + updateContact + deleteContact', () => {
    let contactId

    it('creates a contact', async () => {
      const response = await service.createContact(
        'E2E',
        `Contact ${ suffix }`,
        `e2e-contact-${ suffix }@example.com`,
        '+15550000001'
      )

      expect(response).toHaveProperty('id')
      contactId = response.id
    })

    it('retrieves the created contact', async () => {
      const response = await service.getContact(contactId)

      expect(response).toHaveProperty('ID', String(contactId))
      expect(response).toHaveProperty('NAME', 'E2E')
    })

    it('updates the contact', async () => {
      const response = await service.updateContact(contactId, { COMMENTS: 'Updated by e2e test' })

      expect(response).toEqual({ success: true, id: contactId })
    })

    it('deletes the contact', async () => {
      const response = await service.deleteContact(contactId)

      expect(response).toEqual({ success: true, id: contactId })
    })
  })

  describe('listContacts', () => {
    it('returns contacts with expected shape', async () => {
      const response = await service.listContacts(undefined, undefined, undefined, ['ID', 'NAME'], 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Companies ──

  describe('createCompany + getCompany + updateCompany + deleteCompany', () => {
    let companyId

    it('creates a company', async () => {
      const response = await service.createCompany(`E2E Company ${ suffix }`, 'CUSTOMER')

      expect(response).toHaveProperty('id')
      companyId = response.id
    })

    it('retrieves the created company', async () => {
      const response = await service.getCompany(companyId)

      expect(response).toHaveProperty('ID', String(companyId))
      expect(response).toHaveProperty('TITLE', `E2E Company ${ suffix }`)
    })

    it('updates the company', async () => {
      const response = await service.updateCompany(companyId, { INDUSTRY: 'IT' })

      expect(response).toEqual({ success: true, id: companyId })
    })

    it('deletes the company', async () => {
      const response = await service.deleteCompany(companyId)

      expect(response).toEqual({ success: true, id: companyId })
    })
  })

  describe('listCompanies', () => {
    it('returns companies with expected shape', async () => {
      const response = await service.listCompanies(undefined, undefined, undefined, ['ID', 'TITLE'], 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Deals ──

  describe('createDeal + getDeal + updateDeal + deleteDeal', () => {
    let dealId

    it('creates a deal', async () => {
      const response = await service.createDeal(`E2E Deal ${ suffix }`, undefined, undefined, undefined, undefined, 1000, 'USD')

      expect(response).toHaveProperty('id')
      dealId = response.id
    })

    it('retrieves the created deal', async () => {
      const response = await service.getDeal(dealId)

      expect(response).toHaveProperty('ID', String(dealId))
      expect(response).toHaveProperty('TITLE', `E2E Deal ${ suffix }`)
    })

    it('updates the deal', async () => {
      const response = await service.updateDeal(dealId, { OPPORTUNITY: 2000 })

      expect(response).toEqual({ success: true, id: dealId })
    })

    it('deletes the deal', async () => {
      const response = await service.deleteDeal(dealId)

      expect(response).toEqual({ success: true, id: dealId })
    })
  })

  describe('listDeals', () => {
    it('returns deals with expected shape', async () => {
      const response = await service.listDeals(undefined, undefined, undefined, undefined, undefined, ['ID', 'TITLE'], 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Tasks ──

  describe('createTask + getTask + updateTask + completeTask + deleteTask', () => {
    let taskId

    it('creates a task', async () => {
      // RESPONSIBLE_ID is required; default to the webhook owner (user 1) unless
      // testValues.responsibleId supplies a real portal user id.
      const response = await service.createTask(
        `E2E Task ${ suffix }`,
        'Created by e2e test',
        testValues.responsibleId || '1'
      )

      expect(response).toHaveProperty('id')
      taskId = response.id
    })

    it('retrieves the created task', async () => {
      const response = await service.getTask(taskId)

      expect(response).toHaveProperty('id', String(taskId))
    })

    it('updates the task', async () => {
      const response = await service.updateTask(taskId, { TITLE: `E2E Task Updated ${ suffix }` })

      expect(response).toHaveProperty('success', true)
    })

    it('completes the task', async () => {
      const response = await service.completeTask(taskId)

      expect(response).toEqual({ success: true, id: taskId })
    })

    it('deletes the task', async () => {
      const response = await service.deleteTask(taskId)

      expect(response).toEqual({ success: true, id: taskId })
    })
  })

  describe('listTasks', () => {
    it('returns tasks with expected shape', async () => {
      const response = await service.listTasks(undefined, undefined, undefined, ['ID', 'TITLE'], 0)

      expect(response).toHaveProperty('items')
      expect(Array.isArray(response.items)).toBe(true)
    })
  })

  // ── Messaging ──

  describe('sendNotification', () => {
    // Sending a notification requires the im scope and a target user, so this
    // only runs when the developer supplies testValues.notifyUserId.
    it('sends a notification when a target user is configured', async () => {
      if (!testValues.notifyUserId) {
        console.log('Skipping sendNotification: set testValues.notifyUserId')
        return
      }

      const response = await service.sendNotification(testValues.notifyUserId, `E2E notification ${ suffix }`)

      expect(response).toHaveProperty('notificationId')
    })
  })

  // ── Advanced ──

  describe('callRestMethod', () => {
    it('calls an arbitrary REST method and returns the raw envelope', async () => {
      const response = await service.callRestMethod('profile', {})

      expect(response).toHaveProperty('result')
    })
  })
})
