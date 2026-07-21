'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Figma Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('figma')
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

  // ── User ──

  describe('getMe', () => {
    it('returns the authenticated user profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('handle')
      expect(result).toHaveProperty('email')
    })
  })

  // ── Files ──

  describe('getFile', () => {
    it('returns file document tree', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getFile: no fileKey in testValues')
        return
      }

      const result = await service.getFile(null, null, fileKey, undefined, 1)

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('document')
      expect(result).toHaveProperty('version')
    })
  })

  describe('getFileMetadata', () => {
    it('returns file metadata', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getFileMetadata: no fileKey in testValues')
        return
      }

      const result = await service.getFileMetadata(fileKey)

      expect(result).toHaveProperty('file')
      expect(result.file).toHaveProperty('name')
    })
  })

  describe('getFileVersions', () => {
    it('returns version history', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getFileVersions: no fileKey in testValues')
        return
      }

      const result = await service.getFileVersions(fileKey)

      expect(result).toHaveProperty('versions')
      expect(Array.isArray(result.versions)).toBe(true)
    })
  })

  // ── Images ──

  describe('exportImage', () => {
    it('returns image URLs for rendered nodes', async () => {
      const { fileKey, nodeId } = sandbox.getTestValues()

      if (!fileKey || !nodeId) {
        console.log('Skipping exportImage: no fileKey or nodeId in testValues')
        return
      }

      const result = await service.exportImage(fileKey, [nodeId], 'PNG', 1)

      expect(result).toHaveProperty('images')
      expect(result.err).toBeNull()
    })
  })

  describe('getImageFills', () => {
    it('returns image fill URLs', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getImageFills: no fileKey in testValues')
        return
      }

      const result = await service.getImageFills(fileKey)

      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('images')
    })
  })

  // ── Comments ──

  describe('comment lifecycle', () => {
    let createdCommentId

    it('gets comments on a file', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getComments: no fileKey in testValues')
        return
      }

      const result = await service.getComments(fileKey)

      expect(result).toHaveProperty('comments')
      expect(Array.isArray(result.comments)).toBe(true)
    })

    it('posts a comment on a file', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping postComment: no fileKey in testValues')
        return
      }

      const result = await service.postComment(fileKey, 'E2E test comment - safe to delete')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('message')
      createdCommentId = result.id
    })

    it('deletes the created comment', async () => {
      if (!createdCommentId) {
        console.log('Skipping deleteComment: no comment was created')
        return
      }

      await expect(service.deleteComment(createdCommentId)).resolves.toBeDefined()
    })
  })

  // ── Projects & Teams ──

  describe('getTeamProjects', () => {
    it('returns projects for a team', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping getTeamProjects: no teamId in testValues')
        return
      }

      const result = await service.getTeamProjects(teamId)

      expect(result).toHaveProperty('projects')
      expect(Array.isArray(result.projects)).toBe(true)
    })
  })

  describe('getProjectFiles', () => {
    it('returns files for a project', async () => {
      const { projectId } = sandbox.getTestValues()

      if (!projectId) {
        console.log('Skipping getProjectFiles: no projectId in testValues')
        return
      }

      const result = await service.getProjectFiles(null, projectId)

      expect(result).toHaveProperty('files')
      expect(Array.isArray(result.files)).toBe(true)
    })
  })

  // ── Components & Styles ──

  describe('getFileComponents', () => {
    it('returns components for a file', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getFileComponents: no fileKey in testValues')
        return
      }

      const result = await service.getFileComponents(fileKey)

      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('components')
    })
  })

  describe('getFileStyles', () => {
    it('returns styles for a file', async () => {
      const { fileKey } = sandbox.getTestValues()

      if (!fileKey) {
        console.log('Skipping getFileStyles: no fileKey in testValues')
        return
      }

      const result = await service.getFileStyles(fileKey)

      expect(result).toHaveProperty('meta')
      expect(result.meta).toHaveProperty('styles')
    })
  })

  // ── Dictionaries ──

  describe('getTeamProjectsDictionary', () => {
    it('returns dictionary items for a team', async () => {
      const { teamId } = sandbox.getTestValues()

      if (!teamId) {
        console.log('Skipping getTeamProjectsDictionary: no teamId in testValues')
        return
      }

      const result = await service.getTeamProjectsDictionary({
        criteria: { teamId },
      })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })
})
