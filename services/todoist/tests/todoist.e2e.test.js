'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Todoist Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('todoist')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Projects lifecycle ──

  describe('projects lifecycle', () => {
    let projectId

    it('creates a project', async () => {
      const result = await service.createProject('E2E Test Project', 'Green', undefined, false, 'List')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Project')
      projectId = result.id
    })

    it('gets the created project', async () => {
      const result = await service.getProject(projectId)

      expect(result).toHaveProperty('id', projectId)
      expect(result).toHaveProperty('name', 'E2E Test Project')
    })

    it('lists projects', async () => {
      const result = await service.listProjects(5)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBeGreaterThan(0)
    })

    it('updates the project', async () => {
      const result = await service.updateProject(projectId, 'E2E Updated Project', 'Blue')

      expect(result).toHaveProperty('name', 'E2E Updated Project')
    })

    it('gets collaborators (may be empty for personal project)', async () => {
      const result = await service.getCollaborators(projectId)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('deletes the project', async () => {
      const result = await service.deleteProject(projectId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Sections lifecycle ──

  describe('sections lifecycle', () => {
    let projectId
    let sectionId

    beforeAll(async () => {
      const project = await service.createProject('E2E Sections Test')
      projectId = project.id
    })

    afterAll(async () => {
      try {
        await service.deleteProject(projectId)
      } catch (e) {
        // cleanup best-effort
      }
    })

    it('creates a section', async () => {
      const result = await service.createSection('E2E Section', projectId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Section')
      sectionId = result.id
    })

    it('lists sections in the project', async () => {
      const result = await service.listSections(projectId)

      expect(result).toHaveProperty('results')
      expect(result.results.length).toBeGreaterThan(0)
    })

    it('deletes the section', async () => {
      const result = await service.deleteSection(sectionId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Labels lifecycle ──

  describe('labels lifecycle', () => {
    let labelId

    it('creates a label', async () => {
      const result = await service.createLabel('e2e-test-label', 'Teal')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'e2e-test-label')
      labelId = result.id
    })

    it('lists labels', async () => {
      const result = await service.listLabels(10)

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('updates the label', async () => {
      const result = await service.updateLabel(labelId, 'e2e-test-label-updated', 'Violet')

      expect(result).toHaveProperty('name', 'e2e-test-label-updated')
    })

    it('deletes the label', async () => {
      const result = await service.deleteLabel(labelId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Tasks lifecycle ──

  describe('tasks lifecycle', () => {
    let projectId
    let taskId

    beforeAll(async () => {
      const project = await service.createProject('E2E Tasks Test')
      projectId = project.id
    })

    afterAll(async () => {
      try {
        await service.deleteProject(projectId)
      } catch (e) {
        // cleanup best-effort
      }
    })

    it('creates a task', async () => {
      const result = await service.createTask(
        'E2E Test Task',
        'Test description',
        projectId,
        undefined,
        undefined,
        ['e2e-task-label'],
        'P2 High',
        'tomorrow'
      )

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('content', 'E2E Test Task')
      taskId = result.id
    })

    it('gets the created task', async () => {
      const result = await service.getTask(taskId)

      expect(result).toHaveProperty('id', taskId)
      expect(result).toHaveProperty('content', 'E2E Test Task')
      expect(result).toHaveProperty('description', 'Test description')
    })

    it('lists tasks in the project', async () => {
      const result = await service.listTasks(projectId)

      expect(result).toHaveProperty('results')
      expect(result.results.length).toBeGreaterThan(0)
    })

    it('updates the task', async () => {
      const result = await service.updateTask(taskId, 'E2E Updated Task')

      expect(result).toHaveProperty('content', 'E2E Updated Task')
    })

    it('closes the task', async () => {
      const result = await service.closeTask(taskId)

      expect(result).toEqual({ success: true })
    })

    it('reopens the task', async () => {
      const result = await service.reopenTask(taskId)

      expect(result).toEqual({ success: true })
    })

    it('deletes the task', async () => {
      const result = await service.deleteTask(taskId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Task move ──

  describe('moveTask', () => {
    let projectId1
    let projectId2
    let taskId

    beforeAll(async () => {
      const p1 = await service.createProject('E2E Move Source')
      const p2 = await service.createProject('E2E Move Target')
      projectId1 = p1.id
      projectId2 = p2.id

      const task = await service.createTask('E2E Move Task', undefined, projectId1)
      taskId = task.id
    })

    afterAll(async () => {
      try {
        await service.deleteTask(taskId)
      } catch (e) { /* best-effort */ }

      try {
        await service.deleteProject(projectId1)
      } catch (e) { /* best-effort */ }

      try {
        await service.deleteProject(projectId2)
      } catch (e) { /* best-effort */ }
    })

    it('moves a task to a different project', async () => {
      const result = await service.moveTask(taskId, projectId2)

      expect(result).toHaveProperty('id', taskId)
    })
  })

  // ── Comments lifecycle ──

  describe('comments lifecycle', () => {
    let projectId
    let taskId
    let commentId

    beforeAll(async () => {
      const project = await service.createProject('E2E Comments Test')
      projectId = project.id

      const task = await service.createTask('E2E Comment Task', undefined, projectId)
      taskId = task.id
    })

    afterAll(async () => {
      try {
        await service.deleteProject(projectId)
      } catch (e) { /* best-effort */ }
    })

    it('creates a comment on a task', async () => {
      const result = await service.createComment('E2E comment text', taskId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('content', 'E2E comment text')
      commentId = result.id
    })

    it('gets the comment', async () => {
      const result = await service.getComment(commentId)

      expect(result).toHaveProperty('id', commentId)
      expect(result).toHaveProperty('content', 'E2E comment text')
    })

    it('lists comments on the task', async () => {
      const result = await service.listComments(taskId)

      expect(result).toHaveProperty('results')
      expect(result.results.length).toBeGreaterThan(0)
    })

    it('updates the comment', async () => {
      const result = await service.updateComment(commentId, 'E2E updated comment')

      expect(result).toHaveProperty('content', 'E2E updated comment')
    })

    it('deletes the comment', async () => {
      const result = await service.deleteComment(commentId)

      expect(result).toEqual({ success: true })
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns items with label and value', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0]).toHaveProperty('label')
      expect(result.items[0]).toHaveProperty('value')
    })

    it('filters by search', async () => {
      const result = await service.getProjectsDictionary({ search: 'Inbox' })

      expect(result.items.length).toBeGreaterThan(0)
      expect(result.items[0].label.toLowerCase()).toContain('inbox')
    })
  })

  describe('getLabelsDictionary', () => {
    it('returns items array', async () => {
      const result = await service.getLabelsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getSectionsDictionary', () => {
    it('returns empty items when no criteria provided', async () => {
      const result = await service.getSectionsDictionary({})

      expect(result).toEqual({ items: [], cursor: null })
    })
  })
})
