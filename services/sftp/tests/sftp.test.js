'use strict'

const { createSandbox } = require('../../../service-sandbox')

// ssh2-sftp-client is a runtime dependency of the service that is NOT installed in this repo,
// so it is mocked virtually. The service requires it lazily inside every action, which means the
// mock below is what each action drives.
const mockClients = []

jest.mock(
  'ssh2-sftp-client',
  () => function SftpClientMock() {
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      end: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      stat: jest.fn().mockResolvedValue({}),
      exists: jest.fn().mockResolvedValue(false),
      get: jest.fn().mockResolvedValue(Buffer.from('')),
      put: jest.fn().mockResolvedValue(undefined),
      mkdir: jest.fn().mockResolvedValue(undefined),
      rmdir: jest.fn().mockResolvedValue(undefined),
      rename: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      chmod: jest.fn().mockResolvedValue(undefined),
    }

    mockClients.push(client)

    return client
  },
  { virtual: true }
)

const CONFIG = {
  host: ' sftp.example.com ',
  port: '2222',
  username: 'flow',
  password: 'secret',
}

let sandbox
let service
let mock

function buildService(config) {
  if (sandbox) {
    sandbox.cleanup()
  }

  jest.resetModules()

  sandbox = createSandbox(config)
  require('../src/index.js')

  service = sandbox.getService()
  mock = sandbox.getRequestMock()

  return service
}

function lastClient() {
  return mockClients[mockClients.length - 1]
}

