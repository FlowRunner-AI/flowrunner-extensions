'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('UptimeRobot Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('uptimerobot')
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

  describe('getAccountDetails', () => {
    it('returns the account details (connection check)', async () => {
      const result = await service.getAccountDetails()

      expect(result).toHaveProperty('stat', 'ok')
      expect(result).toHaveProperty('account')
      expect(result.account).toHaveProperty('monitor_limit')
    })
  })

  // ── Monitors ──

  describe('getMonitors', () => {
    it('returns monitors with pagination', async () => {
      const result = await service.getMonitors(undefined, undefined, undefined, undefined, false, false, 0, 10)

      expect(result).toHaveProperty('stat', 'ok')
      expect(Array.isArray(result.monitors)).toBe(true)
      expect(result).toHaveProperty('pagination')
    })

    it('accepts type and status filters', async () => {
      const result = await service.getMonitors(undefined, undefined, ['HTTP(S)'], ['Up', 'Paused'], false, false, 0, 5)

      expect(result).toHaveProperty('stat', 'ok')
      expect(Array.isArray(result.monitors)).toBe(true)
    })
  })

  describe('createMonitor + editMonitor + resetMonitor + deleteMonitor', () => {
    let monitorId

    it('creates a monitor', async () => {
      const name = `E2E Monitor ${ Date.now() }`
      const result = await service.createMonitor(name, 'https://example.com', 'HTTP(S)', 300)

      expect(result).toHaveProperty('stat', 'ok')
      expect(result.monitor).toHaveProperty('id')

      monitorId = String(result.monitor.id)
    })

    it('pauses the monitor', async () => {
      if (!monitorId) {
        console.log('Skipping editMonitor: no monitor was created')

        return
      }

      const result = await service.editMonitor(monitorId, undefined, undefined, undefined, 'Paused')

      expect(result).toHaveProperty('stat', 'ok')
    })

    it('renames the monitor', async () => {
      if (!monitorId) {
        console.log('Skipping editMonitor rename: no monitor was created')

        return
      }

      const result = await service.editMonitor(monitorId, `E2E Renamed ${ Date.now() }`)

      expect(result).toHaveProperty('stat', 'ok')
    })

    it('resets the monitor', async () => {
      if (!monitorId) {
        console.log('Skipping resetMonitor: no monitor was created')

        return
      }

      const result = await service.resetMonitor(monitorId)

      expect(result).toHaveProperty('stat', 'ok')
    })

    it('deletes the monitor', async () => {
      if (!monitorId) {
        console.log('Skipping deleteMonitor: no monitor was created')

        return
      }

      const result = await service.deleteMonitor(monitorId)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  // ── Alert contacts ──

  describe('getAlertContacts', () => {
    it('returns alert contacts', async () => {
      const result = await service.getAlertContacts(undefined, 0, 10)

      expect(result).toHaveProperty('stat', 'ok')
      expect(Array.isArray(result.alert_contacts)).toBe(true)
    })
  })

  describe('createAlertContact + deleteAlertContact', () => {
    let contactId

    it('creates an alert contact', async () => {
      const { alertContactEmail } = testValues

      if (!alertContactEmail) {
        console.log('Skipping createAlertContact: testValues.alertContactEmail not set')

        return
      }

      const result = await service.createAlertContact('E-mail', alertContactEmail, `E2E Contact ${ Date.now() }`)

      expect(result).toHaveProperty('stat', 'ok')
      expect(result.alertcontact).toHaveProperty('id')

      contactId = String(result.alertcontact.id)
    })

    it('deletes the alert contact', async () => {
      if (!contactId) {
        console.log('Skipping deleteAlertContact: no contact was created')

        return
      }

      const result = await service.deleteAlertContact(contactId)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  // ── Maintenance windows ──

  describe('getMWindows', () => {
    it('returns maintenance windows', async () => {
      const result = await service.getMWindows(undefined, 0, 10)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  describe('createMWindow + deleteMWindow', () => {
    let mwindowId

    it('creates a daily maintenance window', async () => {
      let result

      try {
        result = await service.createMWindow('Daily', `E2E MW ${ Date.now() }`, '03:00', 30)
      } catch (error) {
        console.log(`Skipping createMWindow: plan may not support maintenance windows (${ error.message })`)

        return
      }

      expect(result).toHaveProperty('stat', 'ok')
      expect(result.mwindow).toHaveProperty('id')
      mwindowId = String(result.mwindow.id)
    })

    it('deletes the maintenance window', async () => {
      if (!mwindowId) {
        console.log('Skipping deleteMWindow: no maintenance window was created')

        return
      }

      const result = await service.deleteMWindow(mwindowId)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  // ── Public status pages ──

  describe('getPSPs', () => {
    it('returns public status pages', async () => {
      const result = await service.getPSPs(undefined, 0, 10)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  describe('createPSP + deletePSP', () => {
    let pspId

    it('creates a public status page', async () => {
      let result

      try {
        result = await service.createPSP(`E2E PSP ${ Date.now() }`, '0', undefined, 'Friendly Name (A-Z)')
      } catch (error) {
        console.log(`Skipping createPSP: plan may not support public status pages (${ error.message })`)

        return
      }

      expect(result).toHaveProperty('stat', 'ok')
      expect(result.psp).toHaveProperty('id')
      pspId = String(result.psp.id)
    })

    it('deletes the public status page', async () => {
      if (!pspId) {
        console.log('Skipping deletePSP: no public status page was created')

        return
      }

      const result = await service.deletePSP(pspId)

      expect(result).toHaveProperty('stat', 'ok')
    })
  })

  // ── Dictionaries ──

  describe('getMonitorsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getMonitorsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })
  })

  describe('getAlertContactsDictionary', () => {
    it('returns dictionary items', async () => {
      const result = await service.getAlertContactsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
