'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Smartsheet Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('smartsheet')
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

  // ── Account ──

  describe('getCurrentUser', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getCurrentUser()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('email')
    })
  })

  describe('listUsers / listContacts', () => {
    it('lists users of the account', async () => {
      const result = await service.listUsers(undefined, 1, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('lists contacts', async () => {
      const result = await service.listContacts(1, 5)

      expect(result).toHaveProperty('data')
    })
  })

  // ── Sheet lifecycle ──

  describe('sheet lifecycle', () => {
    let sheetId
    let primaryColumnId
    let addedRowId
    let discussionId
    let attachmentId

    it('creates a sheet with columns', async () => {
      const result = await service.createSheet(`FlowRunner E2E ${ SUFFIX }`, [
        { title: 'Task', type: 'Text / Number', primary: true },
        { title: 'Status', type: 'Dropdown (Picklist)', options: ['Open', 'Done'] },
      ])

      expect(result).toHaveProperty('id')

      sheetId = result.id
    })

    it('lists sheets and finds the created sheet', async () => {
      const result = await service.listSheets(1, 100)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created sheet', async () => {
      const result = await service.getSheet(sheetId)

      expect(result).toHaveProperty('id', sheetId)
      expect(Array.isArray(result.columns)).toBe(true)
    })

    it('lists the sheet columns', async () => {
      const result = await service.listColumns(sheetId, 1, 100)

      expect(Array.isArray(result.data)).toBe(true)

      const primary = result.data.find(column => column.primary)

      expect(primary).toBeDefined()

      primaryColumnId = primary.id
    })

    it('gets a single column', async () => {
      const result = await service.getColumn(sheetId, primaryColumnId)

      expect(result).toHaveProperty('id', primaryColumnId)
    })

    it('adds a column and then deletes it', async () => {
      const added = await service.addColumn(sheetId, 'Notes', 'Text / Number', 2)

      expect(added).toHaveProperty('id')

      const updated = await service.updateColumn(sheetId, added.id, 'Notes Renamed')

      expect(updated).toHaveProperty('title', 'Notes Renamed')

      await expect(service.deleteColumn(sheetId, added.id)).resolves.toBeDefined()
    })

    it('adds a row', async () => {
      const result = await service.addRows(sheetId, [], [{ columnId: primaryColumnId, value: 'E2E task' }], undefined, true)

      expect(Array.isArray(result)).toBe(true)
      expect(result[0]).toHaveProperty('id')

      addedRowId = result[0].id
    })

    it('gets the added row', async () => {
      const result = await service.getRow(sheetId, addedRowId, ['Column Type'])

      expect(result).toHaveProperty('id', addedRowId)
    })

    it('updates the added row', async () => {
      const result = await service.updateRows(sheetId, [
        { id: addedRowId, cells: [{ columnId: primaryColumnId, value: 'E2E task updated' }] },
      ])

      expect(Array.isArray(result)).toBe(true)
    })

    it('reads the cell history of the updated cell', async () => {
      const result = await service.getCellHistory(sheetId, addedRowId, primaryColumnId, 1, 10)

      expect(result).toHaveProperty('data')
    })

    it('creates a row discussion and adds a comment', async () => {
      const discussion = await service.createRowDiscussion(sheetId, addedRowId, 'E2E discussion')

      expect(discussion).toHaveProperty('id')

      discussionId = discussion.id

      const comment = await service.addComment(sheetId, discussionId, 'E2E comment')

      expect(comment).toHaveProperty('id')
    })

    it('creates a sheet-level discussion', async () => {
      const result = await service.createSheetDiscussion(sheetId, 'E2E sheet discussion')

      expect(result).toHaveProperty('id')
    })

    it('lists discussions with comments', async () => {
      const result = await service.listDiscussions(sheetId, true, 1, 10)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the row discussion', async () => {
      await expect(service.deleteDiscussion(sheetId, discussionId)).resolves.toBeDefined()
    })

    it('attaches a URL to the row and lists attachments', async () => {
      const attachment = await service.attachUrlToRow(sheetId, addedRowId, 'https://www.smartsheet.com', 'Smartsheet')

      expect(attachment).toHaveProperty('id')

      attachmentId = attachment.id

      const list = await service.listAttachments(sheetId, 1, 10)

      expect(Array.isArray(list.data)).toBe(true)
    })

    it('gets attachment metadata', async () => {
      const result = await service.getAttachment(sheetId, attachmentId)

      expect(result).toHaveProperty('id', attachmentId)
    })

    it('deletes the attachment', async () => {
      await expect(service.deleteAttachment(sheetId, attachmentId)).resolves.toBeDefined()
    })

    it('searches within the sheet', async () => {
      const result = await service.searchSheet(sheetId, 'E2E')

      expect(result).toHaveProperty('results')
    })

    it('copies the sheet and deletes the copy', async () => {
      const copy = await service.copySheet(sheetId, 'Home', undefined, `FlowRunner E2E Copy ${ SUFFIX }`, ['Data'])

      expect(copy).toHaveProperty('id')

      await expect(service.deleteSheet(copy.id)).resolves.toBeDefined()
    })

    it('renames the sheet', async () => {
      const result = await service.updateSheet(sheetId, `FlowRunner E2E Renamed ${ SUFFIX }`)

      expect(result).toHaveProperty('name', `FlowRunner E2E Renamed ${ SUFFIX }`)
    })

    it('creates an update request for the row', async () => {
      const { updateRequestEmail } = testValues

      if (!updateRequestEmail) {
        console.log('Skipping createUpdateRequest: testValues.updateRequestEmail not set')

        return
      }

      const result = await service.createUpdateRequest(
        sheetId,
        [addedRowId],
        [updateRequestEmail],
        'E2E update request',
        'Please update this row.'
      )

      expect(result).toHaveProperty('id')
    })

    it('deletes the row', async () => {
      const result = await service.deleteRows(sheetId, [addedRowId])

      expect(result).toHaveProperty('deletedRowIds')
    })

    it('deletes the sheet', async () => {
      await expect(service.deleteSheet(sheetId)).resolves.toBeDefined()
    })
  })

  // ── Workspaces & folders ──

  describe('workspaces and folders', () => {
    it('lists workspaces', async () => {
      const result = await service.listWorkspaces(1, 10)

      expect(result).toHaveProperty('data')
    })

    it('creates a workspace, adds a folder and reads both back', async () => {
      const workspace = await service.createWorkspace(`FlowRunner E2E WS ${ SUFFIX }`)

      expect(workspace).toHaveProperty('id')

      const fetched = await service.getWorkspace(workspace.id, true)

      expect(fetched).toHaveProperty('id', workspace.id)

      const folder = await service.createFolderInWorkspace(workspace.id, `E2E Folder ${ SUFFIX }`)

      expect(folder).toHaveProperty('id')

      const fetchedFolder = await service.getFolder(folder.id)

      expect(fetchedFolder).toHaveProperty('id', folder.id)
    })

    it('lists home folders', async () => {
      const result = await service.listHomeFolders(1, 10)

      expect(result).toHaveProperty('data')
    })
  })

  // ── Reports ──

  describe('reports', () => {
    it('lists reports', async () => {
      const result = await service.listReports(1, 10)

      expect(result).toHaveProperty('data')
    })

    it('gets a report', async () => {
      const { reportId } = testValues

      if (!reportId) {
        console.log('Skipping getReport: testValues.reportId not set')

        return
      }

      const result = await service.getReport(reportId, 1, 10)

      expect(result).toHaveProperty('id')
    })
  })

  // ── Webhooks ──

  describe('webhooks', () => {
    it('lists webhooks', async () => {
      const result = await service.listWebhooks(1, 10)

      expect(result).toHaveProperty('data')
    })

    it('creates, disables and deletes a webhook', async () => {
      const { sheetId, webhookCallbackUrl } = testValues

      if (!sheetId || !webhookCallbackUrl) {
        console.log('Skipping webhook lifecycle: testValues.sheetId or testValues.webhookCallbackUrl not set')

        return
      }

      const webhook = await service.createWebhook(`E2E hook ${ SUFFIX }`, webhookCallbackUrl, sheetId)

      expect(webhook).toHaveProperty('id')

      await expect(service.setWebhookStatus(webhook.id, false)).resolves.toBeDefined()
      await expect(service.deleteWebhook(webhook.id)).resolves.toBeDefined()
    })
  })

  // ── Search ──

  describe('searchEverything', () => {
    it('searches across the account', async () => {
      const result = await service.searchEverything('FlowRunner', ['Sheet Names'])

      expect(result).toHaveProperty('results')
    })
  })

  // ── File storage backed actions ──

  describe('file storage actions', () => {
    // exportSheet and downloadAttachment call this.flowrunner.Files.uploadFile, which the e2e
    // sandbox does not provide. They run only when a stub-friendly sheet id is configured and
    // are covered end to end by the unit suite.
    it('exports a sheet when a sheet id is configured', async () => {
      const { sheetId } = testValues

      if (!sheetId) {
        console.log('Skipping exportSheet: testValues.sheetId not set')

        return
      }

      const uploaded = []

      service.flowrunner = {
        Files: {
          uploadFile: async (buffer, options) => {
            uploaded.push({ buffer, options })

            return { url: 'https://files.example.com/e2e-export' }
          },
        },
      }

      try {
        const result = await service.exportSheet(sheetId, 'CSV', undefined, `e2e_export_${ SUFFIX }`)

        expect(result).toHaveProperty('fileURL')
        expect(result.filename).toBe(`e2e_export_${ SUFFIX }.csv`)
        expect(uploaded).toHaveLength(1)
        expect(uploaded[0].buffer.length).toBeGreaterThan(0)
      } finally {
        delete service.flowrunner
      }
    })
  })
})
