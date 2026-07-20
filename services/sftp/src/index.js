const path = require('path')

const logger = {
  info: (...args) => console.log('[SFTP] info:', ...args),
  debug: (...args) => console.log('[SFTP] debug:', ...args),
  error: (...args) => console.log('[SFTP] error:', ...args),
  warn: (...args) => console.log('[SFTP] warn:', ...args),
}

const DEFAULT_PORT = 22
const READY_TIMEOUT_MS = 20000

// Maps the friendly text-encoding labels shown in dropdowns to Node Buffer encodings.
const ENCODING_MAP = { 'UTF-8': 'utf8', 'Base64': 'base64', 'Latin-1': 'latin1' }
const WRITE_ENCODING_MAP = { 'UTF-8': 'utf8', 'Base64': 'base64' }

/**
 * @usesFileStorage
 * @integrationName SFTP
 * @integrationIcon /icon.svg
 */
class SFTP {
  constructor(config) {
    this.config = config || {}

    this.host = (this.config.host || '').trim()
    this.port = parseInt(this.config.port, 10) || DEFAULT_PORT
    this.username = this.config.username
    this.password = this.config.password
    this.privateKey = this.config.privateKey
    this.passphrase = this.config.passphrase
  }

  // ==========================================================================
  //  CORE — connection lifecycle: one short-lived ssh2-sftp-client per method
  //  call. A client is created, connected over SSH, used, and ALWAYS
  //  disconnected in finally. Connections are NEVER pooled or cached between
  //  invocations — the SFTP session is opened and torn down per action.
  // ==========================================================================
  async #withClient(logTag, fn) {
    // Required lazily so the module still loads if the dependency is momentarily unavailable,
    // and to keep a single fresh client instance per invocation.
    const SftpClient = require('ssh2-sftp-client')
    const client = new SftpClient()
    const connectConfig = this.#buildConnectConfig()

