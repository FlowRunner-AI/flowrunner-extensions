const logger = {
  info: (...args) => console.log('[Wix] info:', ...args),
  debug: (...args) => console.log('[Wix] debug:', ...args),
  error: (...args) => console.log('[Wix] error:', ...args),
  warn: (...args) => console.log('[Wix] warn:', ...args),
}

const API_BASE_URL = 'https://www.wixapis.com'

const DEFAULT_DICTIONARY_PAGE_SIZE = 50

const SORT_ORDER_MAP = {
  'Ascending': 'ASC',
  'Descending': 'DESC',
}

const V1_SORT_ORDER_MAP = {
  'Ascending': 'asc',
  'Descending': 'desc',
}

const PRODUCT_TYPE_MAP = {
  'Physical': 'physical',
  'Digital': 'digital',
}

const FULFILLMENT_STATUS_MAP = {
  'Pending': 'Pending',
  'Accepted': 'Accepted',
  'Ready': 'Ready',
  'In Delivery': 'In_Delivery',
  'Fulfilled': 'Fulfilled',
}

const BLOG_SORT_MAP = {
  'Newest First': 'PUBLISHED_DATE_DESC',
  'Oldest First': 'PUBLISHED_DATE_ASC',
  'Title A-Z': 'TITLE_ASC',
  'Title Z-A': 'TITLE_DESC',
  'Most Viewed': 'VIEW_COUNT',
  'Most Liked': 'LIKE_COUNT',
}

const MEMBER_FIELDSET_MAP = {
  'Public': 'PUBLIC',
  'Extended': 'EXTENDED',
  'Full': 'FULL',
}

