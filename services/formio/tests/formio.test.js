'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-formio-api-key'
const PROJECT_URL = 'https://myproject.form.io'
const BASE = PROJECT_URL

describe('Form.io Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ projectUrl: PROJECT_URL, apiKey: API_KEY })
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
      expect(sandbox.getConfigItems()).toEqual([
        expect.objectContaining({
          name: 'projectUrl',
          required: true,
          shared: false,
          type: 'STRING',
        }),
        expect.objectContaining({
          name: 'apiKey',
          required: true,
          shared: false,
          type: 'STRING',
        }),
      ])
    })
  })

  // ── Forms ──

  describe('listForms', () => {
    it('sends correct request with defaults', async () => {
      const responseData = [{ _id: 'f1', title: 'Contact Us' }]
      mock.onGet(`${BASE}/form`).reply(responseData)

      const result = await service.listForms()

      expect(result).toEqual(responseData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-token': API_KEY })
      expect(mock.history[0].query).toMatchObject({ type: 'form', limit: 25, skip: 0 })
    })

    it('passes custom pagination and sort params', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.listForms(undefined, 10, 20, '-created')

      expect(mock.history[0].query).toMatchObject({ limit: 10, skip: 20, sort: '-created' })
    })

    it('filters by Resource type', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.listForms('Resource')

      expect(mock.history[0].query).toMatchObject({ type: 'resource' })
    })

    it('omits type filter when All is selected', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.listForms('All')

      expect(mock.history[0].query.type).toBeUndefined()
    })

    it('throws on API error', async () => {
      mock.onGet(`${BASE}/form`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
      })

      await expect(service.listForms()).rejects.toThrow('Form.io API error')
    })
  })

  describe('getForm', () => {
    it('sends GET to the correct path', async () => {
      const formData = { _id: 'f1', title: 'Contact Us', components: [] }
      mock.onGet(`${BASE}/form/f1`).reply(formData)

      const result = await service.getForm('f1')

      expect(result).toEqual(formData)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-token': API_KEY })
    })

    it('encodes form path in URL', async () => {
      mock.onGet(`${BASE}/form/my%20form`).reply({ _id: 'f2' })

      await service.getForm('my form')

      expect(mock.history[0].url).toBe(`${BASE}/form/my%20form`)
    })

    it('throws when formIdOrPath is missing', async () => {
      await expect(service.getForm()).rejects.toThrow('a form id or path is required')
    })
  })

  describe('createForm', () => {
    it('sends POST with correct body', async () => {
      const components = [{ type: 'textfield', key: 'name', label: 'Name' }]
      const created = { _id: 'f1', title: 'Test', name: 'test', path: 'test', type: 'form', display: 'form', components }
      mock.onPost(`${BASE}/form`).reply(created)

      const result = await service.createForm('Test', 'test', 'test', components)

      expect(result).toEqual(created)
      expect(mock.history[0].body).toEqual({
        title: 'Test',
        name: 'test',
        path: 'test',
        type: 'form',
        display: 'form',
        components,
      })
    })

    it('maps Resource type and Wizard display', async () => {
      mock.onPost(`${BASE}/form`).reply({ _id: 'f2' })

      await service.createForm('Res', 'res', 'res', [], 'Resource', 'Wizard')

      expect(mock.history[0].body).toMatchObject({
        type: 'resource',
        display: 'wizard',
      })
    })

    it('maps PDF display', async () => {
      mock.onPost(`${BASE}/form`).reply({ _id: 'f3' })

      await service.createForm('PDF Form', 'pdf', 'pdf', [], 'Form', 'PDF')

      expect(mock.history[0].body).toMatchObject({ display: 'pdf' })
    })

    it('defaults type and display to form', async () => {
      mock.onPost(`${BASE}/form`).reply({ _id: 'f4' })

      await service.createForm('T', 'n', 'p', [])

      expect(mock.history[0].body).toMatchObject({ type: 'form', display: 'form' })
    })
  })

  describe('updateForm', () => {
    it('sends PUT with only provided fields', async () => {
      mock.onPut(`${BASE}/form/f1`).reply({ _id: 'f1', title: 'Updated' })

      const result = await service.updateForm('f1', 'Updated')

      expect(result).toEqual({ _id: 'f1', title: 'Updated' })
      expect(mock.history[0].body).toEqual({ title: 'Updated' })
    })

    it('includes components when provided', async () => {
      const components = [{ type: 'email', key: 'email', label: 'Email' }]
      mock.onPut(`${BASE}/form/f1`).reply({ _id: 'f1' })

      await service.updateForm('f1', undefined, undefined, undefined, components, 'Wizard')

      expect(mock.history[0].body).toEqual({ components, display: 'wizard' })
    })

    it('omits components when empty array is passed', async () => {
      mock.onPut(`${BASE}/form/f1`).reply({ _id: 'f1' })

      await service.updateForm('f1', 'Title', undefined, undefined, [])

      expect(mock.history[0].body).toEqual({ title: 'Title' })
    })

    it('throws when formIdOrPath is missing', async () => {
      await expect(service.updateForm()).rejects.toThrow('a form id or path is required')
    })
  })

  describe('deleteForm', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/form/f1`).reply({})

      const result = await service.deleteForm('f1')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
    })

    it('throws when formIdOrPath is missing', async () => {
      await expect(service.deleteForm()).rejects.toThrow('a form id or path is required')
    })
  })

  // ── Submissions ──

  describe('listSubmissions', () => {
    it('sends correct request with defaults', async () => {
      const subs = [{ _id: 's1', data: { name: 'Jane' } }]
      mock.onGet(`${BASE}/form/f1/submission`).reply(subs)

      const result = await service.listSubmissions('f1')

      expect(result).toEqual(subs)
      expect(mock.history[0].query).toMatchObject({ limit: 25, skip: 0 })
    })

    it('passes pagination and sort', async () => {
      mock.onGet(`${BASE}/form/f1/submission`).reply([])

      await service.listSubmissions('f1', 10, 5, '-created')

      expect(mock.history[0].query).toMatchObject({ limit: 10, skip: 5, sort: '-created' })
    })

    it('merges filter query string into query params', async () => {
      mock.onGet(`${BASE}/form/f1/submission`).reply([])

      await service.listSubmissions('f1', undefined, undefined, undefined, 'data.email=jane@example.com&created__gt=2020-01-01')

      expect(mock.history[0].query).toMatchObject({
        'data.email': 'jane@example.com',
        'created__gt': '2020-01-01',
      })
    })

    it('throws when formIdOrPath is missing', async () => {
      await expect(service.listSubmissions()).rejects.toThrow('a form id or path is required')
    })
  })

  describe('getSubmission', () => {
    it('sends GET to the correct path', async () => {
      const sub = { _id: 's1', data: { name: 'Jane' } }
      mock.onGet(`${BASE}/form/f1/submission/s1`).reply(sub)

      const result = await service.getSubmission('f1', 's1')

      expect(result).toEqual(sub)
      expect(mock.history).toHaveLength(1)
    })
  })

  describe('createSubmission', () => {
    it('sends POST with data wrapped in data key', async () => {
      const data = { firstName: 'Jane', email: 'jane@example.com' }
      const created = { _id: 's1', data }
      mock.onPost(`${BASE}/form/f1/submission`).reply(created)

      const result = await service.createSubmission('f1', data)

      expect(result).toEqual(created)
      expect(mock.history[0].body).toEqual({ data })
    })

    it('sends empty data object when data is not provided', async () => {
      mock.onPost(`${BASE}/form/f1/submission`).reply({ _id: 's2', data: {} })

      await service.createSubmission('f1')

      expect(mock.history[0].body).toEqual({ data: {} })
    })
  })

  describe('updateSubmission', () => {
    it('sends PUT with data wrapped in data key', async () => {
      const data = { firstName: 'Janet' }
      mock.onPut(`${BASE}/form/f1/submission/s1`).reply({ _id: 's1', data })

      const result = await service.updateSubmission('f1', 's1', data)

      expect(result).toEqual({ _id: 's1', data })
      expect(mock.history[0].body).toEqual({ data })
    })

    it('sends empty data object when data is not provided', async () => {
      mock.onPut(`${BASE}/form/f1/submission/s1`).reply({ _id: 's1', data: {} })

      await service.updateSubmission('f1', 's1')

      expect(mock.history[0].body).toEqual({ data: {} })
    })
  })

  describe('deleteSubmission', () => {
    it('sends DELETE and returns success', async () => {
      mock.onDelete(`${BASE}/form/f1/submission/s1`).reply({})

      const result = await service.deleteSubmission('f1', 's1')

      expect(result).toEqual({ success: true })
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Actions ──

  describe('listFormActions', () => {
    it('sends GET to the correct path', async () => {
      const actions = [{ _id: 'a1', name: 'save', title: 'Save Submission' }]
      mock.onGet(`${BASE}/form/f1/action`).reply(actions)

      const result = await service.listFormActions('f1')

      expect(result).toEqual(actions)
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Roles ──

  describe('listRoles', () => {
    it('sends GET to /role', async () => {
      const roles = [{ _id: 'r1', title: 'Administrator' }]
      mock.onGet(`${BASE}/role`).reply(roles)

      const result = await service.listRoles()

      expect(result).toEqual(roles)
      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({ 'x-token': API_KEY })
    })
  })

  // ── Connection ──

  describe('getCurrentUser', () => {
    it('sends GET to /current', async () => {
      const user = { _id: 'u1', data: { email: 'admin@example.com' } }
      mock.onGet(`${BASE}/current`).reply(user)

      const result = await service.getCurrentUser()

      expect(result).toEqual(user)
      expect(mock.history).toHaveLength(1)
    })
  })

  // ── Dictionary ──

  describe('getFormsDictionary', () => {
    it('returns items with label, value, and note', async () => {
      const forms = [
        { _id: 'f1', title: 'Contact Us', name: 'contactUs', path: 'contact' },
        { _id: 'f2', title: 'Signup', name: 'signup', path: 'signup' },
      ]
      mock.onGet(`${BASE}/form`).reply(forms)

      const result = await service.getFormsDictionary({})

      expect(result.items).toEqual([
        { label: 'Contact Us', value: 'f1', note: 'path: contact' },
        { label: 'Signup', value: 'f2', note: 'path: signup' },
      ])
      expect(mock.history[0].query).toMatchObject({
        type: 'form',
        limit: 25,
        skip: 0,
        sort: 'title',
      })
    })

    it('applies search regex filter', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.getFormsDictionary({ search: 'contact' })

      expect(mock.history[0].query['title__regex']).toBe('/contact/i')
    })

    it('escapes special regex characters in search', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.getFormsDictionary({ search: 'test.form' })

      expect(mock.history[0].query['title__regex']).toBe('/test\\.form/i')
    })

    it('paginates using cursor', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      await service.getFormsDictionary({ cursor: '25' })

      expect(mock.history[0].query).toMatchObject({ skip: 25 })
    })

    it('returns cursor when results fill a page', async () => {
      const forms = Array.from({ length: 25 }, (_, i) => ({
        _id: `f${i}`,
        title: `Form ${i}`,
        path: `form-${i}`,
      }))
      mock.onGet(`${BASE}/form`).reply(forms)

      const result = await service.getFormsDictionary({})

      expect(result.cursor).toBe('25')
    })

    it('returns no cursor when results are fewer than limit', async () => {
      mock.onGet(`${BASE}/form`).reply([{ _id: 'f1', title: 'Only One', path: 'one' }])

      const result = await service.getFormsDictionary({})

      expect(result.cursor).toBeUndefined()
    })

    it('handles empty payload gracefully', async () => {
      mock.onGet(`${BASE}/form`).reply([])

      const result = await service.getFormsDictionary()

      expect(result).toEqual({ items: [], cursor: undefined })
    })

    it('falls back to name, path, or _id for label', async () => {
      const forms = [
        { _id: 'f1', name: 'nameOnly', path: 'p1' },
        { _id: 'f2', path: 'pathOnly' },
        { _id: 'f3' },
      ]
      mock.onGet(`${BASE}/form`).reply(forms)

      const result = await service.getFormsDictionary({})

      expect(result.items[0].label).toBe('nameOnly')
      expect(result.items[1].label).toBe('pathOnly')
      expect(result.items[2].label).toBe('f3')
    })
  })

  // ── Error handling ──

  describe('error handling', () => {
    it('includes status code in error message', async () => {
      mock.onGet(`${BASE}/current`).replyWithError({
        message: 'Forbidden',
        status: 403,
        body: { message: 'Access denied' },
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Form.io API error [403]: Access denied')
    })

    it('handles error with no body', async () => {
      mock.onGet(`${BASE}/current`).replyWithError({
        message: 'Network error',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Form.io API error: Network error')
    })

    it('handles error with string body', async () => {
      mock.onGet(`${BASE}/current`).replyWithError({
        message: 'Error',
        body: 'Something went wrong',
      })

      await expect(service.getCurrentUser()).rejects.toThrow('Form.io API error: Something went wrong')
    })
  })

})
