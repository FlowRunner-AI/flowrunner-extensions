const logger = {
  info: (...args) => console.log('[Smartsheet] info:', ...args),
  debug: (...args) => console.log('[Smartsheet] debug:', ...args),
  error: (...args) => console.log('[Smartsheet] error:', ...args),
  warn: (...args) => console.log('[Smartsheet] warn:', ...args),
}

const REGION_BASE_URLS = {
  US: 'https://api.smartsheet.com/2.0',
  EU: 'https://api.smartsheet.eu/2.0',
  Gov: 'https://api.smartsheetgov.com/2.0',
}

const DICTIONARY_PAGE_SIZE = 100

const COLUMN_TYPE_MAP = {
  'Text / Number': 'TEXT_NUMBER',
  'Date': 'DATE',
  'Date & Time': 'DATETIME',
  'Contact List': 'CONTACT_LIST',
  'Checkbox': 'CHECKBOX',
  'Dropdown (Picklist)': 'PICKLIST',
  'Duration': 'DURATION',
  'Abstract Date & Time': 'ABSTRACT_DATETIME',
}

const SHEET_INCLUDE_MAP = {
  'Attachments': 'attachments',
  'Discussions': 'discussions',
  'Format': 'format',
  'Object Value': 'objectValue',
}

const COPY_SHEET_INCLUDE_MAP = {
  'Attachments': 'attachments',
  'Cell Links': 'cellLinks',
  'Data': 'data',
  'Discussions': 'discussions',
  'Filters': 'filters',
  'Forms': 'forms',
  'Rule Recipients': 'ruleRecipients',
  'Rules': 'rules',
  'Shares': 'shares',
}

const DESTINATION_TYPE_MAP = {
  'Folder': 'folder',
  'Workspace': 'workspace',
  'Home': 'home',
}

const ROW_INCLUDE_MAP = {
  'Column Type': 'columnType',
  'Object Value': 'objectValue',
}

const ROW_COPY_INCLUDE_MAP = {
  'Attachments': 'attachments',
  'Discussions': 'discussions',
}

const EXPORT_FORMAT_MAP = {
  'Excel': { accept: 'application/vnd.ms-excel', extension: 'xlsx' },
  'PDF': { accept: 'application/pdf', extension: 'pdf' },
  'CSV': { accept: 'text/csv', extension: 'csv' },
}

const PAPER_SIZE_MAP = {
  'Letter': 'LETTER',
  'Legal': 'LEGAL',
  'Wide': 'WIDE',
  'Arch D': 'ARCHD',
  'A4': 'A4',
  'A3': 'A3',
  'A2': 'A2',
  'A1': 'A1',
  'A0': 'A0',
}

const SEARCH_SCOPE_MAP = {
  'Attachments': 'attachments',
  'Cell Data': 'cellData',
  'Comments': 'comments',
  'Folder Names': 'folderNames',
  'Report Names': 'reportNames',
  'Sheet Names': 'sheetNames',
  'Dashboard Names': 'sightNames',
  'Summary Fields': 'summaryFields',
  'Template Names': 'templateNames',
  'Workspace Names': 'workspaceNames',
}

function clean(obj) {
  if (!obj) {
    return obj
  }

  const result = {}

  for (const key in obj) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

// Smartsheet object IDs are numeric (they fit in JS safe-integer range); dictionary values and
// UI inputs may arrive as strings, so coerce before putting them into JSON bodies.
function toId(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const num = Number(value)

  return Number.isNaN(num) ? value : num
}

function toIdList(values) {
  if (!Array.isArray(values) || !values.length) {
    return undefined
  }

  return values.map(toId).filter(value => value !== undefined)
}

// Accepts an ISO-8601 string or a millisecond timestamp (DATE_TIME_PICKER) and returns ISO-8601.
function toIsoDate(value) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    return new Date(Number(value)).toISOString()
  }

  return String(value)
}

/**
 * @typedef {Object} SheetColumn
 * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Column header title."}
 * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Text / Number","uiComponent":{"type":"DROPDOWN","options":{"values":["Text / Number","Date","Date & Time","Contact List","Checkbox","Dropdown (Picklist)","Duration","Abstract Date & Time"]}},"description":"Column data type. The primary column must be Text / Number."}
 * @paramDef {"type":"Boolean","label":"Primary","name":"primary","uiComponent":{"type":"TOGGLE"},"description":"Marks the primary column. Exactly one column in the sheet must be primary, and it must be of type Text / Number."}
 * @paramDef {"type":"Array<String>","label":"Options","name":"options","description":"Choice values for a Dropdown (Picklist) column. Ignored for other column types."}
 */

/**
 * @typedef {Object} RowInput
 * @paramDef {"type":"Array<Object>","label":"Cells","name":"cells","required":true,"description":"Cell objects in the form {\"columnId\": 7960873114331012, \"value\": \"Done\"}. Each cell may set value or formula (not both), plus optional strict (Boolean) — leave strict off to let Smartsheet coerce value types."}
 * @paramDef {"type":"Boolean","label":"To Top","name":"toTop","uiComponent":{"type":"TOGGLE"},"description":"Insert the row at the top of the sheet."}
 * @paramDef {"type":"Boolean","label":"To Bottom","name":"toBottom","uiComponent":{"type":"TOGGLE"},"description":"Insert the row at the bottom of the sheet (the default when no location is given)."}
 * @paramDef {"type":"Number","label":"Parent Row ID","name":"parentId","description":"Make this row the first child of the given parent row (creates hierarchy)."}
 * @paramDef {"type":"Number","label":"Sibling Row ID","name":"siblingId","description":"Insert the row directly below the given sibling row, at the same indent level."}
 * @paramDef {"type":"Boolean","label":"Expanded","name":"expanded","uiComponent":{"type":"TOGGLE"},"description":"Whether the row is expanded (only meaningful for parent rows)."}
 */

/**
 * @typedef {Object} RowUpdate
 * @paramDef {"type":"Number","label":"Row ID","name":"id","required":true,"description":"ID of the row to update."}
 * @paramDef {"type":"Array<Object>","label":"Cells","name":"cells","required":true,"description":"Cell objects in the form {\"columnId\": 7960873114331012, \"value\": \"Done\"}. Each cell may set value or formula (not both), plus optional strict (Boolean). Only the listed cells are changed; other cells keep their values."}
 */

/**
 * @typedef {Object} getSheetsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sheets by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payloadCriteria
 * @paramDef {"type":"String","label":"Sheet","name":"sheetId","description":"The sheet whose columns populate the list."}
 */

/**
 * @typedef {Object} getColumnsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter columns by title."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 * @paramDef {"type":"getColumnsDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"The sheet whose columns to list."}
 */

/**
 * @typedef {Object} getWorkspacesDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter workspaces by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @typedef {Object} getReportsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter reports by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @usesFileStorage
 * @integrationName Smartsheet
 * @integrationIcon /icon.png
 */
class Smartsheet {
  constructor(config) {
    this.accessToken = config.accessToken
    this.baseUrl = REGION_BASE_URLS[config.region] || REGION_BASE_URLS.US
  }

