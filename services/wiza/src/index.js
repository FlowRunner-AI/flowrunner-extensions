const API_BASE_URL = 'https://wiza.co/api'

const logger = {
  info: (...args) => console.log('[Wiza Service] info:', ...args),
  debug: (...args) => console.log('[Wiza Service] debug:', ...args),
  error: (...args) => console.log('[Wiza Service] error:', ...args),
  warn: (...args) => console.log('[Wiza Service] warn:', ...args),
}

const FUNDING_DATE_MAP = {
  'Past Month': 'past_month',
  'Past 3 Months': 'past_3_months',
  'Past 6 Months': 'past_6_months',
  'Past Year': 'past_year',
}

const FUNDING_TYPE_MAP = {
  Equity: 'equity',
  Grant: 'grant',
  Debt: 'debt',
  'Convertible Note': 'convertible_note',
  'Non-Equity Assistance': 'non_equity_assistance',
  Product: 'product',
  'Private Equity': 'private_equity',
  'Post-IPO Equity': 'post_ipo_equity',
  'Post-IPO Debt': 'post_ipo_debt',
  Undisclosed: 'undisclosed',
}

const FUNDING_STAGE_MAP = {
  'Pre-Seed': 'pre_seed',
  Seed: 'seed',
  'Series A': 'series_a',
  'Series B': 'series_b',
  'Series C': 'series_c',
  'Series D': 'series_d',
  'Series E+': 'series_e+',
  Unknown: 'unknown',
}

/**
 *  @integrationName Wiza
 *  @integrationIcon /icon.jpeg
 **/

class Wiza {
  constructor(config) {
    this.apiKey = config.apiKey
  }

  /**
   * @typedef {Object} Contact
   *
   * @paramDef {"type":"String","label":"Full Name","name":"full_name","required":false}
   * @paramDef {"type":"String","label":"Company","name":"company","required":false}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":false}
   * @paramDef {"type":"String","label":"LinkedIn Profile URL","name":"profile_url","required":false}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false}
   */

