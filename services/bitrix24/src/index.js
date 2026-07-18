const logger = {
  info: (...args) => console.log('[Bitrix24] info:', ...args),
  debug: (...args) => console.log('[Bitrix24] debug:', ...args),
  error: (...args) => console.log('[Bitrix24] error:', ...args),
  warn: (...args) => console.log('[Bitrix24] warn:', ...args),
}

const STATUS_ENTITY_MAP = {
  'Lead Statuses': 'STATUS',
  'Lead Sources': 'SOURCE',
  'Deal Stages': 'DEAL_STAGE',
  'Deal Types': 'DEAL_TYPE',
  'Industries': 'INDUSTRY',
  'Contact Types': 'CONTACT_TYPE',
  'Company Types': 'COMPANY_TYPE',
}

const CRM_OWNER_TYPE_MAP = { Lead: 1, Deal: 2, Contact: 3, Company: 4 }

const ACTIVITY_TYPE_MAP = { Meeting: 1, Call: 2, Email: 4 }

const TIMELINE_ENTITY_TYPE_MAP = { Lead: 'lead', Deal: 'deal', Contact: 'contact', Company: 'company' }

const TASK_PRIORITY_MAP = { Low: 0, Medium: 1, High: 2 }

const DEAL_ENTITY_TYPE_ID = 2

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

function safeJsonParse(value) {
  try {
    return JSON.parse(value)
  } catch (e) {
    return undefined
  }
}

/**
 * @integrationName Bitrix24
 * @integrationIcon /icon.svg
 */
class Bitrix24Service {
  constructor(config) {
    this.webhookUrl = String(config.webhookUrl || '').trim().replace(/\/+$/, '')
  }

  async #apiRequest({ url, body, logTag }) {
    const apiMethod = url.slice(url.lastIndexOf('/') + 1).replace('.json', '')