describe('SFTP Service', () => {
  beforeEach(() => {
    mockClients.length = 0
    buildService({ ...CONFIG })
  })

  afterAll(() => {
    sandbox.cleanup()
    sandbox = null
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the connection config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual([
        'host',
        'port',
        'username',
        'password',
        'privateKey',
        'passphrase',
      ])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'host', type: 'STRING', required: true, shared: false }),
          expect.objectContaining({ name: 'port', required: false, shared: false, defaultValue: '22' }),
          expect.objectContaining({ name: 'username', required: true, shared: false }),
          expect.objectContaining({ name: 'privateKey', type: 'TEXT', required: false, shared: false }),
        ])
      )

      expect(configItems.every(item => item.shared === false)).toBe(true)
    })

    it('trims the host and parses the port', () => {
      expect(service.host).toBe('sftp.example.com')
      expect(service.port).toBe(2222)
      expect(service.username).toBe('flow')
    })

    it('defaults the port to 22 when missing or invalid', () => {
      expect(buildService({ host: 'h', username: 'u', password: 'p' }).port).toBe(22)
      expect(buildService({ host: 'h', port: 'not-a-port', username: 'u', password: 'p' }).port).toBe(22)
    })

    it('tolerates a missing config object', () => {
      const svc = buildService(undefined)

      expect(svc.host).toBe('')
      expect(svc.port).toBe(22)
    })
  })

  // ── Connection handling ──

  describe('connection lifecycle', () => {
    it('connects with the password credentials and always disconnects', async () => {
      await service.listDirectory('.')

      const client = lastClient()

      expect(client.connect).toHaveBeenCalledWith({
        host: 'sftp.example.com',
        port: 2222,
        username: 'flow',
        readyTimeout: 20000,
        password: 'secret',
      })

      expect(client.end).toHaveBeenCalledTimes(1)
    })

    it('connects with a private key and passphrase', async () => {
      buildService({
        host: 'sftp.example.com',
        username: 'flow',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n-----END OPENSSH PRIVATE KEY-----',
        passphrase: 'pp',
      })

      await service.listDirectory('.')

      expect(lastClient().connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: expect.stringContaining('BEGIN OPENSSH PRIVATE KEY'),
          passphrase: 'pp',
        })
      )

      expect(lastClient().connect.mock.calls[0][0]).not.toHaveProperty('password')
    })

    it('sends both credential types when both are configured', async () => {
      buildService({ host: 'h', username: 'u', password: 'p', privateKey: 'KEY' })

      await service.listDirectory('.')

      expect(lastClient().connect).toHaveBeenCalledWith(
        expect.objectContaining({ password: 'p', privateKey: 'KEY' })
      )
    })

    it('ignores a passphrase when no private key is set', async () => {
      buildService({ host: 'h', username: 'u', password: 'p', passphrase: 'pp' })

      await service.listDirectory('.')

      expect(lastClient().connect.mock.calls[0][0]).not.toHaveProperty('passphrase')
    })

    it('requires a host', async () => {
      buildService({ username: 'u', password: 'p' })

      await expect(service.listDirectory('.')).rejects.toThrow('SFTP error: Host is required')
      expect(lastClient().connect).not.toHaveBeenCalled()
    })

    it('requires a username', async () => {
      buildService({ host: 'h', password: 'p' })

      await expect(service.listDirectory('.')).rejects.toThrow('SFTP error: Username is required.')
    })

    it('requires at least one credential', async () => {
      buildService({ host: 'h', username: 'u', privateKey: '   ' })

      await expect(service.listDirectory('.')).rejects.toThrow(/no credentials provided/)
    })

    it('still resolves when closing the connection fails', async () => {
      buildService({ ...CONFIG })

      const promise = service.listDirectory('.')

      // The client is created synchronously inside the action, so it exists by now.
      lastClient().end.mockRejectedValue(new Error('already closed'))

      await expect(promise).resolves.toEqual({ path: '.', count: 0, entries: [] })
    })

    it('closes the connection when the operation fails', async () => {
      const promise = service.listDirectory('.')

      lastClient().list.mockRejectedValue(new Error('boom'))

      await expect(promise).rejects.toThrow('SFTP error: boom')
      expect(lastClient().end).toHaveBeenCalledTimes(1)
    })
  })

  // ── Error translation ──

  describe('error translation', () => {
    async function failWith(error) {
      const promise = service.getFileInfo('/a')

      lastClient().stat.mockRejectedValue(error)

      return promise
    }

    it('adds the error code to the message', async () => {
      await expect(failWith(Object.assign(new Error('nope'), { code: 'EACCES' })))
        .rejects.toThrow('SFTP error: nope | code: EACCES')
    })

    it('hints about missing IPv6 connectivity', async () => {
      await expect(
        failWith(Object.assign(new Error('connect ENETUNREACH'), { code: 'ENETUNREACH', address: '2606:4700::1' }))
      ).rejects.toThrow(/IPv6-only address/)
    })

    it.each(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'])(
      'hints about reachability for %s',
      async code => {
        await expect(failWith(Object.assign(new Error('down'), { code })))
          .rejects.toThrow(/could not reach the SFTP server at sftp\.example\.com:2222/)
      }
    )

    it('hints about DNS resolution for ENOTFOUND', async () => {
      await expect(failWith(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })))
        .rejects.toThrow(/could not be resolved/)
    })

    it('hints about authentication failures', async () => {
      await expect(failWith(new Error('All configured authentication methods failed')))
        .rejects.toThrow(/authentication failed\. Check the Username and Password/)

      await expect(failWith(Object.assign(new Error('generic'), { code: 'ERR_GENERIC_CLIENT' })))
        .rejects.toThrow(/authentication failed/)
    })

    it('handles a non-Error rejection value', async () => {
      await expect(failWith('plain string failure')).rejects.toThrow('SFTP error: plain string failure')
    })
  })

  // ── Browse ──

  describe('listDirectory', () => {
    it('lists the default directory and normalizes entries', async () => {
      const promise = service.listDirectory()

      lastClient().list.mockResolvedValue([
        {
          type: 'd',
          name: 'exports',
          size: 4096,
          modifyTime: 1700000000000,
          accessTime: 1700000000000,
          rights: { user: 'rwx', group: 'r-x', other: 'r-x' },
          owner: 1000,
          group: 1000,
          longname: 'drwxr-xr-x 2 user group 4096 Jan 15 10:00 exports',
        },
      ])

      const result = await promise

      expect(lastClient().list).toHaveBeenCalledWith('.', undefined)

      expect(result).toEqual({
        path: '.',
        count: 1,
        entries: [
          {
            type: 'd',
            name: 'exports',
            size: 4096,
            modifyTime: new Date(1700000000000).toISOString(),
            accessTime: new Date(1700000000000).toISOString(),
            rights: { user: 'rwx', group: 'r-x', other: 'r-x' },
            owner: 1000,
            group: 1000,
            longname: 'drwxr-xr-x 2 user group 4096 Jan 15 10:00 exports',
          },
        ],
      })
    })

    it('passes a trimmed path and glob filter through', async () => {
      await service.listDirectory('  /home/user/exports  ', '  *.csv  ')

      expect(lastClient().list).toHaveBeenCalledWith('/home/user/exports', '*.csv')
    })

    it('ignores a blank filter', async () => {
      await service.listDirectory('/x', '   ')

      expect(lastClient().list).toHaveBeenCalledWith('/x', undefined)
    })

    it('nulls out missing or invalid timestamps', async () => {
      const promise = service.listDirectory('.')

      lastClient().list.mockResolvedValue([{ name: 'a', modifyTime: null, accessTime: 'not-a-date' }])

      const result = await promise

      expect(result.entries[0].modifyTime).toBeNull()
      expect(result.entries[0].accessTime).toBeNull()
    })
  })

  describe('getFileInfo', () => {
    it('returns normalized stat attributes', async () => {
      const promise = service.getFileInfo('/home/user/data.csv')

      lastClient().stat.mockResolvedValue({
        mode: 33188,
        uid: 1000,
        gid: 1000,
        size: 20480,
        accessTime: 1700000000000,
        modifyTime: 1700000000000,
        isDirectory: false,
        isFile: true,
        isSymbolicLink: false,
      })

      const result = await promise

      expect(lastClient().stat).toHaveBeenCalledWith('/home/user/data.csv')

      expect(result).toEqual({
        path: '/home/user/data.csv',
        mode: 33188,
        uid: 1000,
        gid: 1000,
        size: 20480,
        accessTime: new Date(1700000000000).toISOString(),
        modifyTime: new Date(1700000000000).toISOString(),
        isDirectory: false,
        isFile: true,
        isSymbolicLink: false,
      })
    })

    it('requires a non-empty remote path', async () => {
      await expect(service.getFileInfo('   ')).rejects.toThrow(
        'SFTP error: Remote Path is required and must be a non-empty string.'
      )

      await expect(service.getFileInfo(42)).rejects.toThrow(/Remote Path is required/)
      expect(mockClients).toHaveLength(0)
    })
  })

  describe('checkPathExists', () => {
    it('reports the type when the path exists', async () => {
      const promise = service.checkPathExists('/home/user')

      lastClient().exists.mockResolvedValue('d')

      await expect(promise).resolves.toEqual({ path: '/home/user', exists: true, type: 'd' })
    })

    it('reports a missing path without erroring', async () => {
      const promise = service.checkPathExists('/nope')

      lastClient().exists.mockResolvedValue(false)

      await expect(promise).resolves.toEqual({ path: '/nope', exists: false, type: null })
    })
  })

  // ── Download ──

  describe('downloadFile', () => {
    it('stores the downloaded buffer in FlowRunner file storage', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files/data.csv', filename: 'data.csv' })

      // The sandbox provides no Files API, so it is stubbed here.
      service.flowrunner = { Files: { uploadFile } }

      const promise = service.downloadFile('/home/user/exports/data.csv')

      lastClient().get.mockResolvedValue(Buffer.from('id,name\n1,Ada\n'))

      const result = await promise

      expect(lastClient().get).toHaveBeenCalledWith('/home/user/exports/data.csv')

      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('id,name\n1,Ada\n'), {
        filename: 'data.csv',
        generateUrl: true,
        overwrite: true,
        scope: 'FLOW',
      })

      expect(result).toEqual({
        remotePath: '/home/user/exports/data.csv',
        fileUrl: 'https://files/data.csv',
        filename: 'data.csv',
        size: 14,
      })
    })

    it('honours custom file options and falls back to the remote basename', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files/x' })

      service.flowrunner = { Files: { uploadFile } }

      const promise = service.downloadFile('/home/user/report.pdf', { scope: 'APP', filename: 'custom.pdf' })

      lastClient().get.mockResolvedValue(Buffer.from('pdf'))

      const result = await promise

      expect(uploadFile).toHaveBeenCalledWith(Buffer.from('pdf'), {
        filename: 'custom.pdf',
        generateUrl: true,
        overwrite: true,
        scope: 'APP',
      })

      expect(result.filename).toBe('report.pdf')
    })

    it('converts a non-buffer payload before uploading', async () => {
      const uploadFile = jest.fn().mockResolvedValue({ url: 'https://files/x' })

      service.flowrunner = { Files: { uploadFile } }

      const promise = service.downloadFile('/dir/')

      lastClient().get.mockResolvedValue('plain text')

      const result = await promise

      expect(uploadFile.mock.calls[0][0]).toEqual(Buffer.from('plain text'))
      expect(result.filename).toBe('dir')
      expect(result.size).toBe(10)
    })

    it('requires a remote path', async () => {
      await expect(service.downloadFile('')).rejects.toThrow(/Remote Path is required/)
    })
  })

  describe('readFileAsText', () => {
    it('reads the file as utf8 by default', async () => {
      const promise = service.readFileAsText('/home/user/data.csv')

      lastClient().get.mockResolvedValue(Buffer.from('id,name\n'))

      await expect(promise).resolves.toEqual({
        remotePath: '/home/user/data.csv',
        encoding: 'utf8',
        size: 8,
        content: 'id,name\n',
      })
    })

    it.each([
      ['UTF-8', 'utf8'],
      ['Base64', 'base64'],
      ['Latin-1', 'latin1'],
    ])('maps the %s label to the %s buffer encoding', async (label, encoding) => {
      const promise = service.readFileAsText('/f', label)

      lastClient().get.mockResolvedValue(Buffer.from('abc'))

      const result = await promise

      expect(result.encoding).toBe(encoding)
      expect(result.content).toBe(Buffer.from('abc').toString(encoding))
    })

    it('passes an unmapped encoding through unchanged', async () => {
      const promise = service.readFileAsText('/f', 'hex')

      lastClient().get.mockResolvedValue(Buffer.from('abc'))

      await expect(promise).resolves.toMatchObject({ encoding: 'hex', content: '616263' })
    })

    it('requires a remote path', async () => {
      await expect(service.readFileAsText(null)).rejects.toThrow(/Remote Path is required/)
    })
  })

  // ── Upload ──

  describe('uploadFile', () => {
    it('fetches the FlowRunner file as binary and puts it', async () => {
      mock.onGet('https://files/report.pdf').reply(Buffer.from('PDF-BYTES'))

      const result = await service.uploadFile('https://files/report.pdf', '/incoming/report.pdf')

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].encoding).toBeNull()

      expect(lastClient().put).toHaveBeenCalledWith(Buffer.from('PDF-BYTES'), '/incoming/report.pdf')
      expect(lastClient().mkdir).not.toHaveBeenCalled()

      expect(result).toEqual({ remotePath: '/incoming/report.pdf', size: 9, uploaded: true })
    })

    it('creates parent directories when requested', async () => {
      mock.onGet('https://files/a.txt').reply(Buffer.from('a'))

      await service.uploadFile('https://files/a.txt', '/incoming/2026/a.txt', true)

      expect(lastClient().mkdir).toHaveBeenCalledWith('/incoming/2026', true)
      expect(lastClient().put).toHaveBeenCalledWith(Buffer.from('a'), '/incoming/2026/a.txt')
    })

    it('accepts the string form of the create-directories flag', async () => {
      mock.onGet('https://files/a.txt').reply(Buffer.from('a'))

      await service.uploadFile('https://files/a.txt', '/incoming/a.txt', 'true')

      expect(lastClient().mkdir).toHaveBeenCalledWith('/incoming', true)
    })

    it('does not create a root or relative parent directory', async () => {
      mock.onGet('https://files/a.txt').reply(Buffer.from('a'))

      await service.uploadFile('https://files/a.txt', '/a.txt', true)

      expect(lastClient().mkdir).not.toHaveBeenCalled()

      await service.uploadFile('https://files/a.txt', 'a.txt', true)

      expect(lastClient().mkdir).not.toHaveBeenCalled()
    })

    it('validates its parameters', async () => {
      await expect(service.uploadFile('', '/a.txt')).rejects.toThrow(
        'SFTP error: File is required and must be a non-empty string.'
      )

      await expect(service.uploadFile('https://files/a.txt', '  ')).rejects.toThrow(/Remote Path is required/)
    })
  })

  describe('uploadFileFromUrl', () => {
    it('downloads the source url and puts the bytes', async () => {
      mock.onGet('https://example.com/logo.png').reply(Buffer.from('PNG'))

      const result = await service.uploadFileFromUrl('https://example.com/logo.png', '/incoming/logo.png')

      expect(mock.history[0].url).toBe('https://example.com/logo.png')
      expect(mock.history[0].encoding).toBeNull()
      expect(lastClient().put).toHaveBeenCalledWith(Buffer.from('PNG'), '/incoming/logo.png')
      expect(result).toEqual({ remotePath: '/incoming/logo.png', size: 3, uploaded: true })
    })

    it('validates its parameters', async () => {
      await expect(service.uploadFileFromUrl(null, '/a')).rejects.toThrow(
        'SFTP error: Source URL is required and must be a non-empty string.'
      )

      await expect(service.uploadFileFromUrl('https://example.com/a', null)).rejects.toThrow(/Remote Path is required/)
    })
  })

  describe('uploadTextContent', () => {
    it('writes utf8 content by default', async () => {
      const result = await service.uploadTextContent('id,name\n', null, '/exports/report.csv')

      expect(lastClient().put).toHaveBeenCalledWith(Buffer.from('id,name\n', 'utf8'), '/exports/report.csv')
      expect(result).toEqual({ remotePath: '/exports/report.csv', size: 8, uploaded: true })
    })

    it('decodes base64 content before writing', async () => {
      const encoded = Buffer.from('binary-bytes').toString('base64')

      const result = await service.uploadTextContent(encoded, 'Base64', '/exports/blob.bin')

      expect(lastClient().put).toHaveBeenCalledWith(Buffer.from('binary-bytes'), '/exports/blob.bin')
      expect(result.size).toBe(12)
    })

    it('creates parent directories when requested', async () => {
      await service.uploadTextContent('x', 'UTF-8', '/exports/2026/report.csv', true)

      expect(lastClient().mkdir).toHaveBeenCalledWith('/exports/2026', true)
    })

    it('validates its parameters', async () => {
      await expect(service.uploadTextContent(null, 'UTF-8', '/a')).rejects.toThrow(
        'SFTP error: Content is required and must be a string.'
      )

      await expect(service.uploadTextContent('x', 'UTF-8', '')).rejects.toThrow(/Remote Path is required/)
    })
  })

  // ── Files ──

  describe('renameFile', () => {
    it('renames the remote path', async () => {
      const result = await service.renameFile(' /a/temp.csv ', ' /b/final.csv ')

      expect(lastClient().rename).toHaveBeenCalledWith('/a/temp.csv', '/b/final.csv')
      expect(result).toEqual({ fromPath: '/a/temp.csv', toPath: '/b/final.csv', renamed: true })
    })

    it('validates its parameters', async () => {
      await expect(service.renameFile('', '/b')).rejects.toThrow(
        'SFTP error: From Path is required and must be a non-empty string.'
      )

      await expect(service.renameFile('/a', '')).rejects.toThrow(
        'SFTP error: To Path is required and must be a non-empty string.'
      )
    })
  })

  describe('deleteFile', () => {
    it('deletes the file and errors on a missing one by default', async () => {
      const result = await service.deleteFile('/a/temp.csv')

      expect(lastClient().delete).toHaveBeenCalledWith('/a/temp.csv', false)
      expect(result).toEqual({ remotePath: '/a/temp.csv', deleted: true })
    })

    it.each([true, 'true'])('tolerates a missing file when ignoreMissing is %p', async flag => {
      await service.deleteFile('/a/temp.csv', flag)

      expect(lastClient().delete).toHaveBeenCalledWith('/a/temp.csv', true)
    })

    it('requires a remote path', async () => {
      await expect(service.deleteFile('')).rejects.toThrow(/Remote Path is required/)
    })
  })

  describe('changePermissions', () => {
    it('parses the octal mode', async () => {
      const result = await service.changePermissions('/a/report.csv', '644')

      expect(lastClient().chmod).toHaveBeenCalledWith('/a/report.csv', 0o644)
      expect(result).toEqual({ remotePath: '/a/report.csv', mode: '644', changed: true })
    })

    it('accepts a four-digit mode', async () => {
      await service.changePermissions('/a', '0755')

      expect(lastClient().chmod).toHaveBeenCalledWith('/a', 0o755)
    })

    it('rejects a non-octal mode', async () => {
      await expect(service.changePermissions('/a', '999')).rejects.toThrow(
        'SFTP error: Mode must be an octal permission string such as "644" or "755" (got "999").'
      )

      await expect(service.changePermissions('/a', 'rwx')).rejects.toThrow(/Mode must be an octal/)
      expect(mockClients).toHaveLength(0)
    })

    it('validates its parameters', async () => {
      await expect(service.changePermissions('', '644')).rejects.toThrow(/Remote Path is required/)

      await expect(service.changePermissions('/a', '')).rejects.toThrow(
        'SFTP error: Mode is required and must be a non-empty string.'
      )
    })
  })

  // ── Directories ──

  describe('createDirectory', () => {
    it('creates recursively by default', async () => {
      const result = await service.createDirectory('/exports/2026')

      expect(lastClient().mkdir).toHaveBeenCalledWith('/exports/2026', true)
      expect(result).toEqual({ remotePath: '/exports/2026', created: true })
    })

    it.each([false, 'false'])('creates non-recursively when recursive is %p', async flag => {
      await service.createDirectory('/exports/2026', flag)

      expect(lastClient().mkdir).toHaveBeenCalledWith('/exports/2026', false)
    })

    it('requires a remote path', async () => {
      await expect(service.createDirectory(null)).rejects.toThrow(/Remote Path is required/)
    })
  })

  describe('removeDirectory', () => {
    it('removes non-recursively by default', async () => {
      const result = await service.removeDirectory('/exports/old')

      expect(lastClient().rmdir).toHaveBeenCalledWith('/exports/old', false)
      expect(result).toEqual({ remotePath: '/exports/old', removed: true })
    })

    it.each([true, 'true'])('removes recursively when recursive is %p', async flag => {
      await service.removeDirectory('/exports/old', flag)

      expect(lastClient().rmdir).toHaveBeenCalledWith('/exports/old', true)
    })

    it('requires a remote path', async () => {
      await expect(service.removeDirectory('   ')).rejects.toThrow(/Remote Path is required/)
    })
  })
})
