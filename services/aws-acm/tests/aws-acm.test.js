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

const { CredentialProvider } = require('../src/credentials')
const { createLogger, mapAwsError } = require('../src/errors')
const { signRequest, generatePresignedUrl } = require('../src/sigv4')

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

// ─────────────────────────────────────────────────────────────────────────────
// Helper modules — aws-client.js / credentials.js / errors.js / sigv4.js
// ─────────────────────────────────────────────────────────────────────────────

const HELPER_CREDS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE' }

// Drives the mocked node http(s) module with a canned response (or a transport error).
function stubHttps({ statusCode = 200, body = '', error = null, resError = null, transport = https } = {}) {
  const captured = { options: null, written: [], timeout: null, destroyed: null }

  transport.request.mockImplementation((options, callback) => {
    captured.options = options

    const req = new EventEmitter()

    req.write = chunk => captured.written.push(chunk)

    req.setTimeout = (ms, handler) => {
      captured.timeout = { ms, handler }
    }

    req.destroy = err => {
      captured.destroyed = err
    }

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

        if (resError) {
          res.emit('error', resError)

          return
        }

        res.emit('data', Buffer.from(body))
        res.emit('end')
      })
    }

    return req
  })

  return captured
}

// ── aws-client: XML helpers ──

describe('aws-client XML helpers', () => {
  it('extracts the first matching tag', () => {
    expect(parseXmlTag('<a><b>one</b><b>two</b></a>', 'b')).toBe('one')
  })

  it('returns null when the tag is absent', () => {
    expect(parseXmlTag('<a/>', 'b')).toBeNull()
  })

  it('extracts all matching tags including multi-line values', () => {
    expect(parseXmlTags('<a><b>one</b><b>two\nlines</b></a>', 'b')).toEqual(['one', 'two\nlines'])
  })

  it('returns an empty array when nothing matches', () => {
    expect(parseXmlTags('<a/>', 'b')).toEqual([])
  })
})

// ── aws-client: request building and response parsing ──

describe('buildAwsJsonRequest', () => {
  it('builds an AWS JSON request with a target header', () => {
    expect(buildAwsJsonRequest({
      region: 'eu-west-1',
      service: 'acm',
      target: 'Target.Operation',
      body: { Limit: 1 },
      contentType: 'application/x-amz-json-1.1',
    })).toEqual({
      method: 'POST',
      url: 'https://acm.eu-west-1.amazonaws.com/',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'Target.Operation',
      },
      body: '{"Limit":1}',
    })
  })

  it('passes a string body through and omits the target header', () => {
    const built = buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'acm',
      body: '{"a":1}',
      contentType: 'application/json',
    })

    expect(built.body).toBe('{"a":1}')
    expect(built.headers).not.toHaveProperty('x-amz-target')
  })

  it('serializes a missing body as an empty object', () => {
    expect(buildAwsJsonRequest({
      region: 'us-east-1',
      service: 'acm',
      contentType: 'application/json',
    }).body).toBe('{}')
  })
})

describe('parseJsonResponse', () => {
  it('parses a successful JSON body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '{"a":1}' })).toEqual({ a: 1 })
  })

  it('returns an empty object for an empty or missing body', () => {
    expect(parseJsonResponse({ statusCode: 200, body: '  ' })).toEqual({})
    expect(parseJsonResponse({ statusCode: 200 })).toEqual({})
  })

  it('throws a named error built from __type for an error status', () => {
    try {
      parseJsonResponse({
        statusCode: 400,
        body: '{"__type":"com.amazon.coral.service#ValidationException","message":"bad input"}',
      })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('ValidationException')
      expect(error.message).toBe('bad input')
      expect(error.statusCode).toBe(400)
    }
  })

  it('uses the code field and the capitalized Message field', () => {
    try {
      parseJsonResponse({ statusCode: 403, body: '{"code":"AccessDenied","Message":"nope"}' })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AccessDenied')
      expect(error.message).toBe('nope')
    }
  })

  it('falls back to a generic name and message', () => {
    try {
      parseJsonResponse({ statusCode: 500, body: '{}' })

      throw new Error('should have thrown')
    } catch (error) {
      expect(error.name).toBe('AwsError')
      expect(error.message).toBe('Request failed with status 500')
    }
  })
})

