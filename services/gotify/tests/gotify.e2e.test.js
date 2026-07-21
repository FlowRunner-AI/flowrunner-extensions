'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Gotify Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('gotify')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // ── System (no auth) ──

  describe('getHealth', () => {
    it('returns server health with expected shape', async () => {
      const response = await service.getHealth()

      expect(response).toHaveProperty('health')
      expect(response).toHaveProperty('database')
    })
  })

  describe('getVersion', () => {
    it('returns server version with expected shape', async () => {
      const response = await service.getVersion()

      expect(response).toHaveProperty('version')
    })
  })

  // ── Messages (app token) ──

  describe('createMessage', () => {
    it('sends a push notification using the application token', async () => {
      const response = await service.createMessage(
        `E2E test message ${ suffix }`,
        'E2E Test',
        5
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('message')
    })
  })

  // ── Messages (client token) ──

  describe('getMessages', () => {
    it('returns messages with expected shape', async () => {
      const response = await service.getMessages(10)

      expect(response).toHaveProperty('messages')
      expect(Array.isArray(response.messages)).toBe(true)
      expect(response).toHaveProperty('paging')
    })
  })

  // ── Applications (client token) ──

  describe('getApplications', () => {
    it('returns an array of applications', async () => {
      const response = await service.getApplications()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getApplicationsDictionary', () => {
    it('returns dictionary items array with a null cursor', async () => {
      const result = await service.getApplicationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)
    })
  })

  describe('createApplication + updateApplication + getApplicationMessages + deleteApplication', () => {
    let applicationId

    it('creates an application', async () => {
      const response = await service.createApplication(
        `E2E App ${ suffix }`,
        'Created by an automated e2e test',
        4
      )

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('token')
      applicationId = response.id
    })

    it('updates the application', async () => {
      const response = await service.updateApplication(
        applicationId,
        `E2E App Updated ${ suffix }`,
        'Updated by an automated e2e test',
        6
      )

      expect(response).toHaveProperty('id', applicationId)
      expect(response).toHaveProperty('name', `E2E App Updated ${ suffix }`)
    })

    it('lists messages for the application', async () => {
      const response = await service.getApplicationMessages(applicationId, 10)

      expect(response).toHaveProperty('messages')
      expect(Array.isArray(response.messages)).toBe(true)
    })

    it('deletes the application', async () => {
      const response = await service.deleteApplication(applicationId)

      expect(response).toEqual({ success: true })
    })
  })

  describe('uploadApplicationImage', () => {
    // Uploading an image needs a reachable public image URL and a throwaway app.
    // Runs only when the developer supplies testValues.imageUrl.
    const canUpload = () => Boolean(testValues.imageUrl)

    it('uploads an image to a throwaway application when imageUrl is configured', async () => {
      if (!canUpload()) {
        console.log('Skipping uploadApplicationImage: set testValues.imageUrl')
        return
      }

      const app = await service.createApplication(`E2E Image App ${ suffix }`)

      try {
        const response = await service.uploadApplicationImage(app.id, testValues.imageUrl)

        expect(response).toHaveProperty('id', app.id)
        expect(response).toHaveProperty('image')
      } finally {
        await service.deleteApplication(app.id)
      }
    })
  })

  // ── Clients (client token) ──

  describe('getClients', () => {
    it('returns an array of clients', async () => {
      const response = await service.getClients()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('createClient + deleteClient', () => {
    let clientId

    it('creates a client', async () => {
      const response = await service.createClient(`E2E Client ${ suffix }`)

      expect(response).toHaveProperty('id')
      expect(response).toHaveProperty('token')
      clientId = response.id
    })

    it('deletes the client', async () => {
      const response = await service.deleteClient(clientId)

      expect(response).toEqual({ success: true })
    })
  })

  // ── Message lifecycle (create via app token, delete via client token) ──

  describe('createMessage + deleteMessage', () => {
    it('creates a message then deletes it by id', async () => {
      const created = await service.createMessage(`E2E deletable message ${ suffix }`, 'E2E', 3)

      expect(created).toHaveProperty('id')

      const response = await service.deleteMessage(created.id)

      expect(response).toEqual({ success: true })
    })
  })
})
