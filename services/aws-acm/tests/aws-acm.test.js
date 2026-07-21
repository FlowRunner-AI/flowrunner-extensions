'use strict'

const { createSandbox } = require('../../../service-sandbox')

const TEST_CONFIG = {
  authenticationMethod: 'API Key',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
}

const CERT_ARN = 'arn:aws:acm:us-east-1:123456789012:certificate/abcd1234'

describe('AWS ACM Service', () => {
  let sandbox
  let service
  let jsonRequestMock

  beforeAll(() => {
    sandbox = createSandbox(TEST_CONFIG)
    require('../src/index.js')
    service = sandbox.getService()
  })

  beforeEach(() => {
    jsonRequestMock = jest.fn()
    service.deps.jsonRequest = jsonRequestMock
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'authenticationMethod', required: true, shared: false, type: 'CHOICE' }),
          expect.objectContaining({ name: 'region', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'accessKeyId', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'secretAccessKey', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'roleArn', required: false, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'externalId', required: false, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('registers exactly 6 config items', () => {
      expect(sandbox.getConfigItems()).toHaveLength(6)
    })
  })

  // ── List Certificates ──

  describe('listCertificates', () => {
    it('sends correct request with no parameters', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [], NextToken: null })

      const result = await service.listCertificates()

      expect(jsonRequestMock).toHaveBeenCalledTimes(1)
      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.service).toBe('acm')
      expect(opts.region).toBe('us-east-1')
      expect(opts.target).toBe('CertificateManager.ListCertificates')
      expect(opts.contentType).toBe('application/x-amz-json-1.1')
      expect(opts.body).toEqual({})

      expect(result).toEqual({ certificates: [], nextToken: null })
    })

    it('maps certificate status labels to API values', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      await service.listCertificates(['Pending Validation', 'Issued'])

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.CertificateStatuses).toEqual(['PENDING_VALIDATION', 'ISSUED'])
    })

    it('passes maxItems and nextToken', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      await service.listCertificates(null, 10, 'token123')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.MaxItems).toBe(10)
      expect(opts.body.NextToken).toBe('token123')
    })

    it('omits empty certificateStatuses array', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      await service.listCertificates([])

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body).not.toHaveProperty('CertificateStatuses')
    })

    it('returns certificates and nextToken from response', async () => {
      const certs = [
        { CertificateArn: CERT_ARN, DomainName: 'example.com', Status: 'ISSUED' },
      ]

      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: certs, NextToken: 'next-page' })

      const result = await service.listCertificates()

      expect(result.certificates).toEqual(certs)
      expect(result.nextToken).toBe('next-page')
    })

    it('throws on API error', async () => {
      const error = new Error('Throttled')

      error.name = 'ThrottlingException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.listCertificates()).rejects.toThrow('throttled')
    })
  })

  // ── Describe Certificate ──

  describe('describeCertificate', () => {
    it('sends correct request', async () => {
      const certData = { CertificateArn: CERT_ARN, DomainName: 'example.com', Status: 'ISSUED' }

      jsonRequestMock.mockResolvedValue({ Certificate: certData })

      const result = await service.describeCertificate(CERT_ARN)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.DescribeCertificate')
      expect(opts.body).toEqual({ CertificateArn: CERT_ARN })
      expect(result).toEqual({ certificate: certData })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.describeCertificate()).rejects.toThrow('certificateArn is required')
    })

    it('returns null certificate when response has no Certificate field', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.describeCertificate(CERT_ARN)

      expect(result).toEqual({ certificate: null })
    })

    it('throws mapped error for ResourceNotFoundException', async () => {
      const error = new Error('Certificate not found')

      error.name = 'ResourceNotFoundException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.describeCertificate(CERT_ARN)).rejects.toThrow('Certificate not found')
    })
  })

  // ── Request Certificate ──

  describe('requestCertificate', () => {
    it('sends correct request with required params only', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      const result = await service.requestCertificate('example.com')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.RequestCertificate')
      expect(opts.body).toEqual({ DomainName: 'example.com' })
      expect(result).toEqual({ certificateArn: CERT_ARN })
    })

    it('throws when domainName is missing', async () => {
      await expect(service.requestCertificate()).rejects.toThrow('domainName is required')
    })

    it('maps validation method label to API value', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', 'DNS')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.ValidationMethod).toBe('DNS')
    })

    it('maps Email validation method', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', 'Email')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.ValidationMethod).toBe('EMAIL')
    })

    it('includes subject alternative names when provided', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, ['www.example.com', 'api.example.com'])

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.SubjectAlternativeNames).toEqual(['www.example.com', 'api.example.com'])
    })

    it('omits empty subject alternative names', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, [])

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body).not.toHaveProperty('SubjectAlternativeNames')
    })

    it('maps key algorithm label to API value', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, null, 'RSA 4096')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.KeyAlgorithm).toBe('RSA_4096')
    })

    it('maps ECDSA key algorithm', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, null, 'ECDSA P-256 (EC_prime256v1)')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.KeyAlgorithm).toBe('EC_prime256v1')
    })

    it('converts tags object to tag list', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, null, null, { Environment: 'prod', Team: 'web' })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.Tags).toEqual([
        { Key: 'Environment', Value: 'prod' },
        { Key: 'Team', Value: 'web' },
      ])
    })

    it('includes idempotency token when provided', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate('example.com', null, null, null, null, 'my_token_123')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.IdempotencyToken).toBe('my_token_123')
    })

    it('sends all optional parameters together', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateArn: CERT_ARN })

      await service.requestCertificate(
        '*.example.com',
        'DNS',
        ['example.com'],
        'RSA 2048',
        { Env: 'test' },
        'token_abc'
      )

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body).toEqual({
        DomainName: '*.example.com',
        ValidationMethod: 'DNS',
        SubjectAlternativeNames: ['example.com'],
        KeyAlgorithm: 'RSA_2048',
        Tags: [{ Key: 'Env', Value: 'test' }],
        IdempotencyToken: 'token_abc',
      })
    })
  })

  // ── Delete Certificate ──

  describe('deleteCertificate', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.deleteCertificate(CERT_ARN)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.DeleteCertificate')
      expect(opts.body).toEqual({ CertificateArn: CERT_ARN })
      expect(result).toEqual({ deleted: true, certificateArn: CERT_ARN })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.deleteCertificate()).rejects.toThrow('certificateArn is required')
    })

    it('throws mapped error for InvalidArnException', async () => {
      const error = new Error('Invalid ARN')

      error.name = 'InvalidArnException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.deleteCertificate(CERT_ARN)).rejects.toThrow('Invalid ARN')
    })
  })

  // ── Get Certificate ──

  describe('getCertificate', () => {
    it('sends correct request and returns PEM data', async () => {
      const pemCert = '-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----'
      const pemChain = '-----BEGIN CERTIFICATE-----\nMIIE...\n-----END CERTIFICATE-----'

      jsonRequestMock.mockResolvedValue({ Certificate: pemCert, CertificateChain: pemChain })

      const result = await service.getCertificate(CERT_ARN)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.GetCertificate')
      expect(opts.body).toEqual({ CertificateArn: CERT_ARN })
      expect(result).toEqual({ certificate: pemCert, certificateChain: pemChain })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.getCertificate()).rejects.toThrow('certificateArn is required')
    })

    it('returns nulls when response fields are missing', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.getCertificate(CERT_ARN)

      expect(result).toEqual({ certificate: null, certificateChain: null })
    })
  })

  // ── Add Tags To Certificate ──

  describe('addTagsToCertificate', () => {
    it('sends correct request with tags', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.addTagsToCertificate(CERT_ARN, { Environment: 'prod', Owner: 'team' })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.AddTagsToCertificate')
      expect(opts.body).toEqual({
        CertificateArn: CERT_ARN,
        Tags: [
          { Key: 'Environment', Value: 'prod' },
          { Key: 'Owner', Value: 'team' },
        ],
      })
      expect(result).toEqual({ tagged: true, certificateArn: CERT_ARN })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.addTagsToCertificate(null, { key: 'val' })).rejects.toThrow('certificateArn is required')
    })

    it('throws when tags is empty object', async () => {
      await expect(service.addTagsToCertificate(CERT_ARN, {})).rejects.toThrow('tags must contain at least one key/value pair')
    })

    it('throws when tags is not an object', async () => {
      await expect(service.addTagsToCertificate(CERT_ARN, 'invalid')).rejects.toThrow('tags must contain at least one key/value pair')
    })

    it('throws when tags is null', async () => {
      await expect(service.addTagsToCertificate(CERT_ARN, null)).rejects.toThrow('tags must contain at least one key/value pair')
    })

    it('throws mapped error for TooManyTagsException', async () => {
      const error = new Error('Too many tags')

      error.name = 'TooManyTagsException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.addTagsToCertificate(CERT_ARN, { a: 'b' })).rejects.toThrow('Tag error')
    })
  })

  // ── List Tags For Certificate ──

  describe('listTagsForCertificate', () => {
    it('sends correct request and returns tags', async () => {
      const tags = [{ Key: 'Environment', Value: 'prod' }]

      jsonRequestMock.mockResolvedValue({ Tags: tags })

      const result = await service.listTagsForCertificate(CERT_ARN)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.ListTagsForCertificate')
      expect(opts.body).toEqual({ CertificateArn: CERT_ARN })
      expect(result).toEqual({ tags })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.listTagsForCertificate()).rejects.toThrow('certificateArn is required')
    })

    it('returns empty array when no tags in response', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.listTagsForCertificate(CERT_ARN)

      expect(result).toEqual({ tags: [] })
    })
  })

  // ── Remove Tags From Certificate ──

  describe('removeTagsFromCertificate', () => {
    it('sends correct request with tags including values', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.removeTagsFromCertificate(CERT_ARN, { Environment: 'prod' })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.RemoveTagsFromCertificate')
      expect(opts.body).toEqual({
        CertificateArn: CERT_ARN,
        Tags: [{ Key: 'Environment', Value: 'prod' }],
      })
      expect(result).toEqual({ untagged: true, certificateArn: CERT_ARN })
    })

    it('omits value for empty string (key-only match for removal)', async () => {
      jsonRequestMock.mockResolvedValue({})

      await service.removeTagsFromCertificate(CERT_ARN, { Environment: '' })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.Tags).toEqual([{ Key: 'Environment' }])
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.removeTagsFromCertificate(null, { k: 'v' })).rejects.toThrow('certificateArn is required')
    })

    it('throws when tags is empty', async () => {
      await expect(service.removeTagsFromCertificate(CERT_ARN, {})).rejects.toThrow('tags must contain at least one key to remove')
    })
  })

  // ── Resend Validation Email ──

  describe('resendValidationEmail', () => {
    it('sends correct request with all required params', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.resendValidationEmail(CERT_ARN, 'www.example.com', 'example.com')

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.ResendValidationEmail')
      expect(opts.body).toEqual({
        CertificateArn: CERT_ARN,
        Domain: 'www.example.com',
        ValidationDomain: 'example.com',
      })
      expect(result).toEqual({ resent: true, certificateArn: CERT_ARN, domain: 'www.example.com' })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.resendValidationEmail(null, 'a.com', 'a.com')).rejects.toThrow('certificateArn is required')
    })

    it('throws when domain is missing', async () => {
      await expect(service.resendValidationEmail(CERT_ARN, null, 'a.com')).rejects.toThrow('domain is required')
    })

    it('throws when validationDomain is missing', async () => {
      await expect(service.resendValidationEmail(CERT_ARN, 'a.com', null)).rejects.toThrow('validationDomain is required')
    })
  })

  // ── Renew Certificate ──

  describe('renewCertificate', () => {
    it('sends correct request and returns confirmation', async () => {
      jsonRequestMock.mockResolvedValue({})

      const result = await service.renewCertificate(CERT_ARN)

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.RenewCertificate')
      expect(opts.body).toEqual({ CertificateArn: CERT_ARN })
      expect(result).toEqual({ renewalRequested: true, certificateArn: CERT_ARN })
    })

    it('throws when certificateArn is missing', async () => {
      await expect(service.renewCertificate()).rejects.toThrow('certificateArn is required')
    })

    it('throws mapped error for InvalidStateException', async () => {
      const error = new Error('Certificate is not eligible')

      error.name = 'InvalidStateException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.renewCertificate(CERT_ARN)).rejects.toThrow('not in a valid state')
    })
  })

  // ── Dictionary: getCertificatesDictionary ──

  describe('getCertificatesDictionary', () => {
    it('sends ListCertificates with MaxItems 100 and no cursor', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      const result = await service.getCertificatesDictionary()

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.target).toBe('CertificateManager.ListCertificates')
      expect(opts.body).toEqual({ MaxItems: 100 })
      expect(result).toEqual({ items: [], cursor: null })
    })

    it('passes cursor as NextToken', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      await service.getCertificatesDictionary({ cursor: 'page2' })

      const [opts] = jsonRequestMock.mock.calls[0]

      expect(opts.body.NextToken).toBe('page2')
    })

    it('maps certificates to dictionary items', async () => {
      jsonRequestMock.mockResolvedValue({
        CertificateSummaryList: [
          { CertificateArn: CERT_ARN, DomainName: 'example.com', Status: 'ISSUED' },
          { CertificateArn: 'arn:2', DomainName: 'test.com', Status: 'PENDING_VALIDATION' },
        ],
        NextToken: 'next',
      })

      const result = await service.getCertificatesDictionary()

      expect(result.items).toEqual([
        { label: 'example.com', value: CERT_ARN, note: 'ISSUED' },
        { label: 'test.com', value: 'arn:2', note: 'PENDING_VALIDATION' },
      ])
      expect(result.cursor).toBe('next')
    })

    it('filters items by search term (case-insensitive)', async () => {
      jsonRequestMock.mockResolvedValue({
        CertificateSummaryList: [
          { CertificateArn: CERT_ARN, DomainName: 'example.com', Status: 'ISSUED' },
          { CertificateArn: 'arn:2', DomainName: 'test.org', Status: 'ISSUED' },
        ],
      })

      const result = await service.getCertificatesDictionary({ search: 'EXAMPLE' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('example.com')
    })

    it('uses CertificateArn as label when DomainName is missing', async () => {
      jsonRequestMock.mockResolvedValue({
        CertificateSummaryList: [{ CertificateArn: CERT_ARN }],
      })

      const result = await service.getCertificatesDictionary()

      expect(result.items[0].label).toBe(CERT_ARN)
    })

    it('handles null payload gracefully', async () => {
      jsonRequestMock.mockResolvedValue({ CertificateSummaryList: [] })

      const result = await service.getCertificatesDictionary(null)

      expect(result).toEqual({ items: [], cursor: null })
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('maps LimitExceededException', async () => {
      const error = new Error('Quota exceeded')

      error.name = 'LimitExceededException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.listCertificates()).rejects.toThrow('quota has been exceeded')
    })

    it('maps InvalidParameterException', async () => {
      const error = new Error('Bad param')

      error.name = 'InvalidParameterException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.describeCertificate(CERT_ARN)).rejects.toThrow('Invalid request parameter')
    })

    it('maps RequestInProgressException', async () => {
      const error = new Error('Still processing')

      error.name = 'RequestInProgressException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.deleteCertificate(CERT_ARN)).rejects.toThrow('still in progress')
    })

    it('maps InvalidTagException', async () => {
      const error = new Error('Invalid tag key')

      error.name = 'InvalidTagException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.addTagsToCertificate(CERT_ARN, { a: 'b' })).rejects.toThrow('Tag error')
    })

    it('maps TagPolicyException', async () => {
      const error = new Error('Policy violation')

      error.name = 'TagPolicyException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.addTagsToCertificate(CERT_ARN, { a: 'b' })).rejects.toThrow('Tag error')
    })

    it('maps AccessDeniedException via mapAwsError', async () => {
      const error = new Error('Not allowed')

      error.name = 'AccessDeniedException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.listCertificates()).rejects.toThrow('Access denied')
    })

    it('maps InvalidSignatureException via mapAwsError', async () => {
      const error = new Error('Bad signature')

      error.name = 'InvalidSignatureException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.listCertificates()).rejects.toThrow('Invalid AWS credentials')
    })

    it('maps connection errors via mapAwsError', async () => {
      const error = new Error('Connection timed out')

      error.code = 'ETIMEDOUT'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.listCertificates()).rejects.toThrow('Connection to AWS failed')
    })

    it('maps InvalidDomainValidationOptionsException', async () => {
      const error = new Error('Bad domain options')

      error.name = 'InvalidDomainValidationOptionsException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.requestCertificate('example.com')).rejects.toThrow('Invalid ARN or domain validation options')
    })

    it('maps RequestFailedException', async () => {
      const error = new Error('Request failed')

      error.name = 'RequestFailedException'
      jsonRequestMock.mockRejectedValue(error)

      await expect(service.renewCertificate(CERT_ARN)).rejects.toThrow('not in a valid state')
    })
  })
})