  /**
   * @description Creates targeted prospect lists in Wiza for AI agents to organize leads, build contact databases, or prepare for automated outreach campaigns. Perfect for systematic lead generation, contact enrichment workflows, or building segmented prospect databases.
   *
   * @route POST /createList
   * @operationName Create Wiza List
   * @category List Management
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"List Name","name":"name","required":true,"description":"Name for the prospect list. Examples: 'Q1 Sales Prospects', 'Enterprise CTOs', 'SaaS Marketing Leads'. Use descriptive names for easy identification."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callbackUrl","required":false,"description":"Webhook URL for completion notification. Examples: 'https://api.myapp.com/wiza-webhook', 'https://hooks.zapier.com/hooks/catch/123/abc'. Leave blank if not needed."}
   * @paramDef {"type":"Array<Contact>","label":"Contacts","name":"contacts","required":false,"description":"Initial contacts to add to the list. Provide LinkedIn URLs, emails, or name+company+domain combinations. Examples: [{'profile_url': 'linkedin.com/in/johndoe'}, {'email': 'jane@company.com'}]."}
   *
   * @sampleResult {"id":"list_9e649792-ff27-4cf0-9e38-dab1f9a604f1","name":"My Prospect List"}
   */
  async createList(name, callbackUrl, contacts = []) {
    const payload = { name }

    if (callbackUrl) {
      payload.callback_url = callbackUrl
    }

    if (contacts && contacts.length > 0) {
      payload.items = contacts.map((item, index) => {
        if (item.profile_url) {
          return { profile_url: item.profile_url }
        } else if (item.email) {
          return { email: item.email }
        } else if (item.full_name && item.company && item.domain) {
          return {
            full_name: item.full_name,
            company: item.company,
            domain: item.domain,
          }
        } else {
          throw new Error(
            `Contact at index ${ index } is invalid. Must include either profile_url, email, or (full_name, company, domain).`
          )
        }
      })
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/lists`,
      method: 'post',
      body: payload,
      headers: {
        'Content-Type': 'application/json',
      },
      logTag: '[createList]',
    })

    return response
  }

  /**
   * @description Retrieves a specific list from your Wiza account by its ID, including stats, email options, and enrichment metadata.
   *
   * @route GET /getList
   * @operationName Get List
   * @category List Management
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 30
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"The ID of the list you want to retrieve from Wiza.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   *
   * @sampleResult {"status":{"code":200,"message":""},"type":"list","data":{"id":15,"name":"VP of Sales in San Francisco","status":"queued","stats":{"people":2,"credits":{"email_credits":1,"phone_credits":1,"export_credits":1,"api_credits":{"email_credits":2,"phone_credits":5,"scrape_credits":1,"total":8}}},"finished_at":"2019-08-24T14:15:22Z","created_at":"2019-08-24T14:15:22Z","enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":true,"accept_generic":true},"report_type":"people"}}
   */
  async getList(listId) {
    if (!listId || typeof listId !== 'string') {
      throw new Error('The "listId" parameter is required and must be a string.')
    }

    const url = `${ API_BASE_URL }/lists/${ listId }`

    const response = await this.#apiRequest({
      url,
      method: 'get',
      logTag: '[getList]',
    })

    return response
  }

  /**
   * @description Retrieves contacts from a specific Wiza list, filtered by segment (people, valid, or risky).
   *
   * @route GET /getListContacts
   * @operationName Get List Contacts
   * @category List Management
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"List ID","name":"listId","required":true,"description":"The ID of the list whose contacts you want to retrieve.","uiComponent":{"type":"SINGLE_LINE_TEXT"}}
   * @paramDef {"type":"String","label":"Segment","name":"segment","required":true,"description":"Filter the contact segment to retrieve. Use 'people' for all, 'valid' for only valid, and 'risky' for only risky contacts.","uiComponent":{"type":"DROPDOWN","options":{"values":["people","valid","risky"]}}}
   *
   * @sampleResult {"status":{"code":200,"message":""},"type":"contacts","data":[{"first_name":"Anna","last_name":"Smith","email":"anna@example.com","title":"Marketing Manager","company":"Acme Inc."}]}
   */
  async getListContacts(listId, segment) {
    if (!listId || typeof listId !== 'string') {
      throw new Error('The "listId" parameter is required and must be a string.')
    }

    if (!['people', 'valid', 'risky'].includes(segment)) {
      throw new Error('The "segment" must be one of: people, valid, risky.')
    }

    const url = `${ API_BASE_URL }/lists/${ listId }/contacts`
    const query = { segment }

    const response = await this.#apiRequest({
      url,
      method: 'get',
      query,
      logTag: '[getListContacts]',
    })

    return response
  }

  /**
   * @typedef {Object} IndividualReveal
   *
   * @paramDef {"type":"String","label":"Full Name","name":"full_name","required":false}
   * @paramDef {"type":"String","label":"Company","name":"company","required":false}
   * @paramDef {"type":"String","label":"Domain","name":"domain","required":false}
   * @paramDef {"type":"String","label":"LinkedIn Profile URL","name":"profile_url","required":false}
   * @paramDef {"type":"String","label":"Email","name":"email","required":false}
   */

  /**
   * @description Enriches individual contact information for AI agents to gather detailed prospect data, verify contact details, or enhance lead profiles with email, phone, and company information. Essential for personalized outreach and lead qualification workflows.
   *
   * @route POST /startIndividualReveal
   * @operationName Start Individual Reveal
   * @category Contact Enrichment
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"IndividualReveal","label":"Contact","name":"individual","required":true,"description":"The contact to enrich. Provide either a LinkedIn profile URL, an email address, or a combination of full name, company, and domain."}
   * @paramDef {"type":"String","label":"Enrichment Level","name":"enrichment_level","required":true,"description":"Controls how much data Wiza should enrich.","uiComponent":{"type":"DROPDOWN","options":{"values":["none","partial","phone","full"]}}}
   * @paramDef {"type":"Boolean","label":"Accept Work Emails","name":"accept_work","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether to accept work email addresses."}
   * @paramDef {"type":"Boolean","label":"Accept Personal Emails","name":"accept_personal","required":false,"uiComponent":{"type":"TOGGLE"},"description":"Whether to accept personal email addresses."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callback_url","required":false,"description":"Optional webhook where results will be delivered when enrichment completes."}
   *
   * @sampleResult {"status":{"code":200,"message":"🧙 Wiza is working on it!"},"type":"individual_reveal","data":{"id":32,"status":"queued","is_complete":false}}
   */
  async startIndividualReveal(individual, enrichment_level, accept_work, accept_personal, callback_url) {
    const logTag = '[startIndividualReveal]'

    if (!individual || typeof individual !== 'object') {
      throw new Error('The "individual" parameter must be provided and must be an object.')
    }

    const payload = {
      enrichment_level,
      individual_reveal: null,
    }

    if (individual.profile_url) {
      payload.individual_reveal = { profile_url: individual.profile_url }
    } else if (individual.email) {
      payload.individual_reveal = { email: individual.email }
    } else if (individual.full_name && individual.company && individual.domain) {
      payload.individual_reveal = {
        full_name: individual.full_name,
        company: individual.company,
        domain: individual.domain,
      }
    } else {
      throw new Error(
        'Invalid contact format. Provide either a profile_url, an email, or (full_name + company + domain).'
      )
    }

    if (accept_work !== undefined || accept_personal !== undefined) {
      payload.email_options = {}
      if (typeof accept_work === 'boolean') payload.email_options.accept_work = accept_work
      if (typeof accept_personal === 'boolean') payload.email_options.accept_personal = accept_personal
    }

    if (callback_url) {
      payload.callback_url = callback_url
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/individual_reveals`,
      method: 'post',
      body: payload,
      logTag,
    })