  // Single gateway for all Smartsheet API calls. Write responses arrive wrapped as
  // {message:"SUCCESS", resultCode:0, result:{...}} — the wrapper is unwrapped here so actions
  // return the useful object directly. Binary responses (exports, downloads) return a Buffer.
  async #apiRequest({ path, method = 'get', body, query, headers, binary, logTag }) {
    const url = `${ this.baseUrl }${ path }`

    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ path }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      let request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.accessToken }`,
          ...(headers || { 'Content-Type': 'application/json' }),
        })
        .query(cleanedQuery || {})

      if (binary) {
        request = request.setEncoding(null)
      }

      const response = body !== undefined ? await request.send(body) : await request

      if (binary) {
        return Buffer.isBuffer(response) ? response : Buffer.from(response)
      }

      if (response && response.message === 'SUCCESS' && response.result !== undefined) {
        return response.result
      }

      return response
    } catch (error) {
      const details = error.body || {}
      const message = details.message || error.message
      const suffix = details.errorCode ? ` (errorCode ${ details.errorCode }, refId ${ details.refId })` : ''

      logger.error(`${ logTag } - failed: ${ message }${ suffix }`)

      throw new Error(`Smartsheet API error: ${ message }${ suffix }`)
    }
  }

  // Maps a friendly DROPDOWN label to its API value; passes through unknown/bound values.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #resolveChoices(values, mapping) {
    if (!Array.isArray(values) || !values.length) {
      return undefined
    }

    return values.map(value => this.#resolveChoice(value, mapping)).filter(Boolean)
  }

  #normalizeCells(cells) {
    return (cells || []).map(cell => clean({
      ...cell,
      columnId: toId(cell.columnId),
    }))
  }

  async #saveToFiles(buffer, filename, fileOptions) {
    const { url } = await this.flowrunner.Files.uploadFile(buffer, {
      filename,
      generateUrl: true,
      overwrite: true,
      ...(fileOptions || { scope: 'FLOW' }),
    })

    return { fileURL: url, filename, sizeBytes: buffer.length }
  }

  // ==================== Sheets ====================

  /**
   * @operationName List Sheets
   * @category Sheets
   * @description Lists all sheets the token's user has access to, with id, name, access level, permalink, and timestamps. Results are paginated (100 per page by default) — use Page and Page Size to walk large accounts, and Modified Since to fetch only recently changed sheets.
   * @route GET /sheets
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Sheets per page. Defaults to 100."}
   * @paramDef {"type":"String","label":"Modified Since","name":"modifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return sheets modified on or after this date-time."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":2,"data":[{"id":4583173393803140,"name":"Project Tracker","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/abc123","createdAt":"2024-01-15T09:30:00Z","modifiedAt":"2024-06-01T12:00:00Z"}]}
   */
  async listSheets(page, pageSize, modifiedSince) {
    return await this.#apiRequest({
      logTag: '[listSheets]',
      path: '/sheets',
      query: {
        page,
        pageSize,
        modifiedSince: toIsoDate(modifiedSince),
      },
    })
  }

  /**
   * @operationName Get Sheet
   * @category Sheets
   * @description Retrieves a sheet with its columns and rows. Every row carries a cells array of {columnId, value, displayValue}. Rows can be filtered with Rows Modified Since or Row Numbers, trimmed with Column IDs, and paginated with Page/Page Size. Use Include to also load attachments, discussions, formatting, or rich objectValue cell data.
   * @route GET /sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to retrieve. Pick one or paste a sheet ID."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Attachments","Discussions","Format","Object Value"]}},"description":"Extra data to embed in the response."}
   * @paramDef {"type":"String","label":"Rows Modified Since","name":"rowsModifiedSince","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return rows modified on or after this date-time. Others come back with empty cells."}
   * @paramDef {"type":"Array<Number>","label":"Column IDs","name":"columnIds","description":"Limit returned cell data to these columns."}
   * @paramDef {"type":"Array<Number>","label":"Row Numbers","name":"rowNumbers","description":"Only return the rows at these 1-based row numbers."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page of rows to return. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rows per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Project Tracker","totalRowCount":50,"accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/abc123","columns":[{"id":7960873114331012,"index":0,"title":"Task Name","type":"TEXT_NUMBER","primary":true}],"rows":[{"id":1234567890123456,"rowNumber":1,"cells":[{"columnId":7960873114331012,"value":"Design mockups","displayValue":"Design mockups"}]}]}
   */
  async getSheet(sheetId, include, rowsModifiedSince, columnIds, rowNumbers, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[getSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }`,
      query: {
        include: this.#resolveChoices(include, SHEET_INCLUDE_MAP)?.join(','),
        rowsModifiedSince: toIsoDate(rowsModifiedSince),
        columnIds: toIdList(columnIds)?.join(','),
        rowNumbers: toIdList(rowNumbers)?.join(','),
        page,
        pageSize,
      },
    })
  }

  /**
   * @operationName Create Sheet
   * @category Sheets
   * @description Creates a new sheet in the user's Sheets folder from a name and a column list. Exactly one column must be marked primary and it must be of type Text / Number. Returns the created sheet with its generated sheet and column IDs.
   * @route POST /sheets
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new sheet."}
   * @paramDef {"type":"Array<SheetColumn>","label":"Columns","name":"columns","required":true,"description":"Column definitions. Exactly one must have Primary enabled (type Text / Number)."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Project Tracker","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/abc123","columns":[{"id":7960873114331012,"index":0,"title":"Task Name","type":"TEXT_NUMBER","primary":true},{"id":642523719853956,"index":1,"title":"Status","type":"PICKLIST","options":["Open","Done"]}]}
   */
  async createSheet(name, columns) {
    const mappedColumns = (columns || []).map(column => clean({
      title: column.title,
      type: this.#resolveChoice(column.type, COLUMN_TYPE_MAP) || 'TEXT_NUMBER',
      primary: column.primary,
      options: column.options,
    }))

    return await this.#apiRequest({
      logTag: '[createSheet]',
      path: '/sheets',
      method: 'post',
      body: { name, columns: mappedColumns },
    })
  }

  /**
   * @operationName Copy Sheet
   * @category Sheets
   * @description Copies a sheet into a folder, a workspace, or the user's Sheets folder (Home). By default only the sheet structure is copied — select Include options (Data, Attachments, Discussions, etc.) to copy content as well. Returns the new sheet's id and permalink.
   * @route POST /copy-sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to copy."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationType","required":true,"defaultValue":"Home","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Workspace","Home"]}},"description":"Where to place the copy. Home is the user's Sheets folder and needs no Destination ID."}
   * @paramDef {"type":"Number","label":"Destination ID","name":"destinationId","description":"ID of the destination folder or workspace. Required unless Destination Type is Home."}
   * @paramDef {"type":"String","label":"New Name","name":"newName","required":true,"description":"Name for the copied sheet."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Attachments","Cell Links","Data","Discussions","Filters","Forms","Rule Recipients","Rules","Shares"]}},"description":"Sheet elements to copy along with the structure. Select Data to copy row content."}
   * @returns {Object}
   * @sampleResult {"id":2258256056870788,"name":"Copy of Project Tracker","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/def456"}
   */
  async copySheet(sheetId, destinationType, destinationId, newName, include) {
    return await this.#apiRequest({
      logTag: '[copySheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/copy`,
      method: 'post',
      query: { include: this.#resolveChoices(include, COPY_SHEET_INCLUDE_MAP)?.join(',') },
      body: clean({
        destinationType: this.#resolveChoice(destinationType, DESTINATION_TYPE_MAP) || 'home',
        destinationId: toId(destinationId),
        newName,
      }),
    })
  }

  /**
   * @operationName Move Sheet
   * @category Sheets
   * @description Moves a sheet into a folder, a workspace, or the user's Sheets folder (Home). The mover must be the sheet owner or a workspace admin. Returns the sheet with its new location's permalink.
   * @route POST /move-sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to move."}
   * @paramDef {"type":"String","label":"Destination Type","name":"destinationType","required":true,"defaultValue":"Home","uiComponent":{"type":"DROPDOWN","options":{"values":["Folder","Workspace","Home"]}},"description":"Where to move the sheet. Home is the user's Sheets folder and needs no Destination ID."}
   * @paramDef {"type":"Number","label":"Destination ID","name":"destinationId","description":"ID of the destination folder or workspace. Required unless Destination Type is Home."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Project Tracker","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/abc123"}
   */
  async moveSheet(sheetId, destinationType, destinationId) {
    return await this.#apiRequest({
      logTag: '[moveSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/move`,
      method: 'post',
      body: clean({
        destinationType: this.#resolveChoice(destinationType, DESTINATION_TYPE_MAP) || 'home',
        destinationId: toId(destinationId),
      }),
    })
  }

  /**
   * @operationName Update Sheet
   * @category Sheets
   * @description Renames a sheet and/or updates its user settings (critical path highlighting, summary task display). Only the provided fields are changed. Returns the updated sheet.
   * @route PUT /sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to update."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the sheet."}
   * @paramDef {"type":"Object","label":"User Settings","name":"userSettings","description":"Per-user sheet settings, e.g. {\"criticalPathEnabled\": true, \"displaySummaryTasks\": true}."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Project Tracker 2025","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/sheets/abc123","userSettings":{"criticalPathEnabled":false,"displaySummaryTasks":true}}
   */
  async updateSheet(sheetId, name, userSettings) {
    return await this.#apiRequest({
      logTag: '[updateSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }`,
      method: 'put',
      body: clean({ name, userSettings }),
    })
  }

  /**
   * @operationName Delete Sheet
   * @category Sheets
   * @description Permanently deletes a sheet, including all of its rows, attachments, and discussions. This cannot be undone from the API — the sheet does not go to a trash folder.
   * @route DELETE /sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to delete."}
   * @returns {Object}
   * @sampleResult {"message":"SUCCESS","resultCode":0}
   */
  async deleteSheet(sheetId) {
    return await this.#apiRequest({
      logTag: '[deleteSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }`,
      method: 'delete',
    })
  }

  /**
   * @operationName Export Sheet
   * @category Sheets
   * @description Exports a sheet as an Excel (.xlsx), PDF, or CSV file and saves it to FlowRunner file storage, returning a download URL. CSV and Excel contain the grid data; PDF renders the sheet with an optional paper size. Note that CSV export includes only the primary grid without formatting.
   * @route POST /export-sheet
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to export."}
   * @paramDef {"type":"String","label":"Format","name":"format","required":true,"defaultValue":"Excel","uiComponent":{"type":"DROPDOWN","options":{"values":["Excel","PDF","CSV"]}},"description":"Output file format."}
   * @paramDef {"type":"String","label":"Paper Size","name":"paperSize","uiComponent":{"type":"DROPDOWN","options":{"values":["Letter","Legal","Wide","Arch D","A4","A3","A2","A1","A0"]}},"description":"Page size for PDF export. Ignored for Excel and CSV."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name for the saved file. The correct extension is appended automatically. Defaults to sheet_{id}_{timestamp}."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the exported file: FLOW (default), WORKSPACE, or EXECUTION scope."}
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.flowrunner.com/abc/project_tracker.xlsx","filename":"project_tracker.xlsx","sizeBytes":24576,"format":"Excel"}
   */
  async exportSheet(sheetId, format, paperSize, fileName, fileOptions) {
    const exportFormat = EXPORT_FORMAT_MAP[format] || EXPORT_FORMAT_MAP.Excel

    const buffer = await this.#apiRequest({
      logTag: '[exportSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }`,
      headers: { 'Accept': exportFormat.accept },
      query: format === 'PDF' ? { paperSize: this.#resolveChoice(paperSize, PAPER_SIZE_MAP) } : undefined,
      binary: true,
    })

    const baseName = fileName || `sheet_${ sheetId }_${ Date.now() }`
    const filename = baseName.toLowerCase().endsWith(`.${ exportFormat.extension }`)
      ? baseName
      : `${ baseName }.${ exportFormat.extension }`

    const saved = await this.#saveToFiles(buffer, filename, fileOptions)

    return { ...saved, format: format || 'Excel' }
  }

  // ==================== Rows ====================

  /**
   * @operationName Add Rows
   * @category Rows
   * @description Adds one or more rows to a sheet. Each row carries cells [{columnId, value|formula, strict}] and an optional location (toTop, toBottom, parentId, siblingId) — rows go to the bottom when no location is set. Provide multiple rows via Rows, or a single row via the convenience Cells parameter plus the location toggles. Returns the created rows with their generated IDs and row numbers.
   * @route POST /rows
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to add rows to."}
   * @paramDef {"type":"Array<RowInput>","label":"Rows","name":"rows","description":"Rows to add. Use this for multiple rows; leave empty when using the single-row Cells parameter below."}
   * @paramDef {"type":"Array<Object>","label":"Cells","name":"cells","description":"Convenience single-row input: cell objects like {\"columnId\": 7960873114331012, \"value\": \"Done\"}. Ignored when Rows is provided."}
   * @paramDef {"type":"Boolean","label":"To Top","name":"toTop","uiComponent":{"type":"TOGGLE"},"description":"Insert the single row at the top of the sheet. Used only with Cells."}
   * @paramDef {"type":"Boolean","label":"To Bottom","name":"toBottom","uiComponent":{"type":"TOGGLE"},"description":"Insert the single row at the bottom of the sheet (the default). Used only with Cells."}
   * @paramDef {"type":"Number","label":"Parent Row ID","name":"parentId","description":"Make the single row the first child of this parent row. Used only with Cells."}
   * @paramDef {"type":"Number","label":"Sibling Row ID","name":"siblingId","description":"Insert the single row directly below this sibling row. Used only with Cells."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":6572427401553796,"sheetId":4583173393803140,"rowNumber":51,"expanded":true,"cells":[{"columnId":7960873114331012,"value":"Design mockups","displayValue":"Design mockups"}],"createdAt":"2024-06-01T12:00:00Z","modifiedAt":"2024-06-01T12:00:00Z"}]
   */
  async addRows(sheetId, rows, cells, toTop, toBottom, parentId, siblingId) {
    const normalizeRow = row => clean({
      cells: this.#normalizeCells(row.cells),
      toTop: row.toTop,
      toBottom: row.toBottom,
      parentId: toId(row.parentId),
      siblingId: toId(row.siblingId),
      expanded: row.expanded,
    })

    let payload

    if (Array.isArray(rows) && rows.length) {
      payload = rows.map(normalizeRow)
    } else if (Array.isArray(cells) && cells.length) {
      payload = [normalizeRow({ cells, toTop, toBottom, parentId, siblingId })]
    } else {
      throw new Error('Smartsheet API error: provide either Rows or Cells so at least one row can be added.')
    }

    return await this.#apiRequest({
      logTag: '[addRows]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows`,
      method: 'post',
      body: payload,
    })
  }

  /**
   * @operationName Update Rows
   * @category Rows
   * @description Updates cell values in one or more existing rows. Each entry needs the row id and a cells array [{columnId, value|formula, strict}]; only the listed cells are changed, all other cells keep their values. Returns the updated rows.
   * @route PUT /rows
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the rows."}
   * @paramDef {"type":"Array<RowUpdate>","label":"Rows","name":"rows","required":true,"description":"Row updates, each with the row id and the cells to change."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":6572427401553796,"sheetId":4583173393803140,"rowNumber":3,"cells":[{"columnId":642523719853956,"value":"Done","displayValue":"Done"}],"modifiedAt":"2024-06-01T12:00:00Z"}]
   */
  async updateRows(sheetId, rows) {
    const payload = (rows || []).map(row => clean({
      id: toId(row.id),
      cells: this.#normalizeCells(row.cells),
    }))

    return await this.#apiRequest({
      logTag: '[updateRows]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows`,
      method: 'put',
      body: payload,
    })
  }

  /**
   * @operationName Get Row
   * @category Rows
   * @description Retrieves a single row with its cells [{columnId, value, displayValue}], row number, hierarchy info, and timestamps. Use Include to add each cell's column type or rich objectValue data (contacts, multi-picklist values, hyperlinks).
   * @route GET /row
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the row."}
   * @paramDef {"type":"Number","label":"Row ID","name":"rowId","required":true,"description":"ID of the row to retrieve (not the row number)."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Column Type","Object Value"]}},"description":"Extra cell data to embed in the response."}
   * @returns {Object}
   * @sampleResult {"id":6572427401553796,"sheetId":4583173393803140,"rowNumber":1,"expanded":true,"cells":[{"columnId":7960873114331012,"value":"Design mockups","displayValue":"Design mockups"}],"createdAt":"2024-01-15T09:30:00Z","modifiedAt":"2024-06-01T12:00:00Z"}
   */
  async getRow(sheetId, rowId, include) {
    return await this.#apiRequest({
      logTag: '[getRow]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/${ encodeURIComponent(rowId) }`,
      query: { include: this.#resolveChoices(include, ROW_INCLUDE_MAP)?.join(',') },
    })
  }

  /**
   * @operationName Delete Rows
   * @category Rows
   * @description Permanently deletes one or more rows from a sheet, including their attachments and discussions. With Ignore Rows Not Found enabled (the default), already-deleted row IDs are skipped instead of failing the whole call. Returns the IDs of the deleted rows.
   * @route DELETE /rows
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the rows."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"rowIds","required":true,"description":"IDs of the rows to delete."}
   * @paramDef {"type":"Boolean","label":"Ignore Rows Not Found","name":"ignoreRowsNotFound","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Skip IDs that no longer exist instead of failing the request. Defaults to on."}
   * @returns {Object}
   * @sampleResult {"deletedRowIds":[6572427401553796,1234567890123456]}
   */
  async deleteRows(sheetId, rowIds, ignoreRowsNotFound) {
    const deletedRowIds = await this.#apiRequest({
      logTag: '[deleteRows]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows`,
      method: 'delete',
      query: {
        ids: toIdList(rowIds)?.join(','),
        ignoreRowsNotFound: ignoreRowsNotFound !== false,
      },
    })

    return { deletedRowIds }
  }

  /**
   * @operationName Move Rows to Another Sheet
   * @category Rows
   * @description Moves rows from one sheet to another. Both sheets must share compatible columns for cell data to carry over. Child rows move with their parents. Returns rowMappings pairing each source row ID with its new ID in the destination sheet.
   * @route POST /move-rows
   * @paramDef {"type":"String","label":"Source Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet the rows are moved from."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"rowIds","required":true,"description":"IDs of the rows to move."}
   * @paramDef {"type":"String","label":"Destination Sheet","name":"destinationSheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet the rows are moved to."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Attachments","Discussions"]}},"description":"Row elements to move along with the cell data."}
   * @paramDef {"type":"Boolean","label":"Ignore Rows Not Found","name":"ignoreRowsNotFound","uiComponent":{"type":"TOGGLE"},"description":"Skip IDs that no longer exist instead of failing the request."}
   * @returns {Object}
   * @sampleResult {"destinationSheetId":2258256056870788,"rowMappings":[{"from":6572427401553796,"to":1049041315455876}]}
   */
  async moveRowsToSheet(sheetId, rowIds, destinationSheetId, include, ignoreRowsNotFound) {
    return await this.#apiRequest({
      logTag: '[moveRowsToSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/move`,
      method: 'post',
      query: {
        include: this.#resolveChoices(include, ROW_COPY_INCLUDE_MAP)?.join(','),
        ignoreRowsNotFound: ignoreRowsNotFound === true ? true : undefined,
      },
      body: {
        rowIds: toIdList(rowIds),
        to: { sheetId: toId(destinationSheetId) },
      },
    })
  }

  /**
   * @operationName Copy Rows to Another Sheet
   * @category Rows
   * @description Copies rows from one sheet to another, leaving the originals in place. Cell data carries over where the destination has compatible columns. Returns rowMappings pairing each source row ID with the ID of its copy in the destination sheet.
   * @route POST /copy-rows
   * @paramDef {"type":"String","label":"Source Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet the rows are copied from."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"rowIds","required":true,"description":"IDs of the rows to copy."}
   * @paramDef {"type":"String","label":"Destination Sheet","name":"destinationSheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet the rows are copied to."}
   * @paramDef {"type":"Array<String>","label":"Include","name":"include","uiComponent":{"type":"DROPDOWN","options":{"values":["Attachments","Discussions"]}},"description":"Row elements to copy along with the cell data."}
   * @paramDef {"type":"Boolean","label":"Ignore Rows Not Found","name":"ignoreRowsNotFound","uiComponent":{"type":"TOGGLE"},"description":"Skip IDs that no longer exist instead of failing the request."}
   * @returns {Object}
   * @sampleResult {"destinationSheetId":2258256056870788,"rowMappings":[{"from":6572427401553796,"to":1049041315455876}]}
   */
  async copyRowsToSheet(sheetId, rowIds, destinationSheetId, include, ignoreRowsNotFound) {
    return await this.#apiRequest({
      logTag: '[copyRowsToSheet]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/copy`,
      method: 'post',
      query: {
        include: this.#resolveChoices(include, ROW_COPY_INCLUDE_MAP)?.join(','),
        ignoreRowsNotFound: ignoreRowsNotFound === true ? true : undefined,
      },
      body: {
        rowIds: toIdList(rowIds),
        to: { sheetId: toId(destinationSheetId) },
      },
    })
  }

  /**
   * @operationName Get Cell History
   * @category Rows
   * @description Retrieves the change history of a single cell — every value it has held, with who changed it and when, newest first. Identify the cell by sheet, row ID, and column. Results are paginated.
   * @route GET /cell-history
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the cell."}
   * @paramDef {"type":"Number","label":"Row ID","name":"rowId","required":true,"description":"ID of the row containing the cell."}
   * @paramDef {"type":"String","label":"Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","dependsOn":["sheetId"],"description":"The column containing the cell. Pick one after selecting the sheet, or paste a column ID."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"History entries per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":2,"data":[{"columnId":642523719853956,"value":"Done","displayValue":"Done","modifiedAt":"2024-06-01T12:00:00Z","modifiedBy":{"name":"Jane Doe","email":"jane@example.com"}}]}
   */
  async getCellHistory(sheetId, rowId, columnId, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[getCellHistory]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/${ encodeURIComponent(rowId) }/columns/${ encodeURIComponent(columnId) }/history`,
      query: { page, pageSize },
    })
  }

  // ==================== Columns ====================

  /**
   * @operationName List Columns
   * @category Columns
   * @description Lists all columns of a sheet with their IDs, titles, types, picklist options, and positions. Column IDs from this list are what row cells reference via columnId.
   * @route GET /columns
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet whose columns to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Columns per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":3,"data":[{"id":7960873114331012,"index":0,"title":"Task Name","type":"TEXT_NUMBER","primary":true,"width":150},{"id":642523719853956,"index":1,"title":"Status","type":"PICKLIST","options":["Open","In Progress","Done"],"width":120}]}
   */
  async listColumns(sheetId, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listColumns]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns`,
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Get Column
   * @category Columns
   * @description Retrieves a single column's definition — title, type, picklist options, position, width, and validation flag.
   * @route GET /column
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the column."}
   * @paramDef {"type":"String","label":"Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","dependsOn":["sheetId"],"description":"The column to retrieve. Pick one after selecting the sheet, or paste a column ID."}
   * @returns {Object}
   * @sampleResult {"id":642523719853956,"index":1,"title":"Status","type":"PICKLIST","options":["Open","In Progress","Done"],"width":120,"validation":false}
   */
  async getColumn(sheetId, columnId) {
    return await this.#apiRequest({
      logTag: '[getColumn]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns/${ encodeURIComponent(columnId) }`,
    })
  }

  /**
   * @operationName Add Column
   * @category Columns
   * @description Adds a new column to a sheet at the given 0-based position. Choose a data type, supply Options for a Dropdown (Picklist) column, and optionally enable validation to restrict cells to valid values. Returns the created column with its generated ID.
   * @route POST /columns
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to add the column to."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Column header title."}
   * @paramDef {"type":"String","label":"Type","name":"type","required":true,"defaultValue":"Text / Number","uiComponent":{"type":"DROPDOWN","options":{"values":["Text / Number","Date","Date & Time","Contact List","Checkbox","Dropdown (Picklist)","Duration","Abstract Date & Time"]}},"description":"Column data type."}
   * @paramDef {"type":"Number","label":"Index","name":"index","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"0-based position for the new column (0 inserts at the far left)."}
   * @paramDef {"type":"Array<String>","label":"Options","name":"options","description":"Choice values for a Dropdown (Picklist) column. Ignored for other column types."}
   * @paramDef {"type":"Boolean","label":"Validation","name":"validation","uiComponent":{"type":"TOGGLE"},"description":"Restrict cell input to valid values for the column type (e.g. only picklist options)."}
   * @returns {Object}
   * @sampleResult {"id":642523719853956,"index":2,"title":"Status","type":"PICKLIST","options":["Open","In Progress","Done"],"validation":true}
   */
  async addColumn(sheetId, title, type, index, options, validation) {
    return await this.#apiRequest({
      logTag: '[addColumn]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns`,
      method: 'post',
      body: clean({
        title,
        type: this.#resolveChoice(type, COLUMN_TYPE_MAP) || 'TEXT_NUMBER',
        index: toId(index),
        options,
        validation,
      }),
    })
  }

  /**
   * @operationName Update Column
   * @category Columns
   * @description Updates a column's title, type, position, picklist options, or validation flag. Only the provided fields are changed. Changing the type of a column that already contains data converts existing values where possible.
   * @route PUT /column
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the column."}
   * @paramDef {"type":"String","label":"Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","dependsOn":["sheetId"],"description":"The column to update. Pick one after selecting the sheet, or paste a column ID."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"New column header title."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Text / Number","Date","Date & Time","Contact List","Checkbox","Dropdown (Picklist)","Duration","Abstract Date & Time"]}},"description":"New column data type. Leave empty to keep the current type."}
   * @paramDef {"type":"Number","label":"Index","name":"index","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"New 0-based position for the column."}
   * @paramDef {"type":"Array<String>","label":"Options","name":"options","description":"Replacement choice values for a Dropdown (Picklist) column."}
   * @paramDef {"type":"Boolean","label":"Validation","name":"validation","uiComponent":{"type":"TOGGLE"},"description":"Restrict cell input to valid values for the column type."}
   * @returns {Object}
   * @sampleResult {"id":642523719853956,"index":1,"title":"Stage","type":"PICKLIST","options":["Backlog","Active","Done"],"validation":true}
   */
  async updateColumn(sheetId, columnId, title, type, index, options, validation) {
    return await this.#apiRequest({
      logTag: '[updateColumn]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns/${ encodeURIComponent(columnId) }`,
      method: 'put',
      body: clean({
        title,
        type: this.#resolveChoice(type, COLUMN_TYPE_MAP),
        index: toId(index),
        options,
        validation,
      }),
    })
  }

  /**
   * @operationName Delete Column
   * @category Columns
   * @description Permanently deletes a column and all of its cell data from a sheet. This cannot be undone from the API. The primary column cannot be deleted.
   * @route DELETE /column
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the column."}
   * @paramDef {"type":"String","label":"Column","name":"columnId","required":true,"dictionary":"getColumnsDictionary","dependsOn":["sheetId"],"description":"The column to delete. Pick one after selecting the sheet, or paste a column ID."}
   * @returns {Object}
   * @sampleResult {"message":"SUCCESS","resultCode":0}
   */
  async deleteColumn(sheetId, columnId) {
    return await this.#apiRequest({
      logTag: '[deleteColumn]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns/${ encodeURIComponent(columnId) }`,
      method: 'delete',
    })
  }

  // ==================== Attachments ====================

  /**
   * @operationName List Attachments
   * @category Attachments
   * @description Lists all attachments on a sheet, including sheet-level, row-level, and comment-level attachments. Each entry shows the attachment type (FILE or LINK), parent object, size, and creator. Use Get Attachment to obtain a download URL for a specific entry.
   * @route GET /attachments
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet whose attachments to list."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Attachments per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":4583173393803140,"name":"Report.pdf","attachmentType":"FILE","mimeType":"application/pdf","sizeInKb":120,"parentType":"ROW","parentId":6572427401553796,"createdBy":{"email":"jane@example.com"},"createdAt":"2024-06-01T12:00:00Z"}]}
   */
  async listAttachments(sheetId, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listAttachments]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/attachments`,
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Attach URL to Row
   * @category Attachments
   * @description Attaches a web link (URL) to a row. The link appears in the row's attachments panel in Smartsheet. Returns the created attachment record.
   * @route POST /attach-url
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the row."}
   * @paramDef {"type":"Number","label":"Row ID","name":"rowId","required":true,"description":"ID of the row to attach the link to."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"The web address to attach, e.g. https://example.com/spec."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"Display name for the link. Defaults to the URL."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Design spec","attachmentType":"LINK","url":"https://example.com/spec","parentType":"ROW","parentId":6572427401553796,"createdAt":"2024-06-01T12:00:00Z"}
   */
  async attachUrlToRow(sheetId, rowId, url, name) {
    return await this.#apiRequest({
      logTag: '[attachUrlToRow]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/${ encodeURIComponent(rowId) }/attachments`,
      method: 'post',
      body: clean({ attachmentType: 'LINK', url, name }),
    })
  }

  /**
   * @operationName Attach File to Row
   * @category Attachments
   * @description Uploads a FlowRunner file as a file attachment on a row using Smartsheet's simple upload (raw request body with a Content-Disposition filename). Returns the created attachment record with its Smartsheet ID.
   * @route POST /attach-file
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the row."}
   * @paramDef {"type":"Number","label":"Row ID","name":"rowId","required":true,"description":"ID of the row to attach the file to."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The FlowRunner file to upload (its URL). The file's bytes are sent to Smartsheet."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name for the attachment, e.g. Report.pdf. Defaults to the source file name."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"MIME type of the file, e.g. application/pdf. Defaults to application/octet-stream."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Report.pdf","attachmentType":"FILE","mimeType":"application/pdf","sizeInKb":120,"parentType":"ROW","parentId":6572427401553796,"createdAt":"2024-06-01T12:00:00Z"}
   */
  async attachFileToRow(sheetId, rowId, fileUrl, fileName, contentType) {
    const fileBytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes)
    const resolvedName = fileName ||
      decodeURIComponent(String(fileUrl).split('/').pop().split('?')[0]) ||
      `attachment_${ Date.now() }`

    return await this.#apiRequest({
      logTag: '[attachFileToRow]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/${ encodeURIComponent(rowId) }/attachments`,
      method: 'post',
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${ encodeURIComponent(resolvedName) }"`,
        'Content-Length': buffer.length,
      },
      body: buffer,
    })
  }

  /**
   * @operationName Get Attachment
   * @category Attachments
   * @description Retrieves an attachment's metadata including a temporary download URL. The url field expires after urlExpiresInMillis (about 2 minutes) — fetch it immediately, or use Download Attachment to save the file to FlowRunner storage instead.
   * @route GET /attachment
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the attachment."}
   * @paramDef {"type":"Number","label":"Attachment ID","name":"attachmentId","required":true,"description":"ID of the attachment (from List Attachments)."}
   * @returns {Object}
   * @sampleResult {"id":4583173393803140,"name":"Report.pdf","attachmentType":"FILE","mimeType":"application/pdf","sizeInKb":120,"url":"https://s3.amazonaws.com/SmartsheetB/xyz","urlExpiresInMillis":120000}
   */
  async getAttachment(sheetId, attachmentId) {
    return await this.#apiRequest({
      logTag: '[getAttachment]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/attachments/${ encodeURIComponent(attachmentId) }`,
    })
  }

  /**
   * @operationName Download Attachment
   * @category Attachments
   * @description Downloads a file attachment's bytes from Smartsheet and saves them to FlowRunner file storage, returning a stable download URL. Use this instead of Get Attachment when a later step needs the file, since Smartsheet's own download URLs expire after about 2 minutes. Only FILE attachments can be downloaded (not LINK attachments).
   * @route POST /download-attachment
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the attachment."}
   * @paramDef {"type":"Number","label":"Attachment ID","name":"attachmentId","required":true,"description":"ID of the attachment (from List Attachments)."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","description":"Name for the saved file. Defaults to the attachment's own name."}
   * @paramDef {"type":"FilesUploadOptions","label":"File Settings","name":"fileOptions","required":false,"include":["scope"],"description":"Where to store the downloaded file: FLOW (default), WORKSPACE, or EXECUTION scope."}
   * @returns {Object}
   * @sampleResult {"fileURL":"https://files.flowrunner.com/abc/Report.pdf","filename":"Report.pdf","sizeBytes":123456,"mimeType":"application/pdf","attachmentType":"FILE"}
   */
  async downloadAttachment(sheetId, attachmentId, fileName, fileOptions) {
    const attachment = await this.#apiRequest({
      logTag: '[downloadAttachment]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/attachments/${ encodeURIComponent(attachmentId) }`,
    })

    if (!attachment.url) {
      throw new Error(`Smartsheet API error: attachment ${ attachmentId } has no downloadable URL (attachmentType ${ attachment.attachmentType }). Only FILE attachments can be downloaded.`)
    }

    // The returned URL is a pre-signed, short-lived link — no Authorization header needed.
    const bytes = await Flowrunner.Request.get(attachment.url).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    const filename = fileName || attachment.name || `attachment_${ attachmentId }`

    const saved = await this.#saveToFiles(buffer, filename, fileOptions)

    return {
      ...saved,
      mimeType: attachment.mimeType,
      attachmentType: attachment.attachmentType,
    }
  }

  /**
   * @operationName Delete Attachment
   * @category Attachments
   * @description Permanently deletes an attachment from a sheet. For files with multiple versions, this deletes all versions.
   * @route DELETE /attachment
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the attachment."}
   * @paramDef {"type":"Number","label":"Attachment ID","name":"attachmentId","required":true,"description":"ID of the attachment to delete."}
   * @returns {Object}
   * @sampleResult {"message":"SUCCESS","resultCode":0}
   */
  async deleteAttachment(sheetId, attachmentId) {
    return await this.#apiRequest({
      logTag: '[deleteAttachment]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/attachments/${ encodeURIComponent(attachmentId) }`,
      method: 'delete',
    })
  }

  // ==================== Discussions ====================

  /**
   * @operationName List Discussions
   * @category Discussions
   * @description Lists all discussions on a sheet, both sheet-level and row-level. Enable Include Comments to embed each discussion's full comment thread in the response.
   * @route GET /discussions
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet whose discussions to list."}
   * @paramDef {"type":"Boolean","label":"Include Comments","name":"includeComments","uiComponent":{"type":"TOGGLE"},"description":"Embed the full comment thread of each discussion in the response."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Discussions per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":3138415114905476,"title":"Timeline question","commentCount":2,"lastCommentedAt":"2024-06-01T12:00:00Z","lastCommentedUser":{"name":"Jane Doe","email":"jane@example.com"},"parentType":"ROW","parentId":6572427401553796}]}
   */
  async listDiscussions(sheetId, includeComments, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listDiscussions]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/discussions`,
      query: {
        include: includeComments === true ? 'comments' : undefined,
        page,
        pageSize,
      },
    })
  }

  /**
   * @operationName Create Discussion on Row
   * @category Discussions
   * @description Starts a new discussion thread on a row with an initial comment. The discussion appears in the row's conversation panel in Smartsheet. Returns the created discussion including the first comment.
   * @route POST /row-discussion
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the row."}
   * @paramDef {"type":"Number","label":"Row ID","name":"rowId","required":true,"description":"ID of the row to start the discussion on."}
   * @paramDef {"type":"String","label":"Comment Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the initial comment."}
   * @returns {Object}
   * @sampleResult {"id":3138415114905476,"title":"Can we push the deadline?","comments":[{"id":1230681328977796,"text":"Can we push the deadline?","createdBy":{"name":"Jane Doe","email":"jane@example.com"},"createdAt":"2024-06-01T12:00:00Z"}],"parentType":"ROW","parentId":6572427401553796}
   */
  async createRowDiscussion(sheetId, rowId, text) {
    return await this.#apiRequest({
      logTag: '[createRowDiscussion]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/rows/${ encodeURIComponent(rowId) }/discussions`,
      method: 'post',
      body: { comment: { text } },
    })
  }

  /**
   * @operationName Create Discussion on Sheet
   * @category Discussions
   * @description Starts a new sheet-level discussion thread with an initial comment. Sheet discussions are not tied to a specific row. Returns the created discussion including the first comment.
   * @route POST /sheet-discussion
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to start the discussion on."}
   * @paramDef {"type":"String","label":"Comment Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the initial comment."}
   * @returns {Object}
   * @sampleResult {"id":3138415114905476,"title":"Kickoff notes","comments":[{"id":1230681328977796,"text":"Kickoff notes","createdBy":{"name":"Jane Doe","email":"jane@example.com"},"createdAt":"2024-06-01T12:00:00Z"}],"parentType":"SHEET","parentId":4583173393803140}
   */
  async createSheetDiscussion(sheetId, text) {
    return await this.#apiRequest({
      logTag: '[createSheetDiscussion]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/discussions`,
      method: 'post',
      body: { comment: { text } },
    })
  }

  /**
   * @operationName Add Comment
   * @category Discussions
   * @description Adds a comment to an existing discussion thread. Returns the created comment with its author and timestamp.
   * @route POST /comment
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the discussion."}
   * @paramDef {"type":"Number","label":"Discussion ID","name":"discussionId","required":true,"description":"ID of the discussion to comment on (from List Discussions)."}
   * @paramDef {"type":"String","label":"Comment Text","name":"text","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Text of the comment."}
   * @returns {Object}
   * @sampleResult {"id":1230681328977796,"text":"Agreed, let's move it to Friday.","createdBy":{"name":"Jane Doe","email":"jane@example.com"},"createdAt":"2024-06-01T12:00:00Z"}
   */
  async addComment(sheetId, discussionId, text) {
    return await this.#apiRequest({
      logTag: '[addComment]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/discussions/${ encodeURIComponent(discussionId) }/comments`,
      method: 'post',
      body: { text },
    })
  }

  /**
   * @operationName Delete Discussion
   * @category Discussions
   * @description Permanently deletes a discussion thread and all of its comments and comment attachments from a sheet.
   * @route DELETE /discussion
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet containing the discussion."}
   * @paramDef {"type":"Number","label":"Discussion ID","name":"discussionId","required":true,"description":"ID of the discussion to delete."}
   * @returns {Object}
   * @sampleResult {"message":"SUCCESS","resultCode":0}
   */
  async deleteDiscussion(sheetId, discussionId) {
    return await this.#apiRequest({
      logTag: '[deleteDiscussion]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/discussions/${ encodeURIComponent(discussionId) }`,
      method: 'delete',
    })
  }

  // ==================== Workspaces & Folders ====================

  /**
   * @operationName List Workspaces
   * @category Workspaces & Folders
   * @description Lists all workspaces the token's user can access, with id, name, access level, and permalink. Results are paginated.
   * @route GET /workspaces
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Workspaces per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":7116448184199044,"name":"Marketing","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/workspaces/xyz"}]}
   */
  async listWorkspaces(page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listWorkspaces]',
      path: '/workspaces',
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Get Workspace
   * @category Workspaces & Folders
   * @description Retrieves a workspace and lists its contents — sheets, folders, reports, dashboards, and templates. By default only top-level items are returned; enable Load All to include the full nested folder hierarchy.
   * @route GET /workspace
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to retrieve."}
   * @paramDef {"type":"Boolean","label":"Load All","name":"loadAll","uiComponent":{"type":"TOGGLE"},"description":"Return the complete nested contents of all folders instead of only top-level items."}
   * @returns {Object}
   * @sampleResult {"id":7116448184199044,"name":"Marketing","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/workspaces/xyz","sheets":[{"id":4583173393803140,"name":"Campaign Tracker","permalink":"https://app.smartsheet.com/sheets/abc123"}],"folders":[{"id":7960873114331012,"name":"Q3","permalink":"https://app.smartsheet.com/folders/qrs"}]}
   */
  async getWorkspace(workspaceId, loadAll) {
    return await this.#apiRequest({
      logTag: '[getWorkspace]',
      path: `/workspaces/${ encodeURIComponent(workspaceId) }`,
      query: { loadAll: loadAll === true ? true : undefined },
    })
  }

  /**
   * @operationName Create Workspace
   * @category Workspaces & Folders
   * @description Creates a new empty workspace owned by the token's user. Returns the workspace with its generated ID and permalink.
   * @route POST /workspaces
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new workspace."}
   * @returns {Object}
   * @sampleResult {"id":7116448184199044,"name":"Product Launch","accessLevel":"OWNER","permalink":"https://app.smartsheet.com/workspaces/xyz"}
   */
  async createWorkspace(name) {
    return await this.#apiRequest({
      logTag: '[createWorkspace]',
      path: '/workspaces',
      method: 'post',
      body: { name },
    })
  }

  /**
   * @operationName List Home Folders
   * @category Workspaces & Folders
   * @description Lists the folders in the user's Sheets (home) area — the personal space outside of workspaces. Results are paginated.
   * @route GET /home-folders
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Folders per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":7960873114331012,"name":"Projects","permalink":"https://app.smartsheet.com/folders/qrs"}]}
   */
  async listHomeFolders(page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listHomeFolders]',
      path: '/home/folders',
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Get Folder
   * @category Workspaces & Folders
   * @description Retrieves a folder and lists its contents — sheets, subfolders, reports, dashboards, and templates. Works for folders in the home area and in workspaces.
   * @route GET /folder
   * @paramDef {"type":"Number","label":"Folder ID","name":"folderId","required":true,"description":"ID of the folder to retrieve (from List Home Folders or Get Workspace)."}
   * @returns {Object}
   * @sampleResult {"id":7960873114331012,"name":"Projects","permalink":"https://app.smartsheet.com/folders/qrs","sheets":[{"id":4583173393803140,"name":"Project Tracker","permalink":"https://app.smartsheet.com/sheets/abc123"}],"folders":[]}
   */
  async getFolder(folderId) {
    return await this.#apiRequest({
      logTag: '[getFolder]',
      path: `/folders/${ encodeURIComponent(folderId) }`,
    })
  }

  /**
   * @operationName Create Folder in Workspace
   * @category Workspaces & Folders
   * @description Creates a new folder at the top level of a workspace. Returns the folder with its generated ID and permalink.
   * @route POST /workspace-folder
   * @paramDef {"type":"String","label":"Workspace","name":"workspaceId","required":true,"dictionary":"getWorkspacesDictionary","description":"The workspace to create the folder in."}
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new folder."}
   * @returns {Object}
   * @sampleResult {"id":7960873114331012,"name":"Q3 Reports","permalink":"https://app.smartsheet.com/folders/qrs"}
   */
  async createFolderInWorkspace(workspaceId, name) {
    return await this.#apiRequest({
      logTag: '[createFolderInWorkspace]',
      path: `/workspaces/${ encodeURIComponent(workspaceId) }/folders`,
      method: 'post',
      body: { name },
    })
  }

  // ==================== Reports ====================

  /**
   * @operationName List Reports
   * @category Reports
   * @description Lists all reports the token's user can access, with id, name, access level, and permalink. Results are paginated.
   * @route GET /reports
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Reports per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":6631308103076740,"name":"Weekly Status","accessLevel":"VIEWER","permalink":"https://app.smartsheet.com/reports/wxyz"}]}
   */
  async listReports(page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listReports]',
      path: '/reports',
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Get Report
   * @category Reports
   * @description Retrieves a report with its columns and aggregated rows pulled from the source sheets. Each row includes a sheetId identifying which source sheet it came from. Rows are paginated with Page and Page Size.
   * @route GET /report
   * @paramDef {"type":"String","label":"Report","name":"reportId","required":true,"dictionary":"getReportsDictionary","description":"The report to retrieve."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page of rows to return. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Rows per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"id":6631308103076740,"name":"Weekly Status","totalRowCount":25,"accessLevel":"VIEWER","columns":[{"virtualId":7960873114331012,"title":"Task Name","type":"TEXT_NUMBER"}],"rows":[{"id":1234567890123456,"sheetId":4583173393803140,"rowNumber":1,"cells":[{"virtualColumnId":7960873114331012,"value":"Design mockups","displayValue":"Design mockups"}]}]}
   */
  async getReport(reportId, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[getReport]',
      path: `/reports/${ encodeURIComponent(reportId) }`,
      query: { page, pageSize },
    })
  }

  // ==================== Search ====================

  /**
   * @operationName Search Sheet
   * @category Search
   * @description Performs a full-text search within a single sheet and returns matching rows with context. Each result carries the objectId (row ID) and parentObjectId (sheet ID), which can be fed into Get Row.
   * @route GET /search-sheet
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet to search in."}
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Text to search for. Wrap the text in double quotes for an exact phrase match."}
   * @returns {Object}
   * @sampleResult {"results":[{"objectType":"row","objectId":6572427401553796,"text":"Design mockups","contextData":["Row 1"],"parentObjectType":"sheet","parentObjectId":4583173393803140,"parentObjectName":"Project Tracker"}],"totalCount":1}
   */
  async searchSheet(sheetId, query) {
    return await this.#apiRequest({
      logTag: '[searchSheet]',
      path: `/search/sheets/${ encodeURIComponent(sheetId) }`,
      query: { query },
    })
  }

  /**
   * @operationName Search Everything
   * @category Search
   * @description Performs a full-text search across all Smartsheet content the user can access — sheet names, cell data, comments, attachments, folder/workspace names, and more. Narrow the search with Scopes. Each result identifies the matching object and its parent so follow-up actions can fetch it.
   * @route GET /search
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Text to search for. Wrap the text in double quotes for an exact phrase match."}
   * @paramDef {"type":"Array<String>","label":"Scopes","name":"scopes","uiComponent":{"type":"DROPDOWN","options":{"values":["Attachments","Cell Data","Comments","Folder Names","Report Names","Sheet Names","Dashboard Names","Summary Fields","Template Names","Workspace Names"]}},"description":"Limit the search to these content types. Empty searches everything."}
   * @returns {Object}
   * @sampleResult {"results":[{"objectType":"sheet","objectId":4583173393803140,"text":"Project Tracker","contextData":["Project Tracker"]}],"totalCount":1}
   */
  async searchEverything(query, scopes) {
    return await this.#apiRequest({
      logTag: '[searchEverything]',
      path: '/search',
      query: {
        query,
        scopes: this.#resolveChoices(scopes, SEARCH_SCOPE_MAP)?.join(','),
      },
    })
  }

  // ==================== Users & Contacts ====================

  /**
   * @operationName Get Current User
   * @category Users & Contacts
   * @description Retrieves the profile of the user who owns the access token — email, name, locale, admin and licensing flags, and account info. Useful for verifying the connection and identifying the acting user.
   * @route GET /current-user
   * @returns {Object}
   * @sampleResult {"id":48569348493401200,"email":"jane@example.com","firstName":"Jane","lastName":"Doe","locale":"en_US","timeZone":"US/Pacific","admin":true,"licensedSheetCreator":true,"account":{"id":995857,"name":"Acme Corp"}}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      logTag: '[getCurrentUser]',
      path: '/users/me',
    })
  }

  /**
   * @operationName List Users
   * @category Users & Contacts
   * @description Lists the users in the organization account. Requires system administrator rights on the Smartsheet account. Optionally filter to specific email addresses. Results are paginated.
   * @route GET /users
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Comma-separated list of email addresses to filter on."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Users per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":2,"data":[{"id":48569348493401200,"email":"jane@example.com","firstName":"Jane","lastName":"Doe","admin":false,"licensedSheetCreator":true,"status":"ACTIVE"}]}
   */
  async listUsers(email, page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listUsers]',
      path: '/users',
      query: { email, page, pageSize },
    })
  }

  /**
   * @operationName List Contacts
   * @category Users & Contacts
   * @description Lists the user's personal contacts from their Smartsheet Contact List. Contact emails are valid values for Contact List columns and for Create Update Request recipients. Results are paginated.
   * @route GET /contacts
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Contacts per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":"AAAAATYU54QAD7_fNhTnhA","name":"John Smith","email":"john@example.com"}]}
   */
  async listContacts(page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listContacts]',
      path: '/contacts',
      query: { page, pageSize },
    })
  }

  // ==================== Update Requests ====================

  /**
   * @operationName Create Update Request
   * @category Update Requests
   * @description Sends an update-request email asking recipients to edit specific rows of a sheet. Recipients get a link to a form limited to the chosen rows (and optionally chosen columns) and do not need a Smartsheet license to respond. Returns the created update request.
   * @route POST /update-request
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet whose rows should be updated."}
   * @paramDef {"type":"Array<Number>","label":"Row IDs","name":"rowIds","required":true,"description":"IDs of the rows the recipients are asked to update."}
   * @paramDef {"type":"Array<String>","label":"Send To","name":"sendTo","required":true,"description":"Recipient email addresses."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","description":"Email subject line. Smartsheet generates one when empty."}
   * @paramDef {"type":"String","label":"Message","name":"message","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Email body text shown above the update link."}
   * @paramDef {"type":"Array<Number>","label":"Column IDs","name":"columnIds","description":"Limit the editable columns to these. Empty lets recipients edit all columns."}
   * @paramDef {"type":"Boolean","label":"Include Attachments","name":"includeAttachments","uiComponent":{"type":"TOGGLE"},"description":"Let recipients view and add row attachments."}
   * @paramDef {"type":"Boolean","label":"Include Discussions","name":"includeDiscussions","uiComponent":{"type":"TOGGLE"},"description":"Let recipients view and add row comments."}
   * @returns {Object}
   * @sampleResult {"id":8064037739521924,"sentBy":{"name":"Jane Doe","email":"jane@example.com"},"subject":"Update Request: Project Tracker","message":"Please update your task status.","sendTo":[{"email":"john@example.com"}],"rowIds":[6572427401553796],"columnIds":[642523719853956],"includeAttachments":false,"includeDiscussions":false}
   */
  async createUpdateRequest(sheetId, rowIds, sendTo, subject, message, columnIds, includeAttachments, includeDiscussions) {
    return await this.#apiRequest({
      logTag: '[createUpdateRequest]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/updaterequests`,
      method: 'post',
      body: clean({
        rowIds: toIdList(rowIds),
        columnIds: toIdList(columnIds),
        includeAttachments,
        includeDiscussions,
        sendTo: (sendTo || []).map(recipient => ({ email: recipient })),
        subject,
        message,
      }),
    })
  }

  // ==================== Webhooks ====================

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Lists all webhooks owned by the token's user, with their scope, target sheet, callback URL, enabled flag, and status. Results are paginated.
   * @route GET /webhooks
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"1-based page number. Defaults to 1."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Webhooks per page. Defaults to 100."}
   * @returns {Object}
   * @sampleResult {"pageNumber":1,"pageSize":100,"totalPages":1,"totalCount":1,"data":[{"id":123456789012345,"name":"Row watcher","scope":"sheet","scopeObjectId":4583173393803140,"events":["*.*"],"callbackUrl":"https://example.com/hook","enabled":true,"status":"ENABLED","version":1}]}
   */
  async listWebhooks(page, pageSize) {
    return await this.#apiRequest({
      logTag: '[listWebhooks]',
      path: '/webhooks',
      query: { page, pageSize },
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a webhook that notifies a callback URL about all changes (*.* events) on a sheet. The webhook is created disabled with status NEW_NOT_VERIFIED — call Set Webhook Status to enable it, which starts Smartsheet's verification handshake: the callback endpoint must echo the Smartsheet-Hook-Challenge header value back (in a Smartsheet-Hook-Response header or a smartsheetHookResponse JSON body field) before events flow.
   * @route POST /webhooks
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Descriptive name for the webhook."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","required":true,"description":"HTTPS endpoint that receives event payloads. Must answer the verification challenge when the webhook is enabled."}
   * @paramDef {"type":"String","label":"Sheet","name":"sheetId","required":true,"dictionary":"getSheetsDictionary","description":"The sheet the webhook watches."}
   * @returns {Object}
   * @sampleResult {"id":123456789012345,"name":"Row watcher","scope":"sheet","scopeObjectId":4583173393803140,"events":["*.*"],"callbackUrl":"https://example.com/hook","enabled":false,"status":"NEW_NOT_VERIFIED","version":1}
   */
  async createWebhook(name, callbackUrl, sheetId) {
    return await this.#apiRequest({
      logTag: '[createWebhook]',
      path: '/webhooks',
      method: 'post',
      body: {
        name,
        callbackUrl,
        scope: 'sheet',
        scopeObjectId: toId(sheetId),
        events: ['*.*'],
        version: 1,
      },
    })
  }

  /**
   * @operationName Set Webhook Status
   * @category Webhooks
   * @description Enables or disables a webhook. Enabling triggers Smartsheet's verification handshake: a challenge request is sent to the callback URL, and the endpoint must echo the Smartsheet-Hook-Challenge header value back (in a Smartsheet-Hook-Response header or a smartsheetHookResponse JSON body field). If the endpoint does not respond correctly, the webhook stays disabled with a failure status.
   * @route PUT /webhook-status
   * @paramDef {"type":"Number","label":"Webhook ID","name":"webhookId","required":true,"description":"ID of the webhook (from List Webhooks or Create Webhook)."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"enabled","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"On to enable the webhook (starts the verification handshake), off to disable it."}
   * @returns {Object}
   * @sampleResult {"id":123456789012345,"name":"Row watcher","scope":"sheet","scopeObjectId":4583173393803140,"events":["*.*"],"callbackUrl":"https://example.com/hook","enabled":true,"status":"ENABLED","version":1}
   */
  async setWebhookStatus(webhookId, enabled) {
    return await this.#apiRequest({
      logTag: '[setWebhookStatus]',
      path: `/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'put',
      body: { enabled: enabled !== false },
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Permanently deletes a webhook. Smartsheet stops sending events to its callback URL immediately.
   * @route DELETE /webhook
   * @paramDef {"type":"Number","label":"Webhook ID","name":"webhookId","required":true,"description":"ID of the webhook to delete."}
   * @returns {Object}
   * @sampleResult {"message":"SUCCESS","resultCode":0}
   */
  async deleteWebhook(webhookId) {
    return await this.#apiRequest({
      logTag: '[deleteWebhook]',
      path: `/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'delete',
    })
  }

  // ==================== Dictionaries ====================

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sheets Dictionary
   * @description Lists the user's sheets for selection in sheet parameters. The option value is the sheet ID. Pages through the account 100 sheets at a time; the search text filters the current page by name.
   * @route POST /get-sheets-dictionary
   * @paramDef {"type":"getSheetsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Tracker","value":"4583173393803140","note":"Modified 2024-06-01T12:00:00Z"}],"cursor":"2"}
   */
  async getSheetsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getSheetsDictionary]',
      path: '/sheets',
      query: { page: cursor ? Number(cursor) : 1, pageSize: DICTIONARY_PAGE_SIZE },
    })

    const term = (search || '').toLowerCase()
    const sheets = (response.data || []).filter(sheet => !term || (sheet.name || '').toLowerCase().includes(term))

    return {
      items: sheets.map(sheet => ({
        label: sheet.name,
        value: String(sheet.id),
        note: sheet.modifiedAt ? `Modified ${ sheet.modifiedAt }` : undefined,
      })),
      cursor: response.pageNumber < response.totalPages ? String(response.pageNumber + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Columns Dictionary
   * @description Lists the columns of the selected sheet for column parameters. The option value is the column ID and the note shows the column type. Requires a sheet in the criteria; returns no options until one is chosen.
   * @route POST /get-columns-dictionary
   * @paramDef {"type":"getColumnsDictionary__payload","label":"Payload","name":"payload","description":"Search, pagination, and the sheet criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Task Name","value":"7960873114331012","note":"TEXT_NUMBER (primary)"}],"cursor":null}
   */
  async getColumnsDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const sheetId = criteria?.sheetId

    if (!sheetId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: '[getColumnsDictionary]',
      path: `/sheets/${ encodeURIComponent(sheetId) }/columns`,
      query: { page: cursor ? Number(cursor) : 1, pageSize: DICTIONARY_PAGE_SIZE },
    })

    const term = (search || '').toLowerCase()
    const columns = (response.data || []).filter(column => !term || (column.title || '').toLowerCase().includes(term))

    return {
      items: columns.map(column => ({
        label: column.title,
        value: String(column.id),
        note: `${ column.type }${ column.primary ? ' (primary)' : '' }`,
      })),
      cursor: response.pageNumber < response.totalPages ? String(response.pageNumber + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Workspaces Dictionary
   * @description Lists the user's workspaces for selection in workspace parameters. The option value is the workspace ID and the note shows the user's access level.
   * @route POST /get-workspaces-dictionary
   * @paramDef {"type":"getWorkspacesDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing","value":"7116448184199044","note":"OWNER"}],"cursor":null}
   */
  async getWorkspacesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getWorkspacesDictionary]',
      path: '/workspaces',
      query: { page: cursor ? Number(cursor) : 1, pageSize: DICTIONARY_PAGE_SIZE },
    })

    const term = (search || '').toLowerCase()
    const workspaces = (response.data || []).filter(workspace => !term || (workspace.name || '').toLowerCase().includes(term))

    return {
      items: workspaces.map(workspace => ({
        label: workspace.name,
        value: String(workspace.id),
        note: workspace.accessLevel,
      })),
      cursor: response.pageNumber < response.totalPages ? String(response.pageNumber + 1) : null,
    }
  }

  /**
   * @registerAs DICTIONARY
   * @operationName Get Reports Dictionary
   * @description Lists the user's reports for selection in report parameters. The option value is the report ID and the note shows the user's access level.
   * @route POST /get-reports-dictionary
   * @paramDef {"type":"getReportsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Weekly Status","value":"6631308103076740","note":"VIEWER"}],"cursor":null}
   */
  async getReportsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getReportsDictionary]',
      path: '/reports',
      query: { page: cursor ? Number(cursor) : 1, pageSize: DICTIONARY_PAGE_SIZE },
    })

    const term = (search || '').toLowerCase()
    const reports = (response.data || []).filter(report => !term || (report.name || '').toLowerCase().includes(term))

    return {
      items: reports.map(report => ({
        label: report.name,
        value: String(report.id),
        note: report.accessLevel,
      })),
      cursor: response.pageNumber < response.totalPages ? String(response.pageNumber + 1) : null,
    }
  }
}

Flowrunner.ServerCode.addService(Smartsheet, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Smartsheet API access token. Generate it in Smartsheet under Account -> Personal Settings -> API Access -> Generate new access token.',
  },
  {
    name: 'region',
    displayName: 'Region',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['US', 'EU', 'Gov'],
    defaultValue: 'US',
    required: false,
    shared: false,
    hint: 'Data region of your Smartsheet account: US (api.smartsheet.com), EU (api.smartsheet.eu), or Gov (api.smartsheetgov.com).',
  },
])
