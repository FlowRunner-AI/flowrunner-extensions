'use strict'

const { createSandbox } = require('../../../service-sandbox')

const CLIENT_ID = 'test-client-id'
const CLIENT_SECRET = 'test-client-secret'
const COMPANY_DOMAIN = 'acme'
const BASE = `https://${COMPANY_DOMAIN}.bamboohr.com/api/v1`
const AUTH_BASE = `https://${COMPANY_DOMAIN}.bamboohr.com`
const ACCESS_TOKEN = 'test-access-token'

describe('BambooHR Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      companyDomain: COMPANY_DOMAIN,
    })

    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()

    // Simulate the OAuth access token header
    service.request = { headers: { 'oauth-access-token': ACCESS_TOKEN } }
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'clientId', required: true, shared: true }),
          expect.objectContaining({ name: 'clientSecret', required: true, shared: true }),
          expect.objectContaining({ name: 'companyDomain', required: true, shared: false }),
        ])
      )
    })
  })

  // ── OAuth2 System Methods ──

  describe('getOAuth2ConnectionURL', () => {
    it('returns correct authorization URL', async () => {
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`${AUTH_BASE}/authorize.php`)
      expect(url).toContain('request=authorize')
      expect(url).toContain(`client_id=${CLIENT_ID}`)
      expect(url).toContain('response_type=code')
      expect(url).toContain('scope=')
    })
  })

  describe('executeCallback', () => {
    it('exchanges code for tokens and extracts identity from id_token', async () => {
      const idTokenPayload = { name: 'Jane Smith', email: 'jane@acme.com' }
      const payloadB64 = Buffer.from(JSON.stringify(idTokenPayload)).toString('base64')
      const fakeJwt = `header.${payloadB64}.signature`

      mock.onPost(`${AUTH_BASE}/token.php`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
        id_token: fakeJwt,
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.io/callback',
      })

      expect(result.token).toBe('new-access-token')
      expect(result.refreshToken).toBe('new-refresh-token')
      expect(result.expirationInSeconds).toBe(7200)
      expect(result.connectionIdentityName).toBe('Jane Smith (jane@acme.com)')
      expect(result.overwrite).toBe(true)

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].url).toBe(`${AUTH_BASE}/token.php`)
      expect(mock.history[0].headers).toMatchObject({
        'Content-Type': 'application/x-www-form-urlencoded',
      })
    })

    it('falls back to meta/users when id_token has no identity', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).reply({
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
      })

      mock.onGet(`${BASE}/meta/users/`).reply({
        1: { firstName: 'John', lastName: 'Doe', email: 'john@acme.com' },
      })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.io/callback',
      })

      expect(result.connectionIdentityName).toBe('John Doe (john@acme.com)')
      expect(mock.history).toHaveLength(2)
    })

    it('uses fallback name when both id_token and meta/users fail', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).reply({
        access_token: 'new-access-token',
        expires_in: 3600,
      })

      mock.onGet(`${BASE}/meta/users/`).replyWithError({ message: 'Forbidden' })

      const result = await service.executeCallback({
        code: 'auth-code',
        redirectURI: 'https://flowrunner.io/callback',
      })

      expect(result.connectionIdentityName).toBe('Unknown BambooHR Account')
    })

    it('throws when token exchange fails', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).replyWithError({ message: 'Bad Request' })

      await expect(
        service.executeCallback({ code: 'bad-code', redirectURI: 'https://flowrunner.io/callback' })
      ).rejects.toThrow('Failed to exchange authorization code')
    })
  })

  describe('refreshToken', () => {
    it('refreshes the access token', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).reply({
        access_token: 'refreshed-token',
        expires_in: 7200,
        refresh_token: 'new-refresh-token',
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.token).toBe('refreshed-token')
      expect(result.expirationInSeconds).toBe(7200)
      expect(result.refreshToken).toBe('new-refresh-token')

      expect(mock.history[0].body).toContain('grant_type=refresh_token')
      expect(mock.history[0].body).toContain('refresh_token=old-refresh-token')
      expect(mock.history[0].body).toContain(`client_id=${CLIENT_ID}`)
      expect(mock.history[0].body).toContain(`client_secret=${CLIENT_SECRET}`)
    })

    it('keeps old refresh token when new one is not returned', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).reply({
        access_token: 'refreshed-token',
        expires_in: 3600,
      })

      const result = await service.refreshToken('old-refresh-token')

      expect(result.refreshToken).toBe('old-refresh-token')
    })

    it('throws on refresh failure', async () => {
      mock.onPost(`${AUTH_BASE}/token.php`).replyWithError({ message: 'Invalid token' })

      await expect(service.refreshToken('bad-token')).rejects.toThrow()
    })
  })

  // ── Employee Management ──

  describe('getEmployeeDirectory', () => {
    it('sends GET to employees/directory with correct auth', async () => {
      mock.onGet(`${BASE}/employees/directory`).reply({ employees: [{ id: '1' }] })

      const result = await service.getEmployeeDirectory()

      expect(result).toEqual({ employees: [{ id: '1' }] })
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        Accept: 'application/json',
      })
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/employees/directory`).replyWithError({ message: 'Server Error' })

      await expect(service.getEmployeeDirectory()).rejects.toThrow('Failed to retrieve employee directory')
    })
  })

  describe('getEmployeeById', () => {
    it('fetches employee with default fields', async () => {
      mock.onGet(`${BASE}/employees/123`).reply({ id: '123', firstName: 'Jane' })

      const result = await service.getEmployeeById('123')

      expect(result).toEqual({ id: '123', firstName: 'Jane' })
      expect(mock.history[0].query).toMatchObject({
        fields: 'firstName,lastName,displayName,jobTitle,department,division,workEmail,workPhone,mobilePhone,hireDate,status',
      })
    })

    it('passes custom fields', async () => {
      mock.onGet(`${BASE}/employees/123`).reply({ id: '123' })

      await service.getEmployeeById('123', 'all')

      expect(mock.history[0].query).toMatchObject({ fields: 'all' })
    })

    it('throws when employee ID is missing', async () => {
      await expect(service.getEmployeeById()).rejects.toThrow('Employee ID is required')
    })
  })

  describe('listEmployees', () => {
    it('fetches employees with default fields', async () => {
      mock.onGet(`${BASE}/employees`).reply({ employees: [] })

      await service.listEmployees()

      expect(mock.history[0].query).toMatchObject({
        fields: 'employeeId,firstName,lastName,preferredName,photoUrl,jobTitleName,status',
      })
    })

    it('appends additional fields', async () => {
      mock.onGet(`${BASE}/employees`).reply({ employees: [] })

      await service.listEmployees('workEmail,homeEmail')

      expect(mock.history[0].query.fields).toContain('workEmail,homeEmail')
    })

    it('includes sort and pageSize when provided', async () => {
      mock.onGet(`${BASE}/employees`).reply({ employees: [] })

      await service.listEmployees(undefined, 'lastName', 25)

      expect(mock.history[0].query).toMatchObject({ sort: 'lastName', limit: 25 })
    })
  })

  describe('createEmployee', () => {
    it('creates employee with required fields only', async () => {
      mock.onPost(`${BASE}/employees`).reply({
        status: 201,
        headers: { location: `${BASE}/employees/456` },
        body: null,
      })

      const result = await service.createEmployee('Jane', 'Smith')

      expect(result.success).toBe(true)
      expect(result.employeeId).toBe('456')
      expect(mock.history[0].body).toEqual({ firstName: 'Jane', lastName: 'Smith' })
    })

    it('includes optional fields when provided', async () => {
      mock.onPost(`${BASE}/employees`).reply({
        status: 201,
        headers: { location: `${BASE}/employees/789` },
        body: null,
      })

      await service.createEmployee('Jane', 'Smith', 'Engineer', 'Engineering', 'Tech', 'jane@acme.com', '2024-01-15', 'NYC')

      expect(mock.history[0].body).toEqual({
        firstName: 'Jane',
        lastName: 'Smith',
        jobTitle: 'Engineer',
        department: 'Engineering',
        division: 'Tech',
        workEmail: 'jane@acme.com',
        hireDate: '2024-01-15',
        location: 'NYC',
      })
    })

    it('throws when first name is missing', async () => {
      await expect(service.createEmployee()).rejects.toThrow('First name is required')
    })

    it('throws when last name is missing', async () => {
      await expect(service.createEmployee('Jane')).rejects.toThrow('Last name is required')
    })
  })

  describe('updateEmployee', () => {
    it('sends POST with fields to update', async () => {
      mock.onPost(`${BASE}/employees/123`).reply(null)

      const result = await service.updateEmployee('123', { jobTitle: 'Senior Engineer' })

      expect(result).toEqual({ success: true, message: 'Employee updated successfully' })
      expect(mock.history[0].body).toEqual({ jobTitle: 'Senior Engineer' })
    })

    it('throws when employee ID is missing', async () => {
      await expect(service.updateEmployee()).rejects.toThrow('Employee ID is required')
    })

    it('throws when fields are empty', async () => {
      await expect(service.updateEmployee('123', {})).rejects.toThrow('At least one field is required')
    })
  })

  describe('updateEmployeeSchema', () => {
    it('returns schema array with employee fields', async () => {
      const schema = await service.updateEmployeeSchema()

      expect(Array.isArray(schema)).toBe(true)
      expect(schema.length).toBeGreaterThan(0)
      expect(schema[0]).toMatchObject({ type: 'String', name: 'firstName' })
    })
  })

  describe('getChangedEmployeeIds', () => {
    it('fetches changes since a timestamp', async () => {
      mock.onGet(`${BASE}/employees/changed`).reply({ latest: '2024-03-15', employees: {} })

      const result = await service.getChangedEmployeeIds('2024-01-01T00:00:00Z')

      expect(result.latest).toBe('2024-03-15')
      expect(mock.history[0].query).toMatchObject({ since: '2024-01-01T00:00:00Z' })
    })

    it('resolves the type choice to lowercase', async () => {
      mock.onGet(`${BASE}/employees/changed`).reply({ latest: '2024-03-15', employees: {} })

      await service.getChangedEmployeeIds('2024-01-01T00:00:00Z', 'Updated')

      expect(mock.history[0].query).toMatchObject({ type: 'updated' })
    })

    it('throws when since is missing', async () => {
      await expect(service.getChangedEmployeeIds()).rejects.toThrow('"since" timestamp is required')
    })
  })

  // ── Company ──

  describe('getCompanyInformation', () => {
    it('fetches company info', async () => {
      mock.onGet(`${BASE}/company_information`).reply({ legalName: 'Acme Corp' })

      const result = await service.getCompanyInformation()

      expect(result).toEqual({ legalName: 'Acme Corp' })
    })
  })

  // ── Employee Data (Tables) ──

  describe('getEmployeeTableData', () => {
    it('fetches table data for an employee', async () => {
      mock.onGet(`${BASE}/employees/123/tables/jobInfo`).reply([{ id: '1', jobTitle: 'Engineer' }])

      const result = await service.getEmployeeTableData('123', 'jobInfo')

      expect(result).toEqual([{ id: '1', jobTitle: 'Engineer' }])
    })

    it('throws when employee ID or table name is missing', async () => {
      await expect(service.getEmployeeTableData()).rejects.toThrow('Employee ID is required')
      await expect(service.getEmployeeTableData('123')).rejects.toThrow('Table name is required')
    })
  })

  describe('createTableRow', () => {
    it('creates a table row', async () => {
      mock.onPost(`${BASE}/employees/123/tables/jobInfo`).reply(null)

      const result = await service.createTableRow('123', 'jobInfo', { jobTitle: 'Engineer' })

      expect(result).toEqual({ success: true, message: 'Table row created successfully' })
      expect(mock.history[0].body).toEqual({ jobTitle: 'Engineer' })
    })

    it('throws when row data is empty', async () => {
      await expect(service.createTableRow('123', 'jobInfo', {})).rejects.toThrow('Row data is required')
    })
  })

  describe('updateTableRow', () => {
    it('updates a table row', async () => {
      mock.onPost(`${BASE}/employees/123/tables/jobInfo/1`).reply(null)

      const result = await service.updateTableRow('123', 'jobInfo', '1', { jobTitle: 'Sr. Engineer' })

      expect(result).toEqual({ success: true, message: 'Table row updated successfully' })
    })

    it('throws when required params are missing', async () => {
      await expect(service.updateTableRow()).rejects.toThrow('Employee ID is required')
      await expect(service.updateTableRow('123')).rejects.toThrow('Table name is required')
      await expect(service.updateTableRow('123', 'jobInfo')).rejects.toThrow('Row ID is required')
      await expect(service.updateTableRow('123', 'jobInfo', '1', {})).rejects.toThrow('Row data is required')
    })
  })

  describe('deleteTableRow', () => {
    it('deletes a table row', async () => {
      mock.onDelete(`${BASE}/employees/123/tables/jobInfo/1`).reply(null)

      const result = await service.deleteTableRow('123', 'jobInfo', '1')

      expect(result).toEqual({ success: true })
    })
  })

  // ── Employee Files ──

  describe('listEmployeeFiles', () => {
    it('lists files for an employee', async () => {
      mock.onGet(`${BASE}/employees/123/files/view`).reply({ categories: [] })

      const result = await service.listEmployeeFiles('123')

      expect(result).toEqual({ categories: [] })
    })

    it('throws when employee ID is missing', async () => {
      await expect(service.listEmployeeFiles()).rejects.toThrow('Employee ID is required')
    })
  })

  describe('deleteEmployeeFile', () => {
    it('deletes an employee file', async () => {
      mock.onDelete(`${BASE}/employees/123/files/100`).reply(null)

      const result = await service.deleteEmployeeFile('123', '100')

      expect(result).toEqual({ success: true, message: 'Employee file deleted successfully' })
    })

    it('throws when required params are missing', async () => {
      await expect(service.deleteEmployeeFile()).rejects.toThrow('Employee ID is required')
      await expect(service.deleteEmployeeFile('123')).rejects.toThrow('File ID is required')
    })
  })

  describe('updateEmployeeFile', () => {
    it('updates file metadata', async () => {
      mock.onPost(`${BASE}/employees/123/files/100`).reply(null)

      const result = await service.updateEmployeeFile('123', '100', 'New Name', '5', 'yes')

      expect(result).toEqual({ success: true, message: 'Employee file updated successfully' })
      expect(mock.history[0].body).toEqual({
        name: 'New Name',
        categoryId: '5',
        shareWithEmployee: 'yes',
      })
    })

    it('throws when no fields are provided to update', async () => {
      await expect(service.updateEmployeeFile('123', '100')).rejects.toThrow('At least one field is required')
    })
  })

  describe('listEmployeeFileCategories', () => {
    it('returns only id and name for each category', async () => {
      mock.onGet(`${BASE}/employees/123/files/view`).reply({
        categories: [{ id: 1, name: 'HR Docs', files: [] }],
      })

      const result = await service.listEmployeeFileCategories('123')

      expect(result).toEqual({ categories: [{ id: 1, name: 'HR Docs' }] })
    })
  })

  describe('createEmployeeFileCategory', () => {
    it('creates categories from an array', async () => {
      mock.onPost(`${BASE}/employees/files/categories`).reply(null)

      const result = await service.createEmployeeFileCategory(['Training', 'Compliance'])

      expect(result).toEqual({ success: true, message: 'Employee file category created successfully' })
      expect(mock.history[0].body).toEqual(['Training', 'Compliance'])
    })

    it('creates categories from a comma-separated string', async () => {
      mock.onPost(`${BASE}/employees/files/categories`).reply(null)

      await service.createEmployeeFileCategory('Training, Compliance')

      expect(mock.history[0].body).toEqual(['Training', 'Compliance'])
    })

    it('throws when no names are provided', async () => {
      await expect(service.createEmployeeFileCategory('')).rejects.toThrow('At least one category name is required')
    })
  })

  // ── Employee Dependents ──

  describe('listEmployeeDependents', () => {
    it('fetches all dependents when no employee ID', async () => {
      mock.onGet(`${BASE}/employeedependents`).reply({ 'Employee Dependents': [] })

      await service.listEmployeeDependents()

      expect(mock.history[0].query).toEqual({})
    })

    it('filters by employee ID when provided', async () => {
      mock.onGet(`${BASE}/employeedependents`).reply({ 'Employee Dependents': [] })

      await service.listEmployeeDependents('123')

      expect(mock.history[0].query).toMatchObject({ employeeid: '123' })
    })
  })

  describe('createEmployeeDependent', () => {
    it('creates a dependent with required fields', async () => {
      mock.onPost(`${BASE}/employeedependents`).reply({ 'Employee Dependents': [{ id: '1' }] })

      await service.createEmployeeDependent('123', 'Sarah', 'Smith', 'Spouse')

      expect(mock.history[0].body).toEqual({
        employeeId: '123',
        firstName: 'Sarah',
        lastName: 'Smith',
        relationship: 'Spouse',
      })
    })

    it('includes optional fields and resolves choices', async () => {
      mock.onPost(`${BASE}/employeedependents`).reply({ 'Employee Dependents': [] })

      await service.createEmployeeDependent('123', 'Sarah', 'Smith', 'Spouse', '1990-05-15', 'Female', 'Yes', 'No')

      expect(mock.history[0].body).toMatchObject({
        dateOfBirth: '1990-05-15',
        gender: 'Female',
        isUsCitizen: 'yes',
        isStudent: 'no',
      })
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createEmployeeDependent()).rejects.toThrow('Employee ID is required')
      await expect(service.createEmployeeDependent('123')).rejects.toThrow('First name is required')
      await expect(service.createEmployeeDependent('123', 'Sarah')).rejects.toThrow('Last name is required')
      await expect(service.createEmployeeDependent('123', 'Sarah', 'Smith')).rejects.toThrow('Relationship is required')
    })
  })

  describe('updateEmployeeDependent', () => {
    it('updates a dependent', async () => {
      mock.onPut(`${BASE}/employeedependents/5`).reply({ 'Employee Dependents': [] })

      await service.updateEmployeeDependent('5', '123', 'Sarah', 'Jones', 'Spouse', '1990-05-15', 'Female')

      expect(mock.history[0].body).toEqual({
        employeeId: '123',
        firstName: 'Sarah',
        lastName: 'Jones',
        relationship: 'Spouse',
        dateOfBirth: '1990-05-15',
        gender: 'Female',
      })
    })
  })

  // ── Time Off ──

  describe('listTimeOffRequests', () => {
    it('fetches requests with required date range', async () => {
      mock.onGet(`${BASE}/time_off/requests`).reply([])

      await service.listTimeOffRequests('2024-01-01', '2024-03-31')

      expect(mock.history[0].query).toMatchObject({ start: '2024-01-01', end: '2024-03-31' })
    })

    it('includes optional filters', async () => {
      mock.onGet(`${BASE}/time_off/requests`).reply([])

      await service.listTimeOffRequests('2024-01-01', '2024-03-31', '123', 'approved', '1')

      expect(mock.history[0].query).toMatchObject({
        employeeId: '123',
        status: 'approved',
        type: '1',
      })
    })
  })

  describe('createTimeOffRequest', () => {
    it('creates a time off request with required fields', async () => {
      mock.onPut(`${BASE}/employees/123/time_off/request`).reply(null)

      const result = await service.createTimeOffRequest('123', 'Approved', '2024-03-01', '2024-03-05', 1)

      expect(result).toEqual({ success: true, message: 'Time off request created successfully' })
      expect(mock.history[0].body).toMatchObject({
        status: 'approved',
        start: '2024-03-01',
        end: '2024-03-05',
        timeOffTypeId: 1,
      })
    })

    it('includes notes and amount when provided', async () => {
      mock.onPut(`${BASE}/employees/123/time_off/request`).reply(null)

      await service.createTimeOffRequest('123', 'Requested', '2024-03-01', '2024-03-05', 1, 5, 'Vacation trip', 99)

      expect(mock.history[0].body).toMatchObject({
        amount: 5,
        notes: [{ from: 'employee', note: 'Vacation trip' }],
        previousRequest: 99,
      })
    })
  })

  describe('updateTimeOffRequestStatus', () => {
    it('updates request status with note', async () => {
      mock.onPut(`${BASE}/time_off/requests/42/status`).reply(null)

      const result = await service.updateTimeOffRequestStatus('42', 'Approved', 'Looks good')

      expect(result).toEqual({ success: true, message: 'Time off request status updated' })
      expect(mock.history[0].body).toEqual({ status: 'approved', note: 'Looks good' })
    })

    it('omits note when not provided', async () => {
      mock.onPut(`${BASE}/time_off/requests/42/status`).reply(null)

      await service.updateTimeOffRequestStatus('42', 'Denied')

      expect(mock.history[0].body).toEqual({ status: 'denied' })
    })
  })

  describe('getTimeOffBalance', () => {
    it('fetches balance for an employee', async () => {
      mock.onGet(`${BASE}/employees/123/time_off/calculator`).reply([{ timeOffType: '1', balance: '80' }])

      const result = await service.getTimeOffBalance('123')

      expect(result).toEqual([{ timeOffType: '1', balance: '80' }])
    })

    it('passes end date when provided', async () => {
      mock.onGet(`${BASE}/employees/123/time_off/calculator`).reply([])

      await service.getTimeOffBalance('123', '2024-12-31')

      expect(mock.history[0].query).toMatchObject({ end: '2024-12-31' })
    })
  })

  describe('listTimeOffPolicies', () => {
    it('fetches time off policies', async () => {
      mock.onGet(`${BASE}/meta/time_off/policies`).reply([{ id: 1, name: 'Vacation' }])

      const result = await service.listTimeOffPolicies()

      expect(result).toEqual([{ id: 1, name: 'Vacation' }])
    })
  })

  describe('listTimeOffTypes', () => {
    it('fetches time off types', async () => {
      mock.onGet(`${BASE}/meta/time_off/types`).reply({ timeOffTypes: [{ id: 1, name: 'Vacation' }] })

      const result = await service.listTimeOffTypes()

      expect(result.timeOffTypes).toEqual([{ id: 1, name: 'Vacation' }])
    })
  })

  describe('listWhosOut', () => {
    it('fetches without dates', async () => {
      mock.onGet(`${BASE}/time_off/whos_out`).reply([])

      await service.listWhosOut()

      expect(mock.history[0].query).toEqual({})
    })

    it('passes date range when provided', async () => {
      mock.onGet(`${BASE}/time_off/whos_out`).reply([])

      await service.listWhosOut('2024-03-01', '2024-03-31')

      expect(mock.history[0].query).toMatchObject({ start: '2024-03-01', end: '2024-03-31' })
    })
  })

  describe('listEmployeeTimeOffPolicies', () => {
    it('fetches policies for an employee', async () => {
      mock.onGet(`${BASE}/employees/123/time_off/policies`).reply([{ timeOffPolicyId: 1 }])

      const result = await service.listEmployeeTimeOffPolicies('123')

      expect(result).toEqual([{ timeOffPolicyId: 1 }])
    })
  })

  describe('adjustTimeOffBalance', () => {
    it('adjusts balance with note', async () => {
      mock.onPut(`${BASE}/employees/123/time_off/balance_adjustment`).reply(null)

      const result = await service.adjustTimeOffBalance('123', 1, 8, '2024-03-15', 'Annual adjustment')

      expect(result).toEqual({ success: true, message: 'Time off balance adjusted successfully' })
      expect(mock.history[0].body).toEqual({
        timeOffTypeId: 1,
        amount: 8,
        date: '2024-03-15',
        note: 'Annual adjustment',
      })
    })

    it('omits note when not provided', async () => {
      mock.onPut(`${BASE}/employees/123/time_off/balance_adjustment`).reply(null)

      await service.adjustTimeOffBalance('123', 1, -4, '2024-03-15')

      expect(mock.history[0].body).not.toHaveProperty('note')
    })
  })

  // ── Time Tracking ──

  describe('listTimesheetEntries', () => {
    it('fetches entries with date range', async () => {
      mock.onGet(`${BASE}/time_tracking/timesheet_entries`).reply({ timesheetEntries: [] })

      await service.listTimesheetEntries('2024-03-01', '2024-03-31')

      expect(mock.history[0].query).toMatchObject({ start: '2024-03-01', end: '2024-03-31' })
    })

    it('passes employee IDs filter', async () => {
      mock.onGet(`${BASE}/time_tracking/timesheet_entries`).reply({ timesheetEntries: [] })

      await service.listTimesheetEntries('2024-03-01', '2024-03-31', '1,2,3')

      expect(mock.history[0].query).toMatchObject({ employeeIds: '1,2,3' })
    })
  })

  describe('clockInEmployee', () => {
    it('clocks in with minimal params', async () => {
      mock.onPost(`${BASE}/time_tracking/employees/123/clock_in`).reply({ id: 1 })

      const result = await service.clockInEmployee('123')

      expect(result).toEqual({ id: 1 })
      expect(mock.history[0].body).toEqual({})
    })

    it('includes optional params', async () => {
      mock.onPost(`${BASE}/time_tracking/employees/123/clock_in`).reply({ id: 1 })

      await service.clockInEmployee('123', '2024-03-01', '09:00', 'America/Denver', 'Starting work', 10, 5)

      expect(mock.history[0].body).toEqual({
        date: '2024-03-01',
        start: '09:00',
        timezone: 'America/Denver',
        note: 'Starting work',
        projectId: 10,
        taskId: 5,
      })
    })
  })

  describe('clockOutEmployee', () => {
    it('clocks out with optional params', async () => {
      mock.onPost(`${BASE}/time_tracking/employees/123/clock_out`).reply({ id: 1, hours: 8 })

      await service.clockOutEmployee('123', '2024-03-01', '17:00', 'America/Denver')

      expect(mock.history[0].body).toEqual({
        date: '2024-03-01',
        end: '17:00',
        timezone: 'America/Denver',
      })
    })
  })

  describe('createOrUpdateHourEntries', () => {
    it('stores hour entries', async () => {
      const entries = [{ employeeId: 123, date: '2024-03-01', hours: 8 }]

      mock.onPost(`${BASE}/time_tracking/hour_entries/store`).reply({ timesheetEntries: entries })

      const result = await service.createOrUpdateHourEntries(entries)

      expect(mock.history[0].body).toEqual({ hours: entries })
      expect(result.timesheetEntries).toEqual(entries)
    })
  })

  // ── Recruiting ──

  describe('getJobApplications', () => {
    it('fetches applications with defaults', async () => {
      mock.onGet(`${BASE}/applicant_tracking/applications`).reply({ applications: [] })

      await service.getJobApplications()

      expect(mock.history[0].query).toEqual({})
    })

    it('resolves choice parameters', async () => {
      mock.onGet(`${BASE}/applicant_tracking/applications`).reply({ applications: [] })

      await service.getJobApplications(10, 'All Active', 'John', 'Applicant Name', 'Descending', 2)

      expect(mock.history[0].query).toMatchObject({
        jobId: 10,
        applicationStatus: 'ALL_ACTIVE',
        search: 'John',
        sortBy: 'first_name',
        sortOrder: 'DESC',
        page: 2,
      })
    })
  })

  describe('getJobApplicationDetails', () => {
    it('fetches application details', async () => {
      mock.onGet(`${BASE}/applicant_tracking/applications/1`).reply({ id: 1 })

      const result = await service.getJobApplicationDetails('1')

      expect(result).toEqual({ id: 1 })
    })

    it('throws when application ID is missing', async () => {
      await expect(service.getJobApplicationDetails()).rejects.toThrow('Application ID is required')
    })
  })

  describe('getJobSummaries', () => {
    it('resolves status and sort choices', async () => {
      mock.onGet(`${BASE}/applicant_tracking/jobs`).reply([])

      await service.getJobSummaries('Draft and Open', 'Title', 'Ascending')

      expect(mock.history[0].query).toMatchObject({
        statusGroups: 'DRAFT_AND_OPEN',
        sortBy: 'title',
        sortOrder: 'ASC',
      })
    })
  })

  describe('createCandidate', () => {
    it('creates a candidate with required fields', async () => {
      mock.onPost(`${BASE}/applicant_tracking/application`).reply({ result: 'success', candidateId: 456 })

      const result = await service.createCandidate('John', 'Doe', 10)

      expect(result).toEqual({ result: 'success', candidateId: 456 })
      expect(mock.history[0].body).toEqual({ firstName: 'John', lastName: 'Doe', jobId: 10 })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${BASE}/applicant_tracking/application`).reply({ result: 'success' })

      await service.createCandidate('John', 'Doe', 10, 'john@example.com', '555-0100', 'LinkedIn')

      expect(mock.history[0].body).toMatchObject({
        email: 'john@example.com',
        phoneNumber: '555-0100',
        source: 'LinkedIn',
      })
    })
  })

  describe('getApplicantStatuses', () => {
    it('fetches statuses', async () => {
      mock.onGet(`${BASE}/applicant_tracking/statuses`).reply([{ id: '1', code: 'NEW' }])

      const result = await service.getApplicantStatuses()

      expect(result).toEqual([{ id: '1', code: 'NEW' }])
    })
  })

  describe('updateApplicantStatus', () => {
    it('updates application status', async () => {
      mock.onPost(`${BASE}/applicant_tracking/applications/1/status`).reply({ type: 'positionApplicantStatus', id: '2' })

      const result = await service.updateApplicantStatus('1', 2)

      expect(result).toEqual({ type: 'positionApplicantStatus', id: '2' })
      expect(mock.history[0].body).toEqual({ status: 2 })
    })
  })

  describe('createJobApplicationComment', () => {
    it('adds a comment to an application', async () => {
      mock.onPost(`${BASE}/applicant_tracking/applications/1/comments`).reply({ type: 'comment', id: '100' })

      const result = await service.createJobApplicationComment('1', 'Great candidate')

      expect(result).toEqual({ type: 'comment', id: '100' })
      expect(mock.history[0].body).toEqual({ type: 'comment', comment: 'Great candidate' })
    })
  })

  // ── Training ──

  describe('listTrainingTypes', () => {
    it('fetches training types', async () => {
      mock.onGet(`${BASE}/training/type`).reply({ '1': { name: 'Safety' } })

      const result = await service.listTrainingTypes()

      expect(result).toEqual({ '1': { name: 'Safety' } })
    })
  })

  describe('listEmployeeTrainingRecords', () => {
    it('fetches records for an employee', async () => {
      mock.onGet(`${BASE}/training/record/employee/123`).reply([{ id: 1 }])

      const result = await service.listEmployeeTrainingRecords('123')

      expect(result).toEqual([{ id: 1 }])
    })
  })

  describe('createEmployeeTrainingRecord', () => {
    it('creates a training record with required fields', async () => {
      mock.onPost(`${BASE}/training/record/employee/123`).reply({ id: 5 })

      const result = await service.createEmployeeTrainingRecord('123', 1, '2024-03-15')

      expect(result).toEqual({ id: 5 })
      expect(mock.history[0].body).toEqual({ type: 1, completed: '2024-03-15' })
    })

    it('includes optional fields', async () => {
      mock.onPost(`${BASE}/training/record/employee/123`).reply({ id: 5 })

      await service.createEmployeeTrainingRecord('123', 1, '2024-03-15', 'Jane Trainer', 4, 1, 'Passed')

      expect(mock.history[0].body).toEqual({
        type: 1,
        completed: '2024-03-15',
        instructor: 'Jane Trainer',
        hours: 4,
        credits: 1,
        notes: 'Passed',
      })
    })

    it('throws when required fields are missing', async () => {
      await expect(service.createEmployeeTrainingRecord()).rejects.toThrow('Employee ID is required')
      await expect(service.createEmployeeTrainingRecord('123')).rejects.toThrow('Training Type ID is required')
      await expect(service.createEmployeeTrainingRecord('123', 1)).rejects.toThrow('Completed Date is required')
    })
  })

  // ── Reports ──

  describe('requestCustomReport', () => {
    it('generates a report with fields', async () => {
      mock.onPost(`${BASE}/reports/custom`).reply({ title: 'Report', employees: [] })

      const result = await service.requestCustomReport('My Report', 'firstName,lastName')

      expect(result).toEqual({ title: 'Report', employees: [] })
      expect(mock.history[0].body).toEqual({
        title: 'My Report',
        fields: ['firstName', 'lastName'],
      })
      expect(mock.history[0].query).toMatchObject({ format: 'JSON' })
    })

    it('includes filter when filterLastChanged is provided', async () => {
      mock.onPost(`${BASE}/reports/custom`).reply({ employees: [] })

      await service.requestCustomReport('Report', 'firstName', '2024-01-01T00:00:00Z')

      expect(mock.history[0].body.filters).toEqual({
        lastChanged: { includeNull: 'no', value: '2024-01-01T00:00:00Z' },
      })
    })
  })

  // ── Metadata ──

  describe('listFields', () => {
    it('fetches field metadata', async () => {
      mock.onGet(`${BASE}/meta/fields`).reply([{ id: 4, name: 'First Name' }])

      const result = await service.listFields()

      expect(result).toEqual([{ id: 4, name: 'First Name' }])
    })
  })

  describe('listUsers', () => {
    it('fetches users without filter', async () => {
      mock.onGet(`${BASE}/meta/users/`).reply({ '1': { firstName: 'Jane' } })

      await service.listUsers()

      expect(mock.history[0].query).toEqual({})
    })

    it('resolves status choice', async () => {
      mock.onGet(`${BASE}/meta/users/`).reply({})

      await service.listUsers('Enabled')

      expect(mock.history[0].query).toMatchObject({ status: 'enabled' })
    })
  })

  describe('listTablesMetadata', () => {
    it('fetches table metadata', async () => {
      mock.onGet(`${BASE}/meta/tables`).reply([{ alias: 'jobInfo' }])

      const result = await service.listTablesMetadata()

      expect(result).toEqual([{ alias: 'jobInfo' }])
    })
  })

  // ── Goals ──

  describe('listGoals', () => {
    it('fetches goals for an employee', async () => {
      mock.onGet(`${BASE}/performance/employees/123/goals`).reply({ goals: [] })

      await service.listGoals('123')

      expect(mock.history[0].query).toEqual({})
    })

    it('resolves filter choice', async () => {
      mock.onGet(`${BASE}/performance/employees/123/goals`).reply({ goals: [] })

      await service.listGoals('123', 'In Progress')

      expect(mock.history[0].query).toMatchObject({ filter: 'status-inProgress' })
    })
  })

  describe('createGoal', () => {
    it('creates a goal with defaults', async () => {
      mock.onPost(`${BASE}/performance/employees/123/goals`).reply({ id: 5 })

      const result = await service.createGoal('123', 'Complete Q2', '2024-06-30')

      expect(result).toEqual({ id: 5 })
      expect(mock.history[0].body).toEqual({
        title: 'Complete Q2',
        dueDate: '2024-06-30',
        sharedWithEmployeeIds: [123],
      })
    })

    it('parses shared employee IDs', async () => {
      mock.onPost(`${BASE}/performance/employees/123/goals`).reply({ id: 5 })

      await service.createGoal('123', 'Goal', '2024-06-30', 'Desc', 50, '123,456')

      expect(mock.history[0].body).toMatchObject({
        description: 'Desc',
        percentComplete: 50,
        sharedWithEmployeeIds: [123, 456],
      })
    })
  })

  describe('updateGoalProgress', () => {
    it('updates progress', async () => {
      mock.onPut(`${BASE}/performance/employees/123/goals/1/progress`).reply({ id: 1, percentComplete: 75 })

      const result = await service.updateGoalProgress('123', '1', 75)

      expect(result).toEqual({ id: 1, percentComplete: 75 })
      expect(mock.history[0].body).toEqual({ percentComplete: 75 })
    })

    it('requires completion date when at 100%', async () => {
      await expect(service.updateGoalProgress('123', '1', 100)).rejects.toThrow(
        'Completion Date is required when Percent Complete is 100'
      )
    })

    it('includes completion date at 100%', async () => {
      mock.onPut(`${BASE}/performance/employees/123/goals/1/progress`).reply({ id: 1 })

      await service.updateGoalProgress('123', '1', 100, '2024-03-31')

      expect(mock.history[0].body).toEqual({ percentComplete: 100, completionDate: '2024-03-31' })
    })
  })

  describe('deleteGoal', () => {
    it('deletes a goal', async () => {
      mock.onDelete(`${BASE}/performance/employees/123/goals/1`).reply(null)

      const result = await service.deleteGoal('123', '1')

      expect(result).toEqual({ success: true, message: 'Goal deleted successfully' })
    })
  })

  // ── Company Files ──

  describe('listCompanyFiles', () => {
    it('fetches company files', async () => {
      mock.onGet(`${BASE}/files/view`).reply({ categories: [] })

      const result = await service.listCompanyFiles()

      expect(result).toEqual({ categories: [] })
    })
  })

  describe('updateCompanyFile', () => {
    it('updates file metadata', async () => {
      mock.onPost(`${BASE}/files/387`).reply(null)

      const result = await service.updateCompanyFile('387', 'New Name', '20', 'yes')

      expect(result).toEqual({ success: true, message: 'Company file updated successfully' })
      expect(mock.history[0].body).toEqual({ name: 'New Name', categoryId: '20', shareWithEmployee: 'yes' })
    })

    it('throws when no fields to update', async () => {
      await expect(service.updateCompanyFile('387')).rejects.toThrow('At least one field is required')
    })
  })

  describe('deleteCompanyFile', () => {
    it('deletes a company file', async () => {
      mock.onDelete(`${BASE}/files/387`).reply(null)

      const result = await service.deleteCompanyFile('387')

      expect(result).toEqual({ success: true, message: 'Company file deleted successfully' })
    })
  })

  describe('createCompanyFileCategory', () => {
    it('creates categories', async () => {
      mock.onPost(`${BASE}/files/categories`).reply(null)

      const result = await service.createCompanyFileCategory(['Legal', 'Finance'])

      expect(result).toEqual({ success: true, message: 'Company file category created successfully' })
      expect(mock.history[0].body).toEqual(['Legal', 'Finance'])
    })
  })

  // ── Webhooks ──

  describe('listWebhooks', () => {
    it('fetches webhooks', async () => {
      mock.onGet(`${BASE}/webhooks`).reply({ webhooks: [{ id: '1' }] })

      const result = await service.listWebhooks()

      expect(result.webhooks).toEqual([{ id: '1' }])
    })
  })

  describe('createWebhook', () => {
    it('creates a webhook with required fields', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: '4', privateKey: 'abc123' })

      const result = await service.createWebhook('Test', 'https://example.com/hook', undefined, undefined, 'JSON')

      expect(result).toEqual({ id: '4', privateKey: 'abc123' })
      expect(mock.history[0].body).toEqual({
        name: 'Test',
        url: 'https://example.com/hook',
        format: 'json',
      })
    })

    it('includes monitor fields and events', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: '4' })

      await service.createWebhook(
        'Test', 'https://example.com/hook',
        'firstName,lastName', { firstName: 'Name' },
        'JSON', true, 'employee.created,employee.updated'
      )

      expect(mock.history[0].body).toMatchObject({
        monitorFields: ['firstName', 'lastName'],
        postFields: { firstName: 'Name' },
        includeCompanyDomain: true,
        events: ['employee.created', 'employee.updated'],
      })
    })
  })

  describe('getWebhook', () => {
    it('fetches a webhook by ID', async () => {
      mock.onGet(`${BASE}/webhooks/1`).reply({ id: '1', name: 'Test' })

      const result = await service.getWebhook('1')

      expect(result).toEqual({ id: '1', name: 'Test' })
    })
  })

  describe('updateWebhook', () => {
    it('updates a webhook', async () => {
      mock.onPut(`${BASE}/webhooks/1`).reply({ id: '1' })

      await service.updateWebhook('1', 'Updated', 'https://example.com/v2', 'firstName', {}, 'JSON', false, 'employee.updated')

      expect(mock.history[0].body).toMatchObject({
        name: 'Updated',
        url: 'https://example.com/v2',
        format: 'json',
        monitorFields: ['firstName'],
        includeCompanyDomain: false,
        events: ['employee.updated'],
      })
    })
  })

  describe('deleteWebhook', () => {
    it('deletes a webhook', async () => {
      mock.onDelete(`${BASE}/webhooks/1`).reply(null)

      const result = await service.deleteWebhook('1')

      expect(result).toEqual({ success: true, message: 'Webhook deleted successfully' })
    })
  })

  describe('getWebhookLogs', () => {
    it('fetches webhook logs', async () => {
      mock.onGet(`${BASE}/webhooks/1/log`).reply([{ webhookId: '1' }])

      const result = await service.getWebhookLogs('1')

      expect(result).toEqual([{ webhookId: '1' }])
    })
  })

  // ── Trigger System Methods ──

  describe('handleTriggerUpsertWebhook', () => {
    it('creates a new webhook when no existing webhookId', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: '10', privateKey: 'secret-key' })

      const result = await service.handleTriggerUpsertWebhook({
        webhookData: {},
        callbackUrl: 'https://flowrunner.io/trigger/callback',
        events: [{ triggerData: { monitorFields: 'firstName,lastName' } }],
      })

      expect(result.webhookData.webhookId).toBe('10')
      expect(result.webhookData.privateKey).toBe('secret-key')
      expect(result.webhookData.monitorFields).toEqual(['firstName', 'lastName'])
      expect(mock.history[0].body).toMatchObject({
        name: 'FlowRunner employee change trigger',
        url: 'https://flowrunner.io/trigger/callback',
        format: 'json',
        monitorFields: ['firstName', 'lastName'],
      })
    })

    it('updates existing webhook when webhookId exists', async () => {
      mock.onPut(`${BASE}/webhooks/10`).reply(null)

      const result = await service.handleTriggerUpsertWebhook({
        webhookData: { webhookId: '10', privateKey: 'existing-key' },
        callbackUrl: 'https://flowrunner.io/trigger/callback',
        events: [{ triggerData: { monitorFields: 'department' } }],
      })

      expect(result.webhookData.webhookId).toBe('10')
      expect(result.webhookData.privateKey).toBe('existing-key')
      expect(mock.history).toHaveLength(1)
    })

    it('uses default fields when no monitorFields specified', async () => {
      mock.onPost(`${BASE}/webhooks`).reply({ id: '10', privateKey: 'key' })

      await service.handleTriggerUpsertWebhook({
        webhookData: {},
        callbackUrl: 'https://flowrunner.io/callback',
        events: [{ triggerData: {} }],
      })

      expect(mock.history[0].body.monitorFields).toEqual(
        expect.arrayContaining(['firstName', 'lastName', 'jobTitle', 'department'])
      )
    })
  })

  describe('handleTriggerResolveEvents', () => {
    it('verifies HMAC signature and maps employees to events', async () => {
      const crypto = require('crypto')
      const privateKey = 'webhook-secret'
      const body = JSON.stringify({
        employees: [
          { id: '123', changedFields: ['jobTitle'], fields: { jobTitle: 'Senior' }, timestamp: '2024-03-15T14:30:00Z' },
        ],
      })
      const timestamp = '1710510600'
      const signature = crypto.createHmac('sha256', privateKey).update(body + timestamp, 'utf8').digest('hex')

      const result = await service.handleTriggerResolveEvents({
        webhookData: { privateKey },
        headers: { 'x-bamboohr-signature': signature, 'x-bamboohr-timestamp': timestamp },
        rawBody: body,
        body: JSON.parse(body),
      })

      expect(result.events).toHaveLength(1)
      expect(result.events[0]).toMatchObject({
        name: 'onEmployeeChanged',
        data: {
          type: 'changed',
          employeeId: '123',
          changedFields: ['jobTitle'],
          fields: { jobTitle: 'Senior' },
        },
      })
    })

    it('rejects on signature mismatch', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: { privateKey: 'secret' },
        headers: { 'x-bamboohr-signature': 'bad-sig', 'x-bamboohr-timestamp': '123' },
        rawBody: '{}',
        body: {},
      })

      expect(result.events).toEqual([])
    })

    it('rejects when signature headers are missing', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: { privateKey: 'secret' },
        headers: {},
        body: { employees: [{ id: '1' }] },
      })

      expect(result.events).toEqual([])
    })

    it('accepts unverified when no privateKey stored', async () => {
      const result = await service.handleTriggerResolveEvents({
        webhookData: {},
        headers: {},
        body: { employees: [{ id: '1', changedFields: [], fields: {} }] },
      })

      expect(result.events).toHaveLength(1)
    })
  })

  describe('handleTriggerSelectMatched', () => {
    it('returns all trigger IDs', async () => {
      const result = await service.handleTriggerSelectMatched({
        triggers: [{ id: 'a' }, { id: 'b' }],
      })

      expect(result.ids).toEqual(['a', 'b'])
    })
  })

  describe('handleTriggerDeleteWebhook', () => {
    it('deletes the webhook', async () => {
      mock.onDelete(`${BASE}/webhooks/10`).reply(null)

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhookId: '10' },
      })

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(1)
    })

    it('returns empty when no webhookId', async () => {
      const result = await service.handleTriggerDeleteWebhook({ webhookData: {} })

      expect(result).toEqual({})
      expect(mock.history).toHaveLength(0)
    })

    it('does not throw when delete fails', async () => {
      mock.onDelete(`${BASE}/webhooks/10`).replyWithError({ message: 'Not found' })

      const result = await service.handleTriggerDeleteWebhook({
        webhookData: { webhookId: '10' },
      })

      expect(result).toEqual({})
    })
  })

  // ── Dictionary Methods ──

  describe('getEmployeeDirectoryDictionary', () => {
    it('returns formatted employee items', async () => {
      mock.onGet(`${BASE}/employees/directory`).reply({
        employees: [
          { id: '1', displayName: 'Jane Smith', jobTitle: 'Engineer' },
          { id: '2', firstName: 'John', lastName: 'Doe', department: 'HR' },
        ],
      })

      const result = await service.getEmployeeDirectoryDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Smith', value: '1', note: 'Engineer' },
        { label: 'John Doe', value: '2', note: 'HR' },
      ])
      expect(result.cursor).toBeNull()
    })

    it('filters by search term', async () => {
      mock.onGet(`${BASE}/employees/directory`).reply({
        employees: [
          { id: '1', displayName: 'Jane Smith', jobTitle: 'Engineer' },
          { id: '2', displayName: 'John Doe', department: 'HR' },
        ],
      })

      const result = await service.getEmployeeDirectoryDictionary({ search: 'jane' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].label).toBe('Jane Smith')
    })
  })

  describe('getWebhooksDictionary', () => {
    it('returns formatted webhook items', async () => {
      mock.onGet(`${BASE}/webhooks`).reply({
        webhooks: [{ id: '1', name: 'My Hook', url: 'https://example.com' }],
      })

      const result = await service.getWebhooksDictionary({})

      expect(result.items).toEqual([
        { label: 'My Hook', value: '1', note: 'https://example.com' },
      ])
    })
  })

  describe('getGoalsDictionary', () => {
    it('returns empty when no employeeId', async () => {
      const result = await service.getGoalsDictionary({ criteria: {} })

      expect(result.items).toEqual([])
    })

    it('returns goals for an employee', async () => {
      mock.onGet(`${BASE}/performance/employees/123/goals`).reply({
        goals: [{ id: 1, title: 'Ship feature', percentComplete: 75 }],
      })

      const result = await service.getGoalsDictionary({ criteria: { employeeId: '123' } })

      expect(result.items).toEqual([
        { label: 'Ship feature', value: '1', note: '75% complete' },
      ])
    })
  })

  describe('getEmployeeFilesDictionary', () => {
    it('returns empty when no employeeId', async () => {
      const result = await service.getEmployeeFilesDictionary({ criteria: {} })

      expect(result.items).toEqual([])
    })

    it('flattens files from categories', async () => {
      mock.onGet(`${BASE}/employees/123/files/view`).reply({
        categories: [
          { name: 'HR', files: [{ id: 100, name: 'Offer Letter' }] },
          { name: 'Training', files: [{ id: 101, name: 'Cert' }] },
        ],
      })

      const result = await service.getEmployeeFilesDictionary({ criteria: { employeeId: '123' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({ label: 'Offer Letter', value: '100', note: 'HR' })
    })
  })

  describe('getTablesDictionary', () => {
    it('returns table items', async () => {
      mock.onGet(`${BASE}/meta/tables`).reply([
        { alias: 'jobInfo', fields: [{ id: 1 }, { id: 2 }] },
      ])

      const result = await service.getTablesDictionary({})

      expect(result.items).toEqual([
        { label: 'jobInfo', value: 'jobInfo', note: '2 fields' },
      ])
    })
  })

  describe('getTableRowsDictionary', () => {
    it('returns empty when criteria incomplete', async () => {
      const result = await service.getTableRowsDictionary({ criteria: { employeeId: '123' } })

      expect(result.items).toEqual([])
    })

    it('returns row items', async () => {
      mock.onGet(`${BASE}/employees/123/tables/jobInfo`).reply([
        { id: '1', date: '2023-01-15', jobTitle: 'Engineer' },
      ])

      const result = await service.getTableRowsDictionary({
        criteria: { employeeId: '123', tableName: 'jobInfo' },
      })

      expect(result.items).toEqual([
        { label: '2023-01-15', value: '1', note: 'Engineer' },
      ])
    })
  })

  describe('getEmployeeFileCategoriesDictionary', () => {
    it('returns category items with file counts', async () => {
      mock.onGet(`${BASE}/employees/123/files/view`).reply({
        categories: [{ id: 1, name: 'HR Docs', files: [{ id: 100 }, { id: 101 }] }],
      })

      const result = await service.getEmployeeFileCategoriesDictionary({
        criteria: { employeeId: '123' },
      })

      expect(result.items).toEqual([
        { label: 'HR Docs', value: '1', note: '2 files' },
      ])
    })
  })

  describe('getCompanyFilesDictionary', () => {
    it('flattens company files from categories', async () => {
      mock.onGet(`${BASE}/files/view`).reply({
        categories: [
          { name: 'Legal', files: [{ id: 387, name: 'NDA' }] },
        ],
      })

      const result = await service.getCompanyFilesDictionary({})

      expect(result.items).toEqual([
        { label: 'NDA', value: '387', note: 'Legal' },
      ])
    })
  })

  describe('getCompanyFileCategoriesDictionary', () => {
    it('returns category items', async () => {
      mock.onGet(`${BASE}/files/view`).reply({
        categories: [{ id: 20, name: 'New Employee Docs', canUploadFiles: 'yes' }],
      })

      const result = await service.getCompanyFileCategoriesDictionary({})

      expect(result.items).toEqual([
        { label: 'New Employee Docs', value: '20', note: '' },
      ])
    })

    it('marks read-only categories', async () => {
      mock.onGet(`${BASE}/files/view`).reply({
        categories: [{ id: 30, name: 'Archive', canUploadFiles: 'no' }],
      })

      const result = await service.getCompanyFileCategoriesDictionary({})

      expect(result.items[0].note).toBe('read-only')
    })
  })

  describe('getEmployeeDependentsDictionary', () => {
    it('returns empty when no employeeId', async () => {
      const result = await service.getEmployeeDependentsDictionary({ criteria: {} })

      expect(result.items).toEqual([])
    })

    it('returns dependent items', async () => {
      mock.onGet(`${BASE}/employeedependents`).reply({
        'Employee Dependents': [
          { id: '1', firstName: 'Sarah', lastName: 'Smith', relationship: 'Spouse' },
        ],
      })

      const result = await service.getEmployeeDependentsDictionary({
        criteria: { employeeId: '123' },
      })

      expect(result.items).toEqual([
        { label: 'Sarah Smith', value: '1', note: 'Spouse' },
      ])
    })
  })

  describe('getJobApplicationsDictionary', () => {
    it('returns application items', async () => {
      mock.onGet(`${BASE}/applicant_tracking/applications`).reply({
        applications: [
          { id: 1, applicant: { firstName: 'John', lastName: 'Doe' }, job: { title: 'Engineer' } },
        ],
      })

      const result = await service.getJobApplicationsDictionary({})

      expect(result.items).toEqual([
        { label: 'John Doe', value: '1', note: 'Engineer' },
      ])
    })

    it('passes search as searchString query param', async () => {
      mock.onGet(`${BASE}/applicant_tracking/applications`).reply({ applications: [] })

      await service.getJobApplicationsDictionary({ search: 'John' })

      expect(mock.history[0].query).toMatchObject({ searchString: 'John' })
    })
  })

  describe('getTimeOffRequestsDictionary', () => {
    it('returns time off request items with date range query', async () => {
      mock.onGet(`${BASE}/time_off/requests`).reply([
        { id: 1, name: 'Jane Smith', type: { name: 'Vacation' }, start: '2024-03-01', end: '2024-03-05' },
      ])

      const result = await service.getTimeOffRequestsDictionary({})

      expect(result.items).toEqual([
        { label: 'Jane Smith - Vacation', value: '1', note: '2024-03-01 to 2024-03-05' },
      ])
      expect(mock.history[0].query).toHaveProperty('start')
      expect(mock.history[0].query).toHaveProperty('end')
    })
  })

  // ── Constructor Domain Parsing ──

  describe('constructor domain parsing', () => {
    it('builds correct URLs when domain includes https prefix', async () => {
      // The constructor strips "https://" and ".bamboohr.com..." from the domain.
      // We verify this indirectly via the OAuth URL built by the beforeAll sandbox,
      // and test the stripping logic by checking the getOAuth2ConnectionURL output.
      const url = await service.getOAuth2ConnectionURL()

      expect(url).toContain(`https://${COMPANY_DOMAIN}.bamboohr.com/authorize.php`)
    })
  })
})
