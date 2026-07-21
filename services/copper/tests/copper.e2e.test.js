'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Copper Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('copper')
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

  const stamp = Date.now()

  // ── Dictionaries ──

  describe('getUsersDictionary', () => {
    it('returns a dictionary with an items array and a cursor', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('cursor')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getPipelinesDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      const result = await service.getPipelinesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getPipelineStagesDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      const result = await service.getPipelineStagesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCustomerSourcesDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      const result = await service.getCustomerSourcesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getLossReasonsDictionary', () => {
    it('returns a dictionary with an items array', async () => {
      const result = await service.getLossReasonsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── People lifecycle ──

  describe('person create → get → search → update → delete', () => {
    let personId

    it('creates a person', async () => {
      const result = await service.createPerson(`E2E Person ${ stamp }`, `e2e-person-${ stamp }@example.com`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `E2E Person ${ stamp }`)
      personId = result.id
    })

    it('gets the created person', async () => {
      const result = await service.getPerson(personId)

      expect(result).toHaveProperty('id', personId)
    })

    it('searches for people', async () => {
      const result = await service.searchPeople(`E2E Person ${ stamp }`)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the person', async () => {
      const result = await service.updatePerson(personId, undefined, undefined, undefined, undefined, undefined, 'Updated Title')

      expect(result).toHaveProperty('id', personId)
      expect(result).toHaveProperty('title', 'Updated Title')
    })

    it('deletes the person', async () => {
      const result = await service.deletePerson(personId)

      expect(result).toEqual({ deleted: true, id: personId })
    })
  })

  // ── Companies lifecycle ──

  describe('company create → get → search → update → delete', () => {
    let companyId

    it('creates a company', async () => {
      const result = await service.createCompany(`E2E Company ${ stamp }`, 'e2e-example.com')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `E2E Company ${ stamp }`)
      companyId = result.id
    })

    it('gets the created company', async () => {
      const result = await service.getCompany(companyId)

      expect(result).toHaveProperty('id', companyId)
    })

    it('searches for companies', async () => {
      const result = await service.searchCompanies(`E2E Company ${ stamp }`)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the company', async () => {
      const result = await service.updateCompany(companyId, `E2E Company ${ stamp } Updated`)

      expect(result).toHaveProperty('id', companyId)
    })

    it('deletes the company', async () => {
      const result = await service.deleteCompany(companyId)

      expect(result).toEqual({ deleted: true, id: companyId })
    })
  })

  // ── Leads lifecycle ──

  describe('lead create → get → search → update → delete', () => {
    let leadId

    it('creates a lead', async () => {
      const result = await service.createLead(`E2E Lead ${ stamp }`, `e2e-lead-${ stamp }@example.com`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `E2E Lead ${ stamp }`)
      leadId = result.id
    })

    it('gets the created lead', async () => {
      const result = await service.getLead(leadId)

      expect(result).toHaveProperty('id', leadId)
    })

    it('searches for leads', async () => {
      const result = await service.searchLeads(`E2E Lead ${ stamp }`)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the lead', async () => {
      const result = await service.updateLead(leadId, undefined, undefined, undefined, undefined, undefined, undefined, 5000)

      expect(result).toHaveProperty('id', leadId)
    })

    it('deletes the lead', async () => {
      const result = await service.deleteLead(leadId)

      expect(result).toEqual({ deleted: true, id: leadId })
    })
  })

  // ── Opportunities lifecycle ──
  // Requires testValues.pipelineId. Falls back to the first pipeline in the
  // account when not supplied.

  describe('opportunity create → get → search → update → delete', () => {
    let opportunityId
    let pipelineId

    beforeAll(async () => {
      pipelineId = testValues.pipelineId

      if (!pipelineId) {
        const pipelines = await service.getPipelinesDictionary({})
        pipelineId = pipelines.items[0] && pipelines.items[0].value
      }
    })

    it('creates an opportunity', async () => {
      if (!pipelineId) {
        console.log('Skipping opportunity create — no pipeline available')
        return
      }

      const result = await service.createOpportunity(`E2E Opportunity ${ stamp }`, pipelineId)

      expect(result).toHaveProperty('id')
      opportunityId = result.id
    })

    it('gets the created opportunity', async () => {
      if (!opportunityId) return

      const result = await service.getOpportunity(opportunityId)

      expect(result).toHaveProperty('id', opportunityId)
    })

    it('searches for opportunities', async () => {
      const result = await service.searchOpportunities(`E2E Opportunity ${ stamp }`)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the opportunity', async () => {
      if (!opportunityId) return

      const result = await service.updateOpportunity(opportunityId, undefined, undefined, 25000)

      expect(result).toHaveProperty('id', opportunityId)
    })

    it('deletes the opportunity', async () => {
      if (!opportunityId) return

      const result = await service.deleteOpportunity(opportunityId)

      expect(result).toEqual({ deleted: true, id: opportunityId })
    })
  })

  // ── Tasks lifecycle ──

  describe('task create → list → update → delete', () => {
    let taskId

    it('creates a task', async () => {
      const result = await service.createTask(`E2E Task ${ stamp }`)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', `E2E Task ${ stamp }`)
      taskId = result.id
    })

    it('lists tasks', async () => {
      const result = await service.listTasks(1, 20)

      expect(Array.isArray(result)).toBe(true)
    })

    it('updates the task', async () => {
      const result = await service.updateTask(taskId, undefined, undefined, undefined, undefined, 'Completed')

      expect(result).toHaveProperty('id', taskId)
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(taskId)

      expect(result).toEqual({ deleted: true, id: taskId })
    })
  })

  // ── Activities ──
  // Logs a note activity against a temporary person, then lists activities.

  describe('activity create → list', () => {
    let personId

    beforeAll(async () => {
      const person = await service.createPerson(`E2E Activity Person ${ stamp }`)
      personId = person.id
    })

    afterAll(async () => {
      if (personId) {
        await service.deletePerson(personId)
      }
    })

    it('creates a note activity on the person', async () => {
      const result = await service.createActivity('User', 'note', 'Person', personId, `E2E note ${ stamp }`)

      expect(result).toHaveProperty('id')
    })

    it('lists activities for the person', async () => {
      const result = await service.listActivities('Person', personId)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
