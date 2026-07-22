'use strict'

// ── Mock npm dependencies before anything else ──

const mockConnect = jest.fn().mockResolvedValue()
const mockLogout = jest.fn().mockResolvedValue()
const mockGetMailboxLock = jest.fn()
const mockSearch = jest.fn()
const mockFetchOne = jest.fn()
const mockMessageFlagsAdd = jest.fn().mockResolvedValue()
const mockMessageFlagsRemove = jest.fn().mockResolvedValue()

jest.mock('imapflow', () => ({
  ImapFlow: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    logout: mockLogout,
    getMailboxLock: mockGetMailboxLock,
    search: mockSearch,
    fetchOne: mockFetchOne,
    messageFlagsAdd: mockMessageFlagsAdd,
    messageFlagsRemove: mockMessageFlagsRemove,
  })),
}))

const mockSimpleParser = jest.fn()

jest.mock('mailparser', () => ({
  simpleParser: mockSimpleParser,
}))

const mockSendMail = jest.fn()

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockImplementation(() => ({
    sendMail: mockSendMail,
  })),
}))

const { ImapFlow } = require('imapflow')
const nodemailer = require('nodemailer')
const { createSandbox } = require('../../../service-sandbox')

const TEST_CONFIG = {
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  imapUseTLS: true,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  smtpUseTLS: false,
  user: 'testuser@gmail.com',
  password: 'test-app-password',
}

