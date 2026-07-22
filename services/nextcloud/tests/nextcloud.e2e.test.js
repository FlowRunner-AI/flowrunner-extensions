'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Nextcloud Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('nextcloud')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // Mock flowrunner.Files for downloadFile since it requires FlowRunner storage
    service.flowrunner = {
      Files: {
        uploadFile: jest.fn().mockResolvedValue({ url: 'https://files.flowrunner.io/mock/file.pdf' }),
      },
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Users ──

  describe('getCurrentUser', () => {
    it('returns the authenticated user profile', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('displayname')
    })
  })

  describe('getUser', () => {
    it('returns a user by id', async () => {
      const currentUser = await service.getCurrentUser()
      const result = await service.getUser(currentUser.id)

      expect(result).toHaveProperty('id', currentUser.id)
      expect(result).toHaveProperty('displayname')
    })
  })

  describe('listUsers', () => {
    it('returns a list of user ids', async () => {
      const result = await service.listUsers()

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
    })

    it('supports search parameter', async () => {
      const currentUser = await service.getCurrentUser()
      const result = await service.listUsers(currentUser.id, 5, 0)

      expect(result).toHaveProperty('users')
      expect(Array.isArray(result.users)).toBe(true)
    })
  })

  // ── Files (WebDAV) ──

  describe('listFolder', () => {
    it('lists the root folder', async () => {
      const result = await service.listFolder()

      expect(result).toHaveProperty('path', '')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('entries')
      expect(Array.isArray(result.entries)).toBe(true)
    })
  })

  describe('createFolder + listFolder + deleteItem', () => {
    const testFolderPath = `e2e-test-folder-${Date.now()}`

    it('creates a folder', async () => {
      const result = await service.createFolder(testFolderPath)

      expect(result).toEqual({
        path: testFolderPath,
        created: true,
      })
    })

    it('lists the created folder in root', async () => {
      const result = await service.listFolder()
      const found = result.entries.find(e => e.name === testFolderPath)

      expect(found).toBeDefined()
      expect(found.isFolder).toBe(true)
    })

    it('deletes the created folder', async () => {
      const result = await service.deleteItem(testFolderPath)

      expect(result).toEqual({
        path: testFolderPath,
        deleted: true,
      })
    })
  })

  describe('uploadFile + downloadFile + moveItem + copyItem + deleteItem', () => {
    const testFileName = `e2e-test-file-${Date.now()}.txt`
    const movedFileName = `e2e-moved-${Date.now()}.txt`
    const copiedFileName = `e2e-copied-${Date.now()}.txt`

    it('uploads a file from a public URL', async () => {
      const { sourceUrl } = testValues

      if (!sourceUrl) {
        console.log('Skipping uploadFile: testValues.sourceUrl not set')
        return
      }

      const result = await service.uploadFile(sourceUrl, testFileName)

      expect(result).toHaveProperty('path', testFileName)
      expect(result).toHaveProperty('name', testFileName)
      expect(result).toHaveProperty('uploaded', true)
      expect(result).toHaveProperty('size')
      expect(result.size).toBeGreaterThan(0)
    })

    it('downloads the uploaded file', async () => {
      const { sourceUrl } = testValues

      if (!sourceUrl) {
        console.log('Skipping downloadFile: testValues.sourceUrl not set')
        return
      }

      const result = await service.downloadFile(testFileName)

      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('filename', testFileName)
      expect(result).toHaveProperty('path', testFileName)
      expect(result).toHaveProperty('size')
    })

    it('copies the file', async () => {
      const { sourceUrl } = testValues

      if (!sourceUrl) {
        console.log('Skipping copyItem: testValues.sourceUrl not set')
        return
      }

      const result = await service.copyItem(testFileName, copiedFileName)

      expect(result).toEqual({
        source: testFileName,
        destination: copiedFileName,
        copied: true,
      })
    })

    it('moves the file', async () => {
      const { sourceUrl } = testValues

      if (!sourceUrl) {
        console.log('Skipping moveItem: testValues.sourceUrl not set')
        return
      }

      const result = await service.moveItem(testFileName, movedFileName)

      expect(result).toEqual({
        source: testFileName,
        destination: movedFileName,
        moved: true,
      })
    })

    it('cleans up moved and copied files', async () => {
      const { sourceUrl } = testValues

      if (!sourceUrl) {
        console.log('Skipping cleanup: testValues.sourceUrl not set')
        return
      }

      await service.deleteItem(movedFileName)
      await service.deleteItem(copiedFileName)
    })
  })

  // ── Shares (OCS) ──

  describe('createShare + getShare + updateShare + listShares + deleteShare', () => {
    const testShareFolder = `e2e-share-test-${Date.now()}`
    let shareId

    it('creates a test folder to share', async () => {
      const result = await service.createFolder(testShareFolder)

      expect(result.created).toBe(true)
    })

    it('creates a public link share', async () => {
      const result = await service.createShare(testShareFolder, 'Public Link', undefined, 'Read')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('token')
      shareId = String(result.id)
    })

    it('gets the share by id', async () => {
      if (!shareId) {
        console.log('Skipping getShare: no shareId from createShare')
        return
      }

      const result = await service.getShare(shareId)

      expect(result).toHaveProperty('id')
      expect(String(result.id)).toBe(shareId)
    })

    it('updates the share permissions', async () => {
      if (!shareId) {
        console.log('Skipping updateShare: no shareId from createShare')
        return
      }

      const result = await service.updateShare(shareId, 'Read', undefined, undefined, 'E2E test note')

      expect(result).toHaveProperty('id')
    })

    it('lists shares including the created one', async () => {
      const result = await service.listShares(testShareFolder)

      expect(Array.isArray(result)).toBe(true)
    })

    it('deletes the share', async () => {
      if (!shareId) {
        console.log('Skipping deleteShare: no shareId from createShare')
        return
      }

      const result = await service.deleteShare(shareId)

      expect(result).toEqual({ id: shareId, deleted: true })
    })

    it('cleans up the test folder', async () => {
      await service.deleteItem(testShareFolder)
    })
  })
})
