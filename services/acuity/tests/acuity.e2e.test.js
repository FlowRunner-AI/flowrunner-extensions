'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Acuity Scheduling Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('acuity')
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

  // ── Account ──

  describe('getMe', () => {
    it('returns account profile with expected shape', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('email')
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('timezone')
    })
  })

  // ── Calendars ──

  describe('listCalendars', () => {
    it('returns an array of calendars', async () => {
      const result = await service.listCalendars()

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
      }
    })
  })

  // ── Appointment Types ──

  describe('listAppointmentTypes', () => {
    it('returns an array of appointment types', async () => {
      const result = await service.listAppointmentTypes()

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('duration')
      }
    })
  })

  // ── Appointments ──

  describe('listAppointments', () => {
    it('returns an array of appointments', async () => {
      const result = await service.listAppointments(5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Clients ──

  describe('listClients', () => {
    it('returns an array of clients', async () => {
      const result = await service.listClients()

      expect(Array.isArray(result)).toBe(true)

      if (result.length > 0) {
        expect(result[0]).toHaveProperty('firstName')
        expect(result[0]).toHaveProperty('lastName')
      }
    })

    it('accepts a search parameter', async () => {
      const result = await service.listClients('nonexistent-e2e-search-term')

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('returns an array of forms', async () => {
      const result = await service.listForms()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Certificates ──

  describe('listCertificates', () => {
    it('returns an array of certificates', async () => {
      const result = await service.listCertificates()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Dictionaries ──

  describe('getAppointmentTypesDictionary', () => {
    it('returns dictionary items with label, value, and cursor', async () => {
      const result = await service.getAppointmentTypesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })

    it('filters items by search term', async () => {
      const all = await service.getAppointmentTypesDictionary({})
      const filtered = await service.getAppointmentTypesDictionary({ search: 'zzz-nonexistent' })

      expect(filtered.items.length).toBeLessThanOrEqual(all.items.length)
    })
  })

  describe('getCalendarsDictionary', () => {
    it('returns dictionary items with label, value, and cursor', async () => {
      const result = await service.getCalendarsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      expect(result).toHaveProperty('cursor', null)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  // ── Availability ──

  describe('getAvailabilityDates', () => {
    it('returns availability dates for a month', async () => {
      const types = await service.listAppointmentTypes()

      if (types.length === 0) {
        console.log('Skipping: no appointment types configured')
        return
      }

      const typeId = String(types[0].id)
      const now = new Date()
      const month = `${ now.getFullYear() }-${ String(now.getMonth() + 1).padStart(2, '0') }`

      const result = await service.getAvailabilityDates(month, typeId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getAvailabilityTimes', () => {
    it('returns availability times for a date', async () => {
      const types = await service.listAppointmentTypes()

      if (types.length === 0) {
        console.log('Skipping: no appointment types configured')
        return
      }

      const typeId = String(types[0].id)
      const now = new Date()
      const month = `${ now.getFullYear() }-${ String(now.getMonth() + 1).padStart(2, '0') }`
      const dates = await service.getAvailabilityDates(month, typeId)

      if (dates.length === 0) {
        console.log('Skipping: no available dates this month')
        return
      }

      const result = await service.getAvailabilityTimes(dates[0].date, typeId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Polling Trigger ──

  describe('onNewAppointment', () => {
    it('initializes baseline on first poll', async () => {
      const result = await service.onNewAppointment({
        eventName: 'onNewAppointment',
        triggerData: {},
        state: {},
      })

      expect(result).toHaveProperty('events')
      expect(result).toHaveProperty('state')
      expect(Array.isArray(result.events)).toBe(true)
      expect(result.state).toHaveProperty('lastSeenId')
    })
  })
})