const COUPON_TYPE_MAP = {
  'Fixed Amount Off': 'moneyOffAmount',
  'Percent Off': 'percentOffRate',
  'Free Shipping': 'freeShipping',
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

/**
 * @integrationName Wix
 * @integrationIcon /icon.png
 */
class WixService {
  constructor(config) {
    this.apiKey = config.apiKey
    this.accountId = config.accountId
    this.siteId = config.siteId
  }

  async #apiRequest({ url, method = 'get', body, query, logTag }) {
    try {
      const cleanedQuery = clean(query)

      logger.debug(`${ logTag } - API request: [${ method.toUpperCase() }::${ url }]`)

      const request = Flowrunner.Request[method.toLowerCase()](url)
        .set({
          'Authorization': this.apiKey,
          'wix-account-id': this.accountId,
          'wix-site-id': this.siteId,
          'Content-Type': 'application/json',
        })
        .query(cleanedQuery || {})

      return body !== undefined ? await request.send(body) : await request
    } catch (error) {
      const message = error.body?.message || error.body?.details?.applicationError?.description ||
        (typeof error.message === 'string' ? error.message : JSON.stringify(error.message))

      logger.error(`${ logTag } - Request failed: ${ message }`)

      throw new Error(`Wix API error: ${ message }`)
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null) {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildQuerySection({ filter, sortField, sortOrder, limit, offset }) {
    const query = {}

    if (filter) {
      query.filter = filter
    }

    if (sortField) {
      query.sort = [{ fieldName: sortField, order: this.#resolveChoice(sortOrder, SORT_ORDER_MAP) || 'ASC' }]
    }

    const paging = clean({ limit, offset })

    if (paging && Object.keys(paging).length) {
      query.paging = paging
    }

    return query
  }

  #textToRichContent(text) {
    const paragraphs = String(text).split(/\n{2,}/).map(part => part.trim()).filter(Boolean)

    return {
      nodes: paragraphs.map((paragraph, index) => ({
        type: 'PARAGRAPH',
        id: `p${ index + 1 }`,
        nodes: [
          {
            type: 'TEXT',
            id: '',
            nodes: [],
            textData: { text: paragraph, decorations: [] },
          },
        ],
        paragraphData: {},
      })),
    }
  }

  // ---------------------------------------------------------------------------
  // Contacts (CRM)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Query Contacts
   * @category Contacts
   * @description Queries CRM contacts on the connected Wix site using the Contacts v4 query language. Supports a raw filter object (e.g. {"info.name.last":{"$eq":"Lovelace"}} or {"primaryInfo.email":{"$contains":"@acme.com"}}), sorting by any contact field, and offset paging. Returns matching contacts with their revision, primary info, and full contact info, plus paging metadata.
   * @route POST /query-contacts
   *
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Wix query filter object, e.g. {\"info.name.last\":{\"$eq\":\"Lovelace\"}}. Supports operators like $eq, $ne, $gt, $contains, $startsWith, $hasSome. Leave empty to return all contacts."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Contact field to sort by, e.g. createdDate, updatedDate, info.name.last."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction applied to the sort field. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of contacts to return (Wix default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of contacts to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"contacts":[{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":3,"createdDate":"2026-01-10T12:00:00Z","updatedDate":"2026-02-01T09:30:00Z","primaryInfo":{"email":"ada@example.com"},"info":{"name":{"first":"Ada","last":"Lovelace"},"emails":{"items":[{"email":"ada@example.com","primary":true}]},"labelKeys":{"items":["custom.vip"]}}}],"pagingMetadata":{"count":1,"offset":0,"total":1}}
   */
  async queryContacts(filter, sortField, sortOrder, limit, offset) {
    const logTag = '[queryContacts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/query`,
      method: 'post',
      body: { query: this.#buildQuerySection({ filter, sortField, sortOrder, limit, offset }) },
    })
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single CRM contact by its ID, including the current revision (needed for updates), primary email and phone, name, labels, and extended fields.
   * @route GET /get-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID (GUID) of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":3,"createdDate":"2026-01-10T12:00:00Z","updatedDate":"2026-02-01T09:30:00Z","primaryInfo":{"email":"ada@example.com","phone":"+15551234567"},"info":{"name":{"first":"Ada","last":"Lovelace"},"emails":{"items":[{"email":"ada@example.com","primary":true}]},"phones":{"items":[{"phone":"+15551234567","primary":true}]},"labelKeys":{"items":["custom.vip"]}}}}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new CRM contact on the connected Wix site. Provide convenience fields (first/last name, email, phone, label keys) and optionally an Additional Info object for advanced contact info such as addresses, company, jobTitle, birthdate, or extendedFields. Returns the created contact with its ID and revision.
   * @route POST /create-contact
   *
   * @paramDef {"type":"String","label":"First Name","name":"firstName","description":"Contact's first name."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact's last name."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Contact's primary email address."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Contact's primary phone number in international format, e.g. +15551234567."}
   * @paramDef {"type":"Array<String>","label":"Label Keys","name":"labelKeys","description":"Label keys to assign to the contact, e.g. custom.vip. Use List Contact Labels to look up available keys."}
   * @paramDef {"type":"Object","label":"Additional Info","name":"additionalInfo","description":"Extra ContactInfo fields merged into the request, e.g. {\"company\":\"Acme\",\"jobTitle\":\"CTO\",\"extendedFields\":{\"items\":{\"custom.tier\":\"gold\"}}}. Convenience parameters above take precedence on conflict."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":1,"createdDate":"2026-02-01T09:30:00Z","primaryInfo":{"email":"ada@example.com"},"info":{"name":{"first":"Ada","last":"Lovelace"},"emails":{"items":[{"email":"ada@example.com","primary":true}]},"labelKeys":{"items":["custom.vip"]}}}}
   */
  async createContact(firstName, lastName, email, phone, labelKeys, additionalInfo) {
    const logTag = '[createContact]'
    const info = { ...(additionalInfo || {}) }

    if (firstName || lastName) {
      info.name = clean({ ...(info.name || {}), first: firstName, last: lastName })
    }

    if (email) {
      info.emails = { items: [{ email, primary: true }] }
    }

    if (phone) {
      info.phones = { items: [{ phone, primary: true }] }
    }

    if (labelKeys && labelKeys.length) {
      info.labelKeys = { items: labelKeys }
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts`,
      method: 'post',
      body: { info },
    })
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates fields of an existing CRM contact. Wix requires the contact's current revision for optimistic locking; if you omit it, the service fetches the contact first and uses its latest revision automatically. Only the fields present in the Info object are overwritten. Returns the updated contact.
   * @route PATCH /update-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID (GUID) of the contact to update."}
   * @paramDef {"type":"Object","label":"Info","name":"info","required":true,"description":"ContactInfo fields to set, e.g. {\"name\":{\"first\":\"Ada\"},\"emails\":{\"items\":[{\"email\":\"ada@acme.com\",\"primary\":true}]},\"company\":\"Acme\"}. Fields not included remain unchanged."}
   * @paramDef {"type":"Number","label":"Revision","name":"revision","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Current revision of the contact. Leave empty to fetch and use the latest revision automatically."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":4,"updatedDate":"2026-02-02T10:00:00Z","info":{"name":{"first":"Ada","last":"Lovelace"},"company":"Acme"}}}
   */
  async updateContact(contactId, info, revision) {
    const logTag = '[updateContact]'
    let currentRevision = revision

    if (currentRevision === undefined || currentRevision === null) {
      const existing = await this.#apiRequest({
        logTag,
        url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }`,
        method: 'get',
      })

      currentRevision = existing.contact?.revision
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }`,
      method: 'patch',
      body: { revision: currentRevision, info },
    })
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a CRM contact by ID. Contacts that are also site members or contributors cannot be deleted this way. Returns a confirmation object.
   * @route DELETE /delete-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID (GUID) of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"contactId":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1"}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }`,
      method: 'delete',
    })

    return { deleted: true, contactId }
  }

  /**
   * @operationName List Contact Labels
   * @category Contacts
   * @description Lists the contact labels defined on the connected Wix site, including system labels and custom labels. Each label has a key (used when labeling contacts), a display name, and a label type. Supports offset paging.
   * @route GET /list-contact-labels
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of labels to return (Wix default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of labels to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"labels":[{"key":"custom.vip","displayName":"VIP","labelType":"USER_DEFINED","createdDate":"2026-01-05T08:00:00Z"},{"key":"contacts.contacted-me","displayName":"Contacted Me","labelType":"SYSTEM"}],"pagingMetadata":{"count":2,"offset":0}}
   */
  async listContactLabels(limit, offset) {
    const logTag = '[listContactLabels]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/labels`,
      method: 'get',
      query: {
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })
  }

  /**
   * @operationName Label Contact
   * @category Contacts
   * @description Adds one or more labels to a CRM contact. Label keys must already exist on the site (use List Contact Labels or the labels dictionary to find keys). Returns the updated contact with its full label list.
   * @route POST /label-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID (GUID) of the contact to label."}
   * @paramDef {"type":"Array<String>","label":"Label Keys","name":"labelKeys","required":true,"description":"Label keys to add to the contact, e.g. custom.vip."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":5,"info":{"labelKeys":{"items":["custom.vip","contacts.customers"]}}}}
   */
  async labelContact(contactId, labelKeys) {
    const logTag = '[labelContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }/labels`,
      method: 'post',
      body: { labelKeys },
    })
  }

  /**
   * @operationName Unlabel Contact
   * @category Contacts
   * @description Removes one or more labels from a CRM contact. The labels themselves are not deleted from the site, only detached from this contact. Returns the updated contact with its remaining labels.
   * @route DELETE /unlabel-contact
   *
   * @paramDef {"type":"String","label":"Contact ID","name":"contactId","required":true,"description":"ID (GUID) of the contact to remove labels from."}
   * @paramDef {"type":"Array<String>","label":"Label Keys","name":"labelKeys","required":true,"description":"Label keys to remove from the contact, e.g. custom.vip."}
   *
   * @returns {Object}
   * @sampleResult {"contact":{"id":"5cb26af1-6d92-4b25-b0ea-9a4a1bfb26f1","revision":6,"info":{"labelKeys":{"items":["contacts.customers"]}}}}
   */
  async unlabelContact(contactId, labelKeys) {
    const logTag = '[unlabelContact]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/contacts/${ contactId }/labels`,
      method: 'delete',
      body: { labelKeys },
    })
  }

  // ---------------------------------------------------------------------------
  // Wix Data (CMS)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Query Data Items
   * @category CMS Data
   * @description Queries items in a Wix CMS data collection using the Wix Data v2 query language. Supports a raw filter object over item data fields (e.g. {"data.status":{"$eq":"active"}} or field names directly like {"title":{"$contains":"launch"}}), sorting, offset paging, and an optional total count. Returns matching data items and paging metadata.
   * @route POST /query-data-items
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection to query, e.g. Stores/Products or a custom collection ID."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Wix Data filter object over item fields, e.g. {\"status\":{\"$eq\":\"active\"}}. Supports $eq, $ne, $gt, $lt, $contains, $startsWith, $hasSome, $isEmpty and more. Leave empty to return all items."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Item field to sort by, e.g. title or _createdDate."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction applied to the sort field. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of items to return (Wix default 50, max 1000)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of items to skip for offset-based paging."}
   * @paramDef {"type":"Boolean","label":"Return Total Count","name":"returnTotalCount","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the response includes the total number of items matching the query."}
   *
   * @returns {Object}
   * @sampleResult {"dataItems":[{"id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","dataCollectionId":"MyCollection","data":{"_id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","title":"Launch Plan","status":"active","_createdDate":"2026-01-15T10:00:00Z"}}],"pagingMetadata":{"count":1,"offset":0,"total":12}}
   */
  async queryDataItems(dataCollectionId, filter, sortField, sortOrder, limit, offset, returnTotalCount) {
    const logTag = '[queryDataItems]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items/query`,
      method: 'post',
      body: clean({
        dataCollectionId,
        query: this.#buildQuerySection({ filter, sortField, sortOrder, limit, offset }),
        returnTotalCount,
      }),
    })
  }

  /**
   * @operationName Get Data Item
   * @category CMS Data
   * @description Retrieves a single item from a Wix CMS data collection by its item ID. Returns the data item including its full data payload and system fields (_id, _createdDate, _updatedDate).
   * @route GET /get-data-item
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection containing the item."}
   * @paramDef {"type":"String","label":"Data Item ID","name":"dataItemId","required":true,"description":"ID of the data item to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"dataItem":{"id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","dataCollectionId":"MyCollection","data":{"_id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","title":"Launch Plan","status":"active","_createdDate":"2026-01-15T10:00:00Z","_updatedDate":"2026-02-01T09:00:00Z"}}}
   */
  async getDataItem(dataCollectionId, dataItemId) {
    const logTag = '[getDataItem]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items/${ dataItemId }`,
      method: 'get',
      query: { dataCollectionId },
    })
  }

  /**
   * @operationName Insert Data Item
   * @category CMS Data
   * @description Inserts a new item into a Wix CMS data collection. Provide the item's fields as a data object; Wix generates the item ID unless you include an _id field. Returns the created data item.
   * @route POST /insert-data-item
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection to insert into."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Item fields to store, e.g. {\"title\":\"Launch Plan\",\"status\":\"active\"}. Include an _id field to set a custom item ID."}
   *
   * @returns {Object}
   * @sampleResult {"dataItem":{"id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","dataCollectionId":"MyCollection","data":{"_id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","title":"Launch Plan","status":"active","_createdDate":"2026-02-01T09:00:00Z"}}}
   */
  async insertDataItem(dataCollectionId, data) {
    const logTag = '[insertDataItem]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items`,
      method: 'post',
      body: { dataCollectionId, dataItem: { data } },
    })
  }

  /**
   * @operationName Update Data Item
   * @category CMS Data
   * @description Fully replaces an existing item in a Wix CMS data collection. The provided data object replaces the item's previous data entirely, so include every field you want to keep. Returns the updated data item.
   * @route PUT /update-data-item
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection containing the item."}
   * @paramDef {"type":"String","label":"Data Item ID","name":"dataItemId","required":true,"description":"ID of the data item to update."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Full replacement item data, e.g. {\"title\":\"Launch Plan v2\",\"status\":\"done\"}. Fields not included are removed from the item."}
   *
   * @returns {Object}
   * @sampleResult {"dataItem":{"id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","dataCollectionId":"MyCollection","data":{"_id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","title":"Launch Plan v2","status":"done","_updatedDate":"2026-02-02T10:00:00Z"}}}
   */
  async updateDataItem(dataCollectionId, dataItemId, data) {
    const logTag = '[updateDataItem]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items/${ dataItemId }`,
      method: 'put',
      body: { dataCollectionId, dataItem: { data: { ...data, _id: dataItemId } } },
    })
  }

  /**
   * @operationName Save Data Item
   * @category CMS Data
   * @description Upserts an item in a Wix CMS data collection: creates the item when the _id in the data object does not exist (or is omitted) and replaces it when it does. Ideal for rerunnable imports and sync jobs. Note that on update the provided data fully replaces the existing item. Returns the saved data item.
   * @route POST /save-data-item
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection to save into."}
   * @paramDef {"type":"Object","label":"Data","name":"data","required":true,"description":"Item data to save, e.g. {\"_id\":\"external-42\",\"title\":\"Launch Plan\"}. Include _id to upsert a specific item; omit it to always create a new item."}
   *
   * @returns {Object}
   * @sampleResult {"dataItem":{"id":"external-42","dataCollectionId":"MyCollection","data":{"_id":"external-42","title":"Launch Plan","_updatedDate":"2026-02-02T10:00:00Z"}}}
   */
  async saveDataItem(dataCollectionId, data) {
    const logTag = '[saveDataItem]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items/save`,
      method: 'post',
      body: { dataCollectionId, dataItem: { data } },
    })
  }

  /**
   * @operationName Remove Data Item
   * @category CMS Data
   * @description Permanently removes an item from a Wix CMS data collection by its item ID. Returns the removed data item as it existed before deletion.
   * @route DELETE /remove-data-item
   *
   * @paramDef {"type":"String","label":"Collection","name":"dataCollectionId","required":true,"dictionary":"getDataCollectionsDictionary","description":"ID of the CMS data collection containing the item."}
   * @paramDef {"type":"String","label":"Data Item ID","name":"dataItemId","required":true,"description":"ID of the data item to remove."}
   *
   * @returns {Object}
   * @sampleResult {"dataItem":{"id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","dataCollectionId":"MyCollection","data":{"_id":"3d1f9e2a-1c2b-4a5d-9f0e-8b7c6d5e4f3a","title":"Launch Plan"}}}
   */
  async removeDataItem(dataCollectionId, dataItemId) {
    const logTag = '[removeDataItem]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/items/${ dataItemId }`,
      method: 'delete',
      query: { dataCollectionId },
    })
  }

  /**
   * @operationName List Data Collections
   * @category CMS Data
   * @description Lists the CMS data collections available on the connected Wix site, including custom collections and app collections (e.g. Stores/Products). Returns each collection's ID, display name, field definitions, and capabilities, plus paging metadata.
   * @route GET /list-data-collections
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of collections to return (Wix default 50)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of collections to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"collections":[{"id":"MyCollection","displayName":"My Collection","collectionType":"NATIVE","fields":[{"key":"title","displayName":"Title","type":"TEXT"}],"createdDate":"2026-01-01T00:00:00Z"}],"pagingMetadata":{"count":1,"offset":0,"total":4}}
   */
  async listDataCollections(limit, offset) {
    const logTag = '[listDataCollections]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/collections`,
      method: 'get',
      query: {
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Stores - Products (Catalog v1)
  // ---------------------------------------------------------------------------

  /**
   * @operationName Query Products
   * @category Store Products
   * @description Queries products in the Wix Stores catalog (v1). Accepts a filter object which is automatically stringified as required by the Stores v1 API (e.g. {"name":{"$contains":"shirt"}}), a sort field with direction, offset paging, and an option to include full variant data. Returns matching products and result metadata.
   * @route POST /query-products
   *
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Product filter object, e.g. {\"name\":{\"$contains\":\"shirt\"}} or {\"price\":{\"$gte\":10}}. The Stores v1 API expects a stringified filter; this action stringifies it for you."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Product field to sort by, e.g. name, price, numericId, lastUpdated."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction applied to the sort field. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of products to return (Wix default 10, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of products to skip for offset-based paging."}
   * @paramDef {"type":"Boolean","label":"Include Variants","name":"includeVariants","uiComponent":{"type":"TOGGLE"},"description":"When enabled, each product includes its full list of variants."}
   *
   * @returns {Object}
   * @sampleResult {"products":[{"id":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f","name":"Classic T-Shirt","productType":"physical","sku":"TSHIRT-001","visible":true,"priceData":{"currency":"USD","price":25,"discountedPrice":25},"stock":{"trackInventory":true,"quantity":120,"inStock":true}}],"metadata":{"items":1,"offset":0,"totalResults":8}}
   */
  async queryProducts(filter, sortField, sortOrder, limit, offset, includeVariants) {
    const logTag = '[queryProducts]'
    const query = {}

    if (filter) {
      query.filter = typeof filter === 'string' ? filter : JSON.stringify(filter)
    }

    if (sortField) {
      query.sort = JSON.stringify([{ [sortField]: this.#resolveChoice(sortOrder, V1_SORT_ORDER_MAP) || 'asc' }])
    }

    const paging = clean({ limit, offset })

    if (paging && Object.keys(paging).length) {
      query.paging = paging
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores-reader/v1/products/query`,
      method: 'post',
      body: clean({ query, includeVariants }),
    })
  }

  /**
   * @operationName Get Product
   * @category Store Products
   * @description Retrieves a single Wix Stores product by its ID, including pricing, stock, media, product options, and additional info sections.
   * @route GET /get-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"ID (GUID) of the product to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f","name":"Classic T-Shirt","productType":"physical","description":"<p>100% cotton tee</p>","sku":"TSHIRT-001","visible":true,"priceData":{"currency":"USD","price":25},"stock":{"trackInventory":true,"quantity":120,"inStock":true},"productOptions":[{"name":"Size","choices":[{"value":"S","description":"S"},{"value":"M","description":"M"}]}]}}
   */
  async getProduct(productId) {
    const logTag = '[getProduct]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores-reader/v1/products/${ productId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Product
   * @category Store Products
   * @description Creates a new product in the Wix Stores catalog. Provide the name, type, and price, plus optional description, SKU, and visibility. Use Additional Fields for advanced product properties such as productOptions, manageVariants, discount, ribbon, or weight. Returns the created product.
   * @route POST /create-product
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Product name shown in the store."}
   * @paramDef {"type":"String","label":"Product Type","name":"productType","uiComponent":{"type":"DROPDOWN","options":{"values":["Physical","Digital"]}},"defaultValue":"Physical","description":"Whether the product is a physical good or a digital file. Defaults to Physical."}
   * @paramDef {"type":"Number","label":"Price","name":"price","required":true,"uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Product price in the store currency."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Product description. Basic HTML formatting is supported."}
   * @paramDef {"type":"String","label":"SKU","name":"sku","description":"Stock keeping unit identifier for the product."}
   * @paramDef {"type":"Boolean","label":"Visible","name":"visible","uiComponent":{"type":"TOGGLE"},"description":"Whether the product is visible to site visitors. Defaults to the Wix API default (visible)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Extra product fields merged into the request, e.g. {\"manageVariants\":true,\"productOptions\":[{\"name\":\"Size\",\"choices\":[{\"value\":\"S\",\"description\":\"S\"}]}],\"ribbon\":\"New\"}. Convenience parameters above take precedence on conflict."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f","name":"Classic T-Shirt","productType":"physical","sku":"TSHIRT-001","visible":true,"priceData":{"currency":"USD","price":25}}}
   */
  async createProduct(name, productType, price, description, sku, visible, additionalFields) {
    const logTag = '[createProduct]'

    const product = {
      ...(additionalFields || {}),
      name,
      productType: this.#resolveChoice(productType, PRODUCT_TYPE_MAP) || 'physical',
      priceData: { price },
    }

    if (description) {
      product.description = description
    }

    if (sku) {
      product.sku = sku
    }

    if (visible !== undefined && visible !== null) {
      product.visible = visible
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v1/products`,
      method: 'post',
      body: { product },
    })
  }

  /**
   * @operationName Update Product
   * @category Store Products
   * @description Updates fields of an existing Wix Stores product. Only the fields present in the Product object are changed, e.g. {"name":"New Name","priceData":{"price":29},"visible":false}. Returns the updated product.
   * @route PATCH /update-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"ID (GUID) of the product to update."}
   * @paramDef {"type":"Object","label":"Product","name":"product","required":true,"description":"Product fields to change, e.g. {\"name\":\"Premium T-Shirt\",\"priceData\":{\"price\":29},\"sku\":\"TSHIRT-002\"}. Fields not included remain unchanged."}
   *
   * @returns {Object}
   * @sampleResult {"product":{"id":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f","name":"Premium T-Shirt","priceData":{"currency":"USD","price":29},"sku":"TSHIRT-002"}}
   */
  async updateProduct(productId, product) {
    const logTag = '[updateProduct]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v1/products/${ productId }`,
      method: 'patch',
      body: { product },
    })
  }

  /**
   * @operationName Delete Product
   * @category Store Products
   * @description Permanently deletes a product from the Wix Stores catalog by its ID. Returns a confirmation object.
   * @route DELETE /delete-product
   *
   * @paramDef {"type":"String","label":"Product","name":"productId","required":true,"dictionary":"getProductsDictionary","description":"ID (GUID) of the product to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"productId":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f"}
   */
  async deleteProduct(productId) {
    const logTag = '[deleteProduct]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v1/products/${ productId }`,
      method: 'delete',
    })

    return { deleted: true, productId }
  }

  // ---------------------------------------------------------------------------
  // eCommerce - Orders
  // ---------------------------------------------------------------------------

  /**
   * @operationName Search Orders
   * @category Orders
   * @description Searches eCommerce orders on the connected Wix site (covers Stores, Bookings, and other Wix sales channels). Accepts a raw filter object (e.g. {"status":{"$eq":"APPROVED"}} or {"paymentStatus":{"$eq":"PAID"}}), sorting (e.g. by createdDate), and cursor paging. Returns matching orders and a cursor for the next page.
   * @route POST /search-orders
   *
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Order filter object, e.g. {\"status\":{\"$eq\":\"APPROVED\"},\"paymentStatus\":{\"$eq\":\"PAID\"}}. Common fields: status, paymentStatus, fulfillmentStatus, createdDate, buyerInfo.email."}
   * @paramDef {"type":"String","label":"Sort Field","name":"sortField","description":"Order field to sort by, e.g. createdDate, updatedDate, number."}
   * @paramDef {"type":"String","label":"Sort Order","name":"sortOrder","uiComponent":{"type":"DROPDOWN","options":{"values":["Ascending","Descending"]}},"description":"Sort direction applied to the sort field. Defaults to Ascending."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of orders per page (Wix default 50, max 100)."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Cursor from a previous response (metadata.cursors.next) to fetch the next page."}
   *
   * @returns {Object}
   * @sampleResult {"orders":[{"id":"a27f9d1b-3c4e-4f6a-8b9c-0d1e2f3a4b5c","number":"10021","status":"APPROVED","paymentStatus":"PAID","fulfillmentStatus":"NOT_FULFILLED","createdDate":"2026-02-01T14:00:00Z","buyerInfo":{"email":"ada@example.com"},"priceSummary":{"total":{"amount":"54.00","formattedAmount":"$54.00"}}}],"metadata":{"count":1,"hasNext":true,"cursors":{"next":"eyJvZmZzZXQiOjV9"}}}
   */
  async searchOrders(filter, sortField, sortOrder, limit, cursor) {
    const logTag = '[searchOrders]'
    const search = {}

    if (filter) {
      search.filter = filter
    }

    if (sortField) {
      search.sort = [{ fieldName: sortField, order: this.#resolveChoice(sortOrder, SORT_ORDER_MAP) || 'ASC' }]
    }

    const cursorPaging = clean({ limit, cursor })

    if (cursorPaging && Object.keys(cursorPaging).length) {
      search.cursorPaging = cursorPaging
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/ecom/v1/orders/search`,
      method: 'post',
      body: { search },
    })
  }

  /**
   * @operationName Get Order
   * @category Orders
   * @description Retrieves a single eCommerce order by its ID, including line items, buyer info, price summary, payment and fulfillment statuses, and shipping details.
   * @route GET /get-order
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"ID (GUID) of the order to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"order":{"id":"a27f9d1b-3c4e-4f6a-8b9c-0d1e2f3a4b5c","number":"10021","status":"APPROVED","paymentStatus":"PAID","fulfillmentStatus":"NOT_FULFILLED","createdDate":"2026-02-01T14:00:00Z","buyerInfo":{"email":"ada@example.com"},"lineItems":[{"id":"00000000-0000-0000-0000-000000000001","productName":{"original":"Classic T-Shirt"},"quantity":2,"price":{"amount":"25.00"}}],"priceSummary":{"total":{"amount":"54.00","formattedAmount":"$54.00"}}}}
   */
  async getOrder(orderId) {
    const logTag = '[getOrder]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/ecom/v1/orders/${ orderId }`,
      method: 'get',
    })
  }

  /**
   * @typedef {Object} FulfillmentLineItem
   * @paramDef {"type":"String","label":"Line Item ID","name":"id","required":true,"description":"ID of the order line item to fulfill (from the order's lineItems array)."}
   * @paramDef {"type":"Number","label":"Quantity","name":"quantity","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Quantity of this line item to fulfill. Defaults to the remaining unfulfilled quantity."}
   */

  /**
   * @operationName Create Order Fulfillment
   * @category Orders
   * @description Creates a fulfillment for an eCommerce order, optionally with tracking information. The order must be in an approved state, and each line item can only belong to one fulfillment. Tracking links are auto-generated for known carriers (fedex, ups, usps, dhl, canadaPost); for custom carriers provide the tracking link explicitly. Returns the fulfillment ID and the order with its fulfillments.
   * @route POST /create-order-fulfillment
   *
   * @paramDef {"type":"String","label":"Order ID","name":"orderId","required":true,"description":"ID (GUID) of the approved order to fulfill."}
   * @paramDef {"type":"Array<FulfillmentLineItem>","label":"Line Items","name":"lineItems","required":true,"description":"Order line items to include in this fulfillment, each with the line item ID and an optional quantity."}
   * @paramDef {"type":"String","label":"Tracking Number","name":"trackingNumber","description":"Shipment tracking number."}
   * @paramDef {"type":"String","label":"Shipping Provider","name":"shippingProvider","description":"Carrier name. Use fedex, ups, usps, dhl, or canadaPost for automatic tracking links, or any custom carrier name."}
   * @paramDef {"type":"String","label":"Tracking Link","name":"trackingLink","description":"Tracking URL. Required for custom carriers; auto-populated for known carriers."}
   * @paramDef {"type":"String","label":"Status","name":"status","uiComponent":{"type":"DROPDOWN","options":{"values":["Pending","Accepted","Ready","In Delivery","Fulfilled"]}},"description":"Fulfillment status. Defaults to Fulfilled when omitted."}
   *
   * @returns {Object}
   * @sampleResult {"fulfillmentId":"7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b","orderWithFulfillments":{"orderId":"a27f9d1b-3c4e-4f6a-8b9c-0d1e2f3a4b5c","fulfillments":[{"id":"7e8f9a0b-1c2d-3e4f-5a6b-7c8d9e0f1a2b","createdDate":"2026-02-03T11:00:00Z","lineItems":[{"id":"00000000-0000-0000-0000-000000000001","quantity":2}],"trackingInfo":{"trackingNumber":"1Z999AA10123456784","shippingProvider":"ups","trackingLink":"https://www.ups.com/track?tracknum=1Z999AA10123456784"}}]}}
   */
  async createOrderFulfillment(orderId, lineItems, trackingNumber, shippingProvider, trackingLink, status) {
    const logTag = '[createOrderFulfillment]'
    const fulfillment = { lineItems }

    const trackingInfo = clean({ trackingNumber, shippingProvider, trackingLink })

    if (trackingInfo && Object.keys(trackingInfo).length) {
      fulfillment.trackingInfo = trackingInfo
    }

    if (status) {
      fulfillment.status = this.#resolveChoice(status, FULFILLMENT_STATUS_MAP)
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/ecom/v1/fulfillments/orders/${ orderId }/create-fulfillment`,
      method: 'post',
      body: { fulfillment },
    })
  }

  // ---------------------------------------------------------------------------
  // Blog
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Blog Posts
   * @category Blog
   * @description Lists published blog posts on the connected Wix site with offset paging and sorting. Optionally restricts results to featured posts. Returns post summaries including title, excerpt, slug, first published date, and category/tag IDs.
   * @route GET /list-blog-posts
   *
   * @paramDef {"type":"Boolean","label":"Featured Only","name":"featured","uiComponent":{"type":"TOGGLE"},"description":"When enabled, only featured posts are returned."}
   * @paramDef {"type":"String","label":"Sort","name":"sort","uiComponent":{"type":"DROPDOWN","options":{"values":["Newest First","Oldest First","Title A-Z","Title Z-A","Most Viewed","Most Liked"]}},"description":"Sort order for the returned posts. Defaults to Newest First."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of posts to return (Wix default 50, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of posts to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"posts":[{"id":"c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f","title":"Product Launch Recap","excerpt":"Highlights from our launch week...","slug":"product-launch-recap","featured":false,"firstPublishedDate":"2026-01-20T09:00:00Z","categoryIds":["b9e0f1a2-3b4c-5d6e-7f8a-9b0c1d2e3f4a"],"minutesToRead":4}],"metaData":{"count":1,"offset":0,"total":17}}
   */
  async listBlogPosts(featured, sort, limit, offset) {
    const logTag = '[listBlogPosts]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/blog/v3/posts`,
      method: 'get',
      query: {
        featured: featured === true ? true : undefined,
        sort: this.#resolveChoice(sort, BLOG_SORT_MAP),
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })
  }

  /**
   * @operationName Get Blog Post
   * @category Blog
   * @description Retrieves a single published blog post by its ID, including title, excerpt, slug, hero image, category and tag IDs, and publication dates.
   * @route GET /get-blog-post
   *
   * @paramDef {"type":"String","label":"Post ID","name":"postId","required":true,"description":"ID (GUID) of the published blog post to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"post":{"id":"c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f","title":"Product Launch Recap","excerpt":"Highlights from our launch week...","slug":"product-launch-recap","featured":false,"firstPublishedDate":"2026-01-20T09:00:00Z","lastPublishedDate":"2026-01-21T10:00:00Z","categoryIds":["b9e0f1a2-3b4c-5d6e-7f8a-9b0c1d2e3f4a"],"hashtags":["launch"],"minutesToRead":4}}
   */
  async getBlogPost(postId) {
    const logTag = '[getBlogPost]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/blog/v3/posts/${ postId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Create Draft Blog Post
   * @category Blog
   * @description Creates a draft blog post on the connected Wix site, optionally publishing it immediately. Provide plain text content (automatically converted to Wix rich content paragraphs, split on blank lines) or a full Ricos rich content object for advanced formatting. When calling with an API key, Member ID identifies the post author. Returns the created draft post.
   * @route POST /create-draft-blog-post
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Post title (up to 200 characters)."}
   * @paramDef {"type":"String","label":"Content Text","name":"contentText","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Plain text post content. Blank lines separate paragraphs. Ignored when Rich Content is provided."}
   * @paramDef {"type":"Object","label":"Rich Content","name":"richContent","description":"Full Ricos rich content document, e.g. {\"nodes\":[{\"type\":\"PARAGRAPH\",...}]}. Takes precedence over Content Text."}
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","description":"ID of the site member to set as the post author. Required by Wix for API-key (3rd-party) calls; use List Members to find IDs."}
   * @paramDef {"type":"String","label":"Excerpt","name":"excerpt","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Short post summary (up to 500 characters)."}
   * @paramDef {"type":"Array<String>","label":"Category IDs","name":"categoryIds","description":"IDs of blog categories to assign (up to 10). Use List Blog Categories to find IDs."}
   * @paramDef {"type":"Array<String>","label":"Hashtags","name":"hashtags","description":"Hashtags to attach to the post (up to 100)."}
   * @paramDef {"type":"Boolean","label":"Publish Immediately","name":"publish","uiComponent":{"type":"TOGGLE"},"description":"When enabled, the draft is published as soon as it is created. Defaults to false (saved as draft)."}
   *
   * @returns {Object}
   * @sampleResult {"draftPost":{"id":"d4e5f6a7-8b9c-0d1e-2f3a-4b5c6d7e8f9a","title":"Product Launch Recap","status":"PUBLISHED","memberId":"f0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c","excerpt":"Highlights from our launch week...","hashtags":["launch"],"minutesToRead":4}}
   */
  async createDraftBlogPost(title, contentText, richContent, memberId, excerpt, categoryIds, hashtags, publish) {
    const logTag = '[createDraftBlogPost]'
    const draftPost = { title }

    if (richContent) {
      draftPost.richContent = richContent
    } else if (contentText) {
      draftPost.richContent = this.#textToRichContent(contentText)
    }

    if (memberId) {
      draftPost.memberId = memberId
    }

    if (excerpt) {
      draftPost.excerpt = excerpt
    }

    if (categoryIds && categoryIds.length) {
      draftPost.categoryIds = categoryIds
    }

    if (hashtags && hashtags.length) {
      draftPost.hashtags = hashtags
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/blog/v3/draft-posts`,
      method: 'post',
      query: publish === true ? { publish: true } : undefined,
      body: { draftPost },
    })
  }

  /**
   * @operationName List Blog Categories
   * @category Blog
   * @description Lists the blog categories on the connected Wix site with offset paging. Returns each category's ID, label, slug, description, and post count. Use category IDs when creating draft posts or filtering posts.
   * @route GET /list-blog-categories
   *
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of categories to return (Wix default 50, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of categories to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"categories":[{"id":"b9e0f1a2-3b4c-5d6e-7f8a-9b0c1d2e3f4a","label":"Announcements","slug":"announcements","description":"Company news and updates","postCount":9}],"metaData":{"count":1,"offset":0,"total":3}}
   */
  async listBlogCategories(limit, offset) {
    const logTag = '[listBlogCategories]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/blog/v3/categories`,
      method: 'get',
      query: {
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------

  /**
   * @operationName Query Coupons
   * @category Coupons
   * @description Queries coupons on the connected Wix site. Accepts a filter object which is automatically stringified as required by the Coupons v2 API (e.g. {"specification.code":"SUMMER20"}), plus offset paging. Returns matching coupons with their specifications and usage data.
   * @route POST /query-coupons
   *
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Coupon filter object, e.g. {\"specification.code\":\"SUMMER20\"} or {\"specification.active\":true}. The Coupons v2 API expects a stringified filter; this action stringifies it for you."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of coupons to return (Wix default 50, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of coupons to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"coupons":[{"id":"e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b","specification":{"name":"Summer Sale","code":"SUMMER20","active":true,"percentOffRate":20,"startTime":"2026-06-01T00:00:00Z","expirationTime":"2026-08-31T23:59:59Z","scope":{"namespace":"stores"}},"dateCreated":"2026-05-20T12:00:00Z","numberOfUsages":14}],"totalResults":1}
   */
  async queryCoupons(filter, limit, offset) {
    const logTag = '[queryCoupons]'
    const query = {}

    if (filter) {
      query.filter = typeof filter === 'string' ? filter : JSON.stringify(filter)
    }

    const paging = clean({ limit, offset })

    if (paging && Object.keys(paging).length) {
      query.paging = paging
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v2/coupons/query`,
      method: 'post',
      body: { query },
    })
  }

  /**
   * @operationName Create Coupon
   * @category Coupons
   * @description Creates a coupon on the connected Wix site. Choose the discount type (fixed amount off, percent off, or free shipping) and provide the coupon code customers will enter at checkout. The coupon applies storewide by default; pass a Scope object to limit it to specific products or collections. Returns the new coupon's ID.
   * @route POST /create-coupon
   *
   * @paramDef {"type":"String","label":"Name","name":"name","required":true,"description":"Internal coupon name shown in the Wix dashboard."}
   * @paramDef {"type":"String","label":"Code","name":"code","required":true,"description":"Code customers enter at checkout, e.g. SUMMER20 (up to 20 characters, unique per site)."}
   * @paramDef {"type":"String","label":"Discount Type","name":"discountType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Fixed Amount Off","Percent Off","Free Shipping"]}},"description":"Type of discount the coupon grants."}
   * @paramDef {"type":"Number","label":"Amount","name":"amount","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Discount value: currency amount for Fixed Amount Off, or percentage (e.g. 20 for 20%) for Percent Off. Ignored for Free Shipping."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 time the coupon becomes valid. Defaults to now."}
   * @paramDef {"type":"String","label":"Expiration Time","name":"expirationTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"ISO 8601 time the coupon expires. Leave empty for no expiration."}
   * @paramDef {"type":"Number","label":"Usage Limit","name":"usageLimit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum total number of times the coupon can be used. Leave empty for unlimited."}
   * @paramDef {"type":"Object","label":"Scope","name":"scope","description":"Coupon scope object, e.g. {\"namespace\":\"stores\",\"group\":{\"name\":\"product\",\"entityId\":\"<productId>\"}}. Defaults to {\"namespace\":\"stores\"} (entire store)."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b"}
   */
  async createCoupon(name, code, discountType, amount, startTime, expirationTime, usageLimit, scope) {
    const logTag = '[createCoupon]'

    const specification = {
      name,
      code,
      active: true,
      startTime: startTime || new Date().toISOString(),
      scope: scope || { namespace: 'stores' },
    }

    const discountField = this.#resolveChoice(discountType, COUPON_TYPE_MAP)

    if (discountField === 'freeShipping') {
      specification.freeShipping = true
    } else if (discountField) {
      specification[discountField] = amount
    }

    if (expirationTime) {
      specification.expirationTime = expirationTime
    }

    if (usageLimit !== undefined && usageLimit !== null) {
      specification.usageLimit = usageLimit
    }

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v2/coupons`,
      method: 'post',
      body: { specification },
    })
  }

  /**
   * @operationName Get Coupon
   * @category Coupons
   * @description Retrieves a single coupon by its ID, including its specification (name, code, discount, validity window, scope) and usage statistics.
   * @route GET /get-coupon
   *
   * @paramDef {"type":"String","label":"Coupon ID","name":"couponId","required":true,"description":"ID (GUID) of the coupon to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b","specification":{"name":"Summer Sale","code":"SUMMER20","active":true,"percentOffRate":20,"startTime":"2026-06-01T00:00:00Z","scope":{"namespace":"stores"}},"dateCreated":"2026-05-20T12:00:00Z","numberOfUsages":14}
   */
  async getCoupon(couponId) {
    const logTag = '[getCoupon]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v2/coupons/${ couponId }`,
      method: 'get',
    })
  }

  /**
   * @operationName Delete Coupon
   * @category Coupons
   * @description Permanently deletes a coupon by its ID. Customers can no longer redeem the coupon code after deletion. Returns a confirmation object.
   * @route DELETE /delete-coupon
   *
   * @paramDef {"type":"String","label":"Coupon ID","name":"couponId","required":true,"description":"ID (GUID) of the coupon to delete."}
   *
   * @returns {Object}
   * @sampleResult {"deleted":true,"couponId":"e5f6a7b8-9c0d-1e2f-3a4b-5c6d7e8f9a0b"}
   */
  async deleteCoupon(couponId) {
    const logTag = '[deleteCoupon]'

    await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores/v2/coupons/${ couponId }`,
      method: 'delete',
    })

    return { deleted: true, couponId }
  }

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Members
   * @category Members
   * @description Lists site members on the connected Wix site with offset paging. Choose a fieldset to control how much data is returned per member: Public (basic profile), Extended (adds status and privacy), or Full (all fields including contact details). Member IDs are used as authors for blog draft posts.
   * @route GET /list-members
   *
   * @paramDef {"type":"String","label":"Fieldset","name":"fieldset","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Extended","Full"]}},"description":"Amount of member data to return. Defaults to Public."}
   * @paramDef {"type":"Number","label":"Limit","name":"limit","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of members to return (Wix default 50, max 100)."}
   * @paramDef {"type":"Number","label":"Offset","name":"offset","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Number of members to skip for offset-based paging."}
   *
   * @returns {Object}
   * @sampleResult {"members":[{"id":"f0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c","loginEmail":"ada@example.com","status":"APPROVED","profile":{"nickname":"Ada","slug":"ada"},"contact":{"firstName":"Ada","lastName":"Lovelace"},"createdDate":"2026-01-02T08:00:00Z"}],"metadata":{"count":1,"offset":0,"total":42}}
   */
  async listMembers(fieldset, limit, offset) {
    const logTag = '[listMembers]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/members/v1/members`,
      method: 'get',
      query: {
        fieldsets: this.#resolveChoice(fieldset, MEMBER_FIELDSET_MAP),
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })
  }

  /**
   * @operationName Get Member
   * @category Members
   * @description Retrieves a single site member by ID. Choose a fieldset to control how much data is returned: Public (basic profile), Extended (adds status and privacy), or Full (all fields including contact details).
   * @route GET /get-member
   *
   * @paramDef {"type":"String","label":"Member ID","name":"memberId","required":true,"description":"ID (GUID) of the member to retrieve."}
   * @paramDef {"type":"String","label":"Fieldset","name":"fieldset","uiComponent":{"type":"DROPDOWN","options":{"values":["Public","Extended","Full"]}},"description":"Amount of member data to return. Defaults to Public."}
   *
   * @returns {Object}
   * @sampleResult {"member":{"id":"f0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c","loginEmail":"ada@example.com","status":"APPROVED","profile":{"nickname":"Ada","slug":"ada","photo":{"url":"https://static.wixstatic.com/media/avatar.jpg"}},"contact":{"firstName":"Ada","lastName":"Lovelace"},"createdDate":"2026-01-02T08:00:00Z"}}
   */
  async getMember(memberId, fieldset) {
    const logTag = '[getMember]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/members/v1/members/${ memberId }`,
      method: 'get',
      query: {
        fieldsets: this.#resolveChoice(fieldset, MEMBER_FIELDSET_MAP),
      },
    })
  }

  // ---------------------------------------------------------------------------
  // Site
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Site Properties
   * @category Site
   * @description Retrieves the connected Wix site's properties, including site display name, language, locale, currency, time zone, categories, and business contact details. Useful for verifying the connection and reading site-level settings.
   * @route GET /get-site-properties
   *
   * @returns {Object}
   * @sampleResult {"properties":{"siteDisplayName":"Acme Store","language":"en","locale":{"languageCode":"en","country":"US"},"paymentCurrency":"USD","timeZone":"America/New_York","categories":{"primary":"RETAIL"},"email":"hello@acme.com"},"version":7}
   */
  async getSiteProperties() {
    const logTag = '[getSiteProperties]'

    return await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/site-properties/v4/properties`,
      method: 'get',
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} getDataCollectionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to collection display names and IDs."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Data Collections Dictionary
   * @description Provides a searchable list of CMS data collections on the connected site for selecting a collection in Wix Data operations. The option value is the collection ID.
   * @route POST /get-data-collections-dictionary
   * @paramDef {"type":"getDataCollectionsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"My Collection","value":"MyCollection","note":"NATIVE"}],"cursor":null}
   */
  async getDataCollectionsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getDataCollectionsDictionary]'
    const offset = Number(cursor) || 0
    const limit = 100

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/wix-data/v2/collections`,
      method: 'get',
      query: {
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })

    const collections = response.collections || []
    const searchLower = (search || '').toLowerCase()

    const items = collections
      .filter(collection => !searchLower ||
        (collection.displayName || '').toLowerCase().includes(searchLower) ||
        (collection.id || '').toLowerCase().includes(searchLower))
      .map(collection => ({
        label: collection.displayName || collection.id,
        value: collection.id,
        note: collection.collectionType || undefined,
      }))

    return {
      items,
      cursor: collections.length === limit ? String(offset + limit) : null,
    }
  }

  /**
   * @typedef {Object} getProductsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to product names."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Products Dictionary
   * @description Provides a searchable list of Wix Stores products for selecting a product in catalog operations. The option value is the product ID; the note shows the SKU and price when available.
   * @route POST /get-products-dictionary
   * @paramDef {"type":"getProductsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Classic T-Shirt","value":"91f7ac8b-2b0d-4f5a-8f2e-6a1b3c4d5e6f","note":"TSHIRT-001 - 25 USD"}],"cursor":null}
   */
  async getProductsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getProductsDictionary]'
    const offset = Number(cursor) || 0

    const query = {
      paging: { limit: DEFAULT_DICTIONARY_PAGE_SIZE, offset },
    }

    if (search) {
      query.filter = JSON.stringify({ name: { $contains: search } })
    }

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/stores-reader/v1/products/query`,
      method: 'post',
      body: { query },
    })

    const products = response.products || []

    return {
      items: products.map(product => {
        const price = product.priceData ? `${ product.priceData.price } ${ product.priceData.currency || '' }`.trim() : null
        const noteParts = [product.sku, price].filter(Boolean)

        return {
          label: product.name,
          value: product.id,
          note: noteParts.join(' - ') || undefined,
        }
      }),
      cursor: products.length === DEFAULT_DICTIONARY_PAGE_SIZE ? String(offset + DEFAULT_DICTIONARY_PAGE_SIZE) : null,
    }
  }

  /**
   * @typedef {Object} getContactLabelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Text filter applied to label display names and keys."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by a previous call."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Contact Labels Dictionary
   * @description Provides a searchable list of contact labels on the connected site for selecting label keys in contact operations. The option value is the label key expected by Label Contact and Unlabel Contact.
   * @route POST /get-contact-labels-dictionary
   * @paramDef {"type":"getContactLabelsDictionary__payload","label":"Payload","name":"payload","description":"Search and pagination input."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"VIP","value":"custom.vip","note":"USER_DEFINED"}],"cursor":null}
   */
  async getContactLabelsDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getContactLabelsDictionary]'
    const offset = Number(cursor) || 0
    const limit = 100

    const response = await this.#apiRequest({
      logTag,
      url: `${ API_BASE_URL }/contacts/v4/labels`,
      method: 'get',
      query: {
        'paging.limit': limit,
        'paging.offset': offset,
      },
    })

    const labels = response.labels || []
    const searchLower = (search || '').toLowerCase()

    const items = labels
      .filter(label => !searchLower ||
        (label.displayName || '').toLowerCase().includes(searchLower) ||
        (label.key || '').toLowerCase().includes(searchLower))
      .map(label => ({
        label: label.displayName || label.key,
        value: label.key,
        note: label.labelType || undefined,
      }))

    return {
      items,
      cursor: labels.length === limit ? String(offset + limit) : null,
    }
  }
}

Flowrunner.ServerCode.addService(WixService, [
  {
    name: 'apiKey',
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Wix account API key. Create it in Wix - Account Settings - API Keys, and grant it the permission scopes for the APIs you plan to use (e.g. Contacts, Wix Data, Stores, eCommerce, Blog, Members).',
  },
  {
    name: 'accountId',
    displayName: 'Account ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Your Wix account ID, visible on the API Keys page in Account Settings.',
  },
  {
    name: 'siteId',
    displayName: 'Site ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'ID of the Wix site to operate on, found in the site dashboard URL or under Wix - site - Settings. Most Wix APIs are site-scoped.',
  },
])
