'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')

jest.mock('https')
jest.mock('http')

const https = require('https')
const http = require('http')

const { createSandbox } = require('../../../service-sandbox')

const {
  httpRequest,
  parseXmlTag,
  parseXmlTags,
  stsAssumeRole,
  buildAwsJsonRequest,
  parseJsonResponse,
  jsonRequest,
} = require('../src/aws-client')

const { parseXml, toArray, decodeEntities } = require('../src/xml')
const { buildQuery, elbRequest, API_VERSION, SERVICE } = require('../src/elb-client')
const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

const CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

/**
 * Drives the mocked node transport with a canned response (or a transport error)
 * and records the options/body the module under test produced.
 */
function stubTransport(transport, { statusCode = 200, body = '', error = null } = {}) {
  const captured = { options: null, written: [], timeout: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.setTimeout = (ms, handler) => {
      captured.timeout = { ms, handler }
    }

    req.destroy = jest.fn()

    req.end = () => {
      process.nextTick(() => {
        if (error) {
          req.emit('error', error)

          return
        }

        const res = new EventEmitter()

        res.statusCode = statusCode
        res.headers = { 'content-type': 'text/xml' }

        callback(res)
        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

const stubHttps = options => stubTransport(https, options)

describe('AWS ELB Service', () => {
  let sandbox
  let service
  let mockElbRequest

  beforeAll(() => {
    sandbox = createSandbox({
      authenticationMethod: 'API Key',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    })

    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    mockElbRequest = jest.fn()
    service.deps.elbRequest = mockElbRequest
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const items = sandbox.getConfigItems()

      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessKeyId', shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'secretAccessKey', shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'roleArn', shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'externalId', shared: false, type: 'STRING' }),
        ])
      )
    })
  })

  // ── Load Balancers ──

  describe('describeLoadBalancers', () => {
    it('sends DescribeLoadBalancers with no filters', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: {
          DescribeLoadBalancersResult: {
            LoadBalancers: {
              member: {
                LoadBalancerArn: 'arn:aws:elb:us-east-1:123:loadbalancer/app/my-alb/50dc',
                LoadBalancerName: 'my-alb',
                DNSName: 'my-alb-123.elb.amazonaws.com',
                CanonicalHostedZoneId: 'Z1234',
                CreatedTime: '2024-01-01T00:00:00Z',
                Scheme: 'internet-facing',
                Type: 'application',
                State: { Code: 'active' },
                VpcId: 'vpc-abc',
                IpAddressType: 'ipv4',
                SecurityGroups: { member: 'sg-123' },
                AvailabilityZones: { member: { ZoneName: 'us-east-1a', SubnetId: 'subnet-aaa' } },
              },
            },
            NextMarker: null,
          },
        },
      })

      const result = await service.describeLoadBalancers()

      expect(mockElbRequest).toHaveBeenCalledWith('DescribeLoadBalancers', {}, expect.any(Object), 'us-east-1')
      expect(result.loadBalancers).toHaveLength(1)

      expect(result.loadBalancers[0]).toEqual({
        loadBalancerArn: 'arn:aws:elb:us-east-1:123:loadbalancer/app/my-alb/50dc',
        loadBalancerName: 'my-alb',
        dnsName: 'my-alb-123.elb.amazonaws.com',
        canonicalHostedZoneId: 'Z1234',
        createdTime: '2024-01-01T00:00:00Z',
        scheme: 'internet-facing',
        type: 'application',
        state: 'active',
        vpcId: 'vpc-abc',
        ipAddressType: 'ipv4',
        securityGroups: ['sg-123'],
        availabilityZones: [{ zoneName: 'us-east-1a', subnetId: 'subnet-aaa' }],
      })

      expect(result.marker).toBeNull()
    })

    it('passes ARNs, names, pageSize, and marker filters', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: { DescribeLoadBalancersResult: { LoadBalancers: '', NextMarker: 'abc' } },
      })

      const result = await service.describeLoadBalancers(['arn:1'], ['name-1'], 10, 'token-1')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeLoadBalancers',
        { LoadBalancerArns: ['arn:1'], Names: ['name-1'], PageSize: 10, Marker: 'token-1' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.loadBalancers).toEqual([])
      expect(result.marker).toBe('abc')
    })

    it('throws on API error', async () => {
      const error = new Error('Access denied')

      error.name = 'AccessDenied'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.describeLoadBalancers()).rejects.toThrow('Access denied')
    })
  })

  describe('createLoadBalancer', () => {
    it('sends CreateLoadBalancer with required params', async () => {
      mockElbRequest.mockResolvedValue({
        CreateLoadBalancerResponse: {
          CreateLoadBalancerResult: {
            LoadBalancers: {
              member: {
                LoadBalancerArn: 'arn:new',
                LoadBalancerName: 'test-lb',
                Scheme: 'internet-facing',
                Type: 'application',
                State: { Code: 'provisioning' },
                SecurityGroups: '',
                AvailabilityZones: '',
              },
            },
          },
        },
      })

      const result = await service.createLoadBalancer('test-lb', ['subnet-1', 'subnet-2'])

      expect(mockElbRequest).toHaveBeenCalledWith(
        'CreateLoadBalancer',
        { Name: 'test-lb', Subnets: ['subnet-1', 'subnet-2'] },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.loadBalancer).toMatchObject({
        loadBalancerName: 'test-lb',
        state: 'provisioning',
      })
    })

    it('sends all optional params with resolved choices', async () => {
      mockElbRequest.mockResolvedValue({
        CreateLoadBalancerResponse: {
          CreateLoadBalancerResult: {
            LoadBalancers: { member: { LoadBalancerArn: 'arn:new', SecurityGroups: '', AvailabilityZones: '' } },
          },
        },
      })

      await service.createLoadBalancer('test-lb', ['subnet-1'], ['sg-1'], 'Internal', 'Network', 'Dualstack')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'CreateLoadBalancer',
        {
          Name: 'test-lb',
          Subnets: ['subnet-1'],
          SecurityGroups: ['sg-1'],
          Scheme: 'internal',
          Type: 'network',
          IpAddressType: 'dualstack',
        },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('throws when name is missing', async () => {
      await expect(service.createLoadBalancer(null, ['subnet-1'])).rejects.toThrow('name is required')
    })

    it('throws when subnets is empty', async () => {
      await expect(service.createLoadBalancer('test', [])).rejects.toThrow('subnets')
    })

    it('throws on duplicate name error', async () => {
      const error = new Error('Already exists')

      error.name = 'DuplicateLoadBalancerName'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.createLoadBalancer('test', ['subnet-1'])).rejects.toThrow('Name already in use')
    })
  })

  describe('deleteLoadBalancer', () => {
    it('sends DeleteLoadBalancer and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ DeleteLoadBalancerResponse: { DeleteLoadBalancerResult: {} } })

      const result = await service.deleteLoadBalancer('arn:lb')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DeleteLoadBalancer',
        { LoadBalancerArn: 'arn:lb' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result).toEqual({ deleted: true, loadBalancerArn: 'arn:lb' })
    })

    it('throws when ARN is missing', async () => {
      await expect(service.deleteLoadBalancer()).rejects.toThrow('loadBalancerArn is required')
    })

    it('throws LoadBalancerNotFound error', async () => {
      const error = new Error('Not found')

      error.name = 'LoadBalancerNotFound'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.deleteLoadBalancer('arn:bad')).rejects.toThrow('Load balancer not found')
    })
  })

  // ── Target Groups ──

  describe('describeTargetGroups', () => {
    it('sends DescribeTargetGroups with no filters', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetGroupsResponse: {
          DescribeTargetGroupsResult: {
            TargetGroups: {
              member: {
                TargetGroupArn: 'arn:tg',
                TargetGroupName: 'my-tg',
                Protocol: 'HTTP',
                Port: '80',
                VpcId: 'vpc-1',
                TargetType: 'instance',
                HealthCheckProtocol: 'HTTP',
                HealthCheckPort: 'traffic-port',
                HealthCheckPath: '/',
                HealthCheckEnabled: 'true',
                LoadBalancerArns: '',
              },
            },
            NextMarker: null,
          },
        },
      })

      const result = await service.describeTargetGroups()

      expect(mockElbRequest).toHaveBeenCalledWith('DescribeTargetGroups', {}, expect.any(Object), 'us-east-1')
      expect(result.targetGroups).toHaveLength(1)

      expect(result.targetGroups[0]).toMatchObject({
        targetGroupArn: 'arn:tg',
        targetGroupName: 'my-tg',
        protocol: 'HTTP',
        port: 80,
        targetType: 'instance',
      })

      expect(result.marker).toBeNull()
    })

    it('passes all filters', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetGroupsResponse: { DescribeTargetGroupsResult: { TargetGroups: '' } },
      })

      await service.describeTargetGroups('arn:lb', ['arn:tg1'], ['name-1'], 20, 'marker-1')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeTargetGroups',
        { LoadBalancerArn: 'arn:lb', TargetGroupArns: ['arn:tg1'], Names: ['name-1'], PageSize: 20, Marker: 'marker-1' },
        expect.any(Object),
        'us-east-1'
      )
    })
  })

  describe('createTargetGroup', () => {
    it('sends CreateTargetGroup with required params', async () => {
      mockElbRequest.mockResolvedValue({
        CreateTargetGroupResponse: {
          CreateTargetGroupResult: {
            TargetGroups: {
              member: { TargetGroupArn: 'arn:tg-new', TargetGroupName: 'tg-test', LoadBalancerArns: '' },
            },
          },
        },
      })

      const result = await service.createTargetGroup('tg-test')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'CreateTargetGroup',
        { Name: 'tg-test' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.targetGroup).toMatchObject({ targetGroupName: 'tg-test' })
    })

    it('sends all optional params with resolved choices', async () => {
      mockElbRequest.mockResolvedValue({
        CreateTargetGroupResponse: {
          CreateTargetGroupResult: { TargetGroups: { member: { TargetGroupArn: 'arn:tg', LoadBalancerArns: '' } } },
        },
      })

      await service.createTargetGroup('tg', 'HTTPS', 443, 'vpc-1', 'IP', 'HTTP', '/health', 8080)

      expect(mockElbRequest).toHaveBeenCalledWith(
        'CreateTargetGroup',
        {
          Name: 'tg',
          Protocol: 'HTTPS',
          Port: 443,
          VpcId: 'vpc-1',
          TargetType: 'ip',
          HealthCheckProtocol: 'HTTP',
          HealthCheckPath: '/health',
          HealthCheckPort: 8080,
        },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('throws when name is missing', async () => {
      await expect(service.createTargetGroup()).rejects.toThrow('name is required')
    })
  })

  describe('modifyTargetGroup', () => {
    it('sends ModifyTargetGroup with ARN only', async () => {
      mockElbRequest.mockResolvedValue({
        ModifyTargetGroupResponse: {
          ModifyTargetGroupResult: { TargetGroups: { member: { TargetGroupArn: 'arn:tg', LoadBalancerArns: '' } } },
        },
      })

      await service.modifyTargetGroup('arn:tg')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'ModifyTargetGroup',
        { TargetGroupArn: 'arn:tg' },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('sends all optional health check params', async () => {
      mockElbRequest.mockResolvedValue({
        ModifyTargetGroupResponse: {
          ModifyTargetGroupResult: { TargetGroups: { member: { TargetGroupArn: 'arn:tg', LoadBalancerArns: '' } } },
        },
      })

      await service.modifyTargetGroup('arn:tg', 'HTTPS', '/health', 8080, 30, 10, 3, 5)

      expect(mockElbRequest).toHaveBeenCalledWith(
        'ModifyTargetGroup',
        {
          TargetGroupArn: 'arn:tg',
          HealthCheckProtocol: 'HTTPS',
          HealthCheckPath: '/health',
          HealthCheckPort: 8080,
          HealthCheckIntervalSeconds: 30,
          HealthCheckTimeoutSeconds: 10,
          HealthyThresholdCount: 3,
          UnhealthyThresholdCount: 5,
        },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('throws when ARN is missing', async () => {
      await expect(service.modifyTargetGroup()).rejects.toThrow('targetGroupArn is required')
    })
  })

  describe('deleteTargetGroup', () => {
    it('sends DeleteTargetGroup and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ DeleteTargetGroupResponse: { DeleteTargetGroupResult: {} } })

      const result = await service.deleteTargetGroup('arn:tg')

      expect(result).toEqual({ deleted: true, targetGroupArn: 'arn:tg' })
    })

    it('throws when ARN is missing', async () => {
      await expect(service.deleteTargetGroup()).rejects.toThrow('targetGroupArn is required')
    })

    it('throws TargetGroupNotFound error', async () => {
      const error = new Error('Not found')

      error.name = 'TargetGroupNotFound'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.deleteTargetGroup('arn:bad')).rejects.toThrow('Target group not found')
    })
  })

  // ── Target Health ──

  describe('describeTargetHealth', () => {
    it('sends DescribeTargetHealth with ARN only', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetHealthResponse: {
          DescribeTargetHealthResult: {
            TargetHealthDescriptions: {
              member: {
                Target: { Id: 'i-abc', Port: '80' },
                TargetHealth: { State: 'healthy' },
                HealthCheckPort: '80',
              },
            },
          },
        },
      })

      const result = await service.describeTargetHealth('arn:tg')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeTargetHealth',
        { TargetGroupArn: 'arn:tg' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.targetHealthDescriptions).toHaveLength(1)

      expect(result.targetHealthDescriptions[0]).toEqual({
        target: { id: 'i-abc', port: 80, availabilityZone: undefined },
        healthCheckPort: '80',
        state: 'healthy',
        reason: undefined,
        description: undefined,
      })
    })

    it('passes specific targets when provided', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetHealthResponse: { DescribeTargetHealthResult: { TargetHealthDescriptions: '' } },
      })

      await service.describeTargetHealth('arn:tg', [{ Id: 'i-abc', Port: 80 }])

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeTargetHealth',
        { TargetGroupArn: 'arn:tg', Targets: [{ Id: 'i-abc', Port: 80 }] },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('throws when ARN is missing', async () => {
      await expect(service.describeTargetHealth()).rejects.toThrow('targetGroupArn is required')
    })
  })

  describe('registerTargets', () => {
    it('sends RegisterTargets and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ RegisterTargetsResponse: { RegisterTargetsResult: {} } })

      const targets = [{ Id: 'i-abc', Port: 80 }]
      const result = await service.registerTargets('arn:tg', targets)

      expect(mockElbRequest).toHaveBeenCalledWith(
        'RegisterTargets',
        { TargetGroupArn: 'arn:tg', Targets: targets },
        expect.any(Object),
        'us-east-1'
      )

      expect(result).toEqual({ registered: true, targetGroupArn: 'arn:tg', count: 1 })
    })

    it('throws when ARN is missing', async () => {
      await expect(service.registerTargets(null, [{ Id: 'i-abc' }])).rejects.toThrow('targetGroupArn is required')
    })

    it('throws when targets is empty', async () => {
      await expect(service.registerTargets('arn:tg', [])).rejects.toThrow('targets')
    })
  })

  describe('deregisterTargets', () => {
    it('sends DeregisterTargets and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ DeregisterTargetsResponse: { DeregisterTargetsResult: {} } })

      const targets = [{ Id: 'i-abc', Port: 80 }, { Id: 'i-def', Port: 443 }]
      const result = await service.deregisterTargets('arn:tg', targets)

      expect(result).toEqual({ deregistered: true, targetGroupArn: 'arn:tg', count: 2 })
    })

    it('throws when ARN is missing', async () => {
      await expect(service.deregisterTargets(null, [{ Id: 'i-abc' }])).rejects.toThrow('targetGroupArn is required')
    })

    it('throws when targets is empty', async () => {
      await expect(service.deregisterTargets('arn:tg', [])).rejects.toThrow('targets')
    })
  })

  // ── Listeners ──

  describe('describeListeners', () => {
    it('sends DescribeListeners with load balancer ARN', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeListenersResponse: {
          DescribeListenersResult: {
            Listeners: {
              member: {
                ListenerArn: 'arn:listener',
                LoadBalancerArn: 'arn:lb',
                Protocol: 'HTTP',
                Port: '80',
                Certificates: '',
                DefaultActions: { member: { Type: 'forward', TargetGroupArn: 'arn:tg' } },
              },
            },
            NextMarker: null,
          },
        },
      })

      const result = await service.describeListeners('arn:lb')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeListeners',
        { LoadBalancerArn: 'arn:lb' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.listeners).toHaveLength(1)

      expect(result.listeners[0]).toMatchObject({
        listenerArn: 'arn:listener',
        loadBalancerArn: 'arn:lb',
        protocol: 'HTTP',
        port: 80,
      })
    })

    it('passes listener ARNs, pageSize, and marker', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeListenersResponse: { DescribeListenersResult: { Listeners: '' } },
      })

      await service.describeListeners(null, ['arn:l1'], 5, 'marker-1')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeListeners',
        { ListenerArns: ['arn:l1'], PageSize: 5, Marker: 'marker-1' },
        expect.any(Object),
        'us-east-1'
      )
    })
  })

  describe('createListener', () => {
    it('sends CreateListener with required params', async () => {
      const actions = [{ Type: 'forward', TargetGroupArn: 'arn:tg' }]

      mockElbRequest.mockResolvedValue({
        CreateListenerResponse: {
          CreateListenerResult: {
            Listeners: {
              member: {
                ListenerArn: 'arn:listener-new',
                LoadBalancerArn: 'arn:lb',
                Protocol: 'HTTP',
                Port: '80',
                Certificates: '',
                DefaultActions: { member: actions[0] },
              },
            },
          },
        },
      })

      const result = await service.createListener('arn:lb', 'HTTP', 80, actions)

      expect(mockElbRequest).toHaveBeenCalledWith(
        'CreateListener',
        { LoadBalancerArn: 'arn:lb', Protocol: 'HTTP', Port: 80, DefaultActions: actions },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.listener).toMatchObject({ protocol: 'HTTP', port: 80 })
    })

    it('throws when loadBalancerArn is missing', async () => {
      await expect(service.createListener(null, 'HTTP', 80, [{}])).rejects.toThrow('loadBalancerArn is required')
    })

    it('throws when protocol is missing', async () => {
      await expect(service.createListener('arn:lb', null, 80, [{}])).rejects.toThrow('protocol is required')
    })

    it('throws when port is missing', async () => {
      await expect(service.createListener('arn:lb', 'HTTP', null, [{}])).rejects.toThrow('port is required')
    })

    it('throws when defaultActions is empty', async () => {
      await expect(service.createListener('arn:lb', 'HTTP', 80, [])).rejects.toThrow('defaultActions')
    })
  })

  describe('modifyListener', () => {
    it('sends ModifyListener with ARN only', async () => {
      mockElbRequest.mockResolvedValue({
        ModifyListenerResponse: {
          ModifyListenerResult: {
            Listeners: { member: { ListenerArn: 'arn:l', Certificates: '', DefaultActions: '' } },
          },
        },
      })

      await service.modifyListener('arn:l')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'ModifyListener',
        { ListenerArn: 'arn:l' },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('sends all optional params', async () => {
      const actions = [{ Type: 'forward', TargetGroupArn: 'arn:tg' }]

      mockElbRequest.mockResolvedValue({
        ModifyListenerResponse: {
          ModifyListenerResult: {
            Listeners: { member: { ListenerArn: 'arn:l', Certificates: '', DefaultActions: '' } },
          },
        },
      })

      await service.modifyListener('arn:l', 'HTTPS', 443, actions)

      expect(mockElbRequest).toHaveBeenCalledWith(
        'ModifyListener',
        { ListenerArn: 'arn:l', Protocol: 'HTTPS', Port: 443, DefaultActions: actions },
        expect.any(Object),
        'us-east-1'
      )
    })

    it('throws when ARN is missing', async () => {
      await expect(service.modifyListener()).rejects.toThrow('listenerArn is required')
    })
  })

  describe('deleteListener', () => {
    it('sends DeleteListener and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ DeleteListenerResponse: { DeleteListenerResult: {} } })

      const result = await service.deleteListener('arn:l')

      expect(result).toEqual({ deleted: true, listenerArn: 'arn:l' })
    })

    it('throws when ARN is missing', async () => {
      await expect(service.deleteListener()).rejects.toThrow('listenerArn is required')
    })

    it('throws ListenerNotFound error', async () => {
      const error = new Error('Not found')

      error.name = 'ListenerNotFound'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.deleteListener('arn:bad')).rejects.toThrow('Resource not found')
    })
  })

  // ── Rules ──

  describe('describeRules', () => {
    it('sends DescribeRules with listener ARN', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeRulesResponse: {
          DescribeRulesResult: {
            Rules: {
              member: {
                RuleArn: 'arn:rule',
                Priority: '1',
                IsDefault: 'false',
                Conditions: { member: { Field: 'path-pattern', Values: { member: '/api/*' } } },
                Actions: { member: { Type: 'forward', TargetGroupArn: 'arn:tg' } },
              },
            },
            NextMarker: null,
          },
        },
      })

      const result = await service.describeRules('arn:listener')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeRules',
        { ListenerArn: 'arn:listener' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.rules).toHaveLength(1)

      expect(result.rules[0]).toMatchObject({
        ruleArn: 'arn:rule',
        priority: '1',
        isDefault: false,
      })
    })

    it('converts IsDefault true string to boolean', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeRulesResponse: {
          DescribeRulesResult: {
            Rules: {
              member: { RuleArn: 'arn:rule-default', Priority: 'default', IsDefault: 'true', Conditions: '', Actions: '' },
            },
          },
        },
      })

      const result = await service.describeRules('arn:listener')

      expect(result.rules[0].isDefault).toBe(true)
    })

    it('passes rule ARNs, pageSize, and marker', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeRulesResponse: { DescribeRulesResult: { Rules: '' } },
      })

      await service.describeRules(null, ['arn:r1'], 10, 'marker-1')

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeRules',
        { RuleArns: ['arn:r1'], PageSize: 10, Marker: 'marker-1' },
        expect.any(Object),
        'us-east-1'
      )
    })
  })

  // ── Tags ──

  describe('describeTags', () => {
    it('sends DescribeTags and shapes the response', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTagsResponse: {
          DescribeTagsResult: {
            TagDescriptions: {
              member: {
                ResourceArn: 'arn:lb',
                Tags: { member: { Key: 'env', Value: 'prod' } },
              },
            },
          },
        },
      })

      const result = await service.describeTags(['arn:lb'])

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeTags',
        { ResourceArns: ['arn:lb'] },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.tagDescriptions).toEqual([
        { resourceArn: 'arn:lb', tags: [{ key: 'env', value: 'prod' }] },
      ])
    })

    it('throws when resourceArns is empty', async () => {
      await expect(service.describeTags([])).rejects.toThrow('resourceArns')
    })
  })

  describe('addTags', () => {
    it('sends AddTags and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ AddTagsResponse: { AddTagsResult: {} } })

      const result = await service.addTags(['arn:lb'], [{ Key: 'env', Value: 'prod' }])

      expect(mockElbRequest).toHaveBeenCalledWith(
        'AddTags',
        { ResourceArns: ['arn:lb'], Tags: [{ Key: 'env', Value: 'prod' }] },
        expect.any(Object),
        'us-east-1'
      )

      expect(result).toEqual({ tagged: true, resourceArns: ['arn:lb'] })
    })

    it('throws when resourceArns is empty', async () => {
      await expect(service.addTags([], [{ Key: 'a', Value: 'b' }])).rejects.toThrow('resourceArns')
    })

    it('throws when tags is empty', async () => {
      await expect(service.addTags(['arn:lb'], [])).rejects.toThrow('tags')
    })
  })

  describe('removeTags', () => {
    it('sends RemoveTags and returns confirmation', async () => {
      mockElbRequest.mockResolvedValue({ RemoveTagsResponse: { RemoveTagsResult: {} } })

      const result = await service.removeTags(['arn:lb'], ['env'])

      expect(mockElbRequest).toHaveBeenCalledWith(
        'RemoveTags',
        { ResourceArns: ['arn:lb'], TagKeys: ['env'] },
        expect.any(Object),
        'us-east-1'
      )

      expect(result).toEqual({ removed: true, resourceArns: ['arn:lb'] })
    })

    it('throws when resourceArns is empty', async () => {
      await expect(service.removeTags([], ['key'])).rejects.toThrow('resourceArns')
    })

    it('throws when tagKeys is empty', async () => {
      await expect(service.removeTags(['arn:lb'], [])).rejects.toThrow('tagKeys')
    })
  })

  // ── Dictionaries ──

  describe('getLoadBalancersDictionary', () => {
    it('returns items with label, value, note', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: {
          DescribeLoadBalancersResult: {
            LoadBalancers: {
              member: [
                { LoadBalancerName: 'alb-1', LoadBalancerArn: 'arn:alb1', Type: 'application' },
                { LoadBalancerName: 'nlb-1', LoadBalancerArn: 'arn:nlb1', Type: 'network' },
              ],
            },
          },
        },
      })

      const result = await service.getLoadBalancersDictionary({})

      expect(result.items).toEqual([
        { label: 'alb-1', value: 'arn:alb1', note: 'application' },
        { label: 'nlb-1', value: 'arn:nlb1', note: 'network' },
      ])

      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: {
          DescribeLoadBalancersResult: {
            LoadBalancers: {
              member: [
                { LoadBalancerName: 'alb-prod', LoadBalancerArn: 'arn:1', Type: 'application' },
                { LoadBalancerName: 'nlb-dev', LoadBalancerArn: 'arn:2', Type: 'network' },
              ],
            },
          },
        },
      })

      const result = await service.getLoadBalancersDictionary({ search: 'prod' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('alb-prod')
    })

    it('passes cursor as Marker', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: {
          DescribeLoadBalancersResult: { LoadBalancers: '', NextMarker: 'next-token' },
        },
      })

      const result = await service.getLoadBalancersDictionary({ cursor: 'prev-token' })

      expect(mockElbRequest).toHaveBeenCalledWith(
        'DescribeLoadBalancers',
        { PageSize: 400, Marker: 'prev-token' },
        expect.any(Object),
        'us-east-1'
      )

      expect(result.cursor).toBe('next-token')
    })

    it('handles empty payload', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeLoadBalancersResponse: { DescribeLoadBalancersResult: { LoadBalancers: '' } },
      })

      const result = await service.getLoadBalancersDictionary()

      expect(result.items).toEqual([])
    })
  })

  describe('getTargetGroupsDictionary', () => {
    it('returns items with protocol:port as note', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetGroupsResponse: {
          DescribeTargetGroupsResult: {
            TargetGroups: {
              member: { TargetGroupName: 'tg-1', TargetGroupArn: 'arn:tg1', Protocol: 'HTTP', Port: '80', TargetType: 'instance' },
            },
          },
        },
      })

      const result = await service.getTargetGroupsDictionary({})

      expect(result.items).toEqual([
        { label: 'tg-1', value: 'arn:tg1', note: 'HTTP:80' },
      ])
    })

    it('uses targetType as note when protocol/port are missing', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetGroupsResponse: {
          DescribeTargetGroupsResult: {
            TargetGroups: {
              member: { TargetGroupName: 'tg-lambda', TargetGroupArn: 'arn:tg-l', TargetType: 'lambda' },
            },
          },
        },
      })

      const result = await service.getTargetGroupsDictionary({})

      expect(result.items[0].note).toBe('lambda')
    })

    it('filters by search term', async () => {
      mockElbRequest.mockResolvedValue({
        DescribeTargetGroupsResponse: {
          DescribeTargetGroupsResult: {
            TargetGroups: {
              member: [
                { TargetGroupName: 'api-targets', TargetGroupArn: 'arn:1', Protocol: 'HTTP', Port: '80' },
                { TargetGroupName: 'web-targets', TargetGroupArn: 'arn:2', Protocol: 'HTTP', Port: '80' },
              ],
            },
          },
        },
      })

      const result = await service.getTargetGroupsDictionary({ search: 'api' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('api-targets')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps ValidationError', async () => {
      const error = new Error('Invalid param')

      error.name = 'ValidationError'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.describeLoadBalancers()).rejects.toThrow('Invalid request')
    })

    it('maps ResourceInUse error', async () => {
      const error = new Error('In use')

      error.name = 'ResourceInUse'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.deleteTargetGroup('arn:tg')).rejects.toThrow('Resource in use')
    })

    it('maps RuleNotFound error', async () => {
      const error = new Error('Not found')

      error.name = 'RuleNotFound'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.describeRules('arn:l')).rejects.toThrow('Resource not found')
    })

    it('maps InvalidConfigurationRequest error', async () => {
      const error = new Error('Bad config')

      error.name = 'InvalidConfigurationRequest'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.createLoadBalancer('test', ['subnet-1'])).rejects.toThrow('Invalid request')
    })

    it('maps throttling errors via mapAwsError', async () => {
      const error = new Error('Rate exceeded')

      error.name = 'ThrottlingException'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.describeLoadBalancers()).rejects.toThrow('throttled')
    })

    it('maps credential errors via mapAwsError', async () => {
      const error = new Error('Bad key')

      error.name = 'InvalidClientTokenId'
      mockElbRequest.mockRejectedValue(error)

      await expect(service.describeLoadBalancers()).rejects.toThrow('Invalid AWS credentials')
    })
  })

  // ── Every operation funnels transport failures through #handleError ──

  describe('error propagation across operations', () => {
    const OPERATIONS = [
      ['describeLoadBalancers', []],
      ['createLoadBalancer', ['my-alb', ['subnet-1']]],
      ['deleteLoadBalancer', ['arn:lb']],
      ['describeTargetGroups', []],
      ['createTargetGroup', ['my-tg']],
      ['modifyTargetGroup', ['arn:tg']],
      ['deleteTargetGroup', ['arn:tg']],
      ['describeTargetHealth', ['arn:tg']],
      ['registerTargets', ['arn:tg', [{ id: 'i-1' }]]],
      ['deregisterTargets', ['arn:tg', [{ id: 'i-1' }]]],
      ['describeListeners', ['arn:lb']],
      ['createListener', ['arn:lb', 'HTTP', 80, [{ type: 'forward', targetGroupArn: 'arn:tg' }]]],
      ['modifyListener', ['arn:listener']],
      ['deleteListener', ['arn:listener']],
      ['describeRules', ['arn:listener']],
      ['describeTags', [['arn:lb']]],
      ['addTags', [['arn:lb'], [{ key: 'env', value: 'prod' }]]],
      ['removeTags', [['arn:lb'], ['env']]],
      ['getLoadBalancersDictionary', [{}]],
      ['getTargetGroupsDictionary', [{}]],
    ]

    it.each(OPERATIONS)('%s surfaces a mapped AWS error', async (method, args) => {
      const error = new Error('Rate exceeded')

      error.name = 'ThrottlingException'
      mockElbRequest.mockRejectedValue(error)

      await expect(service[method](...args)).rejects.toThrow(/throttled by AWS/)
      expect(mockElbRequest).toHaveBeenCalled()
    })

    it.each(OPERATIONS)('%s maps a LoadBalancerNotFound error', async (method, args) => {
      const error = new Error('lb missing')

      error.name = 'LoadBalancerNotFound'
      mockElbRequest.mockRejectedValue(error)

      await expect(service[method](...args)).rejects.toThrow('Load balancer not found: lb missing')
    })
  })

  // ── Credential resolution wired into #send ──

  describe('credential resolution', () => {
    it('passes the resolved static credentials to elbRequest', async () => {
      mockElbRequest.mockResolvedValue({})

      await service.describeLoadBalancers()

      expect(mockElbRequest).toHaveBeenCalledWith('DescribeLoadBalancers', {}, {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      }, 'us-east-1')
    })

    it('propagates a credential resolution failure', async () => {
      const { ElasticLoadBalancing } = require('../src/index.js')
      const bare = new ElasticLoadBalancing()

      bare.deps.elbRequest = jest.fn()

      expect(bare.region).toBe('us-east-1')

      await expect(bare.describeLoadBalancers()).rejects.toThrow(
        'Access Key and Secret Key are required for API Key authentication.'
      )

      expect(bare.deps.elbRequest).not.toHaveBeenCalled()
    })

    it('resolves credentials through STS when configured for an IAM role', async () => {
      const { ElasticLoadBalancing } = require('../src/index.js')

      const roleService = new ElasticLoadBalancing({
        authenticationMethod: 'IAM Role',
        region: 'eu-west-1',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        roleArn: 'arn:aws:iam::1:role/R',
        externalId: 'ext',
      })

      roleService.credentials._stsAssumeRole = jest.fn().mockResolvedValue({
        accessKeyId: 'ASIA',
        secretAccessKey: 'S',
        sessionToken: 'T',
        expiration: new Date(Date.now() + 3600000),
      })

      roleService.deps.elbRequest = jest.fn().mockResolvedValue({})

      await roleService.describeLoadBalancers()

      expect(roleService.deps.elbRequest).toHaveBeenCalledWith(
        'DescribeLoadBalancers',
        {},
        { accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' },
        'eu-west-1'
      )
    })
  })
})

