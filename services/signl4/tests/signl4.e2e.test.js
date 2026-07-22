'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('SIGNL4 Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('signl4')
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

  // ── Alerting ──
  //
  // Sending an alert pages the on-call team, so it only runs when the developer
  // explicitly opts in with testValues.sendAlert = true. The alert is resolved
  // immediately afterwards using the same External ID.

  describe('sendAlert + resolveAlert', () => {
    it('raises and resolves an alert when explicitly enabled', async () => {
      if (!testValues.sendAlert) {
        console.log('Skipping sendAlert/resolveAlert: testValues.sendAlert not set to true')

        return
      }

      const externalId = `flowrunner-e2e-${ Date.now() }`

      const created = await service.sendAlert(
        'FlowRunner e2e test alert',
        'Automated test alert raised by the FlowRunner e2e suite. Safe to ignore.',
        'Single ACK',
        externalId,
        'FlowRunner Tests',
        undefined,
        false,
        'FlowRunner'
      )

      expect(created).toBeDefined()
      expect(typeof created === 'object' || typeof created === 'string').toBe(true)

      const resolved = await service.resolveAlert(externalId)

      expect(resolved).toBeDefined()
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('rejects a resolve request for an unknown external id or resolves it as a no-op', async () => {
      if (!testValues.sendAlert) {
        console.log('Skipping resolveAlert error path: testValues.sendAlert not set to true')

        return
      }

      await expect(service.resolveAlert(`flowrunner-e2e-unknown-${ Date.now() }`)).resolves.toBeDefined()
    })
  })
})
