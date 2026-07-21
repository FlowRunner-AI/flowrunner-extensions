'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// Gong has no free/self-serve tier: every request needs a paid tenant with a
// Technical-Admin-minted Access Key + Secret. These e2e tests are read-heavy and
// shape-based. Write/destructive operations (Add Call, Upload Media, Create/Update/
// Delete Meeting, CRM register/upload/delete, data-erase, flow assign/unassign) are
// gated behind explicit testValues so a plain run never mutates or erases tenant data.
describe('Gong Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('gong')
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

  // A unique-ish suffix so repeated e2e runs don't collide on client-reference ids.
  const suffix = Date.now()
  // A 30-day lookback window used by the read/list endpoints.
  const fromDateTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const toDateTime = new Date().toISOString()

  // ── Workspaces ─────────────────────────────────────────────────────────

  describe('listWorkspaces', () => {
    it('returns workspaces with expected shape', async () => {
      const response = await service.listWorkspaces()

      expect(response).toHaveProperty('workspaces')
      expect(Array.isArray(response.workspaces)).toBe(true)
    })
  })

  describe('getWorkspacesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getWorkspacesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })
  })

  // ── Users ──────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    it('returns users with expected shape', async () => {
      const response = await service.listUsers()

      expect(response).toHaveProperty('users')
      expect(Array.isArray(response.users)).toBe(true)
    })
  })

  describe('listUsersExtensive', () => {
    it('returns users with a filter body', async () => {
      const response = await service.listUsersExtensive()

      expect(response).toHaveProperty('users')
      expect(Array.isArray(response.users)).toBe(true)
    })
  })

  describe('getUsersDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getUsersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getUser', () => {
    it('retrieves a single user when testValues.userId is set', async () => {
      if (!testValues.userId) {
        console.log('Skipping getUser: set testValues.userId')
        return
      }

      const response = await service.getUser(testValues.userId)

      expect(response).toHaveProperty('user')
      expect(response.user).toHaveProperty('id')
    })
  })

  // ── Calls ──────────────────────────────────────────────────────────────

  describe('listCalls', () => {
    it('returns calls with expected shape over the last 30 days', async () => {
      const response = await service.listCalls(fromDateTime, toDateTime)

      // Gong returns 404 when the range contains no calls; both shapes are valid.
      expect(response).toBeDefined()
      if (response && response.calls) {
        expect(Array.isArray(response.calls)).toBe(true)
      }
    })
  })

  describe('getCallsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCallsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCall', () => {
    it('retrieves a single call when testValues.callId is set', async () => {
      if (!testValues.callId) {
        console.log('Skipping getCall: set testValues.callId')
        return
      }

      const response = await service.getCall(testValues.callId)

      expect(response).toHaveProperty('call')
    })
  })

  describe('getExtensiveCallData', () => {
    it('returns extensive data for a date range', async () => {
      const response = await service.getExtensiveCallData(
        undefined,
        fromDateTime,
        toDateTime,
        undefined,
        true,
        false,
        true
      )

      expect(response).toBeDefined()
      if (response && response.calls) {
        expect(Array.isArray(response.calls)).toBe(true)
      }
    })
  })

  describe('getCallTranscripts', () => {
    it('returns transcripts for a date range', async () => {
      const response = await service.getCallTranscripts(undefined, fromDateTime, toDateTime)

      expect(response).toBeDefined()
      if (response && response.callTranscripts) {
        expect(Array.isArray(response.callTranscripts)).toBe(true)
      }
    })
  })

  // ── Library ────────────────────────────────────────────────────────────

  describe('listLibraryFolders', () => {
    it('returns folders when testValues.workspaceId is set', async () => {
      if (!testValues.workspaceId) {
        console.log('Skipping listLibraryFolders: set testValues.workspaceId')
        return
      }

      const response = await service.listLibraryFolders(testValues.workspaceId)

      expect(response).toHaveProperty('folders')
      expect(Array.isArray(response.folders)).toBe(true)
    })
  })

  describe('getLibraryFoldersDictionary', () => {
    it('returns items array for a workspace', async () => {
      if (!testValues.workspaceId) {
        console.log('Skipping getLibraryFoldersDictionary: set testValues.workspaceId')
        return
      }

      const result = await service.getLibraryFoldersDictionary({
        criteria: { workspaceId: testValues.workspaceId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Stats ──────────────────────────────────────────────────────────────

  describe('getActivityDayByDay', () => {
    it('returns per-day activity stats', async () => {
      const response = await service.getActivityDayByDay(fromDateTime, toDateTime)

      expect(response).toBeDefined()
    })
  })

  describe('getActivityAggregate', () => {
    it('returns aggregated activity stats', async () => {
      const response = await service.getActivityAggregate(fromDateTime, toDateTime)

      expect(response).toBeDefined()
    })
  })

  describe('getActivityByPeriod', () => {
    it('returns activity grouped by week', async () => {
      const response = await service.getActivityByPeriod(fromDateTime, toDateTime, 'Week')

      expect(response).toBeDefined()
    })
  })

  describe('getInteractionStats', () => {
    it('returns interaction stats', async () => {
      const response = await service.getInteractionStats(fromDateTime, toDateTime)

      expect(response).toBeDefined()
    })
  })

  // ── Scorecards ─────────────────────────────────────────────────────────

  describe('listScorecards', () => {
    it('returns scorecards with expected shape', async () => {
      const response = await service.listScorecards()

      expect(response).toHaveProperty('scorecards')
      expect(Array.isArray(response.scorecards)).toBe(true)
    })
  })

  describe('getScorecardsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getScorecardsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getAnsweredScorecards', () => {
    it('returns answered scorecards for a call date range', async () => {
      const response = await service.getAnsweredScorecards(fromDateTime, toDateTime)

      expect(response).toBeDefined()
    })
  })

  // ── Meetings ───────────────────────────────────────────────────────────

  describe('getMeetingIntegrationStatus', () => {
    it('returns the meeting integration status', async () => {
      const response = await service.getMeetingIntegrationStatus()

      expect(response).toBeDefined()
    })
  })

  describe('createMeeting + updateMeeting + deleteMeeting', () => {
    // Meetings need a real organizer + invitee email on the tenant, so this
    // only runs when the developer supplies them.
    const canRun = () => Boolean(testValues.organizerEmail && testValues.inviteeEmail)
    let meetingId

    it('creates a meeting when organizer + invitee are configured', async () => {
      if (!canRun()) {
        console.log('Skipping createMeeting: set testValues.organizerEmail and testValues.inviteeEmail')
        return
      }

      const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const end = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString()

      const response = await service.createMeeting(
        start,
        end,
        testValues.organizerEmail,
        [{ emailAddress: testValues.inviteeEmail, displayName: 'E2E Invitee' }],
        `E2E Meeting ${ suffix }`,
        `e2e-${ suffix }`
      )

      expect(response).toHaveProperty('meetingId')
      meetingId = response.meetingId
    })

    it('updates the meeting', async () => {
      if (!canRun() || !meetingId) {
        console.log('Skipping updateMeeting: no meeting created')
        return
      }

      const start = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
      const end = new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString()

      const response = await service.updateMeeting(
        meetingId,
        start,
        end,
        testValues.organizerEmail,
        [{ emailAddress: testValues.inviteeEmail, displayName: 'E2E Invitee' }],
        `E2E Meeting Updated ${ suffix }`
      )

      expect(response).toBeDefined()
    })

    it('deletes the meeting', async () => {
      if (!canRun() || !meetingId) {
        console.log('Skipping deleteMeeting: no meeting created')
        return
      }

      const response = await service.deleteMeeting(meetingId)

      expect(response).toBeDefined()
    })
  })

  // ── Data Privacy (read-only; erase is intentionally not exercised) ───────

  describe('getDataForEmail', () => {
    it('returns data for an email when testValues.dataPrivacyEmail is set', async () => {
      if (!testValues.dataPrivacyEmail) {
        console.log('Skipping getDataForEmail: set testValues.dataPrivacyEmail')
        return
      }

      const response = await service.getDataForEmail(testValues.dataPrivacyEmail)

      expect(response).toBeDefined()
    })
  })

  describe('getDataForPhone', () => {
    it('returns data for a phone when testValues.dataPrivacyPhone is set', async () => {
      if (!testValues.dataPrivacyPhone) {
        console.log('Skipping getDataForPhone: set testValues.dataPrivacyPhone (must start with +)')
        return
      }

      const response = await service.getDataForPhone(testValues.dataPrivacyPhone)

      expect(response).toBeDefined()
    })
  })

  // ── Logs ───────────────────────────────────────────────────────────────

  describe('listLogs', () => {
    it('returns logs when testValues.logType is set', async () => {
      if (!testValues.logType) {
        console.log('Skipping listLogs: set testValues.logType (Gong publishes no fixed list)')
        return
      }

      const response = await service.listLogs(testValues.logType, fromDateTime, toDateTime)

      expect(response).toBeDefined()
    })
  })

  // ── Permission Profiles ──────────────────────────────────────────────────

  describe('listPermissionProfiles + getPermissionProfile + users', () => {
    let profileId

    it('lists permission profiles for a workspace', async () => {
      if (!testValues.workspaceId) {
        console.log('Skipping listPermissionProfiles: set testValues.workspaceId')
        return
      }

      const response = await service.listPermissionProfiles(testValues.workspaceId)

      expect(response).toBeDefined()
      const profiles = (response && response.profiles) || []
      if (profiles.length) profileId = profiles[0].id
    })

    it('retrieves a single permission profile', async () => {
      if (!profileId) {
        console.log('Skipping getPermissionProfile: no profile discovered')
        return
      }

      const response = await service.getPermissionProfile(profileId, testValues.workspaceId)

      expect(response).toBeDefined()
    })

    it('lists the users of a permission profile', async () => {
      if (!profileId) {
        console.log('Skipping listPermissionProfileUsers: no profile discovered')
        return
      }

      const response = await service.listPermissionProfileUsers(profileId, testValues.workspaceId)

      expect(response).toBeDefined()
    })
  })

  describe('getPermissionProfilesDictionary', () => {
    it('returns items array for a workspace', async () => {
      if (!testValues.workspaceId) {
        console.log('Skipping getPermissionProfilesDictionary: set testValues.workspaceId')
        return
      }

      const result = await service.getPermissionProfilesDictionary({
        criteria: { workspaceId: testValues.workspaceId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── CRM Data API (read-only; write path gated on an explicit opt-in) ─────

  describe('listCrmIntegrations', () => {
    it('returns CRM integrations with expected shape', async () => {
      const response = await service.listCrmIntegrations()

      expect(response).toBeDefined()
    })
  })

  describe('getCrmIntegrationsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getCrmIntegrationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('listCrmObjectSchemaFields', () => {
    it('lists schema fields when testValues.crmIntegrationId is set', async () => {
      if (!testValues.crmIntegrationId) {
        console.log('Skipping listCrmObjectSchemaFields: set testValues.crmIntegrationId')
        return
      }

      const response = await service.listCrmObjectSchemaFields(testValues.crmIntegrationId)

      expect(response).toBeDefined()
    })
  })

  describe('getCrmRequestStatus', () => {
    it('checks a request status when both crm test values are set', async () => {
      if (!testValues.crmIntegrationId || !testValues.crmClientRequestId) {
        console.log('Skipping getCrmRequestStatus: set testValues.crmIntegrationId and testValues.crmClientRequestId')
        return
      }

      const response = await service.getCrmRequestStatus(
        testValues.crmIntegrationId,
        testValues.crmClientRequestId
      )

      expect(response).toBeDefined()
    })
  })

  // ── Engage Flows (read-only; assign/unassign gated) ──────────────────────

  describe('listFlows', () => {
    it('lists flows when testValues.flowOwnerEmail is set', async () => {
      if (!testValues.flowOwnerEmail) {
        console.log('Skipping listFlows: set testValues.flowOwnerEmail')
        return
      }

      const response = await service.listFlows(testValues.flowOwnerEmail)

      expect(response).toBeDefined()
    })
  })

  describe('getFlowsDictionary', () => {
    it('returns items array for a flow owner', async () => {
      if (!testValues.flowOwnerEmail) {
        console.log('Skipping getFlowsDictionary: set testValues.flowOwnerEmail')
        return
      }

      const result = await service.getFlowsDictionary({
        criteria: { flowOwnerEmail: testValues.flowOwnerEmail },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getProspectsAssignedFlows', () => {
    it('looks up assigned flows when testValues.crmProspectId is set', async () => {
      if (!testValues.crmProspectId) {
        console.log('Skipping getProspectsAssignedFlows: set testValues.crmProspectId')
        return
      }

      const response = await service.getProspectsAssignedFlows([testValues.crmProspectId])

      expect(response).toBeDefined()
    })
  })

  // ── Param schema loaders (pure) ──────────────────────────────────────────

  describe('param schema loaders', () => {
    it('getPartiesSchema returns an array', async () => {
      const schema = await service.getPartiesSchema()

      expect(Array.isArray(schema)).toBe(true)
    })

    it('getInviteesSchema returns an array', async () => {
      const schema = await service.getInviteesSchema()

      expect(Array.isArray(schema)).toBe(true)
    })

    it('getCrmSchemaFieldSchema returns an array', async () => {
      const schema = await service.getCrmSchemaFieldSchema()

      expect(Array.isArray(schema)).toBe(true)
    })
  })
})
