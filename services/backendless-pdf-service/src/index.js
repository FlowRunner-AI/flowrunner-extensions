const { createClient } = require('backendless-console-sdk')
const Backendless = require('backendless')

const ClustersHosts = {
  'US': 'https://develop.backendless.com',
  'Europe': 'https://eu-develop.backendless.com',
  'Stage(SHOULD_NOT_BE_IN_PROD)': 'https://stage.backendless.com',
  'DevTest(SHOULD_NOT_BE_IN_PROD)': 'https://devtest.backendless.com',
  'Local(SHOULD_NOT_BE_IN_PROD)': 'http://localhost:3001',
}

const logger = {
  info: (...args) => console.log('[Backendless PDF Service] info:', ...args),
  debug: (...args) => console.log('[Backendless PDF Service] debug:', ...args),
  error: (...args) => console.log('[Backendless PDF Service] error:', ...args),
  warn: (...args) => console.log('[Backendless PDF Service] warn:', ...args),
}

/**
 * @requireOAuth
 * @integrationName Backendless PDF Service
 * @integrationIcon /icon.png
 **/
class BackendlessPDFService {
  constructor(config) {
    this.clusterURL = config.clusterConsoleURL || ClustersHosts[config.clusterKey] || ClustersHosts['DevTest(SHOULD_NOT_BE_IN_PROD)']

    this.clientId = config.clientId
    this.clientSecret = config.clientSecret
    this.scope = ''
  }

  async #getApiSdk(appId, apiKey) {
    if (!this.apiSDK) {
      const client = this.#getClient()

      const { apiURL: serverURL } = await client.system.loadStatus()

      if (!apiKey) {
        const appSettings = await client.settings.getAppSettings(appId)

        apiKey = appSettings.apiKeysMap.REST
      }

      this.apiSDK = Backendless.initApp({
        appId,
        apiKey,
        serverURL,
        standalone: true,
      })
    }

    return this.apiSDK
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  #getAccessTokenHeader(accessToken) {
    logger.debug(`[#getAccessTokenHeader] accessToken=${ accessToken }`)

