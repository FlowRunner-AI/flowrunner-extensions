// ============================================================================
//  Tally — FlowRunner extension service
//  API: https://api.tally.so (Bearer auth, JSON)
//  Docs: https://developers.tally.so
//  Rate limit: ~100 requests per minute
// ============================================================================

const API_BASE_URL = 'https://api.tally.so'

const logger = {
  info: (...args) => console.log('[Tally] info:', ...args),
  debug: (...args) => console.log('[Tally] debug:', ...args),
  error: (...args) => console.log('[Tally] error:', ...args),
  warn: (...args) => console.log('[Tally] warn:', ...args),
}

const DICTIONARY_PAGE_SIZE = 100

const CALL_TYPES = {
  SHAPE_EVENT: 'SHAPE_EVENT',
  FILTER_TRIGGER: 'FILTER_TRIGGER',
}

// Friendly dropdown labels → Tally API values.
const FORM_STATUSES = {
  'Blank': 'BLANK',
  'Draft': 'DRAFT',
  'Published': 'PUBLISHED',
}

const SUBMISSION_FILTERS = {
  'All': 'all',
  'Completed': 'completed',
  'Partial': 'partial',
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

// ============================================================================
//  DICTIONARY PAYLOAD TYPEDEFS
// ============================================================================
/**
 * @typedef {Object} getFormsDictionary__payload
 * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter forms by name."}
 * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Page number for the next page of results."}
 */

/**
 * @integrationName Tally
 * @integrationIcon /icon.svg
 * @integrationTriggersScope SINGLE_APP
 */
class Tally {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  // ==========================================================================
  //  CORE — every external call goes through #apiRequest
  // ==========================================================================
  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - [${ method.toUpperCase() }::${ url }] q=${ JSON.stringify(cleanedQuery || {}) }`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': `Bearer ${ this.apiKey }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.error || error.message
      const status = error.status || error.statusCode

      logger.error(`${ logTag } - failed: ${ message }${ status ? ` (${ status })` : '' }`)

      throw new Error(`Tally API error: ${ message }`)
    }
  }

  // Maps a friendly dropdown label to its API value; passes unknown values through unchanged.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // ==========================================================================
  //  FORMS
  // ==========================================================================
  /**
   * @operationName List Forms
   * @category Forms
   * @description Retrieves the forms in your Tally account as a paginated list. Each form includes its id, name, workspace id, status (BLANK, DRAFT, PUBLISHED, or DELETED), submission count, and whether it is closed for new responses. Returns up to 500 forms per page (default 50) together with hasMore/total pagination metadata. Use a form id with Get Form to retrieve the full block structure.
   * @route GET /forms
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of forms per page (1-500). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"3xLKgo","name":"Customer Feedback","workspaceId":"w8yPz1","status":"PUBLISHED","numberOfSubmissions":42,"isClosed":false,"createdAt":"2026-05-01T09:30:00.000Z","updatedAt":"2026-06-10T14:00:00.000Z"}],"page":1,"limit":50,"total":1,"hasMore":false}
   */
  async listForms(page, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms`,
      method: 'get',
      query: { page, limit },
      logTag: 'listForms',
    })
  }

  /**
   * @operationName Get Form
   * @category Forms
   * @description Retrieves a single form by id, including its settings and the complete blocks structure (form title, question blocks, layout blocks, and their payloads). Use the blocks to understand the form layout or as a starting point for Update Form; use List Form Questions for a simpler question-focused view.
   * @route GET /forms/get
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to retrieve. Search and select a form, or provide a form id directly."}
   * @returns {Object}
   * @sampleResult {"id":"3xLKgo","name":"Customer Feedback","workspaceId":"w8yPz1","status":"PUBLISHED","numberOfSubmissions":42,"isClosed":false,"createdAt":"2026-05-01T09:30:00.000Z","updatedAt":"2026-06-10T14:00:00.000Z","settings":{"language":null,"isClosed":false},"blocks":[{"uuid":"6ef8675d-33cb-419b-a81e-93982e726f2e","type":"FORM_TITLE","groupUuid":"073c835f-7ad4-459c-866d-4108b6b7e2e1","groupType":"TEXT","payload":{"title":"Customer Feedback","html":"Customer Feedback"}}]}
   */
  async getForm(formId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }`,
      method: 'get',
      logTag: 'getForm',
    })
  }

  /**
   * @operationName Create Form
   * @category Forms
   * @description Creates a new form from an array of Tally blocks. The form name is derived from the FORM_TITLE block. Choose Published to make the form live immediately, Draft to keep unpublished draft blocks, or Blank for an empty shell. Optionally create the form in a specific workspace (defaults to your default workspace). Returns the created form's metadata including its id.
   * @route POST /forms
   * @paramDef {"type":"String","label":"Status","name":"status","required":true,"defaultValue":"Published","uiComponent":{"type":"DROPDOWN","options":{"values":["Blank","Draft","Published"]}},"description":"Initial status of the form. Published makes it live immediately."}
   * @paramDef {"type":"Array<Object>","label":"Blocks","name":"blocks","required":true,"description":"Array of raw Tally block objects following Tally's block model (see developers.tally.so/blocks-reference). Every block needs a unique uuid, a type, a groupUuid, a groupType, and a payload. Minimal example with just a form title: [{\"uuid\":\"6ef8675d-33cb-419b-a81e-93982e726f2e\",\"type\":\"FORM_TITLE\",\"groupUuid\":\"073c835f-7ad4-459c-866d-4108b6b7e2e1\",\"groupType\":\"TEXT\",\"payload\":{\"title\":\"My Form\",\"html\":\"My Form\"}}]"}
   * @paramDef {"type":"String","label":"Workspace ID","name":"workspaceId","description":"Optional id of the workspace to create the form in. Defaults to your default workspace. Use List Workspaces to find workspace ids."}
   * @returns {Object}
   * @sampleResult {"id":"m2fK5R","name":"My Form","workspaceId":"kb3o5R","organizationId":"atL65s","status":"PUBLISHED","hasDraftBlocks":false,"isClosed":false,"createdAt":"2026-06-10T10:34:19.262Z","updatedAt":"2026-06-10T10:34:19.262Z"}
   */
  async createForm(status, blocks, workspaceId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms`,
      method: 'post',
      body: clean({
        status: this.#resolveChoice(status, FORM_STATUSES),
        blocks,
        workspaceId,
      }),
      logTag: 'createForm',
    })
  }

  /**
   * @operationName Update Form
   * @category Forms
   * @description Updates a form's name and/or status. Set the status to Published to publish a draft form, or Draft/Blank to unpublish it. Only the provided properties are changed. Returns the updated form metadata.
   * @route PATCH /forms
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to update. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"Name","name":"name","description":"New name for the form. Leave empty to keep the current name."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Blank","Draft","Published"]}},"description":"New status for the form. Leave empty to keep the current status."}
   * @returns {Object}
   * @sampleResult {"id":"3xLKgo","name":"Customer Feedback 2.0","workspaceId":"w8yPz1","status":"PUBLISHED","numberOfSubmissions":42,"isClosed":false,"createdAt":"2026-05-01T09:30:00.000Z","updatedAt":"2026-06-12T08:00:00.000Z"}
   */
  async updateForm(formId, name, status) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }`,
      method: 'patch',
      body: clean({
        name,
        status: this.#resolveChoice(status, FORM_STATUSES),
      }),
      logTag: 'updateForm',
    })
  }

  /**
   * @operationName Delete Form
   * @category Forms
   * @description Deletes a form by id and moves it to the trash together with its submissions. The form can be restored from the trash in the Tally dashboard.
   * @route DELETE /forms
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to delete. Search and select a form, or provide a form id directly."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"formId":"3xLKgo"}
   */
  async deleteForm(formId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }`,
      method: 'delete',
      logTag: 'deleteForm',
    })

    return { deleted: true, formId }
  }

  // ==========================================================================
  //  QUESTIONS
  // ==========================================================================
  /**
   * @operationName List Form Questions
   * @category Questions
   * @description Retrieves all questions of a form, including each question's id, block type (e.g. INPUT_TEXT, INPUT_EMAIL, MULTIPLE_CHOICE), title, number of responses, and field definitions. Use this to map question ids to human-readable titles when interpreting submission responses.
   * @route GET /questions
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form whose questions to list. Search and select a form, or provide a form id directly."}
   * @returns {Object}
   * @sampleResult {"questions":[{"id":"q_abc123","type":"INPUT_EMAIL","title":"What is your email?","isTitleModifiedByUser":true,"formId":"3xLKgo","isDeleted":false,"numberOfResponses":42,"createdAt":"2026-05-01T09:30:00.000Z","updatedAt":"2026-06-10T14:00:00.000Z","fields":[]}],"hasResponses":true}
   */
  async listFormQuestions(formId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }/questions`,
      method: 'get',
      logTag: 'listFormQuestions',
    })
  }

  // ==========================================================================
  //  SUBMISSIONS
  // ==========================================================================
  /**
   * @operationName List Submissions
   * @category Submissions
   * @description Retrieves a paginated list of submissions for a form together with the form's questions, so answers (keyed by questionId) can be mapped to question titles. Filter by completion status (All, Completed, or Partial), by an ISO 8601 date window, or fetch only submissions received after a specific submission id (useful for incremental syncs). Returns up to 500 submissions per page (default 50) plus per-filter totals and hasMore pagination metadata. Each submission includes signed previewUrl/pdfUrl links.
   * @route GET /submissions
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form whose submissions to list. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"Filter","name":"filter","defaultValue":"All","uiComponent":{"type":"DROPDOWN","options":{"values":["All","Completed","Partial"]}},"description":"Which submissions to return: All, only Completed, or only Partial (in-progress) submissions. Defaults to All."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return submissions submitted on or after this date/time (ISO 8601 format)."}
   * @paramDef {"type":"String","label":"End Date","name":"endDate","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Only return submissions submitted on or before this date/time (ISO 8601 format)."}
   * @paramDef {"type":"String","label":"After Submission ID","name":"afterId","description":"Only return submissions received after the submission with this id. Useful for incremental processing."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of submissions per page (1-500). Defaults to 50."}
   * @returns {Object}
   * @sampleResult {"page":1,"limit":50,"hasMore":false,"totalNumberOfSubmissionsPerFilter":{"all":42,"completed":40,"partial":2},"questions":[{"id":"q_abc123","type":"INPUT_EMAIL","title":"What is your email?"}],"submissions":[{"id":"sub_123","formId":"3xLKgo","isCompleted":true,"submittedAt":"2026-06-10T14:00:00.000Z","previewUrl":"https://tally.so/r/preview","pdfUrl":"https://tally.so/r/pdf","responses":[{"id":"resp_1","formId":"3xLKgo","questionId":"q_abc123","respondentId":"resp_777","submissionId":"sub_123","sessionUuid":"7d4b7c5e-1111-2222-3333-444455556666","answer":"jane@example.com"}]}]}
   */
  async listSubmissions(formId, filter, startDate, endDate, afterId, page, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }/submissions`,
      method: 'get',
      query: {
        filter: this.#resolveChoice(filter, SUBMISSION_FILTERS),
        startDate,
        endDate,
        afterId,
        page,
        limit,
      },
      logTag: 'listSubmissions',
    })
  }

  /**
   * @operationName Get Submission
   * @category Submissions
   * @description Retrieves a single form submission by id, including all its responses (keyed by questionId) and the form's questions so answers can be mapped to question titles. Also returns signed previewUrl/pdfUrl links to view or download the submission.
   * @route GET /submissions/get
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form the submission belongs to. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The id of the submission to retrieve (from List Submissions or the On New Submission trigger)."}
   * @returns {Object}
   * @sampleResult {"questions":[{"id":"q_abc123","type":"INPUT_EMAIL","title":"What is your email?"}],"submission":{"id":"sub_123","formId":"3xLKgo","isCompleted":true,"submittedAt":"2026-06-10T14:00:00.000Z","createdAt":"2026-06-10T14:00:00.000Z","updatedAt":"2026-06-10T14:00:00.000Z","previewUrl":"https://tally.so/r/preview","pdfUrl":"https://tally.so/r/pdf","responses":[{"id":"resp_1","formId":"3xLKgo","questionId":"q_abc123","respondentId":"resp_777","submissionId":"sub_123","sessionUuid":"7d4b7c5e-1111-2222-3333-444455556666","answer":"jane@example.com","createdAt":"2026-06-10T14:00:00.000Z","updatedAt":"2026-06-10T14:00:00.000Z"}]}}
   */
  async getSubmission(formId, submissionId) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }/submissions/${ encodeURIComponent(submissionId) }`,
      method: 'get',
      logTag: 'getSubmission',
    })
  }

  /**
   * @operationName Delete Submission
   * @category Submissions
   * @description Permanently deletes a specific submission from a form. This action cannot be undone.
   * @route DELETE /submissions
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form the submission belongs to. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"Submission ID","name":"submissionId","required":true,"description":"The id of the submission to delete."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"formId":"3xLKgo","submissionId":"sub_123"}
   */
  async deleteSubmission(formId, submissionId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/forms/${ encodeURIComponent(formId) }/submissions/${ encodeURIComponent(submissionId) }`,
      method: 'delete',
      logTag: 'deleteSubmission',
    })

    return { deleted: true, formId, submissionId }
  }

  // ==========================================================================
  //  WEBHOOKS
  // ==========================================================================
  /**
   * @operationName List Webhooks
   * @category Webhooks
   * @description Retrieves a paginated list of all webhooks across your accessible forms and workspaces. Each webhook includes its id, form id, endpoint URL, subscribed event types, custom HTTP headers, and whether it is enabled. Returns up to 100 webhooks per page (default 25).
   * @route GET /webhooks
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of webhooks per page (1-100). Defaults to 25."}
   * @returns {Object}
   * @sampleResult {"webhooks":[{"id":"wh_123","formId":"3xLKgo","url":"https://example.com/hooks/tally","signingSecret":null,"httpHeaders":null,"eventTypes":["FORM_RESPONSE"],"externalSubscriber":null,"isEnabled":true,"lastSyncedAt":null,"createdAt":"2026-06-01T10:00:00.000Z","updatedAt":"2026-06-01T10:00:00.000Z"}],"page":1,"limit":25,"hasMore":false,"totalCount":1}
   */
  async listWebhooks(page, limit) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      method: 'get',
      query: { page, limit },
      logTag: 'listWebhooks',
    })
  }

  /**
   * @operationName Create Webhook
   * @category Webhooks
   * @description Creates a webhook on a form so Tally POSTs the submission payload to your endpoint each time the form receives a new submission (FORM_RESPONSE event). Optionally sign payloads with a signing secret and attach custom HTTP headers to each delivery. Returns the created webhook including its id. Use this to manage your own endpoints; to run FlowRunner flows on new submissions, use the On New Submission trigger instead.
   * @route POST /webhooks
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form to attach the webhook to. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Endpoint URL that Tally will POST submission data to on each new submission."}
   * @paramDef {"type":"String","label":"Signing Secret","name":"signingSecret","description":"Optional secret used to sign webhook payloads so your endpoint can verify they come from Tally."}
   * @paramDef {"type":"Array<Object>","label":"HTTP Headers","name":"httpHeaders","description":"Optional custom HTTP headers included in each webhook request, as objects with name and value properties, e.g. [{\"name\":\"X-Api-Key\",\"value\":\"secret\"}]."}
   * @returns {Object}
   * @sampleResult {"id":"wh_123","url":"https://example.com/hooks/tally","eventTypes":["FORM_RESPONSE"],"isEnabled":true,"createdAt":"2026-06-01T10:00:00.000Z"}
   */
  async createWebhook(formId, url, signingSecret, httpHeaders) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks`,
      method: 'post',
      body: clean({
        formId,
        url,
        eventTypes: ['FORM_RESPONSE'],
        signingSecret,
        httpHeaders,
      }),
      logTag: 'createWebhook',
    })
  }

  /**
   * @operationName Update Webhook
   * @category Webhooks
   * @description Updates an existing webhook's configuration. The Tally API requires the full configuration on update, so provide the form id and endpoint URL along with any changes. Toggle Enabled off to pause deliveries without deleting the webhook.
   * @route PATCH /webhooks
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The id of the webhook to update (from List Webhooks)."}
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The form the webhook is attached to. Search and select a form, or provide a form id directly."}
   * @paramDef {"type":"String","label":"URL","name":"url","required":true,"description":"Endpoint URL that Tally will POST submission data to."}
   * @paramDef {"type":"Boolean","label":"Enabled","name":"isEnabled","defaultValue":true,"uiComponent":{"type":"TOGGLE"},"description":"Whether the webhook is enabled. Turn off to pause deliveries. Defaults to enabled."}
   * @paramDef {"type":"String","label":"Signing Secret","name":"signingSecret","description":"Optional secret used to sign webhook payloads so your endpoint can verify they come from Tally."}
   * @paramDef {"type":"Array<Object>","label":"HTTP Headers","name":"httpHeaders","description":"Optional custom HTTP headers included in each webhook request, as objects with name and value properties, e.g. [{\"name\":\"X-Api-Key\",\"value\":\"secret\"}]."}
   * @returns {Object}
   * @sampleResult {"updated":true,"webhookId":"wh_123"}
   */
  async updateWebhook(webhookId, formId, url, isEnabled, signingSecret, httpHeaders) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'patch',
      body: {
        formId,
        url,
        eventTypes: ['FORM_RESPONSE'],
        isEnabled: isEnabled !== false,
        ...clean({ signingSecret, httpHeaders }),
      },
      logTag: 'updateWebhook',
    })

    return { updated: true, webhookId }
  }

  /**
   * @operationName Delete Webhook
   * @category Webhooks
   * @description Deletes a webhook by id so Tally stops sending submission events to its endpoint. If this is the last webhook for a form, Tally also marks the form's webhooks integration as deleted.
   * @route DELETE /webhooks
   * @paramDef {"type":"String","label":"Webhook ID","name":"webhookId","required":true,"description":"The id of the webhook to delete (from List Webhooks)."}
   * @returns {Object}
   * @sampleResult {"deleted":true,"webhookId":"wh_123"}
   */
  async deleteWebhook(webhookId) {
    await this.#apiRequest({
      url: `${ API_BASE_URL }/webhooks/${ encodeURIComponent(webhookId) }`,
      method: 'delete',
      logTag: 'deleteWebhook',
    })

    return { deleted: true, webhookId }
  }

  // ==========================================================================
  //  ACCOUNT
  // ==========================================================================
  /**
   * @operationName Get Current User
   * @category Account
   * @description Retrieves the profile of the user who owns the API key, including name, email, organization id, and subscription plan (FREE, PRO, or BUSINESS). Useful for verifying the connection and checking plan-dependent capabilities.
   * @route GET /users/me
   * @returns {Object}
   * @sampleResult {"id":"usr_123","firstName":"Jane","lastName":"Doe","fullName":"Jane Doe","email":"jane@example.com","avatarUrl":null,"organizationId":"atL65s","isDeleted":false,"hasTwoFactorEnabled":true,"subscriptionPlan":"PRO","createdAt":"2025-01-10T08:00:00.000Z","updatedAt":"2026-06-01T08:00:00.000Z"}
   */
  async getCurrentUser() {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/users/me`,
      method: 'get',
      logTag: 'getCurrentUser',
    })
  }

  /**
   * @operationName List Workspaces
   * @category Account
   * @description Retrieves a paginated list of the workspaces you have access to, including each workspace's id, name, members, and pending invites. Use a workspace id with Create Form to place new forms in a specific workspace.
   * @route GET /workspaces
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve (1-based). Defaults to 1."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":"w8yPz1","name":"Marketing","index":0,"members":[{"id":"usr_123","fullName":"Jane Doe","email":"jane@example.com"}],"invites":[],"createdByUserId":"usr_123","createdAt":"2025-01-10T08:00:00.000Z","updatedAt":"2026-06-01T08:00:00.000Z"}],"page":1,"limit":50,"total":1,"hasMore":false}
   */
  async listWorkspaces(page) {
    return await this.#apiRequest({
      url: `${ API_BASE_URL }/workspaces`,
      method: 'get',
      query: { page },
      logTag: 'listWorkspaces',
    })
  }

  // ==========================================================================
  //  REALTIME TRIGGER (SINGLE_APP — one Tally webhook per registered trigger)
  // ==========================================================================
  /**
   * @operationName On New Submission
   * @category Triggers
   * @description Fires in real time when the selected Tally form receives a new submission. Tally registers a webhook for the form and this trigger runs your flow with the raw submission data: responseId, submissionId, respondentId, formId, formName, createdAt, the raw fields array (each with key, label, type, and value), plus a flattened values map keyed by field label for easy access to answers.
   * @registerAs REALTIME_TRIGGER
   * @route POST /on-new-submission
   * @paramDef {"type":"String","label":"Form","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The Tally form to watch for new submissions. Search and select a form, or provide a form id directly."}
   * @returns {Object}
   * @sampleResult {"responseId":"aBcDeF","submissionId":"aBcDeF","respondentId":"xYz123","formId":"3xLKgo","formName":"Customer Feedback","createdAt":"2026-06-10T14:00:00.000Z","fields":[{"key":"question_abc123","label":"What is your email?","type":"INPUT_EMAIL","value":"jane@example.com"}],"values":{"What is your email?":"jane@example.com"}}
   */
  onNewSubmission(callType, payload) {
    if (callType === CALL_TYPES.SHAPE_EVENT) {
      return [{ name: 'onNewSubmission', data: this.#shapeSubmissionEvent(payload) }]
    }

    if (callType === CALL_TYPES.FILTER_TRIGGER) {
      const eventData = payload.eventData || payload.data || {}

      return {
        ids: (payload.triggers || [])
          .filter(trigger => String(trigger.data?.formId) === String(eventData.formId))
          .map(trigger => trigger.id),
      }
    }
  }

  // Resolves a Tally webhook delivery to the raw submission data object: the payload's `data`
  // (responseId, submissionId, respondentId, formId, formName, createdAt, fields[]) plus a
  // flattened { label: value } map for convenient access to individual answers.
  #shapeSubmissionEvent(rawEvent) {
    const data = rawEvent?.data || {}
    const values = {}

    for (const field of data.fields || []) {
      if (field && field.label !== undefined && field.label !== null) {
        values[field.label] = field.value
      }
    }

    return { ...data, values }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerUpsertWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerUpsertWebhook(invocation) {
    logger.debug(`handleTriggerUpsertWebhook - triggers: ${ (invocation.events || []).length }`)

    const separator = invocation.callbackUrl.includes('?') ? '&' : '?'
    const callbackUrl = `${ invocation.callbackUrl }${ separator }connectionId=${ invocation.connectionId }`
    const webhooks = []

    for (const event of invocation.events || []) {
      const formId = event.triggerData?.formId

      const created = await this.#apiRequest({
        url: `${ API_BASE_URL }/webhooks`,
        method: 'post',
        body: {
          formId,
          url: callbackUrl,
          eventTypes: ['FORM_RESPONSE'],
        },
        logTag: 'handleTriggerUpsertWebhook',
      })

      webhooks.push({ triggerId: event.id, webhookId: created?.id, formId })
    }

    return { webhookData: { webhooks }, connectionId: invocation.connectionId }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerResolveEvents
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerResolveEvents(invocation) {
    logger.debug('handleTriggerResolveEvents invoked')

    // Tally performs no verification handshake, but guard the empty-body case defensively.
    if (!invocation || !invocation.body) {
      return { handshake: true, responseToExternalService: invocation?.body || {} }
    }

    const connectionId = invocation.queryParams?.connectionId

    // Each delivery is a single event envelope: { eventId, eventType, createdAt, data }.
    const rawEvent = invocation.body
    const isFormResponse = rawEvent && typeof rawEvent === 'object' &&
      rawEvent.data && (!rawEvent.eventType || rawEvent.eventType === 'FORM_RESPONSE')

    const events = isFormResponse ? this.onNewSubmission(CALL_TYPES.SHAPE_EVENT, rawEvent) : []

    return { connectionId, events }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerSelectMatched
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerSelectMatched(invocation) {
    logger.debug(`handleTriggerSelectMatched.${ invocation.eventName }`)

    return this[invocation.eventName](CALL_TYPES.FILTER_TRIGGER, invocation)
  }

  /**
   * @registerAs SYSTEM
   * @route POST /handleTriggerDeleteWebhook
   * @paramDef {"type":"Object","label":"Invocation","name":"invocation"}
   * @returns {Object}
   */
  async handleTriggerDeleteWebhook(invocation) {
    logger.debug('handleTriggerDeleteWebhook invoked')

    const webhooks = invocation.webhookData?.webhooks || []

    for (const webhook of webhooks) {
      if (!webhook.webhookId) {
        continue
      }

      try {
        await this.#apiRequest({
          url: `${ API_BASE_URL }/webhooks/${ encodeURIComponent(webhook.webhookId) }`,
          method: 'delete',
          logTag: 'handleTriggerDeleteWebhook',
        })
      } catch (error) {
        logger.warn(`handleTriggerDeleteWebhook - failed to delete webhook ${ webhook.webhookId }: ${ error?.message }`)
      }
    }

    return { webhookData: {} }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================
  /**
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @description Lists the forms in the account for selection in form parameters across the service. The option value is the form id.
   * @route POST /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Customer Feedback","value":"3xLKgo","note":"published - 42 submissions"}],"cursor":"2"}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const page = cursor ? parseInt(cursor, 10) || 1 : 1

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/forms`,
      method: 'get',
      query: { page, limit: DICTIONARY_PAGE_SIZE },
      logTag: 'getFormsDictionary',
    })

    // The Tally API has no name-search parameter, so filter the current page client-side.
    const term = (search || '').toLowerCase()

    const items = (response.items || [])
      .filter(form => !term || (form.name || '').toLowerCase().includes(term))
      .map(form => ({
        label: form.name || `Form ${ form.id }`,
        value: String(form.id),
        note: [
          form.status ? form.status.toLowerCase() : null,
          form.numberOfSubmissions !== undefined ? `${ form.numberOfSubmissions } submissions` : null,
        ].filter(Boolean).join(' - '),
      }))

    return { items, cursor: response.hasMore ? String(page + 1) : null }
  }
}

Flowrunner.ServerCode.addService(Tally, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Tally API key. Create it in Tally → Settings → API keys. Sent as "Authorization: Bearer <key>".',
  },
])