describe('jsonRequest with an injected transport', () => {
  it('signs the built request and parses the response', async () => {
    const sign = jest.fn()
    const send = jest.fn().mockResolvedValue({ statusCode: 200, body: '{"Ok":true}' })

    const result = await jsonRequest(
      {
        region: 'us-east-1',
        service: 'acm',
        target: 'Target.Operation',
        body: { a: 1 },
        contentType: 'application/x-amz-json-1.1',
      },
      HELPER_CREDS,
      { signRequest: sign, httpRequest: send }
    )

    expect(result).toEqual({ Ok: true })

    expect(sign).toHaveBeenCalledWith(
      'POST',
      'https://acm.us-east-1.amazonaws.com/',
      { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'Target.Operation' },
      '{"a":1}',
      HELPER_CREDS,
      'us-east-1',
      'acm'
    )

    expect(send).toHaveBeenCalledWith(
      'POST',
      'https://acm.us-east-1.amazonaws.com/',
      expect.objectContaining({ 'content-type': 'application/x-amz-json-1.1' }),
      '{"a":1}'
    )
  })

  it('propagates the error thrown for an error status', async () => {
    const send = jest.fn().mockResolvedValue({
      statusCode: 400,
      body: '{"__type":"ValidationException","message":"bad"}',
    })

    await expect(
      jsonRequest(
        { region: 'us-east-1', service: 'acm', contentType: 'application/json' },
        HELPER_CREDS,
        { signRequest: jest.fn(), httpRequest: send }
      )
    ).rejects.toMatchObject({ name: 'ValidationException', message: 'bad', statusCode: 400 })
  })
})

// ── aws-client: low level HTTP transport ──

describe('httpRequest', () => {
  afterEach(() => {
    https.request.mockReset()
    http.request.mockReset()
  })

  it('sends the body, sets content-length and resolves with the response', async () => {
    const captured = stubHttps({ statusCode: 200, body: '{"ok":true}' })

    const response = await httpRequest(
      'POST',
      'https://acm.us-east-1.amazonaws.com/path?a=1',
      { 'content-type': 'application/json' },
      'hello'
    )

    expect(captured.options).toMatchObject({
      hostname: 'acm.us-east-1.amazonaws.com',
      port: 443,
      path: '/path?a=1',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': 5 },
    })

    expect(captured.written).toEqual(['hello'])

    expect(response).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'text/xml' },
      body: '{"ok":true}',
    })
  })

  it('omits content-length and writes nothing when there is no body', async () => {
    const captured = stubHttps({ statusCode: 204, body: '' })

    await httpRequest('GET', 'https://acm.us-east-1.amazonaws.com/', {})

    expect(captured.options.headers).not.toHaveProperty('content-length')
    expect(captured.written).toEqual([])
  })

  it('uses the plain http transport and port 80 for http URLs', async () => {
    const captured = stubHttps({ statusCode: 200, body: 'ok', transport: http })

    await httpRequest('GET', 'http://localhost/ping', {})

    expect(https.request).not.toHaveBeenCalled()
    expect(captured.options).toMatchObject({ port: 80, hostname: 'localhost', path: '/ping' })
  })

  it('keeps an explicit port from the URL', async () => {
    const captured = stubHttps({ statusCode: 200, body: 'ok' })

    await httpRequest('GET', 'https://localhost:4566/', {})

    expect(captured.options.port).toBe('4566')
  })

  it('rejects on a transport error', async () => {
    stubHttps({ error: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) })

    await expect(httpRequest('GET', 'https://acm.us-east-1.amazonaws.com/', {})).rejects.toThrow(
      'connect ECONNREFUSED'
    )
  })

  it('rejects when the response stream errors', async () => {
    stubHttps({ statusCode: 200, resError: new Error('stream broke') })

    await expect(httpRequest('GET', 'https://acm.us-east-1.amazonaws.com/', {})).rejects.toThrow(
      'stream broke'
    )
  })

  it('registers a 30s timeout that destroys the request', async () => {
    const captured = stubHttps({ statusCode: 200, body: '' })

    await httpRequest('GET', 'https://acm.us-east-1.amazonaws.com/', {})

    expect(captured.timeout.ms).toBe(30000)

    captured.timeout.handler()

    expect(captured.destroyed).toBeInstanceOf(Error)
    expect(captured.destroyed.message).toBe('Request timed out')
  })
})