    return {
      'auth-key': accessToken,
    }
  }

  #getSecretTokenHeader() {
    const token = Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')

    return {
      Authorization: `Basic ${ token }`,
    }
  }

  #getClient() {
    return createClient(this.clusterURL, this.#getAccessToken())
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

    return `${ this.clusterURL }/developer/oauth2/authorize?${ params.toString() }`
  }

  /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   * @returns {refreshToken_ResultObject}
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()
    params.append('grant_type', 'refresh_token')
    params.append('refresh_token', refreshToken)
    params.append('scope', this.scope)

    try {
      const response = await Flowrunner.Request.post(`${ this.clusterURL }/developer/oauth2/token`)
        .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
        .set(this.#getSecretTokenHeader())
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error('Error refreshing token: ', error.message || error)

      throw error
    }
  }

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()
    params.append('grant_type', 'authorization_code')
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code', callbackObject.code)

    const { expires_in, access_token, refresh_token } = await Flowrunner.Request
      .post(`${ this.clusterURL }/developer/oauth2/token`)
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .set(this.#getSecretTokenHeader())
      .send(params.toString())

    let userInfo = {}

    try {
      userInfo = await Flowrunner.Request
        .get(`${ this.clusterURL }/console/home/myaccount`)
        .set(this.#getAccessTokenHeader(access_token))

      logger.debug(`[executeCallback] userInfo response: ${ JSON.stringify(userInfo, null, 2) }`)
    } catch (error) {
      logger.error(`[executeCallback] userInfo error: ${ JSON.stringify(error, null, 2) }`)

      return {}
    }

    return {
      token: access_token,
      refreshToken: refresh_token,
      expirationInSeconds: expires_in,
      overwrite: true,
      connectionIdentityName: `${ userInfo.name } (${ userInfo.email })`,
      connectionIdentityImageURL: null,
    }
  }

  // ======================================= DICTIONARIES ========================================

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
   */

  /**
   * @typedef {Object} getAppsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter applications by name."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Apps
   * @category Application Management
   * @description Returns available Backendless applications for AI-powered app selection.
   *
   * @route POST /get-apps
   *
   * @paramDef {"type":"getAppsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering applications."}
   *
   * @sampleResult {"items":[{"label":"Production App","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"EEEE5555-FFFF-6666-GGGG-7777HHHH8888"}]}
   * @returns {DictionaryResponse}
   */
  async getAppsDictionary({ search }) {
    const client = this.#getClient()
    const apps = await client.apps.getApps()

    const filteredApps = search
      ? apps.filter(app => app.name.toLowerCase().includes(search.toLowerCase()))
      : apps

    return {
      items: filteredApps.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id } `,
      })),
    }
  }

  /**
   * @typedef {Object} getApiKeysDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getApiKeysDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter API keys by name."}
   * @paramDef {"type":"getApiKeysDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get API Keys
   * @category Application Management
   * @description Returns available API keys for the selected Backendless application.
   *
   * @route POST /get-api-keys
   *
   * @paramDef {"type":"getApiKeysDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering API keys."}
   *
   * @sampleResult {"items":[{"label":"REST","value":"E652EBBB-1234-6578-A5CB-D31092D9E54D"},{"label":"JS","value":"49C1A506-5084-49DB-8F17-AF921F496C72"}]}
   * @returns {DictionaryResponse}
   */
  async getApiKeysDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const appSettings = await client.settings.getAppSettings(appId)

    const filteredApiKeys = search
      ? appSettings.apiKeys.filter(apiKey => apiKey.name.toLowerCase().includes(search.toLowerCase()))
      : appSettings.apiKeys

    return {
      items: filteredApiKeys.map(apiKey => ({
        label: apiKey.name,
        value: apiKey.apiKey,
      })),
    }
  }

  /**
   * @typedef {Object} getPdfTemplatesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"App ID","name":"appId","required":true,"description":"Unique identifier of the Backendless application."}
   */

  /**
   * @typedef {Object} getPdfTemplatesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter PDF templates by name."}
   * @paramDef {"type":"getPdfTemplatesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameter to identify the Backendless application."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get PDF Templates
   * @category PDF Management
   * @description Returns available PDF templates for AI-powered document operations. Enables AI agents to dynamically select appropriate PDF templates for document generation and processing.
   *
   * @route POST /get-pdf-templates
   *
   * @paramDef {"type":"getPdfTemplatesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string for filtering PDF templates."}
   *
   * @sampleResult {"items":[{"label":"pdf-template","note":"ID: EEEE5555-FFFF-6666-GGGG-7777HHHH8888","value":"EEEE5555-FFFF-6666-GGGG-7777HHHH8888"}]}
   * @returns {DictionaryResponse}
   */
  async getPdfTemplatesDictionary({ search, criteria: { appId } }) {
    const client = this.#getClient()
    const pdfTemplates = await client.pdf.listTemplates(appId)

    const filteredPdfTemplates = search
      ? pdfTemplates.filter(item => item.name.toLowerCase().includes(search.toLowerCase()))
      : pdfTemplates

    return {
      items: filteredPdfTemplates.map(({ id, name }) => ({
        label: name,
        value: id,
        note: `ID: ${ id }`,
      })),
    }
  }

  // ==================================== END OF DICTIONARIES ====================================

  /**
   * @operationName Generate PDF
   * @description Generates PDF documents from HTML templates using Backendless template system.
   *
   * @appearanceColor #F4C3C5 #ED797E
   * @executionTimeoutInSeconds 120
   * @route POST /generate-pdf
   *
   * @paramDef {"type":"String","label":"App","name":"appId","required":true,"dictionary":"getAppsDictionary","description":"Select the Backendless application to generate PDFs from. This determines which app's PDF service will be used for the operation."}
   * @paramDef {"type":"String","label":"API Key","name":"apiKey","required":false,"dictionary":"getApiKeysDictionary","dependsOn":["appId"],"description":"Select the Backendless API Key which will be used for connecting to the Backendless application. By default, it uses REST API Key."}
   * @paramDef {"type":"String","label":"Template","name":"templateId","required":true,"dictionary":"getPdfTemplatesDictionary","dependsOn":["appId"],"description":"ID of the HTML template to use for PDF generation."}
   * @paramDef {"type":"String","label":"File Name","name":"fileName","required":true,"description":"Name for the generated PDF file including extension. Example: `generated.pdf`"}
   * @paramDef {"type":"String","label":"File Path","name":"filePath","required":true,"description":"Complete path where the PDF will be saved in Backendless storage. Example: `/path/to/folder`"}
   * @paramDef {"type":"String","label":"Template Values","name":"values","description":"Key–value pairs for **dynamic fields** defined in the template's *Field List*."}
   *
   * @sampleResult {"path":"path/to/folder/generated.pdf","__fileUrlAware":true,"fileURL":"https://test.backendless.app/api/files/path/to/folder/generated.pdf"}
   */
  async generatePDF(appId, apiKey, templateId, fileName, filePath, values) {
    const client = this.#getClient()

    const template = await client.pdf.loadTemplate(appId, templateId)
    logger.debug('template:', JSON.stringify(template))

    return client.pdf.generatePDF(appId, {
      template: JSON.stringify(template),
      values: values || {},
      name: fileName,
      path: filePath,
    })
  }
}

Flowrunner.ServerCode.addService(BackendlessPDFService, [
  {
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientId',
    hint: 'Your OAuth 2.0 Client ID from the Backendless Cluster',
  },
  {
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    name: 'clientSecret',
    hint: 'Your OAuth 2.0 Client Secret from the Backendless Cluster',
  },
  {
    displayName: 'Cluster Zone',
    name: 'clusterKey',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    options: Object.keys(ClustersHosts),
    required: true,
    shared: true,
    defaultValue: 'DevTest(SHOULD_NOT_BE_IN_PROD)',
    hint: 'Select the Backendless cluster where your app is located',
  },
  {
    displayName: 'Cluster Console URL',
    name: 'clusterConsoleURL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    defaultValue: '',
    hint: 'Provide when you need to specify your own Backendless PRO cluster. Example: https://develop.backendless.com',
  },
])
