'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

/**
 * These e2e tests make real, signed AWS API calls.
 *
 * Fill in service-sandbox/e2e-config.json:
 *   "sqs-service": {
 *     "configs": {
 *       "authenticationMethod": "API Key",
 *       "region": "us-east-1",
 *       "accessKeyId": "AKIA...",
 *       "secretAccessKey": "..."
 *     },
 *     "testValues": {
 *       "queueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/flowrunner-e2e",
 *       "fifoQueueUrl": "https://sqs.us-east-1.amazonaws.com/123456789012/flowrunner-e2e.fifo"
 *     }
 *   }
 *
 * Prerequisites: a standard SQS queue the credentials may send to, receive from and
 * delete from. Optionally a FIFO queue for the ordering test. Every test that needs a
 * queue skips gracefully when the corresponding testValue is absent.
 */
describe('Amazon SQS Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  const QUEUE = () => testValues && testValues.queueUrl
  const FIFO_QUEUE = () => testValues && testValues.fifoQueueUrl

  beforeAll(() => {
    sandbox = createE2ESandbox('sqs-service')
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

  // ── Validation (no AWS call required) ──

  describe('argument validation', () => {
    it('rejects missing arguments before calling AWS', async () => {
      await expect(service.sendMessage('', 'body')).rejects.toThrow('queueUrl is required.')
      await expect(service.sendMessage('https://x', '')).rejects.toThrow('messageBody is required.')

      await expect(service.sendMessageBatch('https://x', [])).rejects.toThrow(
        'entries must be a non-empty array.'
      )

      await expect(service.receiveMessage('')).rejects.toThrow('queueUrl is required.')

      await expect(service.deleteMessage('https://x', '')).rejects.toThrow(
        'receiptHandle is required.'
      )

      await expect(service.getQueueAttributes('')).rejects.toThrow('queueUrl is required.')
    })
  })

  // ── Dictionary ──

  describe('listQueuesDictionary', () => {
    it('lists the queues in the configured region', async () => {
      const result = await service.listQueuesDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters by a queue name prefix', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping listQueuesDictionary filter: testValues.queueUrl not set')

        return
      }

      const name = queueUrl.split('/').pop()
      const result = await service.listQueuesDictionary({ search: name })

      expect(result.items.map(item => item.value)).toContain(queueUrl)
    })
  })

  // ── Queue attributes ──

  describe('getQueueAttributes', () => {
    it('returns all attributes of the test queue', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping getQueueAttributes: testValues.queueUrl not set')

        return
      }

      const result = await service.getQueueAttributes(queueUrl)

      expect(result.attributes).toHaveProperty('QueueArn')
      expect(result.attributes).toHaveProperty('ApproximateNumberOfMessages')
    })

    it('returns only the requested attributes', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping getQueueAttributes subset: testValues.queueUrl not set')

        return
      }

      const result = await service.getQueueAttributes(queueUrl, ['QueueArn'])

      expect(Object.keys(result.attributes)).toEqual(['QueueArn'])
    })

    it('reports a missing queue clearly', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping missing queue check: testValues.queueUrl not set')

        return
      }

      const missing = `${ queueUrl.split('/').slice(0, -1).join('/') }/no-such-queue-e2e`

      await expect(service.getQueueAttributes(missing)).rejects.toThrow()
    })
  })

  // ── Message lifecycle ──

  describe('message lifecycle', () => {
    it('sends, receives and deletes a message', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping message lifecycle: testValues.queueUrl not set')

        return
      }

      const marker = `flowrunner-e2e-${ Date.now() }`
      const sent = await service.sendMessage(queueUrl, marker)

      expect(sent).toHaveProperty('messageId')
      expect(typeof sent.messageId).toBe('string')

      let received = { messages: [] }

      // Long-poll a few times: standard queues deliver at-least-once, eventually.
      for (let attempt = 0; attempt < 5 && !received.messages.length; attempt++) {
        received = await service.receiveMessage(queueUrl, 10, 5)
      }

      const match = received.messages.find(message => message.body === marker)

      expect(match).toBeDefined()
      expect(match).toHaveProperty('receiptHandle')
      expect(match).toHaveProperty('md5OfBody')
      expect(match.attributes).toHaveProperty('SentTimestamp')

      await expect(service.deleteMessage(queueUrl, match.receiptHandle)).resolves.toEqual({
        success: true,
      })
    })

    it('sends a batch and drains it', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping batch lifecycle: testValues.queueUrl not set')

        return
      }

      const stamp = Date.now()

      const result = await service.sendMessageBatch(queueUrl, [
        { id: 'msg1', messageBody: `batch-1-${ stamp }` },
        { id: 'msg2', messageBody: `batch-2-${ stamp }`, delaySeconds: 0 },
      ])

      expect(result.failed).toEqual([])
      expect(result.successful.map(entry => entry.id).sort()).toEqual(['msg1', 'msg2'])

      let drained = 0

      for (let attempt = 0; attempt < 5 && drained < 2; attempt++) {
        const received = await service.receiveMessage(queueUrl, 10, 5)

        for (const message of received.messages) {
          if (message.body.includes(`-${ stamp }`)) {
            drained += 1
          }

          await service.deleteMessage(queueUrl, message.receiptHandle)
        }
      }

      expect(drained).toBe(2)
    })

    it('sends an ordered message to a FIFO queue', async () => {
      const fifoUrl = FIFO_QUEUE()

      if (!fifoUrl) {
        console.log('Skipping FIFO send: testValues.fifoQueueUrl not set')

        return
      }

      const result = await service.sendMessage(
        fifoUrl,
        `fifo-${ Date.now() }`,
        null,
        'flowrunner-e2e-group',
        `dedup-${ Date.now() }`
      )

      expect(result).toHaveProperty('messageId')
      expect(result.sequenceNumber).not.toBeNull()

      const received = await service.receiveMessage(fifoUrl, 10, 5)

      for (const message of received.messages) {
        await service.deleteMessage(fifoUrl, message.receiptHandle)
      }
    })

    it('rejects an invalid receipt handle', async () => {
      const queueUrl = QUEUE()

      if (!queueUrl) {
        console.log('Skipping invalid receipt handle: testValues.queueUrl not set')

        return
      }

      await expect(service.deleteMessage(queueUrl, 'not-a-real-handle')).rejects.toThrow()
    })
  })
})