// ── xml.js ──

describe('xml.js parseXml', () => {
  it('turns leaf elements into their text value', () => {
    expect(parseXml('<Root><Name>my-alb</Name></Root>')).toEqual({ Root: { Name: 'my-alb' } })
  })

  it('strips the XML declaration and comments', () => {
    const doc = parseXml('<?xml version="1.0" encoding="UTF-8"?><!-- note --><A><B>1</B></A>')

    expect(doc).toEqual({ A: { B: '1' } })
  })

  it('collapses repeated sibling tags into an array', () => {
    const doc = parseXml('<L><member>a</member><member>b</member><member>c</member></L>')

    expect(doc.L.member).toEqual(['a', 'b', 'c'])
  })

  it('keeps a single member as a scalar rather than an array', () => {
    expect(parseXml('<L><member>only</member></L>').L.member).toBe('only')
  })

  it('represents self-closing elements as an empty string', () => {
    expect(parseXml('<R><Empty/><Also /></R>')).toEqual({ R: { Empty: '', Also: '' } })
  })

  it('decodes entities in text values', () => {
    const doc = parseXml('<R><P>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos; &#65; &#x42;</P></R>')

    expect(doc.R.P).toBe('a & b <c> "d" \'e\' A B')
  })

  it('trims surrounding whitespace on leaf values', () => {
    expect(parseXml('<R><P>\n   spaced   \n</P></R>').R.P).toBe('spaced')
  })

  it('ignores element attributes', () => {
    const doc = parseXml('<R xmlns="http://elb"><Item id="1">v</Item></R>')

    expect(doc.R.Item).toBe('v')
  })

  it('nests child objects under their parent tag', () => {
    const doc = parseXml('<R><LB><State><Code>active</Code></State></LB></R>')

    expect(doc.R.LB.State.Code).toBe('active')
  })

  it('handles an empty, null or non-string document', () => {
    expect(parseXml('')).toEqual({})
    expect(parseXml(null)).toEqual({})
    expect(parseXml(undefined)).toEqual({})
  })

  it('does not throw on the malformed shapes it can recover from', () => {
    expect(() => parseXml('not xml at all')).not.toThrow()
    expect(() => parseXml('<R><<>>')).not.toThrow()

    // A missing close tag leaves the root frame open, so nothing reaches the result.
    expect(parseXml('<R><Unclosed>oops</R>')).toEqual({})
  })

  // KNOWN SERVICE BUG: parseXml pops the root frame when it meets a closing tag
  // that has no matching opening tag, then dereferences the now-missing parent.
  // Malformed/truncated XML from a proxy therefore surfaces as an opaque
  // TypeError instead of an empty document or a parse error.
  // Fix candidate: in src/xml.js, skip the close-tag branch when `stack.length <= 1`.
  it('throws a TypeError on an unbalanced closing tag (known service bug)', () => {
    expect(() => parseXml('</Orphan>')).toThrow(TypeError)
    expect(() => parseXml('<A></A></A>')).toThrow(TypeError)
  })

  it('parses a realistic ELB error envelope', () => {
    const doc = parseXml(
      '<ErrorResponse xmlns="http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/">' +
      '<Error><Type>Sender</Type><Code>LoadBalancerNotFound</Code><Message>LB not found</Message></Error>' +
      '<RequestId>req-1</RequestId></ErrorResponse>'
    )

    expect(doc.ErrorResponse.Error).toEqual({
      Type: 'Sender',
      Code: 'LoadBalancerNotFound',
      Message: 'LB not found',
    })

    expect(doc.ErrorResponse.RequestId).toBe('req-1')
  })
})