    try {
      logger.debug(`${ logTag } - connecting to ${ this.host }:${ this.port } as ${ this.username }`)

      await client.connect(connectConfig)

      return await fn(client)
    } catch (error) {
      this.#throwSftpError(error, logTag)
    } finally {
      try {
        await client.end()
      } catch (endError) {
        logger.warn(`${ logTag } - failed to close connection: ${ endError.message }`)
      }
    }
  }

  // Builds the ssh2-sftp-client connect config. Supports BOTH password and private-key auth:
  // whichever credential fields are populated are included, so a server can authenticate the
  // service by password, by key, or by both.
  #buildConnectConfig() {
    if (!this.host) {
      throw new Error('SFTP error: Host is required (the SFTP server hostname or IP address).')
    }

    if (!this.username) {
      throw new Error('SFTP error: Username is required.')
    }

    const hasPassword = typeof this.password === 'string' && this.password.length > 0
    const hasPrivateKey = typeof this.privateKey === 'string' && this.privateKey.trim().length > 0

    if (!hasPassword && !hasPrivateKey) {
      throw new Error(
        'SFTP error: no credentials provided. Set a Password, or paste an OpenSSH Private Key ' +
        '(with its Passphrase if the key is encrypted).'
      )
    }

    const connectConfig = {
      host: this.host,
      port: this.port,
      username: this.username,
      readyTimeout: READY_TIMEOUT_MS,
    }

    if (hasPassword) connectConfig.password = this.password
    if (hasPrivateKey) connectConfig.privateKey = this.privateKey
    if (hasPrivateKey && this.passphrase) connectConfig.passphrase = this.passphrase

    return connectConfig
  }

  #throwSftpError(error, logTag) {
    const parts = [error.message || String(error)]

    if (error.code !== undefined && error.code !== null) parts.push(`code: ${ error.code }`)

    const code = String(error.code || '')
    const message = String(error.message || '')

    // ENETUNREACH against an IPv6 address means the host resolved to IPv6 only and the FlowRunner
    // runtime has no IPv6 route — same failure mode the database services call out.
    if (code === 'ENETUNREACH' && String(error.address || '').includes(':')) {
      parts.push(
        'hint: the SFTP host resolved to an IPv6-only address and this environment has no IPv6 ' +
        'connectivity. Use a host that also publishes an IPv4 (A) record, or connect by IPv4 address.'
      )
    } else if (['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
      parts.push(
        `hint: could not reach the SFTP server at ${ this.host }:${ this.port }. Check that the Host and ` +
        'Port are correct (SFTP is usually 22, NOT the plain-FTP port 21), that the server is running, ' +
        'and that any firewall or managed-host allowlist permits the connection from FlowRunner.'
      )
    } else if (code === 'ENOTFOUND') {
      parts.push(
        `hint: the host "${ this.host }" could not be resolved. Check the Host value for typos and that ` +
        'the hostname is publicly resolvable.'
      )
    } else if (
      code === 'ERR_GENERIC_CLIENT' ||
      /authentication|all configured authentication methods failed|permission denied/i.test(message)
    ) {
      parts.push(
        'hint: authentication failed. Check the Username and Password, or the Private Key and its ' +
        'Passphrase. Confirm the server accepts this credential type for the user.'
      )
    }

    const fullMessage = parts.join(' | ')

    logger.error(`${ logTag } - failed: ${ fullMessage }`)

    throw new Error(`SFTP error: ${ fullMessage }`)
  }

  #resolveChoice(value, mapping, fallback) {
    if (value === undefined || value === null || value === '') return fallback

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`SFTP error: ${ label } is required and must be a non-empty string.`)
    }

    return value.trim()
  }

  // POSIX basename of a remote path, used to default download/upload file names.
  #basename(remotePath) {
    return path.posix.basename(String(remotePath || '').replace(/\/+$/, '')) || 'file'
  }

  // POSIX dirname of a remote path, used when auto-creating parent directories.
  #dirname(remotePath) {
    return path.posix.dirname(String(remotePath || ''))
  }

  // Normalizes an ssh2-sftp-client list/stat entry, converting epoch-ms timestamps to ISO strings.
  #toISO(epochMs) {
    if (epochMs === undefined || epochMs === null) return null

    const date = new Date(epochMs)

    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  #toBuffer(bytes) {
    return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '')
  }

  // ==========================================================================
  //  BROWSE
  // ==========================================================================
  /**
   * @operationName List Directory
   * @description Lists the contents of a directory on the SFTP server. Returns one entry per item with its type ("-" file, "d" directory, "l" symbolic link), name, size in bytes, ISO-8601 modify and access times, POSIX permission string (rights.user/group/other, e.g. "rwxr-xr-x"), numeric owner (uid) and group (gid), and the raw longname line. Optionally filter results with a glob pattern such as "*.csv" or "report-*.json". This does not recurse into subdirectories — list each subdirectory separately.
   * @category Browse
   * @route GET /list-directory
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","defaultValue":".","description":"The directory to list, e.g. /home/user/exports. Defaults to \".\" (the login/home directory)."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","description":"Optional glob pattern to match file names against, e.g. *.csv or report-*.json. Leave empty to list everything."}
   * @returns {Object}
   * @sampleResult {"path":".","count":2,"entries":[{"type":"d","name":"exports","size":4096,"modifyTime":"2026-01-15T10:00:00.000Z","accessTime":"2026-01-15T10:00:00.000Z","rights":{"user":"rwx","group":"r-x","other":"r-x"},"owner":1000,"group":1000,"longname":"drwxr-xr-x 2 user group 4096 Jan 15 10:00 exports"},{"type":"-","name":"data.csv","size":20480,"modifyTime":"2026-01-14T08:30:00.000Z","accessTime":"2026-01-14T08:30:00.000Z","rights":{"user":"rw-","group":"r--","other":"r--"},"owner":1000,"group":1000,"longname":"-rw-r--r-- 1 user group 20480 Jan 14 08:30 data.csv"}]}
   */
  async listDirectory(remotePath, filter) {
    const dir = (remotePath && String(remotePath).trim()) || '.'
    const pattern = filter && String(filter).trim() ? String(filter).trim() : undefined

    return this.#withClient('listDirectory', async client => {
      const entries = await client.list(dir, pattern)

      return {
        path: dir,
        count: entries.length,
        entries: entries.map(entry => ({
          type: entry.type,
          name: entry.name,
          size: entry.size,
          modifyTime: this.#toISO(entry.modifyTime),
          accessTime: this.#toISO(entry.accessTime),
          rights: entry.rights,
          owner: entry.owner,
          group: entry.group,
          longname: entry.longname,
        })),
      }
    })
  }

  /**
   * @operationName Get File Info
   * @description Retrieves the attributes of a single file or directory (a POSIX stat). Returns the numeric mode, owner (uid) and group (gid), size in bytes, ISO-8601 access and modify times, and boolean flags isDirectory, isFile and isSymbolicLink. Fails with a "No such file" error when the path does not exist — use Check Path Exists first if the path may be missing.
   * @category Browse
   * @route GET /get-file-info
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The file or directory to inspect, e.g. /home/user/exports/data.csv."}
   * @returns {Object}
   * @sampleResult {"path":"/home/user/exports/data.csv","mode":33188,"uid":1000,"gid":1000,"size":20480,"accessTime":"2026-01-14T08:30:00.000Z","modifyTime":"2026-01-14T08:30:00.000Z","isDirectory":false,"isFile":true,"isSymbolicLink":false}
   */
  async getFileInfo(remotePath) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')

    return this.#withClient('getFileInfo', async client => {
      const stats = await client.stat(target)

      return {
        path: target,
        mode: stats.mode,
        uid: stats.uid,
        gid: stats.gid,
        size: stats.size,
        accessTime: this.#toISO(stats.accessTime),
        modifyTime: this.#toISO(stats.modifyTime),
        isDirectory: stats.isDirectory,
        isFile: stats.isFile,
        isSymbolicLink: stats.isSymbolicLink,
      }
    })
  }

  /**
   * @operationName Check Path Exists
   * @description Checks whether a path exists on the SFTP server and, if so, what kind of object it is. Returns exists=true with type "-" (file), "d" (directory) or "l" (symbolic link), or exists=false with a null type when nothing exists at the path. Unlike Get File Info this never errors on a missing path, making it the safe way to branch on presence before reading or writing.
   * @category Browse
   * @route GET /check-path-exists
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The path to test, e.g. /home/user/exports/data.csv."}
   * @returns {Object}
   * @sampleResult {"path":"/home/user/exports/data.csv","exists":true,"type":"-"}
   */
  async checkPathExists(remotePath) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')

    return this.#withClient('checkPathExists', async client => {
      // client.exists returns false when nothing is there, otherwise the type char ("-"/"d"/"l").
      const result = await client.exists(target)

      return { path: target, exists: result !== false, type: result === false ? null : result }
    })
  }

  // ==========================================================================
  //  DOWNLOAD
  // ==========================================================================
  /**
   * @operationName Download File
   * @description Downloads a file from the SFTP server and stores it in FlowRunner file storage, returning a fileUrl that downstream steps can use (attach, forward, parse, etc.). Suited to files that fit in memory. The stored file's scope is controlled via File Settings (FLOW by default). Use Read File as Text instead when you only need small text/CSV/JSON contents inline without creating a stored file.
   * @category Download
   * @route POST /download-file
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The remote file to download, e.g. /home/user/exports/data.csv."}
   * @paramDef {"type":"FilesUploadOptions","name":"fileOptions","label":"File Settings","required":false,"include":["scope","filename"]}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/exports/data.csv","fileUrl":"https://files.flowrunner.io/.../data.csv","filename":"data.csv","size":20480}
   */
  async downloadFile(remotePath, fileOptions) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const defaultName = this.#basename(target)

    return this.#withClient('downloadFile', async client => {
      // With no destination argument, client.get resolves to a Buffer of the file contents.
      const buffer = this.#toBuffer(await client.get(target))

      const uploaded = await this.flowrunner.Files.uploadFile(buffer, {
        filename: defaultName,
        generateUrl: true,
        overwrite: true,
        ...(fileOptions || { scope: 'FLOW' }),
      })

      return {
        remotePath: target,
        fileUrl: uploaded.url,
        filename: uploaded.filename || defaultName,
        size: buffer.length,
      }
    })
  }

  /**
   * @operationName Read File as Text
   * @description Reads a file from the SFTP server and returns its contents as a text string in the flow, without creating a stored file. Choose the encoding used to decode the bytes: UTF-8 (default, for plain text/CSV/JSON), Base64 (to safely carry binary contents as a string), or Latin-1. Intended for small files — the entire file is loaded into memory, so use Download File for large or binary files.
   * @category Download
   * @route GET /read-file-as-text
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The remote file to read, e.g. /home/user/exports/data.csv."}
   * @paramDef {"type":"String","label":"Encoding","name":"encoding","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF-8","Base64","Latin-1"]}},"defaultValue":"UTF-8","description":"How to decode the file bytes into a string: UTF-8 for text/CSV/JSON, Base64 for binary-safe transport, or Latin-1."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/exports/data.csv","encoding":"utf8","size":42,"content":"id,name\n1,Ada\n2,Linus\n"}
   */
  async readFileAsText(remotePath, encoding) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const bufferEncoding = this.#resolveChoice(encoding, ENCODING_MAP, 'utf8')

    return this.#withClient('readFileAsText', async client => {
      const buffer = this.#toBuffer(await client.get(target))

      return {
        remotePath: target,
        encoding: bufferEncoding,
        size: buffer.length,
        content: buffer.toString(bufferEncoding),
      }
    })
  }

  // ==========================================================================
  //  UPLOAD
  // ==========================================================================
  /**
   * @operationName Upload File
   * @description Uploads a FlowRunner file to the SFTP server. Pick the file with the file selector; its bytes are written to the Remote Path (which must include the destination file name, e.g. /home/user/incoming/report.pdf). Overwrites an existing file at that path. Enable Create Directories to create any missing parent directories first.
   * @category Upload
   * @route POST /upload-file
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload. Its bytes are written to the SFTP server."}
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"Full destination path INCLUDING the file name, e.g. /home/user/incoming/report.pdf."}
   * @paramDef {"type":"Boolean","label":"Create Directories","name":"createDirs","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When on, create any missing parent directories of the Remote Path before uploading."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/incoming/report.pdf","size":20480,"uploaded":true}
   */
  async uploadFile(fileUrl, remotePath, createDirs) {
    const source = this.#requireNonEmptyString(fileUrl, 'File')
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const buffer = this.#toBuffer(await Flowrunner.Request.get(source).setEncoding(null))

    return this.#uploadBuffer('uploadFile', buffer, target, createDirs)
  }

  /**
   * @operationName Upload File from URL
   * @description Downloads a file from a public URL and uploads it to the SFTP server in one step, without staging it in FlowRunner file storage. The Remote Path must include the destination file name (e.g. /home/user/incoming/logo.png). Overwrites an existing file at that path. Enable Create Directories to create any missing parent directories first.
   * @category Upload
   * @route POST /upload-file-from-url
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Source URL","name":"sourceUrl","required":true,"description":"Public URL of the file to fetch and upload, e.g. https://example.com/logo.png."}
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"Full destination path INCLUDING the file name, e.g. /home/user/incoming/logo.png."}
   * @paramDef {"type":"Boolean","label":"Create Directories","name":"createDirs","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When on, create any missing parent directories of the Remote Path before uploading."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/incoming/logo.png","size":8192,"uploaded":true}
   */
  async uploadFileFromUrl(sourceUrl, remotePath, createDirs) {
    const source = this.#requireNonEmptyString(sourceUrl, 'Source URL')
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const buffer = this.#toBuffer(await Flowrunner.Request.get(source).setEncoding(null))

    return this.#uploadBuffer('uploadFileFromUrl', buffer, target, createDirs)
  }

  /**
   * @operationName Upload Text Content
   * @description Writes text (or Base64-decoded binary) directly to a file on the SFTP server, with no file staging — handy for saving a generated CSV, JSON, or log line. Provide the content and the encoding used to interpret it: UTF-8 for plain text, or Base64 to write decoded binary bytes. The Remote Path must include the destination file name. Overwrites an existing file at that path. Enable Create Directories to create any missing parent directories first.
   * @category Upload
   * @route POST /upload-text-content
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The content to write, e.g. a CSV or JSON string."}
   * @paramDef {"type":"String","label":"Encoding","name":"encoding","uiComponent":{"type":"DROPDOWN","options":{"values":["UTF-8","Base64"]}},"defaultValue":"UTF-8","description":"How to interpret Content when writing bytes: UTF-8 for plain text, or Base64 to decode and write binary data."}
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"Full destination path INCLUDING the file name, e.g. /home/user/exports/report.csv."}
   * @paramDef {"type":"Boolean","label":"Create Directories","name":"createDirs","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When on, create any missing parent directories of the Remote Path before writing."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/exports/report.csv","size":24,"uploaded":true}
   */
  async uploadTextContent(content, encoding, remotePath, createDirs) {
    if (typeof content !== 'string') {
      throw new Error('SFTP error: Content is required and must be a string.')
    }

    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const bufferEncoding = this.#resolveChoice(encoding, WRITE_ENCODING_MAP, 'utf8')
    const buffer = Buffer.from(content, bufferEncoding)

    return this.#uploadBuffer('uploadTextContent', buffer, target, createDirs)
  }

  // Shared upload path: optionally create parent directories, then put the buffer.
  async #uploadBuffer(logTag, buffer, target, createDirs) {
    return this.#withClient(logTag, async client => {
      if (createDirs === true || createDirs === 'true') {
        const dir = this.#dirname(target)

        if (dir && dir !== '.' && dir !== '/') {
          await client.mkdir(dir, true)
        }
      }

      await client.put(buffer, target)

      return { remotePath: target, size: buffer.length, uploaded: true }
    })
  }

  // ==========================================================================
  //  FILES
  // ==========================================================================
  /**
   * @operationName Rename / Move File
   * @description Renames or moves a file or directory on the SFTP server by changing its path. Keeping the same parent directory renames the item in place; changing the parent moves it. The destination's parent directory must already exist. Behavior when the destination already exists depends on the server (many refuse to overwrite).
   * @category Files
   * @route POST /rename-file
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"From Path","name":"fromPath","required":true,"description":"The current path of the file or directory, e.g. /home/user/incoming/temp.csv."}
   * @paramDef {"type":"String","label":"To Path","name":"toPath","required":true,"description":"The new path, e.g. /home/user/processed/final.csv."}
   * @returns {Object}
   * @sampleResult {"fromPath":"/home/user/incoming/temp.csv","toPath":"/home/user/processed/final.csv","renamed":true}
   */
  async renameFile(fromPath, toPath) {
    const from = this.#requireNonEmptyString(fromPath, 'From Path')
    const to = this.#requireNonEmptyString(toPath, 'To Path')

    return this.#withClient('renameFile', async client => {
      await client.rename(from, to)

      return { fromPath: from, toPath: to, renamed: true }
    })
  }

  /**
   * @operationName Delete File
   * @description Deletes a single file from the SFTP server. This does not remove directories — use Remove Directory for those. By default a missing file raises an error; enable Ignore Missing to treat a non-existent file as success (idempotent delete).
   * @category Files
   * @route POST /delete-file
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The file to delete, e.g. /home/user/incoming/temp.csv."}
   * @paramDef {"type":"Boolean","label":"Ignore Missing","name":"ignoreMissing","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When on, deleting a file that does not exist succeeds instead of raising an error."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/incoming/temp.csv","deleted":true}
   */
  async deleteFile(remotePath, ignoreMissing) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const noErrorOnNotExist = ignoreMissing === true || ignoreMissing === 'true'

    return this.#withClient('deleteFile', async client => {
      await client.delete(target, noErrorOnNotExist)

      return { remotePath: target, deleted: true }
    })
  }

  /**
   * @operationName Change Permissions
   * @description Changes the POSIX permission mode of a file or directory (chmod). Provide the mode as an octal string exactly as you would to the chmod command, e.g. "644" (owner read/write, others read) or "600" (owner read/write only). The value is parsed as octal.
   * @category Files
   * @route POST /change-permissions
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The file or directory to change, e.g. /home/user/incoming/report.csv."}
   * @paramDef {"type":"String","label":"Mode","name":"mode","required":true,"defaultValue":"644","description":"Octal permission mode as a string, e.g. 644, 600, or 755."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/incoming/report.csv","mode":"644","changed":true}
   */
  async changePermissions(remotePath, mode) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const modeString = this.#requireNonEmptyString(mode, 'Mode')

    if (!/^[0-7]{3,4}$/.test(modeString)) {
      throw new Error(`SFTP error: Mode must be an octal permission string such as "644" or "755" (got "${ modeString }").`)
    }

    const numericMode = parseInt(modeString, 8)

    return this.#withClient('changePermissions', async client => {
      await client.chmod(target, numericMode)

      return { remotePath: target, mode: modeString, changed: true }
    })
  }

  // ==========================================================================
  //  DIRECTORIES
  // ==========================================================================
  /**
   * @operationName Create Directory
   * @description Creates a directory on the SFTP server. By default (Recursive on) any missing parent directories are created too, so a full path like /home/user/2026/01 is made in one call. Turn Recursive off to require that the parent already exists and create only the final directory.
   * @category Directories
   * @route POST /create-directory
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The directory path to create, e.g. /home/user/exports/2026."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"CHECKBOX"},"defaultValue":true,"description":"When on (default), create any missing parent directories too. When off, the parent must already exist."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/exports/2026","created":true}
   */
  async createDirectory(remotePath, recursive) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    // Defaults to true: only an explicit false/"false" disables recursive creation.
    const isRecursive = !(recursive === false || recursive === 'false')

    return this.#withClient('createDirectory', async client => {
      await client.mkdir(target, isRecursive)

      return { remotePath: target, created: true }
    })
  }

  /**
   * @operationName Remove Directory
   * @description Removes a directory from the SFTP server. With Recursive off (the default) the directory must be empty or the server returns an error. With Recursive ON, the directory AND ALL OF ITS CONTENTS are deleted — this is destructive and irreversible, so use it deliberately.
   * @category Directories
   * @route POST /remove-directory
   * @appearanceColor #1E3A5F #2E6CB8
   * @paramDef {"type":"String","label":"Remote Path","name":"remotePath","required":true,"description":"The directory to remove, e.g. /home/user/exports/old."}
   * @paramDef {"type":"Boolean","label":"Recursive","name":"recursive","uiComponent":{"type":"CHECKBOX"},"defaultValue":false,"description":"When OFF (default) the directory must be empty. When ON, the directory and ALL its contents are permanently deleted — destructive."}
   * @returns {Object}
   * @sampleResult {"remotePath":"/home/user/exports/old","removed":true}
   */
  async removeDirectory(remotePath, recursive) {
    const target = this.#requireNonEmptyString(remotePath, 'Remote Path')
    const isRecursive = recursive === true || recursive === 'true'

    return this.#withClient('removeDirectory', async client => {
      await client.rmdir(target, isRecursive)

      return { remotePath: target, removed: true }
    })
  }
}

