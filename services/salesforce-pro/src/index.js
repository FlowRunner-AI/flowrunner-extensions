const xml2js = require('xml2js')
const {
  cleanupObject,
  getFileUploadData,
  serializeToken,
  deserializeToken,
  searchFilter,
  getSoapXml,
  normalizeSoapObject,
  convertDateFieldsToUTC,
} = require('./utils')

const logger = {
  info: (...args) => console.log('[Salesforce PRO Service] info:', ...args),
  debug: (...args) => console.log('[Salesforce PRO Service] debug:', ...args),
  error: (...args) => console.log('[Salesforce PRO Service] error:', ...args),
  warn: (...args) => console.log('[Salesforce PRO Service] warn:', ...args),
}

const OAUTH_BASE_URL = 'https://login.salesforce.com'
const API_VERSION = 'v62.0'
const SOBJECTS_BASE_URL = `/services/data/${ API_VERSION }/sobjects`

/**
 *  @requireOAuth
 *  @integrationName Salesforce PRO
 *  @integrationIcon /icon.png
 **/
class SalesforceProService {
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

    const oauthEndpoint = `${ OAUTH_BASE_URL }/services/oauth2/authorize`
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
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/services/oauth2/token`)
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
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/services/oauth2/token`)
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

  async #getSObjectsList() {
    const metadata = await this.#apiRequest({
      url: SOBJECTS_BASE_URL,
      logTag: 'getSObjectsList',
    })

    return metadata.sobjects
  }

  async #getObjectItems(objectName) {
    const metadata = await this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }`,
      logTag: 'getObjectItems',
    })

    return metadata.recentItems
  }

  async #getDescribedObject(objectName) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }/describe`,
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

  async #getChildRelationship(objectName, childObjectName) {
    const childRelationships = (await this.#getDescribedObject(objectName)).childRelationships

    return childRelationships.find(rel => rel.childSObject === childObjectName)
  }

  async #linkContentDocumentToEntity(contentDocumentId, linkedEntityId) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/ContentDocumentLink`,
      method: 'post',
      body: {
        ContentDocumentId: contentDocumentId,
        LinkedEntityId: linkedEntityId,
        ShareType: 'V',
        Visibility: 'AllUsers',
      },
      logTag: 'linkContentDocumentToEntity',
    })
  }

  async #findRecordsBySOQL({ objectName, objectFields, whereClause, logTag }) {
    const fields = objectFields || (await this.#getObjectFieldNames(objectName)).join(', ')

    return this.#apiRequest({
      url: `/services/data/${ API_VERSION }/query`,
      query: {
        q: `SELECT ${ fields }
            FROM ${ objectName } ${ whereClause }`,
      },
      logTag,
    })
  }

  /**
   * @typedef {Object} DictionaryPayload
   * @property {String} [search]
   * @property {Object} [criteria]
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
   * @property {Object} criteria
   */

  /**
   * @operationName Get SObjects Dictionary
   * @description Retrieves a list of available Salesforce objects for use in dropdown selections and dynamic forms.
   * @route POST /get-sobjects-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering objects."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Account","value":"Account","note":"ID: Account"},{"label":"Contact","value":"Contact","note":"ID: Contact"}]}
   */
  async getSObjectsDictionary(payload) {
    const { search } = payload || {}
    const sObjects = await this.#getSObjectsList()
    const filteredSObjects = search ? searchFilter(sObjects, ['label'], search) : sObjects

    return {
      items: filteredSObjects.map(({ label, name }) => ({
        label,
        value: name,
        note: `ID: ${ name }`,
      })),
    }
  }

  /**
   * @operationName Get Creatable SObjects Dictionary
   * @description Retrieves a list of Salesforce objects that allow creation of new records for use in dynamic forms.
   * @route POST /get-creatable-sobjects-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering creatable objects."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Account","value":"Account","note":"ID: Account"},{"label":"Lead","value":"Lead","note":"ID: Lead"}]}
   */
  async getCreatableSObjectsDictionary(payload) {
    const { search } = payload || {}
    const sObjects = (await this.#getSObjectsList()).filter(sObject => !!sObject.createable)
    const filteredSObjects = search ? searchFilter(sObjects, ['label'], search) : sObjects

    return {
      items: filteredSObjects.map(({ label, name }) => ({
        label,
        value: name,
        note: `ID: ${ name }`,
      })),
    }
  }

  /**
   * @operationName Get Updatable SObjects Dictionary
   * @description Retrieves a list of Salesforce objects that allow updates to existing records for use in dynamic forms.
   * @route POST /get-updatable-sobjects-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering updatable objects."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contact","value":"Contact","note":"ID: Contact"},{"label":"Opportunity","value":"Opportunity","note":"ID: Opportunity"}]}
   */
  async getUpdatableSObjectsDictionary(payload) {
    const { search } = payload || {}
    const sObjects = (await this.#getSObjectsList()).filter(sObject => !!sObject.updateable)
    const filteredSObjects = search ? searchFilter(sObjects, ['label'], search) : sObjects

    return {
      items: filteredSObjects.map(({ label, name }) => ({
        label,
        value: name,
        note: `ID: ${ name }`,
      })),
    }
  }

  /**
   * @operationName Get Deletable SObjects Dictionary
   * @description Retrieves a list of Salesforce objects that allow deletion of records for use in dynamic forms.
   * @route POST /get-deletable-sobjects-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering deletable objects."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Account","value":"Account","note":"ID: Account"},{"label":"Campaign","value":"Campaign","note":"ID: Campaign"}]}
   */
  async getDeletableSObjectsDictionary(payload) {
    const { search } = payload || {}
    const sObjects = (await this.#getSObjectsList()).filter(sObject => !!sObject.deletable)
    const filteredSObjects = search ? searchFilter(sObjects, ['label'], search) : sObjects

    return {
      items: filteredSObjects.map(({ label, name }) => ({
        label,
        value: name,
        note: `ID: ${ name }`,
      })),
    }
  }

  /**
   * @operationName Get Campaigns Dictionary
   * @description Retrieves a list of available campaigns for use in campaign-related operations and dropdown selections.
   * @route POST /get-campaigns-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering campaigns."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Spring Campaign 2024","value":"701XX0000004C5Q","note":"ID: 701XX0000004C5Q"}]}
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
   * @operationName Get Contacts Dictionary
   * @description Retrieves a list of available contacts for use in contact-related operations and dropdown selections.
   * @route POST /get-contacts-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering contacts."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"John Smith","value":"003XX0000004DGZ","note":"ID: 003XX0000004DGZ"}]}
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
   * @operationName Get Leads Dictionary
   * @description Retrieves a list of available leads for use in lead management operations and dropdown selections.
   * @route POST /get-leads-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering leads."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Jane Doe","value":"00QXX0000003DHZ","note":"ID: 00QXX0000003DHZ"}]}
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
   * @operationName Get Accounts Dictionary
   * @description Retrieves a list of available accounts for use in account-related operations and dropdown selections.
   * @route POST /get-accounts-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering accounts."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Acme Corporation","value":"001XX0000003DGZ","note":"ID: 001XX0000003DGZ"}]}
   */
  async getAccountsDictionary(payload) {
    const { search } = payload || {}
    const accounts = await this.#getObjectItems('Account')
    const filteredAccounts = search ? searchFilter(accounts, ['Id', 'Name'], search) : accounts

    return {
      items: filteredAccounts.map(({ Id, Name }) => ({
        label: Name,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @operationName Get Opportunities Dictionary
   * @description Retrieves a list of available opportunities for use in sales operations and dropdown selections.
   * @route POST /get-opportunities-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering opportunities."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Enterprise Deal Q4","value":"006XX0000004C5Q","note":"ID: 006XX0000004C5Q"}]}
   */
  async getOpportunitiesDictionary(payload) {
    const { search } = payload || {}
    const opportunities = await this.#getObjectItems('Opportunity')
    const filteredOpportunities = search ? searchFilter(opportunities, ['Id', 'Name'], search) : opportunities

    return {
      items: filteredOpportunities.map(({ Id, Name }) => ({
        label: Name,
        value: Name,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @operationName Get Records Dictionary
   * @description Retrieves a list of records for a specified Salesforce object type for use in dynamic dropdown selections.
   * @route POST /get-records-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search, cursor parameters and criteria with objectName for filtering records."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Sample Record","value":"a03XX0000004C5Q","note":"ID: a03XX0000004C5Q"}]}
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
   * @operationName Get Files Dictionary
   * @description Retrieves a list of available files and documents from Salesforce for use in file-related operations.
   * @route POST /get-files-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search and cursor parameters for filtering files."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Contract.pdf","value":"069XX0000004C5Q","note":"ID: 069XX0000004C5Q"}]}
   */
  async getFilesDictionary(payload) {
    const { search } = payload || {}
    const files = await this.#getObjectItems('ContentDocument')
    const filteredFiles = search ? searchFilter(files, ['Id', 'Title'], search) : files

    return {
      items: filteredFiles.map(({ Id, Title }) => ({
        label: Title,
        value: Id,
        note: `ID: ${ Id }`,
      })),
    }
  }

  /**
   * @operationName Get Filterable Object Fields Dictionary
   * @description Retrieves a list of filterable fields for a specified Salesforce object for use in search and filter operations.
   * @route POST /get-filterable-object-fields-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search, cursor parameters and criteria with objectName for filtering object fields."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"Name","value":"Name","note":"ID: Name"},{"label":"Email","value":"Email","note":"ID: Email"}]}
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
   * @operationName Get Reference Object Fields Dictionary
   * @description Retrieves a list of reference fields for a specified Salesforce object for use in relationship operations.
   * @route POST /get-reference-object-fields-dictionary
   * 
   * @registerAs DICTIONARY
   *
   * @paramDef {"type":"Object","name":"payload","required":true,"description":"Dictionary payload containing search, cursor parameters and criteria with objectName for filtering reference fields."}
   * @returns {DictionaryResponse}
   * @sampleResult {"items":[{"label":"AccountId","value":"AccountId","note":"ID: AccountId"},{"label":"OwnerId","value":"OwnerId","note":"ID: OwnerId"}]}
   */
  async getReferenceObjectFieldsDictionary(payload) {
    const { search, criteria } = payload || {}
    const { objectName } = criteria || {}
    const refFields = (await this.#getObjectFields(objectName)).filter(field => field.createable || field.updateable)
    const filteredRefFields = search ? searchFilter(refFields, ['name'], search) : refFields

    return {
      items: filteredRefFields.map(({ name }) => ({
        label: name,
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
   * @typedef {Object} SalesforceError
   * @property {String} message
   * @property {String} statusCode
   */

  /**
   * @typedef {Object} SalesforceConvertResponse
   * @property {String} accountId
   * @property {String} opportunityId
   * @property {String} contactId
   * @property {String} leadId
   * @property {Boolean} success
   * @property {SalesforceError} errors
   */

  /**
   * @typedef {Object} ParentChildrenResponse
   * @property {SalesforceResponse} parent
   * @property {SalesforceResponse} children
   */

  /**
   * @typedef {Object} EmailActionResponse
   * @property {Number} sortOrder
   * @property {Array} outputValues
   * @property {String} invocationId
   * @property {Number} version
   * @property {Array.<SalesforceError>} errors
   * @property {String} outcome
   * @property {String} actionName
   * @property {Boolean} isSuccess
   */

  /**
   * @typedef {Object} NotesAttachmentsResponse
   * @property {Array.<Object>} attachments
   * @property {Array.<Object>} notes
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
   * @returns {SalesforceResponse} Object containing the ID of the CampaignMember record or an error message.
   * @sampleResult {"success":true,"id":"00vWV000000fUQLYA2","errors":[]}
   */
  async addContactToCampaign(campaignId, contactId) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/CampaignMember`,
      method: 'post',
      body: {
        CampaignId: campaignId,
        ContactId: contactId,
      },
      logTag: 'addContactToCampaign',
    })
  }

  /**
   * @description Adds an existing file to an existing record.
   *
   * @route POST /add-file-to-record
   * @operationName Add File to Record
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getUpdatableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Linked Record","name":"linkedEntityId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the target Salesforce record (e.g., an Account, Contact) to link the file to."}
   * @paramDef {"type":"String","label":"File","name":"fileId","required":true,"dictionary":"getFilesDictionary","description":"The ID of the file."}
   * @paramDef {"type":"String","label":"Share Type","name":"shareType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["V","C","I"]}},"description":"The permission granted to the user of the shared file in a library. This is determined by the permission the user already has in the library. `V (Viewer permission)`: the user can explicitly view but not edit the shared file. `C (Collaborator permission)`: the user can explicitly view and edit the shared file. You can retrieve the 'ShareType' for ContentDocumentLink, but you can't create a ContentDocumentLink with a 'ShareType' of 'C' from an Apex trigger. `I (Inferred permission)`: the user's permission is determined by the related record. For shares with a library, this is defined by the permissions the user has in that library."}
   * @paramDef {"type":"String","label":"Visibility","name":"visibility","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["AllUsers","InternalUsers","SharedUsers"]}},"description":"Specifies whether this file is available to all users, internal users, or shared users. `AllUsers` — The file is available to all users who have permission to see the file. `InternalUsers` — The file is available only to internal users who have permission to see the file. `SharedUsers` — The file is available to all users who can see the feed to which the file is posted. SharedUsers is used only for files shared with users, and is available only when an org has private org-wide sharing on by default."}
   *
   * @returns {SalesforceResponse} The Salesforce API response after creating the ContentDocumentLink or an error message.
   * @sampleResult {"success":true,"id":"06AWV000001VouP2AS","errors":[]}
   */
  async addFileToRecord(objectName, linkedEntityId, fileId, shareType, visibility) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/ContentDocumentLink`,
      method: 'post',
      body: {
        ContentDocumentId: fileId,
        LinkedEntityId: linkedEntityId,
        ShareType: shareType,
        Visibility: visibility,
      },
      logTag: 'addFileToRecord',
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
   * @returns {SalesforceResponse} Object containing the ID of the CampaignMember record or an error message.
   * @sampleResult {"success":true,"id":"00QWV000004WTr02AG","errors":[]}
   */
  async addLeadToCampaign(campaignId, leadId) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/CampaignMember`,
      method: 'post',
      body: {
        CampaignId: campaignId,
        LeadId: leadId,
      },
      logTag: 'addLeadToCampaign',
    })
  }

  /**
   * @description Converts an existing lead to a contact.
   *
   * @route POST /convert-lead-to-contact
   * @operationName Convert Lead to Contact
   * @category Lead Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The ID of the lead to convert."}
   * @paramDef {"type":"String","label":"Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"The ID of an existing account to associate with the lead. If omitted, Salesforce will create a new account."}
   * @paramDef {"type":"String","label":"Opportunity Name","name":"opportunityName","dictionary":"getOpportunitiesDictionary","description":"The name of the opportunity to create during conversion if 'Create Opportunity' is set to `true`."}
   * @paramDef {"type":"Boolean","label":"Create New Opportunity","name":"createNewOpportunity","uiComponent":{"type":"TOGGLE"},"description":"Specifies whether to create an Opportunity during lead conversion."}
   * @paramDef {"type":"String","label":"Converted Status","name":"convertedStatus","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Qualified"]}},"description":"Specify the status of a lead once it has been converted into a contact."}
   *
   * @returns {SalesforceConvertResponse} The converted lead's contact ID and other related details.
   * @sampleResult {"accountId":"001WV00000CUYLXYA5","opportunityId":"006WV000004TEi1YAG","contactId":"003WV000004paOvYAI","success":true,"errors":[],"leadId":"00QWV000004dOrP2AU"}
   */
  async convertLeadToContact(leadId, accountId, opportunityName, createNewOpportunity, convertedStatus) {
    const soapXml = getSoapXml({
      sessionId: this.#getAccessToken(),
      leadId,
      accountId,
      opportunityName,
      doNotCreateOpportunity: !createNewOpportunity,
      convertedStatus,
    })

    const xmlResponse = await Flowrunner.Request.post(`${ this.#getInstanceUrl() }/services/Soap/u/62.0`)
      .set({ 'Content-Type': 'text/xml; charset=UTF-8', SOAPAction: '""' })
      .send(soapXml)

    const xmlParser = new xml2js.Parser({
      explicitArray: false,
      tagNameProcessors: [xml2js.processors.stripPrefix],
    })

    const parsedResult = await xmlParser.parseStringPromise(xmlResponse)
    const normalizedResult = normalizeSoapObject(parsedResult)

    return normalizedResult.Envelope?.Body?.convertLeadResponse?.result
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
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"The name of the parent object to associate with the attachment."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent object to associate with the attachment."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the attachment. Maximum size is 500 characters."}
   * @paramDef {"type":"Boolean","label":"Is Private","name":"isPrivate","uiComponent":{"type":"TOGGLE"},"description":"Indicates whether this record is viewable only by the owner and administrators (`true`) or viewable by all otherwise-allowed users (`false`)."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created attachment or an error message.
   * @sampleResult {"id":"00PWV0000019s8f2AA","success":true,"errors":[]}
   */
  async createAttachment(file, objectName, parentRecordId, description, isPrivate) {
    const { fileName, encodedBody } = await getFileUploadData(file)

    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Attachment`,
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
   * @description Creates records from line items and sets the parent-child relationship.
   *
   * @route POST /child-records
   * @operationName Create Child Records (with line item support)
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","required":true,"dictionary":"getUpdatableSObjectsDictionary","description":"Salesforce object name for the parent record (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent record."}
   * @paramDef {"type":"String","label":"Parent Reference Field Name","name":"parentRefFieldName","required":true,"dictionary":"getReferenceObjectFieldsDictionary","dependsOn":["objectName"],"description":"The field name on the child object that references the parent record."}
   * @paramDef {"type":"String","label":"Child Object Name","name":"childObjectName","required":true,"dictionary":"getCreatableSObjectsDictionary","description":"Salesforce object name for the child records (e.g., OpportunityLineItem)."}
   * @paramDef {"type":"Array.<Object>","label":"Child Records","name":"childRecords","required":true,"description":"Array of child records to create, each with fields matching the specified child object."}
   *
   * @returns {ParentChildrenResponse} Object containing parent and children records.
   * @sampleResult {"parent":{"success":true,"id":"001FAKE0000ParentXYZ"},"children":[{"success":true,"id":"001FAKE0000Child001","errors":[]},{"success":true,"id":"001FAKE0000Child002","errors":[]}]}
   */
  async createChildRecords(objectName, parentRecordId, parentRefFieldName, childObjectName, childRecords) {
    const childResponses = []

    for (const child of childRecords) {
      const recordWithParent = {
        ...child,
        [parentRefFieldName]: parentRecordId,
      }

      const response = await this.#apiRequest({
        url: `${ SOBJECTS_BASE_URL }/${ childObjectName }`,
        method: 'post',
        body: recordWithParent,
        logTag: 'createChildRecords',
      })

      childResponses.push(response)
    }

    return {
      parent: {
        id: parentRecordId,
        success: true,
      },
      children: childResponses,
    }
  }

  /**
   * @description Creates a new contact in Salesforce.
   *
   * @route POST /contact
   * @operationName Create Contact
   * @category Contact Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Salutation","name":"salutation","uiComponent":{"type":"DROPDOWN","options":{"values":["Mr.","Ms.","Mrs.","Dr.","Prof.","Mx."]}},"description":"Honorific abbreviation, word, or phrase to be used in front of name in greetings, such as `Dr.` or `Mrs.`."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The contact's first name up to 40 characters."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Last name of the contact up to 80 characters."}
   * @paramDef {"type":"String","label":"Parent Account","name":"accountId","required":true,"dictionary":"getAccountsDictionary","description":"ID of the account that's the parent of this contact."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title of the contact, such as CEO or Vice President."}
   * @paramDef {"type":"String","label":"Reports To","name":"reportsToId","dictionary":"getContactsDictionary","description":"ID of the contact that this contact reports to."}
   * @paramDef {"type":"String","label":"Contact Description","name":"description","description":"A description of the contact up to 32 KB."}
   * @paramDef {"type":"String","label":"Business Phone","name":"phone","description":"Phone number for the contact."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The contact's email address."}
   * @paramDef {"type":"String","label":"Mailing Street","name":"mailingStreet","description":"Street address for mailing address."}
   * @paramDef {"type":"String","label":"Mailing City","name":"mailingCity","description":"Mailing address details."}
   * @paramDef {"type":"String","label":"Mailing State/Province","name":"mailingState","description":"Mailing address details."}
   * @paramDef {"type":"String","label":"Mailing Zip/Postal Code","name":"mailingPostalCode","description":"Mailing address details."}
   * @paramDef {"type":"String","label":"Mailing Country","name":"mailingCountry","description":"Mailing address details."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created contact or an error message.
   * @sampleResult {"success":true,"id":"003WV000004kI65YAE","errors":[]}
   */
  async createContact(
    salutation,
    firstName,
    lastName,
    accountId,
    title,
    reportsToId,
    description,
    phone,
    email,
    mailingStreet,
    mailingCity,
    mailingState,
    mailingPostalCode,
    mailingCountry
  ) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Contact`,
      method: 'post',
      body: {
        Salutation: salutation,
        FirstName: firstName,
        LastName: lastName,
        AccountId: accountId,
        Title: title,
        ReportsToId: reportsToId,
        Description: description,
        Phone: phone,
        Email: email,
        MailingStreet: mailingStreet,
        MailingCity: mailingCity,
        MailingState: mailingState,
        MailingPostalCode: mailingPostalCode,
        MailingCountry: mailingCountry,
      },
      logTag: 'createContact',
    })
  }

  /**
   * @description Creates a new enhanced note with optional record attachment.
   *
   * @route POST /enhanced-note
   * @operationName Create Enhanced Note
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the note."}
   * @paramDef {"type":"String","label":"Content","name":"content","required":true,"description":"The content or body of the note, which can include properly formatted HTML or plain text."}
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","dictionary":"getSObjectsDictionary","description":"The type of the record to attach the note to (e.g., Account, Opportunity). When this field is specified, `parentRecordId` is required."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the record to attach the note to."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created enhanced note or an error message.
   * @sampleResult {"success":true,"id":"002WV0000019g13YAA","errors":[]}
   */
  async createEnhancedNote(title, content, objectName, parentRecordId) {
    const base64content = Buffer.from(content, 'utf8').toString('base64')

    const note = await this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/ContentNote`,
      method: 'post',
      body: {
        Title: title,
        Content: base64content,
      },
      logTag: 'createEnhancedNote',
    })

    if (objectName && parentRecordId && note.id) {
      await this.#linkContentDocumentToEntity(note.id, parentRecordId)
    }

    return note
  }

  /**
   * @description Creates a new file (max 25MB).
   *
   * @route POST /file
   * @operationName Create File
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"File","name":"file","required":true,"description":"File content or URL."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"The title of the file."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"Description of the file."}
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","dictionary":"getSObjectsDictionary","description":"The name of the parent object to associate with the file. When this field is specified, `parentRecordId` is required."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent object to associate with the file."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created file or an error message.
   * @sampleResult {"id":"068WV000001SnoPYAS","success":true,"errors":[]}
   */
  async createFile(file, title, description, objectName, parentRecordId) {
    const { fileName, encodedBody } = await getFileUploadData(file, title)

    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/ContentVersion`,
      method: 'post',
      body: {
        VersionData: encodedBody,
        PathOnClient: fileName,
        Title: title,
        Description: description,
        FirstPublishLocationId: parentRecordId,
      },
      logTag: 'createFile',
    })
  }

  /**
   * @description Creates a new lead in Salesforce.
   *
   * @route POST /lead
   * @operationName Create Lead
   * @category Lead Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Salutation","name":"salutation","uiComponent":{"type":"DROPDOWN","options":{"values":["Mr.","Ms.","Mrs.","Dr.","Prof.","Mx."]}},"description":"Salutation for the lead."}
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"The lead's first name up to 40 characters."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","required":true,"description":"Last name of the lead up to 80 characters."}
   * @paramDef {"type":"String","label":"Company","name":"company","required":true,"description":"The lead's company."}
   * @paramDef {"type":"String","label":"Title","name":"title","description":"Title for the lead, such as `CFO` or `CEO`. The maximum size is 128 characters."}
   * @paramDef {"type":"String","label":"Website","name":"website","description":"Website for the lead."}
   * @paramDef {"type":"String","label":"Description","name":"description","description":"The lead's description."}
   * @paramDef {"type":"String","label":"Lead Status","name":"status","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["New","Contacted","Nurturing","Qualified","Unqualified"]}},"description":"Status code for this converted lead."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"The lead's phone number."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"The lead's email address."}
   * @paramDef {"type":"String","label":"Street","name":"street","description":"Street number and name for the address of the lead."}
   * @paramDef {"type":"String","label":"City","name":"city","description":"City for the lead's address."}
   * @paramDef {"type":"String","label":"State","name":"state","description":"State for the address of the lead."}
   * @paramDef {"type":"String","label":"Zip/Postal Code","name":"postalCode","description":"Postal code for the address of the lead."}
   * @paramDef {"type":"String","label":"Country","name":"country","description":"The lead's country."}
   * @paramDef {"type":"Number","label":"Number of Employees","name":"numberOfEmployees","description":"Number of employees at the lead's company."}
   * @paramDef {"type":"Number","label":"Annual Revenue","name":"annualRevenue","description":"Annual revenue for the lead's company."}
   * @paramDef {"type":"String","label":"Lead Source","name":"leadSource","uiComponent":{"type":"DROPDOWN","options":{"values":["Advertisement","Employee Referral","External Referral","Partner","Public Relations","Seminar - Internal","Seminar - Partner","Trade Show","Web","Word of mouth","Other"]}},"description":"The origin or source of the lead."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","uiComponent":{"type":"DROPDOWN","options":{"values":["Agriculture","Apparel","Banking","Biotechnology","Chemicals","Communications","Construction","Consulting","Education","Electronics","Energy","Engineering","Entertainment","Environmental","Finance","Food & Beverage","Government","Healthcare","Hospitality","Insurance","Machinery","Manufacturing","Media","Not For Profit","Other","Recreation","Retail","Shipping","Technology","Telecommunications","Transportation","Utilities"]}},"description":"Industry in which the lead works."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created lead or an error message.
   * @sampleResult {"success":true,"id":"00QWV000004ZpQL2A0","errors":[]}
   */
  async createLead(
    salutation,
    firstName,
    lastName,
    company,
    title,
    website,
    description,
    status,
    phone,
    email,
    street,
    city,
    state,
    postalCode,
    country,
    numberOfEmployees,
    annualRevenue,
    leadSource,
    industry
  ) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Lead`,
      method: 'post',
      body: {
        Salutation: salutation,
        FirstName: firstName,
        LastName: lastName,
        Company: company,
        Title: title,
        Website: website,
        Description: description,
        Status: status,
        Phone: phone,
        Email: email,
        Street: street,
        City: city,
        State: state,
        PostalCode: postalCode,
        Country: country,
        NumberOfEmployees: numberOfEmployees,
        AnnualRevenue: annualRevenue,
        LeadSource: leadSource,
        Industry: industry,
      },
      logTag: 'createLead',
    })
  }

  /**
   * @description Creates a new note and links it to a parent record.
   *
   * @route POST /note
   * @operationName Create Note
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Title of the note."}
   * @paramDef {"type":"String","label":"Body","name":"body","description":"Body of the note. Limited to 32 KB."}
   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"The name of the parent object to associate with the note."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent object to associate with the note."}
   * @paramDef {"type":"Boolean","label":"Is Private","name":"isPrivate","uiComponent":{"type":"TOGGLE"},"description":"If `true`, only the note owner or a user with the 'Modify All Data' permission can view the note or query it via the API. Note that if a user who does not have the 'Modify All Data' permission sets this field to `true` on a note that they do not own, then they can no longer query, delete, or update the note."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created note or an error message.
   * @sampleResult {"success":true,"id":"002WV0000019g13YAA","errors":[]}
   */
  async createNote(title, body, objectName, parentRecordId, isPrivate) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Note`,
      method: 'post',
      body: {
        Title: title,
        Body: body,
        ParentId: parentRecordId,
        IsPrivate: isPrivate,
      },
      logTag: 'createNote',
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
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getCreatableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"An object containing field names and values for the specified Salesforce object. Date fields must be in format `DD.MM.YYYY`."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created record or an error message.
   * @sampleResult {"success":true,"id":"003WV000004kRu9YAE","errors":[]}
   */
  async createRecord(objectName, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }`,
      method: 'post',
      body: fields,
      logTag: 'createRecord',
    })
  }

  /**
   * @description Creates a new record of a specified Salesforce object (e.g., Contact, Lead, Opportunity). Date inputs will be treated as if they are in UTC.
   *
   * @route POST /record-utc
   * @operationName Create Record (UTC)
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getCreatableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"An object containing field names and values for the specified Salesforce object. Date fields must be in format `DD.MM.YYYY`."}
   *
   * @returns {SalesforceResponse} Object containing the ID of the created record or an error message.
   * @sampleResult {"success":true,"id":"006WV000004TjNdYAK","errors":[]}
   */
  async createRecordUTC(objectName, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }`,
      method: 'post',
      body: convertDateFieldsToUTC(fields),
      logTag: 'createRecordUTC',
    })
  }

  /**
   * @description Deletes an existing record of a specified Salesforce object.
   *
   * @route DELETE /record
   * @operationName Delete Record
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getDeletableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the Salesforce record to delete."}
   */
  async deleteRecord(objectName, recordId) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }/${ recordId }`,
      method: 'delete',
      logTag: 'deleteRecord',
    })
  }

  /**
   * @description Sends an email using Salesforce Simple Email Actions.
   *
   * @route POST /send-email
   * @operationName Send Email
   * @category Communication
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"Array.<String>","label":"To Recipients","name":"toRecipients","required":true,"description":"A collection of the recipients' email addresses."}
   * @paramDef {"type":"Array.<String>","label":"CC Recipients","name":"ccRecipients","description":"A collection of the recipient email addresses to send a copy of the email to."}
   * @paramDef {"type":"Array.<String>","label":"BCC Recipients","name":"bccRecipients","description":"A collection of the recipient' email addresses to send a copy of the email to. BCC recipients are hidden from other recipients."}
   * @paramDef {"type":"String","label":"Email Subject","name":"emailSubject","required":true,"description":"The subject of the email."}
   * @paramDef {"type":"String","label":"Email Body","name":"emailBody","required":true,"description":"The body of the email."}
   * @paramDef {"type":"String","label":"Sender Type","name":"senderType","uiComponent":{"type":"DROPDOWN","options":{"values":["CurrentUser","DefaultWorkflowUser","OrgWideEmailAddress"]}},"description":"Email address used as the email’s `From` and `Reply-To` addresses. Valid values are: `CurrentUser` — Email address of the user running the flow. This setting is the default. `DefaultWorkflowUser` — Email address of the default workflow user. `OrgWideEmailAddress` — The organization-wide email address that is specified in `senderAddress`."}
   *
   * @returns {EmailActionResponse} Result of the email action, including any errors.
   * @sampleResult [{"sortOrder":-1,"outputValues":null,"invocationId":null,"version":1,"errors":null,"outcome":null,"actionName":"emailSimple","isSuccess":true}]
   */
  async sendEmail(toRecipients, ccRecipients, bccRecipients, emailSubject, emailBody, senderType) {
    const payload = {
      inputs: [
        {
          emailAddresses: toRecipients?.join(','),
          ccRecipientAddressList: ccRecipients?.join(','),
          bccRecipientAddressList: bccRecipients?.join(','),
          emailSubject,
          emailBody,
          senderType,
        },
      ],
    }

    return this.#apiRequest({
      url: `/services/data/${ API_VERSION }/actions/standard/emailSimple`,
      method: 'post',
      body: payload,
      logTag: 'sendEmail',
    })
  }

  /**
   * @description Updates an existing contact in Salesforce.
   *
   * @route PUT /contact
   * @operationName Update Contact
   * @category Contact Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Contact","name":"contactId","required":true,"dictionary":"getContactsDictionary","description":"The ID of the contact to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"The fields of the contact that you want to update. Date fields must be in format `DD.MM.YYYY`."}
   */
  async updateContact(contactId, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Contact/${ contactId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateContact',
    })
  }

  /**
   * @description Updates an existing lead in Salesforce.
   *
   * @route PUT /lead
   * @operationName Update Lead
   * @category Lead Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Lead","name":"leadId","required":true,"dictionary":"getLeadsDictionary","description":"The ID of the lead to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"The fields of the lead that you want to update. Date fields must be in format `DD.MM.YYYY`."}
   */
  async updateLead(leadId, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/Lead/${ leadId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateLead',
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
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getUpdatableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the record to update."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"The fields of the record that you want to update. Date fields must be in format `DD.MM.YYYY`."}
   */
  async updateRecord(objectName, recordId, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }/${ recordId }`,
      method: 'patch',
      body: fields,
      logTag: 'updateRecord',
    })
  }

  /**
   * @description Updates an existing record for a specified Salesforce object. Date inputs will be treated as if they are in UTC.
   *
   * @route PUT /record-utc
   * @operationName Update Record (UTC)
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getUpdatableSObjectsDictionary","description":"Specified Salesforce object name (e.g., Contact, Lead, Opportunity)."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the record to update."}
   * @paramDef {"type":"Object","label":"Record Fields","name":"fields","required":true,"description":"The fields of the record that you want to update. Date fields must be in format `DD.MM.YYYY`."}
   */
  async updateRecordUTC(objectName, recordId, fields) {
    return this.#apiRequest({
      url: `${ SOBJECTS_BASE_URL }/${ objectName }/${ recordId }`,
      method: 'patch',
      body: convertDateFieldsToUTC(fields),
      logTag: 'updateRecordUTC',
    })
  }

  /**
   * @description Finds child records for a given Parent ID and returns the child records as line items.
   *
   * @route GET /find-child-records
   * @operationName Find Child Records
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api

   * @paramDef {"type":"String","label":"Parent Object Name","name":"objectName","required":true,"dictionary":"getCreatableSObjectsDictionary","description":"Salesforce object name for the parent record (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"Parent Record","name":"parentRecordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the parent record."}
   * @paramDef {"type":"String","label":"Child Object Name","name":"childObjectName","required":true,"dictionary":"getCreatableSObjectsDictionary","description":"Salesforce object name for the child records (e.g., OpportunityLineItem)."}
   *
   * @returns {SalesforceSearchResponse} Object containing the total count and an array of the found child records or an error message.
   * @sampleResult {"totalSize":1,"done":true,"records":[{"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000VlZN3YAN"},"Id":"001WV00000VlZN3YAN","IsDeleted":false,"MasterRecordId":null,"Name":"ThirdFrChild","Type":null,"ParentId":"001WV00000VaIm9YAF","BillingStreet":null,"BillingCity":null,"BillingState":null,"BillingPostalCode":null,"BillingCountry":null,"BillingLatitude":null,"BillingLongitude":null,"BillingGeocodeAccuracy":null,"BillingAddress":null,"ShippingStreet":null,"ShippingCity":null,"ShippingState":null,"ShippingPostalCode":null,"ShippingCountry":null,"ShippingLatitude":null,"ShippingLongitude":null,"ShippingGeocodeAccuracy":null,"ShippingAddress":null,"Phone":null,"Fax":null,"Website":null,"PhotoUrl":null,"Industry":null,"AnnualRevenue":null,"NumberOfEmployees":null,"Description":null,"OwnerId":"005WV000002pMdFYAU","CreatedDate":"2025-05-26T10:03:49.000+0000","CreatedById":"005WV000002pMdFYAU","LastModifiedDate":"2025-05-26T10:03:49.000+0000","LastModifiedById":"005WV000002pMdFYAU","SystemModstamp":"2025-05-26T10:03:49.000+0000","LastActivityDate":null,"LastViewedDate":"2025-05-29T18:51:15.000+0000","LastReferencedDate":"2025-05-29T18:51:15.000+0000","IsPartner":false,"IsCustomerPortal":false,"Jigsaw":null,"JigsawCompanyId":null,"AccountSource":null,"SicDesc":null,"IsBuyer":false}]}
   */
  async findChildRecords(objectName, parentRecordId, childObjectName) {
    const childRelationship = await this.#getChildRelationship(objectName, childObjectName)

    if (!childRelationship) {
      throw new Error(`No child relationship found for "${ childObjectName }" in "${ objectName }"`)
    }

    const relatedField = childRelationship.field
    const childObjectFields = (await this.#getObjectFieldNames(childObjectName)).join(', ')

    return this.#findRecordsBySOQL({
      objectName: childObjectName,
      objectFields: childObjectFields,
      whereClause: `WHERE ${ relatedField } = '${ parentRecordId }'`,
      logTag: 'findChildRecords',
    })
  }

  /**
   * @description Finds a record of a specified Salesforce object by up to two fields and values you choose. Optionally, creates a record if none is found.
   *
   * @route POST /find-record
   * @operationName Find Record
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"Specified Salesforce object name (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"Search Field","name":"searchField","required":true,"dictionary":"getFilterableObjectFieldsDictionary","dependsOn":["objectName"],"description":"The name of the field to search."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","required":true,"description":"Value to match in the search field."}
   * @paramDef {"type":"String","label":"Second Search Field","name":"secondSearchField","dictionary":"getFilterableObjectFieldsDictionary","dependsOn":["objectName"],"description":"Name of an optional second field to search."}
   * @paramDef {"type":"String","label":"Second Search Value","name":"secondSearchValue","description":"Value to match in the second search field."}
   * @paramDef {"type":"String","label":"Search Operator","name":"searchOperator","uiComponent":{"type":"DROPDOWN","options":{"values":["AND","OR"]}},"description":"Operator between search conditions: `AND` returns records matching both fields; `OR` returns records matching either field. Default: `OR`."}
   * @paramDef {"type":"Boolean","label":"Create New Record","name":"createNewRecord","uiComponent":{"type":"TOGGLE"},"description":"If `true`, a new record will be created when none is found."}
   * @paramDef {"type":"Object","label":"New Record Fields","name":"newRecordFields","description":"Fields and values to set when creating a new record. Date fields must be in format `DD.MM.YYYY`."}
   *
   * @returns {SalesforceSearchResponse|SalesforceResponse} The found or created record, with its Salesforce ID and details.
   * @sampleResult {"totalSize":1,"done":true,"records":[{"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000VlZN3YAN"},"Id":"001WV00000VlZN3YAN","IsDeleted":false,"MasterRecordId":null,"Name":"ThirdFrChild","Type":null,"ParentId":"001WV00000VaIm9YAF","BillingStreet":null,"BillingCity":null,"BillingState":null,"BillingPostalCode":null,"BillingCountry":null,"BillingLatitude":null,"BillingLongitude":null,"BillingGeocodeAccuracy":null,"BillingAddress":null,"ShippingStreet":null,"ShippingCity":null,"ShippingState":null,"ShippingPostalCode":null,"ShippingCountry":null,"ShippingLatitude":null,"ShippingLongitude":null,"ShippingGeocodeAccuracy":null,"ShippingAddress":null,"Phone":null,"Fax":null,"Website":null,"PhotoUrl":null,"Industry":null,"AnnualRevenue":null,"NumberOfEmployees":null,"Description":null,"OwnerId":"005WV000002pMdFYAU","CreatedDate":"2025-05-26T10:03:49.000+0000","CreatedById":"005WV000002pMdFYAU","LastModifiedDate":"2025-05-26T10:03:49.000+0000","LastModifiedById":"005WV000002pMdFYAU","SystemModstamp":"2025-05-26T10:03:49.000+0000","LastActivityDate":null,"LastViewedDate":"2025-05-29T18:51:15.000+0000","LastReferencedDate":"2025-05-29T18:51:15.000+0000","IsPartner":false,"IsCustomerPortal":false,"Jigsaw":null,"JigsawCompanyId":null,"AccountSource":null,"SicDesc":null,"IsBuyer":false}]}
   */
  async findRecord(
    objectName,
    searchField,
    searchValue,
    secondSearchField,
    secondSearchValue,
    searchOperator,
    createNewRecord,
    newRecordFields
  ) {
    let whereClause = `WHERE ${ searchField } = '${ searchValue }'`

    if (secondSearchField && secondSearchValue) {
      whereClause += ` ${ searchOperator || 'OR' } ${ secondSearchField } = '${ secondSearchValue }'`
    }

    whereClause += ' LIMIT 1'

    const foundRecord = await this.#findRecordsBySOQL({ objectName, whereClause, logTag: 'findRecord' })

    if (foundRecord.records?.length > 0 || !createNewRecord) {
      return foundRecord
    }

    return this.createRecord(objectName, newRecordFields)
  }

  /**
   * @description Finds a record of a Salesforce object using a Salesforce Object Query (SOQL) WHERE clause. Optionally, creates a record if none is found.
   *
   * @route POST /find-record-by-query
   * @operationName Find Record by Query
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"Specified Salesforce object name (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"WHERE Clause","name":"whereClause","required":true,"description":"Enter a SOQL WHERE clause. See more about [Salesforce Object Query Language (SOQL)](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql.htm)."}
   * @paramDef {"type":"String","label":"Sort By","name":"sortBy","dictionary":"getFilterableObjectFieldsDictionary","dependsOn":["objectName"],"description":"The name of the field to sort query results by."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["ASC","DESC"]}},"description":"Specifies whether the results are ordered in ascending (`ASC`) or descending (`DESC`) order. Default is `ASC`."}
   * @paramDef {"type":"Boolean","label":"Create New Record","name":"createNewRecord","uiComponent":{"type":"TOGGLE"},"description":"If `true`, a new record will be created when none is found."}
   * @paramDef {"type":"Object","label":"New Record Fields","name":"newRecordFields","description":"Fields and values to set when creating a new record. Date fields must be in format `DD.MM.YYYY`."}
   *
   * @returns {SalesforceSearchResponse|SalesforceResponse} The matching record in the specified object.
   * @sampleResult {"totalSize":1,"records":[{"ShippingLatitude":null,"LastModifiedDate":"2024-11-04T11:14:26.000+0000","BillingCity":null,"JigsawCompanyId":null,"PersonActionCadenceAssigneeId":null,"PersonActiveTrackerCount":0,"Name":"Acc","Industry":null,"CreatedById":"005WV000001DCArYAO","PersonActionCadenceState":null,"BillingGeocodeAccuracy":null,"AccountSource":null,"BillingPostalCode":null,"PhotoUrl":null,"MasterRecordId":null,"IsDeleted":false,"LastViewedDate":"2024-11-04T12:42:37.000+0000","ShippingGeocodeAccuracy":null,"ShippingStreet":null,"IsBuyer":false,"ActivityMetricRollupId":"01KWV00000183wc2AA","ShippingPostalCode":null,"CreatedDate":"2024-11-01T12:08:35.000+0000","ShippingState":null,"Id":"001WV00000CLttAYAT","SicDesc":null,"BillingState":null,"AnnualRevenue":null,"IsPartner":false,"Jigsaw":null,"Description":null,"Website":"https://acc.com","LastReferencedDate":"2024-11-04T12:42:37.000+0000","BillingLatitude":null,"NumberOfEmployees":null,"BillingAddress":null,"PersonActionCadenceId":null,"ActivityMetricId":"0GqWV0000004CVd0AM","OwnerId":"005WV000001DCArYAO","BillingLongitude":null,"Phone":"+380957545785","ShippingCountry":null,"ShippingCity":null,"ParentId":null,"IsCustomerPortal":false,"SystemModstamp":"2024-11-04T11:14:26.000+0000","Type":"Customer","BillingCountry":null,"BillingStreet":null,"ShippingAddress":null,"LastActivityDate":null,"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000CLttAYAT"},"Fax":null,"LastModifiedById":"005WV000001DCArYAO","ShippingLongitude":null,"PersonScheduledResumeDateTime":null}],"done":true}
   */
  async findRecordByQuery(objectName, whereClause, sortBy, sortOrder, createNewRecord, newRecordFields) {
    let cleanWhereClause = whereClause.trim()

    if (!cleanWhereClause.toLowerCase().startsWith('where')) {
      throw new Error(`Invalid WHERE clause: "${ cleanWhereClause }". It must start with "WHERE"`)
    }

    if (sortBy) {
      cleanWhereClause += ` ORDER BY ${ sortBy } ${ sortOrder || 'ASC' }`
    }

    cleanWhereClause += ' LIMIT 1'

    const foundRecord = await this.#findRecordsBySOQL({
      objectName,
      whereClause: cleanWhereClause,
      logTag: 'findRecordByQuery',
    })

    if (foundRecord.records?.length > 0 || !createNewRecord) {
      return foundRecord
    }

    return this.createRecord(objectName, newRecordFields)
  }

  /**
   * @description Finds records of a specified Salesforce object by a field and a value you choose.
   *
   * @route GET /find-records
   * @operationName Find Records
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"Specified Salesforce object name (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"Search Field","name":"searchField","required":true,"dictionary":"getFilterableObjectFieldsDictionary","dependsOn":["objectName"],"description":"The name of the field to search."}
   * @paramDef {"type":"String","label":"Search Value","name":"searchValue","required":true,"description":"Value to match in the search field."}
   *
   * @returns {SalesforceSearchResponse} The matching records in the specified object.
   * @sampleResult {"totalSize":1,"done":true,"records":[{"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000VlZN3YAN"},"Id":"001WV00000VlZN3YAN","IsDeleted":false,"MasterRecordId":null,"Name":"ThirdFrChild","Type":null,"ParentId":"001WV00000VaIm9YAF","BillingStreet":null,"BillingCity":null,"BillingState":null,"BillingPostalCode":null,"BillingCountry":null,"BillingLatitude":null,"BillingLongitude":null,"BillingGeocodeAccuracy":null,"BillingAddress":null,"ShippingStreet":null,"ShippingCity":null,"ShippingState":null,"ShippingPostalCode":null,"ShippingCountry":null,"ShippingLatitude":null,"ShippingLongitude":null,"ShippingGeocodeAccuracy":null,"ShippingAddress":null,"Phone":null,"Fax":null,"Website":null,"PhotoUrl":null,"Industry":null,"AnnualRevenue":null,"NumberOfEmployees":null,"Description":null,"OwnerId":"005WV000002pMdFYAU","CreatedDate":"2025-05-26T10:03:49.000+0000","CreatedById":"005WV000002pMdFYAU","LastModifiedDate":"2025-05-26T10:03:49.000+0000","LastModifiedById":"005WV000002pMdFYAU","SystemModstamp":"2025-05-26T10:03:49.000+0000","LastActivityDate":null,"LastViewedDate":"2025-05-29T18:51:15.000+0000","LastReferencedDate":"2025-05-29T18:51:15.000+0000","IsPartner":false,"IsCustomerPortal":false,"Jigsaw":null,"JigsawCompanyId":null,"AccountSource":null,"SicDesc":null,"IsBuyer":false}]}
   */
  async findRecords(objectName, searchField, searchValue) {
    return this.#findRecordsBySOQL({
      objectName,
      whereClause: `WHERE ${ searchField } = '${ searchValue }'`,
      logTag: 'findRecords',
    })
  }

  /**
   * @description Finds one or more records of a Salesforce object using a Salesforce Object Query (SOQL) WHERE clause.
   *
   * @route GET /find-records-by-query
   * @operationName Find Records by Query
   * @category Record Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"Specified Salesforce object name (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"WHERE Clause","name":"whereClause","required":true,"description":"Enter a SOQL WHERE clause. See more about [Salesforce Object Query Language (SOQL)](https://developer.salesforce.com/docs/atlas.en-us.soql_sosl.meta/soql_sosl/sforce_api_calls_soql.htm)."}
   *
   * @returns {SalesforceSearchResponse} The matching records in the specified object.
   * @sampleResult {"totalSize":1,"records":[{"ShippingLatitude":null,"LastModifiedDate":"2024-11-04T11:14:26.000+0000","BillingCity":null,"JigsawCompanyId":null,"PersonActionCadenceAssigneeId":null,"PersonActiveTrackerCount":0,"Name":"Acc","Industry":null,"CreatedById":"005WV000001DCArYAO","PersonActionCadenceState":null,"BillingGeocodeAccuracy":null,"AccountSource":null,"BillingPostalCode":null,"PhotoUrl":null,"MasterRecordId":null,"IsDeleted":false,"LastViewedDate":"2024-11-04T12:42:37.000+0000","ShippingGeocodeAccuracy":null,"ShippingStreet":null,"IsBuyer":false,"ActivityMetricRollupId":"01KWV00000183wc2AA","ShippingPostalCode":null,"CreatedDate":"2024-11-01T12:08:35.000+0000","ShippingState":null,"Id":"001WV00000CLttAYAT","SicDesc":null,"BillingState":null,"AnnualRevenue":null,"IsPartner":false,"Jigsaw":null,"Description":null,"Website":"https://acc.com","LastReferencedDate":"2024-11-04T12:42:37.000+0000","BillingLatitude":null,"NumberOfEmployees":null,"BillingAddress":null,"PersonActionCadenceId":null,"ActivityMetricId":"0GqWV0000004CVd0AM","OwnerId":"005WV000001DCArYAO","BillingLongitude":null,"Phone":"+380957545785","ShippingCountry":null,"ShippingCity":null,"ParentId":null,"IsCustomerPortal":false,"SystemModstamp":"2024-11-04T11:14:26.000+0000","Type":"Customer","BillingCountry":null,"BillingStreet":null,"ShippingAddress":null,"LastActivityDate":null,"attributes":{"type":"Account","url":"/services/data/v62.0/sobjects/Account/001WV00000CLttAYAT"},"Fax":null,"LastModifiedById":"005WV000001DCArYAO","ShippingLongitude":null,"PersonScheduledResumeDateTime":null}],"done":true}
   */
  async findRecordsByQuery(objectName, whereClause) {
    const cleanWhereClause = whereClause.trim()

    if (!cleanWhereClause.toLowerCase().startsWith('where')) {
      throw new Error(`Invalid WHERE clause: "${ cleanWhereClause }". It must start with "WHERE"`)
    }

    return this.#findRecordsBySOQL({
      objectName,
      whereClause: cleanWhereClause,
      logTag: 'findRecordsByQuery',
    })
  }

  /**
   * @description Gets all notes and attachments for a record.
   *
   * @route GET /record-attachments
   * @operationName Get Record Attachments
   * @category Document Management
   *
   * @appearanceColor #00a2e1 #78c7e5
   * @executionTimeoutInSeconds 120
   * @requiredOauth2Scopes api
   *
   * @paramDef {"type":"String","label":"Object Name","name":"objectName","required":true,"dictionary":"getSObjectsDictionary","description":"Specified Salesforce object name (e.g., Account, Opportunity)."}
   * @paramDef {"type":"String","label":"Record","name":"recordId","required":true,"dictionary":"getRecordsDictionary","dependsOn":["objectName"],"description":"The ID of the Salesforce record."}
   *
   * @returns {NotesAttachmentsResponse} Array of objects representing notes and attachments.
   * @sampleResult {"attachments":[{"ParentId":"001WV00000W15suYAB","LastModifiedDate":"2025-06-03T14:59:33.000+0000","IsDeleted":false,"Description":null,"ContentType":null,"Name":"Grow-Chamomile-1600x900.jpg","SystemModstamp":"2025-06-03T14:59:33.000+0000","OwnerId":"005WV000002pMdFYAU","CreatedById":"005WV000002pMdFYAU","CreatedDate":"2025-06-03T14:59:33.000+0000","attributes":{"type":"Attachment","url":"/services/data/v62.0/sobjects/Attachment/00PWV0000033CBC2A2"},"Id":"00PWV0000033CBC2A2","IsPrivate":false,"BodyLength":163078,"Body":"/services/data/v62.0/sobjects/Attachment/00PWV0000033CBC2A2/Body","LastModifiedById":"005WV000002pMdFYAU"}],"notes":[{"ParentId":"001WV00000W15suYAB","LastModifiedDate":"2025-06-03T14:55:43.000+0000","IsDeleted":false,"Title":"newnote2","SystemModstamp":"2025-06-03T14:55:43.000+0000","OwnerId":"005WV000002pMdFYAU","CreatedById":"005WV000002pMdFYAU","CreatedDate":"2025-06-03T14:55:43.000+0000","attributes":{"type":"Note","url":"/services/data/v62.0/sobjects/Note/002WV00000395OaYAI"},"Id":"002WV00000395OaYAI","IsPrivate":false,"Body":null,"LastModifiedById":"005WV000002pMdFYAU"}]}
   */
  async getRecordAttachments(objectName, recordId) {
    const contentDocumentLinks = await this.#findRecordsBySOQL({
      objectName: 'ContentDocumentLink',
      objectFields: 'ContentDocumentId',
      whereClause: `WHERE LinkedEntityId = '${ recordId }'`,
      logTag: 'getContentDocumentLinks',
    })

    const documentIds = contentDocumentLinks.records.reduce((acc, record) => {
      if (record.ContentDocumentId) {
        acc.push(`'${ record.ContentDocumentId }'`)
      }

      return acc
    }, [])

    let enhancedNotes = { totalSize: 0, records: [], done: true }

    if (documentIds.length > 0) {
      enhancedNotes = await this.#findRecordsBySOQL({
        objectName: 'ContentVersion',
        whereClause: `WHERE ContentDocumentId IN (${ documentIds.join(', ') })`,
        logTag: 'getRecordEnhancedNotes',
      })
    }

    const [attachments, notes] = await Promise.all([
      this.#findRecordsBySOQL({
        objectName: 'Attachment',
        whereClause: `WHERE ParentId = '${ recordId }'`,
        logTag: 'getRecordAttachments',
      }),
      this.#findRecordsBySOQL({
        objectName: 'Note',
        whereClause: `WHERE ParentId = '${ recordId }'`,
        logTag: 'getRecordNotes',
      }),
    ])

    return {
      attachments: [...attachments.records, ...enhancedNotes.records],
      notes: notes.records,
    }
  }
}

Flowrunner.ServerCode.addService(SalesforceProService, [
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