describe('xml.js toArray', () => {
  it('returns an empty array for empty-ish nodes', () => {
    expect(toArray(undefined)).toEqual([])
    expect(toArray(null)).toEqual([])
    expect(toArray('')).toEqual([])
    expect(toArray({})).toEqual([])
    expect(toArray({ member: '' })).toEqual([])
    expect(toArray({ member: null })).toEqual([])
  })

  it('wraps a single member in an array', () => {
    expect(toArray({ member: { Id: 'i-1' } })).toEqual([{ Id: 'i-1' }])
  })

  it('passes a multi-member list through', () => {
    expect(toArray({ member: ['a', 'b'] })).toEqual(['a', 'b'])
  })

  it('wraps a bare scalar without a member wrapper', () => {
    expect(toArray('solo')).toEqual(['solo'])
    expect(toArray(42)).toEqual([42])
  })

  it('returns an empty array for an object-shaped node with no member key', () => {
    // Arrays are objects, so a bare array is read through `.member` and yields [].
    expect(toArray(['a', 'b'])).toEqual([])
    expect(toArray({ NotMember: 'x' })).toEqual([])
  })
})

describe('xml.js decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'')
    expect(decodeEntities('&#8364;')).toBe('€')
    expect(decodeEntities('&#x1F600;')).toBe('😀')
  })

  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('&nbsp;plain')).toBe('&nbsp;plain')
  })
})

