const { cleanupObject, getFileUploadData, serializeToken, deserializeToken, searchFilter } = require('./utils')

const logger = {
  info: (...args) => console.log('[Salesforce Essentials Service] info:', ...args),
  debug: (...args) => console.log('[Salesforce Essentials Service] debug:', ...args),
  error: (...args) => console.log('[Salesforce Essentials Service] error:', ...args),
  warn: (...args) => console.log('[Salesforce Essentials Service] warn:', ...args),
}

const oauthBaseUrl = 'https://login.salesforce.com'
const oauthToken = `${ oauthBaseUrl }/services/oauth2/token`
const servicesDataUrl = '/services/data/v62.0'
const sobjectsUrl = `${ servicesDataUrl }/sobjects`

/**
 * @requireOAuth
 * @integrationName Salesforce Essentials
 * @integrationIcon /icon.png
 **/
class SalesforceEssentialsService {
  constructor(config) {
    this.clientId = config.consumerKey
    this.clientSecret = config.consumerSecret
    this.scopes = 'api refresh_token'
  }

  #getAccessToken() {
    this.#resolveAccessTokens()

    return this.accessToken
  }

  #getInstanceUrl() {
    this.#resolveAccessTokens()

    return this.instanceUrl
  }

  #resolveAccessTokens() {
    if (this.accessTokensResolved) {
      return
    }

    const accessTokenStr = this.request.headers['oauth-access-token']

    if (accessTokenStr) {
      const { accessToken, instanceUrl } = deserializeToken(accessTokenStr)

      if (!accessToken || !instanceUrl) {
        throw new Error('Failed to parse access token: invalid format.')
      }

      this.accessToken = accessToken
      this.instanceUrl = instanceUrl

      this.accessTokensResolved = true
    }
  }

  async #apiRequest({ url, method, query, body, logTag }) {
    method = method || 'get'
    query = cleanupObject(query)
    body = cleanupObject(body)

    try {
      const fullUrl = this.#getInstanceUrl() + url

      const headers = {
        Authorization: `Bearer ${ this.#getAccessToken() }`,
        'Content-Type': 'application/json',
      }

      let response

      if (method === 'get' || method === 'delete') {
        logger.debug(`[${ logTag }] API Request: [${ method }::${ fullUrl }] q=[${ JSON.stringify(query) }]`)
        response = await Flowrunner.Request[method](fullUrl).set(headers).query(query)
      } else {
        logger.debug(`[${ logTag }] API Request: [${ method }::${ fullUrl }], body=${ JSON.stringify(body) }`)
        response = await Flowrunner.Request[method](fullUrl).set(headers).send(body)
      }

      return response
    } catch (error) {
      logger.error(`[${ logTag }] Error: ${ JSON.stringify(error.message) }`)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   *
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()
    params.append('client_id', this.clientId)
    params.append('scope', this.scopes)
    params.append('response_type', 'code')

    const oauthEndpoint = `${ oauthBaseUrl }/services/oauth2/authorize`
    const connectionURL = `${ oauthEndpoint }?${ params.toString() }`
    logger.debug(`[getOAuth2ConnectionURL] url: ${ connectionURL }`)

    return connectionURL
  }

  /**
   * @typedef {Object} refreshToken_ResultObject
   * @property {String} token
   * @property {Number} expirationInSeconds
   */

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   *
   * @param {String} refreshToken
   *
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()
    params.append('grant_type', 'refresh_token')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('refresh_token', refreshToken)

    try {
      const response = await Flowrunner.Request.post(oauthToken)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[refreshToken] response: ${ JSON.stringify(response) }`)

      return {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expirationInSeconds: response.expires_in,
      }
    } catch (error) {
      logger.error(`[refreshToken] Error: ${ JSON.stringify(error.message || error) }`)

      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   * @property {String} token
   * @property {String} refreshToken
   * @property {Number} expirationInSeconds
   * @property {String} connectionIdentityName
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   *
   * @param {Object} callbackObject
   *
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('client_id', this.clientId)
    params.append('client_secret', this.clientSecret)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    try {
      const response = await Flowrunner.Request.post(oauthToken)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .send(params.toString())

      logger.debug(`[executeCallback] response: ${ JSON.stringify(response) }`)

      const token = serializeToken(response['access_token'], response['instance_url'])

      return {
        token,
        refreshToken: response['refresh_token'],
        expirationInSeconds: response['expires_in'],
        connectionIdentityName: response['instance_url'] || 'Salesforce Service Account',
        overwrite: true,
      }
    } catch (error) {
      logger.error(`[executeCallback] Error: ${ JSON.stringify(error.message || error) }`)

      throw error
    }
  }

  async #getObjectMetadata(objectName) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/${ objectName }`,
      logTag: 'getObjectMetadata',
    })
  }

  async #getObjectItems(objectName) {
    return this.#getObjectMetadata(objectName).then(response => response.recentItems)
  }

  async #getDescribedObject(objectName) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/${ objectName }/describe`,
      logTag: 'getDescribedObject',
    })
  }

  async #getObjectFields(objectName) {
    const describedObject = await this.#getDescribedObject(objectName)

    return describedObject.fields
  }

  async #getObjectFieldNames(objectName) {
    const objectFields = await this.#getObjectFields(objectName)

    return objectFields.map(field => field.name)
  }

  async #findRecordsBySOQL({ objectName, whereClause, logTag }) {
    const fields = (await this.#getObjectFieldNames(objectName)).join(', ')

    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ servicesDataUrl }/query`,
      query: {
        q: `SELECT ${ fields } FROM ${ objectName } ${ whereClause }`,
      },
      logTag,
    })
  }

  /**
   * @typedef {Object} getCampaignsDictionary__payload
   * @property {String} [search] Search term to filter campaigns
   * @property {String} [cursor] Pagination cursor for large result sets
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
   */

  /**
   * @description Retrieves available campaigns for use in dropdown selections. Supports search filtering by campaign name or ID.
   * @route POST /get-campaigns-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","typedef":"getCampaignsDictionary__payload","description":"Dictionary payload containing search and pagination parameters"}
   *
   * @param {getCampaignsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getCampaignsDictionary(payload) {
    const { search } = payload || {}
    const campaigns = await this.#getObjectItems('Campaign')
    const filteredCampaigns = search ? searchFilter(campaigns, ['Id', 'Name'], search) : campaigns

    return {
      items: filteredCampaigns.map(({ Id, Name }) => ({
        label: Name,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getContactsDictionary__payload
   * @property {String} [search] Search term to filter contacts
   * @property {String} [cursor] Pagination cursor for large result sets
   */

  /**
   * @description Retrieves available contacts for use in dropdown selections. Supports search filtering by contact name or ID.
   * @route POST /get-contacts-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","typedef":"getContactsDictionary__payload","description":"Dictionary payload containing search and pagination parameters"}
   *
   * @param {getContactsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getContactsDictionary(payload) {
    const { search } = payload || {}
    const contacts = await this.#getObjectItems('Contact')
    const filteredContacts = search ? searchFilter(contacts, ['Id', 'Name'], search) : contacts

    return {
      items: filteredContacts.map(({ Id, Name }) => ({
        label: Name,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getLeadsDictionary__payload
   * @property {String} [search] Search term to filter leads
   * @property {String} [cursor] Pagination cursor for large result sets
   */

  /**
   * @description Retrieves available leads for use in dropdown selections. Supports search filtering by lead name or ID.
   * @route POST /get-leads-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","typedef":"getLeadsDictionary__payload","description":"Dictionary payload containing search and pagination parameters"}
   *
   * @param {getLeadsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getLeadsDictionary(payload) {
    const { search } = payload || {}
    const leads = await this.#getObjectItems('Lead')
    const filteredLeads = search ? searchFilter(leads, ['Id', 'Name'], search) : leads

    return {
      items: filteredLeads.map(({ Id, Name }) => ({
        label: Name,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getRecordsDictionary__payloadCriteria
   * @property {String} objectName Salesforce object name to filter records by
   */

  /**
   * @typedef {Object} getRecordsDictionary__payload
   * @property {String} [search] Search term to filter records
   * @property {String} [cursor] Pagination cursor for large result sets
   * @property {getRecordsDictionary__payloadCriteria} [criteria] Additional filtering criteria
   */

  /**
   * @description Retrieves available records for the specified Salesforce object. Supports search filtering by record name or ID.
   * @route POST /get-records-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","typedef":"getRecordsDictionary__payload","description":"Dictionary payload containing search, criteria, and pagination parameters"}
   *
   * @param {getRecordsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getRecordsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { objectName } = criteria || {}
    const records = await this.#getObjectItems(objectName)
    const filteredRecords = search ? searchFilter(records, ['Id', 'Name'], search) : records

    return {
      items: filteredRecords.map(({ Id, Name }) => ({
        label: Name,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @typedef {Object} getFilterableObjectFieldsDictionary__payloadCriteria
   * @property {String} objectName Salesforce object name to get filterable fields for
   */

  /**
   * @typedef {Object} getFilterableObjectFieldsDictionary__payload
   * @property {String} [search] Search term to filter field names
   * @property {String} [cursor] Pagination cursor for large result sets
   * @property {getFilterableObjectFieldsDictionary__payloadCriteria} [criteria] Additional filtering criteria
   */

  /**
   * @description Retrieves filterable fields for the specified Salesforce object. Only returns fields that can be used in search queries.
   * @route POST /get-filterable-object-fields-dictionary
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","label":"Payload","name":"payload","typedef":"getFilterableObjectFieldsDictionary__payload","description":"Dictionary payload containing search, criteria, and pagination parameters"}
   *
   * @param {getFilterableObjectFieldsDictionary__payload} payload
   * @returns {DictionaryResponse}
   */
  async getFilterableObjectFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { objectName } = criteria || {}
    const fields = (await this.#getObjectFields(objectName)).filter(field => field.filterable)
    const filteredObjectFields = search ? searchFilter(fields, ['label'], search) : fields

    return {
      items: filteredObjectFields.map(({ label, name }) => ({
        label,
        value: name,
        note: `ID: ${ name }`,
      })),
    }
  }

  /**
   * @typedef {Object} SalesforceResponse
   * @property {Boolean} success
   * @property {String} id
   * @property {Array} errors
   */

  /**
   * @typedef {Object} SalesforceSearchResponse
   * @property {Number} totalSize
   * @property {Array.<Object>} records
   * @property {Boolean} done
   */

  /**
   * @description Adds an existing contact to an existing campaign.
   *
   * @route POST /add-contact-to-campaign
   * @operationName Add Contact to Campaign
   * @category Campaign Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The ID of the campaign related to the lead or contact."}
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The ID of a contact that's related to the campaign."}
   *
   * @returns {SalesforceResponse} An object containing the ID of the CampaignMember record or an error message.
   * @sampleResult {"success":true,"id":"00vWV000000fUQLYA2","errors":[]}
   */
  async addContactToCampaign(campaignId, contactId) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/CampaignMember`,
      method: 'post',
      body: {
        CampaignId: campaignId,
        ContactId: contactId,
      },
      logTag: 'addContactToCampaign',
    })
  }

  /**
   * @description Adds an existing lead to an existing campaign.
   *
   * @route POST /add-lead-to-campaign
   * @operationName Add Lead to Campaign
   * @category Campaign Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Campaign","name":"campaignId","required":true,"dictionary":"getCampaignsDictionary","description":"The ID of the campaign related to the lead or contact."}
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The ID of a lead that's related to the campaign."}
   *
   * @returns {SalesforceResponse} An object containing the ID of the CampaignMember record or an error message.
   * @sampleResult {"success":true,"id":"00QWV000004WTr02AG","errors":[]}
   */
  async addLeadToCampaign(campaignId, leadId) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/CampaignMember`,
      method: 'post',
      body: {
        CampaignId: campaignId,
        LeadId: leadId,
      },
      logTag: 'addLeadToCampaign',
    })
  }

  /**
   * @description Creates a new attachment (max 25MB).
   *
   * @route POST /attachment
   * @operationName Create Attachment
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"File Content","name":"file","required":true,"description":"File content or URL."}
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","CampaignMember","Case","CaseComment","Contact","Lead","Opportunity","Task"]}},"description":"The name of the parent object to associate with the attachment."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent object to associate with the attachment."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the attachment. Maximum size is 500 characters."}
   * @paramDef {"type":"Boolean","label":"Is Private","name":"isPrivate","uiComponent":{"type":"TOGGLE"},"description":"Indicates whether this record is viewable only by the owner and administrators (`true`) or viewable by all otherwise-allowed users (`false`)."}
   *
   * @returns {SalesforceResponse} An object containing the ID of the created attachment or an error message.
   * @sampleResult {"id":"00PWV0000019s8f2AA","success":true,"errors":[]}
   */
  async createAttachment(file, objectName, parentRecordId, description, isPrivate) {
    const { fileName, encodedBody } = await getFileUploadData(file)

    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/Attachment`,
      method: 'post',
      body: {
        Body: encodedBody,
        Name: fileName,
        ParentId: parentRecordId,
        Description: description,
        IsPrivate: isPrivate,
      },
      logTag: 'createAttachment',
    })
  }

  /**
   * @description Creates a new record of a specified Salesforce object (e.g., Contact, Lead, Opportunity).
   *
   * @route POST /record
   * @operationName Create Record
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","CampaignMember","Case","CaseComment","Contact","Lead","Opportunity","Task"]}},"description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"An object containing field names and values for the specified Salesforce object."}
   *
   * @returns {SalesforceResponse} An object containing the ID of the created record or an error message.
   * @sampleResult {"success":true,"id":"003WV000004kRu9YAE","errors":[]}
   */
  async createRecord(objectName, fields) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/${ objectName }`,
      method: 'post',
      body: fields,
      logTag: 'createRecord',
    })
  }

  /**
   * @description Updates an existing record for a specified Salesforce object.
   *
   * @route PUT /record
   * @operationName Update Record
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","CampaignMember","Case","CaseComment","Contact","Lead","Opportunity","Task"]}},"description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the record to update."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"An object containing field names and values for the specified Salesforce object."}
   *
   * @returns {SalesforceResponse}
   * @sampleResult {"success":true,"id":"003WV000004kRu9YAE","errors":[]}
   */
  async updateRecord(objectName, recordId, fields) {
    return this.#apiRequest({
      url: `${ this.#getInstanceUrl() }${ sobjectsUrl }/${ objectName }/${ recordId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateRecord',
    })
  }

  /**
   * @description Finds a record of a specified Salesforce object by a field and value you choose. Optionally, creates a record if none is found.
   *
   * @route POST /find-record
   * @operationName Find Record
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","CampaignMember","Case","CaseComment","Contact","Lead","Opportunity","Task"]}},"description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Search Field","name":"searchField","required":true,"dictionary":"getFilterableObjectFieldsDictionary","dependsOn":["objectName"],"description":"Field to search by (e.g. `Name`, `Email`)."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","required":true,"description":"Value to match in the search field."}
   * @paramDef {"type":"Boolean","label":"Create New Record","name":"createNewRecord","uiComponent":{"type":"TOGGLE"},"description":"Whether to create a new Salesforce record if no matching record is found."}
   * @paramDef {"type":"Object","label":"New Record Fields","name":"newRecordFields","description":"An object containing field names and values for the specified Salesforce object."}
   *
   * @returns {SalesforceSearchResponse|SalesforceResponse} The first matching record, or an object containing the ID of the created record or an error message.
   * @sampleResult {"totalSize":1,"done":true,"records":[{"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000VlZN3YAN"},"Id":"001WV00000VlZN3YAN","IsDeleted":false,"MasterRecordId":null,"Name":"ThirdFrChild","Type":null,"ParentId":"001WV00000VaIm9YAF","BillingStreet":null,"BillingCity":null,"BillingState":null,"BillingPostalCode":null,"BillingCountry":null,"BillingLatitude":null,"BillingLongitude":null,"BillingGeocodeAccuracy":null,"BillingAddress":null,"ShippingStreet":null,"ShippingCity":null,"ShippingState":null,"ShippingPostalCode":null,"ShippingCountry":null,"ShippingLatitude":null,"ShippingLongitude":null,"ShippingGeocodeAccuracy":null,"ShippingAddress":null,"Phone":null,"Fax":null,"Website":null,"PhotoUrl":null,"Industry":null,"AnnualRevenue":null,"NumberOfEmployees":null,"Description":null,"OwnerId":"005WV000002pMdFYAU","CreatedDate":"2025-05-26T10:03:49.000+0000","CreatedById":"005WV000002pMdFYAU","LastModifiedDate":"2025-05-26T10:03:49.000+0000","LastModifiedById":"005WV000002pMdFYAU","SystemModstamp":"2025-05-26T10:03:49.000+0000","LastActivityDate":null,"LastViewedDate":"2025-05-29T18:51:15.000+0000","LastReferencedDate":"2025-05-29T18:51:15.000+0000","IsPartner":false,"IsCustomerPortal":false,"Jigsaw":null,"JigsawCompanyId":null,"AccountSource":null,"SicDesc":null,"IsBuyer":false}]}
   */
  async findRecord(objectName, searchField, searchValue, createNewRecord, newRecordFields) {
    const whereClause = `WHERE ${ searchField } = '${ searchValue }' LIMIT 1`
    const foundRecord = await this.#findRecordsBySOQL({ objectName, whereClause, logTag: 'findRecord' })

    if (foundRecord.records?.length > 0 || !createNewRecord) {
      return foundRecord
    }

    return this.createRecord(objectName, newRecordFields)
  }

  /**
   * @description Finds a record of a Salesforce object using a Salesforce Object Query (SOQL) WHERE clause.
   *
   * @route POST /find-record-by-query
   * @operationName Find Record by Query
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Account","Campaign","CampaignMember","Case","CaseComment","Contact","Lead","Opportunity","Task"]}},"description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"WHERE Clause","name":"whereClause","required":true,"description":"Enter a SOQL WHERE clause. See more about [Salesforce Object Query Language (SOQL)](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql.htm)."}
   *
   * @returns {SalesforceSearchResponse} The matching records in the specified object.
   * @sampleResult {"totalSize":1,"records":[{"ShippingLatitude":null,"LastModifiedDate":"2024-11-04T11:14:26.000+0000","BillingCity":null,"JigsawCompanyId":null,"PersonActionCadenceAssigneeId":null,"PersonActiveTrackerCount":0,"Name":"Acc","Industry":null,"CreatedById":"005WV000001DCArYAO","PersonActionCadenceState":null,"BillingGeocodeAccuracy":null,"AccountSource":null,"BillingPostalCode":null,"PhotoUrl":null,"MasterRecordId":null,"IsDeleted":false,"LastViewedDate":"2024-11-04T12:42:37.000+0000","ShippingGeocodeAccuracy":null,"ShippingStreet":null,"IsBuyer":false,"ActivityMetricRollupId":"01KWV00000183wc2AA","ShippingPostalCode":null,"CreatedDate":"2024-11-01T12:08:35.000+0000","ShippingState":null,"Id":"001WV00000CLttAYAT","SicDesc":null,"BillingState":null,"AnnualRevenue":null,"IsPartner":false,"Jigsaw":null,"Description":null,"Website":"https://acc.com","LastReferencedDate":"2024-11-04T12:42:37.000+0000","BillingLatitude":null,"NumberOfEmployees":null,"BillingAddress":null,"PersonActionCadenceId":null,"ActivityMetricId":"0GqWV0000004CVd0AM","OwnerId":"005WV000001DCArYAO","BillingLongitude":null,"Phone":"+380957545785","ShippingCountry":null,"ShippingCity":null,"ParentId":null,"IsCustomerPortal":false,"SystemModstamp":"2024-11-04T11:14:26.000+0000","Type":"Customer","BillingCountry":null,"BillingStreet":null,"ShippingAddress":null,"LastActivityDate":null,"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000CLttAYAT"},"Fax":null,"LastModifiedById":"005WV000001DCArYAO","ShippingLongitude":null,"PersonScheduledResumeDateTime":null}],"done":true}
   */
  async findRecordByQuery(objectName, whereClause) {
    let cleanWhereClause = whereClause.trim()

    if (!cleanWhereClause.toLowerCase().startsWith('where')) {
      throw new Error(`Invalid WHERE clause: "${ cleanWhereClause }". It must start with "WHERE"`)
    }

    cleanWhereClause += ' LIMIT 1'

    return this.#findRecordsBySOQL({
      objectName,
      whereClause: cleanWhereClause,
      logTag: 'findRecordByQuery',
    })
  }
}

Flowrunner.ServerCode.addService(SalesforceEssentialsService, [
  {
    order: 0,
    displayName: 'Consumer Key',
    name: 'consumerKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The consumer key of the connected app',
  },
  {
    order: 1,
    displayName: 'Consumer Secret',
    name: 'consumerSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'The consumer secret of the connected app',
  },
])