// ── aws-client: STS AssumeRole ──

describe('stsAssumeRole', () => {
  const OK_BODY =
    '<AssumeRoleResponse><AssumeRoleResult><Credentials>' +
    '<AccessKeyId>ASIA123</AccessKeyId>' +
    '<SecretAccessKey>secret123</SecretAccessKey>' +
    '<SessionToken>token123</SessionToken>' +
    '<Expiration>2030-01-01T00:00:00Z</Expiration>' +
    '</Credentials></AssumeRoleResult></AssumeRoleResponse>'

  afterEach(() => {
    https.request.mockReset()
  })

  it('signs the STS call and returns the temporary credentials', async () => {
    const captured = stubHttps({ statusCode: 200, body: OK_BODY })

    const result = await stsAssumeRole(HELPER_CREDS, 'eu-west-1', 'arn:aws:iam::1:role/R', 'session-1', 'ext-1')

    expect(captured.options.hostname).toBe('sts.eu-west-1.amazonaws.com')

    expect(captured.written[0]).toBe(
      'Action=AssumeRole&Version=2011-06-15' +
      '&RoleArn=arn%3Aaws%3Aiam%3A%3A1%3Arole%2FR' +
      '&RoleSessionName=session-1' +
      '&ExternalId=ext-1'
    )

    expect(captured.options.headers).toMatchObject({
      'content-type': 'application/x-www-form-urlencoded',
      host: 'sts.eu-west-1.amazonaws.com',
    })

    expect(captured.options.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/sts\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/
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

    await stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session-2')

    expect(captured.written[0]).not.toContain('ExternalId')
  })

  it('throws a named error when STS rejects the request', async () => {
    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>Not authorized to assume role</Message></Error></ErrorResponse>',
    })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'AccessDenied',
      message: 'Not authorized to assume role',
      statusCode: 403,
    })
  })

  it('falls back to a generic STS error when the body has no code or message', async () => {
    stubHttps({ statusCode: 500, body: '<html/>' })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSError',
      message: 'STS AssumeRole failed',
      statusCode: 500,
    })
  })

  it('throws a parse error when credential fields are missing', async () => {
    stubHttps({ statusCode: 200, body: '<AssumeRoleResponse/>' })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toMatchObject({
      name: 'STSParseError',
      message: 'Failed to parse STS AssumeRole response: missing credential fields',
    })
  })

  it('propagates transport errors', async () => {
    stubHttps({ error: new Error('socket hang up') })

    await expect(stsAssumeRole(HELPER_CREDS, 'us-east-1', 'arn:role', 'session')).rejects.toThrow('socket hang up')
  })
})

// ── credentials.js ──

