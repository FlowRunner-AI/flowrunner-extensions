'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const ACCESS_TOKEN = 'test-access-token'
const PAGE_TOKEN = 'page-access-token-abc'
const API_BASE = 'https://graph.facebook.com/v21.0'

const PAGES_RESPONSE = {
  data: [
    { id: '111222333', name: 'Acme Store', access_token: PAGE_TOKEN, category: 'Retail Company' },
    { id: '444555666', name: 'Test Page', access_token: 'page-token-2', category: 'Community' },
  ],
}

describe('Facebook Messenger Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate OAuth access token header
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
  })

  afterEach(() => {
    mock.reset()
    // Clear the page token cache between tests
    service._pageTokenCache = {}
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
        ])
      )
    })
  })

  // ── OAuth System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns a correctly formed URL with client_id and scopes', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain('https://www.facebook.com/v21.0/dialog/oauth/')
      expect(url).toContain(`client_id=${ CLIENT_ID }`)
      expect(url).toContain('scope=pages_show_list+pages_messaging+pages_manage_metadata+pages_read_engagement')
      expect(url).toContain('response_type=code')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for token and fetches profile', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })
      // The service uses GET with inline query string: /me?fields=id,name,picture
      mock.onGet(`${ API_BASE }/me?fields=id,name,picture`).reply({
        id: '12345',
        name: 'Test User',
        picture: { data: { url: 'https://example.com/pic.jpg' } },
      })

      const result = await service.executeCallback({
        code: 'auth-code-123',
        redirectURI: 'https://app.flowrunner.com/callback',
      })

      expect(result).toEqual({
        token: 'new-access-token',
        refreshToken: 'new-refresh-token',
        overwrite: true,
        expirationInSeconds: 3600,
        connectionIdentityName: 'Test User',
        connectionIdentityImageURL: 'https://example.com/pic.jpg',
      })

      // Check token exchange request
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].url).toBe(`${ API_BASE }/oauth/access_token`)
      expect(mock.history[0].body).toContain('grant_type=authorization_code')
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)
      expect(mock.history[0].body).toContain('code=auth-code-123')

      // Check profile request uses the new access token
      expect(mock.history[1].method).toBe('get')
      expect(mock.history[1].headers).toMatchObject({ Authorization: 'Bearer new-access-token' })
    })

    it('falls back to "Facebook User" when profile name is missing', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token: 'token-1',
        expires_in: 3600,
      })
      mock.onGet(`${ API_BASE }/me?fields=id,name,picture`).reply({ id: '12345' })

      const result = await service.executeCallback({ code: 'code', redirectURI: 'https://x.com/cb' })

      expect(result.connectionIdentityName).toBe('Facebook User')
      expect(result.connectionIdentityImageURL).toBeNull()
      expect(result.refreshToken).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).replyWithError({
        message: 'Invalid code',
      })

      await expect(
        service.executeCallback({ code: 'bad', redirectURI: 'https://x.com/cb' })
      ).rejects.toThrow()
    })
  })

  describe('refreshToken', () => {
    it('sends correct refresh request and returns new token', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
        refresh_token: 'new-refresh',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result).toEqual({
        token: 'refreshed-token',
        expirationInSeconds: 7200,
        refreshToken: 'new-refresh',
      })

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${ CLIENT_ID }`)
      expect(mock.history[0].body).toContain(`client_secret=${ CLIENT_SECRET }`)
      expect(mock.history[0].headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' })
    })

    it('falls back to original refresh token when new one is not returned', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('keep-this-token')

      expect(result.refreshToken).toBe('keep-this-token')
    })

    it('throws on API error', async () => {
      mock.onPost(`${ API_BASE }/oauth/access_token`).replyWithError({
        message: 'Invalid token',
      })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Sending ──

  describe('sendTextMessage', () => {
    it('sends correct text message with defaults (uses first page)', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      // When pageId is empty, targetPage = 'me'
      mock.onPost(`${ API_BASE }/me/messages`).reply({
        recipient_id: '999',
        message_id: 'm_abc',
      })

      const result = await service.sendTextMessage('', '999', 'Hello!')

      expect(result).toEqual({ recipient_id: '999', message_id: 'm_abc' })

      // The second call is the actual send
      const sendCall = mock.history[1]
      expect(sendCall.method).toBe('post')
      expect(sendCall.url).toBe(`${ API_BASE }/me/messages`)
      expect(sendCall.body).toMatchObject({
        recipient: { id: '999' },
        message: { text: 'Hello!' },
        messaging_type: 'RESPONSE',
      })
      expect(sendCall.headers).toMatchObject({ Authorization: `Bearer ${ PAGE_TOKEN }` })
    })

    it('sends with specific page ID in URL', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/444555666/messages`).reply({
        recipient_id: '999',
        message_id: 'm_def',
      })

      await service.sendTextMessage('444555666', '999', 'Hi there')

      const sendCall = mock.history[1]
      expect(sendCall.url).toBe(`${ API_BASE }/444555666/messages`)
      expect(sendCall.headers).toMatchObject({ Authorization: 'Bearer page-token-2' })
    })

    it('sends with Message Tag type and required tag', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({
        recipient_id: '999',
        message_id: 'm_ghi',
      })

      await service.sendTextMessage('', '999', 'Update info', 'Message Tag', 'Human Agent', 'Silent Push')

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
        notification_type: 'SILENT_PUSH',
      })
    })

    it('sends with Update messaging type', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendTextMessage('', '999', 'News', 'Update', '', 'No Push')

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        messaging_type: 'UPDATE',
        notification_type: 'NO_PUSH',
      })
    })

    it('throws when Message Tag type is used without a tag', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      await expect(
        service.sendTextMessage('', '999', 'text', 'Message Tag', '', '')
      ).rejects.toThrow('A Message Tag is required')
    })
  })

  describe('sendMediaMessage', () => {
    it('sends image attachment with correct body', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({
        recipient_id: '999',
        message_id: 'm_media',
        attachment_id: '12345',
      })

      const result = await service.sendMediaMessage(
        '', '999', 'Image', 'https://example.com/pic.png', true
      )

      expect(result).toHaveProperty('attachment_id', '12345')

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        recipient: { id: '999' },
        message: {
          attachment: {
            type: 'image',
            payload: {
              url: 'https://example.com/pic.png',
              is_reusable: true,
            },
          },
        },
        messaging_type: 'RESPONSE',
      })
    })

    it('maps Video attachment type correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendMediaMessage('', '999', 'Video', 'https://example.com/vid.mp4')

      expect(mock.history[1].body.message.attachment.type).toBe('video')
    })

    it('maps Audio attachment type correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendMediaMessage('', '999', 'Audio', 'https://example.com/sound.mp3')

      expect(mock.history[1].body.message.attachment.type).toBe('audio')
    })

    it('maps File attachment type correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendMediaMessage('', '999', 'File', 'https://example.com/doc.pdf')

      expect(mock.history[1].body.message.attachment.type).toBe('file')
    })

    it('omits is_reusable when not provided', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendMediaMessage('', '999', 'File', 'https://example.com/doc.pdf')

      const sendCall = mock.history[1]
      expect(sendCall.body.message.attachment.payload).not.toHaveProperty('is_reusable')
    })

    it('includes messaging envelope options', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendMediaMessage(
        '', '999', 'Image', 'https://example.com/pic.png', false,
        'Message Tag', 'Account Update', 'Regular'
      )

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        messaging_type: 'MESSAGE_TAG',
        tag: 'ACCOUNT_UPDATE',
        notification_type: 'REGULAR',
      })
    })
  })

  describe('sendButtonTemplate', () => {
    it('sends button template with correct structure', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_btn' })

      const buttons = [
        { type: 'web_url', title: 'Visit', url: 'https://example.com' },
        { type: 'postback', title: 'Yes', payload: 'CONFIRM' },
      ]

      await service.sendButtonTemplate('', '999', 'Choose an option:', buttons)

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        recipient: { id: '999' },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'button',
              text: 'Choose an option:',
              buttons: [
                { type: 'web_url', title: 'Visit', url: 'https://example.com' },
                { type: 'postback', title: 'Yes', payload: 'CONFIRM' },
              ],
            },
          },
        },
        messaging_type: 'RESPONSE',
      })
    })

    it('cleans undefined properties from buttons', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_btn' })

      const buttons = [{ type: 'postback', title: 'Click', payload: 'CLICK' }]

      await service.sendButtonTemplate('', '999', 'Test', buttons)

      const sentButton = mock.history[1].body.message.attachment.payload.buttons[0]
      expect(sentButton).not.toHaveProperty('url')
    })

    it('throws when no buttons provided', async () => {
      await expect(
        service.sendButtonTemplate('', '999', 'text', [])
      ).rejects.toThrow('At least one button is required')
    })

    it('throws when more than 3 buttons provided', async () => {
      const buttons = [
        { type: 'postback', title: 'A', payload: '1' },
        { type: 'postback', title: 'B', payload: '2' },
        { type: 'postback', title: 'C', payload: '3' },
        { type: 'postback', title: 'D', payload: '4' },
      ]

      await expect(
        service.sendButtonTemplate('', '999', 'text', buttons)
      ).rejects.toThrow('maximum of 3 buttons')
    })

    it('treats non-array buttons as empty', async () => {
      await expect(
        service.sendButtonTemplate('', '999', 'text', 'not-an-array')
      ).rejects.toThrow('At least one button is required')
    })
  })

  describe('sendGenericTemplate', () => {
    it('sends generic template with elements', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_gen' })

      const elements = [{ title: 'Product A', subtitle: 'Best item' }]

      await service.sendGenericTemplate('', '999', elements)

      const sendCall = mock.history[1]
      expect(sendCall.body.message.attachment.payload).toMatchObject({
        template_type: 'generic',
        elements: [{ title: 'Product A', subtitle: 'Best item' }],
      })
    })

    it('throws when no elements provided', async () => {
      await expect(
        service.sendGenericTemplate('', '999', [])
      ).rejects.toThrow('At least one element is required')
    })

    it('throws when more than 10 elements provided', async () => {
      const elements = Array.from({ length: 11 }, (_, i) => ({ title: `Item ${ i }` }))

      await expect(
        service.sendGenericTemplate('', '999', elements)
      ).rejects.toThrow('maximum of 10 elements')
    })

    it('treats non-array elements as empty', async () => {
      await expect(
        service.sendGenericTemplate('', '999', 'not-an-array')
      ).rejects.toThrow('At least one element is required')
    })
  })

  describe('sendQuickReplies', () => {
    it('sends quick replies with content_type text', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_qr' })

      const replies = [
        { title: 'Yes', payload: 'YES' },
        { title: 'No', payload: 'NO' },
      ]

      await service.sendQuickReplies('', '999', 'Confirm?', replies)

      const sendCall = mock.history[1]
      expect(sendCall.body.message.quick_replies).toEqual([
        { content_type: 'text', title: 'Yes', payload: 'YES' },
        { content_type: 'text', title: 'No', payload: 'NO' },
      ])
    })

    it('throws when no quick replies provided', async () => {
      await expect(
        service.sendQuickReplies('', '999', 'text', [])
      ).rejects.toThrow('At least one quick reply is required')
    })

    it('throws when more than 13 quick replies provided', async () => {
      const replies = Array.from({ length: 14 }, (_, i) => ({ title: `R${ i }`, payload: `P${ i }` }))

      await expect(
        service.sendQuickReplies('', '999', 'Pick one', replies)
      ).rejects.toThrow('maximum of 13 quick replies')
    })
  })

  describe('sendSenderAction', () => {
    it('sends typing_on action', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999' })

      await service.sendSenderAction('', '999', 'Typing On')

      const sendCall = mock.history[1]
      expect(sendCall.body).toMatchObject({
        recipient: { id: '999' },
        sender_action: 'typing_on',
      })
    })

    it('maps Typing Off correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999' })

      await service.sendSenderAction('', '999', 'Typing Off')

      expect(mock.history[1].body.sender_action).toBe('typing_off')
    })

    it('maps Mark Seen correctly', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999' })

      await service.sendSenderAction('', '999', 'Mark Seen')

      expect(mock.history[1].body.sender_action).toBe('mark_seen')
    })
  })

  // ── Conversations ──

  describe('listConversations', () => {
    it('sends correct request with defaults (empty pageId uses me)', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      // When pageId is empty, targetPage = 'me'
      mock.onGet(`${ API_BASE }/me/conversations`).reply({
        data: [{ id: 't_123' }],
        paging: { cursors: { after: 'abc' } },
      })

      const result = await service.listConversations('')

      expect(result.data).toEqual([{ id: 't_123' }])

      const convCall = mock.history[1]
      expect(convCall.query).toMatchObject({
        platform: 'messenger',
        fields: 'id,participants,updated_time,snippet,unread_count',
        limit: 25,
      })
      expect(convCall.headers).toMatchObject({ Authorization: `Bearer ${ PAGE_TOKEN }` })
    })

    it('passes limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/me/conversations`).reply({ data: [] })

      await service.listConversations('', 10, 'cursor123')

      expect(mock.history[1].query).toMatchObject({ limit: 10, after: 'cursor123' })
    })

    it('uses specific page ID in URL', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/444555666/conversations`).reply({ data: [] })

      await service.listConversations('444555666')

      expect(mock.history[1].url).toBe(`${ API_BASE }/444555666/conversations`)
    })
  })

  describe('getConversationMessages', () => {
    it('sends correct request', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/t_123/messages`).reply({
        data: [{ id: 'm_1', message: 'Hello' }],
      })

      const result = await service.getConversationMessages('', 't_123')

      expect(result.data).toEqual([{ id: 'm_1', message: 'Hello' }])

      const msgCall = mock.history[1]
      expect(msgCall.query).toMatchObject({
        fields: 'id,message,from,to,created_time,attachments',
        limit: 25,
      })
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/t_123/messages`).reply({ data: [] })

      await service.getConversationMessages('', 't_123', 5, 'cursorX')

      expect(mock.history[1].query).toMatchObject({ limit: 5, after: 'cursorX' })
    })
  })

  // ── Users ──

  describe('getUserProfile', () => {
    it('fetches user profile with page token', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/999`).reply({
        first_name: 'Jane',
        last_name: 'Doe',
        id: '999',
      })

      const result = await service.getUserProfile('', '999')

      expect(result).toMatchObject({ first_name: 'Jane', last_name: 'Doe' })

      const profileCall = mock.history[1]
      expect(profileCall.query).toMatchObject({
        fields: 'first_name,last_name,profile_pic,locale,timezone',
      })
      expect(profileCall.headers).toMatchObject({ Authorization: `Bearer ${ PAGE_TOKEN }` })
    })
  })

  // ── Messenger Profile ──

  describe('getMessengerProfile', () => {
    it('fetches messenger profile with correct fields', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onGet(`${ API_BASE }/me/messenger_profile`).reply({
        data: [{ greeting: [{ locale: 'default', text: 'Welcome!' }] }],
      })

      const result = await service.getMessengerProfile('')

      expect(result.data[0].greeting[0].text).toBe('Welcome!')
      expect(mock.history[1].query).toMatchObject({
        fields: 'greeting,get_started,persistent_menu',
      })
    })
  })

  describe('setGetStartedButton', () => {
    it('sends POST with correct payload', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messenger_profile`).reply({ result: 'success' })

      const result = await service.setGetStartedButton('', 'GET_STARTED')

      expect(result).toEqual({ result: 'success' })
      expect(mock.history[1].body).toEqual({ get_started: { payload: 'GET_STARTED' } })
    })
  })

  describe('setGreeting', () => {
    it('sends greeting with default locale', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messenger_profile`).reply({ result: 'success' })

      await service.setGreeting('', 'Hi {{user_first_name}}!')

      expect(mock.history[1].body).toEqual({
        greeting: [{ locale: 'default', text: 'Hi {{user_first_name}}!' }],
      })
    })
  })

  describe('setPersistentMenu', () => {
    it('sends menu array', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messenger_profile`).reply({ result: 'success' })

      const menu = [{ locale: 'default', call_to_actions: [{ type: 'postback', title: 'Help', payload: 'HELP' }] }]

      await service.setPersistentMenu('', menu)

      expect(mock.history[1].body).toEqual({ persistent_menu: menu })
    })

    it('throws when menu is empty', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      await expect(
        service.setPersistentMenu('', [])
      ).rejects.toThrow('at least one menu object')
    })

    it('throws when menu is not an array', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      await expect(
        service.setPersistentMenu('', 'not-an-array')
      ).rejects.toThrow('at least one menu object')
    })
  })

  describe('deleteMessengerProfileFields', () => {
    it('sends DELETE with fields array', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onDelete(`${ API_BASE }/me/messenger_profile`).reply({ result: 'success' })

      await service.deleteMessengerProfileFields('', ['greeting', 'get_started'])

      expect(mock.history[1].method).toBe('delete')
      expect(mock.history[1].body).toEqual({ fields: ['greeting', 'get_started'] })
    })

    it('wraps single string field into array', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onDelete(`${ API_BASE }/me/messenger_profile`).reply({ result: 'success' })

      await service.deleteMessengerProfileFields('', 'persistent_menu')

      expect(mock.history[1].body).toEqual({ fields: ['persistent_menu'] })
    })

    it('throws when no fields provided', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      await expect(
        service.deleteMessengerProfileFields('', [])
      ).rejects.toThrow('at least one Messenger profile field')
    })
  })

  // ── Pages ──

  describe('listMyPages', () => {
    it('sends correct request with defaults', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({
        data: [{ id: '111', name: 'Page 1', category: 'Business' }],
      })

      const result = await service.listMyPages()

      expect(result.data).toEqual([{ id: '111', name: 'Page 1', category: 'Business' }])

      expect(mock.history[0].query).toMatchObject({
        fields: 'id,name,category',
        limit: 25,
      })
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ ACCESS_TOKEN }`,
      })
    })

    it('passes custom limit and after cursor', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({ data: [] })

      await service.listMyPages(10, 'afterCursor')

      expect(mock.history[0].query).toMatchObject({ limit: 10, after: 'afterCursor' })
    })
  })

  // ── Dictionary ──

  describe('getPagesDictionary', () => {
    it('returns mapped items from pages', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({
        data: [
          { id: '111', name: 'Page A', category: 'Business' },
          { id: '222', name: 'Page B', category: 'Community' },
        ],
        paging: { cursors: { after: 'nextCursor' } },
      })

      const result = await service.getPagesDictionary({})

      expect(result.items).toEqual([
        { label: 'Page A', value: '111', note: 'Business' },
        { label: 'Page B', value: '222', note: 'Community' },
      ])
      expect(result.cursor).toBe('nextCursor')
    })

    it('filters by search term', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({
        data: [
          { id: '111', name: 'Acme Store', category: 'Retail' },
          { id: '222', name: 'Test Blog', category: 'Blog' },
        ],
      })

      const result = await service.getPagesDictionary({ search: 'acme' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('111')
    })

    it('passes cursor to API query', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({ data: [] })

      await service.getPagesDictionary({ cursor: 'pageCursor' })

      expect(mock.history[0].query).toMatchObject({ after: 'pageCursor', limit: 100 })
    })

    it('handles null payload', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({ data: [] })

      const result = await service.getPagesDictionary(null)

      expect(result.items).toEqual([])
    })

    it('uses page id as label when name is missing', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({
        data: [{ id: '333' }],
      })

      const result = await service.getPagesDictionary({})

      expect(result.items[0].label).toBe('333')
    })
  })

  // ── Page Token Resolution ──

  describe('page token resolution', () => {
    it('throws when no pages are available', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({ data: [] })

      await expect(
        service.sendTextMessage('', '999', 'Hello')
      ).rejects.toThrow('No Facebook Pages are available')
    })

    it('throws when specified page is not found', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)

      await expect(
        service.sendTextMessage('nonexistent-page-id', '999', 'Hello')
      ).rejects.toThrow('was not found among the Pages you manage')
    })

    it('throws when page has no access token', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply({
        data: [{ id: '111', name: 'No Token Page' }],
      })

      await expect(
        service.sendTextMessage('111', '999', 'Hello')
      ).rejects.toThrow('No Page access token was returned')
    })

    it('caches page token for subsequent calls', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).reply({ recipient_id: '999', message_id: 'm_1' })

      await service.sendTextMessage('', '999', 'First')
      await service.sendTextMessage('', '999', 'Second')

      // Only one GET /me/accounts call (cached for second send)
      const accountCalls = mock.history.filter(c => c.method === 'get' && c.url.includes('/me/accounts'))
      expect(accountCalls).toHaveLength(1)
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('formats Facebook API errors with details', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).replyWithError({
        message: 'Bad Request',
        body: {
          error: {
            message: 'Invalid parameter',
            type: 'OAuthException',
            code: 100,
            error_subcode: 2018001,
            fbtrace_id: 'trace123',
          },
        },
      })

      await expect(
        service.sendTextMessage('', '999', 'Hello')
      ).rejects.toThrow('Facebook Messenger API error: Invalid parameter')
    })

    it('includes error type, code, subcode, and fbtrace_id in message', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).replyWithError({
        message: 'Bad Request',
        body: {
          error: {
            message: 'Something went wrong',
            type: 'OAuthException',
            code: 200,
            error_subcode: 1234,
            fbtrace_id: 'traceXYZ',
          },
        },
      })

      await expect(
        service.sendTextMessage('', '999', 'Hello')
      ).rejects.toThrow(/type=OAuthException/)
    })

    it('handles errors without Facebook error body', async () => {
      mock.onGet(`${ API_BASE }/me/accounts`).reply(PAGES_RESPONSE)
      mock.onPost(`${ API_BASE }/me/messages`).replyWithError({
        message: 'Network error',
      })

      await expect(
        service.sendTextMessage('', '999', 'Hello')
      ).rejects.toThrow('Facebook Messenger API error: Network error')
    })
  })
})