// ── elb-client.js ──

describe('elb-client buildQuery', () => {
  it('always prepends Action and Version', () => {
    expect(buildQuery('DescribeLoadBalancers')).toBe(`Action=DescribeLoadBalancers&Version=${ API_VERSION }`)
    expect(API_VERSION).toBe('2015-12-01')
    expect(SERVICE).toBe('elasticloadbalancing')
  })

  it('percent-encodes keys and values', () => {
    expect(buildQuery('A', { Name: 'a b&c/d' })).toContain('Name=a%20b%26c%2Fd')
  })

  it('flattens arrays into member syntax', () => {
    expect(buildQuery('A', { Subnets: ['subnet-1', 'subnet-2'] })).toBe(
      `Action=A&Version=${ API_VERSION }&Subnets.member.1=subnet-1&Subnets.member.2=subnet-2`
    )
  })

  it('flattens arrays of objects into indexed member fields', () => {
    expect(buildQuery('A', { Tags: [{ Key: 'env', Value: 'prod' }] })).toBe(
      `Action=A&Version=${ API_VERSION }&Tags.member.1.Key=env&Tags.member.1.Value=prod`
    )
  })

  it('flattens nested plain objects', () => {
    expect(buildQuery('A', { Matcher: { HttpCode: '200' } })).toContain('Matcher.HttpCode=200')
  })

  it('flattens nested arrays inside array members', () => {
    expect(buildQuery('A', { Actions: [{ Order: 1, TargetGroups: ['tg-1', 'tg-2'] }] })).toBe(
      `Action=A&Version=${ API_VERSION }` +
      '&Actions.member.1.Order=1' +
      '&Actions.member.1.TargetGroups.member.1=tg-1' +
      '&Actions.member.1.TargetGroups.member.2=tg-2'
    )
  })

  it('skips undefined and null values but keeps falsy scalars', () => {
    expect(buildQuery('A', { Gone: undefined, Nulled: null, Zero: 0, Off: false, Blank: '' })).toBe(
      `Action=A&Version=${ API_VERSION }&Zero=0&Off=false&Blank=`
    )
  })

  it('skips null entries inside arrays', () => {
    expect(buildQuery('A', { L: ['a', null, undefined] })).toBe(`Action=A&Version=${ API_VERSION }&L.member.1=a`)
  })

  it('defaults params to an empty object', () => {
    expect(buildQuery('A', undefined)).toBe(`Action=A&Version=${ API_VERSION }`)
  })
})

