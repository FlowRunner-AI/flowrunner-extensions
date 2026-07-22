'use strict'

const { createSandbox } = require('../../../service-sandbox')

const URL = 'https://wekan.example.com'
const USERNAME = 'tester'
const PASSWORD = 's3cret'

const LOGIN_URL = `${ URL }/users/login`
const API = `${ URL }/api`

const TOKEN = 'test-token'
const USER_ID = 'user-1'
const BOARD_ID = 'board-1'
const LIST_ID = 'list-1'
const CARD_ID = 'card-1'

const AUTH_HEADERS = {
  'Authorization': `Bearer ${ TOKEN }`,
  'Content-Type': 'application/json',
}

describe('Wekan Service', () => {
  let sandbox
  let service
  let mock

  const loginCalls = () => mock.history.filter(call => call.url === LOGIN_URL)
  const apiCalls = () => mock.history.filter(call => call.url !== LOGIN_URL)

  beforeAll(() => {
    sandbox = createSandbox({ url: `${ URL }/`, username: USERNAME, password: PASSWORD })
    require('../src/index.js')
    service = sandbox.getService()
    mock = sandbox.getRequestMock()
  })

  beforeEach(() => {
    mock.reset()

    // Each test starts from a clean, unauthenticated service instance.
    service.token = undefined
    service.userId = undefined

    mock.onPost(LOGIN_URL).reply({ token: TOKEN, id: USER_ID })
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // ── Registration & construction ──

  describe('service registration', () => {
    it('registers the expected config items', () => {
      const configItems = sandbox.getConfigItems()

      expect(configItems.map(item => item.name)).toEqual(['url', 'username', 'password'])

      expect(configItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'url', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'username', required: true, shared: false, type: 'STRING' }),
          expect.objectContaining({ name: 'password', required: true, shared: false, type: 'STRING' }),
        ])
      )
    })

    it('strips trailing slashes and builds the API base URL', () => {
      expect(service.baseUrl).toBe(URL)
      expect(service.apiBaseUrl).toBe(API)
    })
  })

  // ── Authentication ──

  describe('authentication', () => {
    it('logs in with a form-encoded password grant before the first API call', async () => {
      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply([])

      await service.getUserBoards()

      expect(loginCalls()).toHaveLength(1)
      expect(loginCalls()[0].method).toBe('post')
      expect(loginCalls()[0].headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
      expect(loginCalls()[0].body).toBe(`username=${ USERNAME }&password=${ PASSWORD }`)

      expect(apiCalls()[0].headers).toEqual(AUTH_HEADERS)
    })

    it('reuses the cached session for subsequent calls', async () => {
      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply([])
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).reply({ _id: BOARD_ID })

      await service.getUserBoards()
      await service.getBoard(BOARD_ID)

      expect(loginCalls()).toHaveLength(1)
      expect(apiCalls()).toHaveLength(2)
    })

    it('falls back to the _id field when the login response has no id', async () => {
      mock.reset()
      mock.onPost(LOGIN_URL).reply({ token: TOKEN, _id: 'user-alt' })
      mock.onGet(`${ API }/users/user-alt/boards`).reply([])

      await service.getUserBoards()

      expect(apiCalls()[0].url).toBe(`${ API }/users/user-alt/boards`)
    })

    it('throws a descriptive error when the login request fails', async () => {
      mock.reset()
      mock.onPost(LOGIN_URL).replyWithError({ message: 'Unauthorized', body: { reason: 'Incorrect password' } })

      await expect(service.getUserBoards()).rejects.toThrow(
        'Wekan login failed: Incorrect password. Verify the Server URL, username and password.'
      )
    })

    it('uses a plain string error body when Wekan returns one', async () => {
      mock.reset()
      mock.onPost(LOGIN_URL).replyWithError({ message: 'Bad Request', body: 'User not found' })

      await expect(service.getUserBoards()).rejects.toThrow('Wekan login failed: User not found')
    })

    it('throws when the login response carries no token', async () => {
      mock.reset()
      mock.onPost(LOGIN_URL).reply({})

      await expect(service.getUserBoards()).rejects.toThrow(
        'Wekan login did not return a token. Verify the username and password.'
      )
    })

    it('re-logs in once and retries the request after a 401', async () => {
      let attempts = 0

      mock.onGet(`${ API }/boards/${ BOARD_ID }`).replyWith(() => {
        attempts += 1

        if (attempts === 1) {
          throw Object.assign(new Error('Unauthorized'), { status: 401 })
        }

        return { _id: BOARD_ID, title: 'Product Roadmap' }
      })

      const result = await service.getBoard(BOARD_ID)

      expect(result).toEqual({ _id: BOARD_ID, title: 'Product Roadmap' })
      expect(attempts).toBe(2)
      expect(loginCalls()).toHaveLength(2)
    })

    it('gives up after a second consecutive 401', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).replyWith(() => {
        throw Object.assign(new Error('Unauthorized'), { statusCode: 401, body: { reason: 'Token expired' } })
      })

      await expect(service.getBoard(BOARD_ID)).rejects.toThrow('Wekan API error (401): Token expired')
      expect(loginCalls()).toHaveLength(2)
    })

    it('formats non-401 API errors with the status code', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).replyWithError({
        message: 'Not Found',
        status: 404,
        body: { message: 'board not found' },
      })

      await expect(service.getBoard(BOARD_ID)).rejects.toThrow('Wekan API error (404): board not found')
    })

    it('formats API errors without a status code', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).replyWithError({ message: 'socket hang up' })

      await expect(service.getBoard(BOARD_ID)).rejects.toThrow('Wekan API error: socket hang up')
    })

    it('uses a Meteor-style string error field when nothing else is available', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).replyWithError({
        message: 'Bad Request',
        status: 400,
        body: { error: 'invalid-board' },
      })

      await expect(service.getBoard(BOARD_ID)).rejects.toThrow('Wekan API error (400): invalid-board')
    })
  })

  // ── Boards ──

  describe('getUserBoards', () => {
    it('lists the boards of the authenticated user', async () => {
      const boards = [{ _id: BOARD_ID, title: 'Product Roadmap' }]

      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply(boards)

      const result = await service.getUserBoards()

      expect(result).toEqual(boards)
      expect(apiCalls()[0].method).toBe('get')
      expect(apiCalls()[0].url).toBe(`${ API }/users/${ USER_ID }/boards`)
      expect(apiCalls()[0].query).toEqual({})
      expect(apiCalls()[0].body).toBeUndefined()
    })
  })

  describe('getBoard', () => {
    it('requests a single board', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }`).reply({ _id: BOARD_ID, permission: 'private' })

      await expect(service.getBoard(BOARD_ID)).resolves.toEqual({ _id: BOARD_ID, permission: 'private' })
    })
  })

  describe('createBoard', () => {
    it('defaults the owner to the authenticated user and uses private/belize defaults', async () => {
      mock.onPost(`${ API }/boards`).reply({ _id: 'new-board', defaultSwimlaneId: 'swim-1' })

      const result = await service.createBoard('New Board')

      expect(result).toEqual({ _id: 'new-board', defaultSwimlaneId: 'swim-1' })
      expect(apiCalls()[0].method).toBe('post')

      expect(apiCalls()[0].body).toEqual({
        title: 'New Board',
        owner: USER_ID,
        permission: 'private',
        color: 'belize',
      })
    })

    it('maps the permission and color choice labels to API tokens', async () => {
      mock.onPost(`${ API }/boards`).reply({ _id: 'new-board' })

      await service.createBoard('New Board', 'owner-2', 'Public', 'Clean Dark')

      expect(apiCalls()[0].body).toEqual({
        title: 'New Board',
        owner: 'owner-2',
        permission: 'public',
        color: 'cleandark',
      })
    })

    it('passes through unmapped permission and color values', async () => {
      mock.onPost(`${ API }/boards`).reply({ _id: 'new-board' })

      await service.createBoard('New Board', 'owner-2', 'private', 'midnight')

      expect(apiCalls()[0].body).toMatchObject({ permission: 'private', color: 'midnight' })
    })
  })

  describe('deleteBoard', () => {
    it('deletes a board and returns a confirmation payload', async () => {
      mock.onDelete(`${ API }/boards/${ BOARD_ID }`).reply('')

      const result = await service.deleteBoard(BOARD_ID)

      expect(result).toEqual({ boardId: BOARD_ID, deleted: true })
      expect(apiCalls()[0].method).toBe('delete')
    })
  })

  describe('getBoardCardsCount', () => {
    it('requests the cards_count endpoint', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/cards_count`).reply({ board_cards_count: 42 })

      await expect(service.getBoardCardsCount(BOARD_ID)).resolves.toEqual({ board_cards_count: 42 })
    })
  })

  // ── Lists ──

  describe('getLists', () => {
    it('lists the columns of a board', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists`).reply([{ _id: LIST_ID, title: 'To Do' }])

      await expect(service.getLists(BOARD_ID)).resolves.toEqual([{ _id: LIST_ID, title: 'To Do' }])
    })
  })

  describe('getList', () => {
    it('requests a single list', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }`).reply({ _id: LIST_ID, title: 'To Do' })

      await expect(service.getList(BOARD_ID, LIST_ID)).resolves.toEqual({ _id: LIST_ID, title: 'To Do' })
    })
  })

  describe('createList', () => {
    it('posts the list title', async () => {
      mock.onPost(`${ API }/boards/${ BOARD_ID }/lists`).reply({ _id: 'list-new' })

      const result = await service.createList(BOARD_ID, 'Doing')

      expect(result).toEqual({ _id: 'list-new' })
      expect(apiCalls()[0].body).toEqual({ title: 'Doing' })
    })
  })

  describe('deleteList', () => {
    it('deletes a list and returns a confirmation payload', async () => {
      mock.onDelete(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }`).reply('')

      await expect(service.deleteList(BOARD_ID, LIST_ID)).resolves.toEqual({
        boardId: BOARD_ID,
        listId: LIST_ID,
        deleted: true,
      })
    })
  })

  // ── Cards ──

  describe('getCardsInList', () => {
    it('lists the cards of a list', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards`).reply([{ _id: CARD_ID }])

      await expect(service.getCardsInList(BOARD_ID, LIST_ID)).resolves.toEqual([{ _id: CARD_ID }])
    })
  })

  describe('getCard', () => {
    it('requests a single card', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards/${ CARD_ID }`).reply({ _id: CARD_ID })

      await expect(service.getCard(BOARD_ID, LIST_ID, CARD_ID)).resolves.toEqual({ _id: CARD_ID })
    })
  })

  describe('createCard', () => {
    it('defaults the author to the authenticated user and the description to an empty string', async () => {
      mock.onPost(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards`).reply({ _id: 'card-new' })

      const result = await service.createCard(BOARD_ID, LIST_ID, 'swim-1', 'Design homepage')

      expect(result).toEqual({ _id: 'card-new' })

      expect(apiCalls()[0].body).toEqual({
        title: 'Design homepage',
        authorId: USER_ID,
        swimlaneId: 'swim-1',
        description: '',
      })
    })

    it('uses the explicit author id and description', async () => {
      mock.onPost(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards`).reply({ _id: 'card-new' })

      await service.createCard(BOARD_ID, LIST_ID, 'swim-1', 'Design homepage', 'Draft the layout', 'author-9')

      expect(apiCalls()[0].body).toEqual({
        title: 'Design homepage',
        authorId: 'author-9',
        swimlaneId: 'swim-1',
        description: 'Draft the layout',
      })
    })
  })

  describe('editCard', () => {
    const CARD_URL = `${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards/${ CARD_ID }`

    it('sends only the provided fields', async () => {
      mock.onPut(CARD_URL).reply({ _id: CARD_ID })

      const result = await service.editCard(BOARD_ID, LIST_ID, CARD_ID, 'New title')

      expect(result).toEqual({ _id: CARD_ID })
      expect(apiCalls()[0].method).toBe('put')
      expect(apiCalls()[0].body).toEqual({ title: 'New title' })
    })

    it('maps the move-to list to the listId field and sends the due date', async () => {
      mock.onPut(CARD_URL).reply({ _id: CARD_ID })

      await service.editCard(
        BOARD_ID,
        LIST_ID,
        CARD_ID,
        '',
        'Updated description',
        'list-2',
        '2026-07-20T00:00:00.000Z'
      )

      expect(apiCalls()[0].body).toEqual({
        description: 'Updated description',
        listId: 'list-2',
        dueAt: '2026-07-20T00:00:00.000Z',
      })
    })

    it('allows clearing the description with an empty string', async () => {
      mock.onPut(CARD_URL).reply({ _id: CARD_ID })

      await service.editCard(BOARD_ID, LIST_ID, CARD_ID, undefined, '')

      expect(apiCalls()[0].body).toEqual({ description: '' })
    })

    it('throws when no updatable field is provided', async () => {
      await expect(service.editCard(BOARD_ID, LIST_ID, CARD_ID)).rejects.toThrow(
        'Nothing to update: provide at least one field to change on the card.'
      )

      expect(mock.history).toHaveLength(0)
    })
  })

  describe('deleteCard', () => {
    it('deletes a card and returns a confirmation payload', async () => {
      mock.onDelete(`${ API }/boards/${ BOARD_ID }/lists/${ LIST_ID }/cards/${ CARD_ID }`).reply('')

      await expect(service.deleteCard(BOARD_ID, LIST_ID, CARD_ID)).resolves.toEqual({
        boardId: BOARD_ID,
        listId: LIST_ID,
        cardId: CARD_ID,
        deleted: true,
      })
    })
  })

  describe('getCardsBySwimlane', () => {
    it('lists the cards of a swimlane', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/swimlanes/swim-1/cards`).reply([{ _id: CARD_ID }])

      await expect(service.getCardsBySwimlane(BOARD_ID, 'swim-1')).resolves.toEqual([{ _id: CARD_ID }])
    })
  })

  // ── Swimlanes ──

  describe('getSwimlanes', () => {
    it('lists the swimlanes of a board', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/swimlanes`).reply([{ _id: 'swim-1', title: 'Default' }])

      await expect(service.getSwimlanes(BOARD_ID)).resolves.toEqual([{ _id: 'swim-1', title: 'Default' }])
    })
  })

  describe('createSwimlane', () => {
    it('posts the swimlane title', async () => {
      mock.onPost(`${ API }/boards/${ BOARD_ID }/swimlanes`).reply({ _id: 'swim-2' })

      const result = await service.createSwimlane(BOARD_ID, 'Backlog')

      expect(result).toEqual({ _id: 'swim-2' })
      expect(apiCalls()[0].body).toEqual({ title: 'Backlog' })
    })
  })

  // ── Checklists ──

  describe('getCardChecklists', () => {
    it('lists the checklists of a card', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/cards/${ CARD_ID }/checklists`).reply([{ _id: 'chk-1' }])

      await expect(service.getCardChecklists(BOARD_ID, CARD_ID)).resolves.toEqual([{ _id: 'chk-1' }])
    })
  })

  describe('createChecklist', () => {
    it('posts the checklist title', async () => {
      mock.onPost(`${ API }/boards/${ BOARD_ID }/cards/${ CARD_ID }/checklists`).reply({ _id: 'chk-2' })

      const result = await service.createChecklist(BOARD_ID, CARD_ID, 'Acceptance criteria')

      expect(result).toEqual({ _id: 'chk-2' })
      expect(apiCalls()[0].body).toEqual({ title: 'Acceptance criteria' })
    })
  })

  // ── Dictionaries ──

  describe('getBoardsDictionary', () => {
    it('maps the user boards to dictionary items', async () => {
      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply([
        { _id: BOARD_ID, title: 'Product Roadmap' },
        { _id: 'board-2', title: 'Marketing' },
      ])

      const result = await service.getBoardsDictionary({})

      expect(result).toEqual({
        items: [
          { label: 'Product Roadmap', value: BOARD_ID },
          { label: 'Marketing', value: 'board-2' },
        ],
      })
    })

    it('filters boards case-insensitively by title', async () => {
      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply([
        { _id: BOARD_ID, title: 'Product Roadmap' },
        { _id: 'board-2', title: 'Marketing' },
      ])

      const result = await service.getBoardsDictionary({ search: 'ROAD' })

      expect(result.items).toEqual([{ label: 'Product Roadmap', value: BOARD_ID }])
    })

    it('handles a null payload and a non-array response', async () => {
      mock.onGet(`${ API }/users/${ USER_ID }/boards`).reply(null)

      await expect(service.getBoardsDictionary(null)).resolves.toEqual({ items: [] })
    })
  })

  describe('getListsDictionary', () => {
    it('returns an empty list when no board is selected', async () => {
      await expect(service.getListsDictionary({})).resolves.toEqual({ items: [] })
      await expect(service.getListsDictionary(null)).resolves.toEqual({ items: [] })
      expect(mock.history).toHaveLength(0)
    })

    it('maps the lists of the selected board to dictionary items', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists`).reply([
        { _id: LIST_ID, title: 'To Do' },
        { _id: 'list-2', title: 'Doing' },
      ])

      const result = await service.getListsDictionary({ criteria: { boardId: BOARD_ID } })

      expect(result).toEqual({
        items: [
          { label: 'To Do', value: LIST_ID },
          { label: 'Doing', value: 'list-2' },
        ],
      })
    })

    it('filters lists case-insensitively by title', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists`).reply([
        { _id: LIST_ID, title: 'To Do' },
        { _id: 'list-2', title: 'Doing' },
      ])

      const result = await service.getListsDictionary({ search: 'DOI', criteria: { boardId: BOARD_ID } })

      expect(result.items).toEqual([{ label: 'Doing', value: 'list-2' }])
    })

    it('handles a non-array lists response', async () => {
      mock.onGet(`${ API }/boards/${ BOARD_ID }/lists`).reply(undefined)

      await expect(service.getListsDictionary({ criteria: { boardId: BOARD_ID } })).resolves.toEqual({ items: [] })
    })
  })
})
