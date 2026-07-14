const logger = {
  info: (...args) => console.log('[Formstack] info:', ...args),
  debug: (...args) => console.log('[Formstack] debug:', ...args),
  error: (...args) => console.log('[Formstack] error:', ...args),
  warn: (...args) => console.log('[Formstack] warn:', ...args),
}

const API_BASE_URL = 'https://www.formstack.com/api/v2'

const DEFAULT_PER_PAGE = 25
const MAX_SEEN_IDS = 200

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

/**
 * @integrationName Formstack
 * @integrationIcon /icon.png
 * @integrationTriggersScope SINGLE_APP
 */
class FormstackService {
  constructor(config) {
    this.accessToken = config.accessToken
  }

  // Single private request helper — all external calls go through here.
  async #apiRequest({ url, method = 'get', body, query, form, logTag }) {
    try {
      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({ 'Authorization': `Bearer ${ this.accessToken }` })
        .query(clean(query) || {})

      if (form !== undefined) {
        request.type('form')

        return await request.send(form)
      }

      if (body !== undefined) {
        request.set({ 'Content-Type': 'application/json' })

        return await request.send(body)
      }

      return await request
    } catch (error) {
      const message = error.body?.error || error.body?.message || error.message
      const status = error.body?.status

      logger.error(`${ logTag } - failed: ${ message }${ status ? ` (${ status })` : '' }`)

      throw new Error(`Formstack API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ============================== FORMS ==============================

  /**
   * @operationName List Forms
   * @category Forms
   * @description Retrieves the forms in your Formstack account, paginated. Optionally organizes the response by folders. Each form includes its id, name, submission counts, and public URL. Use a form id with Get Form to retrieve full field definitions.
   * @route GET /forms
   * @paramDef {"type":"Boolean","label":"Organize By Folders","name":"folders","uiComponent":{"type":"TOGGLE"},"description":"When enabled, groups the returned forms by folder instead of returning a flat list. Defaults to false."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of forms per page (max 100). Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"forms":[{"id":"2823451","name":"Contact Us","submissions":"142","last_submission_time":"2024-05-01 10:12:03","url":"https://myaccount.formstack.com/forms/contact_us"}],"total":1}
   */
  async listForms(folders, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listForms]',
      url: `${ API_BASE_URL }/form.json`,
      method: 'get',
      query: {
        folders: folders ? 1 : undefined,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Form
   * @category Forms
   * @description Retrieves a single form by id, including its full field definitions. The returned fields array maps each field id to its label and type — this mapping is how you interpret submission data, which stores values keyed by field id (see Get Submission).
   * @route GET /form
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to retrieve. Search and select a form, or provide an id directly."}
   * @returns {Object}
   * @sampleResult {"id":"2823451","name":"Contact Us","url":"https://myaccount.formstack.com/forms/contact_us","fields":[{"id":"48234501","label":"Full Name","type":"name"},{"id":"48234502","label":"Email","type":"email"}]}
   */
  async getForm(formId) {
    return await this.#apiRequest({
      logTag: '[getForm]',
      url: `${ API_BASE_URL }/form/${ formId }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Form
   * @category Forms
   * @description Creates a new form in your Formstack account with the given name. Optionally place it in a folder. The response includes the new form's id and edit URL; use Create Field to add fields to it.
   * @route POST /forms
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Name for the new form."}
   * @paramDef {"type":"String","label":"Folder ID","name":"folderId","dictionary":"getFoldersDictionary","description":"Optional folder to place the form in. Search and select a folder, or provide an id directly."}
   * @returns {Object}
   * @sampleResult {"id":"2891120","name":"New Lead Form","url":"https://myaccount.formstack.com/forms/new_lead_form","folder":"0"}
   */
  async createForm(name, folderId) {
    return await this.#apiRequest({
      logTag: '[createForm]',
      url: `${ API_BASE_URL }/form.json`,
      method: 'post',
      form: clean({ name, folder: folderId }),
    })
  }