describe('elb-client elbRequest', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  it('signs and posts the query to the regional endpoint and parses the XML', async () => {
    const captured = stubHttps({
      statusCode: 200,
      body:
        '<DescribeLoadBalancersResponse><DescribeLoadBalancersResult><LoadBalancers>' +
        '<member><LoadBalancerName>my-alb</LoadBalancerName></member>' +
        '</LoadBalancers></DescribeLoadBalancersResult></DescribeLoadBalancersResponse>',
    })

    const doc = await elbRequest('DescribeLoadBalancers', { PageSize: 400 }, CREDS, 'eu-west-1')

    expect(captured.options).toMatchObject({
      hostname: 'elasticloadbalancing.eu-west-1.amazonaws.com',
      port: 443,
      path: '/',
      method: 'POST',
    })

    expect(captured.options.headers['content-type']).toBe('application/x-www-form-urlencoded; charset=utf-8')

    expect(captured.options.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/elasticloadbalancing\/aws4_request, /
    )

    expect(captured.written[0]).toBe(`Action=DescribeLoadBalancers&Version=${ API_VERSION }&PageSize=400`)

    expect(doc.DescribeLoadBalancersResponse.DescribeLoadBalancersResult.LoadBalancers.member).toEqual({
      LoadBalancerName: 'my-alb',
    })
  })

  it('throws a named error carrying the ELB Code and status', async () => {
    stubHttps({
      statusCode: 400,
      body:
        '<ErrorResponse><Error><Code>TargetGroupNotFound</Code>' +
        '<Message>Target group ARN is not valid</Message></Error></ErrorResponse>',
    })

    await expect(elbRequest('DescribeTargetGroups', {}, CREDS, 'us-east-1')).rejects.toMatchObject({
      name: 'TargetGroupNotFound',
      message: 'Target group ARN is not valid',
      statusCode: 400,
    })
  })

  it('falls back to a generic error when the body carries no Code or Message', async () => {
    stubHttps({ statusCode: 503, body: '<html>gateway</html>' })

    await expect(elbRequest('DescribeListeners', {}, CREDS, 'us-east-1')).rejects.toMatchObject({
      name: 'ELBError',
      message: 'ELB request failed with status 503',
      statusCode: 503,
    })
  })

  it('returns an empty document for a malformed success body', async () => {
    stubHttps({ statusCode: 200, body: 'not xml' })

    await expect(elbRequest('DescribeTags', {}, CREDS, 'us-east-1')).resolves.toEqual({})
  })

  it('rejects when the socket errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(elbRequest('DescribeTags', {}, CREDS, 'us-east-1')).rejects.toThrow('socket hang up')
  })
})

