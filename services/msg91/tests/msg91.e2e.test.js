'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('MSG91 Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('msg91')
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

  // ── Account ──

  describe('getBalance', () => {
    it('returns balance for Transactional route', async () => {
      const result = await service.getBalance('Transactional')

      expect(result).toBeDefined()
    })

    it('returns balance for Promotional route', async () => {
      const result = await service.getBalance('Promotional')

      expect(result).toBeDefined()
    })
  })

  // ── OTP Flow ──

  describe('OTP flow', () => {
    it('sends an OTP to the test mobile number', async () => {
      const { mobile, otpTemplateId } = testValues

      if (!mobile || !otpTemplateId) {
        console.log('Skipping OTP tests: testValues.mobile or testValues.otpTemplateId not set')
        return
      }

      const result = await service.sendOtp(mobile, otpTemplateId)

      expect(result).toHaveProperty('type', 'success')
    })

    it('resends OTP via text', async () => {
      const { mobile } = testValues

      if (!mobile) {
        console.log('Skipping resendOtp: testValues.mobile not set')
        return
      }

      const result = await service.resendOtp(mobile, 'Text')

      expect(result).toHaveProperty('type', 'success')
    })
  })

  // ── SMS ──

  describe('sendSms', () => {
    it('sends an SMS using a flow template', async () => {
      const { mobile, smsTemplateId } = testValues

      if (!mobile || !smsTemplateId) {
        console.log('Skipping sendSms: testValues.mobile or testValues.smsTemplateId not set')
        return
      }

      const result = await service.sendSms(smsTemplateId, [{ mobiles: mobile }])

      expect(result).toHaveProperty('type', 'success')
    })
  })

  // ── Email ──

  describe('sendEmail', () => {
    it('sends an email using an approved template', async () => {
      const { toEmail, fromEmail, emailDomain, emailTemplateId } = testValues

      if (!toEmail || !fromEmail || !emailDomain || !emailTemplateId) {
        console.log('Skipping sendEmail: one or more email testValues not set')
        return
      }

      const result = await service.sendEmail(toEmail, fromEmail, emailDomain, emailTemplateId)

      expect(result).toBeDefined()
    })
  })

  // ── WhatsApp ──

  describe('sendWhatsappMessage', () => {
    it('sends a WhatsApp message using an approved template', async () => {
      const { integratedNumber, whatsappRecipient, whatsappTemplateName } = testValues

      if (!integratedNumber || !whatsappRecipient || !whatsappTemplateName) {
        console.log('Skipping sendWhatsappMessage: WhatsApp testValues not set')
        return
      }

      const result = await service.sendWhatsappMessage(
        integratedNumber, whatsappRecipient, whatsappTemplateName
      )

      expect(result).toBeDefined()
    })
  })
})