    return response
  }

  /**
   * @description Retrieves the result of a previously started individual reveal request in Wiza by its ID.
   *
   * @route GET /getIndividualReveal
   * @operationName Get Individual Reveal
   * @category Contact Enrichment
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"Reveal ID","name":"revealId","required":true,"description":"The unique ID of the individual reveal operation started previously."}
   *
   * @sampleResult {"status":{"code":200,"message":""},"type":"individual_reveal","data":{"id":32,"status":"queued","is_complete":false,"name":"Stephen Hakami","company":"Wiza","enrichment_level":"partial","linkedin_profile_url":"https://www.linkedin.com/in/stephen-hakami-5babb21b0/","title":"Founder, Chief Executive Officer","location":"Toronto, Ontario, Canada","email":"stephen@wiza.co","email_type":"work","email_status":"valid","emails":[{"email":"stephen@wiza.co","email_type":"work","email_status":"valid"}],"mobile_phone":"+11234567890","phone_number":"+11234567890","phone_status":"found","phones":[{"number":"+11234567890","pretty_number":"+1 (123) 456-7890","type":"mobile"}],"company_size":21,"company_type":"Private","company_domain":"wiza.co","company_locality":"Toronto","company_region":"Ontario","company_country":"Canada","company_street":"1234 Street","company_founded":2017,"company_funding":1000000,"company_revenue":1000000,"company_industry":"Software Development","company_linkedin":"https://www.linkedin.com/company/wizainc/","company_location":"Toronto, Ontario, Canada","company_size_range":"11-50","company_description":"Wiza is a data enrichment tool that helps you find email addresses and phone numbers of your ideal customers.","company_postal_code":"M5V 2A1","company_subindustry":"Data Enrichment","credits":{"email_credits":1,"phone_credits":1,"export_credits":0,"api_credits":{"total":8,"email_credits":2,"phone_credits":5,"scrape_credits":1}}}}
   */
  async getIndividualReveal(revealId) {
    if (!revealId || typeof revealId !== 'string') {
      throw new Error('The "revealId" parameter is required and must be a string.')
    }

    const url = `${ API_BASE_URL }/individual_reveals/${ revealId }`

    const response = await this.#apiRequest({
      url,
      method: 'get',
      logTag: '[getIndividualReveal]',
    })

    return response
  }

  /**
   * @description Finds targeted prospects for AI agents to identify potential leads, research market segments, or build custom prospect lists based on specific criteria. Perfect for AI-driven lead generation, market research, and automated prospecting workflows.
   *
   * @route POST /searchProspects
   * @operationName Prospect Search
   * @category Lead Search
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"Array<String>","label":"Job Titles","name":"job_title","description":"Target job titles to search for. Examples: ['CEO', 'Marketing Manager', 'Sales Director']. Use quotes for exact matches: ['\"VP Sales\"']. Multiple titles use OR logic."}
   * @paramDef {"type":"Array<String>","label":"Locations (Cities)","name":"location","description":"City names to include in the search (e.g. 'New York', 'San Francisco')."}
   * @paramDef {"type":"Array<String>","label":"Job Title Level","name":"job_title_level","uiComponent":{"type":"DROPDOWN","options":{"values":["CXO","Director","Entry","Manager","Owner","Partner","Senior","Training","Unpaid","VP"]}}}
   * @paramDef {"type":"Array<String>","label":"Job Role","name":"job_role","uiComponent":{"type":"DROPDOWN","options":{"values":["customer_service","design","education","engineering","finance","health","human_resources","legal","marketing","media","operations","public_relations","real_estate","sales","trades"]}}}
   * @paramDef {"type":"Array<String>","label":"Job Sub-Role","name":"job_sub_role","uiComponent":{"type":"DROPDOWN","options":{"values":["accounting","accounts","brand_marketing","broadcasting","business_development","compensation","content_marketing","customer_success","data","dental","devops","doctor","editorial","education_administration","electrical","employee_development","events","fitness","graphic_design","information_technology","instructor","investment","journalism","judicial","lawyer","logistics","marketing_communications","mechanical","media_relations","network","nursing","office_management","paralegal","pipeline","product","product_design","product_marketing","professor","project_engineering","project_management","property_management","quality_assurance","realtor","recruiting","researcher","security","software","support","systems","tax","teacher","therapy","video","web","web_design","wellness","writing"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Size","name":"company_size","uiComponent":{"type":"DROPDOWN","options":{"values":["1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10001+"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Industry","name":"company_industry","uiComponent":{"type":"DROPDOWN","options":{"values":["accounting","advertising","aerospace","agriculture","automotive","banking","biotechnology","chemicals","construction","consulting","consumer_goods","design","education","electronics","energy","entertainment","environmental","finance","food_beverage","gaming","government","healthcare","hospitality","human_resources","information_technology","insurance","internet","legal","logistics","manufacturing","marketing","media","mining","non_profit","pharmaceuticals","public_relations","real_estate","recruiting","research","retail","security","sports","telecommunications","transportation","travel","utilities","venture_capital","wholesale"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Type","name":"company_type","uiComponent":{"type":"DROPDOWN","options":{"values":["private","public","nonprofit","educational","government"]}}}
   * @paramDef {"type":"Array<String>","label":"Revenue","name":"revenue","uiComponent":{"type":"DROPDOWN","options":{"values":["<$1M","$1M-$10M","$10M-$50M","$50M-$100M","$100M-$500M","$500M-$1B",">$1B"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Annual Growth","name":"company_annual_growth","uiComponent":{"type":"DROPDOWN","options":{"values":["0-5%","5-10%","10-20%","20-50%","50-100%","100%+"]}}}
   * @paramDef {"type":"Array<String>","label":"Department Size","name":"department_size","description":"Department Headcount, the format is {department_name}:{min_headcount}-{max_headcount} e.g. 'sales:10-50'. For less than or greater than, use min_headcount- or -max_headcount e.g. 'sales:10-' or 'sales:-50'"}
   * @paramDef {"type":"String","label":"Company Summary Keywords","name":"company_summary","description":"Comma-separated list of keywords to match in the company’s summary (e.g. 'sales, AI, B2B')."}
   * @paramDef {"type":"Array<String>","label":"Funding Stage","name":"funding_stage","uiComponent":{"type":"DROPDOWN","options":{"values":["Pre-Seed","Seed","Series A","Series B","Series C","Series D","Series E+","Unknown"]}}}
   * @paramDef {"type":"Array<String>","label":"Funding Type","name":"funding_type","uiComponent":{"type":"DROPDOWN","options":{"values":["Equity","Grant","Debt","Convertible Note","Non-Equity Assistance","Product","Private Equity","Post-IPO Equity","Post-IPO Debt","Undisclosed"]}}}
   * @paramDef {"type":"String","label":"Funding Date","name":"funding_date","uiComponent":{"type":"DROPDOWN","options":{"values":["Past Month","Past 3 Months","Past 6 Months","Past Year"]}},"description":"How recently the company raised funding."}
   * @paramDef {"type":"String","label":"Founded Year Start","name":"year_founded_start", "uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type":"String","label":"Founded Year End","name":"year_founded_end", "uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type":"Number","label":"Size (Results Limit)","name":"size","description":"Number of profiles to return. Max: 30, default: 10."}
   *
   * @sampleResult {"status":{"code":200,"message":""},"data":{"total":15,"profiles":[{"full_name":"Stephen Hakami","linkedin_url":"linkedin.com/in/stephen-hakami-5babb21b0","industry":"Computer Software","job_title":"Founder, Chief Executive Officer","job_title_role":null,"job_title_sub_role":null,"job_company_name":"Wiza","job_company_website":"wiza.co","location_name":"Toronto, Ontario, Canada"}]}}
   */
  async searchProspects(
    job_title,
    location,
    job_title_level,
    job_role,
    job_sub_role,
    company_size,
    company_industry,
    company_type,
    revenue,
    company_annual_growth,
    department_size,
    company_summary,
    funding_stage,
    funding_type,
    funding_date,
    year_founded_start,
    year_founded_end,
    size
  ) {
    const filters = {}

    if (job_title) {
      filters.job_title = job_title.map(v => ({ v, s: 'i' }))
    }

    if (location) {
      filters.location = location.map(v => ({ v, b: 'city', s: 'i' }))
    }

    if (job_title_level) filters.job_title_level = job_title_level
    if (job_role) filters.job_role = job_role
    if (job_sub_role) filters.job_sub_role = job_sub_role
    if (company_size) filters.company_size = company_size
    if (company_industry) filters.company_industry = company_industry
    if (company_type) filters.company_type = company_type
    if (revenue) filters.revenue = revenue
    if (company_annual_growth) filters.company_annual_growth = company_annual_growth
    if (department_size) filters.department_size = department_size

    if (company_summary) {
      const keywords = company_summary
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)

      filters.company_summary = keywords.map(v => ({ v, s: 'i' }))
    }

    if (funding_date) {
      filters.funding_date = { t: 'last', v: FUNDING_DATE_MAP[funding_date] }
    }

    if (funding_type) {
      filters.funding_type = {
        t: 'last',
        v: funding_type.map(type => FUNDING_TYPE_MAP[type]),
      }
    }

    if (funding_stage) {
      filters.funding_stage = {
        t: 'last',
        v: funding_stage.map(stage => FUNDING_STAGE_MAP[stage]),
      }
    }

    if (year_founded_start) filters.year_founded_start = year_founded_start
    if (year_founded_end) filters.year_founded_end = year_founded_end

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/prospects/search`,
      method: 'post',
      body: {
        filters,
        size: size ?? 10,
      },
      logTag: '[searchProspects]',
    })

    return response
  }

  /**
   * @description Creates a new prospect list in Wiza using filter criteria and email preferences.
   *
   * @route POST /createProspectList
   * @operationName Create Prospect List
   * @category List Management
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 120
   *
   * @paramDef {"type":"String","label":"List Name","name":"name","required":true,"description":"Name for the new prospect list."}
   * @paramDef {"type":"Number","label":"Max Profiles","name":"max_profiles","required":true,"description":"Maximum number of profiles to include in the list."}
   * @paramDef {"type":"String","label":"Enrichment Level","name":"enrichment_level","required":true,"uiComponent":{"type":"DROPDOWN","options":{"values":["none","partial","full"]}}}
   * @paramDef {"type":"Boolean","label":"Accept Work Email","name":"accept_work","required":true,"uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Accept Personal Email","name":"accept_personal","required":true,"uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Accept Generic Email","name":"accept_generic","required":true,"uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"Boolean","label":"Skip Duplicates","name":"skip_duplicates","uiComponent":{"type":"TOGGLE"}}
   * @paramDef {"type":"String","label":"Callback URL","name":"callback_url","description":"Optional callback URL for webhook after processing."}
   *
   * @paramDef {"type":"Array<String>","label":"Job Titles","name":"job_title","description":"Comma-separated titles included in search. All entries will be treated with inclusion logic."}
   * @paramDef {"type":"Array<String>","label":"Locations (Cities)","name":"location"}
   * @paramDef {"type":"Array<String>","label":"Job Title Level","name":"job_title_level","uiComponent":{"type":"DROPDOWN","options":{"values":["CXO","Director","Entry","Manager","Owner","Partner","Senior","Training","Unpaid","VP"]}}}
   * @paramDef {"type":"Array<String>","label":"Job Role","name":"job_role","uiComponent":{"type":"DROPDOWN","options":{"values":["customer_service","design","education","engineering","finance","health","human_resources","legal","marketing","media","operations","public_relations","real_estate","sales","trades"]}}}
   * @paramDef {"type":"Array<String>","label":"Job Sub-Role","name":"job_sub_role","uiComponent":{"type":"DROPDOWN","options":{"values":["accounting","business_development","content_marketing","customer_success","devops","engineering","it","marketing_communications","product","recruiting","sales","software","support"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Size","name":"company_size","uiComponent":{"type":"DROPDOWN","options":{"values":["1-10","11-50","51-200","201-500","501-1000","1001-5000","5001-10000","10001+"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Industry","name":"company_industry","uiComponent":{"type":"DROPDOWN","options":{"values":["advertising","automotive","biotech","consulting","education","engineering","finance","healthcare","hospitality","insurance","internet","legal","manufacturing","media","real_estate","recruiting","retail","software","telecommunications","transportation"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Type","name":"company_type","uiComponent":{"type":"DROPDOWN","options":{"values":["private","public","nonprofit","educational","government"]}}}
   * @paramDef {"type":"Array<String>","label":"Revenue","name":"revenue","uiComponent":{"type":"DROPDOWN","options":{"values":["<$1M","$1M-$10M","$10M-$50M","$50M-$100M","$100M-$500M","$500M-$1B",">$1B"]}}}
   * @paramDef {"type":"Array<String>","label":"Company Annual Growth","name":"company_annual_growth","uiComponent":{"type":"DROPDOWN","options":{"values":["0-5%","5-10%","10-20%","20-50%","50-100%","100%+"]}}}
   * @paramDef {"type":"Array<String>","label":"Department Size","name":"department_size"}
   * @paramDef {"type":"String","label":"Company Summary Keywords","name":"company_summary","description":"Comma-separated list of keywords to match in the company’s summary (e.g. 'sales, AI, B2B')."}
   * @paramDef {"type":"Array<String>","label":"Funding Stage","name":"funding_stage","uiComponent":{"type":"DROPDOWN","options":{"values":["Pre-Seed","Seed","Series A","Series B","Series C","Series D","Series E+","Unknown"]}}}
   * @paramDef {"type":"Array<String>","label":"Funding Type","name":"funding_type","uiComponent":{"type":"DROPDOWN","options":{"values":["Equity","Grant","Debt","Convertible Note","Non-Equity Assistance","Product","Private Equity","Post-IPO Equity","Post-IPO Debt","Undisclosed"]}}}
   * @paramDef {"type":"String","label":"Funding Date","name":"funding_date","uiComponent":{"type":"DROPDOWN","options":{"values":["Past Month","Past 3 Months","Past 6 Months","Past Year"]}}}
   * @paramDef {"type":"String","label":"Founded Year Start","name":"year_founded_start","uiComponent":{"type":"DATE_PICKER"}}
   * @paramDef {"type":"String","label":"Founded Year End","name":"year_founded_end","uiComponent":{"type":"DATE_PICKER"}}
   *
   * @sampleResult {"status":{"code":200,"message":"🧙 Wiza is working on it!"},"type":"list","data":{"id":15,"name":"VP of Sales in San Francisco","status":"queued","stats":{"people":2,"credits":{"email_credits":1,"phone_credits":1,"export_credits":1,"api_credits":{"email_credits":2,"phone_credits":5,"scrape_credits":1,"total":8}}},"finished_at":"2019-08-24T14:15:22Z","created_at":"2019-08-24T14:15:22Z","enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":true,"accept_generic":true},"report_type":"people"}}
   */
  async createProspectList(
    name,
    max_profiles,
    enrichment_level,
    accept_work,
    accept_personal,
    accept_generic,
    skip_duplicates,
    callback_url,
    job_title,
    location,
    job_title_level,
    job_role,
    job_sub_role,
    company_size,
    company_industry,
    company_type,
    revenue,
    company_annual_growth,
    department_size,
    company_summary,
    funding_stage,
    funding_type,
    funding_date,
    year_founded_start,
    year_founded_end
  ) {
    const filters = {}
    if (job_title) filters.job_title = job_title.map(v => ({ v, s: 'i' }))
    if (location) filters.location = location.map(v => ({ v, b: 'city', s: 'i' }))
    if (job_title_level) filters.job_title_level = job_title_level
    if (job_role) filters.job_role = job_role
    if (job_sub_role) filters.job_sub_role = job_sub_role
    if (company_size) filters.company_size = company_size
    if (company_industry) filters.company_industry = company_industry
    if (company_type) filters.company_type = company_type
    if (revenue) filters.revenue = revenue
    if (company_annual_growth) filters.company_annual_growth = company_annual_growth
    if (department_size) filters.department_size = department_size

    if (company_summary) {
      filters.company_summary = company_summary
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(v => ({ v, s: 'i' }))
    }

    if (funding_stage) filters.funding_stage = { t: 'last', v: funding_stage.map(s => FUNDING_STAGE_MAP[s]) }
    if (funding_type) filters.funding_type = { t: 'last', v: funding_type.map(t => FUNDING_TYPE_MAP[t]) }
    if (funding_date) filters.funding_date = { t: 'last', v: FUNDING_DATE_MAP[funding_date] }
    if (year_founded_start) filters.year_founded_start = year_founded_start
    if (year_founded_end) filters.year_founded_end = year_founded_end

    const list = {
      name,
      max_profiles,
      enrichment_level,
      email_options: {
        accept_work,
        accept_personal,
        accept_generic,
      },
      skip_duplicates,
      callback_url,
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/prospects/create_prospect_list`,
      method: 'post',
      body: { filters, list },
      logTag: '[createProspectList]',
    })

    return response
  }

  /**
   * @description Continues a previously created prospect list search by providing the list ID and optional overrides.
   *
   * @route POST /continueProspectSearch
   * @operationName Continue Prospect Search
   * @category Lead Search
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 60
   *
   * @paramDef {"type":"Number","label":"List ID","name":"id","required":true,"description":"The ID of the list to continue prospect search on."}
   * @paramDef {"type":"Number","label":"Max Profiles","name":"max_profiles","description":"Optional override for the maximum number of profiles to retrieve."}
   * @paramDef {"type":"String","label":"Callback URL","name":"callback_url","description":"Optional override for the webhook URL to be notified when processing is complete."}
   *
   * @sampleResult {"status":{"code":200,"message":"🧙 Wiza is working on it!"},"type":"list","data":{"id":15,"name":"VP of Sales in San Francisco","status":"queued","stats":{"people":2,"credits":{"email_credits":1,"phone_credits":1,"export_credits":1,"api_credits":{"email_credits":2,"phone_credits":5,"scrape_credits":1,"total":8}}},"finished_at":"2019-08-24T14:15:22Z","created_at":"2019-08-24T14:15:22Z","enrichment_level":"partial","email_options":{"accept_work":true,"accept_personal":true,"accept_generic":true},"report_type":"people"}}
   */
  async continueProspectSearch(id, max_profiles, callback_url) {
    const body = { id }

    if (max_profiles !== undefined) {
      body.max_profiles = max_profiles
    }

    if (callback_url) {
      body.callback_url = callback_url
    }

    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/prospects/continue_search`,
      method: 'post',
      body,
      logTag: '[continueProspectSearch]',
    })

    return response
  }

  /**
   * @description Retrieves the current usage credits from your Wiza account including email, phone, export, and API credits.
   *
   * @route GET /getCredits
   * @operationName Get Credits
   * @category Account Management
   *
   * @appearanceColor #360A9E #8732CA
   *
   * @executionTimeoutInSeconds 30
   *
   * @sampleResult {"credits":{"email_credits":"unlimited","phone_credits":100,"export_credits":0,"api_credits":100}}
   */
  async getCredits() {
    const response = await this.#apiRequest({
      url: `${ API_BASE_URL }/meta/credits`,
      method: 'get',
      logTag: '[getCredits]',
    })

    return response
  }

  async #apiRequest({ url, method, body, query, headers, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)
      logger.debug(`${ logTag } - api request body: [${ JSON.stringify(body) }]`)

      return await Flowrunner.Request[method](url)
        .set(this.#generateBasicAuthHeader())
        .set(headers)
        .query(query)
        .send(body)
    } catch (error) {
      // error = normalizeError(error)
      logger.error(`${ logTag } - api request error: ${ JSON.stringify(error) }`)
      throw error
    }
  }

  #generateBasicAuthHeader() {
    return {
      Authorization: `Bearer ${ this.apiKey }`,
    }
  }
}

Flowrunner.ServerCode.addService(Wiza, [
  {
    displayName: 'API Key',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    name: 'apiKey',
    hint: 'Your Wiza account API key.',
  },
])
