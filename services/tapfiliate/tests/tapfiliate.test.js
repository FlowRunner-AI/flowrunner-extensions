'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const BASE = 'https://api.tapfiliate.com/1.6'

describe('Tapfiliate Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  afterEach(() => {
    mock.reset()
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration ──

  describe('service registration', () => {
    it('registers with correct config items', () => {
      expect(sandbox.getConfigItems()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true, shared: false }),
        ])
      )
    })
  })

  // ── Affiliates ──

  describe('createAffiliate', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/affiliates/`).reply({ id: 'john-doe', firstname: 'John', lastname: 'Doe', email: 'john@example.com' })

      const result = await service.createAffiliate('John', 'Doe', 'john@example.com')

      expect(result).toEqual({ id: 'john-doe', firstname: 'John', lastname: 'Doe', email: 'john@example.com' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].headers).toMatchObject({ 'X-Api-Key': API_KEY })
      expect(mock.history[0].body).toEqual({ firstname: 'John', lastname: 'Doe', email: 'john@example.com' })
    })

    it('includes optional password and company', async () => {
      mock.onPost(`${BASE}/affiliates/`).reply({ id: 'jane-doe' })

      await service.createAffiliate('Jane', 'Doe', 'jane@example.com', 'secret123', { name: 'Acme Inc' })

      expect(mock.history[0].body).toEqual({
        firstname: 'Jane',
        lastname: 'Doe',
        email: 'jane@example.com',
        password: 'secret123',
        company: { name: 'Acme Inc' },
      })
    })

    it('omits optional fields when not provided', async () => {
      mock.onPost(`${BASE}/affiliates/`).reply({ id: 'test' })

      await service.createAffiliate('A', 'B', 'a@b.com')

      expect(mock.history[0].body).not.toHaveProperty('password')
      expect(mock.history[0].body).not.toHaveProperty('company')
    })

    it('throws on API error', async () => {
      mock.onPost(`${BASE}/affiliates/`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'Email already exists' }] },
      })

      await expect(service.createAffiliate('A', 'B', 'dup@example.com')).rejects.toThrow('Tapfiliate API error: Email already exists')
    })
  })

  describe('getAffiliate', () => {
    it('sends GET with correct URL', async () => {
      mock.onGet(`${BASE}/affiliates/john-doe/`).reply({ id: 'john-doe', firstname: 'John' })

      const result = await service.getAffiliate('john-doe')

      expect(result).toEqual({ id: 'john-doe', firstname: 'John' })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
      expect(mock.history[0].headers).toMatchObject({ 'X-Api-Key': API_KEY })
    })

    it('encodes affiliate ID in URL', async () => {
      mock.onGet(`${BASE}/affiliates/special%20id/`).reply({ id: 'special id' })

      await service.getAffiliate('special id')

      expect(mock.history[0].url).toBe(`${BASE}/affiliates/special%20id/`)
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/affiliates/missing/`).replyWithError({
        message: 'Not Found',
        body: { message: 'Affiliate not found' },
      })

      await expect(service.getAffiliate('missing')).rejects.toThrow('Tapfiliate API error: Affiliate not found')
    })
  })

  describe('listAffiliates', () => {
    it('sends GET with no filters by default', async () => {
      mock.onGet(`${BASE}/affiliates/`).reply([{ id: 'a1' }, { id: 'a2' }])

      const result = await service.listAffiliates()

      expect(result).toEqual([{ id: 'a1' }, { id: 'a2' }])
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].method).toBe('get')
    })

    it('passes filter parameters', async () => {
      mock.onGet(`${BASE}/affiliates/`).reply([])

      await service.listAffiliates('click-1', 'src-1', 'ref-code', 2)

      expect(mock.history[0].query).toMatchObject({
        click_id: 'click-1',
        source_id: 'src-1',
        referral_code: 'ref-code',
        page: 2,
      })
    })

    it('omits undefined filter parameters', async () => {
      mock.onGet(`${BASE}/affiliates/`).reply([])

      await service.listAffiliates(undefined, undefined, undefined, 1)

      expect(mock.history[0].query).toMatchObject({ page: 1 })
      expect(mock.history[0].query).not.toHaveProperty('click_id')
    })
  })

  describe('updateAffiliate', () => {
    it('sends PUT with correct body', async () => {
      mock.onPut(`${BASE}/affiliates/john-doe/`).reply({ id: 'john-doe', firstname: 'Jonathan' })

      const result = await service.updateAffiliate('john-doe', 'Jonathan')

      expect(result).toEqual({ id: 'john-doe', firstname: 'Jonathan' })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({ firstname: 'Jonathan' })
    })

    it('includes all optional fields when provided', async () => {
      mock.onPut(`${BASE}/affiliates/a1/`).reply({ id: 'a1' })

      await service.updateAffiliate('a1', 'First', 'Last', 'new@email.com', 'newpass', { name: 'Corp' })

      expect(mock.history[0].body).toEqual({
        firstname: 'First',
        lastname: 'Last',
        email: 'new@email.com',
        password: 'newpass',
        company: { name: 'Corp' },
      })
    })

    it('throws on API error', async () => {
      mock.onPut(`${BASE}/affiliates/bad/`).replyWithError({ message: 'Server Error' })

      await expect(service.updateAffiliate('bad', 'X')).rejects.toThrow('Tapfiliate API error: Server Error')
    })
  })

  describe('deleteAffiliate', () => {
    it('sends DELETE and returns success object', async () => {
      mock.onDelete(`${BASE}/affiliates/john-doe/`).reply({})

      const result = await service.deleteAffiliate('john-doe')

      expect(result).toEqual({ success: true, id: 'john-doe' })
      expect(mock.history[0].method).toBe('delete')
    })

    it('throws on API error', async () => {
      mock.onDelete(`${BASE}/affiliates/missing/`).replyWithError({ message: 'Not Found' })

      await expect(service.deleteAffiliate('missing')).rejects.toThrow()
    })
  })

  describe('approveAffiliate', () => {
    it('sends PUT to program approval URL with empty body', async () => {
      mock.onPut(`${BASE}/programs/prog-1/affiliates/aff-1/approval/`).reply({ approved: true })

      const result = await service.approveAffiliate('prog-1', 'aff-1')

      expect(result).toEqual({ approved: true })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('disapproveAffiliate', () => {
    it('sends DELETE and returns constructed result', async () => {
      mock.onDelete(`${BASE}/programs/prog-1/affiliates/aff-1/approval/`).reply({})

      const result = await service.disapproveAffiliate('prog-1', 'aff-1')

      expect(result).toEqual({
        approved: false,
        affiliate: { id: 'aff-1' },
        program: { id: 'prog-1' },
      })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Programs ──

  describe('listPrograms', () => {
    it('sends GET with page parameter', async () => {
      mock.onGet(`${BASE}/programs/`).reply([{ id: 'prog-1', title: 'My Program' }])

      const result = await service.listPrograms(1)

      expect(result).toEqual([{ id: 'prog-1', title: 'My Program' }])
      expect(mock.history[0].query).toMatchObject({ page: 1 })
    })

    it('sends GET without page when not provided', async () => {
      mock.onGet(`${BASE}/programs/`).reply([])

      await service.listPrograms()

      expect(mock.history[0].query).not.toHaveProperty('page')
    })
  })

  describe('getProgram', () => {
    it('sends GET with encoded program ID', async () => {
      mock.onGet(`${BASE}/programs/prog-1/`).reply({ id: 'prog-1', title: 'My Program', currency: 'USD' })

      const result = await service.getProgram('prog-1')

      expect(result).toEqual({ id: 'prog-1', title: 'My Program', currency: 'USD' })
      expect(mock.history[0].method).toBe('get')
    })
  })

  describe('addAffiliateToProgram', () => {
    it('sends POST with affiliate id', async () => {
      mock.onPost(`${BASE}/programs/prog-1/affiliates/`).reply({ approved: true, affiliate: { id: 'aff-1' } })

      const result = await service.addAffiliateToProgram('prog-1', 'aff-1')

      expect(result).toEqual({ approved: true, affiliate: { id: 'aff-1' } })
      expect(mock.history[0].body).toMatchObject({ affiliate: { id: 'aff-1' } })
    })

    it('sends POST with affiliate email instead of id', async () => {
      mock.onPost(`${BASE}/programs/prog-1/affiliates/`).reply({ approved: false })

      await service.addAffiliateToProgram('prog-1', undefined, 'aff@example.com')

      expect(mock.history[0].body).toMatchObject({ affiliate: { email: 'aff@example.com' } })
      expect(mock.history[0].body.affiliate).not.toHaveProperty('id')
    })

    it('includes approved and coupon when provided', async () => {
      mock.onPost(`${BASE}/programs/prog-1/affiliates/`).reply({})

      await service.addAffiliateToProgram('prog-1', 'aff-1', undefined, true, 'SAVE10')

      expect(mock.history[0].body).toMatchObject({
        affiliate: { id: 'aff-1' },
        approved: true,
        coupon: 'SAVE10',
      })
    })
  })

  describe('listProgramAffiliates', () => {
    it('sends GET with program ID', async () => {
      mock.onGet(`${BASE}/programs/prog-1/affiliates/`).reply([{ approved: true }])

      const result = await service.listProgramAffiliates('prog-1')

      expect(result).toEqual([{ approved: true }])
      expect(mock.history[0].method).toBe('get')
    })

    it('maps Approved to approved=true query param', async () => {
      mock.onGet(`${BASE}/programs/prog-1/affiliates/`).reply([])

      await service.listProgramAffiliates('prog-1', 'Approved', 1)

      expect(mock.history[0].query).toMatchObject({ approved: 'true', page: 1 })
    })

    it('maps Not Approved to approved=false query param', async () => {
      mock.onGet(`${BASE}/programs/prog-1/affiliates/`).reply([])

      await service.listProgramAffiliates('prog-1', 'Not Approved')

      expect(mock.history[0].query).toMatchObject({ approved: 'false' })
    })

    it('omits approved when no status filter', async () => {
      mock.onGet(`${BASE}/programs/prog-1/affiliates/`).reply([])

      await service.listProgramAffiliates('prog-1')

      expect(mock.history[0].query).not.toHaveProperty('approved')
    })
  })

  // ── Conversions ──

  describe('createConversion', () => {
    it('sends POST with minimal tracking identifier', async () => {
      mock.onPost(`${BASE}/conversions/`).reply({ id: 12345 })

      const result = await service.createConversion(undefined, undefined, undefined, 'click-1')

      expect(result).toEqual({ id: 12345 })
      expect(mock.history[0].body).toEqual({ click_id: 'click-1' })
    })

    it('sends POST with all fields', async () => {
      mock.onPost(`${BASE}/conversions/`).reply({ id: 12346 })

      await service.createConversion(
        'order-987', 100, 'prog-1', 'click-1', 'ref-code', 'cust-1', 'SAVE10',
        [{ amount: 10, comment: 'Sale' }],
        { plan: 'pro' }
      )

      expect(mock.history[0].body).toEqual({
        external_id: 'order-987',
        amount: 100,
        program_group: 'prog-1',
        click_id: 'click-1',
        referral_code: 'ref-code',
        customer_id: 'cust-1',
        coupon: 'SAVE10',
        commissions: [{ amount: 10, comment: 'Sale' }],
        meta_data: { plan: 'pro' },
      })
    })

    it('omits undefined optional fields', async () => {
      mock.onPost(`${BASE}/conversions/`).reply({ id: 1 })

      await service.createConversion(undefined, 50, undefined, undefined, 'ref-1')

      expect(mock.history[0].body).toEqual({ amount: 50, referral_code: 'ref-1' })
    })
  })

  describe('getConversion', () => {
    it('sends GET with conversion ID', async () => {
      mock.onGet(`${BASE}/conversions/12345/`).reply({ id: 12345, amount: 100 })

      const result = await service.getConversion('12345')

      expect(result).toEqual({ id: 12345, amount: 100 })
      expect(mock.history[0].method).toBe('get')
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/conversions/999/`).replyWithError({ message: 'Not Found' })

      await expect(service.getConversion('999')).rejects.toThrow()
    })
  })

  describe('listConversions', () => {
    it('sends GET with all filter parameters', async () => {
      mock.onGet(`${BASE}/conversions/`).reply([{ id: 1 }])

      await service.listConversions('prog-1', 'aff-1', 'ext-1', '2026-01-01', '2026-12-31', 2)

      expect(mock.history[0].query).toMatchObject({
        program_id: 'prog-1',
        affiliate_id: 'aff-1',
        external_id: 'ext-1',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
        page: 2,
      })
    })

    it('omits undefined filters', async () => {
      mock.onGet(`${BASE}/conversions/`).reply([])

      await service.listConversions()

      expect(mock.history[0].query).toEqual({})
    })
  })

  describe('addCommissionToConversion', () => {
    it('sends POST with required fields', async () => {
      mock.onPost(`${BASE}/conversions/12345/commissions/`).reply({ id: 54322, amount: 5 })

      const result = await service.addCommissionToConversion('12345', 50)

      expect(result).toEqual({ id: 54322, amount: 5 })
      expect(mock.history[0].body).toEqual({ conversion_sub_amount: 50 })
    })

    it('includes optional comment and commission type', async () => {
      mock.onPost(`${BASE}/conversions/12345/commissions/`).reply({ id: 54323 })

      await service.addCommissionToConversion('12345', 100, 'Bonus', 'bonus-type')

      expect(mock.history[0].body).toEqual({
        conversion_sub_amount: 100,
        comment: 'Bonus',
        commission_type: 'bonus-type',
      })
    })
  })

  // ── Commissions ──

  describe('listCommissions', () => {
    it('sends GET with no filters', async () => {
      mock.onGet(`${BASE}/commissions/`).reply([{ id: 1 }])

      const result = await service.listCommissions()

      expect(result).toEqual([{ id: 1 }])
      expect(mock.history[0].method).toBe('get')
    })

    it('maps Pending status to pending=true', async () => {
      mock.onGet(`${BASE}/commissions/`).reply([])

      await service.listCommissions('Pending')

      expect(mock.history[0].query).toMatchObject({ pending: 'true' })
    })

    it('maps Approved status to pending=false', async () => {
      mock.onGet(`${BASE}/commissions/`).reply([])

      await service.listCommissions('Approved')

      expect(mock.history[0].query).toMatchObject({ pending: 'false' })
    })

    it('passes affiliate and conversion filters', async () => {
      mock.onGet(`${BASE}/commissions/`).reply([])

      await service.listCommissions(undefined, 'aff-1', 'conv-1', 3)

      expect(mock.history[0].query).toMatchObject({
        affiliate_id: 'aff-1',
        conversion_id: 'conv-1',
        page: 3,
      })
    })
  })

  describe('getCommission', () => {
    it('sends GET with commission ID', async () => {
      mock.onGet(`${BASE}/commissions/54321/`).reply({ id: 54321, amount: 10 })

      const result = await service.getCommission('54321')

      expect(result).toEqual({ id: 54321, amount: 10 })
    })
  })

  describe('approveCommission', () => {
    it('sends PUT with empty body', async () => {
      mock.onPut(`${BASE}/commissions/54321/approval/`).reply({ id: 54321, approved: true })

      const result = await service.approveCommission('54321')

      expect(result).toEqual({ id: 54321, approved: true })
      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].body).toEqual({})
    })
  })

  describe('disapproveCommission', () => {
    it('sends DELETE and returns constructed result', async () => {
      mock.onDelete(`${BASE}/commissions/54321/approval/`).reply({})

      const result = await service.disapproveCommission('54321')

      expect(result).toEqual({ id: '54321', approved: false })
      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Customers ──

  describe('createCustomer', () => {
    it('sends POST with required customer ID and click ID', async () => {
      mock.onPost(`${BASE}/customers/`).reply({ id: 'cust-123' })

      const result = await service.createCustomer('cust-123', 'click-1')

      expect(result).toEqual({ id: 'cust-123' })
      expect(mock.history[0].body).toEqual({ customer_id: 'cust-123', click_id: 'click-1' })
    })

    it('includes optional referral code, coupon and status', async () => {
      mock.onPost(`${BASE}/customers/`).reply({ id: 'cust-456' })

      await service.createCustomer('cust-456', undefined, 'ref-code', 'SAVE10', 'trial')

      expect(mock.history[0].body).toEqual({
        customer_id: 'cust-456',
        referral_code: 'ref-code',
        coupon: 'SAVE10',
        status: 'trial',
      })
    })
  })

  describe('getCustomer', () => {
    it('sends GET with customer ID', async () => {
      mock.onGet(`${BASE}/customers/cust-123/`).reply({ id: 'cust-123', status: 'active' })

      const result = await service.getCustomer('cust-123')

      expect(result).toEqual({ id: 'cust-123', status: 'active' })
    })
  })

  describe('listCustomers', () => {
    it('sends GET with all filters', async () => {
      mock.onGet(`${BASE}/customers/`).reply([{ id: 'c1' }])

      await service.listCustomers('aff-1', 'prog-1', '2026-01-01', '2026-12-31', 2)

      expect(mock.history[0].query).toMatchObject({
        affiliate_id: 'aff-1',
        program_id: 'prog-1',
        date_from: '2026-01-01',
        date_to: '2026-12-31',
        page: 2,
      })
    })

    it('omits undefined filters', async () => {
      mock.onGet(`${BASE}/customers/`).reply([])

      await service.listCustomers()

      expect(mock.history[0].query).toEqual({})
    })
  })

  // ── Dictionaries ──

  describe('getProgramsDictionary', () => {
    it('returns mapped items with label and value', async () => {
      mock.onGet(`${BASE}/programs/`).reply([
        { id: 'prog-1', title: 'My Program', currency: 'USD' },
        { id: 'prog-2', title: 'Other Program', currency: 'EUR' },
      ])

      const result = await service.getProgramsDictionary({})

      expect(result.items).toEqual([
        { label: 'My Program', value: 'prog-1', note: 'USD' },
        { label: 'Other Program', value: 'prog-2', note: 'EUR' },
      ])
    })

    it('filters by case-insensitive search', async () => {
      mock.onGet(`${BASE}/programs/`).reply([
        { id: 'prog-1', title: 'Alpha Program', currency: 'USD' },
        { id: 'prog-2', title: 'Beta Program', currency: 'EUR' },
      ])

      const result = await service.getProgramsDictionary({ search: 'alpha' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('prog-1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${BASE}/programs/`).reply([{ id: 'p1', title: 'P1' }])

      const result = await service.getProgramsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('handles non-array response', async () => {
      mock.onGet(`${BASE}/programs/`).reply(null)

      const result = await service.getProgramsDictionary({})

      expect(result.items).toEqual([])
      expect(result.cursor).toBeUndefined()
    })

    it('uses cursor as page number', async () => {
      mock.onGet(`${BASE}/programs/`).reply([])

      await service.getProgramsDictionary({ cursor: '3' })

      expect(mock.history[0].query).toMatchObject({ page: 3 })
    })

    it('returns next cursor when results fill a page (25 items)', async () => {
      const programs = Array.from({ length: 25 }, (_, i) => ({ id: `p-${i}`, title: `Program ${i}` }))
      mock.onGet(`${BASE}/programs/`).reply(programs)

      const result = await service.getProgramsDictionary({})

      expect(result.cursor).toBe('2')
    })

    it('returns undefined cursor when results are less than page size', async () => {
      mock.onGet(`${BASE}/programs/`).reply([{ id: 'p1', title: 'P1' }])

      const result = await service.getProgramsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('uses program id as label fallback when title is missing', async () => {
      mock.onGet(`${BASE}/programs/`).reply([{ id: 'prog-no-title' }])

      const result = await service.getProgramsDictionary({})

      expect(result.items[0].label).toBe('prog-no-title')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts errors array from response body', async () => {
      mock.onGet(`${BASE}/affiliates/x/`).replyWithError({
        message: 'Bad Request',
        body: { errors: [{ message: 'Invalid field' }, { message: 'Missing value' }] },
      })

      await expect(service.getAffiliate('x')).rejects.toThrow('Tapfiliate API error: Invalid field; Missing value')
    })

    it('extracts message from response body', async () => {
      mock.onGet(`${BASE}/affiliates/x/`).replyWithError({
        message: 'Forbidden',
        body: { message: 'Access denied' },
      })

      await expect(service.getAffiliate('x')).rejects.toThrow('Tapfiliate API error: Access denied')
    })

    it('falls back to error.message when body is absent', async () => {
      mock.onGet(`${BASE}/affiliates/x/`).replyWithError({ message: 'Network timeout' })

      await expect(service.getAffiliate('x')).rejects.toThrow('Tapfiliate API error: Network timeout')
    })

    it('stringifies error objects without message', async () => {
      mock.onGet(`${BASE}/affiliates/x/`).replyWithError({
        message: 'Fail',
        body: { errors: [{ code: 'INVALID' }] },
      })

      await expect(service.getAffiliate('x')).rejects.toThrow('Tapfiliate API error: {"code":"INVALID"}')
    })
  })
})
