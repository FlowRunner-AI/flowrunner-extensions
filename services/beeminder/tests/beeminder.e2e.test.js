'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Beeminder Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('beeminder')
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

  // ── User ──

  describe('getUser', () => {
    it('returns the authenticated user with expected shape', async () => {
      const response = await service.getUser()

      expect(response).toHaveProperty('username')
      expect(response).toHaveProperty('timezone')
    })

    it('returns full associations when requested', async () => {
      const response = await service.getUser(true)

      expect(response).toHaveProperty('username')
      // With associations, goals come back as full objects rather than slugs.
      expect(response).toHaveProperty('goals')
    })
  })

  // ── Goals (read-only) ──

  describe('listGoals', () => {
    it('returns an array of goals', async () => {
      const response = await service.listGoals()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getGoalsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getGoalsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('accepts a search term without throwing', async () => {
      const result = await service.getGoalsDictionary({ search: 'zzz-unlikely-match' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Goal + datapoint lifecycle ──
  //
  // Creating a goal on a real account may be limited/blocked depending on plan
  // and payment status. Supply testValues.goalSlug to point the datapoint tests
  // at an existing goal instead of creating one. If neither is available, the
  // create-based tests are skipped so the suite still runs green.

  describe('getGoal', () => {
    it('returns the goal by slug when a goalSlug test value is provided', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping getGoal: set testValues.goalSlug to an existing goal slug')
        return
      }

      const response = await service.getGoal(testValues.goalSlug)

      expect(response).toHaveProperty('slug', testValues.goalSlug)
      expect(response).toHaveProperty('goal_type')
    })

    it('includes datapoints when requested', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping getGoal(datapoints): set testValues.goalSlug')
        return
      }

      const response = await service.getGoal(testValues.goalSlug, true)

      expect(response).toHaveProperty('datapoints')
      expect(Array.isArray(response.datapoints)).toBe(true)
    })
  })

  describe('listDatapoints', () => {
    it('returns datapoints for an existing goal', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping listDatapoints: set testValues.goalSlug')
        return
      }

      const response = await service.listDatapoints(testValues.goalSlug, 'timestamp', 5)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createDatapoint + updateDatapoint + deleteDatapoint', () => {
    let datapointId

    it('creates a datapoint on the configured goal', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping datapoint lifecycle: set testValues.goalSlug')
        return
      }

      const response = await service.createDatapoint(
        testValues.goalSlug,
        1,
        undefined,
        undefined,
        `e2e datapoint ${ suffix }`,
        `e2e-${ suffix }`
      )

      expect(response).toHaveProperty('id')
      datapointId = response.id
    })

    it('updates the created datapoint', async () => {
      if (!datapointId) {
        console.log('Skipping updateDatapoint: no datapoint was created')
        return
      }

      const response = await service.updateDatapoint(
        testValues.goalSlug,
        datapointId,
        2,
        undefined,
        `e2e updated ${ suffix }`
      )

      expect(response).toHaveProperty('id', datapointId)
      expect(response).toHaveProperty('value', 2)
    })

    it('deletes the created datapoint', async () => {
      if (!datapointId) {
        console.log('Skipping deleteDatapoint: no datapoint was created')
        return
      }

      const response = await service.deleteDatapoint(testValues.goalSlug, datapointId)

      expect(response).toHaveProperty('id', datapointId)
    })
  })

  describe('createDatapointsBatch', () => {
    it('creates multiple datapoints at once on the configured goal', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping createDatapointsBatch: set testValues.goalSlug')
        return
      }

      const response = await service.createDatapointsBatch(testValues.goalSlug, [
        { value: 1, comment: `e2e batch a ${ suffix }`, requestid: `e2e-batch-a-${ suffix }` },
        { value: 1, comment: `e2e batch b ${ suffix }`, requestid: `e2e-batch-b-${ suffix }` },
      ])

      expect(Array.isArray(response)).toBe(true)

      // Clean up the datapoints we just created.
      for (const dp of response) {
        if (dp && dp.id) {
          try {
            await service.deleteDatapoint(testValues.goalSlug, dp.id)
          } catch (e) {
            // ignore cleanup errors
          }
        }
      }
    })
  })

  describe('refreshGoalGraph', () => {
    it('queues a graph refresh for an existing goal', async () => {
      if (!testValues.goalSlug) {
        console.log('Skipping refreshGoalGraph: set testValues.goalSlug')
        return
      }

      const response = await service.refreshGoalGraph(testValues.goalSlug)

      // Beeminder returns the graph image URL (or true) when queued.
      expect(response).toBeDefined()
    })
  })

  // ── Goal create/update (destructive; opt-in) ──
  //
  // Creating goals can be blocked on some accounts and permanently mutates the
  // account. Only runs when testValues.allowGoalCreation is truthy. Cleans up by
  // deleting the goal is NOT supported by the Beeminder API, so the goal remains
  // — use a throwaway/test account.

  describe('createGoal + updateGoal', () => {
    it('creates and then updates a goal when explicitly allowed', async () => {
      if (!testValues.allowGoalCreation) {
        console.log(
          'Skipping createGoal/updateGoal: set testValues.allowGoalCreation=true (uses a throwaway account; goals cannot be deleted via API)'
        )
        return
      }

      const slug = `e2e-goal-${ suffix }`

      const created = await service.createGoal(
        slug,
        `E2E Goal ${ suffix }`,
        'Do More (hustler)',
        'things',
        undefined,
        undefined,
        1
      )

      expect(created).toHaveProperty('slug', slug)

      const updated = await service.updateGoal(slug, `E2E Goal Updated ${ suffix }`)

      expect(updated).toHaveProperty('slug', slug)
    })
  })

  // ── Charges (real money; opt-in dry run only) ──

  describe('chargeUser', () => {
    it('validates a charge via dry run when explicitly allowed', async () => {
      if (!testValues.allowCharge) {
        console.log('Skipping chargeUser: set testValues.allowCharge=true to run a dry-run charge')
        return
      }

      const response = await service.chargeUser(1, `e2e dry-run charge ${ suffix }`, true)

      expect(response).toHaveProperty('amount')
    })
  })
})