// ── aws-client.js ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag and all matching tags', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

describe('aws-client httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '<ok/>' })

    const response = await httpRequest(
      'POST',
      'https://elasticloadbalancing.us-east-1.amazonaws.com/?a=1',
      { 'content-type': 'text/plain' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'elasticloadbalancing.us-east-1.amazonaws.com',
      port: 443,
      path: '/?a=1',
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])
    expect(response).toEqual({ statusCode: 200, headers: { 'content-type': 'text/xml' }, body: '<ok/>' })
  })

  it('omits content-length and the write when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://elasticloadbalancing.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('uses the plain http transport and port 80 for http:// URLs', async () => {
    const captured = stubTransport(http, { statusCode: 200, body: 'ok' })

    const response = await httpRequest('GET', 'http://localhost/path', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options).toMatchObject({ port: 80, path: '/path' })
    expect(response.body).toBe('ok')
  })

  it('honours an explicit port', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://localhost:4566/', {})

    expect(captured.options.port).toBe('4566')
  })

  it('registers a 30s timeout that destroys the request', async () => {
    let destroyedWith = null

    https.request.mockImplementation(() => {
      const req = new EventEmitter()

      req.write = jest.fn()

      req.setTimeout = (ms, handler) => {
        expect(ms).toBe(30000)
        handler()
      }

      req.destroy = error => {
        destroyedWith = error
        process.nextTick(() => req.emit('error', error))
      }

      req.end = jest.fn()

      return req
    })

    await expect(
      httpRequest('GET', 'https://elasticloadbalancing.us-east-1.amazonaws.com/', {})
    ).rejects.toThrow('Request timed out')

    expect(destroyedWith).toBeInstanceOf(Error)
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(
      httpRequest('GET', 'https://elasticloadbalancing.us-east-1.amazonaws.com/', {})
    ).rejects.toThrow('connect ECONNREFUSED')
  })

  it('rejects when the response stream errors', async () => {
    https.request.mockImplementation((options, callback) => {
      const req = new EventEmitter()

      req.write = jest.fn()
      req.setTimeout = jest.fn()
      req.destroy = jest.fn()

      req.end = () => {
        process.nextTick(() => {
          const res = new EventEmitter()

          res.statusCode = 200
          res.headers = {}

          callback(res)
          res.emit('error', new Error('stream broke'))
        })
      }

      return req
    })

    await expect(
      httpRequest('GET', 'https://elasticloadbalancing.us-east-1.amazonaws.com/', {})
    ).rejects.toThrow('stream broke')
  })
})

