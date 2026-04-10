'use strict'

const { cleanupObject, searchFilter, transformFormData, groupFormDataByOrder } = require('./utils')

const logger = {
  info: (...args) => console.log('[JotForm Service] info:', ...args),
  debug: (...args) => console.log('[JotForm Service] debug:', ...args),
  error: (...args) => console.log('[JotForm Service] error:', ...args),
  warn: (...args) => console.log('[JotForm Service] warn:', ...args),
}

const ApiBaseUrl = {
  USA: 'https://api.jotform.com',
  Europe: 'https://eu-api.jotform.com',
}

const DEFAULT_LIMIT = 100

/**
 * @integrationName Jotform
 * @integrationIcon /icon.svg
 **/
class Jotform {
  constructor(config) {
    this.apiKey = config.apiKey
    this.baseUrl = ApiBaseUrl[config.dataStoreRegion]
  }

  async #apiRequest({ url, method, query, body, logTag, isJSON }) {
    method = method || 'get'
    query = cleanupObject(query)
    body = isJSON ? JSON.stringify(body) : new URLSearchParams(body).toString()

    const headers = isJSON
      ? { 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/x-www-form-urlencoded' }

    try {
      let response

      if (method === 'get' || method === 'delete') {
        logger.debug(`[${ logTag }] API Request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

        response = await Flowrunner.Request[method](url)
          .set(headers)
          .query({ ...query, apiKey: this.apiKey })
      } else {
        logger.debug(`[${ logTag }] API Request: [${ method }::${ url }], body=${ JSON.stringify(body) }`)
        response = await Flowrunner.Request[method](url).set(headers).query({ apiKey: this.apiKey }).send(body)
      }

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error: ${ JSON.stringify(error.body) }`)

      throw error
    }
  }

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {String} [cursor]
   */

  /**
   * @typedef {Object} DictionaryItem
   * @property {String} label
   * @property {String} value
   * @property {String} note
   */

  /**
   * @typedef {Object} DictionaryResponse
   * @property {Array<DictionaryItem>} items
   * @property {String} cursor
   */

  /**
   * @registerAs DICTIONARY
   * @route POST /get-user-forms-dictionary
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","description":"Dictionary payload containing search and cursor parameters"}
   * @returns {DictionaryResponse}
   */
  async getUserFormsDictionary(payload) {
    const { search, cursor } = payload || {}
    const { content: forms, resultSet } = await this.#apiRequest({
      logTag: 'getUserFormsDictionary',
      url: `${ this.baseUrl }/user/forms`,
      query: { offset: cursor, limit: DEFAULT_LIMIT },
    })

    const availableForms = forms.filter(form => form.status !== 'DELETED')
    const filteredForms = search ? searchFilter(availableForms, ['id', 'title'], search) : availableForms

