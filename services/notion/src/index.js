'use strict'
const { Client } = require('@notionhq/client')

const OAUTH_BASE_URL = 'https://api.notion.com/v1'

const logger = {
  info: (...args) => console.log('[Notion Service] info:', ...args),
  debug: (...args) => console.log('[Notion Service] debug:', ...args),
  error: (...args) => console.log('[Notion Service] error:', ...args),
  warn: (...args) => console.log('[Notion Service] warn:', ...args),
}

/**
 * @typedef {Object} NotionPage
 * @property {string} object - Always "page"
 * @property {string} id - Page ID
 * @property {string} created_time - Creation timestamp
 * @property {string} last_edited_time - Last edit timestamp
 * @property {Object} created_by - User who created the page
 * @property {Object} last_edited_by - User who last edited the page
 * @property {Object} parent - Parent object (database or page)
 * @property {boolean} archived - Whether the page is archived
 * @property {Object} properties - Page properties
 * @property {string} url - Page URL
 */

/**
 * @typedef {Object} NotionDatabase
 * @property {string} object - Always "database"
 * @property {string} id - Database ID
 * @property {string} created_time - Creation timestamp
 * @property {string} last_edited_time - Last edit timestamp
 * @property {Object} title - Database title
 * @property {Object} properties - Database schema properties
 * @property {string} url - Database URL
 */

/**
 * @typedef {Object} NotionBlock
 * @property {string} object - Always "block"
 * @property {string} id - Block ID
 * @property {Object} parent - Parent object
 * @property {string} created_time - Creation timestamp
 * @property {string} last_edited_time - Last edit timestamp
 * @property {boolean} has_children - Whether block has children
 * @property {boolean} archived - Whether block is archived
 * @property {string} type - Block type
 */

/**
 * @typedef {Object} NotionBlockList
 * @property {string} object - Always "list"
 * @property {Array<NotionBlock>} results - Array of blocks
 * @property {string|null} next_cursor - Pagination cursor
 * @property {boolean} has_more - Whether more results exist
 */

/**
 * @typedef {Object} NotionUser
 * @property {string} object - Always "user"
 * @property {string} id - User ID
 * @property {string} name - User name
 * @property {string} avatar_url - User avatar URL
 * @property {string} type - User type
 */

/**
 * @typedef {Object} NotionUserList
 * @property {string} object - Always "list"
 * @property {Array<NotionUser>} results - Array of users
 * @property {string|null} next_cursor - Pagination cursor
 * @property {boolean} has_more - Whether more results exist
 */

/**
 * @typedef {Object} NotionComment
 * @property {string} object - Always "comment"
 * @property {string} id - Comment ID
 * @property {Object} parent - Parent object
 * @property {string} discussion_id - Discussion thread ID
 * @property {string} created_time - Creation timestamp
 * @property {Array<Object>} rich_text - Comment content
 */

/**
 * @typedef {Object} NotionCommentList
 * @property {string} object - Always "list"
 * @property {Array<NotionComment>} results - Array of comments
 * @property {string|null} next_cursor - Pagination cursor
 * @property {boolean} has_more - Whether more results exist
 */

/**
 * @typedef {Object} NotionDatabaseQueryResult
 * @property {string} object - Always "list"
 * @property {Array<NotionPage>} results - Array of database pages
 * @property {string|null} next_cursor - Pagination cursor
 * @property {boolean} has_more - Whether more results exist
 */

/**
 * @typedef {Object} NotionPageProperty
 * @property {string} object - Always "property_item"
 * @property {string} id - Property ID
 * @property {string} type - Property type
 * @property {string|null} next_cursor - Pagination cursor for property values
 * @property {boolean} has_more - Whether more property values exist
 */

/**
 *  @requireOAuth
 *  @integrationName Notion
 *  @integrationIcon /icon.png
 **/
class Notion {
  constructor(config) {
    this.clientId = config.clientId
    this.clientSecret = config.clientSecret

    this.base64Credentials = this.#getBase64Credentials()
  }

  #getBase64Credentials() {
    if (!this.clientId || !this.clientSecret) {
      return null
    }