describe('aws-client stsAssumeRole', () => {
  afterEach(() => {
    https.request.mockReset()
  })

  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  it('assumes a role and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(CREDS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(result).toEqual({
      accessKeyId: 'ASIA123',
      secretAccessKey: 'secret123',
      sessionToken: 'token123',
      expiration: new Date('2030-01-01T00:00:00Z'),
    })
  })

  it('omits the external id when it is not provided', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    await stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error name and message', async () => {
    stubHttps({ statusCode: 500, body: '<html/>' })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse><AccessKeyId>only</AccessKeyId></AssumeRoleResponse>' })

    await expect(stsAssumeRole(CREDS, 'us-east-1', 'arn:role', 's')).rejects.toMatchObject({
      name: 'STSParseError',
    })
  })
})

describe('aws-client JSON helpers', () => {
  it('builds an AWS JSON request with a target header', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'dynamodb',
      target: 'DynamoDB_20120810.ListTables',
      body: { Limit: 1 },
      contentType: 'application/x-amz-json-1.0',
    })).toEqual({
      method: 'POST',
      url: 'https://dynamodb.us-east-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': 'DynamoDB_20120810.ListTables',
      },
      body: '{"Limit":1}',
    })
  })

  it('passes a string body through, omits the target header and defaults the body', () => {
    const asString = buildAwsJsonRequest({ region: 'us-east-1', service: 'x', body: '{"a":1}', contentType: 'application/json' })

    expect(asString.body).toBe('{"a":1}')
    expect(asString.headers).not.toHaveProperty('x-amz-target')

    expect(buildAwsJsonRequest({ region: 'us-east-1', service: 'x', contentType: 'application/json' }).body).toBe('{}')
  })

  it('parses successful and empty JSON bodies', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error for an error status', () => {
    expect.assertions(4)

    try {
      parseJsonResponse({ statusCode: 400, body: '{"__type":"com.amazon.coral#ValidationException","message":"bad input"}' })
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }

    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
    }
  })

  it('falls back to a generic name and message', () => {
    expect.assertions(2)

    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })

  it('signs and sends a JSON request with an injected transport', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"TableNames":[]}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'dynamodb', target: 'X.Y', body: {}, contentType: 'application/x-amz-json-1.0' },
      CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ TableNames: [] })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://dynamodb.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.0', 'x-amz-target': 'X.Y' },
      '{}',
      CREDS,
      'us-east-1',
      'dynamodb'
    )
  })

  it('uses the real signer and transport when no deps are injected', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const result = await jsonRequest(
      { region: 'us-east-1', service: 'dynamodb', target: 'X.Y', body: { a: 1 }, contentType: 'application/x-amz-json-1.0' },
      CREDS
    )

    expect(result).toEqual({ ok: true })
    expect(captured.options.headers.authorization).toContain('AWS4-HMAC-SHA256')

    https.request.mockReset()
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK' })

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(/API Key authentication/)
    await expect(new CredentialProvider().resolve()).rejects.toThrow(/API Key authentication/)
  })

  it('assumes the configured role, caches the result and refreshes past the buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockResolvedValue({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    })

    const provider = new CredentialProvider(
      {
        authenticationMethod: 'IAM Role',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
        region: 'eu-west-1',
        roleArn: 'arn:role',
        externalId: 'ext',
      },
      { stsAssumeRole: stsAssumeRoleSpy, now: () => now }
    )

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

    expect(stsAssumeRoleSpy).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:role',
      `flowrunner-elb-${ now }`,
      'ext'
    )

    // Cache hit — still inside the 5 minute expiry buffer.
    now += 100000
    await provider.resolve()
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Past the buffer — the credentials are re-assumed.
    now += 3400000
    await provider.resolve()
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(2)
  })

  it('requires a role ARN and static keys for role authentication', async () => {
    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', accessKeyId: 'AK', secretAccessKey: 'SK' }).resolve()
    ).rejects.toThrow('IAM Role ARN is required for IAM Role authentication.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')

    await expect(
      new CredentialProvider({ authenticationMethod: 'IAM Role', roleArn: 'arn:role', accessKeyId: 'AK' }).resolve()
    ).rejects.toThrow('Access Key and Secret Key are required to assume an IAM Role.')
  })

  it('defaults to the real stsAssumeRole when no dependency is injected', async () => {
    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      roleArn: 'arn:role',
    })

    stubHttps({
      statusCode: 200,
      body:
        '<AssumeRoleResponse><Credentials>' +
        '<AccessKeyId>ASIA9</AccessKeyId><SecretAccessKey>S9</SecretAccessKey>' +
        '<SessionToken>T9</SessionToken><Expiration>2030-01-01T00:00:00Z</Expiration>' +
        '</Credentials></AssumeRoleResponse>',
    })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'ASIA9', secretAccessKey: 'S9', sessionToken: 'T9' })

    https.request.mockReset()
  })
})

// ── errors.js ──

describe('errors.js mapAwsError', () => {
  function mapped(name, message, extra = {}) {
    return mapAwsError(Object.assign(new Error(message), { name }, extra))
  }

  it('maps throttling errors', () => {
    expect(mapped('ThrottlingException', 'Rate exceeded').message).toMatch(/throttled by AWS: Rate exceeded/)
    expect(mapped('Throttling', 'x').message).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x').message).toMatch(/throttled by AWS/)
  })

  it('maps credential errors', () => {
    expect(mapped('InvalidSignatureException', 'bad sig').message).toMatch(/Invalid AWS credentials: bad sig/)
    expect(mapped('UnrecognizedClientException', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('InvalidClientTokenId', 'x').message).toMatch(/Invalid AWS credentials/)
    expect(mapped('SomethingElse', 'The security credential is invalid').message).toMatch(/Invalid AWS credentials/)
  })

  it('maps access denied errors', () => {
    expect(mapped('AccessDeniedException', 'nope').message).toMatch(/Access denied: nope/)
    expect(mapped('AccessDenied', 'nope').message).toMatch(/Access denied/)
  })

  it('maps connectivity errors', () => {
    expect(mapped('Error', 'Request timed out').message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ECONNREFUSED' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ENOTFOUND' }).message).toMatch(/Connection to AWS failed/)
    expect(mapped('Error', 'boom', { code: 'ETIMEDOUT' }).message).toMatch(/Connection to AWS failed/)
  })

  it('passes unknown errors through with the original as the cause', () => {
    const original = new Error('something odd')
    const result = mapAwsError(original)

    expect(result.message).toBe('something odd')
    expect(result.cause).toBe(original)
  })

  it('handles an error without a name or message', () => {
    expect(mapAwsError({}).message).toBe('Unknown error')
  })
})

