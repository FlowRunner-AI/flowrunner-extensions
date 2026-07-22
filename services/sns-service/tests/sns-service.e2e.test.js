'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Amazon SNS Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let credentialsReady

  beforeAll(() => {
    sandbox = createE2ESandbox('sns-service')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()

    // accessKeyId/secretAccessKey are optional config items, so validateConfigs cannot enforce
    // them. Without them every call would fail, so the suite skips instead.
    credentialsReady = Boolean(service.credentials.accessKeyId && service.credentials.secretAccessKey)

    if (!credentialsReady) {
      console.log('Skipping SNS e2e calls: configs.accessKeyId / configs.secretAccessKey not set')
    }
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Parameter validation (no network) ──

  describe('parameter validation', () => {
    it('rejects a publish without a message', async () => {
      await expect(service.publish('arn:aws:sns:us-east-1:1:T', undefined, '')).rejects.toThrow('message is required.')
    })

    it('rejects a publish without a destination', async () => {
      await expect(service.publish(undefined, undefined, 'Hello')).rejects.toThrow(
        'Either topicArn or phoneNumber is required.'
      )
    })

    it('rejects a topic creation without a name', async () => {
      await expect(service.createTopic('')).rejects.toThrow('name is required.')
    })

    it('rejects a subscribe without required values', async () => {
      await expect(service.subscribe('', 'email', 'a@b.com')).rejects.toThrow('topicArn is required.')
      await expect(service.subscribe('arn', '', 'a@b.com')).rejects.toThrow('protocol is required.')
      await expect(service.subscribe('arn', 'email', '')).rejects.toThrow('endpoint is required.')
    })

    it('rejects a delete/unsubscribe without an ARN', async () => {
      await expect(service.deleteTopic('')).rejects.toThrow('topicArn is required.')
      await expect(service.unsubscribe('')).rejects.toThrow('subscriptionArn is required.')
    })
  })

  // ── Topic lifecycle ──

  describe('topic lifecycle', () => {
    let topicArn
    let subscriptionArn

    it('creates a topic', async () => {
      if (!credentialsReady) {
        return
      }

      const result = await service.createTopic(`flowrunner-e2e-${ SUFFIX }`)

      expect(result).toHaveProperty('topicArn')
      expect(result.topicArn).toMatch(/^arn:aws:sns:/)

      topicArn = result.topicArn
    })

    it('lists the topic through the dictionary', async () => {
      if (!credentialsReady) {
        return
      }

      const result = await service.listTopicsDictionary({ search: `flowrunner-e2e-${ SUFFIX }` })

      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.some(item => item.value === topicArn)).toBe(true)
      expect(result.items[0]).toHaveProperty('label')
    })

    it('returns all topics for an empty payload', async () => {
      if (!credentialsReady) {
        return
      }

      const result = await service.listTopicsDictionary(null)

      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')
    })

    it('publishes a message to the topic', async () => {
      if (!credentialsReady) {
        return
      }

      const result = await service.publish(topicArn, undefined, 'FlowRunner e2e message', 'FlowRunner e2e')

      expect(result).toHaveProperty('messageId')
      expect(typeof result.messageId).toBe('string')
    })

    it('subscribes an endpoint to the topic', async () => {
      const { subscriptionEmail } = testValues

      if (!credentialsReady || !subscriptionEmail) {
        console.log('Skipping subscribe: testValues.subscriptionEmail not set')

        return
      }

      const result = await service.subscribe(topicArn, 'email', subscriptionEmail)

      expect(result).toHaveProperty('subscriptionArn')

      subscriptionArn = result.subscriptionArn
    })

    it('unsubscribes the endpoint', async () => {
      if (!credentialsReady || !subscriptionArn || subscriptionArn === 'pending confirmation') {
        console.log('Skipping unsubscribe: no confirmed subscription ARN')

        return
      }

      await expect(service.unsubscribe(subscriptionArn)).resolves.toEqual({ success: true })
    })

    it('deletes the topic', async () => {
      if (!credentialsReady) {
        return
      }

      await expect(service.deleteTopic(topicArn)).resolves.toEqual({ success: true })
    })
  })

  // ── SMS ──

  describe('SMS publish', () => {
    it('sends an SMS to a phone number', async () => {
      const { phoneNumber } = testValues

      if (!credentialsReady || !phoneNumber) {
        console.log('Skipping SMS publish: testValues.phoneNumber not set')

        return
      }

      const result = await service.publish(undefined, phoneNumber, `FlowRunner e2e ${ SUFFIX }`)

      expect(result).toHaveProperty('messageId')
    })
  })

  // ── Error surfaces ──

  describe('error handling', () => {
    it('reports a helpful error for an unknown topic ARN', async () => {
      if (!credentialsReady) {
        return
      }

      const region = service.region
      const bogus = `arn:aws:sns:${ region }:000000000000:flowrunner-missing-${ SUFFIX }`

      await expect(service.publish(bogus, undefined, 'nope')).rejects.toThrow(/./)
    })
  })
})
