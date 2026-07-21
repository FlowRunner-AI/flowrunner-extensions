'use strict'

const { createSandbox } = require('../../../service-sandbox')

const USERNAME = 'test-user'
const API_KEY = 'test-api-key'
const AUTH = Buffer.from(`${ USERNAME }:${ API_KEY }`).toString('base64')
const BASE = 'https://rest.clicksend.com/v3'

describe('ClickSend Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ username: USERNAME, apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'username',
          displayName: 'Username',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          displayName: 'API Key',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })

    it('sends Basic auth header and JSON content type on requests', async () => {
      mock.onGet(`${ BASE }/voice/lang`).reply({ data: [] })

      await service.getVoiceLanguagesDictionary()

      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Basic ${ AUTH }`,
        'Content-Type': 'application/json',
      })
    })
  })

  // ── Static Dictionaries ──

  describe('getSenderIDgroupsDictionary', () => {
    it('returns the three static sender ID groups without any HTTP call', () => {
      const result = service.getSenderIDgroupsDictionary()

      expect(mock.history).toHaveLength(0)
      expect(result.items.map(i => i.value)).toEqual([
        'Dedicated Numbers',
        'Alpha Tags',
        'Own numbers',
      ])
    })
  })

  describe('getHttpMethodsDictionary', () => {
    it('returns the five static HTTP methods without any HTTP call', () => {
      const result = service.getHttpMethodsDictionary()

      expect(mock.history).toHaveLength(0)
      expect(result.items.map(i => i.value)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
    })
  })

  // ── Dynamic Dictionaries ──

  describe('getSenderContactsDictionary', () => {
    it('fetches alpha tags for the "Alpha Tags" group', async () => {
      mock.onGet(`${ BASE }/alpha-tags`).reply({
        alpha_tags: [{ alpha_tag: 'MyCompany' }, { alpha_tag: 'OtherTag' }],
      })

      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Alpha Tags' },
      })

      expect(mock.history[0].url).toBe(`${ BASE }/alpha-tags`)
      expect(mock.history[0].query).toMatchObject({ page_size: 50 })
      expect(result.items).toEqual([
        { label: 'MyCompany', note: 'Your Alpha Tag', value: 'MyCompany' },
        { label: 'OtherTag', note: 'Your Alpha Tag', value: 'OtherTag' },
      ])
    })

    it('fetches own numbers for the "Own numbers" group', async () => {
      mock.onGet(`${ BASE }/own-numbers`).reply({
        own_numbers: [{ phone_number: '+14035554422' }],
      })

      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Own numbers' },
      })

      expect(mock.history[0].url).toBe(`${ BASE }/own-numbers`)
      expect(result.items).toEqual([
        { label: '+14035554422', note: 'My phone number', value: '+14035554422' },
      ])
    })

    it('fetches dedicated numbers for the "Dedicated Numbers" group', async () => {
      mock.onGet(`${ BASE }/numbers`).reply({
        data: { data: [{ dedicated_number: '+14035550000' }] },
      })

      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Dedicated Numbers' },
      })

      expect(mock.history[0].url).toBe(`${ BASE }/numbers`)
      expect(result.items).toEqual([
        { label: '+14035550000', note: 'Your Dedicated Number', value: '+14035550000' },
      ])
    })

    it('filters items by search term (case-insensitive)', async () => {
      mock.onGet(`${ BASE }/alpha-tags`).reply({
        alpha_tags: [{ alpha_tag: 'MyCompany' }, { alpha_tag: 'OtherTag' }],
      })

      const result = await service.getSenderContactsDictionary({
        search: 'mycom',
        criteria: { senderIDgroup: 'Alpha Tags' },
      })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('MyCompany')
    })

    it('returns empty items when the group has no data', async () => {
      mock.onGet(`${ BASE }/alpha-tags`).reply({ alpha_tags: [] })

      const result = await service.getSenderContactsDictionary({
        criteria: { senderIDgroup: 'Alpha Tags' },
      })

      expect(result.items).toEqual([])
    })
  })

  describe('getContactListsDictionary', () => {
    it('maps lists to items with default pagination and a null cursor', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        data: {
          total: 1,
          current_page: 1,
          next_page_url: null,
          data: [{ list_id: 2932037, list_name: 'SMS List' }],
        },
      })

      const result = await service.getContactListsDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 15 })
      expect(result.items).toEqual([
        { label: 'SMS List', note: 'ID: 2932037', value: 2932037 },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes the cursor as page and returns the next cursor', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        data: {
          total: 30,
          current_page: 2,
          next_page_url: 'https://rest.clicksend.com/v3/lists?page=3',
          data: [{ list_id: 1, list_name: 'List A' }],
        },
      })

      const result = await service.getContactListsDictionary({ cursor: 2 })

      expect(mock.history[0].query).toMatchObject({ limit: 15, page: 2 })
      expect(result.cursor).toBe(3)
    })

    it('handles a null payload and empty results', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ data: { total: 0, data: [] } })

      const result = await service.getContactListsDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getListContactsDictionary', () => {
    it('builds a name label when first/last name present', async () => {
      mock.onGet(`${ BASE }/lists/999/contacts`).reply({
        data: {
          total: 1,
          current_page: 1,
          next_page_url: null,
          data: [{ contact_id: 1217715665, first_name: 'John', last_name: 'Smith' }],
        },
      })

      const result = await service.getListContactsDictionary({
        criteria: { list_id: 999 },
      })

      expect(mock.history[0].url).toBe(`${ BASE }/lists/999/contacts`)
      expect(mock.history[0].query).toMatchObject({ limit: 25 })
      expect(result.items).toEqual([
        { label: 'John Smith', note: 'ID: 1217715665', value: 1217715665 },
      ])
    })

    it('falls back to phone/email/fax when no name present', async () => {
      mock.onGet(`${ BASE }/lists/999/contacts`).reply({
        data: {
          total: 1,
          current_page: 1,
          next_page_url: null,
          data: [{ contact_id: 5, phone_number: '+14035550000' }],
        },
      })

      const result = await service.getListContactsDictionary({
        criteria: { list_id: 999 },
      })

      expect(result.items[0].label).toBe('+14035550000')
    })

    it('passes cursor as page', async () => {
      mock.onGet(`${ BASE }/lists/999/contacts`).reply({
        data: {
          total: 50,
          current_page: 2,
          next_page_url: 'x',
          data: [{ contact_id: 5, email: 'a@b.com' }],
        },
      })

      const result = await service.getListContactsDictionary({
        cursor: 2,
        criteria: { list_id: 999 },
      })

      expect(mock.history[0].query).toMatchObject({ limit: 25, page: 2 })
      expect(result.cursor).toBe(3)
    })
  })

  describe('getContactDetailsDictionary', () => {
    it('returns phone, fax and email rows for a contact', async () => {
      mock.onGet(`${ BASE }/lists/10/contacts/20`).reply({
        data: {
          phone_number: '+61444444444',
          fax_number: '+61262222222',
          email: 'john@mail.com',
        },
      })

      const result = await service.getContactDetailsDictionary({
        criteria: { list_id: 10, contact_id: 20 },
      })

      expect(mock.history[0].url).toBe(`${ BASE }/lists/10/contacts/20`)
      expect(result.items).toEqual([
        { label: 'Mobile Phone Number', note: '+61444444444', value: '+61444444444' },
        { label: 'Fax Number', note: '+61262222222', value: '+61262222222' },
        { label: 'Email Address', note: 'john@mail.com', value: 'john@mail.com' },
      ])
    })

    it('returns empty items when no contact data', async () => {
      mock.onGet(`${ BASE }/lists/10/contacts/20`).reply({})

      const result = await service.getContactDetailsDictionary({
        criteria: { list_id: 10, contact_id: 20 },
      })

      expect(result.items).toEqual([])
    })
  })

  describe('getReturnAddressesDictionary', () => {
    it('maps return addresses to items', async () => {
      mock.onGet(`${ BASE }/post/return-addresses`).reply({
        data: {
          current_page: 1,
          next_page_url: null,
          data: [{ return_address_id: 710199, address_name: 'John Smith' }],
        },
      })

      const result = await service.getReturnAddressesDictionary({})

      expect(mock.history[0].query).toMatchObject({ limit: 15 })
      expect(result.items).toEqual([
        { label: 'John Smith', note: 'ID: 710199', value: 710199 },
      ])
      expect(result.cursor).toBeNull()
    })

    it('passes cursor as page', async () => {
      mock.onGet(`${ BASE }/post/return-addresses`).reply({
        data: {
          current_page: 3,
          next_page_url: 'x',
          data: [{ return_address_id: 1, address_name: 'A' }],
        },
      })

      const result = await service.getReturnAddressesDictionary({ cursor: 3 })

      expect(mock.history[0].query).toMatchObject({ limit: 15, page: 3 })
      expect(result.cursor).toBe(4)
    })

    it('returns empty items when no data', async () => {
      mock.onGet(`${ BASE }/post/return-addresses`).reply({ data: { data: [] } })

      const result = await service.getReturnAddressesDictionary(null)

      expect(result.items).toEqual([])
    })
  })

  describe('getVoiceLanguagesDictionary', () => {
    it('maps languages to items', async () => {
      mock.onGet(`${ BASE }/voice/lang`).reply({
        data: [
          { country: 'English', code: 'en-us' },
          { country: 'Spanish', code: 'es-es' },
        ],
      })

      const result = await service.getVoiceLanguagesDictionary()

      expect(result.items).toEqual([
        { label: 'English', note: 'en-us', value: 'en-us' },
        { label: 'Spanish', note: 'es-es', value: 'es-es' },
      ])
    })

    it('returns empty items when no data', async () => {
      mock.onGet(`${ BASE }/voice/lang`).reply({})

      const result = await service.getVoiceLanguagesDictionary()

      expect(result.items).toEqual([])
    })
  })

  // ── Messaging ──

  describe('sendSms', () => {
    it('sends a single message with all fields in the messages array', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'ABC', status: 'SUCCESS' }],
        },
      })

      const result = await service.sendSms(
        '+447777777777',
        'Hello',
        'Own numbers',
        '+14035550000',
        1735628400000,
        'ref-1'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/sms/send`)
      expect(mock.history[0].body).toEqual({
        messages: [
          {
            to: '+447777777777',
            body: 'Hello',
            from: '+14035550000',
            schedule: 1735628400000,
            custom_string: 'ref-1',
          },
        ],
      })
      expect(result).toMatchObject({ message_id: 'ABC', status: 'SUCCESS', currency_name_short: 'CAD' })
    })

    it('sends with only required fields (optionals undefined)', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({
        data: { messages: [{ message_id: 'X' }] },
      })

      await service.sendSms('+447777777777', 'Hi')

      expect(mock.history[0].body.messages[0]).toEqual({
        to: '+447777777777',
        body: 'Hi',
        from: undefined,
        schedule: undefined,
        custom_string: undefined,
      })
    })

    it('returns {} when the response has no messages', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({ data: {} })

      const result = await service.sendSms('+447777777777', 'Hi')

      expect(result).toEqual({})
    })

    it('wraps API errors with a descriptive message', async () => {
      mock.onPost(`${ BASE }/sms/send`).replyWithError({ message: 'Bad Request' })

      await expect(service.sendSms('+447777777777', 'Hi')).rejects.toThrow(
        'Failed to send SMS: Bad Request'
      )
    })
  })

  describe('sendMms', () => {
    it('sends media file at payload root, message details in the array and flattens currency', async () => {
      mock.onPost(`${ BASE }/mms/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'MMS1', status: 'SUCCESS' }],
        },
      })

      const result = await service.sendMms(
        null,
        null,
        '+61411111111',
        'Own numbers',
        '+14039995544',
        'Subject',
        'Body',
        'https://example.com/media.jpg',
        1734764400000,
        'MyApp',
        'ref'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/mms/send`)
      expect(mock.history[0].body).toEqual({
        media_file: 'https://example.com/media.jpg',
        messages: [
          {
            to: '+61411111111',
            from: '+14039995544',
            subject: 'Subject',
            body: 'Body',
            schedule: 1734764400000,
            source: 'MyApp',
            custom_string: 'ref',
          },
        ],
      })
      expect(result).toMatchObject({
        message_id: 'MMS1',
        status: 'SUCCESS',
        currency_name_short: 'CAD',
      })
    })

    it('returns the message without currency when _currency is absent (no throw)', async () => {
      mock.onPost(`${ BASE }/mms/send`).reply({
        data: { messages: [{ message_id: 'MMS1', status: 'SUCCESS' }] },
      })

      const result = await service.sendMms(null, null, '+61411111111', null, null, 'S', 'B', 'u')

      expect(result).toMatchObject({ message_id: 'MMS1', status: 'SUCCESS' })
      expect(result.currency_name_short).toBeUndefined()
    })

    it('returns {} when the response has no messages', async () => {
      mock.onPost(`${ BASE }/mms/send`).reply({ data: {} })

      const result = await service.sendMms(null, null, '+61411111111', null, null, 'S', 'B', 'u')

      expect(result).toEqual({})
    })
  })

  describe('sendSMSToContactList', () => {
    it('sends to a contact list and flattens currency', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({
        data: {
          total_count: 2,
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'L1' }],
        },
      })

      const result = await service.sendSMSToContactList(
        2932037,
        'Own numbers',
        '+14035550000',
        'Body',
        1735628400000,
        'MyApp',
        'ref'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/sms/send`)
      expect(mock.history[0].body).toEqual({
        messages: [
          {
            list_id: 2932037,
            from: '+14035550000',
            body: 'Body',
            schedule: 1735628400000,
            source: 'MyApp',
            custom_string: 'ref',
          },
        ],
      })
      expect(result.currency_name_short).toBe('CAD')
      expect(result._currency).toBeUndefined()
    })

    it('returns response data untouched when no _currency present', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({ data: { total_count: 0, messages: [] } })

      const result = await service.sendSMSToContactList(1, null, null, 'Body')

      expect(result).toEqual({ total_count: 0, messages: [] })
    })
  })

  // ── Campaigns ──

  describe('sendSmsCampaign', () => {
    it('posts campaign body and returns the sms_campaign object', async () => {
      mock.onPost(`${ BASE }/sms-campaigns/send`).reply({
        data: { sms_campaign: { sms_campaign_id: 2286887, status: 'Scheduled' } },
      })

      const result = await service.sendSmsCampaign(
        'Camp',
        2922723,
        'Own numbers',
        '+14059999999',
        'Body',
        'MyApp',
        1734591600000
      )

      expect(mock.history[0].url).toBe(`${ BASE }/sms-campaigns/send`)
      expect(mock.history[0].body).toEqual({
        name: 'Camp',
        list_id: 2922723,
        senderIDgroup: 'Own numbers',
        from: '+14059999999',
        body: 'Body',
        source: 'MyApp',
        schedule: 1734591600000,
      })
      expect(result).toEqual({ sms_campaign_id: 2286887, status: 'Scheduled' })
    })
  })

  describe('sendMmsCampaign', () => {
    it('posts campaign body and returns response data', async () => {
      mock.onPost(`${ BASE }/mms-campaigns/send`).reply({
        data: { mms_campaign_id: 115150, status: 'Scheduled' },
      })

      const result = await service.sendMmsCampaign(
        'Camp',
        2922723,
        'Own numbers',
        '+14035554422',
        'Subject',
        'Body',
        'https://example.com/m.jpg',
        1735628400000,
        'MyApp',
        'ref'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/mms-campaigns/send`)
      expect(mock.history[0].body).toEqual({
        name: 'Camp',
        list_id: 2922723,
        senderIDgroup: 'Own numbers',
        from: '+14035554422',
        subject: 'Subject',
        body: 'Body',
        media_file: 'https://example.com/m.jpg',
        schedule: 1735628400000,
        source: 'MyApp',
        custom_string: 'ref',
      })
      expect(result).toEqual({ mms_campaign_id: 115150, status: 'Scheduled' })
    })
  })

  // ── Fax ──

  describe('sendFax', () => {
    it('posts file_url at root with messages array and flattens currency', async () => {
      mock.onPost(`${ BASE }/fax/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'FAX1', status: 'SUCCESS' }],
        },
      })

      const result = await service.sendFax(
        null,
        null,
        '+61261111111',
        '+14058888888',
        'https://example.com/doc.pdf',
        'MyApp',
        1734418800000
      )

      expect(mock.history[0].url).toBe(`${ BASE }/fax/send`)
      expect(mock.history[0].body).toEqual({
        file_url: 'https://example.com/doc.pdf',
        messages: [
          {
            to: '+61261111111',
            from: '+14058888888',
            source: 'MyApp',
            schedule: 1734418800000,
          },
        ],
      })
      expect(result).toMatchObject({ message_id: 'FAX1', currency_name_short: 'CAD' })
    })

    it('returns the message without currency when _currency is absent (no throw)', async () => {
      mock.onPost(`${ BASE }/fax/send`).reply({
        data: { messages: [{ message_id: 'FAX1', status: 'SUCCESS' }] },
      })

      const result = await service.sendFax(
        null,
        null,
        '+61261111111',
        '+14058888888',
        'https://example.com/doc.pdf'
      )

      expect(result).toMatchObject({ message_id: 'FAX1', status: 'SUCCESS' })
      expect(result.currency_name_short).toBeUndefined()
    })

    it('returns {} when the response has no messages', async () => {
      mock.onPost(`${ BASE }/fax/send`).reply({ data: {} })

      const result = await service.sendFax(null, null, '+6', '+1', 'u')

      expect(result).toEqual({})
    })
  })

  // ── Postal ──

  describe('sendLetter', () => {
    it('normalizes booleans to 0/1 and flattens return address + currency', async () => {
      mock.onPost(`${ BASE }/post/letters/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          recipients: [
            {
              message_id: 'LET1',
              status: 'SUCCESS',
              _return_address: {
                return_address_id: 710199,
                address_name: 'John Smith',
                address_city: 'Dallas',
              },
            },
          ],
        },
      })

      const result = await service.sendLetter(
        'ABC Inc.',
        '1 Ave',
        'SE',
        'Dallas',
        'TX',
        '11111',
        'US',
        710199,
        'https://example.com/letter.pdf',
        true,
        true,
        false,
        true,
        1734678000000,
        'MyApp'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/post/letters/send`)
      expect(mock.history[0].body).toMatchObject({
        file_url: 'https://example.com/letter.pdf',
        template_used: 1,
        duplex: 1,
        colour: 0,
        priority_post: 1,
        source: 'MyApp',
      })
      expect(mock.history[0].body.recipients[0]).toMatchObject({
        address_name: 'ABC Inc.',
        return_address_id: 710199,
        schedule: 1734678000000,
      })
      expect(result).toMatchObject({
        message_id: 'LET1',
        return_address_name: 'John Smith',
        return_address_city: 'Dallas',
        currency_name_short: 'CAD',
      })
      expect(result._return_address).toBeUndefined()
    })

    it('returns the recipient without currency when _currency is absent (no throw)', async () => {
      mock.onPost(`${ BASE }/post/letters/send`).reply({
        data: {
          recipients: [
            {
              message_id: 'LET1',
              status: 'SUCCESS',
              _return_address: { return_address_id: 710199, address_name: 'John Smith' },
            },
          ],
        },
      })

      const result = await service.sendLetter(
        'ABC Inc.',
        '1 Ave',
        'SE',
        'Dallas',
        'TX',
        '11111',
        'US',
        710199,
        'https://example.com/letter.pdf',
        true,
        true,
        false,
        true,
        1734678000000,
        'MyApp'
      )

      expect(result).toMatchObject({
        message_id: 'LET1',
        status: 'SUCCESS',
        return_address_name: 'John Smith',
      })
      expect(result.currency_name_short).toBeUndefined()
      expect(result._return_address).toBeUndefined()
    })

    it('returns {} when there are no recipients', async () => {
      mock.onPost(`${ BASE }/post/letters/send`).reply({ data: {} })

      const result = await service.sendLetter(
        'N',
        'L1',
        null,
        'City',
        null,
        '11111',
        'US',
        1,
        'u',
        false,
        false,
        false,
        false
      )

      expect(result).toEqual({})
    })
  })

  describe('sendPostcard', () => {
    it('sends one file_url when no additional file provided', async () => {
      mock.onPost(`${ BASE }/post/postcards/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          recipients: [{ message_id: 'PC1', status: 'SUCCESS' }],
        },
      })

      const result = await service.sendPostcard(
        'ABC Inc.',
        'L1',
        'L2',
        'Dallas',
        'TX',
        '11111',
        'US',
        710199,
        'https://example.com/front.pdf',
        null,
        true,
        1734764400000,
        'ref'
      )

      expect(mock.history[0].body.file_urls).toEqual(['https://example.com/front.pdf'])
      expect(mock.history[0].body.priority_post).toBe(1)
      expect(result).toMatchObject({ message_id: 'PC1', currency_name_short: 'CAD' })
    })

    it('sends two file_urls when an additional file is provided', async () => {
      mock.onPost(`${ BASE }/post/postcards/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          recipients: [{ message_id: 'PC2' }],
        },
      })

      await service.sendPostcard(
        'ABC Inc.',
        'L1',
        null,
        'Dallas',
        null,
        '11111',
        'US',
        710199,
        'https://example.com/front.pdf',
        'https://example.com/back.pdf',
        false,
        undefined,
        undefined
      )

      expect(mock.history[0].body.file_urls).toEqual([
        'https://example.com/front.pdf',
        'https://example.com/back.pdf',
      ])
      expect(mock.history[0].body.priority_post).toBe(0)
    })

    it('flattens the return address when present', async () => {
      mock.onPost(`${ BASE }/post/postcards/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          recipients: [
            {
              message_id: 'PC3',
              _return_address: { return_address_id: 710199, address_name: 'John Smith' },
            },
          ],
        },
      })

      const result = await service.sendPostcard(
        'ABC',
        'L1',
        null,
        'Dallas',
        null,
        '11111',
        'US',
        710199,
        'u',
        null,
        false
      )

      expect(result.return_address_name).toBe('John Smith')
      expect(result._return_address).toBeUndefined()
    })

    it('returns the recipient without currency when _currency is absent (no throw)', async () => {
      mock.onPost(`${ BASE }/post/postcards/send`).reply({
        data: { recipients: [{ message_id: 'PC1', status: 'SUCCESS' }] },
      })

      const result = await service.sendPostcard(
        'ABC Inc.',
        'L1',
        'L2',
        'Dallas',
        'TX',
        '11111',
        'US',
        710199,
        'https://example.com/front.pdf',
        null,
        true,
        1734764400000,
        'ref'
      )

      expect(result).toMatchObject({ message_id: 'PC1', status: 'SUCCESS' })
      expect(result.currency_name_short).toBeUndefined()
    })

    it('returns {} when there are no recipients', async () => {
      mock.onPost(`${ BASE }/post/postcards/send`).reply({ data: {} })

      const result = await service.sendPostcard(
        'ABC',
        'L1',
        null,
        'Dallas',
        null,
        '11111',
        'US',
        710199,
        'u',
        null,
        false
      )

      expect(result).toEqual({})
    })
  })

  // ── Voice ──

  describe('sendVoiceMessage', () => {
    it('lowercases the voice, normalizes machine_detection and flattens currency', async () => {
      mock.onPost(`${ BASE }/voice/send`).reply({
        data: {
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'V1', status: 'SUCCESS' }],
        },
      })

      const result = await service.sendVoiceMessage(
        '+447777777777',
        'Own numbers',
        '+14059995566',
        'Hello world',
        'Female',
        'en-gb',
        true,
        1735628400000,
        'MyApp',
        'ref'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/voice/send`)
      expect(mock.history[0].body.messages[0]).toEqual({
        to: '+447777777777',
        from: '+14059995566',
        body: 'Hello world',
        voice: 'female',
        lang: 'en-gb',
        machine_detection: 1,
        schedule: 1735628400000,
        source: 'MyApp',
        custom_string: 'ref',
      })
      expect(result).toMatchObject({ message_id: 'V1', currency_name_short: 'CAD' })
    })

    it('sets voice to null and machine_detection to 0 when not provided', async () => {
      mock.onPost(`${ BASE }/voice/send`).reply({
        data: { messages: [{ message_id: 'V2' }] },
      })

      await service.sendVoiceMessage('+447777777777', null, null, 'Hello')

      expect(mock.history[0].body.messages[0]).toMatchObject({
        voice: null,
        machine_detection: 0,
      })
    })

    it('returns {} when there are no messages', async () => {
      mock.onPost(`${ BASE }/voice/send`).reply({ data: {} })

      const result = await service.sendVoiceMessage('+447777777777', null, null, 'Hi', 'Male')

      expect(result).toEqual({})
    })
  })

  describe('sendVoiceMessageToContactList', () => {
    it('sends to a contact list, lowercases voice and flattens currency', async () => {
      mock.onPost(`${ BASE }/voice/send`).reply({
        data: {
          total_count: 1,
          _currency: { currency_name_short: 'CAD' },
          messages: [{ message_id: 'VL1' }],
        },
      })

      const result = await service.sendVoiceMessageToContactList(
        2932037,
        'Own numbers',
        '+14055555555',
        'Hello',
        'Female',
        'es-es',
        true,
        1735714800000,
        'MyApp',
        'ref'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/voice/send`)
      expect(mock.history[0].body.messages[0]).toEqual({
        list_id: 2932037,
        from: '+14055555555',
        body: 'Hello',
        voice: 'female',
        lang: 'es-es',
        machine_detection: 1,
        schedule: 1735714800000,
        source: 'MyApp',
        custom_string: 'ref',
      })
      expect(result.currency_name_short).toBe('CAD')
      expect(result._currency).toBeUndefined()
    })

    it('returns {} when there are no messages', async () => {
      mock.onPost(`${ BASE }/voice/send`).reply({ data: { messages: [] } })

      const result = await service.sendVoiceMessageToContactList(1, null, null, 'Hi', 'Male')

      expect(result).toEqual({})
    })
  })

  // ── Contact Management ──

  describe('createContactList', () => {
    it('posts the list name and returns response data', async () => {
      mock.onPost(`${ BASE }/lists`).reply({
        data: { list_id: 2912622, list_name: 'New Test Contact List' },
      })

      const result = await service.createContactList('New Test Contact List')

      expect(mock.history[0].url).toBe(`${ BASE }/lists`)
      expect(mock.history[0].body).toEqual({ list_name: 'New Test Contact List' })
      expect(result).toEqual({ list_id: 2912622, list_name: 'New Test Contact List' })
    })

    it('wraps API errors with a descriptive message', async () => {
      mock.onPost(`${ BASE }/lists`).replyWithError({ message: 'Conflict' })

      await expect(service.createContactList('X')).rejects.toThrow(
        'Failed to create contact list: Conflict'
      )
    })
  })

  describe('createContact', () => {
    it('posts contact fields to the list contacts endpoint', async () => {
      mock.onPost(`${ BASE }/lists/2913405/contacts`).reply({
        data: { contact_id: 1211152419, first_name: 'John' },
      })

      const result = await service.createContact(
        2913405,
        '+14039999999',
        'test@mail.us',
        '+14035555555',
        'John',
        'Smith',
        'ABC Inc.',
        '5000',
        '4000 40 Ave NW',
        'Toronto',
        'Ontario',
        'XXXXXX',
        'CA',
        'c1',
        'c2',
        'c3',
        'c4'
      )

      expect(mock.history[0].url).toBe(`${ BASE }/lists/2913405/contacts`)
      expect(mock.history[0].body).toMatchObject({
        phone_number: '+14039999999',
        email: 'test@mail.us',
        fax_number: '+14035555555',
        first_name: 'John',
        last_name: 'Smith',
        organization_name: 'ABC Inc.',
        address_country: 'CA',
        custom_1: 'c1',
        custom_4: 'c4',
      })
      expect(result).toEqual({ contact_id: 1211152419, first_name: 'John' })
    })

    it('includes undefined optional fields (only list_id is required)', async () => {
      mock.onPost(`${ BASE }/lists/1/contacts`).reply({ data: { contact_id: 1 } })

      await service.createContact(1, '+14039999999')

      expect(mock.history[0].body).toMatchObject({
        phone_number: '+14039999999',
        email: undefined,
        first_name: undefined,
      })
    })
  })

  describe('updateContact', () => {
    it('puts contact fields to the specific contact endpoint', async () => {
      mock.onPut(`${ BASE }/lists/2913356/contacts/1211510178`).reply({
        data: { contact_id: 1211510178, first_name: 'John' },
      })

      const result = await service.updateContact(
        2913356,
        1211510178,
        '+14055555555',
        'test@mail.com',
        '+61262222222',
        'John',
        'Smith'
      )

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].url).toBe(`${ BASE }/lists/2913356/contacts/1211510178`)
      expect(mock.history[0].body).toMatchObject({
        phone_number: '+14055555555',
        email: 'test@mail.com',
        fax_number: '+61262222222',
        first_name: 'John',
        last_name: 'Smith',
      })
      expect(result).toEqual({ contact_id: 1211510178, first_name: 'John' })
    })
  })

  describe('deleteContact', () => {
    it('deletes the contact and returns its id', async () => {
      mock.onDelete(`${ BASE }/lists/10/contacts/20`).reply({})

      const result = await service.deleteContact(10, 20)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/lists/10/contacts/20`)
      expect(result).toBe(20)
    })
  })

  describe('deleteContactList', () => {
    it('deletes the list and returns its id', async () => {
      mock.onDelete(`${ BASE }/lists/10`).reply({})

      const result = await service.deleteContactList(10)

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/lists/10`)
      expect(result).toBe(10)
    })
  })

  describe('searchContactByEmail', () => {
    it('queries the list contacts with an email filter and flags contactFound', async () => {
      mock.onGet(`${ BASE }/lists/2932037/contacts`).reply({
        data: { data: [{ contact_id: 1217715665, email: 'john@mail.com' }] },
      })

      const result = await service.searchContactByEmail(2932037, ' john@mail.com ')

      expect(mock.history[0].url).toBe(`${ BASE }/lists/2932037/contacts`)
      expect(mock.history[0].query).toMatchObject({ q: 'email:john@mail.com' })
      expect(result).toMatchObject({ contact_id: 1217715665, contactFound: true })
    })

    it('returns contactFound false when nothing matches', async () => {
      mock.onGet(`${ BASE }/lists/2932037/contacts`).reply({ data: { data: [] } })

      const result = await service.searchContactByEmail(2932037, 'none@mail.com')

      expect(result).toEqual({ contactFound: false })
    })

    it('throws when email is missing', async () => {
      await expect(service.searchContactByEmail(2932037, '   ')).rejects.toThrow(
        'Failed to search contact by email: Email is missing.'
      )
    })
  })

  describe('searchContactByPhone', () => {
    it('adds a leading + and queries by phone_number', async () => {
      mock.onGet(`${ BASE }/lists/2932037/contacts`).reply({
        data: { data: [{ contact_id: 1, phone_number: '+61444444444' }] },
      })

      const result = await service.searchContactByPhone(2932037, '61444444444')

      expect(mock.history[0].query).toMatchObject({ q: 'phone_number:+61444444444' })
      expect(result).toMatchObject({ contact_id: 1, contactFound: true })
    })

    it('keeps an existing leading +', async () => {
      mock.onGet(`${ BASE }/lists/1/contacts`).reply({ data: { data: [] } })

      await service.searchContactByPhone(1, '+61444444444')

      expect(mock.history[0].query).toMatchObject({ q: 'phone_number:+61444444444' })
    })

    it('returns contactFound false when nothing matches', async () => {
      mock.onGet(`${ BASE }/lists/1/contacts`).reply({ data: { data: [] } })

      const result = await service.searchContactByPhone(1, '+61444444444')

      expect(result).toEqual({ contactFound: false })
    })

    it('throws when phone number is missing', async () => {
      await expect(service.searchContactByPhone(1, '  ')).rejects.toThrow(
        'Failed to search contact by phone: Phone number is missing.'
      )
    })
  })

  describe('searchContactListByName', () => {
    it('queries lists by name and flags contactListFound', async () => {
      mock.onGet(`${ BASE }/lists`).reply({
        data: { data: [{ list_id: 2932037, list_name: 'SMS List' }] },
      })

      const result = await service.searchContactListByName(' SMS List ')

      expect(mock.history[0].url).toBe(`${ BASE }/lists`)
      expect(mock.history[0].query).toMatchObject({ q: 'list_name:SMS List' })
      expect(result).toMatchObject({ list_id: 2932037, contactListFound: true })
    })

    it('returns contactListFound false when nothing matches', async () => {
      mock.onGet(`${ BASE }/lists`).reply({ data: { data: [] } })

      const result = await service.searchContactListByName('None')

      expect(result).toEqual({ contactListFound: false })
    })

    it('throws when the name is missing', async () => {
      await expect(service.searchContactListByName('   ')).rejects.toThrow(
        'Failed to search contact list by name: Contact list name is missing.'
      )
    })
  })

  // ── API Utilities ──

  describe('clickSendApiRequest', () => {
    it('performs a raw request with a JSON body and returns response.data', async () => {
      mock.onPost(`${ BASE }/sms/send`).reply({ data: { queued_count: 1 } })

      const result = await service.clickSendApiRequest(
        'POST',
        '/sms/send',
        '',
        '{"messages":[{"to":"+1","body":"hi"}]}'
      )

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ BASE }/sms/send`)
      expect(mock.history[0].body).toEqual({ messages: [{ to: '+1', body: 'hi' }] })
      expect(result).toEqual({ queued_count: 1 })
    })

    it('appends the query string to the URL when provided', async () => {
      mock.onGet(`${ BASE }/lists?q=list_name:test`).reply({ data: { data: [] } })

      await service.clickSendApiRequest('GET', '/lists', 'q=list_name:test', 'null')

      expect(mock.history[0].url).toBe(`${ BASE }/lists?q=list_name:test`)
    })

    it('returns the raw response when response.data is absent', async () => {
      mock.onGet(`${ BASE }/account`).reply({ balance: 100 })

      const result = await service.clickSendApiRequest('GET', '/account', '', 'null')

      expect(result).toEqual({ balance: 100 })
    })

    it('throws when the HTTP method is invalid', async () => {
      await expect(
        service.clickSendApiRequest('FETCH', '/lists', '', 'null')
      ).rejects.toThrow(/Invalid HTTP method/)
    })

    it('throws when the body is not valid JSON', async () => {
      await expect(
        service.clickSendApiRequest('POST', '/lists', '', 'not-json')
      ).rejects.toThrow(/Body Parameters are not valid JSON/)
    })

    it('throws when method and url are missing', async () => {
      await expect(service.clickSendApiRequest('', '', '', 'null')).rejects.toThrow(
        /HTTP Method is required/
      )
    })
  })
})
