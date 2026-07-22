'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Pushbullet Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('pushbullet')
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

  // ── Account ──

  describe('getUserInfo', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getUserInfo()

      expect(result).toHaveProperty('iden')
      expect(result).toHaveProperty('email')
    })
  })

  // ── Devices ──

  describe('devices', () => {
    let createdDeviceIden

    it('lists devices', async () => {
      const result = await service.listDevices()

      expect(result).toHaveProperty('devices')
      expect(Array.isArray(result.devices)).toBe(true)
    })

    it('creates a virtual device', async () => {
      const result = await service.createDevice(`FlowRunner E2E ${ SUFFIX }`, 'System', 'FlowRunner', 'Acme')

      expect(result).toHaveProperty('iden')
      expect(result).toHaveProperty('nickname', `FlowRunner E2E ${ SUFFIX }`)

      createdDeviceIden = result.iden
    })

    it('finds the created device through the dictionary', async () => {
      if (!createdDeviceIden) {
        console.log('Skipping dictionary lookup: device was not created')

        return
      }

      const result = await service.getDevicesDictionary({ search: `FlowRunner E2E ${ SUFFIX }` })

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.cursor).toBeNull()
      expect(result.items.some(item => item.value === createdDeviceIden)).toBe(true)
    })

    it('deletes the created device', async () => {
      if (!createdDeviceIden) {
        console.log('Skipping delete: device was not created')

        return
      }

      await expect(service.deleteDevice(createdDeviceIden)).resolves.toBeDefined()
    })
  })

  // ── Pushes ──

  describe('pushes', () => {
    let notePushIden

    it('sends a note push', async () => {
      const result = await service.pushNote(`E2E Note ${ SUFFIX }`, 'Sent by the FlowRunner e2e suite.')

      expect(result).toHaveProperty('iden')
      expect(result).toHaveProperty('type', 'note')

      notePushIden = result.iden
    })

    it('sends a link push', async () => {
      const result = await service.pushLink(
        `E2E Link ${ SUFFIX }`,
        'https://flowrunner.io',
        'Sent by the FlowRunner e2e suite.'
      )

      expect(result).toHaveProperty('iden')
      expect(result).toHaveProperty('type', 'link')

      await service.deletePush(result.iden)
    })

    it('sends a file push from a URL', async () => {
      const { fileUrl, fileName, fileType } = testValues

      if (!fileUrl || !fileName || !fileType) {
        console.log('Skipping pushFileFromUrl: testValues.fileUrl/fileName/fileType not set')

        return
      }

      const result = await service.pushFileFromUrl(fileUrl, fileName, fileType, 'E2E file push')

      expect(result).toHaveProperty('iden')
      expect(result).toHaveProperty('type', 'file')

      await service.deletePush(result.iden)
    })

    it('lists pushes', async () => {
      const result = await service.listPushes(undefined, true, 5)

      expect(result).toHaveProperty('pushes')
      expect(Array.isArray(result.pushes)).toBe(true)
    })

    it('gets the created push by iden', async () => {
      if (!notePushIden) {
        console.log('Skipping getPush: note push was not created')

        return
      }

      const result = await service.getPush(notePushIden)

      expect(result).toHaveProperty('iden', notePushIden)
    })

    it('returns null for an unknown push iden', async () => {
      const result = await service.getPush(`missing-${ SUFFIX }`)

      expect(result).toBeNull()
    })

    it('dismisses the created push', async () => {
      if (!notePushIden) {
        console.log('Skipping dismissPush: note push was not created')

        return
      }

      const result = await service.dismissPush(notePushIden)

      expect(result).toHaveProperty('dismissed', true)
    })

    it('deletes the created push', async () => {
      if (!notePushIden) {
        console.log('Skipping deletePush: note push was not created')

        return
      }

      await expect(service.deletePush(notePushIden)).resolves.toBeDefined()
    })
  })

  // ── Chats ──

  describe('listChats', () => {
    it('returns the chats collection', async () => {
      const result = await service.listChats()

      expect(result).toHaveProperty('chats')
      expect(Array.isArray(result.chats)).toBe(true)
    })
  })

  // ── SMS ──

  describe('sendSms', () => {
    it('sends an SMS through a connected phone', async () => {
      const { smsDeviceIden, smsRecipient } = testValues

      if (!smsDeviceIden || !smsRecipient) {
        console.log('Skipping sendSms: testValues.smsDeviceIden or testValues.smsRecipient not set')

        return
      }

      const result = await service.sendSms(smsDeviceIden, [smsRecipient], `E2E SMS ${ SUFFIX }`)

      expect(result).toHaveProperty('iden')
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a descriptive error for an unknown device', async () => {
      await expect(service.deleteDevice(`missing-${ SUFFIX }`)).rejects.toThrow(/Pushbullet API error/)
    })
  })
})
