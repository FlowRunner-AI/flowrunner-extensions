const logger = {
  info: (...args) => console.log('[Gravity Forms Service] info:', ...args),
  debug: (...args) => console.log('[Gravity Forms Service] debug:', ...args),
  error: (...args) => console.log('[Gravity Forms Service] error:', ...args),
  warn: (...args) => console.log('[Gravity Forms Service] warn:', ...args),
}

function isObject(obj) {
  return typeof obj === 'object' && !Array.isArray(obj) && obj !== null
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/**
 *  @integrationName Gravity Forms
 *  @integrationIcon /icon.svg
 **/
class GravityForms {
  constructor({ siteUrl, consumerKey, consumerSecret }) {
    // Ensure siteUrl doesn't have trailing slash for consistent URL construction
    this.baseUrl = siteUrl.replace(/\/$/, '') + '/wp-json/gf/v2'

    this.auth = Buffer.from(`${ consumerKey }:${ consumerSecret }`).toString('base64')
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      return await Flowrunner.Request[method](url)
        .set({
          Authorization: `Basic ${ this.auth }`,
          'Content-Type': 'application/json',
        })
        .query(query)
        .send(body)
    } catch (error) {
      logger.error(`${ logTag } - api request failed:`, error.message)
      throw new Error(`Gravity Forms API request failed: ${ error.message }`)
    }
  }

  /**
   * @description Create a new Gravity Forms form with specified configuration including fields, notifications, and confirmations. This method allows you to programmatically build complex forms with multiple field types, validation rules, and custom styling options.
   *
   * @route POST /form
   * @operationName Create Form
   * @category Form Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Object","label":"Form Data","name":"formData","required":true,"description":"Complete form configuration object containing title, fields, notifications, and styling options. Must include at minimum a 'title' property and 'fields' array with field definitions. Reference the Gravity Forms Form Object documentation for detailed structure."}
   *
   * @returns {Object} Complete form object with generated ID and all configured properties
   * @sampleResult {"title":"Contact Form","description":"Please fill out all required fields","labelPlacement":"top_label","descriptionPlacement":"below","button":{"type":"text","text":"Submit","imageUrl":""},"fields":[{"type":"text","label":"Full Name","isRequired":true,"id":"1","visibility":"visible","formId":"15","pageNumber":1},{"type":"email","label":"Email Address","isRequired":true,"id":"2","visibility":"visible","formId":"15","pageNumber":1},{"type":"textarea","label":"Message","id":"3","visibility":"visible","formId":"15","pageNumber":1}],"version":"2.8.0","id":"15","is_active":"1","date_created":"2024-08-01 10:30:00","notifications":{"admin_notify":{"id":"admin_notify","to":"{admin_email}","name":"Admin Notification","subject":"New Contact Form Submission","message":"{all_fields}"}},"confirmations":{"default":{"id":"default","name":"Default Confirmation","type":"message","message":"Thank you for your message. We will respond within 24 hours."}}}
   */
  async createForm(formData) {
    logger.debug('[createForm] Creating new form with data:', { formData })

    assert(isObject(formData) && Object.keys(formData).length, 'Form Data must be provided as a non-empty object')
    assert(formData.title && typeof formData.title === 'string', 'Form Data must include a title property')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms`,
        method: 'post',
        body: formData,
        logTag: 'createForm',
      })

      logger.info(`[createForm] Successfully created form with ID: ${ result.id }`)

      return result
    } catch (error) {
      logger.error(`[createForm] Failed to create form: ${ error.message }`)
      throw new Error(`Failed to create Gravity Forms form: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific Gravity Forms form including all field configurations, notifications, confirmations, and form settings. This method returns the complete form structure needed for form rendering or administrative purposes.
   *
   * @route GET /form
   * @operationName Get Form
   * @category Form Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"id","required":true,"description":"Unique identifier of the form to retrieve. Can be found in the Gravity Forms admin interface or returned from form creation methods."}
   *
   * @returns {Object} Complete form object containing all configuration details, fields, and settings
   * @sampleResult {"title":"Contact Form","description":"Please complete all required fields","labelPlacement":"top_label","descriptionPlacement":"below","button":{"type":"text","text":"Submit","imageUrl":""},"fields":[{"type":"text","label":"Full Name","isRequired":true,"id":"1","visibility":"visible","formId":"15","pageNumber":1},{"type":"email","label":"Email Address","isRequired":true,"id":"2","visibility":"visible","formId":"15","pageNumber":1},{"type":"textarea","label":"Message","id":"3","visibility":"visible","formId":"15","pageNumber":1}],"version":"2.8.0","id":"15","is_active":"1","date_created":"2024-08-01 10:30:00","entries":"0","notifications":{"admin_notify":{"id":"admin_notify","to":"{admin_email}","name":"Admin Notification","subject":"New Contact Form Submission","message":"{all_fields}"}},"confirmations":{"default":{"id":"default","name":"Default Confirmation","type":"message","message":"Thank you for your message. We will respond within 24 hours."}}}
   */
  async getForm(id) {
    logger.debug('[getForm] Retrieving form with ID:', { id })

    assert(id !== null && id !== undefined && id !== '', 'Form ID must be provided and cannot be empty')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ id }`,
        method: 'get',
        logTag: 'getForm',
      })

      logger.info(`[getForm] Successfully retrieved form: ${ result.title } (ID: ${ result.id })`)

      return result
    } catch (error) {
      logger.error(`[getForm] Failed to retrieve form ${ id }: ${ error.message }`)
      throw new Error(`Failed to retrieve Gravity Forms form ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Permanently delete a Gravity Forms form and optionally all its associated entries. By default, forms are moved to trash; use the force parameter to permanently delete the form and all its data including entries, notifications, and confirmations.
   *
   * @route DELETE /form
   * @operationName Delete Form
   * @category Form Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"id","required":true,"description":"Unique identifier of the form to delete. Warning: This action cannot be undone when force parameter is true."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Set to true to permanently delete the form and all associated entries. When false, form is moved to trash and can be restored."}
   *
   * @returns {Object} Deletion confirmation with details of the deleted form
   * @sampleResult {"deleted":true,"previous":{"title":"Contact Form","description":"Please complete all required fields","id":"15","is_active":"0","date_created":"2024-08-01 10:30:00","fields":[{"type":"text","label":"Full Name","id":"1"},{"type":"email","label":"Email Address","id":"2"}],"entries":"5","notifications":{"admin_notify":{"name":"Admin Notification","to":"{admin_email}"}}}}
   */
  async deleteForm(id, force) {
    logger.debug('[deleteForm] Deleting form with parameters:', { id, force })

    assert(id !== null && id !== undefined && id !== '', 'Form ID must be provided and cannot be empty')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ id }`,
        method: 'delete',
        query: { force: force ? 1 : 0 },
        logTag: 'deleteForm',
      })

      const action = force ? 'permanently deleted' : 'moved to trash'
      logger.info(`[deleteForm] Successfully ${ action } form ${ id }`)

      return result
    } catch (error) {
      logger.error(`[deleteForm] Failed to delete form ${ id }: ${ error.message }`)
      throw new Error(`Failed to delete Gravity Forms form ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve a comprehensive list of all Gravity Forms in your WordPress site with basic information including titles, IDs, and entry counts. This method provides an overview of all forms for management and selection purposes.
   *
   * @route GET /form/list
   * @operationName Get Forms List
   * @category Form Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @returns {Array} Array of form objects containing basic information for each form
   * @sampleResult [{"id":"15","title":"Contact Form","entries":"25","is_active":"1","date_created":"2024-08-01 10:30:00"},{"id":"16","title":"Newsletter Signup","entries":"142","is_active":"1","date_created":"2024-07-28 14:15:00"},{"id":"17","title":"Product Inquiry","entries":"8","is_active":"1","date_created":"2024-07-25 09:45:00"}]
   */
  async getFormsList() {
    logger.debug('[getFormsList] Retrieving all forms list')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms`,
        method: 'get',
        logTag: 'getFormsList',
      })

      const formsList = Object.values(result)
      logger.info(`[getFormsList] Successfully retrieved ${ formsList.length } forms`)

      return formsList
    } catch (error) {
      logger.error(`[getFormsList] Failed to retrieve forms list: ${ error.message }`)
      throw new Error(`Failed to retrieve Gravity Forms list: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing Gravity Forms form with new configuration, fields, or settings. This method completely replaces the form configuration, so ensure all required properties are included to prevent data loss.
   *
   * @route PUT /form
   * @operationName Update Form
   * @category Form Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"id","required":true,"description":"Unique identifier of the form to update. Use Get Form method to retrieve current configuration before updating."}
   * @paramDef {"type":"Object","label":"Form Data","name":"formData","required":true,"description":"Complete updated form configuration object. Warning: This replaces the entire form structure - omitted properties will be removed. Include all fields, notifications, and confirmations."}
   *
   * @returns {Object} Complete updated form object with all applied changes
   * @sampleResult {"title":"Updated Contact Form","description":"Please complete all required fields to contact us","labelPlacement":"top_label","descriptionPlacement":"below","button":{"type":"text","text":"Send Message","imageUrl":""},"fields":[{"type":"text","label":"Full Name","isRequired":true,"id":"1","visibility":"visible","formId":"15","pageNumber":1},{"type":"email","label":"Email Address","isRequired":true,"id":"2","visibility":"visible","formId":"15","pageNumber":1},{"type":"phone","label":"Phone Number","id":"3","visibility":"visible","formId":"15","pageNumber":1}],"version":"2.8.0","id":"15","is_active":"1","date_created":"2024-08-01 10:30:00","date_updated":"2024-08-01 15:45:00","notifications":{"admin_notify":{"id":"admin_notify","to":"{admin_email}","name":"Admin Notification","subject":"Updated Contact Form Submission","message":"{all_fields}"}}}
   */
  async updateForm(id, formData) {
    logger.debug('[updateForm] Updating form with data:', { id, formData })

    assert(id !== null && id !== undefined && id !== '', 'Form ID must be provided and cannot be empty')
    assert(isObject(formData) && Object.keys(formData).length, 'Form Data must be provided as a non-empty object')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ id }`,
        method: 'put',
        body: formData,
        logTag: 'updateForm',
      })

      logger.info(`[updateForm] Successfully updated form ${ id }: ${ result.title }`)

      return result
    } catch (error) {
      logger.error(`[updateForm] Failed to update form ${ id }: ${ error.message }`)
      throw new Error(`Failed to update Gravity Forms form ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Submit form data through the complete Gravity Forms submission process including validation, spam filtering, notifications, and confirmations. This method processes the submission as if submitted through the actual form on your website.
   *
   * @route POST /form/submission
   * @operationName Submit Entry
   * @category Form Submission
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsListDictionary","description":"Unique identifier of the target form for submission. The form must be active and accessible."}
   * @paramDef {"type":"Object","label":"Submission Data","name":"submissionData","required":true,"description":"Form field values using input names as keys (e.g., 'input_1', 'input_2'). Field names correspond to the field IDs in your form configuration. Use Get Form method to identify correct field input names."}
   *
   * @returns {Object} Submission processing result including validation status and confirmation details
   * @sampleResult {"page_number":0,"confirmation_message":"<div class='gform_confirmation_message'>Thank you for your submission! We will contact you within 24 hours.</div>","is_valid":true,"source_page_number":1,"confirmation_type":"message","form_id":"15"}
   */
  async submitEntry(formId, submissionData) {
    logger.debug('[submitEntry] Submitting entry to form:', { formId, submissionData })

    assert(formId !== null && formId !== undefined && formId !== '', 'Form ID must be provided and cannot be empty')

    assert(
      isObject(submissionData) && Object.keys(submissionData).length,
      'Submission Data must be provided as a non-empty object'
    )

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ formId }/submissions`,
        method: 'post',
        body: submissionData,
        logTag: 'submitEntry',
      })

      const status = result.is_valid ? 'successfully processed' : 'failed validation'
      logger.info(`[submitEntry] Form ${ formId } submission ${ status }`)

      return result
    } catch (error) {
      logger.error(`[submitEntry] Failed to submit entry to form ${ formId }: ${ error.message }`)
      throw new Error(`Failed to submit entry to Gravity Forms form ${ formId }: ${ error.message }`)
    }
  }

  /**
   * @description Validate form submission data without actually creating an entry. This method checks field validation rules, required fields, and performs anti-spam checks to ensure data integrity before submission.
   *
   * @route POST /form/submission/validate
   * @operationName Validate Submission
   * @category Form Submission
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsListDictionary","description":"Unique identifier of the form to validate against. The form's validation rules and field requirements will be applied."}
   * @paramDef {"type":"Object","label":"Submission Data","name":"submissionData","required":true,"description":"Form field values to validate using input names as keys (e.g., 'input_1', 'input_2'). Values will be checked against field validation rules, required field settings, and spam filters."}
   *
   * @returns {Object} Validation result including validity status, error messages, and spam detection results
   * @sampleResult {"is_spam":false,"page_number":0,"is_valid":true,"validation_messages":[],"source_page_number":1,"form_id":"15"}
   */
  async validateSubmission(formId, submissionData) {
    logger.debug('[validateSubmission] Validating submission data:', { formId, submissionData })

    assert(formId !== null && formId !== undefined && formId !== '', 'Form ID must be provided and cannot be empty')

    assert(
      isObject(submissionData) && Object.keys(submissionData).length,
      'Submission Data must be provided as a non-empty object'
    )

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ formId }/submissions`,
        method: 'post',
        body: submissionData,
        query: { _validate_only: 1 },
        logTag: 'validateSubmission',
      })

      const status = result.is_valid ? 'passed validation' : 'failed validation'
      const spamStatus = result.is_spam ? ' (flagged as spam)' : ''
      logger.info(`[validateSubmission] Form ${ formId } data ${ status }${ spamStatus }`)

      return result
    } catch (error) {
      logger.error(`[validateSubmission] Failed to validate submission for form ${ formId }: ${ error.message }`)
      throw new Error(`Failed to validate submission for Gravity Forms form ${ formId }: ${ error.message }`)
    }
  }

  /**
   * @description Directly create a form entry bypassing the normal submission process. This method creates entries without triggering notifications, confirmations, or validation - useful for importing data or programmatic entry creation.
   *
   * @route POST /entry
   * @operationName Create Entry
   * @category Entry Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsListDictionary","description":"Unique identifier of the form to create entry for. The entry will be associated with this form's structure and fields."}
   * @paramDef {"type":"Object","label":"Entry Data","name":"entryData","required":true,"description":"Entry data object with field IDs as keys and submitted values. Use field IDs (e.g., '1', '2', '3') not input names. Include form_id property and any additional entry metadata."}
   *
   * @returns {Object} Created entry object with assigned ID and all field values
   * @sampleResult {"1":"John Doe","2":"john@example.com","3":"Hello, this is my message!","form_id":"15","id":"125","date_created":"2024-08-01 15:30:00","is_starred":"0","is_read":"0","ip":"192.168.1.100","source_url":"API","user_agent":"API Service","status":"active"}
   */
  async createEntry(formId, entryData) {
    logger.debug('[createEntry] Creating entry for form:', { formId, entryData })

    assert(formId !== null && formId !== undefined && formId !== '', 'Form ID must be provided and cannot be empty')
    assert(isObject(entryData) && Object.keys(entryData).length, 'Entry Data must be provided as a non-empty object')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ formId }/entries`,
        method: 'post',
        body: entryData,
        logTag: 'createEntry',
      })

      logger.info(`[createEntry] Successfully created entry ${ result.id } for form ${ formId }`)

      return result
    } catch (error) {
      logger.error(`[createEntry] Failed to create entry for form ${ formId }: ${ error.message }`)
      throw new Error(`Failed to create entry for Gravity Forms form ${ formId }: ${ error.message }`)
    }
  }

  /**
   * @description Update an existing form entry with new field values or metadata. This method allows modification of entry data after submission, useful for data correction or status updates.
   *
   * @route PUT /entry
   * @operationName Update Entry
   * @category Entry Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"id","required":true,"description":"Unique identifier of the entry to update. Can be obtained from entry creation or retrieval methods."}
   * @paramDef {"type":"Object","label":"Entry Data","name":"entryData","required":true,"description":"Updated entry data with field IDs as keys and new values. Only provided fields will be updated - existing fields not included will remain unchanged."}
   *
   * @returns {Object} Updated entry object with all current field values and metadata
   * @sampleResult {"1":"Jane Smith","2":"jane@example.com","3":"Updated message content","form_id":"15","id":"125","date_created":"2024-08-01 15:30:00","date_updated":"2024-08-01 16:15:00","is_starred":"1","is_read":"1","status":"active"}
   */
  async updateEntry(id, entryData) {
    logger.debug('[updateEntry] Updating entry with data:', { id, entryData })

    assert(id !== null && id !== undefined && id !== '', 'Entry ID must be provided and cannot be empty')
    assert(isObject(entryData) && Object.keys(entryData).length, 'Entry Data must be provided as a non-empty object')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/entries/${ id }`,
        method: 'put',
        body: entryData,
        logTag: 'updateEntry',
      })

      logger.info(`[updateEntry] Successfully updated entry ${ id }`)

      return result
    } catch (error) {
      logger.error(`[updateEntry] Failed to update entry ${ id }: ${ error.message }`)
      throw new Error(`Failed to update Gravity Forms entry ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve detailed information about a specific form entry including all field values, metadata, and submission details. This method provides complete entry data for review or processing.
   *
   * @route GET /entry
   * @operationName Get Entry
   * @category Entry Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"id","required":true,"description":"Unique identifier of the entry to retrieve. Can be obtained from form entries list or entry creation methods."}
   *
   * @returns {Object} Complete entry object with all field values and submission metadata
   * @sampleResult {"1":"John Doe","2":"john@example.com","3":"Thank you for your excellent service!","id":"125","form_id":"15","post_id":null,"date_created":"2024-08-01 15:30:00","date_updated":"2024-08-01 15:30:00","is_starred":"0","is_read":"0","ip":"192.168.1.100","source_url":"https://example.com/contact","user_agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36","currency":"USD","payment_status":null,"created_by":"0","status":"active"}
   */
  async getEntry(id) {
    logger.debug('[getEntry] Retrieving entry with ID:', { id })

    assert(id !== null && id !== undefined && id !== '', 'Entry ID must be provided and cannot be empty')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/entries/${ id }`,
        method: 'get',
        logTag: 'getEntry',
      })

      logger.info(`[getEntry] Successfully retrieved entry ${ id } from form ${ result.form_id }`)

      return result
    } catch (error) {
      logger.error(`[getEntry] Failed to retrieve entry ${ id }: ${ error.message }`)
      throw new Error(`Failed to retrieve Gravity Forms entry ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Delete an existing form entry permanently or move it to trash. Use force parameter to control whether the entry is permanently removed or can be restored later.
   *
   * @route DELETE /entry
   * @operationName Delete Entry
   * @category Entry Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"id","required":true,"description":"Unique identifier of the entry to delete. Warning: This action cannot be undone when force parameter is true."}
   * @paramDef {"type":"Boolean","label":"Force","name":"force","uiComponent":{"type":"TOGGLE"},"description":"Set to true to permanently delete the entry. When false, entry is moved to trash and can be restored."}
   *
   * @returns {Object} Deletion confirmation with details of the deleted entry
   * @sampleResult {"deleted":true,"previous":{"1":"John Doe","2":"john@example.com","3":"Thank you for your service!","id":"125","form_id":"15","date_created":"2024-08-01 15:30:00","date_updated":"2024-08-01 15:30:00","is_starred":"0","is_read":"1","ip":"192.168.1.100","source_url":"https://example.com/contact","status":"active"}}
   */
  async deleteEntry(id, force) {
    logger.debug('[deleteEntry] Deleting entry with parameters:', { id, force })

    assert(id !== null && id !== undefined && id !== '', 'Entry ID must be provided and cannot be empty')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/entries/${ id }`,
        method: 'delete',
        query: { force: force ? 1 : 0 },
        logTag: 'deleteEntry',
      })

      const action = force ? 'permanently deleted' : 'moved to trash'
      logger.info(`[deleteEntry] Successfully ${ action } entry ${ id }`)

      return result
    } catch (error) {
      logger.error(`[deleteEntry] Failed to delete entry ${ id }: ${ error.message }`)
      throw new Error(`Failed to delete Gravity Forms entry ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Retrieve all entries submitted to a specific form with pagination support. This method returns entry data along with submission metadata and total counts for management and analysis purposes.
   *
   * @route GET /entries/form
   * @operationName Get Form Entries
   * @category Entry Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsListDictionary","description":"Unique identifier of the form to retrieve entries from. Only entries belonging to this form will be returned."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","description":"Number of entries to return per page. Maximum recommended is 100. Default is 20 if not specified."}
   * @paramDef {"type":"Number","label":"Page","name":"page","description":"Page number to retrieve, starting from 1. Use with Page Size for paginated results."}
   *
   * @returns {Object} Object containing array of entries and total count for pagination
   * @sampleResult {"entries":[{"1":"John Doe","2":"john@example.com","3":"Great service, thank you!","id":"125","form_id":"15","date_created":"2024-08-01 15:30:00","is_read":"0","is_starred":"0","ip":"192.168.1.100","status":"active"},{"1":"Jane Smith","2":"jane@example.com","3":"Looking forward to hearing from you.","id":"126","form_id":"15","date_created":"2024-08-01 16:15:00","is_read":"1","is_starred":"1","ip":"192.168.1.101","status":"active"}],"total_count":25}
   */
  async getFormEntries(formId, pageSize, page) {
    logger.debug('[getFormEntries] Retrieving entries for form:', { formId, pageSize, page })

    assert(formId !== null && formId !== undefined && formId !== '', 'Form ID must be provided and cannot be empty')

    const actualPageSize = pageSize || 20
    const actualPage = page || 1

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ formId }/entries`,
        method: 'get',
        query: {
          'paging[page_size]': actualPageSize,
          'paging[current_page]': actualPage,
        },
        logTag: 'getFormEntries',
      })

      const entriesCount = result.entries ? result.entries.length : 0
      logger.info(`[getFormEntries] Retrieved ${ entriesCount } entries for form ${ formId } (page ${ actualPage }, total: ${ result.total_count })`)

      return result
    } catch (error) {
      logger.error(`[getFormEntries] Failed to retrieve entries for form ${ formId }: ${ error.message }`)
      throw new Error(`Failed to retrieve entries for Gravity Forms form ${ formId }: ${ error.message }`)
    }
  }

  /**
   * @description Manually trigger notifications for a specific form entry. This method sends all configured notifications for the entry, useful for resending notifications or triggering them for entries created directly via API.
   *
   * @route POST /entry/notify
   * @operationName Send Entry Notification
   * @category Notification Management
   *
   * @appearanceColor #f15a2b #ea3b04
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Entry ID","name":"id","required":true,"dictionary":"getFormEntriesDictionary","dependsOn":["formId"],"description":"Unique identifier of the entry to send notifications for. All configured notifications for the entry's form will be triggered."}
   * @paramDef {"type":"String","label":"Form ID","name":"formId","dictionary":"getFormsListDictionary","description":"Form ID to retrieve entries from for notification (used for entry selection only)"}
   *
   * @returns {Array} Array of notification IDs that were successfully processed and sent
   * @sampleResult ["admin_notify_5f8a2b1c3d4e5","user_confirm_5f8a2b1c3d4e6"]
   */
  async sendEntryNotification(id, formId) {
    logger.debug('[sendEntryNotification] Sending notifications for entry:', { id, formId })

    assert(id !== null && id !== undefined && id !== '', 'Entry ID must be provided and cannot be empty')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/entries/${ id }/notifications`,
        method: 'post',
        logTag: 'sendEntryNotification',
      })

      const notificationCount = Array.isArray(result) ? result.length : 0
      logger.info(`[sendEntryNotification] Successfully sent ${ notificationCount } notifications for entry ${ id }`)

      return result
    } catch (error) {
      logger.error(`[sendEntryNotification] Failed to send notifications for entry ${ id }: ${ error.message }`)
      throw new Error(`Failed to send notifications for Gravity Forms entry ${ id }: ${ error.message }`)
    }
  }

  /**
   * @description Dictionary method to provide searchable list of available forms for selection in other methods. Returns forms with ID, title, and entry count for easy identification and selection.
   *
   * @route POST /get-forms-list-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing optional search, cursor, and criteria for filtering forms"}
   *
   * @returns {Object} Object containing array of form options and optional pagination cursor
   * @sampleResult {"items":[{"label":"Contact Form (25 entries)","value":"15","note":"Active form created on 2024-08-01"},{"label":"Newsletter Signup (142 entries)","value":"16","note":"Active form created on 2024-07-28"},{"label":"Product Inquiry (8 entries)","value":"17","note":"Active form created on 2024-07-25"}],"cursor":null}
   */
  async getFormsListDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    logger.debug('[getFormsListDictionary] Retrieving forms for dictionary:', { search, cursor, criteria })

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms`,
        method: 'get',
        logTag: 'getFormsListDictionary',
      })

      let formsList = Object.values(result)

      // Apply search filter if provided
      if (search && search.trim()) {
        const searchTerm = search.toLowerCase().trim()

        formsList = formsList.filter(form => 
          form.title && form.title.toLowerCase().includes(searchTerm)
        )
      }

      // Apply criteria filters if provided
      if (criteria) {
        if (criteria.isActive !== undefined) {
          formsList = formsList.filter(form => form.is_active === (criteria.isActive ? '1' : '0'))
        }

        if (criteria.minEntries !== undefined) {
          formsList = formsList.filter(form => parseInt(form.entries || '0') >= criteria.minEntries)
        }
      }

      // Convert to dictionary format
      const items = formsList.map(form => ({
        label: `${ form.title } (${ form.entries || '0' } entries)`,
        value: form.id,
        note: `${ form.is_active === '1' ? 'Active' : 'Inactive' } form created on ${ form.date_created ? form.date_created.split(' ')[0] : 'unknown date' }`,
      }))

      logger.info(`[getFormsListDictionary] Retrieved ${ items.length } form options${ search ? ` (filtered by: "${ search }")` : '' }`)

      return {
        items,
        cursor: null, // Simple implementation without pagination
      }
    } catch (error) {
      logger.error(`[getFormsListDictionary] Failed to retrieve forms dictionary: ${ error.message }`)
      throw new Error(`Failed to retrieve Gravity Forms dictionary: ${ error.message }`)
    }
  }

  /**
   * @description Dictionary method to provide searchable list of entries for a specific form. Returns entries with ID, submission date, and key field values for easy identification and selection.
   *
   * @route POST /get-form-entries-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing formId (required), optional search, cursor, and criteria for filtering entries"}
   *
   * @returns {Object} Object containing array of entry options and optional pagination cursor
   * @sampleResult {"items":[{"label":"Entry #125 - John Doe (2024-08-01)","value":"125","note":"john@example.com - Status: active"},{"label":"Entry #126 - Jane Smith (2024-08-01)","value":"126","note":"jane@example.com - Status: active, Starred"}],"cursor":null}
   */
  async getFormEntriesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const formId = criteria?.formId
    logger.debug('[getFormEntriesDictionary] Retrieving entries dictionary:', { formId, search, cursor, criteria })

    assert(formId !== null && formId !== undefined && formId !== '', 'Form ID is required for entries dictionary')

    try {
      const result = await this.#apiRequest({
        url: `${ this.baseUrl }/forms/${ formId }/entries`,
        method: 'get',
        query: {
          'paging[page_size]': 50, // Reasonable limit for dictionary
          'paging[current_page]': 1,
        },
        logTag: 'getFormEntriesDictionary',
      })

      let entries = result.entries || []

      // Apply search filter if provided
      if (search && search.trim()) {
        const searchTerm = search.toLowerCase().trim()

        entries = entries.filter(entry => {
          // Search in entry field values
          const entryValues = Object.values(entry).join(' ').toLowerCase()

          return entryValues.includes(searchTerm)
        })
      }

      // Apply criteria filters if provided
      if (criteria) {
        if (criteria.status) {
          entries = entries.filter(entry => entry.status === criteria.status)
        }

        if (criteria.isStarred !== undefined) {
          entries = entries.filter(entry => entry.is_starred === (criteria.isStarred ? '1' : '0'))
        }

        if (criteria.isRead !== undefined) {
          entries = entries.filter(entry => entry.is_read === (criteria.isRead ? '1' : '0'))
        }
      }

      // Convert to dictionary format
      const items = entries.map(entry => {
        // Try to get first few field values for display
        const fieldKeys = Object.keys(entry).filter(key => /^\d+$/.test(key)).slice(0, 2)
        const displayValues = fieldKeys.map(key => entry[key]).filter(val => val && val.trim()).slice(0, 1)
        const displayName = displayValues.length > 0 ? displayValues[0] : `Entry #${ entry.id }`
        
        const date = entry.date_created ? entry.date_created.split(' ')[0] : 'unknown date'
        const label = `Entry #${ entry.id } - ${ displayName } (${ date })`
        
        // Build note with additional context
        const noteItems = []
        if (entry['2'] && entry['2'] !== displayValues[0]) noteItems.push(entry['2']) // Often email field
        if (entry.status) noteItems.push(`Status: ${ entry.status }`)
        if (entry.is_starred === '1') noteItems.push('Starred')
        const note = noteItems.join(' - ')

        return {
          label,
          value: entry.id,
          note: note || `Form ${ formId } entry`,
        }
      })

      logger.info(`[getFormEntriesDictionary] Retrieved ${ items.length } entry options for form ${ formId }${ search ? ` (filtered by: "${ search }")` : '' }`)

      return {
        items,
        cursor: null, // Simple implementation without pagination
      }
    } catch (error) {
      logger.error(`[getFormEntriesDictionary] Failed to retrieve entries dictionary for form ${ formId }: ${ error.message }`)
      throw new Error(`Failed to retrieve entries dictionary for Gravity Forms form ${ formId }: ${ error.message }`)
    }
  }
}

Flowrunner.ServerCode.addService(GravityForms, [
  {
    order: 0,
    displayName: 'Site URL',
    name: 'siteUrl',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your WordPress site\'s complete URL including protocol and domain. Example: \'https://yoursite.com\'. Find this in WordPress Admin > Settings > General > Site Address (URL). Do not include trailing slash.',
  },
  {
    order: 1,
    displayName: 'Consumer Key',
    name: 'consumerKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'REST API consumer key for authentication. Create in WordPress Admin > Forms > Settings > REST API > Add Key. Copy the generated Consumer Key exactly as displayed.',
  },
  {
    order: 2,
    displayName: 'Consumer Secret',
    name: 'consumerSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'REST API consumer secret for authentication. Create alongside the Consumer Key in WordPress Admin > Forms > Settings > REST API > Add Key. Copy the generated Consumer Secret exactly as displayed.',
  },
])
