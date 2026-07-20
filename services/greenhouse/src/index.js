'use strict'

const logger = {
  info: (...args) => console.log('[Greenhouse] info:', ...args),
  debug: (...args) => console.log('[Greenhouse] debug:', ...args),
  error: (...args) => console.log('[Greenhouse] error:', ...args),
  warn: (...args) => console.log('[Greenhouse] warn:', ...args),
}

const API_BASE_URL = 'https://harvest.greenhouse.io/v1'

const MAX_PER_PAGE = 500

// Remove undefined / null / empty-string values so we never send blank params.
function clean(obj) {
  if (!obj || typeof obj !== 'object') {
    return obj
  }

  const result = {}

  for (const key of Object.keys(obj)) {
    const value = obj[key]

    if (value !== undefined && value !== null && value !== '') {
      result[key] = value
    }
  }

  return result
}

// Clamp/normalize a per_page value to the Greenhouse-supported range (1..500).
function normalizePerPage(perPage) {
  const value = Number(perPage)

  if (!Number.isFinite(value) || value < 1) {
    return undefined
  }

  return Math.min(Math.trunc(value), MAX_PER_PAGE)
}

/**
 * @integrationName Greenhouse
 * @integrationIcon /icon.svg
 * @usesFileStorage
 */
class Greenhouse {
  constructor(config) {
    this.apiKey = config.apiKey
    this.onBehalfOfUserId = config.onBehalfOfUserId
  }

  // ==========================================================================
  //  CORE — every Greenhouse Harvest call goes through #apiRequest
  // ==========================================================================
  // Harvest authenticates with HTTP Basic auth: the API key is the username and the
  // password is empty, so the header is base64 of "{apiKey}:".
  #authHeader() {
    const token = Buffer.from(`${ this.apiKey }:`).toString('base64')

