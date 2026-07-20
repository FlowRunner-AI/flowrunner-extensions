'use strict'

/**
 * FlowRunner Service Sandbox
 *
 * Provides a mock/real Flowrunner global namespace so that service entry files
 * (`src/index.js`) can be required in a test environment. After requiring the
 * service file, `Flowrunner.ServerCode.addService()` will have been called,
 * and the sandbox exposes the registered service instance for testing.
 *
 * Unit tests (mocked HTTP):
 *
 *   const { createSandbox } = require('../../service-sandbox')
 *   const sandbox = createSandbox({ apiKey: 'test-key' })
 *   require('../src/index.js')
 *   const service = sandbox.getService()
 *
 * E2E tests (real HTTP):
 *
 *   const { createE2ESandbox } = require('../../service-sandbox')
 *   const sandbox = createE2ESandbox('brevo')
 *   require('../src/index.js')
 *   const service = sandbox.getService()
 *   const { recipientEmail } = sandbox.getTestValues()
 */

const fs = require('fs')
const path = require('path')
const { createRequestMock } = require('./request-mock')
const { createRealRequest } = require('./request-real')

const E2E_CONFIG_PATH = path.join(__dirname, 'e2e-config.json')

function buildFlowrunner(request) {
  let registeredService = null
  let registeredConfigItems = null
  let config = {}

  const Flowrunner = {
    ServerCode: {
      addService(ServiceClass, configItems) {
        registeredConfigItems = configItems
        registeredService = new ServiceClass(config)
      },

      ConfigItems: {
        TYPES: {
          STRING: 'STRING',
          BOOL: 'BOOL',
          DATE: 'DATE',
          CHOICE: 'CHOICE',
          TEXT: 'TEXT',
        },
      },
    },

    Request: request,
  }

  return {
    Flowrunner,
    setConfig(c) { config = c },
    getRegisteredService() { return registeredService },
    getRegisteredConfigItems() { return registeredConfigItems },
    reset() {
      registeredService = null
      registeredConfigItems = null
      config = {}
    },
  }
}

/**
 * Create a sandbox with mocked HTTP requests (for unit tests).
 */
function createSandbox(config = {}) {
  const requestMock = createRequestMock()
  const runtime = buildFlowrunner(requestMock.Request)

  runtime.setConfig(config)
  global.Flowrunner = runtime.Flowrunner

  return {
    getService() {
      const svc = runtime.getRegisteredService()

      if (!svc) {
        throw new Error(
          'No service registered. Make sure you require() the service entry file after createSandbox().'
        )
      }

      return svc
    },

    getConfigItems() {
      return runtime.getRegisteredConfigItems()
    },

    getRequestMock() {
      return requestMock
    },

    cleanup() {
      delete global.Flowrunner
      runtime.reset()
      requestMock.reset()
    },
  }
}

/**
 * Create a sandbox with real HTTP requests (for e2e tests).
 * Loads config from service-sandbox/e2e-config.json by service id.
 * If e2e-config.json doesn't exist, it is created from e2e-config.example.json.
 *
 * @param {string} serviceId - Key in e2e-config.json (e.g. 'brevo', 'telegram')
 */
function createE2ESandbox(serviceId) {
  if (!fs.existsSync(E2E_CONFIG_PATH)) {
    fs.writeFileSync(E2E_CONFIG_PATH, '{}\n')
  }

  const configValues = JSON.parse(fs.readFileSync(E2E_CONFIG_PATH, 'utf8'))

  if (!configValues[serviceId]) {
    configValues[serviceId] = { configs: {}, testValues: {} }
    fs.writeFileSync(E2E_CONFIG_PATH, JSON.stringify(configValues, null, 2) + '\n')
  }

  const serviceEntry = configValues[serviceId]

  const configs = serviceEntry.configs || {}
  const testValues = serviceEntry.testValues || {}

  const realRequest = createRealRequest()
  const runtime = buildFlowrunner(realRequest)

  runtime.setConfig(configs)
  global.Flowrunner = runtime.Flowrunner

  return {
    getService() {
      const svc = runtime.getRegisteredService()

      if (!svc) {
        throw new Error(
          'No service registered. Make sure you require() the service entry file after createE2ESandbox().'
        )
      }

      return svc
    },

    validateConfigs() {
      const configItems = runtime.getRegisteredConfigItems() || []
      const missing = configItems
        .filter(item => item.required && !configs[item.name])
        .map(item => item.name)

      if (missing.length) {
        for (const name of missing) {
          configs[name] = ''
        }

        configValues[serviceId].configs = configs
        fs.writeFileSync(E2E_CONFIG_PATH, JSON.stringify(configValues, null, 2) + '\n')

        throw new Error(
          `Missing required config values for "${serviceId}": ${missing.join(', ')}\n` +
          `Empty placeholders added to e2e-config.json — fill them in and re-run.`
        )
      }
    },

    getTestValues() {
      return testValues
    },

    getConfigItems() {
      return runtime.getRegisteredConfigItems()
    },

    cleanup() {
      delete global.Flowrunner
      runtime.reset()
    },
  }
}

module.exports = { createSandbox, createE2ESandbox }