    try {
      logger.debug(`${ logTag } - api request: [${ apiMethod }]`)

      return await Flowrunner.Request.post(url)
        .set({ 'Content-Type': 'application/json' })
        .send(body || {})
    } catch (error) {
      const errorBody = typeof error.body === 'string' ? safeJsonParse(error.body) : error.body
      const description = errorBody?.error_description || errorBody?.error || error.message

      logger.error(`${ logTag } - [${ apiMethod }] failed: ${ description }`)

      const wrappedError = new Error(`Bitrix24 API error: ${ description }`)
      wrappedError.code = errorBody?.error

      throw wrappedError
    }
  }

  #resolveChoice(value, mapping) {
    if (value === undefined || value === null || value === '') {
      return undefined
    }

    return Object.prototype.hasOwnProperty.call(mapping, value) ? mapping[value] : value
  }

  #buildMultiField(value) {
    return value ? [{ VALUE: value, VALUE_TYPE: 'WORK' }] : undefined
  }

  // ---------------------------------------------------------------------------
  // Leads
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Leads
   * @category Leads
   * @description Retrieves a page of CRM leads (crm.lead.list) with optional filtering, sorting, and field selection. Returns up to 50 leads per page; pass the returned next value as Start Offset to fetch the following page. Filter keys are UPPERCASE Bitrix24 field names and support comparison prefixes such as >=, <=, > and % for substring matching.
   * @route GET /leads
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Convenience filter by lead status (STATUS_ID). Pick from the portal's lead statuses or enter a status ID such as NEW."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"Convenience filter by responsible user (ASSIGNED_BY_ID)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw Bitrix24 filter object with UPPERCASE field names. Keys may carry comparison prefixes, e.g. >=OPPORTUNITY for greater-or-equal or %TITLE for substring match. Merged over the convenience filters above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE field names to ASC or DESC, e.g. DATE_CREATE to DESC. Defaults to Bitrix24 ordering by ID ascending."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE field names to return, e.g. ID, TITLE, STATUS_ID. Use UF_* to include a custom field or asterisk-prefixed shortcuts per Bitrix24 docs. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"271","TITLE":"Website enquiry","NAME":"John","LAST_NAME":"Doe","STATUS_ID":"NEW","SOURCE_ID":"WEB","OPPORTUNITY":"5000.00","CURRENCY_ID":"USD","ASSIGNED_BY_ID":"1","DATE_CREATE":"2026-07-01T10:15:30+03:00"}],"total":1,"next":null}
   */
  async listLeads(statusId, assignedById, filter, order, select, start) {
    const logTag = '[listLeads]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.list.json`,
      body: clean({
        filter: clean({ STATUS_ID: statusId, ASSIGNED_BY_ID: assignedById, ...(filter || {}) }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Lead
   * @category Leads
   * @description Retrieves a single CRM lead by ID (crm.lead.get), including standard fields plus multi-value PHONE and EMAIL arrays and any custom UF_* fields.
   * @route GET /lead
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"description":"ID of the lead to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ID":"271","TITLE":"Website enquiry","NAME":"John","LAST_NAME":"Doe","STATUS_ID":"NEW","SOURCE_ID":"WEB","OPPORTUNITY":"5000.00","CURRENCY_ID":"USD","ASSIGNED_BY_ID":"1","COMMENTS":"Interested in the Pro plan","DATE_CREATE":"2026-07-01T10:15:30+03:00","PHONE":[{"ID":"51","VALUE_TYPE":"WORK","VALUE":"+15551234567","TYPE_ID":"PHONE"}],"EMAIL":[{"ID":"53","VALUE_TYPE":"WORK","VALUE":"john.doe@example.com","TYPE_ID":"EMAIL"}]}
   */
  async getLead(leadId) {
    const logTag = '[getLead]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.get.json`,
      body: { id: leadId },
    })

    return result
  }

  /**
   * @operationName Create Lead
   * @category Leads
   * @description Creates a new CRM lead (crm.lead.add) and returns its ID. Convenience parameters cover the most common fields; single email and phone values are stored as WORK-type contact data. Use Additional Fields to set any other standard or custom UF_* field - values there override the convenience parameters. The change is registered in the activity stream.
   * @route POST /lead
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Lead title shown in the CRM, e.g. the subject of the enquiry."}
   * @paramDef {"type":"String","label":"First Name","name":"name","description":"Contact person's first name (NAME field)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact person's last name (LAST_NAME field)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address, stored as a WORK-type EMAIL entry."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number, stored as a WORK-type PHONE entry."}
   * @paramDef {"type":"String","label":"Status","name":"statusId","dictionary":"getLeadStatusesDictionary","description":"Lead status (STATUS_ID). Pick from the portal's statuses or enter a status ID such as NEW."}
   * @paramDef {"type":"String","label":"Source","name":"sourceId","description":"Lead source ID (SOURCE_ID), e.g. WEB, CALL, ADVERTISING. Use Get Status List with Lead Sources to see the portal's values."}
   * @paramDef {"type":"Number","label":"Expected Amount","name":"opportunity","description":"Estimated deal amount (OPPORTUNITY)."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","description":"Currency code (CURRENCY_ID), e.g. USD or EUR."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form comment stored on the lead (COMMENTS field, HTML supported)."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"User responsible for the lead (ASSIGNED_BY_ID). Defaults to the webhook owner."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"fields","description":"Raw Bitrix24 fields object with UPPERCASE keys for any other standard or custom UF_* field. Overrides the convenience parameters on key conflicts."}
   *
   * @returns {Object}
   * @sampleResult {"id":271}
   */
  async createLead(title, name, lastName, email, phone, statusId, sourceId, opportunity, currencyId, comments, assignedById, fields) {
    const logTag = '[createLead]'

    const builtFields = clean({
      TITLE: title,
      NAME: name,
      LAST_NAME: lastName,
      EMAIL: this.#buildMultiField(email),
      PHONE: this.#buildMultiField(phone),
      STATUS_ID: statusId,
      SOURCE_ID: sourceId,
      OPPORTUNITY: opportunity,
      CURRENCY_ID: currencyId,
      COMMENTS: comments,
      ASSIGNED_BY_ID: assignedById,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.add.json`,
      body: {
        fields: { ...builtFields, ...(fields || {}) },
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { id: result }
  }

  /**
   * @operationName Update Lead
   * @category Leads
   * @description Updates an existing CRM lead (crm.lead.update). Provide only the fields to change, using UPPERCASE Bitrix24 field names, e.g. TITLE, STATUS_ID, OPPORTUNITY, or custom UF_* keys. Multi-value fields such as PHONE and EMAIL replace existing entries unless an existing entry ID is included.
   * @route PUT /lead
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"description":"ID of the lead to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Fields to update with UPPERCASE keys, e.g. STATUS_ID or COMMENTS. Only the provided keys are changed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":271}
   */
  async updateLead(leadId, fields) {
    const logTag = '[updateLead]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.update.json`,
      body: {
        id: leadId,
        fields: fields || {},
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { success: Boolean(result), id: leadId }
  }

  /**
   * @operationName Delete Lead
   * @category Leads
   * @description Permanently deletes a CRM lead by ID (crm.lead.delete), including its timeline records. This cannot be undone.
   * @route DELETE /lead
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Lead ID","name":"leadId","required":true,"description":"ID of the lead to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":271}
   */
  async deleteLead(leadId) {
    const logTag = '[deleteLead]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.delete.json`,
      body: { id: leadId },
    })

    return { success: Boolean(result), id: leadId }
  }

  /**
   * @operationName Get Lead Fields
   * @category Leads
   * @description Returns the schema of all lead fields (crm.lead.fields), including custom UF_* fields, with each field's type, title, and whether it is required or read-only. Use it to discover the exact field names accepted by Create Lead and Update Lead on this portal.
   * @route GET /lead-fields
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"ID":{"type":"integer","isRequired":false,"isReadOnly":true,"title":"ID"},"TITLE":{"type":"string","isRequired":false,"isReadOnly":false,"title":"Lead Name"},"STATUS_ID":{"type":"crm_status","isRequired":false,"isReadOnly":false,"title":"Stage"}}
   */
  async getLeadFields() {
    const logTag = '[getLeadFields]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.lead.fields.json`,
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Contacts
   * @category Contacts
   * @description Retrieves a page of CRM contacts (crm.contact.list) with optional filtering, sorting, and field selection. Returns up to 50 contacts per page; pass the returned next value as Start Offset for the following page. Filter keys are UPPERCASE Bitrix24 field names with optional comparison prefixes such as >=, <= and % for substring matching.
   * @route GET /contacts
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"Convenience filter by responsible user (ASSIGNED_BY_ID)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw Bitrix24 filter object with UPPERCASE field names, e.g. %LAST_NAME for substring match or COMPANY_ID for an exact match. Merged over the convenience filter above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE field names to ASC or DESC, e.g. DATE_CREATE to DESC."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE field names to return, e.g. ID, NAME, LAST_NAME, EMAIL. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"84","NAME":"Jane","LAST_NAME":"Smith","COMPANY_ID":"12","ASSIGNED_BY_ID":"1","DATE_CREATE":"2026-06-15T09:00:00+03:00"}],"total":1,"next":null}
   */
  async listContacts(assignedById, filter, order, select, start) {
    const logTag = '[listContacts]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.list.json`,
      body: clean({
        filter: clean({ ASSIGNED_BY_ID: assignedById, ...(filter || {}) }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Contact
   * @category Contacts
   * @description Retrieves a single CRM contact by ID (crm.contact.get), including standard fields plus multi-value PHONE and EMAIL arrays and any custom UF_* fields.
   * @route GET /contact
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ID":"84","NAME":"Jane","LAST_NAME":"Smith","COMPANY_ID":"12","ASSIGNED_BY_ID":"1","COMMENTS":"Met at the trade show","PHONE":[{"ID":"91","VALUE_TYPE":"WORK","VALUE":"+15559876543","TYPE_ID":"PHONE"}],"EMAIL":[{"ID":"92","VALUE_TYPE":"WORK","VALUE":"jane.smith@example.com","TYPE_ID":"EMAIL"}]}
   */
  async getContact(contactId) {
    const logTag = '[getContact]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.get.json`,
      body: { id: contactId },
    })

    return result
  }

  /**
   * @operationName Create Contact
   * @category Contacts
   * @description Creates a new CRM contact (crm.contact.add) and returns its ID. Single email and phone values are stored as WORK-type contact data. Use Additional Fields to set any other standard or custom UF_* field - values there override the convenience parameters. The change is registered in the activity stream.
   * @route POST /contact
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"First Name","name":"name","required":true,"description":"Contact's first name (NAME field)."}
   * @paramDef {"type":"String","label":"Last Name","name":"lastName","description":"Contact's last name (LAST_NAME field)."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address, stored as a WORK-type EMAIL entry."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number, stored as a WORK-type PHONE entry."}
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","description":"ID of the company to link this contact to (COMPANY_ID)."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"User responsible for the contact (ASSIGNED_BY_ID). Defaults to the webhook owner."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form comment stored on the contact (COMMENTS field, HTML supported)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"fields","description":"Raw Bitrix24 fields object with UPPERCASE keys for any other standard or custom UF_* field. Overrides the convenience parameters on key conflicts."}
   *
   * @returns {Object}
   * @sampleResult {"id":84}
   */
  async createContact(name, lastName, email, phone, companyId, assignedById, comments, fields) {
    const logTag = '[createContact]'

    const builtFields = clean({
      NAME: name,
      LAST_NAME: lastName,
      EMAIL: this.#buildMultiField(email),
      PHONE: this.#buildMultiField(phone),
      COMPANY_ID: companyId,
      ASSIGNED_BY_ID: assignedById,
      COMMENTS: comments,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.add.json`,
      body: {
        fields: { ...builtFields, ...(fields || {}) },
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { id: result }
  }

  /**
   * @operationName Update Contact
   * @category Contacts
   * @description Updates an existing CRM contact (crm.contact.update). Provide only the fields to change, using UPPERCASE Bitrix24 field names, e.g. NAME, COMPANY_ID, or custom UF_* keys. Multi-value fields such as PHONE and EMAIL replace existing entries unless an existing entry ID is included.
   * @route PUT /contact
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Fields to update with UPPERCASE keys, e.g. LAST_NAME or COMMENTS. Only the provided keys are changed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":84}
   */
  async updateContact(contactId, fields) {
    const logTag = '[updateContact]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.update.json`,
      body: {
        id: contactId,
        fields: fields || {},
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { success: Boolean(result), id: contactId }
  }

  /**
   * @operationName Delete Contact
   * @category Contacts
   * @description Permanently deletes a CRM contact by ID (crm.contact.delete). This cannot be undone.
   * @route DELETE /contact
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","required":true,"description":"ID of the contact to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":84}
   */
  async deleteContact(contactId) {
    const logTag = '[deleteContact]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.delete.json`,
      body: { id: contactId },
    })

    return { success: Boolean(result), id: contactId }
  }

  /**
   * @operationName Get Contact Fields
   * @category Contacts
   * @description Returns the schema of all contact fields (crm.contact.fields), including custom UF_* fields, with each field's type, title, and whether it is required or read-only. Use it to discover the exact field names accepted by Create Contact and Update Contact on this portal.
   * @route GET /contact-fields
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"ID":{"type":"integer","isRequired":false,"isReadOnly":true,"title":"ID"},"NAME":{"type":"string","isRequired":false,"isReadOnly":false,"title":"First Name"},"COMPANY_ID":{"type":"crm_company","isRequired":false,"isReadOnly":false,"title":"Company"}}
   */
  async getContactFields() {
    const logTag = '[getContactFields]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.contact.fields.json`,
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // Companies
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Companies
   * @category Companies
   * @description Retrieves a page of CRM companies (crm.company.list) with optional filtering, sorting, and field selection. Returns up to 50 companies per page; pass the returned next value as Start Offset for the following page. Filter keys are UPPERCASE Bitrix24 field names with optional comparison prefixes such as >=, <= and % for substring matching.
   * @route GET /companies
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"Convenience filter by responsible user (ASSIGNED_BY_ID)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw Bitrix24 filter object with UPPERCASE field names, e.g. %TITLE for substring match or COMPANY_TYPE for an exact match. Merged over the convenience filter above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE field names to ASC or DESC, e.g. TITLE to ASC."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE field names to return, e.g. ID, TITLE, COMPANY_TYPE, INDUSTRY. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"12","TITLE":"Acme Corp","COMPANY_TYPE":"CUSTOMER","INDUSTRY":"IT","ASSIGNED_BY_ID":"1","DATE_CREATE":"2026-05-10T12:00:00+03:00"}],"total":1,"next":null}
   */
  async listCompanies(assignedById, filter, order, select, start) {
    const logTag = '[listCompanies]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.list.json`,
      body: clean({
        filter: clean({ ASSIGNED_BY_ID: assignedById, ...(filter || {}) }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Company
   * @category Companies
   * @description Retrieves a single CRM company by ID (crm.company.get), including standard fields plus multi-value PHONE and EMAIL arrays and any custom UF_* fields.
   * @route GET /company
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"description":"ID of the company to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ID":"12","TITLE":"Acme Corp","COMPANY_TYPE":"CUSTOMER","INDUSTRY":"IT","ASSIGNED_BY_ID":"1","PHONE":[{"ID":"31","VALUE_TYPE":"WORK","VALUE":"+15550001111","TYPE_ID":"PHONE"}],"EMAIL":[{"ID":"32","VALUE_TYPE":"WORK","VALUE":"info@acme.example.com","TYPE_ID":"EMAIL"}]}
   */
  async getCompany(companyId) {
    const logTag = '[getCompany]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.get.json`,
      body: { id: companyId },
    })

    return result
  }

  /**
   * @operationName Create Company
   * @category Companies
   * @description Creates a new CRM company (crm.company.add) and returns its ID. Single email and phone values are stored as WORK-type contact data. Company Type and Industry accept the portal's reference values - use Get Status List with Company Types or Industries to see them. Use Additional Fields for any other standard or custom UF_* field.
   * @route POST /company
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Company name (TITLE field)."}
   * @paramDef {"type":"String","label":"Company Type","name":"companyType","description":"Company type ID (COMPANY_TYPE), e.g. CUSTOMER, SUPPLIER, PARTNER. Use Get Status List with Company Types to see the portal's values."}
   * @paramDef {"type":"String","label":"Industry","name":"industry","description":"Industry ID (INDUSTRY), e.g. IT, MANUFACTURING. Use Get Status List with Industries to see the portal's values."}
   * @paramDef {"type":"String","label":"Email","name":"email","description":"Email address, stored as a WORK-type EMAIL entry."}
   * @paramDef {"type":"String","label":"Phone","name":"phone","description":"Phone number, stored as a WORK-type PHONE entry."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"User responsible for the company (ASSIGNED_BY_ID). Defaults to the webhook owner."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"fields","description":"Raw Bitrix24 fields object with UPPERCASE keys for any other standard or custom UF_* field. Overrides the convenience parameters on key conflicts."}
   *
   * @returns {Object}
   * @sampleResult {"id":12}
   */
  async createCompany(title, companyType, industry, email, phone, assignedById, fields) {
    const logTag = '[createCompany]'

    const builtFields = clean({
      TITLE: title,
      COMPANY_TYPE: companyType,
      INDUSTRY: industry,
      EMAIL: this.#buildMultiField(email),
      PHONE: this.#buildMultiField(phone),
      ASSIGNED_BY_ID: assignedById,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.add.json`,
      body: {
        fields: { ...builtFields, ...(fields || {}) },
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { id: result }
  }

  /**
   * @operationName Update Company
   * @category Companies
   * @description Updates an existing CRM company (crm.company.update). Provide only the fields to change, using UPPERCASE Bitrix24 field names, e.g. TITLE, COMPANY_TYPE, or custom UF_* keys. Multi-value fields such as PHONE and EMAIL replace existing entries unless an existing entry ID is included.
   * @route PUT /company
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"description":"ID of the company to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Fields to update with UPPERCASE keys, e.g. TITLE or INDUSTRY. Only the provided keys are changed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":12}
   */
  async updateCompany(companyId, fields) {
    const logTag = '[updateCompany]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.update.json`,
      body: {
        id: companyId,
        fields: fields || {},
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { success: Boolean(result), id: companyId }
  }

  /**
   * @operationName Delete Company
   * @category Companies
   * @description Permanently deletes a CRM company by ID (crm.company.delete). Linked contacts and deals are kept but lose the company reference. This cannot be undone.
   * @route DELETE /company
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","required":true,"description":"ID of the company to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":12}
   */
  async deleteCompany(companyId) {
    const logTag = '[deleteCompany]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.delete.json`,
      body: { id: companyId },
    })

    return { success: Boolean(result), id: companyId }
  }

  /**
   * @operationName Get Company Fields
   * @category Companies
   * @description Returns the schema of all company fields (crm.company.fields), including custom UF_* fields, with each field's type, title, and whether it is required or read-only. Use it to discover the exact field names accepted by Create Company and Update Company on this portal.
   * @route GET /company-fields
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"ID":{"type":"integer","isRequired":false,"isReadOnly":true,"title":"ID"},"TITLE":{"type":"string","isRequired":true,"isReadOnly":false,"title":"Company Name"},"INDUSTRY":{"type":"crm_status","isRequired":false,"isReadOnly":false,"title":"Industry"}}
   */
  async getCompanyFields() {
    const logTag = '[getCompanyFields]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.company.fields.json`,
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // Deals
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Deals
   * @category Deals
   * @description Retrieves a page of CRM deals (crm.deal.list) with optional filtering, sorting, and field selection. Returns up to 50 deals per page; pass the returned next value as Start Offset for the following page. Filter keys are UPPERCASE Bitrix24 field names with optional comparison prefixes such as >=OPPORTUNITY or %TITLE for substring matching.
   * @route GET /deals
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Pipeline","name":"categoryId","dictionary":"getDealCategoriesDictionary","description":"Convenience filter by pipeline (CATEGORY_ID). The default pipeline has ID 0."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getDealStagesDictionary","dependsOn":["categoryId"],"description":"Convenience filter by deal stage (STAGE_ID). Pick a pipeline above to choose from its stages, or enter a stage ID such as NEW or WON."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"Convenience filter by responsible user (ASSIGNED_BY_ID)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw Bitrix24 filter object with UPPERCASE field names, e.g. >=OPPORTUNITY for a minimum amount or CLOSED set to N for open deals. Merged over the convenience filters above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE field names to ASC or DESC, e.g. OPPORTUNITY to DESC."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE field names to return, e.g. ID, TITLE, STAGE_ID, OPPORTUNITY. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"98","TITLE":"Acme Corp - Pro plan","STAGE_ID":"NEGOTIATION","CATEGORY_ID":"0","CONTACT_ID":"84","COMPANY_ID":"12","OPPORTUNITY":"12000.00","CURRENCY_ID":"USD","ASSIGNED_BY_ID":"1","CLOSEDATE":"2026-08-31T00:00:00+03:00"}],"total":1,"next":null}
   */
  async listDeals(categoryId, stageId, assignedById, filter, order, select, start) {
    const logTag = '[listDeals]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.list.json`,
      body: clean({
        filter: clean({ CATEGORY_ID: categoryId, STAGE_ID: stageId, ASSIGNED_BY_ID: assignedById, ...(filter || {}) }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Deal
   * @category Deals
   * @description Retrieves a single CRM deal by ID (crm.deal.get), including standard fields and any custom UF_* fields.
   * @route GET /deal
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"description":"ID of the deal to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"ID":"98","TITLE":"Acme Corp - Pro plan","STAGE_ID":"NEGOTIATION","CATEGORY_ID":"0","CONTACT_ID":"84","COMPANY_ID":"12","OPPORTUNITY":"12000.00","CURRENCY_ID":"USD","ASSIGNED_BY_ID":"1","COMMENTS":"Renewal discussion in progress","CLOSEDATE":"2026-08-31T00:00:00+03:00","DATE_CREATE":"2026-06-01T14:20:00+03:00"}
   */
  async getDeal(dealId) {
    const logTag = '[getDeal]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.get.json`,
      body: { id: dealId },
    })

    return result
  }

  /**
   * @operationName Create Deal
   * @category Deals
   * @description Creates a new CRM deal (crm.deal.add) and returns its ID. Choose a pipeline and stage, link a contact and company, and set the amount and expected close date. Use Additional Fields to set any other standard or custom UF_* field - values there override the convenience parameters. The change is registered in the activity stream.
   * @route POST /deal
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Deal title shown in the CRM (TITLE field)."}
   * @paramDef {"type":"String","label":"Pipeline","name":"categoryId","dictionary":"getDealCategoriesDictionary","description":"Pipeline for the deal (CATEGORY_ID). Defaults to the portal's default pipeline (ID 0)."}
   * @paramDef {"type":"String","label":"Stage","name":"stageId","dictionary":"getDealStagesDictionary","dependsOn":["categoryId"],"description":"Deal stage (STAGE_ID). Pick a pipeline above to choose from its stages; defaults to the pipeline's first stage."}
   * @paramDef {"type":"Number","label":"Contact ID","name":"contactId","description":"ID of the primary contact to link (CONTACT_ID)."}
   * @paramDef {"type":"Number","label":"Company ID","name":"companyId","description":"ID of the company to link (COMPANY_ID)."}
   * @paramDef {"type":"Number","label":"Amount","name":"opportunity","description":"Deal amount (OPPORTUNITY)."}
   * @paramDef {"type":"String","label":"Currency","name":"currencyId","description":"Currency code (CURRENCY_ID), e.g. USD or EUR."}
   * @paramDef {"type":"String","label":"Close Date","name":"closeDate","uiComponent":{"type":"DATE_PICKER"},"description":"Expected close date (CLOSEDATE), e.g. 2026-08-31."}
   * @paramDef {"type":"String","label":"Assigned To","name":"assignedById","dictionary":"getUsersDictionary","description":"User responsible for the deal (ASSIGNED_BY_ID). Defaults to the webhook owner."}
   * @paramDef {"type":"String","label":"Comments","name":"comments","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Free-form comment stored on the deal (COMMENTS field, HTML supported)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"fields","description":"Raw Bitrix24 fields object with UPPERCASE keys for any other standard or custom UF_* field. Overrides the convenience parameters on key conflicts."}
   *
   * @returns {Object}
   * @sampleResult {"id":98}
   */
  async createDeal(title, categoryId, stageId, contactId, companyId, opportunity, currencyId, closeDate, assignedById, comments, fields) {
    const logTag = '[createDeal]'

    const builtFields = clean({
      TITLE: title,
      CATEGORY_ID: categoryId,
      STAGE_ID: stageId,
      CONTACT_ID: contactId,
      COMPANY_ID: companyId,
      OPPORTUNITY: opportunity,
      CURRENCY_ID: currencyId,
      CLOSEDATE: closeDate,
      ASSIGNED_BY_ID: assignedById,
      COMMENTS: comments,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.add.json`,
      body: {
        fields: { ...builtFields, ...(fields || {}) },
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { id: result }
  }

  /**
   * @operationName Update Deal
   * @category Deals
   * @description Updates an existing CRM deal (crm.deal.update). Provide only the fields to change, using UPPERCASE Bitrix24 field names, e.g. STAGE_ID to move the deal along the pipeline, OPPORTUNITY, or custom UF_* keys.
   * @route PUT /deal
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"description":"ID of the deal to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Fields to update with UPPERCASE keys, e.g. STAGE_ID or OPPORTUNITY. Only the provided keys are changed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":98}
   */
  async updateDeal(dealId, fields) {
    const logTag = '[updateDeal]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.update.json`,
      body: {
        id: dealId,
        fields: fields || {},
        params: { REGISTER_SONET_EVENT: 'Y' },
      },
    })

    return { success: Boolean(result), id: dealId }
  }

  /**
   * @operationName Delete Deal
   * @category Deals
   * @description Permanently deletes a CRM deal by ID (crm.deal.delete), including its timeline records. This cannot be undone.
   * @route DELETE /deal
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Deal ID","name":"dealId","required":true,"description":"ID of the deal to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":98}
   */
  async deleteDeal(dealId) {
    const logTag = '[deleteDeal]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.delete.json`,
      body: { id: dealId },
    })

    return { success: Boolean(result), id: dealId }
  }

  /**
   * @operationName Get Deal Fields
   * @category Deals
   * @description Returns the schema of all deal fields (crm.deal.fields), including custom UF_* fields, with each field's type, title, and whether it is required or read-only. Use it to discover the exact field names accepted by Create Deal and Update Deal on this portal.
   * @route GET /deal-fields
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"ID":{"type":"integer","isRequired":false,"isReadOnly":true,"title":"ID"},"TITLE":{"type":"string","isRequired":false,"isReadOnly":false,"title":"Deal Name"},"STAGE_ID":{"type":"crm_status","isRequired":false,"isReadOnly":false,"title":"Stage"}}
   */
  async getDealFields() {
    const logTag = '[getDealFields]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.deal.fields.json`,
    })

    return result
  }

  // ---------------------------------------------------------------------------
  // CRM reference data
  // ---------------------------------------------------------------------------

  /**
   * @operationName Get Status List
   * @category CRM Reference Data
   * @description Retrieves CRM reference values (crm.status.list) such as lead statuses, lead sources, deal stages, deal types, industries, contact types, and company types configured on the portal. For deal stages of a non-default pipeline, also provide the Pipeline ID. Use the returned STATUS_ID values in create, update, and filter operations.
   * @route GET /statuses
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Reference Type","name":"entityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Lead Statuses","Lead Sources","Deal Stages","Deal Types","Industries","Contact Types","Company Types"]}},"defaultValue":"Lead Statuses","description":"Which CRM reference book to retrieve."}
   * @paramDef {"type":"String","label":"Pipeline","name":"dealCategoryId","dictionary":"getDealCategoriesDictionary","description":"Only for Deal Stages: pipeline whose stages to return. Leave empty (or 0) for the default pipeline."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"1","ENTITY_ID":"STATUS","STATUS_ID":"NEW","NAME":"Unsorted","SORT":"10","SYSTEM":"Y"},{"ID":"2","ENTITY_ID":"STATUS","STATUS_ID":"IN_PROCESS","NAME":"In progress","SORT":"20","SYSTEM":"N"}],"total":2}
   */
  async getStatusList(entityType, dealCategoryId) {
    const logTag = '[getStatusList]'

    const baseEntityId = this.#resolveChoice(entityType, STATUS_ENTITY_MAP) || 'STATUS'
    const entityId = baseEntityId === 'DEAL_STAGE' && dealCategoryId && String(dealCategoryId) !== '0'
      ? `DEAL_STAGE_${ dealCategoryId }`
      : baseEntityId

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.status.list.json`,
      body: {
        filter: { ENTITY_ID: entityId },
        order: { SORT: 'ASC' },
      },
    })

    return { items: response.result || [], total: response.total }
  }

  /**
   * @operationName Get Deal Categories
   * @category CRM Reference Data
   * @description Retrieves all deal pipelines (crm.category.list with entityTypeId 2), including the default pipeline. Use a pipeline's id as CATEGORY_ID when creating, updating, or filtering deals, and to fetch its stages via Get Status List.
   * @route GET /deal-categories
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":0,"name":"General","sort":100,"entityTypeId":2,"isDefault":"Y"},{"id":9,"name":"Enterprise sales","sort":200,"entityTypeId":2,"isDefault":"N"}],"total":2}
   */
  async getDealCategories() {
    const logTag = '[getDealCategories]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.category.list.json`,
      body: { entityTypeId: DEAL_ENTITY_TYPE_ID },
    })

    return { items: response.result?.categories || [], total: response.total }
  }

  // ---------------------------------------------------------------------------
  // Activities & timeline
  // ---------------------------------------------------------------------------

  /**
   * @operationName Add Timeline Comment
   * @category Activities
   * @description Adds a comment to the timeline of a lead, deal, contact, or company (crm.timeline.comment.add). The comment appears in the entity's timeline feed and supports BB-code formatting.
   * @route POST /timeline-comment
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Entity Type","name":"entityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Deal","Contact","Company"]}},"description":"Type of CRM record to comment on."}
   * @paramDef {"type":"Number","label":"Entity ID","name":"entityId","required":true,"description":"ID of the CRM record to comment on."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Comment text. Supports BB-code formatting such as [b]bold[/b]."}
   *
   * @returns {Object}
   * @sampleResult {"id":501}
   */
  async addTimelineComment(entityType, entityId, comment) {
    const logTag = '[addTimelineComment]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.timeline.comment.add.json`,
      body: {
        fields: {
          ENTITY_ID: entityId,
          ENTITY_TYPE: this.#resolveChoice(entityType, TIMELINE_ENTITY_TYPE_MAP),
          COMMENT: comment,
        },
      },
    })

    return { id: result }
  }

  /**
   * @operationName Create Activity
   * @category Activities
   * @description Creates a CRM activity - a meeting, call, or email - attached to a lead, deal, contact, or company (crm.activity.add). Call and email activities require at least one communication entry (a phone number or email address, optionally linked to a CRM entity). Returns the new activity ID.
   * @route POST /activity
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Attach To","name":"ownerType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Deal","Contact","Company"]}},"description":"Type of CRM record the activity belongs to (OWNER_TYPE_ID)."}
   * @paramDef {"type":"Number","label":"Record ID","name":"ownerId","required":true,"description":"ID of the CRM record the activity belongs to (OWNER_ID)."}
   * @paramDef {"type":"String","label":"Activity Type","name":"activityType","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["Meeting","Call","Email"]}},"description":"Kind of activity to create (TYPE_ID)."}
   * @paramDef {"type":"String","label":"Subject","name":"subject","required":true,"description":"Short subject line of the activity."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the activity."}
   * @paramDef {"type":"String","label":"Start Time","name":"startTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Start date and time in ISO 8601, e.g. 2026-07-20T15:00:00+03:00."}
   * @paramDef {"type":"String","label":"End Time","name":"endTime","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"End date and time in ISO 8601. Must be after the start time."}
   * @paramDef {"type":"Boolean","label":"Completed","name":"completed","uiComponent":{"type":"TOGGLE"},"description":"Turn on to create the activity as already completed."}
   * @paramDef {"type":"String","label":"Responsible User","name":"responsibleId","dictionary":"getUsersDictionary","description":"User responsible for the activity (RESPONSIBLE_ID). Defaults to the webhook owner."}
   * @paramDef {"type":"Array<ActivityCommunication>","label":"Communications","name":"communications","description":"Communication entries (phone numbers or email addresses) linked to the activity. Required for Call and Email activities."}
   *
   * @returns {Object}
   * @sampleResult {"id":301}
   */
  async createActivity(ownerType, ownerId, activityType, subject, description, startTime, endTime, completed, responsibleId, communications) {
    const logTag = '[createActivity]'

    const builtFields = clean({
      OWNER_TYPE_ID: this.#resolveChoice(ownerType, CRM_OWNER_TYPE_MAP),
      OWNER_ID: ownerId,
      TYPE_ID: this.#resolveChoice(activityType, ACTIVITY_TYPE_MAP),
      SUBJECT: subject,
      DESCRIPTION: description,
      START_TIME: startTime,
      END_TIME: endTime,
      COMPLETED: completed === undefined ? undefined : (completed ? 'Y' : 'N'),
      RESPONSIBLE_ID: responsibleId,
      COMMUNICATIONS: communications && communications.length ? communications : undefined,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.activity.add.json`,
      body: { fields: builtFields },
    })

    return { id: result }
  }

  /**
   * @operationName List Activities
   * @category Activities
   * @description Retrieves a page of CRM activities (crm.activity.list) such as meetings, calls, and emails, with optional filtering by owner record, sorting, and field selection. Returns up to 50 activities per page; pass the returned next value as Start Offset for the following page.
   * @route GET /activities
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Attached To","name":"ownerType","uiComponent":{"type":"DROPDOWN","options":{"values":["Lead","Deal","Contact","Company"]}},"description":"Convenience filter by owner record type (OWNER_TYPE_ID)."}
   * @paramDef {"type":"Number","label":"Record ID","name":"ownerId","description":"Convenience filter by owner record ID (OWNER_ID). Combine with Attached To."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw Bitrix24 filter object with UPPERCASE field names, e.g. COMPLETED set to N, TYPE_ID set to 2 for calls, or >=START_TIME for a date range. Merged over the convenience filters above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE field names to ASC or DESC, e.g. START_TIME to DESC."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE field names to return, e.g. ID, SUBJECT, TYPE_ID, COMPLETED. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"301","OWNER_ID":"98","OWNER_TYPE_ID":"2","TYPE_ID":"2","SUBJECT":"Follow-up call","COMPLETED":"N","RESPONSIBLE_ID":"1","START_TIME":"2026-07-20T15:00:00+03:00","END_TIME":"2026-07-20T15:30:00+03:00"}],"total":1,"next":null}
   */
  async listActivities(ownerType, ownerId, filter, order, select, start) {
    const logTag = '[listActivities]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.activity.list.json`,
      body: clean({
        filter: clean({
          OWNER_TYPE_ID: this.#resolveChoice(ownerType, CRM_OWNER_TYPE_MAP),
          OWNER_ID: ownerId,
          ...(filter || {}),
        }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Tasks
   * @category Tasks
   * @description Retrieves a page of tasks (tasks.task.list) with optional filtering, sorting, and field selection. Returns up to 50 tasks per page; pass the returned next value as Start Offset for the following page. Filter keys use UPPERCASE task field names with optional comparison prefixes, e.g. RESPONSIBLE_ID, STATUS, or >=CREATED_DATE. Note that task objects are returned with camelCase property names.
   * @route GET /tasks
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Responsible User","name":"responsibleId","dictionary":"getUsersDictionary","description":"Convenience filter by the user the task is assigned to (RESPONSIBLE_ID)."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw filter object with UPPERCASE task field names, e.g. STATUS set to 2 for pending or GROUP_ID for a project. Supports comparison prefixes such as >=DEADLINE. Merged over the convenience filter above."}
   * @paramDef {"type":"Object","label":"Order","name":"order","description":"Sort object mapping UPPERCASE task field names to asc or desc, e.g. DEADLINE to asc."}
   * @paramDef {"type":"Array<String>","label":"Select Fields","name":"select","description":"UPPERCASE task field names to return, e.g. ID, TITLE, STATUS, DEADLINE. Leave empty for the default field set."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"id":"612","title":"Prepare proposal","description":"Draft the Q3 proposal","status":"2","priority":"1","responsibleId":"1","createdBy":"1","deadline":"2026-07-25T18:00:00+03:00","groupId":"0"}],"total":1,"next":null}
   */
  async listTasks(responsibleId, filter, order, select, start) {
    const logTag = '[listTasks]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.list.json`,
      body: clean({
        filter: clean({ RESPONSIBLE_ID: responsibleId, ...(filter || {}) }),
        order,
        select: select && select.length ? select : undefined,
        start,
      }),
    })

    return { items: response.result?.tasks || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Task
   * @category Tasks
   * @description Retrieves a single task by ID (tasks.task.get), returning the task object with camelCase property names including title, description, status, priority, deadline, and responsible user.
   * @route GET /task
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to retrieve."}
   *
   * @returns {Object}
   * @sampleResult {"id":"612","title":"Prepare proposal","description":"Draft the Q3 proposal","status":"2","priority":"1","responsibleId":"1","createdBy":"1","deadline":"2026-07-25T18:00:00+03:00","groupId":"0"}
   */
  async getTask(taskId) {
    const logTag = '[getTask]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.get.json`,
      body: { taskId },
    })

    return result?.task
  }

  /**
   * @operationName Create Task
   * @category Tasks
   * @description Creates a new task (tasks.task.add) and returns the created task object. Assign a responsible user, set a deadline and priority, and optionally attach the task to a workgroup or project. Use Additional Fields for any other task field with UPPERCASE keys, e.g. ACCOMPLICES, AUDITORS, or UF_CRM_TASK to link CRM records.
   * @route POST /task
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Title","name":"title","required":true,"description":"Task title (TITLE field)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Task description (DESCRIPTION field, BB-code supported)."}
   * @paramDef {"type":"String","label":"Responsible User","name":"responsibleId","required":true,"dictionary":"getUsersDictionary","description":"User the task is assigned to (RESPONSIBLE_ID)."}
   * @paramDef {"type":"String","label":"Deadline","name":"deadline","uiComponent":{"type":"DATE_TIME_PICKER"},"description":"Deadline in ISO 8601, e.g. 2026-07-25T18:00:00+03:00."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","uiComponent":{"type":"DROPDOWN","options":{"values":["Low","Medium","High"]}},"defaultValue":"Medium","description":"Task priority."}
   * @paramDef {"type":"Number","label":"Group ID","name":"groupId","description":"ID of the workgroup or project to attach the task to (GROUP_ID)."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"fields","description":"Raw task fields object with UPPERCASE keys for any other field, e.g. ACCOMPLICES, AUDITORS, START_DATE_PLAN, or UF_CRM_TASK. Overrides the convenience parameters on key conflicts."}
   *
   * @returns {Object}
   * @sampleResult {"id":"612","title":"Prepare proposal","description":"Draft the Q3 proposal","status":"2","priority":"1","responsibleId":"1","createdBy":"1","deadline":"2026-07-25T18:00:00+03:00","groupId":"0"}
   */
  async createTask(title, description, responsibleId, deadline, priority, groupId, fields) {
    const logTag = '[createTask]'

    const builtFields = clean({
      TITLE: title,
      DESCRIPTION: description,
      RESPONSIBLE_ID: responsibleId,
      DEADLINE: deadline,
      PRIORITY: this.#resolveChoice(priority, TASK_PRIORITY_MAP),
      GROUP_ID: groupId,
    })

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.add.json`,
      body: { fields: { ...builtFields, ...(fields || {}) } },
    })

    return result?.task
  }

  /**
   * @operationName Update Task
   * @category Tasks
   * @description Updates an existing task (tasks.task.update). Provide only the fields to change, using UPPERCASE task field names, e.g. TITLE, DEADLINE, RESPONSIBLE_ID, or PRIORITY (0 low, 1 medium, 2 high). Returns the updated task when the portal provides it.
   * @route PUT /task
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to update."}
   * @paramDef {"type":"Object","label":"Fields","name":"fields","required":true,"description":"Fields to update with UPPERCASE keys, e.g. TITLE or DEADLINE. Only the provided keys are changed."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"task":{"id":"612","title":"Prepare proposal (updated)","status":"2","responsibleId":"1"}}
   */
  async updateTask(taskId, fields) {
    const logTag = '[updateTask]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.update.json`,
      body: { taskId, fields: fields || {} },
    })

    return { success: true, task: result?.task || null }
  }

  /**
   * @operationName Complete Task
   * @category Tasks
   * @description Marks a task as completed (tasks.task.complete). If the task has a result requirement or unfinished checklist configured on the portal, Bitrix24 may reject the completion.
   * @route POST /task-complete
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to complete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":612}
   */
  async completeTask(taskId) {
    const logTag = '[completeTask]'

    await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.complete.json`,
      body: { taskId },
    })

    return { success: true, id: taskId }
  }

  /**
   * @operationName Delete Task
   * @category Tasks
   * @description Permanently deletes a task by ID (tasks.task.delete), including its checklist and comments. This cannot be undone.
   * @route DELETE /task
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Number","label":"Task ID","name":"taskId","required":true,"description":"ID of the task to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true,"id":612}
   */
  async deleteTask(taskId) {
    const logTag = '[deleteTask]'

    await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/tasks.task.delete.json`,
      body: { taskId },
    })

    return { success: true, id: taskId }
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------

  /**
   * @operationName List Users
   * @category Users
   * @description Retrieves a page of portal users (user.get). By default only active users are returned; turn off Active Only to include dismissed and invited users. Returns up to 50 users per page; pass the returned next value as Start Offset for the following page.
   * @route GET /users
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"Boolean","label":"Active Only","name":"activeOnly","uiComponent":{"type":"TOGGLE"},"defaultValue":true,"description":"When on (default), only active users are returned. Turn off to include inactive users."}
   * @paramDef {"type":"Object","label":"Filter","name":"filter","description":"Raw user filter object with UPPERCASE field names, e.g. WORK_POSITION, UF_DEPARTMENT, or EMAIL. Merged over the Active Only convenience filter."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"1","ACTIVE":true,"NAME":"John","LAST_NAME":"Doe","EMAIL":"john.doe@example.com","WORK_POSITION":"CEO","UF_DEPARTMENT":[1],"IS_ONLINE":"Y"}],"total":1,"next":null}
   */
  async listUsers(activeOnly, filter, start) {
    const logTag = '[listUsers]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/user.get.json`,
      body: clean({
        FILTER: clean({
          ACTIVE: activeOnly === false ? undefined : true,
          ...(filter || {}),
        }),
        start,
      }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  /**
   * @operationName Get Current User
   * @category Users
   * @description Returns the profile of the user who created the inbound webhook (profile method), including their ID, name, admin flag, and time zone. All webhook API calls are executed with this user's permissions.
   * @route GET /profile
   * @appearanceColor #006DFF #38AFFF
   *
   * @returns {Object}
   * @sampleResult {"ID":"1","ADMIN":true,"NAME":"John","LAST_NAME":"Doe","PERSONAL_GENDER":"","TIME_ZONE":"Europe/Berlin","TIME_ZONE_OFFSET":7200}
   */
  async getCurrentUser() {
    const logTag = '[getCurrentUser]'

    const { result } = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/profile.json`,
    })

    return result
  }

  /**
   * @operationName Search Users
   * @category Users
   * @description Searches portal users by a free-text query (user.search with FIND) matching name, last name, email, position, and department. Returns up to 50 users per page; pass the returned next value as Start Offset for the following page.
   * @route GET /user-search
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"Query","name":"query","required":true,"description":"Free-text search string matched against user names, email, and position."}
   * @paramDef {"type":"Number","label":"Start Offset","name":"start","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Pagination offset in items (multiples of 50). Use the next value returned by the previous page."}
   *
   * @returns {Object}
   * @sampleResult {"items":[{"ID":"7","ACTIVE":true,"NAME":"Jane","LAST_NAME":"Smith","EMAIL":"jane.smith@example.com","WORK_POSITION":"Sales Manager"}],"total":1,"next":null}
   */
  async searchUsers(query, start) {
    const logTag = '[searchUsers]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/user.search.json`,
      body: clean({ FIND: query, start }),
    })

    return { items: response.result || [], total: response.total, next: response.next ?? null }
  }

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------

  /**
   * @operationName Send Notification
   * @category Messaging
   * @description Sends a system notification to a portal user's Bitrix24 notification center (im.notify.system.add, falling back to im.notify on portals where the newer method is unavailable). Requires the im permission scope on the inbound webhook. Notification text supports BB-code formatting.
   * @route POST /notification
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"User","name":"userId","required":true,"dictionary":"getUsersDictionary","description":"Portal user to notify."}
   * @paramDef {"type":"String","label":"Message","name":"message","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Notification text. Supports BB-code formatting such as [b]bold[/b] and [url]links[/url]."}
   *
   * @returns {Object}
   * @sampleResult {"notificationId":8642}
   */
  async sendNotification(userId, message) {
    const logTag = '[sendNotification]'

    try {
      const { result } = await this.#apiRequest({
        logTag,
        url: `${ this.webhookUrl }/im.notify.system.add.json`,
        body: { USER_ID: userId, MESSAGE: message },
      })

      return { notificationId: result }
    } catch (error) {
      if (error.code !== 'ERROR_METHOD_NOT_FOUND' && error.code !== 'METHOD_NOT_FOUND') {
        throw error
      }

      logger.warn(`${ logTag } - im.notify.system.add unavailable, falling back to im.notify`)

      const { result } = await this.#apiRequest({
        logTag,
        url: `${ this.webhookUrl }/im.notify.json`,
        body: { to: userId, message, type: 'SYSTEM' },
      })

      return { notificationId: result }
    }
  }

  // ---------------------------------------------------------------------------
  // Advanced
  // ---------------------------------------------------------------------------

  /**
   * @operationName Call REST Method
   * @category Advanced
   * @description Calls any of the 600+ Bitrix24 REST API methods not covered by the dedicated actions, e.g. crm.product.list, crm.quote.add, department.get, or disk.folder.getchildren. Provide the REST method name and its parameters exactly as documented at apidocs.bitrix24.com; the webhook must have the permission scope required by that method. Returns the raw Bitrix24 response envelope including result and, for list methods, total and next pagination values.
   * @route POST /call-method
   * @appearanceColor #006DFF #38AFFF
   *
   * @paramDef {"type":"String","label":"REST Method","name":"method","required":true,"description":"Bitrix24 REST method name, e.g. crm.product.list or department.get."}
   * @paramDef {"type":"Object","label":"Parameters","name":"params","description":"Parameters object passed to the method as documented by Bitrix24, e.g. an object with filter, order, select, and start keys for list methods."}
   *
   * @returns {Object}
   * @sampleResult {"result":[{"ID":"5","NAME":"Pro plan subscription","PRICE":"99.00","CURRENCY_ID":"USD"}],"total":1,"time":{"start":1752830000.5,"finish":1752830000.7,"duration":0.2}}
   */
  async callRestMethod(method, params) {
    const logTag = '[callRestMethod]'

    const restMethod = String(method || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.json$/i, '')

    if (!restMethod) {
      throw new Error('Bitrix24 API error: REST method name is required')
    }

    return await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/${ restMethod }.json`,
      body: params || {},
    })
  }

  // ---------------------------------------------------------------------------
  // Dictionaries
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} ActivityCommunication
   * @paramDef {"type":"String","label":"Value","name":"VALUE","required":true,"description":"Communication value, e.g. a phone number for calls or an email address for emails."}
   * @paramDef {"type":"Number","label":"Entity ID","name":"ENTITY_ID","description":"ID of the CRM record this communication belongs to, e.g. the contact ID."}
   * @paramDef {"type":"Number","label":"Entity Type ID","name":"ENTITY_TYPE_ID","description":"CRM record type ID the communication belongs to: 1 lead, 2 deal, 3 contact, 4 company."}
   */

  /**
   * @typedef {Object} getUsersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Free-text search matched against user names, email, and position via user.search."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Users Dictionary
   * @description Provides a searchable list of active portal users for selecting responsible and assigned users. Option values are user IDs.
   * @route POST /get-users-dictionary
   * @paramDef {"type":"getUsersDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"John Doe","value":"1","note":"CEO"}],"cursor":null}
   */
  async getUsersDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getUsersDictionary]'

    const start = cursor ? Number(cursor) : undefined

    const response = search
      ? await this.#apiRequest({
        logTag,
        url: `${ this.webhookUrl }/user.search.json`,
        body: clean({ FIND: search, ACTIVE: true, start }),
      })
      : await this.#apiRequest({
        logTag,
        url: `${ this.webhookUrl }/user.get.json`,
        body: clean({ FILTER: { ACTIVE: true }, start }),
      })

    const users = response.result || []

    return {
      items: users.map(user => ({
        label: [user.NAME, user.LAST_NAME].filter(Boolean).join(' ') || user.EMAIL || `User ${ user.ID }`,
        value: String(user.ID),
        note: user.WORK_POSITION || user.EMAIL || undefined,
      })),
      cursor: response.next !== undefined && response.next !== null ? String(response.next) : null,
    }
  }

  /**
   * @typedef {Object} getLeadStatusesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter statuses by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Lead Statuses Dictionary
   * @description Provides the portal's lead statuses (crm.status.list with ENTITY_ID STATUS) for selecting a lead status. Option values are STATUS_ID codes such as NEW or IN_PROCESS.
   * @route POST /get-lead-statuses-dictionary
   * @paramDef {"type":"getLeadStatusesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Unsorted","value":"NEW","note":"ID: NEW"}],"cursor":null}
   */
  async getLeadStatusesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getLeadStatusesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.status.list.json`,
      body: clean({
        filter: { ENTITY_ID: 'STATUS' },
        order: { SORT: 'ASC' },
        start: cursor ? Number(cursor) : undefined,
      }),
    })

    const statuses = (response.result || []).filter(status =>
      !search || String(status.NAME || '').toLowerCase().includes(search.toLowerCase())
    )

    return {
      items: statuses.map(status => ({
        label: status.NAME,
        value: status.STATUS_ID,
        note: `ID: ${ status.STATUS_ID }`,
      })),
      cursor: response.next !== undefined && response.next !== null ? String(response.next) : null,
    }
  }

  /**
   * @typedef {Object} getDealStagesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Pipeline","name":"categoryId","description":"Pipeline (deal category) whose stages to list. Leave empty or 0 for the default pipeline."}
   */

  /**
   * @typedef {Object} getDealStagesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter stages by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by the previous page."}
   * @paramDef {"type":"getDealStagesDictionary__payloadCriteria","label":"Criteria","name":"criteria","description":"Optional pipeline selection for stage lookup."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Deal Stages Dictionary
   * @description Provides the deal stages of a pipeline (crm.status.list with ENTITY_ID DEAL_STAGE or DEAL_STAGE_N) for selecting a deal stage. Option values are STAGE_ID codes such as NEW, NEGOTIATION, or WON.
   * @route POST /get-deal-stages-dictionary
   * @paramDef {"type":"getDealStagesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string, pagination cursor, and pipeline criteria."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Negotiation","value":"NEGOTIATION","note":"ID: NEGOTIATION"}],"cursor":null}
   */
  async getDealStagesDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const logTag = '[getDealStagesDictionary]'

    const categoryId = criteria?.categoryId
    const entityId = categoryId && String(categoryId) !== '0' ? `DEAL_STAGE_${ categoryId }` : 'DEAL_STAGE'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.status.list.json`,
      body: clean({
        filter: { ENTITY_ID: entityId },
        order: { SORT: 'ASC' },
        start: cursor ? Number(cursor) : undefined,
      }),
    })

    const stages = (response.result || []).filter(stage =>
      !search || String(stage.NAME || '').toLowerCase().includes(search.toLowerCase())
    )

    return {
      items: stages.map(stage => ({
        label: stage.NAME,
        value: stage.STATUS_ID,
        note: `ID: ${ stage.STATUS_ID }`,
      })),
      cursor: response.next !== undefined && response.next !== null ? String(response.next) : null,
    }
  }

  /**
   * @typedef {Object} getDealCategoriesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional text to filter pipelines by name. Filtering is performed locally on retrieved results."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset returned by the previous page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Deal Categories Dictionary
   * @description Provides the portal's deal pipelines (crm.category.list with entityTypeId 2) for selecting a pipeline. Option values are numeric CATEGORY_ID values; the default pipeline has ID 0.
   * @route POST /get-deal-categories-dictionary
   * @paramDef {"type":"getDealCategoriesDictionary__payload","label":"Payload","name":"payload","description":"Contains the optional search string and pagination cursor."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"General","value":"0","note":"Default pipeline"}],"cursor":null}
   */
  async getDealCategoriesDictionary(payload) {
    const { search, cursor } = payload || {}
    const logTag = '[getDealCategoriesDictionary]'

    const response = await this.#apiRequest({
      logTag,
      url: `${ this.webhookUrl }/crm.category.list.json`,
      body: clean({
        entityTypeId: DEAL_ENTITY_TYPE_ID,
        start: cursor ? Number(cursor) : undefined,
      }),
    })

    const categories = (response.result?.categories || []).filter(category =>
      !search || String(category.name || '').toLowerCase().includes(search.toLowerCase())
    )

    return {
      items: categories.map(category => ({
        label: category.name,
        value: String(category.id),
        note: category.isDefault === 'Y' ? 'Default pipeline' : `ID: ${ category.id }`,
      })),
      cursor: response.next !== undefined && response.next !== null ? String(response.next) : null,
    }
  }
}

Flowrunner.ServerCode.addService(Bitrix24Service, [
  {
    name: 'webhookUrl',
    displayName: 'Inbound Webhook URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: false,
    hint: 'Bitrix24 > Developer resources > Other > Inbound webhook. Looks like https://yourcompany.bitrix24.com/rest/1/abc123token/. Grant the crm, task, user and im permission scopes when creating it.',
  },
])