    return `Basic ${ token }`
  }

  // Writes (POST/PUT/PATCH/DELETE) must identify the acting Greenhouse user via the
  // On-Behalf-Of header. Uses the per-action override when provided, else the config value.
  #onBehalfOf(override) {
    const userId = override !== undefined && override !== null && override !== ''
      ? override
      : this.onBehalfOfUserId

    if (userId === undefined || userId === null || userId === '') {
      throw new Error(
        'This write operation requires a Greenhouse user id for the On-Behalf-Of header. ' +
        'Set the "On-Behalf-Of User ID" config item or pass the "On-Behalf-Of User ID" ' +
        'parameter on this action (find a numeric user id via List Users).'
      )
    }

    return String(userId)
  }

  // Resolves the full response so the Link header is available for pagination, then
  // returns { body, headers }.
  async #apiRequest({ url, method = 'get', body, query, onBehalfOf, logTag }) {
    const verb = method.toLowerCase()

    try {
      logger.debug(`${ logTag } - [${ verb.toUpperCase() }::${ url }]`)

      const headers = {
        'Authorization': this.#authHeader(),
        'Content-Type': 'application/json',
      }

      if (onBehalfOf !== undefined) {
        headers['On-Behalf-Of'] = onBehalfOf
      }

      const request = Flowrunner.Request[verb](url)
        .set(headers)
        .query(clean(query) || {})
        .unwrapBody(false)

      const response = body !== undefined ? await request.send(body) : await request

      return { body: response?.body, headers: response?.headers || {} }
    } catch (error) {
      this.#handleError(error, logTag)
    }
  }

  // Surface the Greenhouse error shape { message, errors: [{ message, field }] }.
  #handleError(error, logTag) {
    const status = error?.status || error?.statusCode
    const errorBody = error?.body
    const details = Array.isArray(errorBody?.errors)
      ? errorBody.errors
        .map(e => (e.field ? `${ e.field }: ${ e.message }` : e.message))
        .filter(Boolean)
        .join('; ')
      : ''
    const baseMessage = errorBody?.message || error?.message || 'Request failed'
    const message = details ? `${ baseMessage } (${ details })` : baseMessage

    logger.error(`${ logTag } - failed${ status ? ` [${ status }]` : '' }: ${ message }`)

    throw new Error(`Greenhouse API error: ${ message }`)
  }

  // Translate a friendly DROPDOWN label into the API value; pass through anything unmapped.
  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  // Greenhouse paginates via the HTTP Link header: <...?page=N>; rel="next".
  #parseNextPage(headers) {
    const link = headers?.link || headers?.Link

    if (!link) {
      return null
    }

    for (const part of String(link).split(',')) {
      if (!/rel="next"/.test(part)) {
        continue
      }

      const urlMatch = /<([^>]+)>/.exec(part)

      if (!urlMatch) {
        continue
      }

      const pageMatch = /[?&]page=(\d+)/.exec(urlMatch[1])

      return pageMatch ? Number(pageMatch[1]) : null
    }

    return null
  }

  // Wrap a list response as { items, nextPage } using the Link header.
  #withPagination(response) {
    const items = Array.isArray(response.body) ? response.body : []

    return { items, nextPage: this.#parseNextPage(response.headers) }
  }

  // Common list query for paginated collections.
  #pageQuery(perPage, page, extra) {
    return clean({
      per_page: normalizePerPage(perPage),
      page: page || undefined,
      ...(extra || {}),
    })
  }

  // Build a candidate payload from convenience params + optional raw overrides.
  #buildCandidatePayload({
    firstName,
    lastName,
    company,
    title,
    email,
    phone,
    phoneNumbers,
    emailAddresses,
    addresses,
    socialMediaAddresses,
    websiteAddresses,
    tags,
    applications,
    jobId,
  }) {
    const payload = clean({
      first_name: firstName,
      last_name: lastName,
      company,
      title,
    })

    // Email addresses: raw override wins, else the convenience "email" param.
    if (Array.isArray(emailAddresses) && emailAddresses.length) {
      payload.email_addresses = emailAddresses
    } else if (email) {
      payload.email_addresses = [{ value: email, type: 'personal' }]
    }

    // Phone numbers: raw override wins, else the convenience "phone" param.
    if (Array.isArray(phoneNumbers) && phoneNumbers.length) {
      payload.phone_numbers = phoneNumbers
    } else if (phone) {
      payload.phone_numbers = [{ value: phone, type: 'mobile' }]
    }

    if (Array.isArray(addresses) && addresses.length) {
      payload.addresses = addresses
    }

    if (Array.isArray(socialMediaAddresses) && socialMediaAddresses.length) {
      payload.social_media_addresses = socialMediaAddresses
    }

    if (Array.isArray(websiteAddresses) && websiteAddresses.length) {
      payload.website_addresses = websiteAddresses
    }

    if (Array.isArray(tags) && tags.length) {
      payload.tags = tags
    }

    // Applications: raw override wins, else build one from the convenience jobId.
    if (Array.isArray(applications) && applications.length) {
      payload.applications = applications
    } else if (jobId) {
      payload.applications = [{ job_id: Number(jobId) }]
    }

    return payload
  }

  // ==========================================================================
  //  CANDIDATES
  // ==========================================================================

  /**
   * @operationName List Candidates
   * @category Candidates
   * @description Retrieves a paginated list of candidates (and prospects). Supports filtering by created/updated timestamps, job, email, and specific candidate ids. Results are ordered by id; use the returned nextPage with the Page parameter to page through the full set (up to 500 per page).
   * @route GET /candidates
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of candidates per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve. Use the nextPage value from a previous call."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return candidates created after this ISO 8601 timestamp (e.g. 2024-01-15T00:00:00Z)."}
   * @paramDef {"type":"String","label":"Created Before","name":"createdBefore","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return candidates created before this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Updated After","name":"updatedAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return candidates updated after this ISO 8601 timestamp."}
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","dictionary":"getJobsDictionary","description":"Only return candidates with an application on this job."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Only return candidates with this exact email address."}
   * @paramDef {"type":"String","label":"Candidate IDs","name":"candidateIds","description":"Comma-separated list of candidate ids to return (e.g. 123,456)."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":17681532,"first_name":"Jane","last_name":"Doe","company":"Acme","title":"Engineer","email_addresses":[{"value":"jane@example.com","type":"personal"}],"applications":[{"id":265968,"job_id":299902}]}],"nextPage":2}
   */
  async listCandidates(perPage, page, createdAfter, createdBefore, updatedAfter, jobId, email, candidateIds) {
    const response = await this.#apiRequest({
      logTag: '[listCandidates]',
      url: `${ API_BASE_URL }/candidates`,
      query: this.#pageQuery(perPage, page, {
        created_after: createdAfter,
        created_before: createdBefore,
        updated_after: updatedAfter,
        job_id: jobId,
        email,
        candidate_ids: candidateIds,
      }),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Candidate
   * @category Candidates
   * @description Retrieves a single candidate by id, including their contact details, tags, custom fields, attachments, and a summary of their applications.
   * @route GET /candidates/{id}
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":17681532,"first_name":"Jane","last_name":"Doe","company":"Acme","title":"Engineer","email_addresses":[{"value":"jane@example.com","type":"personal"}],"phone_numbers":[{"value":"+15551234567","type":"mobile"}],"tags":["Referral"],"applications":[{"id":265968,"job_id":299902,"status":"active"}]}
   */
  async getCandidate(candidateId) {
    const response = await this.#apiRequest({
      logTag: '[getCandidate]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }`,
    })

    return response.body
  }

  /**
   * @operationName Create Candidate
   * @category Candidates
   * @description Creates a new candidate. Provide either the quick fields (First/Last Name, Email, Phone, Company, Title, Job) or the advanced array parameters for full control. Supplying a Job ID (or an Applications array) creates the candidate together with an application to that job. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /candidates
   * @paramDef {"type":"String","label":"First Name","name":"firstName","required":true,"description":"Candidate's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Candidate's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Primary email address. Added as a Personal email when the Email Addresses array is not supplied."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Primary phone number. Added as a Mobile phone when the Phone Numbers array is not supplied."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Candidate's current company."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Candidate's current job title."}
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","dictionary":"getJobsDictionary","description":"When set, creates an application to this job for the new candidate."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to apply to the candidate."}
   * @paramDef {"type":"Array<Object>","label":"Phone Numbers","name":"phoneNumbers","description":"Advanced: array of { value, type } where type is home | work | mobile | other. Overrides the Phone field."}
   * @paramDef {"type":"Array<Object>","label":"Email Addresses","name":"emailAddresses","description":"Advanced: array of { value, type } where type is personal | work | other. Overrides the Email field."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","description":"Advanced: array of { value, type } where type is home | work | other."}
   * @paramDef {"type":"Array<Object>","label":"Social Media Addresses","name":"socialMediaAddresses","description":"Advanced: array of { value } social profile URLs/handles."}
   * @paramDef {"type":"Array<Object>","label":"Website Addresses","name":"websiteAddresses","description":"Advanced: array of { value, type } where type is personal | company | portfolio | blog | other."}
   * @paramDef {"type":"Array<Object>","label":"Applications","name":"applications","description":"Advanced: array of { job_id, source_id, initial_stage_id } applications to create. Overrides the Job ID field."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":17681532,"first_name":"Jane","last_name":"Doe","company":"Acme","title":"Engineer","email_addresses":[{"value":"jane@example.com","type":"personal"}],"applications":[{"id":265968,"job_id":299902}]}
   */
  async createCandidate(
    firstName, lastName, email, phone, company, title, jobId, tags,
    phoneNumbers, emailAddresses, addresses, socialMediaAddresses, websiteAddresses,
    applications, onBehalfOfUserId
  ) {
    const payload = this.#buildCandidatePayload({
      firstName, lastName, company, title, email, phone, jobId, tags,
      phoneNumbers, emailAddresses, addresses, socialMediaAddresses, websiteAddresses,
      applications,
    })

    const response = await this.#apiRequest({
      logTag: '[createCandidate]',
      url: `${ API_BASE_URL }/candidates`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: payload,
    })

    return response.body
  }

  /**
   * @operationName Update Candidate
   * @category Candidates
   * @description Updates a candidate's fields. This is a partial update — only the fields you supply are changed, and Greenhouse merges array fields (such as email addresses and phone numbers) rather than replacing the whole candidate. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route PATCH /candidates/{id}
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate to update."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Updated first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Updated last name."}
   * @paramDef {"type":"String","label":"Company","name":"company","description":"Updated company."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Updated job title."}
   * @paramDef {"type":"Array<String>","label":"Tags","name":"tags","description":"Tags to set on the candidate (merged with existing tags)."}
   * @paramDef {"type":"Array<Object>","label":"Phone Numbers","name":"phoneNumbers","description":"Array of { value, type } where type is home | work | mobile | other."}
   * @paramDef {"type":"Array<Object>","label":"Email Addresses","name":"emailAddresses","description":"Array of { value, type } where type is personal | work | other."}
   * @paramDef {"type":"Array<Object>","label":"Addresses","name":"addresses","description":"Array of { value, type } where type is home | work | other."}
   * @paramDef {"type":"Array<Object>","label":"Social Media Addresses","name":"socialMediaAddresses","description":"Array of { value } social profile URLs/handles."}
   * @paramDef {"type":"Array<Object>","label":"Website Addresses","name":"websiteAddresses","description":"Array of { value, type } where type is personal | company | portfolio | blog | other."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":17681532,"first_name":"Jane","last_name":"Doe","company":"Globex","title":"Senior Engineer","email_addresses":[{"value":"jane@example.com","type":"personal"}]}
   */
  async updateCandidate(
    candidateId, firstName, lastName, company, title, tags,
    phoneNumbers, emailAddresses, addresses, socialMediaAddresses, websiteAddresses, onBehalfOfUserId
  ) {
    const payload = this.#buildCandidatePayload({
      firstName, lastName, company, title, tags,
      phoneNumbers, emailAddresses, addresses, socialMediaAddresses, websiteAddresses,
    })

    const response = await this.#apiRequest({
      logTag: '[updateCandidate]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }`,
      method: 'patch',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: payload,
    })

    return response.body
  }

  /**
   * @operationName Delete Candidate
   * @category Candidates
   * @description Permanently deletes a candidate and all of their applications. This cannot be undone. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route DELETE /candidates/{id}
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate to delete."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"success":true,"message":"Candidate 17681532 deleted."}
   */
  async deleteCandidate(candidateId, onBehalfOfUserId) {
    await this.#apiRequest({
      logTag: '[deleteCandidate]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }`,
      method: 'delete',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
    })

    return { success: true, message: `Candidate ${ candidateId } deleted.` }
  }

  /**
   * @operationName Add Note to Candidate
   * @category Candidates
   * @description Adds a note to a candidate's activity feed with the chosen visibility. This is a write operation and requires an On-Behalf-Of Greenhouse user; the note's author defaults to that user unless a User ID is supplied.
   * @route POST /candidates/{id}/activity_feed/notes
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate to add the note to."}
   * @paramDef {"type":"String","label":"Note Body","name":"body","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text of the note."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","uiComponent":{"type":"DROPDOWN","options":{"values":["Admin Only","Private","Public"]}},"defaultValue":"Public","description":"Who can see the note. Defaults to Public."}
   * @paramDef {"type":"String","label":"User ID","name":"userId","dictionary":"getUsersDictionary","description":"Author of the note. Defaults to the On-Behalf-Of user."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":123456,"body":"Great phone screen, moving forward.","visibility":"public","user_id":4080,"created_at":"2024-01-15T18:00:00.000Z"}
   */
  async addNoteToCandidate(candidateId, body, visibility, userId, onBehalfOfUserId) {
    const onBehalfOf = this.#onBehalfOf(onBehalfOfUserId)
    const resolvedUserId = userId || onBehalfOf

    const response = await this.#apiRequest({
      logTag: '[addNoteToCandidate]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }/activity_feed/notes`,
      method: 'post',
      onBehalfOf,
      body: clean({
        user_id: Number(resolvedUserId),
        body,
        visibility: this.#resolveChoice(visibility, {
          'Admin Only': 'admin_only',
          'Private': 'private',
          'Public': 'public',
        }) || 'public',
      }),
    })

    return response.body
  }

  /**
   * @operationName Add Attachment to Candidate
   * @category Candidates
   * @description Uploads a file attachment (resume, cover letter, offer letter, etc.) to a candidate. Select a file from FlowRunner file storage; its bytes are base64-encoded and sent to Greenhouse. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /candidates/{id}/attachments
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate to attach the file to."}
   * @paramDef {"type":"String","label":"File","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"File in FlowRunner file storage to upload as the attachment."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","required":true,"description":"Filename to store in Greenhouse, including extension (e.g. resume.pdf)."}
   * @paramDef {"type":"String","label":"Type","name":"type","uiComponent":{"type":"DROPDOWN","options":{"values":["Resume","Cover Letter","Admin Only","Offer Letter","Take Home Test"]}},"defaultValue":"Resume","description":"The attachment category. Defaults to Resume."}
   * @paramDef {"type":"String","label":"Content Type","name":"contentType","description":"MIME type of the file (e.g. application/pdf). Inferred from the filename extension when omitted."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"filename":"resume.pdf","url":"https://prod-heroku.s3.amazonaws.com/...","type":"resume","content_type":"application/pdf"}
   */
  async addAttachmentToCandidate(candidateId, fileUrl, filename, type, contentType, onBehalfOfUserId) {
    const onBehalfOf = this.#onBehalfOf(onBehalfOfUserId)

    const bytes = await Flowrunner.Request.get(fileUrl).setEncoding(null)
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)

    const response = await this.#apiRequest({
      logTag: '[addAttachmentToCandidate]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }/attachments`,
      method: 'post',
      onBehalfOf,
      body: clean({
        filename,
        type: this.#resolveChoice(type, {
          'Resume': 'resume',
          'Cover Letter': 'cover_letter',
          'Admin Only': 'admin_only',
          'Offer Letter': 'offer_letter',
          'Take Home Test': 'take_home_test',
        }) || 'resume',
        content: buffer.toString('base64'),
        content_type: contentType || this.#guessContentType(filename),
      }),
    })

    return response.body
  }

  // Best-effort MIME type from a filename extension for attachment uploads.
  #guessContentType(filename) {
    const ext = String(filename || '').split('.').pop().toLowerCase()
    const map = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain',
      rtf: 'application/rtf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    }

    return map[ext] || 'application/octet-stream'
  }

  /**
   * @operationName List Candidate Applications
   * @category Candidates
   * @description Retrieves all applications belonging to a specific candidate, including each application's status, current stage, job, and source.
   * @route GET /candidates/{id}/applications
   * @paramDef {"type":"String","label":"Candidate ID","name":"candidateId","required":true,"description":"The id of the candidate whose applications to list."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of applications per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":265968,"candidate_id":17681532,"job_id":299902,"status":"active","current_stage":{"id":2708728,"name":"Recruiter Phone Screen"}}],"nextPage":null}
   */
  async listCandidateApplications(candidateId, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listCandidateApplications]',
      url: `${ API_BASE_URL }/candidates/${ candidateId }/applications`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  // ==========================================================================
  //  APPLICATIONS
  // ==========================================================================

  /**
   * @operationName List Applications
   * @category Applications
   * @description Retrieves a paginated list of applications across the organization. Filter by job, status, and creation time. Each application includes its candidate, job, current stage, status, and source.
   * @route GET /applications
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","dictionary":"getJobsDictionary","description":"Only return applications for this job."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Active","Rejected","Hired"]}},"description":"Only return applications with this status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of applications per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return applications created after this ISO 8601 timestamp."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":265968,"candidate_id":17681532,"job_id":299902,"status":"active","current_stage":{"id":2708728,"name":"Recruiter Phone Screen"},"source":{"id":4000,"public_name":"LinkedIn"}}],"nextPage":2}
   */
  async listApplications(jobId, status, perPage, page, createdAfter) {
    const response = await this.#apiRequest({
      logTag: '[listApplications]',
      url: `${ API_BASE_URL }/applications`,
      query: this.#pageQuery(perPage, page, {
        job_id: jobId,
        status: this.#resolveChoice(status, {
          'Active': 'active',
          'Rejected': 'rejected',
          'Hired': 'hired',
        }),
        created_after: createdAfter,
      }),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Application
   * @category Applications
   * @description Retrieves a single application by id, including the candidate, job, current stage, status, source, and answers to job-post questions.
   * @route GET /applications/{id}
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":265968,"candidate_id":17681532,"job_id":299902,"status":"active","current_stage":{"id":2708728,"name":"Recruiter Phone Screen"},"applied_at":"2024-01-10T12:00:00.000Z"}
   */
  async getApplication(applicationId) {
    const response = await this.#apiRequest({
      logTag: '[getApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }`,
    })

    return response.body
  }

  /**
   * @operationName Move Application Stage
   * @category Applications
   * @description Moves an application from one interview stage to another. Provide the current (from) stage and the target (to) stage ids for the application's job. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /applications/{id}/move
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to move."}
   * @paramDef {"type":"String","label":"From Stage ID","name":"fromStageId","required":true,"description":"The id of the stage the application is currently in."}
   * @paramDef {"type":"String","label":"To Stage ID","name":"toStageId","required":true,"description":"The id of the stage to move the application to."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":265968,"status":"active","current_stage":{"id":2708729,"name":"Onsite"}}
   */
  async moveApplicationStage(applicationId, fromStageId, toStageId, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[moveApplicationStage]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/move`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: clean({
        from_stage_id: Number(fromStageId),
        to_stage_id: Number(toStageId),
      }),
    })

    return response.body
  }

  /**
   * @operationName Advance Application
   * @category Applications
   * @description Advances an application to the next interview stage in its job's pipeline. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /applications/{id}/advance
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to advance."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":265968,"status":"active","current_stage":{"id":2708729,"name":"Onsite"}}
   */
  async advanceApplication(applicationId, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[advanceApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/advance`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: {},
    })

    return response.body
  }

  /**
   * @operationName Reject Application
   * @category Applications
   * @description Rejects an application with the given rejection reason and optional notes. Optionally sends a rejection email. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /applications/{id}/reject
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to reject."}
   * @paramDef {"type":"String","label":"Rejection Reason ID","name":"rejectionReasonId","required":true,"dictionary":"getRejectionReasonsDictionary","description":"The id of the rejection reason."}
   * @paramDef {"type":"String","label":"Notes","name":"notes","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Internal notes explaining the rejection."}
   * @paramDef {"type":"Object","label":"Rejection Email","name":"rejectionEmail","description":"Optional rejection email object: { send_email_at, email_template_id, subject, body }."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":265968,"status":"rejected","rejected_at":"2024-01-20T12:00:00.000Z","rejection_reason":{"id":9001,"name":"Not enough experience"}}
   */
  async rejectApplication(applicationId, rejectionReasonId, notes, rejectionEmail, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[rejectApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/reject`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: clean({
        rejection_reason_id: Number(rejectionReasonId),
        notes,
        rejection_email: rejectionEmail,
      }),
    })

    return response.body
  }

  /**
   * @operationName Hire Application
   * @category Applications
   * @description Marks an application as hired, optionally filling a specific job opening and setting a start date. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /applications/{id}/hire
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to hire."}
   * @paramDef {"type":"String","label":"Start Date","name":"startDate","uiComponent":{"type":"DATE_PICKER"},"description":"The candidate's start date (YYYY-MM-DD)."}
   * @paramDef {"type":"String","label":"Opening ID","name":"openingId","description":"The id of the job opening to fill with this hire."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":265968,"status":"hired","hired_at":"2024-02-01T12:00:00.000Z"}
   */
  async hireApplication(applicationId, startDate, openingId, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[hireApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/hire`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: clean({
        start_date: startDate,
        opening_id: openingId ? Number(openingId) : undefined,
      }),
    })

    return response.body
  }

  /**
   * @operationName Update Application
   * @category Applications
   * @description Updates an application's source and/or referrer. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route PATCH /applications/{id}
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application to update."}
   * @paramDef {"type":"String","label":"Source ID","name":"sourceId","dictionary":"getSourcesDictionary","description":"The id of the source to attribute this application to."}
   * @paramDef {"type":"Object","label":"Referrer","name":"referrer","description":"Referrer object, e.g. { type: 'id', value: 4080 } for an internal user or { type: 'email', value: 'ref@example.com' }."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":265968,"source":{"id":4000,"public_name":"LinkedIn"},"credited_to":{"id":4080,"name":"Recruiter One"}}
   */
  async updateApplication(applicationId, sourceId, referrer, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[updateApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }`,
      method: 'patch',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: clean({
        source_id: sourceId ? Number(sourceId) : undefined,
        referrer,
      }),
    })

    return response.body
  }

  /**
   * @operationName List Application Scorecards
   * @category Scorecards & Interviews
   * @description Retrieves all completed scorecards for an application, including interviewer feedback, ratings, and attribute scores.
   * @route GET /applications/{id}/scorecards
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application whose scorecards to list."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of scorecards per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":300001,"overall_recommendation":"yes","interview":"Recruiter Phone Screen","submitted_by":{"id":4080,"name":"Recruiter One"}}],"nextPage":null}
   */
  async listApplicationScorecards(applicationId, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listApplicationScorecards]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/scorecards`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Scheduled Interviews for Application
   * @category Scorecards & Interviews
   * @description Retrieves all scheduled interviews for an application, including start/end times, interviewers, location, and video conferencing details.
   * @route GET /applications/{id}/scheduled_interviews
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application whose scheduled interviews to list."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of interviews per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":400001,"start":{"date_time":"2024-01-18T15:00:00.000Z"},"end":{"date_time":"2024-01-18T16:00:00.000Z"},"interview":{"id":2708728,"name":"Recruiter Phone Screen"},"status":"scheduled"}],"nextPage":null}
   */
  async listScheduledInterviewsForApplication(applicationId, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listScheduledInterviewsForApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/scheduled_interviews`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Application Offers
   * @category Offers
   * @description Retrieves all offers associated with an application, including status, salary/compensation details, and start date.
   * @route GET /applications/{id}/offers
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application whose offers to list."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of offers per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":500001,"application_id":265968,"status":"accepted","starts_at":"2024-02-01","sent_at":"2024-01-25T12:00:00.000Z"}],"nextPage":null}
   */
  async listApplicationOffers(applicationId, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listApplicationOffers]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/offers`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Current Offer for Application
   * @category Offers
   * @description Retrieves the current (most recent active) offer for an application, including its status, compensation, and start date.
   * @route GET /applications/{id}/offers/current_offer
   * @paramDef {"type":"String","label":"Application ID","name":"applicationId","required":true,"description":"The id of the application whose current offer to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":500001,"application_id":265968,"status":"accepted","starts_at":"2024-02-01","sent_at":"2024-01-25T12:00:00.000Z","resolved_at":"2024-01-28T12:00:00.000Z"}
   */
  async getCurrentOfferForApplication(applicationId) {
    const response = await this.#apiRequest({
      logTag: '[getCurrentOfferForApplication]',
      url: `${ API_BASE_URL }/applications/${ applicationId }/offers/current_offer`,
    })

    return response.body
  }

  // ==========================================================================
  //  JOBS
  // ==========================================================================

  /**
   * @operationName List Jobs
   * @category Jobs
   * @description Retrieves a paginated list of jobs. Filter by status, requisition id, and creation time. Each job includes its name, status, departments, offices, and hiring team.
   * @route GET /jobs
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed","Draft"]}},"description":"Only return jobs with this status."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of jobs per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @paramDef {"type":"String","label":"Requisition ID","name":"requisitionId","description":"Only return jobs with this requisition id."}
   * @paramDef {"type":"String","label":"Created After","name":"createdAfter","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Return jobs created after this ISO 8601 timestamp."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":299902,"name":"Software Engineer","status":"open","requisition_id":"R-100","departments":[{"id":4000,"name":"Engineering"}],"offices":[{"id":9000,"name":"San Francisco"}]}],"nextPage":2}
   */
  async listJobs(status, perPage, page, requisitionId, createdAfter) {
    const response = await this.#apiRequest({
      logTag: '[listJobs]',
      url: `${ API_BASE_URL }/jobs`,
      query: this.#pageQuery(perPage, page, {
        status: this.#resolveChoice(status, {
          'Open': 'open',
          'Closed': 'closed',
          'Draft': 'draft',
        }),
        requisition_id: requisitionId,
        created_after: createdAfter,
      }),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Job
   * @category Jobs
   * @description Retrieves a single job by id, including its name, status, openings, departments, offices, hiring team, and custom fields.
   * @route GET /jobs/{id}
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The id of the job to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":299902,"name":"Software Engineer","status":"open","openings":[{"id":123,"status":"open","opening_id":"R-100-1"}],"departments":[{"id":4000,"name":"Engineering"}]}
   */
  async getJob(jobId) {
    const response = await this.#apiRequest({
      logTag: '[getJob]',
      url: `${ API_BASE_URL }/jobs/${ jobId }`,
    })

    return response.body
  }

  /**
   * @operationName Get Job Stages
   * @category Jobs
   * @description Retrieves the interview stages configured for a job, in pipeline order. Use these stage ids with Move Application Stage.
   * @route GET /jobs/{id}/stages
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The id of the job whose stages to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":2708728,"name":"Recruiter Phone Screen","priority":1,"job_id":299902},{"id":2708729,"name":"Onsite","priority":2,"job_id":299902}]}
   */
  async getJobStages(jobId) {
    const response = await this.#apiRequest({
      logTag: '[getJobStages]',
      url: `${ API_BASE_URL }/jobs/${ jobId }/stages`,
    })

    return { items: Array.isArray(response.body) ? response.body : [] }
  }

  /**
   * @operationName List Job Openings
   * @category Jobs
   * @description Retrieves the openings for a job, optionally filtered by status. Each opening represents a distinct headcount slot that a hire can fill.
   * @route GET /jobs/{id}/openings
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The id of the job whose openings to retrieve."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Open","Closed"]}},"description":"Only return openings with this status."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":123,"opening_id":"R-100-1","status":"open","application_id":null,"employment_status":"full_time"}]}
   */
  async listJobOpenings(jobId, status) {
    const response = await this.#apiRequest({
      logTag: '[listJobOpenings]',
      url: `${ API_BASE_URL }/jobs/${ jobId }/openings`,
      query: clean({
        status: this.#resolveChoice(status, {
          'Open': 'open',
          'Closed': 'closed',
        }),
      }),
    })

    return { items: Array.isArray(response.body) ? response.body : [] }
  }

  /**
   * @operationName Create Job Opening
   * @category Jobs
   * @description Adds one or more openings to a job. Each opening may specify an opening_id (your external reference) and an employment status. This is a write operation and requires an On-Behalf-Of Greenhouse user.
   * @route POST /jobs/{id}/openings
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The id of the job to add openings to."}
   * @paramDef {"type":"Array<Object>","label":"Openings","name":"openings","required":true,"description":"Array of openings to create, each { opening_id, employment_status } (employment_status e.g. full_time, part_time, intern, contract, temp)."}
   * @paramDef {"type":"String","label":"On-Behalf-Of User ID","name":"onBehalfOfUserId","dictionary":"getUsersDictionary","description":"Numeric Greenhouse user id performing this action. Overrides the service-level On-Behalf-Of User ID."}
   * @returns {Object}
   * @sampleResult {"id":299902,"openings":[{"id":124,"opening_id":"R-100-2","status":"open","employment_status":"full_time"}]}
   */
  async createJobOpening(jobId, openings, onBehalfOfUserId) {
    const response = await this.#apiRequest({
      logTag: '[createJobOpening]',
      url: `${ API_BASE_URL }/jobs/${ jobId }/openings`,
      method: 'post',
      onBehalfOf: this.#onBehalfOf(onBehalfOfUserId),
      body: { openings: Array.isArray(openings) ? openings : [] },
    })

    return response.body
  }

  // ==========================================================================
  //  JOB POSTS
  // ==========================================================================

  /**
   * @operationName List Job Posts
   * @category Job Posts
   * @description Retrieves a paginated list of job posts (public and internal postings). Filter to only active and/or live posts. Each post includes its title, content, location, and the job it belongs to.
   * @route GET /job_posts
   * @paramDef {"type":"Boolean","label":"Active Only","name":"active","uiComponent":{"type":"CHECKBOX"},"description":"When true, only return active job posts."}
   * @paramDef {"type":"Boolean","label":"Live Only","name":"live","uiComponent":{"type":"CHECKBOX"},"description":"When true, only return live (published on the job board) job posts."}
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of job posts per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":600001,"title":"Software Engineer","location":{"name":"San Francisco"},"active":true,"live":true,"job_id":299902}],"nextPage":null}
   */
  async listJobPosts(active, live, perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listJobPosts]',
      url: `${ API_BASE_URL }/job_posts`,
      query: this.#pageQuery(perPage, page, {
        active: active === true ? true : undefined,
        live: live === true ? true : undefined,
      }),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get Job Posts for Job
   * @category Job Posts
   * @description Retrieves all job posts associated with a specific job, including the internal and external postings and their content.
   * @route GET /jobs/{id}/job_posts
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"dictionary":"getJobsDictionary","description":"The id of the job whose job posts to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":600001,"title":"Software Engineer","location":{"name":"San Francisco"},"active":true,"live":true,"internal":false,"external":true}]}
   */
  async getJobPostsForJob(jobId) {
    const response = await this.#apiRequest({
      logTag: '[getJobPostsForJob]',
      url: `${ API_BASE_URL }/jobs/${ jobId }/job_posts`,
    })

    return { items: Array.isArray(response.body) ? response.body : [] }
  }

  // ==========================================================================
  //  USERS
  // ==========================================================================

  /**
   * @operationName List Users
   * @category Users
   * @description Retrieves a paginated list of Greenhouse users. Filter by email to find a specific user. Use a user's id for the On-Behalf-Of User ID config item and write-action override.
   * @route GET /users
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of users per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Only return the user with this exact primary email address."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":4080,"name":"Recruiter One","first_name":"Recruiter","last_name":"One","primary_email_address":"recruiter@example.com","disabled":false,"site_admin":true}],"nextPage":null}
   */
  async listUsers(perPage, page, email) {
    const response = await this.#apiRequest({
      logTag: '[listUsers]',
      url: `${ API_BASE_URL }/users`,
      query: this.#pageQuery(perPage, page, { email }),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName Get User
   * @category Users
   * @description Retrieves a single Greenhouse user by id, including their name, email addresses, role, and enabled/disabled status.
   * @route GET /users/{id}
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"The id of the user to retrieve."}
   * @returns {Object}
   * @sampleResult {"id":4080,"name":"Recruiter One","primary_email_address":"recruiter@example.com","disabled":false,"site_admin":true,"emails":["recruiter@example.com"]}
   */
  async getUser(userId) {
    const response = await this.#apiRequest({
      logTag: '[getUser]',
      url: `${ API_BASE_URL }/users/${ userId }`,
    })

    return response.body
  }

  // ==========================================================================
  //  REFERENCE DATA
  // ==========================================================================

  /**
   * @operationName List Sources
   * @category Reference
   * @description Retrieves all candidate sources configured in the organization (e.g. LinkedIn, Referral, Job Board). Use a source id with Create Candidate applications or Update Application.
   * @route GET /sources
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of sources per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":4000,"public_name":"LinkedIn","type":{"id":11,"name":"Job boards & job ads"}}],"nextPage":null}
   */
  async listSources(perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listSources]',
      url: `${ API_BASE_URL }/sources`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Rejection Reasons
   * @category Reference
   * @description Retrieves all rejection reasons configured in the organization. Use a rejection reason id with Reject Application.
   * @route GET /rejection_reasons
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of rejection reasons per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":9001,"name":"Not enough experience","type":{"id":1,"name":"We rejected them"}}],"nextPage":null}
   */
  async listRejectionReasons(perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listRejectionReasons]',
      url: `${ API_BASE_URL }/rejection_reasons`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Departments
   * @category Reference
   * @description Retrieves all departments configured in the organization, including their hierarchy (parent/child departments).
   * @route GET /departments
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of departments per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":4000,"name":"Engineering","parent_id":null,"child_ids":[4010,4020]}],"nextPage":null}
   */
  async listDepartments(perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listDepartments]',
      url: `${ API_BASE_URL }/departments`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Offices
   * @category Reference
   * @description Retrieves all offices (locations) configured in the organization, including their hierarchy.
   * @route GET /offices
   * @paramDef {"type":"Number","label":"Per Page","name":"perPage","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of offices per page (1-500, default 100)."}
   * @paramDef {"type":"Number","label":"Page","name":"page","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Page number to retrieve."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":9000,"name":"San Francisco","location":{"name":"San Francisco, CA"},"parent_id":null,"child_ids":[]}],"nextPage":null}
   */
  async listOffices(perPage, page) {
    const response = await this.#apiRequest({
      logTag: '[listOffices]',
      url: `${ API_BASE_URL }/offices`,
      query: this.#pageQuery(perPage, page),
    })

    return this.#withPagination(response)
  }

  /**
   * @operationName List Custom Fields
   * @category Reference
   * @description Retrieves the custom fields defined for a given field type (candidate, application, job, offer, etc.), including each field's name, type, and any select options.
   * @route GET /custom_fields/{field_type}
   * @paramDef {"type":"String","label":"Field Type","name":"fieldType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Candidate","Application","Job","Offer","Opening","Requisition","Referral"]}},"defaultValue":"Candidate","description":"The type of object the custom fields belong to."}
   * @returns {Object}
   * @sampleResult {"items":[{"id":700001,"name":"Desired Salary","field_type":"candidate","value_type":"currency","required":false}]}
   */
  async listCustomFields(fieldType) {
    const resolved = this.#resolveChoice(fieldType, {
      'Candidate': 'candidate',
      'Application': 'application',
      'Job': 'job',
      'Offer': 'offer',
      'Opening': 'opening',
      'Requisition': 'requisition',
      'Referral': 'referral',
    }) || 'candidate'

    const response = await this.#apiRequest({
      logTag: '[listCustomFields]',
      url: `${ API_BASE_URL }/custom_fields/${ resolved }`,
    })

    return { items: Array.isArray(response.body) ? response.body : [] }
  }

  // ==========================================================================
  //  DICTIONARIES
  // ==========================================================================

  /**
   * @typedef {Object} getJobsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter jobs by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of jobs."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Jobs Dictionary
   * @description Provides a searchable list of jobs for selecting a Job ID in dependent parameters. The option value is the numeric job id.
   * @route POST /get-jobs-dictionary
   * @paramDef {"type":"getJobsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering jobs."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Software Engineer","value":"299902","note":"open"}],"cursor":"2"}
   */
  async getJobsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getJobsDictionary]',
      url: `${ API_BASE_URL }/jobs`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let jobs = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      jobs = jobs.filter(job => String(job.name || '').toLowerCase().includes(term))
    }

    return {
      items: jobs.map(job => ({
        label: job.name || `Job ${ job.id }`,
        value: String(job.id),
        note: job.status || undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter users by name or email."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of users."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of Greenhouse users for selecting a User ID or On-Behalf-Of User ID. The option value is the numeric user id.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering users."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Recruiter One","value":"4080","note":"recruiter@example.com"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getUsersDictionary]',
      url: `${ API_BASE_URL }/users`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let users = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()

      users = users.filter(user =>
        String(user.name || '').toLowerCase().includes(term) ||
        String(user.primary_email_address || '').toLowerCase().includes(term)
      )
    }

    return {
      items: users.map(user => ({
        label: user.name || `User ${ user.id }`,
        value: String(user.id),
        note: user.primary_email_address || undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  /**
   * @typedef {Object} getJobStagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Job ID","name":"jobId","required":true,"description":"The job id whose stages to list."}
   */

  /**
   * @typedef {Object} getJobStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor. Job stages are returned in a single call, so this is unused."}
   * @paramDef {"type":"getJobStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required job id used to look up its interview stages."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Job Stages Dictionary
   * @description Provides a searchable list of interview stages for a specific job, for selecting a From/To Stage ID. The option value is the numeric stage id. Depends on a selected Job ID.
   * @route POST /get-job-stages-dictionary
   * @paramDef {"type":"getJobStagesDictionary__payload","label":"Payload","name":"payload","description":"Search string, pagination cursor, and the required job id criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Recruiter Phone Screen","value":"2708728","note":"Priority 1"}],"cursor":null}
   */
  async getJobStagesDictionary(payload) {
    const { search, criteria } = payload || {}
    const jobId = criteria?.jobId

    if (!jobId) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: '[getJobStagesDictionary]',
      url: `${ API_BASE_URL }/jobs/${ jobId }/stages`,
    })

    let stages = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      stages = stages.filter(stage => String(stage.name || '').toLowerCase().includes(term))
    }

    return {
      items: stages.map(stage => ({
        label: stage.name || `Stage ${ stage.id }`,
        value: String(stage.id),
        note: stage.priority !== undefined ? `Priority ${ stage.priority }` : undefined,
      })),
      cursor: null,
    }
  }

  /**
   * @typedef {Object} getSourcesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter sources by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of sources."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Sources Dictionary
   * @description Provides a searchable list of candidate sources for selecting a Source ID. The option value is the numeric source id.
   * @route POST /get-sources-dictionary
   * @paramDef {"type":"getSourcesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering sources."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"LinkedIn","value":"4000","note":"Job boards & job ads"}],"cursor":null}
   */
  async getSourcesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getSourcesDictionary]',
      url: `${ API_BASE_URL }/sources`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let sources = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      sources = sources.filter(source => String(source.public_name || '').toLowerCase().includes(term))
    }

    return {
      items: sources.map(source => ({
        label: source.public_name || `Source ${ source.id }`,
        value: String(source.id),
        note: source.type?.name || undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  /**
   * @typedef {Object} getRejectionReasonsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter rejection reasons by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of rejection reasons."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Rejection Reasons Dictionary
   * @description Provides a searchable list of rejection reasons for selecting a Rejection Reason ID in Reject Application. The option value is the numeric rejection reason id.
   * @route POST /get-rejection-reasons-dictionary
   * @paramDef {"type":"getRejectionReasonsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering rejection reasons."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Not enough experience","value":"9001","note":"We rejected them"}],"cursor":null}
   */
  async getRejectionReasonsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getRejectionReasonsDictionary]',
      url: `${ API_BASE_URL }/rejection_reasons`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let reasons = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      reasons = reasons.filter(reason => String(reason.name || '').toLowerCase().includes(term))
    }

    return {
      items: reasons.map(reason => ({
        label: reason.name || `Reason ${ reason.id }`,
        value: String(reason.id),
        note: reason.type?.name || undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  /**
   * @typedef {Object} getDepartmentsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter departments by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of departments."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Departments Dictionary
   * @description Provides a searchable list of departments for selecting a Department ID. The option value is the numeric department id.
   * @route POST /get-departments-dictionary
   * @paramDef {"type":"getDepartmentsDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering departments."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Engineering","value":"4000","note":"3 sub-departments"}],"cursor":null}
   */
  async getDepartmentsDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getDepartmentsDictionary]',
      url: `${ API_BASE_URL }/departments`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let departments = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      departments = departments.filter(dep => String(dep.name || '').toLowerCase().includes(term))
    }

    return {
      items: departments.map(dep => ({
        label: dep.name || `Department ${ dep.id }`,
        value: String(dep.id),
        note: Array.isArray(dep.child_ids) && dep.child_ids.length
          ? `${ dep.child_ids.length } sub-departments`
          : undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  /**
   * @typedef {Object} getOfficesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter offices by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor (page number) for retrieving the next page of offices."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Offices Dictionary
   * @description Provides a searchable list of offices (locations) for selecting an Office ID. The option value is the numeric office id.
   * @route POST /get-offices-dictionary
   * @paramDef {"type":"getOfficesDictionary__payload","label":"Payload","name":"payload","description":"Optional search string and pagination cursor for filtering offices."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"San Francisco","value":"9000","note":"San Francisco, CA"}],"cursor":null}
   */
  async getOfficesDictionary(payload) {
    const { search, cursor } = payload || {}

    const response = await this.#apiRequest({
      logTag: '[getOfficesDictionary]',
      url: `${ API_BASE_URL }/offices`,
      query: this.#pageQuery(100, cursor ? Number(cursor) : undefined),
    })

    let offices = Array.isArray(response.body) ? response.body : []

    if (search) {
      const term = search.toLowerCase()
      offices = offices.filter(office => String(office.name || '').toLowerCase().includes(term))
    }

    return {
      items: offices.map(office => ({
        label: office.name || `Office ${ office.id }`,
        value: String(office.id),
        note: office.location?.name || undefined,
      })),
      cursor: this.#nextCursor(response.headers),
    }
  }

  // Return the next page number (as a string cursor) from the Link header, or null.
  #nextCursor(headers) {
    const nextPage = this.#parseNextPage(headers)

    return nextPage ? String(nextPage) : null
  }
}

Flowrunner.ServerCode.addService(Greenhouse, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Greenhouse Harvest API key. In Greenhouse go to Configure (gear) → Dev Center → API Credential Management → Create New API Key, choose type "Harvest", and grant the permissions your workflow needs. Sent as HTTP Basic auth (the key is the username, password is empty).',
  },
  {
    name: 'onBehalfOfUserId',
    displayName: 'On-Behalf-Of User ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Numeric Greenhouse user id used for write operations (create/update/delete). Greenhouse requires an "On-Behalf-Of" user to audit who performed each change. Find a user id via List Users. Individual write actions can override this with their own On-Behalf-Of User ID parameter.',
  },
])
