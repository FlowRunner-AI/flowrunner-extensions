const Auth = require('@googleapis/oauth2')
const Drive = require('@googleapis/drive')
const Forms = require('@googleapis/forms')

const { JSON_Templates } = require('./form-templates')
const { OptionsShaper, searchFilter, validateFields } = require('./utils')

const AUTHORIZATION_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const logger = {
  info: (...args) => console.log('[Google Forms Service] info:', ...args),
  debug: (...args) => console.log('[Google Forms Service] debug:', ...args),
  error: (...args) => console.log('[Google Forms Service] error:', ...args),
  warn: (...args) => console.log('[Google Forms Service] warn:', ...args),
}

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/forms',
].join(' ')

const GOOGLE_FROM_MIME_TYPE = 'application/vnd.google-apps.form'
const DEFAULT_LIMIT = 100


/**
 *  @requireOAuth
 *  @integrationName Google Forms
 *  @integrationIcon /icon.png
 **/
class GoogleForms {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scope = DEFAULT_SCOPES
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #initDrive() {
    const auth = new Auth.auth.OAuth2()

    auth.setCredentials({
      access_token: this.#getAccessToken(),
      scope: this.scope,
      token_type: 'Bearer',
    })

    return Drive.drive({ version: 'v3', auth })
  }

  #initForm() {
    const auth = new Auth.auth.OAuth2()

    auth.setCredentials({
      access_token: this.#getAccessToken(),
      scope: this.scope,
      token_type: 'Bearer',
    })

    return Forms.forms({ version: 'v1', auth })
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('scope', this.scope)
    params.append('access_type', 'offline')
    params.append('prompt', 'consent')

    const url = `${ AUTHORIZATION_URL }?${ params.toString() }`

    logger.debug('Get OAuth2 Connection URL:', url)

    return url
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    logger.debug('Refresh Token param:', refreshToken)

    try {
      const { access_token: token, expires_in: expirationInSeconds } = await Flowrunner.Request.post(TOKEN_URL)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .query({
          client_id: this.clientId,
          scope: this.scope,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
          client_secret: this.clientSecret,
        })

      logger.debug('Refresh Token response:', { token, expirationInSeconds })

      return { token, expirationInSeconds }
    } catch (error) {
      logger.error('Refresh Token error:', error)

      if (error.error === 'invalid_grant') {
        throw new Error('Refresh token expired or invalid, please re-authenticate.')
      }

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {Object} userData
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    logger.debug('Execute Callback callbackObject:', callbackObject)

    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('grant_type', 'authorization_code')
    params.append('client_secret', this.clientSecret)

    const { access_token, expires_in, refresh_token } = await Flowrunner.Request.post(TOKEN_URL)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    let identityName, identityImageURL

    logger.debug('Execute Callback response:', { access_token, expires_in, refresh_token })

    try {
      const { name, email, picture } = await Flowrunner.Request.get(PROFILE_URL)
        .set({ Authorization: `Bearer ${ access_token }` })
        .send()

      identityName = `${ name } (${ email })`
      identityImageURL = picture
    } catch (e) {
      logger.warn("Can't load user profile", { error: e.error, currentScope: this.scope })
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: identityName || 'Google Form User',
      connectionIdentityImageURL: identityImageURL,
    }
  }

  // ========================================== DICTIONARIES ===========================================

  /**
   * @typedef {Object} getFormsDictionary__payload
   * @property {String} [search] - Search term to filter forms
   * @property {String} [cursor] - Pagination cursor for next page of results
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {any} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @description Retrieves a list of Google Forms for dictionary selection.
   * @registerAs DICTIONARY
   * @operationName Get Forms Dictionary
   * @route GET /get-forms-dictionary
   * @paramDef {"type":"getFormsDictionary_payload","label":"Payload","name":"payload","description":"Dictionary request payload with search and cursor parameters"}
   * @sampleResult {"items":[{"label":"Sample Form","value":"form123","note":"Created on 2024-01-01"}],"cursor":"next_page_token"}
   * @param {getFormsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const drive = this.#initDrive()

    try {
      const { data } = await drive.files.list({
        q: `mimeType='${ GOOGLE_FROM_MIME_TYPE }'`,
        fields: 'nextPageToken, files(id, name)',
        pageSize: DEFAULT_LIMIT,
        pageToken: cursor,
      })

      const forms = search ? searchFilter(data.files, ['id', 'name'], search) : data.files

      return {
        items: forms.map(OptionsShaper.base),
        cursor: data.nextPageToken,
      }
    } catch (error) {
      logger.error('Get Forms Dictionary error:', error)
      throw new Error(`Failed to retrieve forms dictionary: ${ error.message }`)
    }
  }

  /**
   * @typedef {Object} getFormResponsesDictionary__payloadCriteria
   * @property {String} formId - The ID of the form to get responses for
   */

  /**
   * @typedef {Object} getFormResponsesDictionary__payload
   * @property {String} [search] - Search term to filter responses
   * @property {String} [cursor] - Pagination cursor for next page of results
   * @property {getFormResponsesDictionary__payloadCriteria} [criteria] - Selection criteria containing formId
   */

  /**
   * @description Retrieves a list of form responses for dictionary selection.
   * @registerAs DICTIONARY
   * @operationName Get Form Responses Dictionary
   * @route GET /get-form-responses-dictionary
   * @paramDef {"type":"getFormResponsesDictionary_payload","label":"Payload","name":"payload","description":"Dictionary request payload with search, cursor, and criteria parameters"}
   * @sampleResult {"items":[{"label":"Response 123","value":"response123","note":"Submitted on 2024-01-01"}],"cursor":"next_page_token"}
   * @param {getFormResponsesDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getFormResponsesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const { formId } = criteria || {}
    const form = this.#initForm()

    try {
      const { data } = await form.forms.responses.list({
        formId,
        pageSize: DEFAULT_LIMIT,
        pageToken: cursor,
      })

      const responses = search ? searchFilter(data.responses || [], ['responseId'], search) : (data.responses || [])

      return {
        items: responses.map(OptionsShaper.response),
        cursor: data.nextPageToken,
      }
    } catch (error) {
      logger.error('Get Form Responses Dictionary error:', error)
      throw new Error(`Failed to retrieve form responses dictionary: ${ error.message }`)
    }
  }

  // ======================================= END OF DICTIONARIES =======================================

  /**
   * @description Retrieves a list of Google Forms available in Google Drive.
   *
   * @route GET /get-forms-list
   * @operationName Get Forms List
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive.readonly
   *
   * @returns {Array<Object>} List of forms with their IDs and names.
   * @sampleResult [{"name": "<form_name>","id": "<form_id>"}]
   *
   * @throws {Error} If an error occurs while retrieving forms list from Google Drive.
   */

  async getFormsList() {
    logger.debug('Get Forms List call')

    const drive = this.#initDrive()

    try {
      const response = await drive.files.list({
        q: `mimeType='${ GOOGLE_FROM_MIME_TYPE }'`,
        fields: 'files(id, name)',
      })

      logger.debug('Get Forms List response:', response)

      return response.data.files
    } catch (error) {
      logger.error('Get Forms List error:', error)

      throw error
    }
  }

  /**
   * @description Deletes a Google Form by its ID.
   *
   * @route DELETE /delete-form
   * @operationName Delete Form
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to be deleted."}
   *
   * @returns {void}
   *
   * @throws {Error} If an error occurs while deleting the form from Google Drive.
   */
  async deleteForm(formId) {
    validateFields({ 'Form ID': formId })

    logger.debug('Delete Form formId:', formId)

    const drive = this.#initDrive()

    try {
      const response = await drive.files.delete({
        fileId: formId,
      })

      logger.debug('Delete Form response:', response)

      return response.data
    } catch (error) {
      logger.error('Delete Form error:', error)

      throw error
    }
  }

  /**
   * @description Creates a new Google Form.
   *
   * @route POST /create-form
   * @operationName Create Form
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/forms.body
   *
   * @paramDef {"type":"String","label":"Form Title","name":"title","required":true,"description":"The form title to be set, other fields can be added in Update From block"}
   * @paramDef {"type":"String","label":"Template Name","name":"templateName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Empty","Contact Information","Order Request","Job Application","Customer Feedback"]}},"description":"The template to use for the form. Other fields can be added in the Update Form block"}
   *
   * @returns {Object} The details of the newly created form.
   * @sampleResult {"formId":"EXAMPLE_FORM_ID","revisionId":"EXAMPLE_REVISION_ID","settings":{},"responderUri":"https://example.com/form/viewform","info":{"title":"Sample Title","documentTitle":"Sample Document Title"}}
   * @throws {Error} If an error occurs while creating the form in Google Forms.
   */
  async createForm(title, templateName) {
    validateFields({ 'Form Title': title })

    logger.debug('Create Form params', { title, templateName })

    const form = this.#initForm()

    const template = JSON_Templates[templateName]
    let createFormResponse, updateResponse

    try {
      createFormResponse = await form.forms.create({
        requestBody: { info: { title } },
      })

      logger.debug('Create Form createFormResponse', createFormResponse)

      if (template) {
        updateResponse = await form.forms.batchUpdate({
          formId: createFormResponse.data.formId,
          requestBody: {
            includeFormInResponse: true,
            requests: template,
          },
        })
      }

      logger.debug('Create Form updateResponse', updateResponse)

      return updateResponse?.data || createFormResponse.data
    } catch (error) {
      logger.error('Create Form error', error)

      throw error
    }
  }

  /**
   * @description Updates a Google Form using the batchUpdate request. This method allows for multiple item modifications within a single request, including adding, updating, or removing form items. Refer to the official Google Forms API documentation for more details on the structure and supported operations https://developers.google.com/forms/api/reference/rest/v1/forms/batchUpdate .
   *
   * @route POST /update-form-batch
   * @operationName Update Form Advanced
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/forms.body
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to update."}
   * @paramDef {"type":"Object","label":"Body JSON Structure","name":"bodyJSON","required":true,"description":"The JSON structure containing operations to update multiple items within the form. This includes adding, updating, or removing form items as specified by the API."}
   *
   * @returns {Object} The updated form details.
   *
   * @throws {Error} If an error occurs while updating the form properties.
   */

  async updateFormAdvanced(formId, bodyJSON) {
    validateFields({ 'Form ID': formId })

    logger.debug('Update Form (Advanced)', { formId, bodyJSON })

    const form = this.#initForm()

    try {
      const response = await form.forms.batchUpdate({
        formId,
        requestBody: bodyJSON,
      })

      logger.debug('Update Form response', response)

      return response.data
    } catch (error) {
      logger.error('Update Form error', error)

      throw error
    }
  }

  /**
   * @description Move Field Form.
   *
   * @route POST /move-field-form
   * @operationName Change Field Position
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/forms.body
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to update."}
   * @paramDef {"type":"Number","label":"Original Position Index","name":"originalIndex","required":true,"description":"The original index of the field to be moved. Indices are zero-based."}
   * @paramDef {"type":"Number","label":"New Position Index","name":"newIndex","required":true,"description":"The new index where the field should be moved to. Indices are zero-based."}
   *
   * @returns {Object} The move field form details.
   * @sampleResult {"replies":[{}],"writeControl":{"requiredRevisionId":"EXAMPLE_REVISION_ID"}}
   *
   * @throws {Error} If an error occurs while updating the form properties.
   */

  async moveFieldForm(formId, originalIndex, newIndex) {
    validateFields({ 'Form ID': formId })

    logger.debug('Change Field Position', { formId, originalIndex, newIndex })

    const form = this.#initForm()

    try {
      const response = await form.forms.batchUpdate({
        formId,
        requestBody: {
          requests: [
            {
              moveItem: {
                original_location: {
                  index: originalIndex,
                },
                newLocation: {
                  index: newIndex,
                },
              },
            },
          ],
        },
      })

      logger.debug('Change Field response', response)

      return response.data
    } catch (error) {
      logger.error('Change Field error', error)

      throw error
    }
  }

  /**
   * @description Delete Field Form.
   *
   * @route POST /delete-field-form
   * @operationName Delete Field Form
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/forms.body
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to update."}
   * @paramDef {"type":"Number","label":"Field Index","name":"fieldIndex","required":true,"description":"The index of the field to delete."}
   *
   * @returns {Object} The updated form details with the field deleted.
   * @sampleResult {"replies":[{}],"writeControl":{"requiredRevisionId":"EXAMPLE_REVISION_ID"}}
   *
   * @throws {Error} If an error occurs while deleting the field from the form.
   */

  async deleteFieldForm(formId, fieldIndex) {
    validateFields({ 'Form ID': formId })

    logger.debug('Delete Field Form', { formId, fieldIndex })

    const form = this.#initForm()

    try {
      const response = await form.forms.batchUpdate({
        formId,
        requestBody: { requests: [{ deleteItem: { location: { index: fieldIndex } } }] },
      })

      logger.debug('Delete Field response', response)

      return response.data
    } catch (error) {
      logger.error('Delete Field error', error)

      throw error
    }
  }

  /**
   * @description Retrieves details of a specified Google Form by its ID.
   *
   * @route POST /get-form-details
   * @operationName Get Form Details
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/drive.readonly | https://www.googleapis.com/auth/forms.body | https://www.googleapis.com/auth/forms.body.readonly
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to retrieve."}
   *
   * @returns {Object} The form details, including title, questions, and settings.
   * @sampleResult {"formId":"EXAMPLE_FORM_ID","revisionId":"EXAMPLE_REVISION_ID","settings":{},"responderUri":"https://example.com/form/viewform","items":[{"itemId":"EXAMPLE_ITEM_ID","questionItem":{"question":{"choiceQuestion":{"options":[{"value":"Option 1"},{"value":"Option 2"}],"type":"RADIO"},"questionId":"EXAMPLE_QUESTION_ID"}},"title":"Sample question title"}],"info":{"description":"Sample description","title":"Sample Form Title","documentTitle":"Sample Document Title"}}
   * @throws {Error} If an error occurs while retrieving the form details from Google Forms.
   */

  async getFormDetails(formId) {
    validateFields({ 'Form ID': formId })

    logger.debug('Get Form Details formId:', formId)

    const form = this.#initForm()

    try {
      const response = await form.forms.get({ formId })

      logger.debug('Get Form Details response:', response)

      return response.data
    } catch (error) {
      logger.error('Get Form Details error:', error)

      throw error
    }
  }

  /**
   * @description Lists all responses for a specified Google Form.
   *
   * @route POST /get-form-responses
   * @operationName Get Form Responses List
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/forms.responses.readonly
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to get responses for."}
   *
   * @returns {Object} List of responses with details.
   * @sampleResult {"responses":[{"createTime":"2024-11-08T09:15:27.151Z","answers":{"EXAMPLE_QUESTION_ID_1":{"questionId":"EXAMPLE_QUESTION_ID_1","textAnswers":{"answers":[{"value":"Sample answer 1"}]}},"EXAMPLE_QUESTION_ID_2":{"questionId":"EXAMPLE_QUESTION_ID_2","textAnswers":{"answers":[{"value":"Sample answer 2"}]}}},"lastSubmittedTime":"2024-11-08T09:15:27.151403Z","responseId":"EXAMPLE_RESPONSE_ID"}]}
   *
   * @throws {Error} If an error occurs while retrieving the responses for the form.
   */

  async getFormResponsesList(formId) {
    validateFields({ 'Form ID': formId })

    logger.debug('Get Form Responses List, formId:', formId)

    const form = this.#initForm()

    try {
      const response = await form.forms.responses.list({ formId })

      logger.debug('Get Form Responses List response:', response)

      return response.data
    } catch (error) {
      logger.error('Get Form Responses List error:', error)

      throw error
    }
  }

  /**
   * @description Retrieves a specific response for a Google Form by its response ID.
   *
   * @route POST /get-form-response
   * @operationName Get Form Response by ID
   * @appearanceColor #7f3bb8 #dac4ed
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes https://www.googleapis.com/auth/drive | https://www.googleapis.com/auth/drive.file | https://www.googleapis.com/auth/forms.responses.readonly
   *
   * @paramDef {"type":"String","label":"Form ID","name":"formId","required":true,"dictionary":"getFormsDictionary","description":"The ID of the form to retrieve a response from."}
   * @paramDef {"type":"String","label":"Response ID","name":"responseId","required":true,"dictionary":"getFormResponsesDictionary","dependsOn":["formId"],"description":"The ID of the specific response to retrieve."}
   *
   * @returns {Object} The response details for the specified response ID.
   *
   * @throws {Error} If an error occurs while retrieving the specific response.
   */

  async getFormResponseById(formId, responseId) {
    validateFields({ 'Form ID': formId, 'Response ID': responseId })

    logger.debug('Get Form Response by ID params:', { formId, responseId })

    const form = this.#initForm()

    try {
      const response = await form.forms.responses.get({
        formId,
        responseId,
      })

      logger.debug('Get Form Response by ID response:', response)

      return response.data
    } catch (error) {
      logger.error('Get Form Response by ID error:', error)

      throw error
    }
  }
}

Flowrunner.ServerCode.addService(GoogleForms, [
  {
    order: 0,
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client ID from Google Developer Console. Optional - uses default if not provided.',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'Client Secret from Google Developer Console. Optional - uses default if not provided.',
  },
])