  /**
   * @operationName Copy Form
   * @category Forms
   * @description Creates a duplicate of an existing form, including its fields and settings. The copy is created as a new form with its own id.
   * @route POST /forms/copy
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to copy. Search and select a form, or provide an id directly."}
   * @returns {Object}
   * @sampleResult {"id":"2891455","name":"Contact Us (Copy)","url":"https://myaccount.formstack.com/forms/contact_us_copy"}
   */
  async copyForm(formId) {
    return await this.#apiRequest({
      logTag: '[copyForm]',
      url: `${ API_BASE_URL }/form/${ formId }/copy.json`,
      method: 'post',
    })
  }

  /**
   * @operationName Delete Form
   * @category Forms
   * @description Permanently deletes a form and all of its submissions. This action cannot be undone.
   * @route DELETE /forms
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to delete. Search and select a form, or provide an id directly."}
   * @returns {Object}
   * @sampleResult {"success":"1"}
   */
  async deleteForm(formId) {
    return await this.#apiRequest({
      logTag: '[deleteForm]',
      url: `${ API_BASE_URL }/form/${ formId }.json`,
      method: 'delete',
    })
  }

  // ============================== SUBMISSIONS ==============================

  /**
   * @operationName List Submissions
   * @category Submissions
   * @description Retrieves submissions for a form, paginated and ordered by submission time. Filter by a time window (min/max time) or by a specific field's value (search field id + value). Enable "Include Data" to return the submitted field values; each value is keyed by field id — use Get Form or List Form Fields to map field ids to labels.
   * @route GET /submissions
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form whose submissions to list."}
   * @paramDef {"type":"String","label":"Min Time","name":"minTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return submissions on or after this date/time (account timezone, format YYYY-MM-DD HH:MM:SS)."}
   * @paramDef {"type":"String","label":"Max Time","name":"maxTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return submissions on or before this date/time (account timezone, format YYYY-MM-DD HH:MM:SS)."}
   * @paramDef {"type":"String","label":"Search Field ID","name":"searchFieldId","description":"Field id to filter submissions on. Must be paired with Search Value."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","description":"Value to match for the given Search Field ID."}
   * @paramDef {"type":"Boolean","label":"Include Data","name":"data","uiComponent":{"type":"TOGGLE"},"description":"When enabled, includes the submitted field values (keyed by field id) in each submission. Defaults to false."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page of results to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of submissions per page (max 100). Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"submissions":[{"id":"778812340","timestamp":"2024-05-01 10:12:03","user_agent":"Mozilla/5.0","remote_addr":"203.0.113.7","data":[{"field":"48234502","value":"jane@example.com"}]}],"total":1,"pages":1}
   */
  async listSubmissions(formId, minTime, maxTime, searchFieldId, searchValue, data, page, perPage) {
    return await this.#apiRequest({
      logTag: '[listSubmissions]',
      url: `${ API_BASE_URL }/form/${ formId }/submission.json`,
      method: 'get',
      query: {
        min_time: minTime,
        max_time: maxTime,
        search_field_id: searchFieldId,
        search_value: searchValue,
        data: data ? 1 : 0,
        page: page || 1,
        per_page: perPage || DEFAULT_PER_PAGE,
      },
    })
  }

  /**
   * @operationName Get Submission
   * @category Submissions
   * @description Retrieves a single submission by id, including its field values. Each value is returned keyed by field id — use Get Form or List Form Fields to map those field ids to human-readable labels.
   * @route GET /submissions/get
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"Identifier of the submission to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":"778812340","form":"2823451","timestamp":"2024-05-01 10:12:03","user_agent":"Mozilla/5.0","remote_addr":"203.0.113.7","data":[{"field":"48234501","value":"Jane Doe"},{"field":"48234502","value":"jane@example.com"}]}
   */
  async getSubmission(submissionId) {
    return await this.#apiRequest({
      logTag: '[getSubmission]',
      url: `${ API_BASE_URL }/submission/${ submissionId }.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Submission
   * @category Submissions
   * @description Creates a new submission for a form. Provide the field values as an array of objects, each with a field id and a value (e.g. {"field":"48234502","value":"jane@example.com"}). Field ids come from Get Form or List Form Fields. Values are submitted to the API as field_{id}=value pairs.
   * @route POST /submissions
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to submit to."}
   * @paramDef {"type":"Array<Object>","label":"Field Values","name":"fieldValues","required":true,"description":"Array of {field, value} objects. Each object's field is a Formstack field id (from Get Form) and value is the submitted value."}
   * @returns {Object}
   * @sampleResult {"id":"778813001","timestamp":"2024-05-02 09:00:00"}
   */
  async createSubmission(formId, fieldValues) {
    const form = {}

    for (const entry of fieldValues || []) {
      if (entry && entry.field !== undefined && entry.field !== null) {
        form[`field_${ entry.field }`] = entry.value
      }
    }

    return await this.#apiRequest({
      logTag: '[createSubmission]',
      url: `${ API_BASE_URL }/form/${ formId }/submission.json`,
      method: 'post',
      form,
    })
  }

  /**
   * @operationName Delete Submission
   * @category Submissions
   * @description Permanently deletes a submission by id. This action cannot be undone.
   * @route DELETE /submissions
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"Identifier of the submission to delete."}
   * @returns {Object}
   * @sampleResult {"success":"1"}
   */
  async deleteSubmission(submissionId) {
    return await this.#apiRequest({
      logTag: '[deleteSubmission]',
      url: `${ API_BASE_URL }/submission/${ submissionId }.json`,
      method: 'delete',
    })
  }

  // ============================== FIELDS ==============================

  /**
   * @operationName List Form Fields
   * @category Fields
   * @description Retrieves the field definitions for a form. Each field includes its id, label, and type. This mapping of field id to label is essential for interpreting submission data, which stores values keyed by field id.
   * @route GET /fields
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form whose fields to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"48234501","label":"Full Name","type":"name","required":"1"},{"id":"48234502","label":"Email","type":"email","required":"0"}]
   */
  async listFormFields(formId) {
    return await this.#apiRequest({
      logTag: '[listFormFields]',
      url: `${ API_BASE_URL }/form/${ formId }/field.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Field
   * @category Fields
   * @description Adds a new field to a form. Choose a field type and provide a label. Returns the created field including its new id, which you can then use when creating submissions.
   * @route POST /fields
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to add the field to."}
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Text","Textarea","Name","Email","Phone","Address","Select","Radio","Checkbox","Number","File","Date","Rich Text","Section Heading"]}},"description":"Type of field to create."}
   * @paramDef {"type":"String","label":"Label","name":"label","required":true,"description":"Display label for the new field."}
   * @returns {Object}
   * @sampleResult {"id":"48239900","label":"Company","type":"text","required":"0"}
   */
  async createField(formId, fieldType, label) {
    const resolvedType = this.#resolveChoice(fieldType, {
      'Text': 'text',
      'Textarea': 'textarea',
      'Name': 'name',
      'Email': 'email',
      'Phone': 'phone',
      'Address': 'address',
      'Select': 'select',
      'Radio': 'radio',
      'Checkbox': 'checkbox',
      'Number': 'number',
      'File': 'file',
      'Date': 'datetime',
      'Rich Text': 'richtext',
      'Section Heading': 'section',
    })

    return await this.#apiRequest({
      logTag: '[createField]',
      url: `${ API_BASE_URL }/form/${ formId }/field.json`,
      method: 'post',
      form: clean({ field_type: resolvedType, label }),
    })
  }

  // ============================== FOLDERS ==============================

  /**
   * @operationName List Folders
   * @category Folders
   * @description Retrieves the form folders in your Formstack account. Each folder includes its id and name. Use a folder id to filter forms or to place a new form in a folder.
   * @route GET /folders
   * @returns {Object}
   * @sampleResult {"folders":[{"id":"84512","name":"Marketing","parent":"0"},{"id":"84513","name":"HR","parent":"0"}]}
   */
  async listFolders() {
    return await this.#apiRequest({
      logTag: '[listFolders]',
      url: `${ API_BASE_URL }/folder.json`,
      method: 'get',
    })
  }

  // ============================== WEBHOOKS ==============================

  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Retrieves the webhooks configured for a form. Each webhook includes its id and target URL. Webhooks notify an external URL each time the form receives a new submission.
   * @route GET /webhooks
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form whose webhooks to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"55123","url":"https://example.com/hooks/formstack","form_id":"2823451"}]
   */
  async listWebhooks(formId) {
    return await this.#apiRequest({
      logTag: '[listWebhooks]',
      url: `${ API_BASE_URL }/form/${ formId }/webhook.json`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a webhook on a form. Formstack will POST the submission payload to the given URL each time the form receives a new submission. Returns the created webhook including its id.
   * @route POST /webhooks
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to attach the webhook to."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Endpoint that Formstack will POST submission data to on each new submission."}
   * @returns {Object}
   * @sampleResult {"id":"55124","url":"https://example.com/hooks/formstack","form_id":"2823451"}
   */
  async createWebhook(formId, url) {
    return await this.#apiRequest({
      logTag: '[createWebhook]',
      url: `${ API_BASE_URL }/form/${ formId }/webhook.json`,
      method: 'post',
      form: clean({ url }),
    })
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Permanently removes a webhook by id. Formstack will stop notifying its URL of new submissions.
   * @route DELETE /webhooks
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"Identifier of the webhook to delete."}
   * @returns {Object}
   * @sampleResult {"success":"1"}
   */
  async deleteWebhook(webhookId) {
    return await this.#apiRequest({
      logTag: '[deleteWebhook]',
      url: `${ API_BASE_URL }/webhook/${ webhookId }.json`,
      method: 'delete',
    })
  }

  // ============================== CONFIRMATIONS ==============================

  /**
   * @operationName List Confirmations
   * @category Confirmations
   * @description Retrieves the confirmation (thank-you) messages configured for a form. Each confirmation includes its id, name, and message/redirect settings shown to a user after they submit the form.
   * @route GET /confirmations
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form whose confirmations to list."}
   * @returns {Array<Object>}
   * @sampleResult [{"id":"90321","name":"Default","type":"message","message":"Thanks for your submission!"}]
   */
  async listConfirmations(formId) {
    return await this.#apiRequest({
      logTag: '[listConfirmations]',
      url: `${ API_BASE_URL }/form/${ formId }/confirmation.json`,
      method: 'get',
    })
  }

  // ============================== DICTIONARIES ==============================

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name (matched client-side against the current page)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number to retrieve, as a string. Advances pagination through the account's forms."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Provides a selectable list of forms in the account for form-id parameters across the service. The option value is the form id.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing forms."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Contact Us","value":"2823451","note":"142 submissions"}],"cursor":"2"}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      logTag: '[getFormsDictionary]',
      url: `${ API_BASE_URL }/form.json`,
      method: 'get',
      query: { page, per_page: 100 },
    })

    const forms = Array.isArray(response.forms) ? response.forms : []
    const term = (search || '').toLowerCase()

    const items = forms
      .filter(form => !term || (form.name || '').toLowerCase().includes(term))
      .map(form => ({
        label: form.name || `Form ${ form.id }`,
        value: String(form.id),
        note: form.submissions !== undefined ? `${ form.submissions } submissions` : undefined,
      }))

    const nextCursor = forms.length === 100 ? String(page + 1) : undefined

    return { items, cursor: nextCursor }
  }

  /**
   * @typedef {Object} getFoldersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter folders by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Formstack returns all folders in one call, so this is unused but kept for API compatibility."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Folders Dictionary
   * @description Provides a selectable list of form folders in the account for folder-id parameters. The option value is the folder id.
   * @route POST /get-folders-dictionary
   * @paramDef {"type":"getFoldersDictionary__payload","label":"Payload","name":"payload","description":"Search text and pagination cursor for listing folders."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Marketing","value":"84512","note":"Folder"}],"cursor":null}
   */
  async getFoldersDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getFoldersDictionary]',
      url: `${ API_BASE_URL }/folder.json`,
      method: 'get',
    })

    const folders = Array.isArray(response.folders) ? response.folders : []
    const term = (search || '').toLowerCase()

    const items = folders
      .filter(folder => !term || (folder.name || '').toLowerCase().includes(term))
      .map(folder => ({
        label: folder.name || `Folder ${ folder.id }`,
        value: String(folder.id),
        note: 'Folder',
      }))

    return { items, cursor: null }
  }

  // ============================== POLLING TRIGGERS ==============================

  /**
   * @registerAs SYSTEM
   * @paramDef {"type":"Object","label":"invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerPollingForEvent(invocation) {
    return this[invocation.eventName](invocation)
  }

  /**
   * @operationName On New Submission
   * @category Submissions
   * @description Continuously monitors a Formstack form for new submissions and triggers downstream workflows for each one. Emits the raw submission object, including its field values keyed by field id (use Get Form or List Form Fields to map ids to labels). The first cycle only records a watermark and emits nothing, so the existing backlog is not replayed.
   * @registerAs POLLING_TRIGGER
   * @route POST /onNewSubmission
   * @executionTimeoutInSeconds 120
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"Identifier of the form to monitor for new submissions."}
   * @returns {Object} A newly received submission with its field values.
   * @sampleResult {"id":"778813200","form":"2823451","timestamp":"2024-05-02 09:00:00","user_agent":"Mozilla/5.0","remote_addr":"203.0.113.7","data":[{"field":"48234502","value":"jane@example.com"}]}
   */
  async onNewSubmission(invocation) {
    const { formId } = invocation.triggerData
    const state = invocation.state || {}

    if (invocation.learningMode) {
      const newest = await this.#getRecentSubmissions(formId, null)

      return { events: newest.slice(0, 1), state: null }
    }

    // First cycle: seed the watermark from the newest submission and emit nothing, so the
    // very first poll never dumps the whole backlog of existing submissions.
    if (state.since == null) {
      const recent = await this.#getRecentSubmissions(formId, null)
      const newestId = recent.length ? recent[0].id : null

      return { events: [], state: { since: Date.now(), seenIds: newestId ? [String(newestId)] : [] } }
    }

    const submissions = await this.#getRecentSubmissions(formId, null)
    const seen = new Set(state.seenIds || [])

    const events = submissions.filter(sub => !seen.has(String(sub.id)))
    const seenIds = [...submissions.map(sub => String(sub.id)), ...(state.seenIds || [])].slice(0, MAX_SEEN_IDS)

    return { events, state: { since: Date.now(), seenIds } }
  }

  // Newest-first submissions for a form (with field data), used by the polling trigger.
  async #getRecentSubmissions(formId, minTime) {
    const response = await this.#apiRequest({
      logTag: '[getRecentSubmissions]',
      url: `${ API_BASE_URL }/form/${ formId }/submission.json`,
      method: 'get',
      query: {
        data: 1,
        sort: 'DESC',
        min_time: minTime || undefined,
        per_page: 50,
        page: 1,
      },
    })

    return Array.isArray(response.submissions) ? response.submissions : []
  }
}

Flowrunner.ServerCode.addService(FormstackService, [
  {
    name: 'accessToken',
    displayName: 'Access Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Formstack personal Access Token (OAuth2 bearer token). In Formstack go to Account → API, create an app or generate a personal Access Token, and paste it here. Sent as "Authorization: Bearer <token>".',
  },
])