describe('CredentialProvider', () => {
  it('applies the documented defaults', () => {
    const provider = new CredentialProvider()

    expect(provider.authenticationMethod).toBe('API Key')
    expect(provider.region).toBe('us-east-1')
  })

  it('returns the static API key credentials', async () => {
    const provider = new CredentialProvider({ accessKeyId: 'AK', secretAccessKey: 'SK', region: 'eu-west-1' })

    await expect(provider.resolve()).resolves.toEqual({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  })

  it('requires both keys for API key authentication', async () => {
    await expect(new CredentialProvider({ accessKeyId: 'AK' }).resolve()).rejects.toThrow(
      'Access Key and Secret Key are required for API Key authentication.'
    )

    await expect(new CredentialProvider({ secretAccessKey: 'SK' }).resolve()).rejects.toThrow(
      /API Key authentication/
    )
  })

  it('assumes the configured role, caches the result and refreshes past the expiry buffer', async () => {
    let now = 1000000

    const stsAssumeRoleSpy = jest.fn().mockImplementation(() => Promise.resolve({
      accessKeyId: 'ASIA',
      secretAccessKey: 'S',
      sessionToken: 'T',
      expiration: new Date(now + 3600000),
    }))

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

    const first = await provider.resolve()

    expect(first).toEqual({ accessKeyId: 'ASIA', secretAccessKey: 'S', sessionToken: 'T' })

    expect(stsAssumeRoleSpy).toHaveBeenCalledWith(
      { accessKeyId: 'AK', secretAccessKey: 'SK' },
      'eu-west-1',
      'arn:role',
      `flowrunner-acm-${ now }`,
      'ext'
    )

    // Well inside the 5 minute expiry buffer — served from the cache.
    now += 3000000

    await expect(provider.resolve()).resolves.toBe(first)
    expect(stsAssumeRoleSpy).toHaveBeenCalledTimes(1)

    // Inside the buffer window — the credentials are refreshed.
    now += 400000

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

  it('defaults to the real stsAssumeRole implementation', async () => {
    https.request.mockReset()

    stubHttps({
      statusCode: 403,
      body: '<ErrorResponse><Error><Code>AccessDenied</Code><Message>denied</Message></Error></ErrorResponse>',
    })

    const provider = new CredentialProvider({
      authenticationMethod: 'IAM Role',
      accessKeyId: 'AK',
      secretAccessKey: 'SK',
      roleArn: 'arn:role',
    })

    await expect(provider.resolve()).rejects.toMatchObject({ name: 'AccessDenied' })

    https.request.mockReset()
  })
})

// ── errors.js ──

describe('createLogger', () => {
  it('prefixes every level with the service name', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createLogger('AWS Certificate Manager')

    spy.mockClear()

    logger.info('a')
    logger.debug('b')
    logger.warn('c')
    logger.error('d')

    expect(spy.mock.calls).toEqual([
      ['[AWS Certificate Manager Service]', 'info:', 'a'],
      ['[AWS Certificate Manager Service]', 'debug:', 'b'],
      ['[AWS Certificate Manager Service]', 'warn:', 'c'],
      ['[AWS Certificate Manager Service]', 'error:', 'd'],
    ])

    spy.mockRestore()
  })
})

describe('mapAwsError', () => {
  function mapped(name, message, extra = {}) {
    return mapAwsError(Object.assign(new Error(message), { name }, extra))
  }

  it('maps throttling errors', () => {
    expect(mapped('ThrottlingException', 'Rate exceeded').message).toMatch(/throttled by AWS: Rate exceeded/)
    expect(mapped('Throttling', 'x').message).toMatch(/throttled by AWS/)
    expect(mapped('ProvisionedThroughputExceededException', 'x').message).toMatch(/throttled by AWS/)
  })

  it('maps credential errors, including by message content', () => {
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

// ── sigv4.js ──
//
// The expected signatures below are computed by `referenceSignature`, an
// implementation written directly from the AWS Signature Version 4 specification
// (Create a canonical request → Create a string to sign → Calculate the signature)
// rather than copied from src/sigv4.js, so the assertions independently verify the
// service implementation. The clock is frozen so every signature is deterministic —
// no assertion depends on the live clock.

const FIXED_ISO = '2015-08-30T12:36:00.000Z'
const FIXED_AMZ_DATE = '20150830T123600Z'
const FIXED_DATE_STAMP = '20150830'

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest()
}

/**
 * Independent SigV4 reference for requests whose path needs no escaping and whose
 * header names are already lowercase (every case asserted below).
 */
function referenceSignature({ method, url, headers, body, credentials, region, service }) {
  const parsed = new URL(url)
  const payloadHash = sha256Hex(body || '')

  const canonicalHeaderMap = { ...headers, host: parsed.host, 'x-amz-date': FIXED_AMZ_DATE, 'x-amz-content-sha256': payloadHash }

  if (credentials.sessionToken) {
    canonicalHeaderMap['x-amz-security-token'] = credentials.sessionToken
  }

  const names = Object.keys(canonicalHeaderMap).sort()
  const canonicalHeaders = names.map(name => `${ name }:${ String(canonicalHeaderMap[name]).trim() }\n`).join('')
  const signedHeaders = names.join(';')

  const query = [...parsed.searchParams.entries()]
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(pair => pair.map(part => encodeURIComponent(part)).join('='))
    .join('&')

  const canonicalRequest = [
    method,
    decodeURIComponent(parsed.pathname),
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`

  const stringToSign = ['AWS4-HMAC-SHA256', FIXED_AMZ_DATE, scope, sha256Hex(canonicalRequest)].join('\n')

  const signingKey = [FIXED_DATE_STAMP, region, service, 'aws4_request']
    .reduce((key, part) => hmac(key, part), 'AWS4' + credentials.secretAccessKey)

  const signature = hmac(signingKey, stringToSign).toString('hex')

  return {
    signature,
    signedHeaders,
    scope,
    payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${ credentials.accessKeyId }/${ scope }, ` +
      `SignedHeaders=${ signedHeaders }, ` +
      `Signature=${ signature }`,
  }
}

describe('sigv4 signRequest', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  const URL_ROOT = 'https://acm.us-east-1.amazonaws.com/'

  function sign(overrides = {}) {
    const args = {
      method: 'POST',
      url: URL_ROOT,
      headers: { 'content-type': 'application/x-amz-json-1.1' },
      body: '{"Name":"value"}',
      credentials: HELPER_CREDS,
      region: 'us-east-1',
      service: 'acm',
      ...overrides,
    }

    // Snapshot the caller-supplied headers before signRequest mutates them so the
    // reference implementation starts from the same input.
    const inputHeaders = { ...args.headers }

    signRequest(args.method, args.url, args.headers, args.body, args.credentials, args.region, args.service)

    return { headers: args.headers, expected: referenceSignature({ ...args, headers: inputHeaders }) }
  }

  it('matches an independently derived signature and scope', () => {
    const { headers, expected } = sign()

    expect(headers['x-amz-date']).toBe(FIXED_AMZ_DATE)
    expect(headers['host']).toBe('acm.us-east-1.amazonaws.com')
    expect(headers['x-amz-content-sha256']).toBe(sha256Hex('{"Name":"value"}'))
    expect(expected.scope).toBe(`${ FIXED_DATE_STAMP }/us-east-1/acm/aws4_request`)

    expect(headers['authorization']).toBe(expected.authorization)

    expect(headers['authorization']).toMatch(
      new RegExp(
        '^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/' + FIXED_DATE_STAMP + '/us-east-1/acm/aws4_request, ' +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' +
        'Signature=[0-9a-f]{64}$'
      )
    )
  })

  it('signs headers in lowercase alphabetical order', () => {
    const { headers } = sign({
      headers: { 'x-amz-target': 'T.Op', 'content-type': 'application/x-amz-json-1.1', accept: 'application/json' },
    })

    expect(headers['authorization']).toContain(
      'SignedHeaders=accept;content-type;host;x-amz-content-sha256;x-amz-date;x-amz-target'
    )
  })

  it('is stable for identical input and sensitive to body, secret, region and service', () => {
    const baseline = sign().headers['authorization']

    expect(sign().headers['authorization']).toBe(baseline)
    expect(sign({ body: '{"Name":"other"}' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ credentials: { ...HELPER_CREDS, secretAccessKey: 'OTHER' } }).headers['authorization']).not.toBe(baseline)
    expect(sign({ region: 'eu-west-1' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ service: 'sts' }).headers['authorization']).not.toBe(baseline)
    expect(sign({ method: 'GET' }).headers['authorization']).not.toBe(baseline)
  })

  it('hashes an empty payload when no body is given', () => {
    const { headers, expected } = sign({ body: '' })

    expect(headers['x-amz-content-sha256']).toBe(sha256Hex(''))
    expect(headers['authorization']).toBe(expected.authorization)

    const undefinedBody = sign({ body: undefined })

    expect(undefinedBody.headers['x-amz-content-sha256']).toBe(sha256Hex(''))
  })

  it('signs the session token for temporary credentials', () => {
    const { headers, expected } = sign({ credentials: { ...HELPER_CREDS, sessionToken: 'SESSION' } })

    expect(headers['x-amz-security-token']).toBe('SESSION')

    expect(headers['authorization']).toContain(
      'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token'
    )

    expect(headers['authorization']).toBe(expected.authorization)
  })

  it('keeps an explicitly provided host header and includes a non-standard port', () => {
    const explicit = sign({ headers: { Host: 'custom.example.com' } }).headers

    expect(explicit['host']).toBeUndefined()
    expect(explicit['Host']).toBe('custom.example.com')

    const ported = sign({ url: 'https://localhost:4566/' })

    expect(ported.headers['host']).toBe('localhost:4566')
    expect(ported.headers['authorization']).toBe(ported.expected.authorization)
  })

  it('canonicalizes a multi-segment path and sorts the query string', () => {
    const withPath = sign({
      method: 'GET',
      body: '',
      url: 'https://acm.us-east-1.amazonaws.com/model/anthropic.claude-v2/invoke?b=2&a=1',
    })

    expect(withPath.headers['authorization']).toBe(withPath.expected.authorization)

    const reordered = sign({
      method: 'GET',
      body: '',
      url: 'https://acm.us-east-1.amazonaws.com/model/anthropic.claude-v2/invoke?a=1&b=2',
    })

    // Query parameter ordering must not change the signature.
    expect(reordered.headers['authorization']).toBe(withPath.headers['authorization'])
  })

  it('sorts repeated query keys by value', () => {
    const ascending = sign({ method: 'GET', body: '', url: `${ URL_ROOT }?a=1&a=0` })
    const descending = sign({ method: 'GET', body: '', url: `${ URL_ROOT }?a=0&a=1` })

    expect(ascending.headers['authorization']).toBe(ascending.expected.authorization)
    expect(ascending.headers['authorization']).toBe(descending.headers['authorization'])
  })

  it('percent-encodes spaces and multi-byte characters in the path', () => {
    const headers = {}

    signRequest(
      'GET',
      'https://s3.us-east-1.amazonaws.com/my bucket/café.txt',
      headers,
      '',
      HELPER_CREDS,
      'us-east-1',
      's3'
    )

    expect(headers['authorization']).toMatch(/Signature=[0-9a-f]{64}$/)

    // %20 for the space and the UTF-8 bytes for é must both feed the canonical URI.
    const spacey = {}
    const plussed = {}

    signRequest('GET', 'https://s3.us-east-1.amazonaws.com/my bucket/a', spacey, '', HELPER_CREDS, 'us-east-1', 's3')
    signRequest('GET', 'https://s3.us-east-1.amazonaws.com/my+bucket/a', plussed, '', HELPER_CREDS, 'us-east-1', 's3')

    expect(spacey['authorization']).not.toBe(plussed['authorization'])
  })

  it('returns the same headers object it mutated', () => {
    const headers = {}

    expect(signRequest('GET', URL_ROOT, headers, '', HELPER_CREDS, 'us-east-1', 'acm')).toBe(headers)
  })
})

describe('sigv4 generatePresignedUrl', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.setSystemTime(new Date(FIXED_ISO))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  /** Independent reference for the query-string (presigned) SigV4 variant. */
  function referencePresignedSignature(method, rawUrl, credentials, region, service, expiresIn) {
    const parsed = new URL(rawUrl)

    parsed.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
    parsed.searchParams.set('X-Amz-Credential', `${ credentials.accessKeyId }/${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`)
    parsed.searchParams.set('X-Amz-Date', FIXED_AMZ_DATE)
    parsed.searchParams.set('X-Amz-Expires', String(expiresIn))
    parsed.searchParams.set('X-Amz-SignedHeaders', 'host')

    if (credentials.sessionToken) {
      parsed.searchParams.set('X-Amz-Security-Token', credentials.sessionToken)
    }

    const query = [...parsed.searchParams.entries()]
      .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
      .map(([key, value]) => `${ encodeURIComponent(key) }=${ encodeURIComponent(value) }`)
      .join('&')

    const canonicalRequest = [
      method,
      decodeURIComponent(parsed.pathname),
      query,
      `host:${ parsed.host }\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n')

    const scope = `${ FIXED_DATE_STAMP }/${ region }/${ service }/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', FIXED_AMZ_DATE, scope, sha256Hex(canonicalRequest)].join('\n')

    const signingKey = [FIXED_DATE_STAMP, region, service, 'aws4_request']
      .reduce((key, part) => hmac(key, part), 'AWS4' + credentials.secretAccessKey)

    return hmac(signingKey, stringToSign).toString('hex')
  }

  it('adds every SigV4 query parameter and an independently derived signature', () => {
    const raw = 'https://bucket.s3.us-east-1.amazonaws.com/key.txt'
    const url = new URL(generatePresignedUrl('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 900))

    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256')
    expect(url.searchParams.get('X-Amz-Credential')).toBe(`AKIDEXAMPLE/${ FIXED_DATE_STAMP }/us-east-1/s3/aws4_request`)
    expect(url.searchParams.get('X-Amz-Date')).toBe(FIXED_AMZ_DATE)
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900')
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(url.searchParams.get('X-Amz-Security-Token')).toBeNull()

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 900)
    )
  })

  it('includes the session token and reacts to a non-standard port', () => {
    const creds = { ...HELPER_CREDS, sessionToken: 'SESSION' }
    const raw = 'https://localhost:4566/bucket/key'
    const url = new URL(generatePresignedUrl('PUT', raw, creds, 'us-east-1', 's3', 60))

    expect(url.searchParams.get('X-Amz-Security-Token')).toBe('SESSION')

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('PUT', raw, creds, 'us-east-1', 's3', 60)
    )
  })

  it('sorts repeated query keys by value', () => {
    const raw = 'https://b.s3.amazonaws.com/k?x=2&x=1'
    const url = new URL(generatePresignedUrl('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 60))

    expect(url.searchParams.get('X-Amz-Signature')).toBe(
      referencePresignedSignature('GET', raw, HELPER_CREDS, 'us-east-1', 's3', 60)
    )
  })

  it('is stable for identical input and sensitive to the expiry window', () => {
    const first = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 60)
    const second = generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 60)

    expect(first).toBe(second)

    expect(generatePresignedUrl('GET', 'https://b.s3.amazonaws.com/k', HELPER_CREDS, 'us-east-1', 's3', 120)).not.toBe(first)
  })
})

// ── Remaining error paths on the service methods ──

describe('AwsAcm error propagation', () => {
  let instance
  let jsonRequestMock

  beforeEach(() => {
    const { AwsAcm } = require('../src/index.js')

    instance = new AwsAcm(TEST_CONFIG)
    jsonRequestMock = jest.fn().mockRejectedValue(Object.assign(new Error('nope'), { name: 'AccessDeniedException' }))
    instance.deps.jsonRequest = jsonRequestMock
  })

  it.each([
    ['getCertificate', c => c.getCertificate(CERT_ARN)],
    ['listTagsForCertificate', c => c.listTagsForCertificate(CERT_ARN)],
    ['removeTagsFromCertificate', c => c.removeTagsFromCertificate(CERT_ARN, { Env: 'prod' })],
    ['resendValidationEmail', c => c.resendValidationEmail(CERT_ARN, 'example.com', 'example.com')],
    ['getCertificatesDictionary', c => c.getCertificatesDictionary({})],
  ])('maps errors raised by %s', async (_name, invoke) => {
    await expect(invoke(instance)).rejects.toThrow('Access denied: nope')
    expect(jsonRequestMock).toHaveBeenCalled()
  })
})