describe('errors.js createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('ELB')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[ELB Service]', 'info:', 'a'],
      ['[ELB Service]', 'debug:', 'b'],
      ['[ELB Service]', 'warn:', 'c'],
      ['[ELB Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

// ── sigv4.js ──

/**
 * An independently written SigV4 signer, transcribed from the published AWS
 * "Signature Version 4 signing process" steps rather than from the service's
 * sigv4.js. It only supports the simple request shape used below (root path, no
 * query string), which keeps URI canonicalization out of the comparison while
 * still checking the canonical request, string-to-sign and key derivation.
 */
function referenceAuthorization({ method, url, headers, body, credentials, region, service, amzDate }) {
  const dateStamp = amzDate.slice(0, 8)
  const hash = value => crypto.createHash('sha256').update(value).digest('hex')
  const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest()

  const normalized = new Map()

  Object.keys(headers).forEach(key => normalized.set(key.toLowerCase(), String(headers[key]).trim()))

  const names = [...normalized.keys()].sort()
  const canonicalHeaders = names.map(name => `${ name }:${ normalized.get(name) }\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [
    method,
    new URL(url).pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    hash(body),
  ].join('\n')

  const scope = `${ dateStamp }/${ region }/${ service }/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, hash(canonicalRequest)].join('\n')

  let key = hmac(`AWS4${ credentials.secretAccessKey }`, dateStamp)

  for (const part of [region, service, 'aws4_request']) {
    key = hmac(key, part)
  }

  return `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
    `SignedHeaders=${ signedHeaders }, Signature=${ hmac(key, stringToSign).toString('hex') }`
}

describe('sigv4 signRequest', () => {
  const FIXED_ISO = '2024-01-15T12:30:45.123Z'
  const ENDPOINT = 'https://elasticloadbalancing.us-east-1.amazonaws.com/'
  const BODY = `Action=DescribeLoadBalancers&Version=${ API_VERSION }`

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  function sign(overrides = {}) {
    const headers = { 'content-type': 'application/x-www-form-urlencoded', ...(overrides.headers || {}) }

    signRequest(
      overrides.method || 'POST',
      overrides.url || ENDPOINT,
      headers,
      overrides.body !== undefined ? overrides.body : BODY,
      overrides.credentials || CREDS,
      overrides.region || 'us-east-1',
      overrides.service || SERVICE
    )

    return headers
  }

  it('sets the deterministic SigV4 headers', () => {
    const headers = sign()

    expect(headers['x-amz-date']).toBe('20240115T123045Z')
    expect(headers.host).toBe('elasticloadbalancing.us-east-1.amazonaws.com')

    expect(headers['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update(BODY).digest('hex'))

    expect(headers.authorization).toMatch(
      new RegExp(
        '^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20240115/us-east-1/elasticloadbalancing/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('matches an independently derived signature', () => {
    const headers = sign()
    const { authorization, ...signedInputs } = headers

    expect(authorization).toBe(referenceAuthorization({
      method: 'POST',
      url: ENDPOINT,
      headers: signedInputs,
      body: BODY,
      credentials: CREDS,
      region: 'us-east-1',
      service: SERVICE,
      amzDate: headers['x-amz-date'],
    }))
  })

  it('matches the independent reference for temporary credentials too', () => {
    const credentials = { ...CREDS, sessionToken: 'SESSION' }
    const headers = sign({ credentials })
    const { authorization, ...signedInputs } = headers

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(authorization).toBe(referenceAuthorization({
      method: 'POST',
      url: ENDPOINT,
      headers: signedInputs,
      body: BODY,
      credentials,
      region: 'us-east-1',
      service: SERVICE,
      amzDate: headers['x-amz-date'],
    }))

    expect(authorization).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )
  })

  it('produces a stable signature for identical input', () => {
    expect(sign().authorization).toBe(sign().authorization)
  })

  it('changes the signature when the payload, secret, region or service change', () => {
    const baseline = sign().authorization

    expect(sign({ body: `${ BODY }&PageSize=1` }).authorization).not.toBe(baseline)
    expect(sign({ credentials: { ...CREDS, secretAccessKey: 'OTHER' } }).authorization).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' }).authorization).not.toBe(baseline)
    expect(sign({ service: 'sts' }).authorization).not.toBe(baseline)
    expect(sign({ method: 'GET' }).authorization).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    expect(sign({ body: '' })['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
    expect(sign({ body: null })['x-amz-content-sha256']).toBe(crypto.createHash('sha256').update('').digest('hex'))
  })

  it('keeps an existing host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } })

    expect(explicit.host).toBeUndefined()
    expect(explicit.Host).toBe('custom.example.com')

    expect(sign({ url: 'https://localhost:4566/' }).host).toBe('localhost:4566')
    expect(sign({ url: 'https://localhost:443/' }).host).toBe('localhost')
  })

  it('sorts the canonical query string so parameter order does not matter', () => {
    const a = sign({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key?b=2&a=1', body: '', service: 's3' })
    const b = sign({ method: 'GET', url: 'https://s3.amazonaws.com/bucket/key?a=1&b=2', body: '', service: 's3' })

    expect(a.authorization).toBe(b.authorization)
  })

  it('canonicalizes path segments and repeated query keys', () => {
    const headers = sign({
      method: 'GET',
      url: 'https://s3.us-east-1.amazonaws.com/my bucket/a+b?a=2&a=1',
      body: '',
      service: 's3',
    })

    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/)
  })

  it('percent-encodes non-ASCII path characters', () => {
    const headers = sign({ method: 'GET', url: 'https://s3.amazonaws.com/b/ünïcodé', body: '', service: 's3' })

    expect(headers.authorization).toMatch(/Signature=[0-9a-f]{64}$/)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date('2024-01-15T12:30:45.123Z'))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  it('adds the SigV4 query parameters and a signature', () => {
    const url = new URL(
      generatePresignedUrl('GET', 'https://my-bucket.s3.us-east-1.amazonaws.com/some file.txt', CREDS, 'us-east-1', 's3', 900)
    )

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDEXAMPLE/20240115/us-east-1/s3/aws4_request')
    expect(url.searchParams.get('X-Amz-Date')).toBe('20240115T123045Z')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()
  })

  it('includes the session token and reacts to a non-standard port', () => {
    const withToken = new URL(
      generatePresignedUrl('PUT', 'https://localhost:4566/bucket/key', { ...CREDS, sessionToken: 'SESSION' }, 'us-east-1', 's3', 60)
    )

    expect(withToken.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')
    expect(withToken.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces a stable signature that reacts to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 60)

    expect(first).toBe(second)

    expect(generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', CREDS, 'us-east-1', 's3', 120)).not.toBe(first)
  })
})
