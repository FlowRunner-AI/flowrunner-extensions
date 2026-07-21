'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('AWS ACM Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('aws-acm')
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

  // ── List Certificates ──

  describe('listCertificates', () => {
    it('returns certificates array with expected shape', async () => {
      const result = await service.listCertificates()

      expect(result).toHaveProperty('certificates')
      expect(Array.isArray(result.certificates)).toBe(true)
      expect(result).toHaveProperty('nextToken')
    })

    it('accepts maxItems parameter', async () => {
      const result = await service.listCertificates(null, 5)

      expect(result).toHaveProperty('certificates')
      expect(result.certificates.length).toBeLessThanOrEqual(5)
    })

    it('filters by certificate status', async () => {
      const result = await service.listCertificates(['Issued'])

      expect(result).toHaveProperty('certificates')
      expect(Array.isArray(result.certificates)).toBe(true)

      for (const cert of result.certificates) {
        expect(cert.Status).toBe('ISSUED')
      }
    })
  })

  // ── Dictionary ──

  describe('getCertificatesDictionary', () => {
    it('returns dictionary items with label, value, and optional note', async () => {
      const result = await service.getCertificatesDictionary()

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor')

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('supports search filtering', async () => {
      const result = await service.getCertificatesDictionary({ search: 'nonexistent-domain-xyz-123' })

      expect(result).toHaveProperty('items')
      expect(result.items).toHaveLength(0)
    })
  })

  // ── Request + Describe + Tags + Delete lifecycle ──

  describe('certificate lifecycle', () => {
    let createdArn

    it('requests a new certificate', async () => {
      const result = await service.requestCertificate(
        'e2e-test.flowrunner-test.example',
        'DNS',
        null,
        null,
        { TestSuite: 'e2e', CreatedBy: 'jest' }
      )

      expect(result).toHaveProperty('certificateArn')
      expect(result.certificateArn).toMatch(/^arn:aws:acm:/)
      createdArn = result.certificateArn
    })

    it('describes the created certificate', async () => {
      if (!createdArn) return

      const result = await service.describeCertificate(createdArn)

      expect(result).toHaveProperty('certificate')
      expect(result.certificate).toHaveProperty('CertificateArn', createdArn)
      expect(result.certificate).toHaveProperty('DomainName', 'e2e-test.flowrunner-test.example')
      expect(result.certificate).toHaveProperty('Status')
    })

    it('lists tags for the created certificate', async () => {
      if (!createdArn) return

      const result = await service.listTagsForCertificate(createdArn)

      expect(result).toHaveProperty('tags')
      expect(Array.isArray(result.tags)).toBe(true)

      const testSuiteTag = result.tags.find(t => t.Key === 'TestSuite')

      expect(testSuiteTag).toBeDefined()
      expect(testSuiteTag.Value).toBe('e2e')
    })

    it('adds additional tags to the certificate', async () => {
      if (!createdArn) return

      const result = await service.addTagsToCertificate(createdArn, { ExtraTag: 'extra-value' })

      expect(result).toEqual({ tagged: true, certificateArn: createdArn })
    })

    it('verifies the new tag was added', async () => {
      if (!createdArn) return

      const result = await service.listTagsForCertificate(createdArn)
      const extraTag = result.tags.find(t => t.Key === 'ExtraTag')

      expect(extraTag).toBeDefined()
      expect(extraTag.Value).toBe('extra-value')
    })

    it('removes a tag from the certificate', async () => {
      if (!createdArn) return

      const result = await service.removeTagsFromCertificate(createdArn, { ExtraTag: 'extra-value' })

      expect(result).toEqual({ untagged: true, certificateArn: createdArn })
    })

    it('verifies the tag was removed', async () => {
      if (!createdArn) return

      const result = await service.listTagsForCertificate(createdArn)
      const extraTag = result.tags.find(t => t.Key === 'ExtraTag')

      expect(extraTag).toBeUndefined()
    })

    it('deletes the created certificate', async () => {
      if (!createdArn) return

      const result = await service.deleteCertificate(createdArn)

      expect(result).toEqual({ deleted: true, certificateArn: createdArn })
    })
  })

  // ── Error cases ──

  describe('error handling', () => {
    it('throws on describe with invalid ARN', async () => {
      await expect(service.describeCertificate('invalid-arn')).rejects.toThrow()
    })

    it('throws on get certificate with non-existent ARN', async () => {
      await expect(
        service.getCertificate('arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow()
    })
  })
})
