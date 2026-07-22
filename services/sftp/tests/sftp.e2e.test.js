'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

// SFTP e2e requires BOTH a reachable SFTP server (configured in e2e-config.json) and the
// `ssh2-sftp-client` npm dependency, which is declared in services/sftp/package.json but is not
// installed in this repo. When either is missing every test logs why and passes without running,
// instead of failing the whole suite.
describe('SFTP Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let skipReason = null
  let remoteDir

  beforeAll(() => {
    sandbox = createE2ESandbox('sftp')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      skipReason = `SFTP e2e config incomplete — ${ error.message }`
    }

    try {
      require('ssh2-sftp-client')
    } catch (error) {
      skipReason = 'ssh2-sftp-client is not installed — run `npm install ssh2-sftp-client` to enable SFTP e2e tests'
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
    remoteDir = (testValues.remoteDir || '/upload').replace(/\/+$/, '')
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  function skipped(name) {
    if (skipReason) {
      console.log(`Skipping ${ name }: ${ skipReason }`)

      return true
    }

    return false
  }

  // ── Browse ──

  describe('listDirectory', () => {
    it('lists the working directory', async () => {
      if (skipped('listDirectory')) return

      const result = await service.listDirectory(remoteDir)

      expect(result).toHaveProperty('path', remoteDir)
      expect(Array.isArray(result.entries)).toBe(true)
      expect(result.count).toBe(result.entries.length)
    })
  })

  describe('checkPathExists', () => {
    it('reports a missing path without erroring', async () => {
      if (skipped('checkPathExists')) return

      const result = await service.checkPathExists(`${ remoteDir }/definitely-missing-${ Date.now() }`)

      expect(result).toMatchObject({ exists: false, type: null })
    })
  })

  // ── Full round trip ──

  describe('upload, read, rename, permissions and delete', () => {
    const stamp = Date.now()

    let uploadedPath
    let renamedPath

    it('writes a text file', async () => {
      if (skipped('uploadTextContent')) return

      uploadedPath = `${ remoteDir }/flowrunner-e2e-${ stamp }.csv`

      const result = await service.uploadTextContent('id,name\n1,Ada\n', 'UTF-8', uploadedPath, true)

      expect(result).toEqual({ remotePath: uploadedPath, size: 14, uploaded: true })
    })

    it('reads the file back as text', async () => {
      if (skipped('readFileAsText')) return

      const result = await service.readFileAsText(uploadedPath)

      expect(result.content).toBe('id,name\n1,Ada\n')
      expect(result.encoding).toBe('utf8')
    })

    it('stats the file', async () => {
      if (skipped('getFileInfo')) return

      const result = await service.getFileInfo(uploadedPath)

      expect(result.isFile).toBe(true)
      expect(result.size).toBe(14)
    })

    it('changes the file permissions', async () => {
      if (skipped('changePermissions')) return

      const result = await service.changePermissions(uploadedPath, '644')

      expect(result).toMatchObject({ mode: '644', changed: true })
    })

    it('renames the file', async () => {
      if (skipped('renameFile')) return

      renamedPath = `${ remoteDir }/flowrunner-e2e-${ stamp }-renamed.csv`

      const result = await service.renameFile(uploadedPath, renamedPath)

      expect(result).toMatchObject({ renamed: true })
    })

    it('uploads a file from a public url', async () => {
      if (skipped('uploadFileFromUrl')) return

      if (!testValues.sourceUrl) {
        console.log('Skipping uploadFileFromUrl: testValues.sourceUrl not set')

        return
      }

      const result = await service.uploadFileFromUrl(
        testValues.sourceUrl,
        `${ remoteDir }/flowrunner-e2e-${ stamp }-remote.bin`
      )

      expect(result.uploaded).toBe(true)
      expect(result.size).toBeGreaterThan(0)

      await service.deleteFile(`${ remoteDir }/flowrunner-e2e-${ stamp }-remote.bin`, true)
    })

    it('deletes the renamed file', async () => {
      if (skipped('deleteFile')) return

      const result = await service.deleteFile(renamedPath, true)

      expect(result).toMatchObject({ deleted: true })
    })
  })

  // ── Directories ──

  describe('createDirectory + removeDirectory', () => {
    it('creates and removes a directory', async () => {
      if (skipped('createDirectory')) return

      const dir = `${ remoteDir }/flowrunner-e2e-dir-${ Date.now() }`

      await expect(service.createDirectory(dir)).resolves.toMatchObject({ created: true })
      await expect(service.checkPathExists(dir)).resolves.toMatchObject({ exists: true, type: 'd' })
      await expect(service.removeDirectory(dir)).resolves.toMatchObject({ removed: true })
    })
  })
})
