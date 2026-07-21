'use strict'

const { createSandbox } = require('../../../service-sandbox')

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
})