describe('Mailbox Service', () => {
  let sandbox
  let service
  let mockLockRelease

  beforeAll(() => {
    sandbox = createSandbox(TEST_CONFIG)
    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    mockLockRelease = jest.fn()
    mockGetMailboxLock.mockResolvedValue({ release: mockLockRelease })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual([
        expect.objectContaining({ name: 'imapHost', displayName: 'IMAP Host', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'imapPort', displayName: 'IMAP Port', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'imapUseTLS', displayName: 'IMAP Use TLS', type: 'BOOL' }),
        expect.objectContaining({ name: 'smtpHost', displayName: 'SMTP Host', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'smtpPort', displayName: 'SMTP Port', required: true, type: 'STRING' }),
        expect.objectContaining({ name: 'smtpUseTLS', displayName: 'SMTP Use TLS', type: 'BOOL' }),
        expect.objectContaining({ name: 'user', displayName: 'User', type: 'STRING' }),
        expect.objectContaining({ name: 'password', displayName: 'Password', type: 'STRING' }),
      ])
    })
  })

  // ── readInbox ──

  describe('readInbox', () => {
    const RAW_EMAIL_SOURCE = Buffer.from('Subject: Test\r\nFrom: sender@example.com\r\n\r\nHello')

    it('connects, fetches, parses, and disconnects', async () => {
      mockSearch.mockResolvedValueOnce([1, 2, 3])
      mockFetchOne
        .mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: '101' })
        .mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: '102' })
        .mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: '103' })

      mockSimpleParser.mockResolvedValue({
        messageId: '<test@example.com>',
        from: { value: [{ address: 'sender@example.com', name: 'Sender' }] },
        to: { value: [{ address: 'recipient@example.com', name: 'Recipient' }] },
        subject: 'Test Email',
        date: new Date('2023-10-01'),
        text: 'Hello',
        html: '<p>Hello</p>',
        textAsHtml: '<p>Hello</p>',
        replyTo: undefined,
        inReplyTo: undefined,
      })

      const result = await service.readInbox(5)

      expect(mockConnect).toHaveBeenCalled()
      expect(mockGetMailboxLock).toHaveBeenCalledWith('INBOX')
      expect(mockSearch).toHaveBeenCalledWith({ seen: undefined })
      expect(mockFetchOne).toHaveBeenCalledTimes(3)
      expect(mockSimpleParser).toHaveBeenCalledTimes(3)
      expect(mockLogout).toHaveBeenCalled()

      expect(result).toHaveLength(3)
      expect(result[0]).toMatchObject({
        uid: '101',
        messageId: '<test@example.com>',
        subject: 'Test Email',
      })
    })

    it('uses default limit of 5', async () => {
      // 10 messages available, should take last 5
      mockSearch.mockResolvedValueOnce([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      for (let i = 0; i < 5; i++) {
        mockFetchOne.mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: String(6 + i) })
      }

      mockSimpleParser.mockResolvedValue({
        messageId: '<test@example.com>',
        from: { value: [] },
        to: { value: [] },
        subject: 'Test',
        date: new Date(),
        text: 'body',
      })

      const result = await service.readInbox()

      // Should fetch the last 5 messages (indices 5-9 => seq 6,7,8,9,10)
      expect(mockFetchOne).toHaveBeenCalledTimes(5)
      expect(result).toHaveLength(5)
    })

    it('marks each fetched email as seen', async () => {
      mockSearch.mockResolvedValueOnce([1])
      mockFetchOne.mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: '100' })
      mockSimpleParser.mockResolvedValue({
        messageId: '<test@example.com>',
        from: { value: [] },
        to: { value: [] },
        subject: 'Test',
        date: new Date(),
        text: 'body',
      })

      await service.readInbox(5)

      expect(mockMessageFlagsAdd).toHaveBeenCalledWith(1, ['\\Seen'])
    })

    it('passes from filter to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5, 'sender@example.com')

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ from: 'sender@example.com' })
      )
    })

    it('passes to filter to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5, undefined, 'recipient@example.com')

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'recipient@example.com' })
      )
    })

    it('passes subject filter to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5, undefined, undefined, 'Important')

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ subject: 'Important' })
      )
    })

    it('passes since filter as Date to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])
      const timestamp = 1696118400000 // 2023-10-01

      await service.readInbox(5, undefined, undefined, undefined, timestamp)

      const call = mockSearch.mock.calls[0][0]

      expect(call.since).toBeInstanceOf(Date)
      expect(call.since.getTime()).toBe(timestamp)
    })

    it('passes before filter as Date to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])
      const timestamp = 1696204800000 // 2023-10-02

      await service.readInbox(5, undefined, undefined, undefined, undefined, timestamp)

      const call = mockSearch.mock.calls[0][0]

      expect(call.before).toBeInstanceOf(Date)
      expect(call.before.getTime()).toBe(timestamp)
    })

    it('passes seen filter to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5, undefined, undefined, undefined, undefined, undefined, true)

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ seen: true })
      )
    })

    it('passes answered filter to search criteria', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5, undefined, undefined, undefined, undefined, undefined, undefined, true)

      expect(mockSearch).toHaveBeenCalledWith(
        expect.objectContaining({ answered: true })
      )
    })

    it('omits optional filters when not provided', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5)

      const criteria = mockSearch.mock.calls[0][0]

      expect(criteria).not.toHaveProperty('from')
      expect(criteria).not.toHaveProperty('to')
      expect(criteria).not.toHaveProperty('subject')
      expect(criteria).not.toHaveProperty('since')
      expect(criteria).not.toHaveProperty('before')
    })

    it('creates ImapFlow client with correct config', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5)

      expect(ImapFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          host: TEST_CONFIG.imapHost,
          port: TEST_CONFIG.imapPort,
          secure: TEST_CONFIG.imapUseTLS,
          auth: expect.objectContaining({
            user: TEST_CONFIG.user,
            pass: TEST_CONFIG.password,
          }),
        })
      )
    })

    it('returns empty array when no emails found', async () => {
      mockSearch.mockResolvedValueOnce([])

      const result = await service.readInbox(5)

      expect(result).toEqual([])
    })

    it('disconnects even when an error occurs', async () => {
      mockSearch.mockRejectedValueOnce(new Error('Search failed'))

      await expect(service.readInbox(5)).rejects.toThrow('Search failed')

      expect(mockLogout).toHaveBeenCalled()
    })

    it('throws when connection fails', async () => {
      mockConnect.mockRejectedValueOnce(new Error('Connection refused'))

      await expect(service.readInbox(5)).rejects.toThrow('Connection refused')
    })

    it('includes uid from raw email in parsed result', async () => {
      mockSearch.mockResolvedValueOnce([42])
      mockFetchOne.mockResolvedValueOnce({ source: RAW_EMAIL_SOURCE, uid: '999' })
      mockSimpleParser.mockResolvedValueOnce({
        messageId: '<msg@example.com>',
        from: { value: [] },
        to: { value: [] },
        subject: 'Test',
        date: new Date(),
        text: 'body',
      })

      const result = await service.readInbox(1)

      expect(result[0].uid).toBe('999')
    })

    it('releases mailbox lock after fetching', async () => {
      mockSearch.mockResolvedValueOnce([])

      await service.readInbox(5)

      expect(mockLockRelease).toHaveBeenCalled()
    })
  })

  // ── markEmailAsUnread ──

  describe('markEmailAsUnread', () => {
    it('connects, removes Seen flag, and disconnects', async () => {
      mockFetchOne.mockResolvedValueOnce({ flags: new Set(['\\Seen']) })

      await service.markEmailAsUnread('12345')

      expect(mockConnect).toHaveBeenCalled()
      expect(mockGetMailboxLock).toHaveBeenCalledWith('INBOX')
      expect(mockFetchOne).toHaveBeenCalledWith('12345', { flags: true }, { uid: true })
      expect(mockMessageFlagsRemove).toHaveBeenCalledWith({ uid: '12345' }, ['\\Seen'])
      expect(mockLogout).toHaveBeenCalled()
    })

    it('creates ImapFlow client with correct config', async () => {
      mockFetchOne.mockResolvedValueOnce({ flags: new Set(['\\Seen']) })

      await service.markEmailAsUnread('12345')

      expect(ImapFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          host: TEST_CONFIG.imapHost,
          port: TEST_CONFIG.imapPort,
          secure: TEST_CONFIG.imapUseTLS,
          auth: expect.objectContaining({
            user: TEST_CONFIG.user,
            pass: TEST_CONFIG.password,
          }),
        })
      )
    })

    it('throws when email not found', async () => {
      mockFetchOne.mockResolvedValueOnce(null)

      await expect(service.markEmailAsUnread('99999')).rejects.toThrow('Email with UID 99999 not found')
    })

    it('disconnects even when an error occurs', async () => {
      mockFetchOne.mockRejectedValueOnce(new Error('Fetch failed'))

      await expect(service.markEmailAsUnread('12345')).rejects.toThrow('Fetch failed')

      expect(mockLogout).toHaveBeenCalled()
    })

    it('releases mailbox lock after operation', async () => {
      mockFetchOne.mockResolvedValueOnce({ flags: new Set(['\\Seen']) })

      await service.markEmailAsUnread('12345')

      expect(mockLockRelease).toHaveBeenCalled()
    })
  })

  // ── sendEmail ──

  describe('sendEmail', () => {
    it('creates nodemailer transport with correct SMTP config', async () => {
      mockSendMail.mockImplementationOnce((opts, cb) => cb(null, {
        messageId: '<abc@domain.com>',
        accepted: ['recipient@example.com'],
        rejected: [],
      }))

      await service.sendEmail(
        'John Doe',
        'recipient@example.com',
        'Test Subject',
        'Plain text body'
      )

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: TEST_CONFIG.smtpHost,
          port: TEST_CONFIG.smtpPort,
          secure: TEST_CONFIG.smtpUseTLS,
          auth: expect.objectContaining({
            user: TEST_CONFIG.user,
          }),
        })
      )
    })

    it('sends email with required fields', async () => {
      const sendResult = {
        messageId: '<abc@domain.com>',
        accepted: ['recipient@example.com'],
        rejected: [],
      }

      mockSendMail.mockImplementationOnce((opts, cb) => cb(null, sendResult))

      const result = await service.sendEmail(
        'John Doe',
        'recipient@example.com',
        'Test Subject',
        'Plain text body'
      )

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: `"John Doe" <${ TEST_CONFIG.user }>`,
          to: 'recipient@example.com',
          subject: 'Test Subject',
          text: 'Plain text body',
        }),
        expect.any(Function)
      )
      expect(result).toEqual(sendResult)
    })

    it('sends email with all optional fields', async () => {
      mockSendMail.mockImplementationOnce((opts, cb) => cb(null, { messageId: '<abc@domain.com>' }))

      await service.sendEmail(
        'John Doe',
        'recipient@example.com',
        'Test Subject',
        'Plain text body',
        '<p>HTML body</p>',
        'cc@example.com',
        'bcc@example.com',
        'reply@example.com',
        'high'
      )

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<p>HTML body</p>',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          replyTo: 'reply@example.com',
          priority: 'high',
        }),
        expect.any(Function)
      )
    })

    it('sets undefined for optional fields when not provided', async () => {
      mockSendMail.mockImplementationOnce((opts, cb) => cb(null, { messageId: '<abc@domain.com>' }))

      await service.sendEmail(
        'John Doe',
        'recipient@example.com',
        'Test Subject',
        'Plain text body'
      )

      const callOpts = mockSendMail.mock.calls[0][0]

      expect(callOpts.html).toBeUndefined()
      expect(callOpts.cc).toBeUndefined()
      expect(callOpts.bcc).toBeUndefined()
      expect(callOpts.replyTo).toBeUndefined()
      expect(callOpts.priority).toBeUndefined()
    })

    it('throws when SMTP send fails', async () => {
      mockSendMail.mockImplementationOnce((opts, cb) => cb(new Error('SMTP auth failed')))

      await expect(
        service.sendEmail('John', 'to@example.com', 'Subject', 'Body')
      ).rejects.toThrow('SMTP auth failed')
    })

    it('formats from address with display name and user email', async () => {
      mockSendMail.mockImplementationOnce((opts, cb) => cb(null, { messageId: '<abc@domain.com>' }))

      await service.sendEmail('Display Name', 'to@example.com', 'Subject', 'Body')

      const callOpts = mockSendMail.mock.calls[0][0]

      expect(callOpts.from).toBe(`"Display Name" <${ TEST_CONFIG.user }>`)
    })
  })
})
