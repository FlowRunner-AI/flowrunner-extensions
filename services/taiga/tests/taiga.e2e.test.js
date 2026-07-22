'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Taiga Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('taiga')
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

  // ── Members ──

  describe('getMe', () => {
    it('returns authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('username')
      expect(result).toHaveProperty('email')
    })
  })

  // ── Projects ──

  describe('listProjects', () => {
    it('returns an array of projects', async () => {
      const result = await service.listProjects()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getProject', () => {
    it('retrieves a project by ID', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping getProject: testValues.projectId not set')
        return
      }

      const result = await service.getProject(projectId)

      expect(result).toHaveProperty('id', projectId)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('slug')
    })
  })

  describe('getProjectBySlug', () => {
    it('retrieves a project by slug', async () => {
      const { projectSlug } = testValues

      if (!projectSlug) {
        console.log('Skipping getProjectBySlug: testValues.projectSlug not set')
        return
      }

      const result = await service.getProjectBySlug(projectSlug)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('slug', projectSlug)
    })
  })

  // ── Dictionary ──

  describe('getProjectsDictionary', () => {
    it('returns dictionary items with label and value', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── User Stories CRUD ──

  describe('User Story lifecycle', () => {
    let createdStoryId
    let storyVersion

    it('creates a user story', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping createUserStory: testValues.projectId not set')
        return
      }

      const result = await service.createUserStory(
        projectId,
        'E2E Test User Story',
        'Created by automated e2e test',
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', 'E2E Test User Story')
      expect(result).toHaveProperty('version')
      createdStoryId = result.id
      storyVersion = result.version
    })

    it('retrieves the created user story', async () => {
      if (!createdStoryId) {
        console.log('Skipping getUserStory: no story was created')
        return
      }

      const result = await service.getUserStory(createdStoryId)

      expect(result).toHaveProperty('id', createdStoryId)
      expect(result).toHaveProperty('subject', 'E2E Test User Story')
    })

    it('updates the user story', async () => {
      if (!createdStoryId) {
        console.log('Skipping updateUserStory: no story was created')
        return
      }

      const result = await service.updateUserStory(
        createdStoryId,
        storyVersion,
        'E2E Test User Story (Updated)',
      )

      expect(result).toHaveProperty('id', createdStoryId)
      expect(result).toHaveProperty('subject', 'E2E Test User Story (Updated)')
      storyVersion = result.version
    })

    it('deletes the user story', async () => {
      if (!createdStoryId) {
        console.log('Skipping deleteUserStory: no story was created')
        return
      }

      const result = await service.deleteUserStory(createdStoryId)

      expect(result).toEqual({ deleted: true, id: createdStoryId })
    })
  })

  // ── Tasks CRUD ──

  describe('Task lifecycle', () => {
    let createdTaskId
    let taskVersion

    it('creates a task', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping createTask: testValues.projectId not set')
        return
      }

      const result = await service.createTask(projectId, 'E2E Test Task', 'Created by e2e test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', 'E2E Test Task')
      expect(result).toHaveProperty('version')
      createdTaskId = result.id
      taskVersion = result.version
    })

    it('retrieves the created task', async () => {
      if (!createdTaskId) {
        console.log('Skipping getTask: no task was created')
        return
      }

      const result = await service.getTask(createdTaskId)

      expect(result).toHaveProperty('id', createdTaskId)
    })

    it('updates the task', async () => {
      if (!createdTaskId) {
        console.log('Skipping updateTask: no task was created')
        return
      }

      const result = await service.updateTask(
        createdTaskId,
        taskVersion,
        'E2E Test Task (Updated)',
      )

      expect(result).toHaveProperty('id', createdTaskId)
      taskVersion = result.version
    })

    it('deletes the task', async () => {
      if (!createdTaskId) {
        console.log('Skipping deleteTask: no task was created')
        return
      }

      const result = await service.deleteTask(createdTaskId)

      expect(result).toEqual({ deleted: true, id: createdTaskId })
    })
  })

  // ── Issues ──

  describe('Issues', () => {
    let createdIssueId

    it('lists issues', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listIssues: testValues.projectId not set')
        return
      }

      const result = await service.listIssues(projectId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('creates an issue', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping createIssue: testValues.projectId not set')
        return
      }

      const result = await service.createIssue(projectId, 'E2E Test Issue', 'Created by e2e test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('subject', 'E2E Test Issue')
      createdIssueId = result.id
    })

    it('retrieves the created issue', async () => {
      if (!createdIssueId) {
        console.log('Skipping getIssue: no issue was created')
        return
      }

      const result = await service.getIssue(createdIssueId)

      expect(result).toHaveProperty('id', createdIssueId)
      expect(result).toHaveProperty('subject', 'E2E Test Issue')
    })
  })

  // ── Epics ──

  describe('Epics', () => {
    it('lists epics', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listEpics: testValues.projectId not set')
        return
      }

      const result = await service.listEpics(projectId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Milestones ──

  describe('Milestones', () => {
    it('lists milestones', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listMilestones: testValues.projectId not set')
        return
      }

      const result = await service.listMilestones(projectId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Memberships ──

  describe('Memberships', () => {
    it('lists memberships for a project', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listMemberships: testValues.projectId not set')
        return
      }

      const result = await service.listMemberships(projectId)

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('user')
        expect(result[0]).toHaveProperty('role')
      }
    })
  })

  // ── User Stories list ──

  describe('listUserStories', () => {
    it('lists user stories for a project', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listUserStories: testValues.projectId not set')
        return
      }

      const result = await service.listUserStories(projectId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Tasks list ──

  describe('listTasks', () => {
    it('lists tasks for a project', async () => {
      const { projectId } = testValues

      if (!projectId) {
        console.log('Skipping listTasks: testValues.projectId not set')
        return
      }

      const result = await service.listTasks(projectId)

      expect(Array.isArray(result)).toBe(true)
    })
  })
})