    return {
      cursor: resultSet.offset + DEFAULT_LIMIT,
      items: filteredForms.map(({ id, title }) => ({
        label: title || '[empty]',
        note: `ID: ${ id }`,
        value: id,
      })),
    }
  }

  /**
   * @typedef {Object} FormContent
   * @property {String} id
   * @property {String} username
   * @property {String} title
   * @property {String} height
   * @property {String} status
   * @property {String} created_at
   * @property {String} updated_at
   * @property {String} last_submission
   * @property {Number} new
   * @property {Number} count
   * @property {String} type
   * @property {Boolean} favorite
   * @property {Boolean} archived
   * @property {String} url
   */

  /**
   * @typedef {Object} JotformResponse
   * @property {Number} responseCode
   * @property {String} message
   * @property {FormContent} content
   * @property {String} duration
   * @property {any} info
   * @property {Number} limit-left
   */

  /**
   * @typedef {Object} Sublabels
   * @property {String} prefix
   * @property {String} first
   * @property {String} middle
   * @property {String} last
   * @property {String} suffix
   */

  /**
   * @typedef {Object} QuestionContent
   * @property {String} hint
   * @property {String} labelAlign
   * @property {String} middle
   * @property {String} name
   * @property {String} order
   * @property {String} prefix
   * @property {String} qid
   * @property {String} readonly
   * @property {String} required
   * @property {String} shrink
   * @property {Sublabels} sublabels
   * @property {String} suffix
   * @property {Number} size
   * @property {Number} text
   * @property {String} type
   * @property {Boolean} validation
   */

  /**
   * @typedef {Object} JotformQuestionsResponse
   * @property {Number} responseCode
   * @property {String} message
   * @property {Object.<String, QuestionContent>} content
   * @property {String} duration
   * @property {any} info
   * @property {Number} limit-left
   */

  /**
   * @typedef {Object} AnswerObject
   * @property {String} first
   * @property {String} last
   */

  /**
   * @typedef {Object} Answer
   * @property {String} name
   * @property {String} text
   * @property {String} type
   * @property {String} order
   * @property {String|AnswerObject} answer
   * @property {String} sublabels
   * @property {String} prettyFormat
   */

  /**
   * @typedef {Object} SubmissionContent
   * @property {String} new
   * @property {String} flag
   * @property {String} notes
   * @property {String} updated_at
   * @property {String} ip
   * @property {String} form_id
   * @property {Object.<String, Answer>} answers
   * @property {String} created_at
   * @property {String} id
   * @property {String} status
   * @property {String} workflowStatus
   */

  /**
   * @typedef {Object} ResultSet
   * @property {Number} offset
   * @property {Number} limit
   * @property {String} orderby
   * @property {Object<String,String>} filter
   * @property {Number} count
   */

  /**
   * @typedef {Object} JotformSubmissionsResponse
   * @property {Number} responseCode
   * @property {String} message
   * @property {Array.<SubmissionContent>} content
   * @property {String} duration
   * @property {any} info
   * @property {ResultSet} resultSet
   * @property {Number} limit-left
   */

  /**
   * @typedef {Object} UserUsageContent
   * @property {String} username
   * @property {String} submissions
   * @property {String} overSubmissions
   * @property {String} ssl_submissions
   * @property {String} payments
   * @property {String} uploads
   * @property {String} total_submissions
   * @property {String} tickets
   * @property {String} views
   * @property {String} signed_documents
   * @property {any} workflow_runs
   * @property {String} ai_conversations
   * @property {any} ai_messages
   * @property {String} ai_sessions
   * @property {String} ai_phone_call
   * @property {String} ai_agent_sms
   * @property {any} ai_chatbot_conversations
   * @property {String} pdf_attachment_submissions
   * @property {String} monthly_usage_reset_date
   * @property {String} mobile_submissions
   * @property {Number} api
   * @property {String} form_count
   * @property {Number} ai_agents
   * @property {any} ai_chatbot_agents
   * @property {String} ai_knowledge_base
   * @property {String} created_at
   */

  /**
   * @typedef {Object} UserUsageResponse
   * @property {Number} responseCode
   * @property {String} message
   * @property {UserUsageContent} content
   * @property {String} duration
   * @property {any} info
   * @property {Number} limit-left
   */

  /**
   * @description Creates a new form with questions, properties, and email settings. Each question must include required fields: type, text, order, and name.
   *
   * @route POST /form
   * @operationName Create New Form
   * @category Form Management
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Form Title","name":"title","required":true,"description":"The title of the form"}
   * @paramDef {"type":"Array.<Object>","label":"Questions","name":"questions","required":true,"description":"A list of question objects to include in the form. Each question must include the required fields: type, text, order, and name"}
   * @paramDef {"type":"String","label":"Form Height","name":"height","description":"The height of the form in pixels"}
   * @paramDef {"type":"Array.<Object>","label":"Email Settings","name":"emails","description":"A list of email notification settings to configure for the form"}
   *
   * @sampleResult {"responseCode":200,"message":"success","content":{"id":"251331365303345","username":"janedoe92","title":"CustomerFeedbackForm","height":"690","status":"ENABLED","created_at":"2025-05-1410:22:33","updated_at":"2025-05-1410:22:33","last_submission":null,"new":0,"count":0,"type":"LEGACY","favorite":false,"archived":false,"url":"https://form.jotform.com/251331365303345"},"duration":"280.29ms","info":null,"limit-left":988}
   * @returns {JotformResponse}
   */
  createForm(title, questions, height, emails) {
    const payload = {
      ...transformFormData(questions, 'questions'),
      ...transformFormData({ title, height }, 'properties'),
      ...transformFormData(emails, 'emails'),
    }

    return this.#apiRequest({
      url: `${ this.baseUrl }/form`,
      method: 'post',
      body: payload,
      logTag: 'createForm',
    })
  }

  /**
   * @description Gets a list of all questions on a form. Returns detailed question configuration including field types, validation rules, and display properties.
   *
   * @route GET /form-questions
   * @operationName Get Form Questions
   * @category Form Management
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Form","name":"id","required":true,"dictionary":"getUserFormsDictionary","description":"The ID of the form"}
   *
   * @sampleResult {"responseCode":200,"message":"success","content":{"1":{"hint":"","labelAlign":"Auto","name":"textboxExample1","order":"1","qid":"1","readonly":"No","required":"No","shrink":"No","size":"20","text":"TextboxExample","type":"control_textbox","validation":"None"},"2":{"labelAlign":"Auto","middle":"No","name":"fullName2","order":"1","prefix":"No","qid":"2","readonly":"No","required":"No","shrink":"Yes","sublabels":{"prefix":"Prefix","first":"FirstName","middle":"MiddleName","last":"LastName","suffix":"Suffix"},"suffix":"No","text":"FullName","type":"control_fullname"}},"limit-left":4982}
   * @returns {JotformQuestionsResponse}
   */
  getFormQuestions(id) {
    return this.#apiRequest({ url: `${ this.baseUrl }/form/${ id }/questions`, logTag: 'getFormQuestions' })
  }

  /**
   * @description Adds new questions to a specified form. Each question must include required fields: type, text, order, and name.
   *
   * @route PUT /add-questions
   * @operationName Add Questions to Form
   * @category Form Management
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Form","name":"id","required":true,"dictionary":"getUserFormsDictionary","description":"The ID of the form"}
   * @paramDef {"type":"Array.<Object>","label":"Questions","name":"questions","required":true,"description":"A list of question objects to include in the form. Each question must include the required fields: type, text, order, and name"}
   *
   * @sampleResult {"duration":"130.26ms","limit-left":843,"message":"success","content":{"3":{"name":"email","text":"EmailAddress","type":"control_email","qid":16,"order":3}},"responseCode":200,"info":null}
   * @returns {JotformQuestionsResponse}
   */
  addQuestionsToForm(id, questions) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/form/${ id }/questions`,
      method: 'put',
      body: { questions: groupFormDataByOrder(questions) },
      logTag: 'addQuestionsToForm',
      isJSON: true,
    })
  }

  /**
   * @description Gets a list of form responses with pagination and filtering options. Includes detailed submission data, answers, and metadata.
   *
   * @route GET /form-submissions
   * @operationName Get Form Submissions
   * @category Submission Management
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"Form","name":"id","required":true,"dictionary":"getUserFormsDictionary","description":"The ID of the form"}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Start of each result set for form list. Default is 0"}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results in each result set for form list. Default is 20, maximum is 1000"}
   * @paramDef {"type":"String","label":"Filters Object","name":"filters","description":"Filters the query results to fetch a specific submissions range. Use commands: gt (greater than), lt (less than), ne (not equal to). Example: {\"created_at:gt\": \"2013-01-01 00:00:00\"}"}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["id","username","title","status","created_at","updated_at","new","count","slug"]}},"description":"Order results by a form field name"}
   *
   * @sampleResult {"duration":"77.96ms","limit-left":844,"message":"success","content":[{"new":"1","flag":"0","notes":"","updated_at":null,"ip":"93.170.91.14","form_id":"26853145758483205","answers":{"1":{"name":"heading","text":"Form","type":"control_head","order":"1"},"2":{"name":"submit2","text":"Send","type":"control_button","order":"3"},"3":{"answer":{"last":"last-answer","first":"first-answer"},"sublabels":"{\"prefix\":\"\\u041f\\u0440\\u0435\\u0444\\u0456\\u043a\\u0441\"}","prettyFormat":"JohnDoe","name":"input3","text":"Name","type":"control_fullname","order":"2"}},"created_at":"2025-05-1407:43:51","id":"6110982336411786913","status":"ACTIVE"}],"resultSet":{"offset":0,"limit":20,"count":5},"responseCode":200,"info":null}
   * @returns {JotformSubmissionsResponse}
   */
  getFormSubmissions(id, offset, limit, filters, orderBy) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/form/${ id }/submissions`,
      query: { offset, limit, filter: filters, orderby: orderBy },
      logTag: 'getFormSubmissions',
    })
  }

  /**
   * @description Gets a list of all submissions for all forms on this account with filtering and pagination options. Supports advanced filtering by date ranges, form IDs, and full text search.
   *
   * @route GET /user-submissions
   * @operationName Get User Submissions
   * @category Submission Management
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"Number","label":"Offset","name":"offset","description":"Start of each result set for submission data. Default is 0"}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","description":"Number of results in each result set for submission data. Default is 20, maximum is 1000"}
   * @paramDef {"type":"String","label":"Filters Object","name":"filters","description":"Filters the query results to fetch specific submissions. Supports gt (greater than), lt (less than), ne (not equal to), formIDs array, and fullText search. Examples: {\"new\":\"1\"}, {\"created_at:gt\": \"2013-01-01 00:00:00\"}, {\"formIDs\": [\"form-id-1\", \"form-id-2\"]}, {\"fullText\": \"John Brown\"}"}
   * @paramDef {"type":"String","label":"Order By","name":"orderBy","uiComponent":{"type":"DROPDOWN","options":{"values":["id","username","title","status","created_at","updated_at","new","count","slug"]}},"description":"Order results by a form field name"}
   *
   * @sampleResult {"duration":"104.97ms","limit-left":846,"message":"success","content":[{"new":"1","flag":"0","notes":"","updated_at":null,"ip":"93.170.91.14","form_id":"675332123102239","answers":{"14":{"answer":"Youranswer","name":"input14","text":"Enterthequestion","type":"control_textbox","order":"3"},"15":{"name":"input15","text":"Send","type":"control_button","order":"2"}},"created_at":"2025-05-1408:33:56","id":"6440362764819959335","status":"ACTIVE"}],"resultSet":{"offset":0,"limit":20,"count":6},"responseCode":200,"info":null}
   * @returns {JotformSubmissionsResponse}
   */
  getUserSubmissions(offset, limit, filters, orderBy) {
    return this.#apiRequest({
      url: `${ this.baseUrl }/user/submissions`,
      query: { offset, limit, filter: filters, orderby: orderBy },
      logTag: 'getUserSubmissions',
    })
  }

  /**
   * @description Gets detailed account usage statistics including form submissions, API usage, storage, and AI features usage for the current month.
   *
   * @route GET /user-usage
   * @operationName Get Monthly User Usage
   * @category User Account
   *
   * @appearanceColor #0099ff #ff6100
   * @executionTimeoutInSeconds 30
   *
   * @sampleResult {"responseCode":200,"message":"success","content":{"username":"testuser","submissions":"7","overSubmissions":"0","ssl_submissions":"7","payments":"0","uploads":"0","total_submissions":"6","tickets":"0","views":"26","signed_documents":"0","workflow_runs":null,"ai_conversations":"0","ai_messages":null,"ai_sessions":"0","ai_phone_call":"0","ai_agent_sms":"0","ai_chatbot_conversations":null,"pdf_attachment_submissions":"0","monthly_usage_reset_date":"2025-06-1200:00:00","mobile_submissions":"0","api":151,"form_count":"3","ai_agents":0,"ai_chatbot_agents":null,"ai_knowledge_base":"0","created_at":"2025-05-1313:11:43"},"duration":"31.77ms","info":null,"limit-left":849}
   * @returns {UserUsageResponse}
   */
  getMonthlyUserUsage() {
    return this.#apiRequest({ url: `${ this.baseUrl }/user/usage`, logTag: 'getMonthlyUserUsage' })
  }

}

Flowrunner.ServerCode.addService(Jotform, [
  {
    order: 0,
    displayName: 'API Key',
    name: 'apiKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your JotForm API key. Get it from JotForm account settings.',
  },
  {
    order: 1,
    displayName: 'Data Store Region',
    name: 'dataStoreRegion',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: ['USA', 'Europe'],
    required: false,
    defaultValue: 'USA',
    hint: 'Select the region where your JotForm data is stored. Default is USA. See more at: https://jotform.com/myaccount/data',
  },
])