Flowrunner.ServerCode.addService(SFTP, [
  {
    name: 'host',
    displayName: 'Host',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'SFTP server hostname or IP address, e.g. sftp.example.com. Must be reachable from FlowRunner. Note: the FlowRunner runtime has no IPv6 egress — the host must also publish an IPv4 (A) record.',
  },
  {
    name: 'port',
    displayName: 'Port',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    defaultValue: '22',
    hint: 'TCP port of the SFTP (SSH) server. Defaults to 22. This is SFTP-over-SSH — not plain FTP (21) or FTPS (990).',
  },
  {
    name: 'username',
    displayName: 'Username',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'The username to authenticate as on the SFTP server.',
  },
  {
    name: 'password',
    displayName: 'Password',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Password for the username. Leave empty if you are authenticating with a Private Key instead.',
  },
  {
    name: 'privateKey',
    displayName: 'Private Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.TEXT,
    required: false,
    shared: false,
    hint: 'Paste the OpenSSH private key contents (the full "-----BEGIN OPENSSH PRIVATE KEY-----" ... "-----END OPENSSH PRIVATE KEY-----" block). Leave empty if you are authenticating with a Password instead. If the key is encrypted, also set the Passphrase.',
  },
  {
    name: 'passphrase',
    displayName: 'Private Key Passphrase',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Passphrase that decrypts the Private Key, if it is encrypted. Leave empty for an unencrypted key or when using password authentication.',
  },
])
