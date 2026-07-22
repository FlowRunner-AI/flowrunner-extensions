'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Personio Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('personio')
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

  // ── Connection ──

  describe('testConnection', () => {
    it('reports the status of each connection lane', async () => {
      const result = await service.testConnection()

      expect(result).toHaveProperty('legacyLane')
      expect(result).toHaveProperty('modernLane')
      expect(result).toHaveProperty('recruitingLane')
      expect(result).toMatchObject({ partnerId: 'BACKENDLESS', appId: 'FLOWRUNNER' })

      expect(result.legacyLane).toBe('ok')
      expect(result.modernLane).toBe('ok')
    })
  })

  // ── Dictionaries ──

  describe('dictionaries', () => {
    it('lists people', async () => {
      const result = await service.listPeopleDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('lists time-off types', async () => {
      const result = await service.listAbsenceTypesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
    })

    it('lists document categories', async () => {
      const result = await service.listDocumentCategoriesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists legal entities', async () => {
      const result = await service.listLegalEntitiesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('derives departments, cost centers and offices from employees', async () => {
      const departments = await service.listOrgUnitsDictionary({})
      const costCenters = await service.listCostCentersDictionary({})
      const offices = await service.listWorkplacesDictionary({})

      expect(Array.isArray(departments.items)).toBe(true)
      expect(Array.isArray(costCenters.items)).toBe(true)
      expect(Array.isArray(offices.items)).toBe(true)
    })

    it('lists projects', async () => {
      const result = await service.listProjectsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists compensation types', async () => {
      const result = await service.listCompensationTypesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('lists analytics and custom reports', async () => {
      const standard = await service.listV2ReportsDictionary({})
      const custom = await service.listCustomReportsDictionary({})

      expect(Array.isArray(standard.items)).toBe(true)
      expect(Array.isArray(custom.items)).toBe(true)
    })

    it('lists employee attributes', async () => {
      const result = await service.listEmployeeAttributesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('lists webhooks', async () => {
      const result = await service.listWebhooksDictionary({})

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── People ──

  describe('findPeople', () => {
    it('lists people', async () => {
      const result = await service.findPeople()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('total')
    })

    it('fetches a single person by id', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping findPeople by id: testValues.personId not set')

        return
      }

      const result = await service.findPeople(personId)

      expect(result.total).toBe(1)
      expect(result.items[0]).toHaveProperty('id')
    })
  })

  describe('getEmployeePhoto', () => {
    it('returns a photo payload (possibly empty) for a person', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping getEmployeePhoto: testValues.personId not set')

        return
      }

      const result = await service.getEmployeePhoto(personId, 128)

      expect(result).toMatchObject({ personId, width: 128 })
      expect(typeof result.base64).toBe('string')
    })
  })

  describe('deletePerson', () => {
    it('refuses without confirmation', async () => {
      await expect(service.deletePerson('does-not-matter')).rejects.toThrow(/Confirm deletion/)
    })
  })

  // ── Employments ──

  describe('findEmployments', () => {
    it('lists the employments of a person', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping findEmployments: testValues.personId not set')

        return
      }

      const result = await service.findEmployments(personId)

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('endEmployment', () => {
    it('refuses without confirmation', async () => {
      await expect(service.endEmployment('1', '2030-01-01')).rejects.toThrow(/Confirm termination/)
    })
  })

  // ── Time off ──

  describe('time off', () => {
    it('lists absence periods', async () => {
      const result = await service.findTimeOff()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('returns the time-off balance for a person', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping getTimeOffBalance: testValues.personId not set')

        return
      }

      const result = await service.getTimeOffBalance(personId)

      expect(result).toMatchObject({ personId })
      expect(Array.isArray(result.balances)).toBe(true)
    })

    it('requests and withdraws a whole-day absence', async () => {
      const { personId, absenceTypeId } = testValues

      if (!personId || !absenceTypeId) {
        console.log('Skipping requestTimeOff: testValues.personId or testValues.absenceTypeId not set')

        return
      }

      const created = await service.requestTimeOff(
        personId,
        absenceTypeId,
        'Whole days',
        { startDate: '2030-08-15', endDate: '2030-08-16' },
        `FlowRunner e2e ${ SUFFIX }`,
        true
      )

      expect(created).toHaveProperty('id')

      const timeOffId = created.id

      await expect(service.findTimeOff(String(timeOffId))).resolves.toHaveProperty('total', 1)
      await expect(service.withdrawTimeOff(String(timeOffId))).resolves.toMatchObject({ withdrawn: true })
    })
  })

  describe('requestTimeOffSchemaLoader', () => {
    it('returns a schema for both modes', async () => {
      const wholeDays = await service.requestTimeOffSchemaLoader({ criteria: { mode: 'Whole days' } })
      const partial = await service.requestTimeOffSchemaLoader({ criteria: { mode: 'Part of a day' } })

      expect(wholeDays.map(field => field.name)).toEqual(['startDate', 'endDate', 'halfDayStart', 'halfDayEnd'])
      expect(partial.map(field => field.name)).toEqual(['startsAt', 'endsAt'])
    })
  })

  // ── Time tracking ──

  describe('time tracking', () => {
    it('lists attendance periods', async () => {
      const result = await service.findTimeEntries()

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('summarizes tracked time over the last 30 days', async () => {
      const result = await service.summarizeTimeTracked(null, null, 'Last 30 days')

      expect(result).toHaveProperty('totalHours')
      expect(Array.isArray(result.byDay)).toBe(true)
      expect(Array.isArray(result.byPerson)).toBe(true)
    })

    it('tracks, updates and deletes a time entry', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping trackTime: testValues.personId not set')

        return
      }

      const created = await service.trackTime(
        personId,
        '2030-08-15T09:00:00',
        '2030-08-15T17:00:00',
        0,
        null,
        `FlowRunner e2e ${ SUFFIX }`
      )

      expect(created).toHaveProperty('id')

      await expect(
        service.updateTimeEntry(created.id, null, '2030-08-15T16:00:00', 0, null, 'adjusted')
      ).resolves.toBeDefined()

      await expect(service.deleteTimeEntry(created.id)).resolves.toMatchObject({ deleted: true })
    })
  })

  // ── Documents ──

  describe('documents', () => {
    it('requires a person when listing', async () => {
      await expect(service.findDocuments()).rejects.toThrow(/requires a Person/)
    })

    it('lists the documents of a person', async () => {
      const { personId } = testValues

      if (!personId) {
        console.log('Skipping findDocuments: testValues.personId not set')

        return
      }

      const result = await service.findDocuments(null, personId)

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('refuses an empty upload', async () => {
      await expect(service.uploadDocument('1', 'T', '1', 'a.pdf', '')).rejects.toThrow(/file content is empty/)
    })
  })

  // ── Reports ──

  describe('reports', () => {
    it('refuses to run without a report picked', async () => {
      await expect(service.runReport('Standard', {})).rejects.toThrow(/pick a report/)
    })

    it('runs a standard analytics report', async () => {
      const { reportId } = testValues

      if (!reportId) {
        console.log('Skipping runReport: testValues.reportId not set')

        return
      }

      const result = await service.runReport('Standard', { reportId })

      expect(result).toMatchObject({ source: 'Standard', reportId })
      expect(Array.isArray(result.rows)).toBe(true)
    })

    it('lists the available report columns', async () => {
      const result = await service.listReportColumns()

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Organization ──

  describe('organization', () => {
    it('lists legal entities, departments, cost centers and offices', async () => {
      const entities = await service.findLegalEntities()
      const departments = await service.findDepartments()
      const costCenters = await service.findCostCenters()
      const offices = await service.findOffices()

      expect(Array.isArray(entities.items)).toBe(true)
      expect(Array.isArray(departments.items)).toBe(true)
      expect(Array.isArray(costCenters.items)).toBe(true)
      expect(Array.isArray(offices.items)).toBe(true)
    })
  })

  // ── Compensations ──

  describe('findCompensations', () => {
    it('lists compensations', async () => {
      const result = await service.findCompensations()

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Projects ──

  describe('projects', () => {
    let projectId

    it('creates a project', async () => {
      const result = await service.addProject(`FlowRunner e2e ${ SUFFIX }`)

      expect(result).toHaveProperty('id')
      projectId = result.id
    })

    it('finds the created project by id', async () => {
      if (!projectId) {
        console.log('Skipping findProjects by id: no project was created')

        return
      }

      const result = await service.findProjects(projectId)

      expect(result.total).toBe(1)
    })

    it('lists active projects', async () => {
      const result = await service.findProjects(null, 'Active')

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('renames the project', async () => {
      if (!projectId) {
        console.log('Skipping updateProject: no project was created')

        return
      }

      await expect(service.updateProject(projectId, `FlowRunner e2e ${ SUFFIX } renamed`)).resolves.toBeDefined()
    })

    it('lists the project members', async () => {
      if (!projectId) {
        console.log('Skipping findProjectMembers: no project was created')

        return
      }

      const result = await service.findProjectMembers(projectId)

      expect(result).toMatchObject({ projectId })
      expect(Array.isArray(result.items)).toBe(true)
    })

    it('refuses a member update with no people selected', async () => {
      await expect(service.updateProjectMembers('p_1', 'Add', { personIds: [] })).rejects.toThrow(
        /pick at least one person/
      )
    })

    it('adds and removes a project member', async () => {
      const { personId } = testValues

      if (!projectId || !personId) {
        console.log('Skipping project member update: no project created or testValues.personId not set')

        return
      }

      await expect(
        service.updateProjectMembers(projectId, 'Add', { personIds: [personId] })
      ).resolves.toMatchObject({ affected: 1 })

      await expect(
        service.updateProjectMembers(projectId, 'Remove', { personIds: [personId] })
      ).resolves.toMatchObject({ affected: 1 })
    })

    it('deletes the project', async () => {
      if (!projectId) {
        console.log('Skipping deleteProject: no project was created')

        return
      }

      await expect(service.deleteProject(projectId)).resolves.toMatchObject({ deleted: true })
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    it('lists webhooks', async () => {
      const result = await service.findWebhooks()

      expect(Array.isArray(result.items)).toBe(true)
    })

    it('registers, inspects and removes a trigger webhook', async () => {
      const upserted = await service.handleTriggerUpsertWebhook({
        events: [{ name: 'onPeopleChange' }],
        callbackURL: `https://example.com/flowrunner-e2e/${ SUFFIX }`,
      })

      expect(upserted.webhookData).toHaveProperty('webhookId')
      expect(typeof upserted.webhookData.secret).toBe('string')

      const webhookId = upserted.webhookData.webhookId

      const found = await service.findWebhooks(webhookId)
      expect(found.total).toBe(1)

      await expect(
        service.handleTriggerDeleteWebhook({ webhookData: { webhookId } })
      ).resolves.toEqual({})
    })
  })

  // ── Trigger lifecycle (no HTTP) ──

  describe('trigger event handling', () => {
    it('resolves a Personio webhook payload into a trigger event', async () => {
      const result = await service.handleTriggerResolveEvents({
        body: { event_name: 'person.updated', data: { person: { id: '42' } }, changes: ['email'] },
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0].name).toBe('onPeopleChange')
      expect(result.events[0].data.change).toBe('Updated')
    })

    it('ignores an unknown event', async () => {
      const result = await service.handleTriggerResolveEvents({ body: { event_name: 'nope.nope' } })

      expect(result).toEqual({ events: [] })
    })

    it('selects the triggers whose filter matches the change', async () => {
      const result = await service.handleTriggerSelectMatched({
        eventName: 'onPeopleChange',
        body: { change: 'Updated' },
        triggers: [
          { id: 'a', triggerData: { eventType: 'Any' } },
          { id: 'b', triggerData: { eventType: 'Created' } },
        ],
      })

      expect(result).toEqual({ ids: ['a'] })
    })
  })

  // ── Recruiting ──

  describe('recruiting', () => {
    it('refuses an empty applicant document upload', async () => {
      await expect(service.uploadApplicantDocument('app_1', 'cv', 'cv.pdf', '')).rejects.toThrow(
        /file content is empty/
      )
    })

    it('creates a candidate when a recruiting job id is provided', async () => {
      const { recruitingJobId } = testValues

      if (!recruitingJobId) {
        console.log('Skipping createCandidate: testValues.recruitingJobId not set')

        return
      }

      const result = await service.createCandidate(
        'FlowRunner',
        `E2E ${ SUFFIX }`,
        `flowrunner.e2e.${ SUFFIX }@example.com`,
        recruitingJobId
      )

      expect(result).toHaveProperty('applicationId')
      expect(result).toHaveProperty('jobId', recruitingJobId)
    })
  })
})