    return Buffer.from(`${ this.clientId }:${ this.clientSecret }`).toString('base64')
  }

  /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   * @returns {String}
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    params.append('client_id', this.clientId)
    params.append('response_type', 'code')
    params.append('owner', 'user')

    return `${ OAUTH_BASE_URL }/oauth/authorize?${ params.toString() }`
  }

  /**/

  /**
   * @typedef {Object} refreshToken_ResultObject
   *
   * @property {String} token
   * @property {Number} [expirationInSeconds]
   */

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

    try {
      const response = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/oauth/token`)
        .set({
          Authorization: `Basic ${ this.base64Credentials }`,
          'Content-Type': 'application/x-www-form-urlencoded',
        })
        .send(params.toString())

      return {
        token: response.access_token,
        expirationInSeconds: response.expires_in,
        refreshToken: response.refresh_token || refreshToken,
      }
    } catch (error) {
      logger.error('refreshToken - Error refreshing token:', error.message || error)
      throw error
    }
  }

  /**
   * @typedef {Object} executeCallback_ResultObject
   *
   * @property {String} token
   * @property {String} [refreshToken]
   * @property {Number} [expirationInSeconds]
   * @property {Object} [userData]
   * @property {Boolean} [overwrite]
   * @property {String} connectionIdentityName
   * @property {String} [connectionIdentityImageURL]
   */

  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} callbackObject
   * @returns {executeCallback_ResultObject}
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('grant_type', 'authorization_code')
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)

    let codeExchangeResponse = {}

    try {
      codeExchangeResponse = await Flowrunner.Request.post(`${ OAUTH_BASE_URL }/oauth/token`)
        .set({
          Authorization: `Basic ${ this.base64Credentials }`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Notion-Version': '2022-06-28',
        })
        .send(params.toString())
    } catch (e) {
      logger.error('executeCallback - Error execute callback:', JSON.stringify(e))
    }

    const notion = new Client({ auth: codeExchangeResponse.access_token })

    const userInfo = await notion.users.me()

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: userInfo.name || null,
      connectionIdentityImageURL: userInfo.avatar_url || null,
      overwrite: true,
      userData: codeExchangeResponse,
    }
  }

  #getNotionClient() {
    return new Client({ auth: this.#getAccessToken() })
  }

  #getAccessToken() {
    return this.request.headers['oauth-access-token']
  }

  async #execNotionAPI(label, callback) {
    try {
      const notion = this.#getNotionClient()

      return await callback(notion)
    } catch (error) {
      logger.error(`${ label } - Error: ${ JSON.stringify(error) }`)
      throw error
    }
  }

  /**
   * @operationName Create Page
   * @category Page Management
   * @description Creates a new page in Notion as a child of an existing page. Supports rich content blocks including text, headings, lists, and embeds. The page properties and content can be formatted with Notion's rich text capabilities for comprehensive page creation.
   * @route POST /createPage
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the parent page where the new page is inserted."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The properties for the new page (as defined by the database schema)."}
   * @paramDef {"type":"Array.<Object>","label":"Children","name":"children","required":false,"description":"Optional content to add as blocks (e.g., text, lists) to the page."}
   * @returns {NotionPage} The response from the Notion API after creating the page.
   * @sampleResult {"object":"page","id":"59833787-2cf9-4fdf-8782-e53db20768a5","created_time":"2022-03-01T19:05:00.000Z","last_edited_time":"2022-07-06T19:16:00.000Z","parent":{"type":"page_id","page_id":"b55c9c91-384d-452b-81db-d1ef79372b75"},"properties":{"title":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"New Page Title"}}]}},"url":"https://www.notion.so/New-Page-59833787-2cf9-4fdf-8782-e53db20768a5"}
   */
  async createPage(pageId, properties, children = []) {
    return this.#execNotionAPI('createPage', notion => {
      return notion.pages.create({
        parent: { page_id: pageId },
        properties: properties,
        children: children,
      })
    })
  }

  /**
   * @operationName Get Page
   * @category Page Management
   * @description Retrieves complete page information including all properties, metadata, and parent relationships. Returns the full page object with creation time, last edited time, and all associated data for comprehensive page access.
   * @route GET /getPage
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the page to retrieve."}
   * @returns {NotionPage} The page object from Notion API.
   * @sampleResult {"object":"page","id":"59833787-2cf9-4fdf-8782-e53db20768a5","created_time":"2022-03-01T19:05:00.000Z","last_edited_time":"2022-07-06T19:16:00.000Z","parent":{"type":"page_id","page_id":"b55c9c91-384d-452b-81db-d1ef79372b75"},"properties":{"title":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Page Title"}}]}},"url":"https://www.notion.so/Page-Title-59833787-2cf9-4fdf-8782-e53db20768a5"}
   */
  async getPage(pageId) {
    return this.#execNotionAPI('getPage', notion => {
      return notion.pages.retrieve({ page_id: pageId })
    })
  }

  /**
   * @operationName Get Page Property Item
   * @category Page Management
   * @description Retrieves the value of a specific property from a page, including paginated values for properties with multiple items. Useful for accessing large property values like relation lists or rich text content that may be truncated in the main page object.
   * @route GET /getPagePropertyItem
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the page to retrieve."}
   * @paramDef {"type":"String","label":"Property ID","name":"propertyId","required":true,"description":"The ID of the property to retrieve from the page."}
   * @returns {NotionPageProperty} The value of the specified property from the page.
   * @sampleResult {"object":"property_item","id":"title","type":"title","title":{"type":"text","text":{"content":"Page Title"},"annotations":{"bold":false,"italic":false,"strikethrough":false,"underline":false,"code":false,"color":"default"},"plain_text":"Page Title","href":null}}
   */
  async getPageItem(pageId, propertyId) {
    return this.#execNotionAPI('getPageItem', notion => {
      return notion.pages.properties.retrieve({ page_id: pageId, property_id: propertyId })
    })
  }

  /**
   * @operationName Add Content To Page
   * @category Page Management
   * @description Appends new content blocks to an existing page, supporting all Notion block types including paragraphs, headings, lists, images, and embeds. Content is added at the end of the page and maintains proper formatting and structure.
   * @route PUT /addContentToPage
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the page to add content to."}
   * @paramDef {"type":"Array.<Object>","label":"Content","name":"content","required":true,"description":"An array of block objects to be appended to the page."}
   * @returns {NotionBlockList} The response from the Notion API with details of the updated page content.
   * @sampleResult {"object":"list","results":[{"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"New paragraph content"}}],"color":"default"}}],"next_cursor":null,"has_more":false}
   */
  async addContentToPage(pageId, content) {
    return this.#execNotionAPI('addContentToPage', notion => {
      return notion.blocks.children.append({
        block_id: pageId,
        children: content,
      })
    })
  }

  /**
   * @operationName Update Page Properties
   * @category Page Management
   * @description Updates specific properties of an existing page such as title, status, tags, or custom database fields. Only the provided properties are modified while others remain unchanged, allowing for precise updates.
   * @route PUT /updatePageProperties
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the page to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The properties of the page to update."}
   * @returns {NotionPage} The response from the Notion API with the updated page properties details.
   * @sampleResult {"object":"page","id":"59833787-2cf9-4fdf-8782-e53db20768a5","created_time":"2022-03-01T19:05:00.000Z","last_edited_time":"2022-07-06T19:16:00.000Z","parent":{"type":"page_id","page_id":"b55c9c91-384d-452b-81db-d1ef79372b75"},"properties":{"title":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Updated Page Title"}}]}},"url":"https://www.notion.so/Updated-Page-Title-59833787-2cf9-4fdf-8782-e53db20768a5"}
   */
  async updatePageProperties(pageId, properties) {
    return this.#execNotionAPI('updatePageProperties', notion => {
      return notion.pages.update({ page_id: pageId, properties })
    })
  }

  /**
   * @operationName Delete Page
   * @category Page Management
   * @description Moves a page to the trash by setting its archived status to true. The page becomes inaccessible through normal API calls but can be restored from the trash through the Notion interface if needed.
   * @route DELETE /deletePage
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":true,"description":"The ID of the page to delete."}
   * @returns {NotionPage}
   * @sampleResult {"object":"page","id":"59833787-2cf9-4fdf-8782-e53db20768a5","created_time":"2022-03-01T19:05:00.000Z","last_edited_time":"2022-07-06T19:16:00.000Z","archived":true,"parent":{"type":"page_id","page_id":"b55c9c91-384d-452b-81db-d1ef79372b75"},"properties":{"title":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Deleted Page"}}]}},"url":"https://www.notion.so/Deleted-Page-59833787-2cf9-4fdf-8782-e53db20768a5"}
   */
  async deletePage(pageId) {
    return this.#execNotionAPI('deletePage', notion => {
      return notion.pages.update({ page_id: pageId, in_trash: true })
    })
  }

  /**
   * @operationName Create Database
   * @category Database Management
   * @description Creates a new database within a parent page with custom properties and schema. Define columns with various types like text, number, select, date, and relations to structure your data collection effectively.
   * @route POST /createDatabase
   * @paramDef {"type":"String","label":"Parent Page ID","name":"parentPageId","required":true,"description":"The ID of the parent page where the database will be created."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the new database."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"An object of property objects defining the database's schema."}
   * @returns {NotionDatabase} The newly created database information
   * @sampleResult {"object":"database","id":"bc1211ca-e3f1-4939-ae34-5260b16f627c","created_time":"2021-07-08T23:50:00.000Z","last_edited_time":"2021-07-08T23:50:00.000Z","title":[{"type":"text","text":{"content":"Tasks Database"}}],"properties":{"Name":{"id":"title","type":"title","title":{}},"Status":{"id":"J@cS","type":"select","select":{"options":[{"id":"1","name":"To Do","color":"red"},{"id":"2","name":"Doing","color":"yellow"},{"id":"3","name":"Done","color":"green"}]}}}}
   */
  async createDatabase(parentPageId, title, properties) {
    return this.#execNotionAPI('createDatabase', notion => {
      return notion.databases.create({
        parent: { page_id: parentPageId },
        title: [{ type: 'text', text: { content: title } }],
        properties,
      })
    })
  }

  /**
   * @operationName Get Database
   * @category Database Management
   * @description Retrieves complete database schema including all property definitions, views, and filters. Use this to understand database structure before creating or updating items. Returns property types, formulas, and relation configurations.
   * @route GET /getDatabase
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the database you want to retrieve."}
   * @returns {NotionDatabase} The database object from Notion API
   * @sampleResult {"object":"database","id":"bc1211ca-e3f1-4939-ae34-5260b16f627c","created_time":"2021-07-08T23:50:00.000Z","last_edited_time":"2021-07-08T23:50:00.000Z","title":[{"type":"text","text":{"content":"Tasks Database"}}],"properties":{"Name":{"id":"title","type":"title","title":{}},"Status":{"id":"J@cS","type":"select","select":{"options":[{"id":"1","name":"To Do","color":"red"},{"id":"2","name":"Doing","color":"yellow"},{"id":"3","name":"Done","color":"green"}]}}}}
   */
  async getDatabase(databaseId) {
    return this.#execNotionAPI('getDatabase', notion => {
      return notion.databases.retrieve({ database_id: databaseId })
    })
  }

  /**
   * @operationName Create Database Item
   * @category Database Management
   * @description Creates a new item (page) within a database with specified property values and optional content blocks. The properties must match the database schema, and content can include rich text, headings, lists, and other block types.
   * @route POST /createDatabaseItem
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the Notion database where the item will be created."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The properties for the new database item, as defined by the database schema."}
   * @paramDef {"type":"Array.<Object>","label":"Children","name":"children","required":false,"description":"Optional content to add as blocks (e.g., text, lists) to the database item."}
   * @returns {NotionPage} The response from the Notion API after creating the database item.
   * @sampleResult {"object":"page","id":"251d2b5f-268c-4de2-afe9-c71ff92ca95c","created_time":"2023-03-01T19:05:00.000Z","last_edited_time":"2023-03-01T20:00:00.000Z","parent":{"type":"database_id","database_id":"bc1211ca-e3f1-4939-ae34-5260b16f627c"},"properties":{"Name":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"New Task"}}]},"Status":{"id":"J@cS","type":"select","select":{"id":"1","name":"To Do","color":"red"}}},"url":"https://www.notion.so/New-Task-251d2b5f268c4de2afe9c71ff92ca95c"}
   */
  async createDatabaseItem(databaseId, properties, children = []) {
    return this.#execNotionAPI('createDatabaseItem', notion => {
      return notion.pages.create({ parent: { database_id: databaseId }, properties, children })
    })
  }

  /**
   * @operationName Update Database
   * @category Database Management
   * @description Updates database metadata including title, description, or property schema. Use this to modify database structure, add new properties, or change existing property configurations while preserving existing data.
   * @route PUT /updateDatabase
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the database to update."}
   * @paramDef {"type":"Array.<Object>","label":"Title","name":"title","required":false,"description":"The title of the database to update."}
   * @paramDef {"type":"Array.<Object>","label":"Description","name":"description","required":false,"description":"The description of the database to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":false,"description":"The properties of the database to update."}
   * @returns {NotionDatabase} The response from the Notion API with the updated database details.
   * @sampleResult {"object":"database","id":"bc1211ca-e3f1-4939-ae34-5260b16f627c","created_time":"2021-07-08T23:50:00.000Z","last_edited_time":"2021-07-08T23:50:00.000Z","title":[{"type":"text","text":{"content":"Updated Tasks Database"}}],"properties":{"Name":{"id":"title","type":"title","title":{}},"Status":{"id":"J@cS","type":"select","select":{"options":[{"id":"1","name":"To Do","color":"red"},{"id":"2","name":"Doing","color":"yellow"},{"id":"3","name":"Done","color":"green"}]}}}}
   */
  async updateDatabase(databaseId, title, description, properties) {
    return this.#execNotionAPI('updateDatabase', notion => {
      return notion.databases.update({ database_id: databaseId, title, description, properties })
    })
  }

  /**
   * @operationName Update Database Item
   * @category Database Management
   * @description Updates specific properties of an existing database item while preserving other values. Only the provided properties are modified, making it ideal for status updates, field corrections, or adding new information to existing records.
   * @route PUT /updateDatabaseItem
   * @paramDef {"type":"String","label":"Item ID","name":"itemId","required":true,"description":"The ID of the page representing the database item to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The updated properties for the database item, as defined by the database schema."}
   * @returns {NotionPage} The response from the Notion API with the updated database item details.
   * @sampleResult {"object":"page","id":"251d2b5f-268c-4de2-afe9-c71ff92ca95c","created_time":"2023-03-01T19:05:00.000Z","last_edited_time":"2023-03-01T20:00:00.000Z","parent":{"type":"database_id","database_id":"bc1211ca-e3f1-4939-ae34-5260b16f627c"},"properties":{"Name":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Updated Task"}}]},"Status":{"id":"J@cS","type":"select","select":{"id":"3","name":"Done","color":"green"}}},"url":"https://www.notion.so/Updated-Task-251d2b5f268c4de2afe9c71ff92ca95c"}
   */
  async updateDatabaseItem(itemId, properties) {
    return this.#execNotionAPI('updateDatabaseItem', notion => {
      return notion.pages.update({ page_id: itemId, properties })
    })
  }

  /**
   * @operationName Get Block
   * @category Block Management
   * @description Retrieves detailed information about a specific content block including its type, content, formatting, and hierarchical relationships. Useful for accessing individual text paragraphs, headings, lists, or embedded content within pages.
   * @route GET /getBlock
   * @paramDef {"type":"String","label":"Block ID","name":"blockId","required":true,"description":"The ID of the block to retrieve."}
   * @returns {NotionBlock} Block object using the ID specified.
   * @sampleResult {"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"created_time":"2022-03-01T19:05:00.000Z","last_edited_time":"2022-03-01T19:05:00.000Z","type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"This is a paragraph block"}}],"color":"default"},"has_children":false,"archived":false}
   */
  async getBlock(blockId) {
    return this.#execNotionAPI('getBlock', notion => {
      return notion.blocks.retrieve({ block_id: blockId })
    })
  }

  /**
   * @operationName Get Block Children
   * @category Block Management
   * @description Retrieves all child blocks contained within a parent block, supporting pagination for large content structures. Essential for accessing nested content like bulleted lists, toggle blocks, or column layouts with their sub-elements.
   * @route GET /getBlockChildren
   * @paramDef {"type":"String","label":"Block ID","name":"blockId","required":true,"description":"The ID of the block to retrieve."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"description":"The number of items from the full list desired in the response. Maximum: 100"}
   * @returns {NotionBlockList} Paginated array of child block objects contained in the block.
   * @sampleResult {"object":"list","results":[{"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"block_id","block_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Child block content"}}],"color":"default"},"has_children":false,"archived":false}],"next_cursor":null,"has_more":false}
   */
  async getBlockChildren(blockId, pageSize) {
    return this.#execNotionAPI('getBlockChildren', notion => {
      return notion.blocks.children.list({ block_id: blockId, page_size: pageSize || undefined })
    })
  }

  /**
   * @operationName Append Block Children
   * @category Block Management
   * @description Adds new child blocks to an existing container block, perfect for extending lists, adding items to toggle blocks, or inserting content into column layouts. Maintains the hierarchical structure and formatting of nested content.
   * @route PUT /appendBlockChildren
   * @paramDef {"type":"String","label":"Block ID","name":"blockId","required":true,"description":"The ID of the block to update."}
   * @paramDef {"type":"Array.<Object>","label":"Children","name":"children","required":true,"description":"Child content to append to a container block as an array of block objects"}
   * @returns {NotionBlockList} Updated block children list.
   * @sampleResult {"object":"list","results":[{"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Child block content"}}],"color":"default"},"has_children":false,"archived":false}],"next_cursor":null,"has_more":false}
   */
  async appendBlockChildren(blockId, children) {
    return this.#execNotionAPI('appendBlockChildren', notion => {
      return notion.blocks.children.append({ block_id: blockId, children })
    })
  }

  /**
   * @operationName Update Block
   * @category Block Management
   * @description Modifies the content and properties of an existing block such as changing text content, updating formatting, or altering block-specific settings. Supports all block types with their respective editable properties.
   * @route PUT /updateBlock
   * @paramDef {"type":"String","label":"Block ID","name":"blockId","required":true,"description":"The ID of the block to update."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The properties of the block to update."}
   * @returns {NotionBlock} Updated Block object.
   * @sampleResult {"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Updated block content"}}],"color":"default"},"has_children":false,"archived":false}
   */
  async updateBlock(blockId, properties) {
    return this.#execNotionAPI('updateBlock', notion => {
      return notion.blocks.update({ block_id: blockId, ...properties })
    })
  }

  /**
   * @operationName Delete Block
   * @category Block Management
   * @description Permanently removes a block and all its child content from a page. Use with caution as deleted blocks cannot be recovered through the API, though they may be restored through Notion's interface immediately after deletion.
   * @route DELETE /deleteBlock
   * @paramDef {"type":"String","label":"Block ID","name":"blockId","required":true,"description":"The ID of the block to delete."}
   * @returns {NotionBlock}
   * @sampleResult {"object":"block","id":"c02fc1d3-db8b-45c5-a222-27595b15aea7","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"type":"paragraph","paragraph":{"rich_text":[{"type":"text","text":{"content":"Deleted block"}}],"color":"default"},"has_children":false,"archived":true}
   */
  async deleteBlock(blockId) {
    return this.#execNotionAPI('deleteBlock', notion => {
      return notion.blocks.delete({ block_id: blockId })
    })
  }

  /**
   * @operationName Get User
   * @category User Management
   * @description Retrieves detailed information about a specific Notion user including name, avatar, and user type. Useful for displaying user information in workflows or for user-based filtering and assignments.
   * @route GET /getUser
   * @paramDef {"type":"String","label":"User ID","name":"userId","required":true,"description":"Identifier for a Notion user"}
   * @returns {NotionUser} User object from Notion API.
   * @sampleResult {"object":"user","id":"d40e767c-d7af-4b18-a86d-55c61f1e39a4","type":"person","person":{"email":"user@example.com"},"name":"John Doe","avatar_url":"https://s3-us-west-2.amazonaws.com/public.notion-static.com/2dcaa66.png"}
   */
  async getUser(userId) {
    return this.#execNotionAPI('getUser', notion => {
      return notion.users.retrieve({ user_id: userId })
    })
  }

  /**
   * @operationName Get Users List
   * @category User Management
   * @description Retrieves a paginated list of all users in the Notion workspace who have access to the pages your integration can see. Essential for user selection in assignments, mentions, or access control workflows.
   * @route GET /getUsersList
   * @returns {NotionUserList} Paginated list of Users for the workspace.
   * @sampleResult {"object":"list","results":[{"object":"user","id":"d40e767c-d7af-4b18-a86d-55c61f1e39a4","type":"person","person":{"email":"user@example.com"},"name":"John Doe","avatar_url":"https://s3-us-west-2.amazonaws.com/public.notion-static.com/2dcaa66.png"},{"object":"user","id":"e5f0f84e-409a-440f-983a-a5315961c6e4","type":"person","person":{"email":"jane@example.com"},"name":"Jane Smith","avatar_url":"https://s3-us-west-2.amazonaws.com/public.notion-static.com/avatar2.png"}],"next_cursor":null,"has_more":false}
   */
  async getUsersList() {
    return this.#execNotionAPI('getUsersList', notion => {
      return notion.users.list()
    })
  }

  /**
   * @operationName Create Comment
   * @category Comments
   * @description Adds a new comment to a page or continues an existing discussion thread. Comments support rich text formatting and are visible to all users with access to the page, making them ideal for collaboration and feedback workflows.
   * @route POST /createComment
   * @paramDef {"type":"String","label":"Page ID","name":"pageId","required":false,"description":"The ID of the page to attach the comment to."}
   * @paramDef {"type":"String","label":"Discussion ID","name":"discussionId","required":false,"description":"The ID of discussion thread to attach the comment to."}
   * @paramDef {"type":"String","label":"Text","name":"text","required":true,"description":"The content of the comment to be added."}
   * @returns {NotionComment} The response from the Notion API after creating the comment.
   * @sampleResult {"object":"comment","id":"79e1c6b5-04cb-43c5-94ca-25d145d24e4c","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"discussion_id":"abc123","created_time":"2022-03-01T19:05:00.000Z","rich_text":[{"type":"text","text":{"content":"This is a comment"}}],"created_by":{"object":"user","id":"d40e767c-d7af-4b18-a86d-55c61f1e39a4"}}
   */
  async createComment(pageId, discussionId, text) {
    if (!pageId && !discussionId) {
      throw new Error('Page Id or Discussion Id should be provided')
    }

    return this.#execNotionAPI('createComment', notion => {
      const body = { rich_text: [{ type: 'text', text: { content: text } }] }

      if (pageId) {
        body.parent = { page_id: pageId }
      }

      if (discussionId) {
        body.discussion_id = discussionId
      }

      return notion.comments.create(body)
    })
  }

  /**
   * @operationName Get Comments
   * @category Comments
   * @description Retrieves all unresolved comments from a specific page or block with pagination support. Only returns active comments that haven't been marked as resolved, enabling comment monitoring and response workflows.
   * @route GET /getComments
   * @paramDef {"type":"String","label":"Page Or Block ID","name":"pageOrBlockId","required":true,"description":"Identifier for a Notion block or page."}
   * @paramDef {"type":"Number","label":"Page Size","name":"pageSize","required":false,"description":"The number of items from the full list desired in the response. Maximum: 100"}
   * @returns {NotionCommentList} List of un-resolved Comment objects from a page or block.
   * @sampleResult {"object":"list","results":[{"object":"comment","id":"79e1c6b5-04cb-43c5-94ca-25d145d24e4c","parent":{"type":"page_id","page_id":"59833787-2cf9-4fdf-8782-e53db20768a5"},"discussion_id":"abc123","created_time":"2022-03-01T19:05:00.000Z","rich_text":[{"type":"text","text":{"content":"First comment"}}],"created_by":{"object":"user","id":"d40e767c-d7af-4b18-a86d-55c61f1e39a4"}}],"next_cursor":null,"has_more":false}
   */
  async getComments(pageOrBlockId, pageSize = undefined) {
    return this.#execNotionAPI('getComments', notion => {
      return notion.comments.list({ block_id: pageOrBlockId, page_size: pageSize })
    })
  }

  /**
   * @operationName Find Database Item
   * @category Search And Query
   * @description Searches database items using complex filter conditions and custom sorting options. Supports filtering by any property type including text, numbers, dates, and relations with operators like equals, contains, greater than, and more.
   * @route POST /findDatabaseItem
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the database to search within."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"The filter object to specify query conditions."}
   * @paramDef {"type":"Array.<Object>","label":"Sorts","name":"sorts","required":false,"description":"The sort order configuration for the query results."}
   * @returns {NotionDatabaseQueryResult} The results from the Notion API based on the specified filter and sort parameters.
   * @sampleResult {"object":"list","results":[{"object":"page","id":"251d2b5f-268c-4de2-afe9-c71ff92ca95c","created_time":"2023-03-01T19:05:00.000Z","parent":{"type":"database_id","database_id":"bc1211ca-e3f1-4939-ae34-5260b16f627c"},"properties":{"Name":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Task 1"}}]},"Status":{"id":"J@cS","type":"select","select":{"id":"1","name":"To Do","color":"red"}}}}],"next_cursor":null,"has_more":false}
   */
  async findDatabaseItem(databaseId, filter, sorts = []) {
    return this.#execNotionAPI('findDatabaseItem', notion => {
      return notion.databases.query({
        database_id: databaseId,
        filter,
        sorts,
      })
    })
  }

  /**
   * @operationName Find Page By Title
   * @category Search And Query
   * @description Searches for database items that match a specific title exactly. This is a convenient shortcut for finding items by their title property without constructing complex filter objects, ideal for quick lookups and validation.
   * @route POST /findPageByTitle
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the database to search within."}
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"The title of the page to find within the database."}
   * @returns {NotionDatabaseQueryResult} The database query result containing pages that match the specified title.
   * @sampleResult {"object":"list","results":[{"object":"page","id":"251d2b5f-268c-4de2-afe9-c71ff92ca95c","created_time":"2023-03-01T19:05:00.000Z","parent":{"type":"database_id","database_id":"bc1211ca-e3f1-4939-ae34-5260b16f627c"},"properties":{"title":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Matching Title"}}]}}}],"next_cursor":null,"has_more":false}
   */
  async findPageByTitle(databaseId, title) {
    return this.#execNotionAPI('findPageByTitle', notion => {
      return notion.databases.query({
        database_id: databaseId,
        filter: {
          property: 'title',
          title: { equals: title },
        },
      })
    })
  }

  /**
   * @operationName Find or Create Database Item
   * @category Search And Query
   * @description Searches for an existing database item by filter criteria and creates a new one if not found. Useful for maintaining unique records and preventing duplicates while ensuring data consistency in automated workflows.
   * @route POST /findOrCreateDatabaseItem
   * @paramDef {"type":"String","label":"Database ID","name":"databaseId","required":true,"description":"The ID of the database to search or add a new item."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","required":true,"description":"The filter criteria to search for the database item."}
   * @paramDef {"type":"Object","label":"Properties","name":"properties","required":true,"description":"The properties for the new database item if it needs to be created."}
   * @returns {NotionDatabaseQueryResult|NotionPage} The found database query result or newly created database item.
   * @sampleResult {"object":"page","id":"251d2b5f-268c-4de2-afe9-c71ff92ca95c","created_time":"2023-03-01T19:05:00.000Z","last_edited_time":"2023-03-01T20:00:00.000Z","parent":{"type":"database_id","database_id":"bc1211ca-e3f1-4939-ae34-5260b16f627c"},"properties":{"Name":{"id":"title","type":"title","title":[{"type":"text","text":{"content":"Found or Created Item"}}]},"Status":{"id":"J@cS","type":"select","select":{"id":"1","name":"To Do","color":"red"}}},"url":"https://www.notion.so/Found-or-Created-Item-251d2b5f268c4de2afe9c71ff92ca95c"}
   */
  async findOrCreateDatabaseItem(databaseId, filter, properties) {
    const existingItem = await this.findDatabaseItem(databaseId, filter)

    if (existingItem.results.length) {
      return existingItem
    }

    return this.createDatabaseItem(databaseId, properties)
  }
}

Flowrunner.ServerCode.addService(Notion, [
  {
    order: 0,
    displayName: 'Client ID',
    name: 'clientId',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 client ID from your Notion integration settings. Create at https://developers.notion.com/my-integrations and copy the Client ID value.',
  },
  {
    order: 1,
    displayName: 'Client Secret',
    name: 'clientSecret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true,
    hint: 'OAuth2 client secret from your Notion integration settings. Copy the Client Secret value from the same integration page.',
  },
])
