'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Jira Issues Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('jira-issues')
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

  describe('getProjectsDictionary', () => {
    it('returns dictionary items with expected shape', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getPrioritiesDictionary', () => {
    it('returns priority items', async () => {
      const result = await service.getPrioritiesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })
  })

  describe('getIssueTypesDictionary', () => {
    it('returns issue types for the configured project', async () => {
      const result = await service.getIssueTypesDictionary({
        criteria: { projectKey: testValues.projectKey },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('returns empty items when no projectKey provided', async () => {
      const result = await service.getIssueTypesDictionary({ criteria: {} })

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Projects ──

  describe('getProject', () => {
    it('returns project details with expected shape', async () => {
      const result = await service.getProject(testValues.projectKey)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('key', testValues.projectKey)
      expect(result).toHaveProperty('name')
    })
  })

  // ── Issue CRUD lifecycle ──

  describe('issue lifecycle: create, get, update, search, comment, transition, delete', () => {
    let createdIssueKey
    let createdCommentId

    it('creates an issue', async () => {
      const result = await service.createIssue(
        testValues.projectKey,
        testValues.issueType || 'Task',
        `E2E Test Issue ${Date.now()}`,
        'This issue was created by an automated e2e test.',
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('key')
      createdIssueKey = result.key
    })

    it('retrieves the created issue', async () => {
      const result = await service.getIssue(createdIssueKey)

      expect(result).toHaveProperty('key', createdIssueKey)
      expect(result).toHaveProperty('fields')
      expect(result.fields).toHaveProperty('summary')
    })

    it('updates the issue summary', async () => {
      const result = await service.updateIssue(createdIssueKey, 'Updated E2E Summary')

      expect(result).toEqual({ success: true })
    })

    it('searches for the created issue via JQL', async () => {
      const result = await service.searchIssues(`key = ${createdIssueKey}`, 0, 5)

      expect(result).toHaveProperty('issues')
      expect(result.issues.length).toBeGreaterThan(0)
      expect(result.issues[0]).toHaveProperty('key', createdIssueKey)
    })

    it('adds a comment to the issue', async () => {
      const result = await service.addComment(createdIssueKey, 'E2E test comment')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('body')
      createdCommentId = result.id
    })

    it('retrieves comments for the issue', async () => {
      const result = await service.getComments(createdIssueKey)

      expect(result).toHaveProperty('comments')
      expect(Array.isArray(result.comments)).toBe(true)
      expect(result.comments.length).toBeGreaterThan(0)
    })

    it('updates the comment', async () => {
      const result = await service.updateComment(createdIssueKey, createdCommentId, 'Updated e2e comment')

      expect(result).toHaveProperty('id', createdCommentId)
    })

    it('deletes the comment', async () => {
      const result = await service.deleteComment(createdIssueKey, createdCommentId)

      expect(result).toEqual({ success: true })
    })

    it('retrieves available transitions for the issue', async () => {
      const result = await service.getTransitionsDictionary({
        criteria: { issueIdOrKey: createdIssueKey },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
    })

    it('assigns the issue (unassign)', async () => {
      const result = await service.assignIssue(createdIssueKey)

      expect(result).toEqual({ success: true })
    })

    it('deletes the created issue', async () => {
      const result = await service.deleteIssue(createdIssueKey)

      expect(result).toEqual({ success: true })
    })
  })
})
