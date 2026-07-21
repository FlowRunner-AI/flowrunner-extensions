'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS ELB Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-elb')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Load Balancers ──

  describe('describeLoadBalancers', () => {
    it('returns load balancers with expected shape', async () => {
      const result = await service.describeLoadBalancers(undefined, undefined, 5)

      expect(result).toHaveProperty('loadBalancers')
      expect(Array.isArray(result.loadBalancers)).toBe(true)
      expect(result).toHaveProperty('marker')

      if (result.loadBalancers.length > 0) {
        const lb = result.loadBalancers[0]

        expect(lb).toHaveProperty('loadBalancerArn')
        expect(lb).toHaveProperty('loadBalancerName')
        expect(lb).toHaveProperty('type')
        expect(lb).toHaveProperty('state')
        expect(lb).toHaveProperty('availabilityZones')
      }
    })
  })

  // ── Target Groups ──

  describe('describeTargetGroups', () => {
    it('returns target groups with expected shape', async () => {
      const result = await service.describeTargetGroups(undefined, undefined, undefined, 5)

      expect(result).toHaveProperty('targetGroups')
      expect(Array.isArray(result.targetGroups)).toBe(true)
      expect(result).toHaveProperty('marker')

      if (result.targetGroups.length > 0) {
        const tg = result.targetGroups[0]

        expect(tg).toHaveProperty('targetGroupArn')
        expect(tg).toHaveProperty('targetGroupName')
        expect(tg).toHaveProperty('targetType')
      }
    })
  })

  // ── Listeners ──

  describe('describeListeners', () => {
    it('returns listeners for a load balancer', async () => {
      const lbs = await service.describeLoadBalancers(undefined, undefined, 1)

      if (lbs.loadBalancers.length === 0) {
        console.log('No load balancers found, skipping describeListeners test')

        return
      }

      const lbArn = lbs.loadBalancers[0].loadBalancerArn
      const result = await service.describeListeners(lbArn)

      expect(result).toHaveProperty('listeners')
      expect(Array.isArray(result.listeners)).toBe(true)
      expect(result).toHaveProperty('marker')

      if (result.listeners.length > 0) {
        const l = result.listeners[0]

        expect(l).toHaveProperty('listenerArn')
        expect(l).toHaveProperty('protocol')
        expect(l).toHaveProperty('port')
      }
    })
  })

  // ── Rules ──

  describe('describeRules', () => {
    it('returns rules for a listener', async () => {
      const lbs = await service.describeLoadBalancers(undefined, undefined, 1)

      if (lbs.loadBalancers.length === 0) {
        console.log('No load balancers found, skipping describeRules test')

        return
      }

      const listeners = await service.describeListeners(lbs.loadBalancers[0].loadBalancerArn, undefined, 1)

      if (listeners.listeners.length === 0) {
        console.log('No listeners found, skipping describeRules test')

        return
      }

      const result = await service.describeRules(listeners.listeners[0].listenerArn)

      expect(result).toHaveProperty('rules')
      expect(Array.isArray(result.rules)).toBe(true)

      if (result.rules.length > 0) {
        const r = result.rules[0]

        expect(r).toHaveProperty('ruleArn')
        expect(r).toHaveProperty('priority')
        expect(r).toHaveProperty('isDefault')
      }
    })
  })

  // ── Tags ──

  describe('describeTags', () => {
    it('returns tags for a load balancer', async () => {
      const lbs = await service.describeLoadBalancers(undefined, undefined, 1)

      if (lbs.loadBalancers.length === 0) {
        console.log('No load balancers found, skipping describeTags test')

        return
      }

      const result = await service.describeTags([lbs.loadBalancers[0].loadBalancerArn])

      expect(result).toHaveProperty('tagDescriptions')
      expect(Array.isArray(result.tagDescriptions)).toBe(true)

      if (result.tagDescriptions.length > 0) {
        expect(result.tagDescriptions[0]).toHaveProperty('resourceArn')
        expect(result.tagDescriptions[0]).toHaveProperty('tags')
      }
    })
  })

  // ── Dictionaries ──

  describe('getLoadBalancersDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getLoadBalancersDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  describe('getTargetGroupsDictionary', () => {
    it('returns dictionary items with correct shape', async () => {
      const result = await service.getTargetGroupsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })
  })

  // ── Target Group Lifecycle (create + describe health + delete) ──

  describe('target group lifecycle', () => {
    let createdTgArn

    it('creates a target group', async () => {
      const result = await service.createTargetGroup(
        `e2e-test-${ Date.now() }`.slice(0, 32),
        'HTTP',
        80,
        undefined,
        'IP',
        'HTTP',
        '/health'
      )

      expect(result).toHaveProperty('targetGroup')
      expect(result.targetGroup).toHaveProperty('targetGroupArn')
      expect(result.targetGroup).toHaveProperty('targetGroupName')
      createdTgArn = result.targetGroup.targetGroupArn
    })

    it('describes health of the created target group (empty)', async () => {
      if (!createdTgArn) {
        console.log('Target group not created, skipping')

        return
      }

      const result = await service.describeTargetHealth(createdTgArn)

      expect(result).toHaveProperty('targetHealthDescriptions')
      expect(Array.isArray(result.targetHealthDescriptions)).toBe(true)
    })

    it('deletes the created target group', async () => {
      if (!createdTgArn) {
        console.log('Target group not created, skipping')

        return
      }

      const result = await service.deleteTargetGroup(createdTgArn)

      expect(result).toEqual({ deleted: true, targetGroupArn: createdTgArn })
    })
  })
})
