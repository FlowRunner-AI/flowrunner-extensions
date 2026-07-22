'use strict'

const { createSandbox } = require('../../../service-sandbox')

const API_KEY = 'test-api-key'
const TOKEN = 'test-token'
const BASE = 'https://api.trello.com/1'
const AUTH_HEADER = `OAuth oauth_consumer_key="${ API_KEY }", oauth_token="${ TOKEN }"`

describe('Trello Service', () => {
  let sandbox
  let service
  let mock

  beforeAll(() => {
    sandbox = createSandbox({ apiKey: API_KEY, token: TOKEN })
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
      const configs = sandbox.getConfigItems()

      expect(configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'apiKey', required: true }),
          expect.objectContaining({ name: 'token', required: true }),
        ])
      )
    })
  })

  // ── Auth Header ──

  describe('auth header', () => {
    it('sends OAuth authorization header on every request', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).reply([])
      await service.getBoardsDictionary({})

      expect(mock.history).toHaveLength(1)
      expect(mock.history[0].headers).toMatchObject({
        Authorization: AUTH_HEADER,
      })
    })
  })

  // ── Dictionaries ──

  describe('getBoardsDictionary', () => {
    it('returns mapped boards', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).reply([
        { id: 'b1', name: 'Board One' },
        { id: 'b2', name: 'Board Two' },
      ])

      const result = await service.getBoardsDictionary({})

      expect(result.items).toEqual([
        { label: 'Board One', note: 'ID: b1', value: 'b1' },
        { label: 'Board Two', note: 'ID: b2', value: 'b2' },
      ])
    })

    it('filters by search', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).reply([
        { id: 'b1', name: 'Alpha' },
        { id: 'b2', name: 'Beta' },
      ])

      const result = await service.getBoardsDictionary({ search: 'alp' })

      expect(result.items).toHaveLength(1)
      expect(result.items[0].value).toBe('b1')
    })

    it('handles null payload', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).reply([{ id: 'b1', name: 'A' }])

      const result = await service.getBoardsDictionary(null)

      expect(result.items).toHaveLength(1)
    })

    it('uses [empty] label when name is missing', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).reply([{ id: 'b1', name: '' }])

      const result = await service.getBoardsDictionary({})

      expect(result.items[0].label).toBe('[empty]')
    })
  })

  describe('getBoardListsDictionary', () => {
    it('fetches lists for a board via criteria.idBoard', async () => {
      mock.onGet(`${ BASE }/boards/board1/lists`).reply([
        { id: 'l1', name: 'To Do' },
      ])

      const result = await service.getBoardListsDictionary({ criteria: { idBoard: 'board1' } })

      expect(result.items).toEqual([{ label: 'To Do', note: 'ID: l1', value: 'l1' }])
    })

    it('prefers newIdBoard over idBoard', async () => {
      mock.onGet(`${ BASE }/boards/newBoard/lists`).reply([{ id: 'l1', name: 'List' }])

      await service.getBoardListsDictionary({ criteria: { idBoard: 'oldBoard', newIdBoard: 'newBoard' } })

      expect(mock.history[0].url).toBe(`${ BASE }/boards/newBoard/lists`)
    })
  })

  describe('getArchivedBoardCardsDictionary', () => {
    it('passes filter=closed query param', async () => {
      mock.onGet(`${ BASE }/boards/board1/cards`).reply([
        { id: 'c1', name: 'Archived Card' },
      ])

      const result = await service.getArchivedBoardCardsDictionary({ criteria: { idBoard: 'board1' } })

      expect(mock.history[0].query).toMatchObject({ filter: 'closed' })
      expect(result.items).toHaveLength(1)
    })
  })

  describe('getBoardMembersDictionary', () => {
    it('returns members mapped by username', async () => {
      mock.onGet(`${ BASE }/boards/board1/members`).reply([
        { id: 'm1', username: 'john' },
      ])

      const result = await service.getBoardMembersDictionary({ criteria: { idBoard: 'board1' } })

      expect(result.items).toEqual([{ label: 'john', note: 'ID: m1', value: 'm1' }])
    })
  })

  describe('getBoardLabelsDictionary', () => {
    it('returns labels with color in label text', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([
        { id: 'lbl1', name: 'Bug', color: 'red' },
      ])

      const result = await service.getBoardLabelsDictionary({ criteria: { idBoard: 'board1' } })

      expect(result.items[0].label).toBe('Bug (red)')
    })

    it('handles label with no name', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([
        { id: 'lbl1', name: '', color: 'green' },
      ])

      const result = await service.getBoardLabelsDictionary({ criteria: { idBoard: 'board1' } })

      expect(result.items[0].label).toBe('(green)')
    })
  })

  describe('getListCardsDictionary', () => {
    it('fetches cards for a list', async () => {
      mock.onGet(`${ BASE }/lists/list1/cards`).reply([
        { id: 'c1', name: 'Card One' },
      ])

      const result = await service.getListCardsDictionary({ criteria: { idList: 'list1' } })

      expect(result.items).toEqual([{ label: 'Card One', note: 'ID: c1', value: 'c1' }])
    })
  })

  describe('getCardLabelsDictionary', () => {
    it('fetches labels for a card', async () => {
      mock.onGet(`${ BASE }/cards/card1/labels`).reply([
        { id: 'lbl1', name: 'Feature', color: 'blue' },
      ])

      const result = await service.getCardLabelsDictionary({ criteria: { idCard: 'card1' } })

      expect(result.items[0].label).toBe('Feature (blue)')
    })
  })

  describe('getCardAttachmentsDictionary', () => {
    it('fetches attachments for a card', async () => {
      mock.onGet(`${ BASE }/cards/card1/attachments`).reply([
        { id: 'att1', name: 'file.pdf' },
      ])

      const result = await service.getCardAttachmentsDictionary({ criteria: { idCard: 'card1' } })

      expect(result.items).toEqual([{ label: 'file.pdf', note: 'ID: att1', value: 'att1' }])
    })
  })

  describe('getCardStickersDictionary', () => {
    it('returns stickers with formatted label', async () => {
      mock.onGet(`${ BASE }/cards/card1/stickers`).reply([
        { id: 's1', image: 'taco-cool', top: 10, left: 20, zIndex: 1 },
      ])

      const result = await service.getCardStickersDictionary({ criteria: { idCard: 'card1' } })

      expect(result.items[0].label).toBe('taco-cool (top: 10, left: 20, zIndex: 1)')
    })
  })

  describe('getCardChecklistsDictionary', () => {
    it('fetches checklists for a card', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([
        { id: 'cl1', name: 'Checklist A' },
      ])

      const result = await service.getCardChecklistsDictionary({ criteria: { idCard: 'card1' } })

      expect(result.items).toEqual([{ label: 'Checklist A', note: 'ID: cl1', value: 'cl1' }])
    })
  })

  describe('getCardCheckItemsDictionary', () => {
    it('flattens checkItems from all checklists', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([
        { id: 'cl1', checkItems: [{ id: 'ci1', name: 'Item1', state: 'incomplete' }] },
        { id: 'cl2', checkItems: [{ id: 'ci2', name: 'Item2', state: 'complete' }] },
      ])

      const result = await service.getCardCheckItemsDictionary({ criteria: { idCard: 'card1' } })

      expect(result.items).toHaveLength(2)
      expect(result.items[0].label).toBe('Item1 (incomplete)')
      expect(result.items[1].label).toBe('Item2 (complete)')
    })
  })

  describe('getOrganizationsDictionary', () => {
    it('fetches organizations for the authenticated user', async () => {
      mock.onGet(`${ BASE }/members/me/organizations`).reply([
        { id: 'org1', name: 'My Org' },
      ])

      const result = await service.getOrganizationsDictionary({})

      expect(result.items).toEqual([{ label: 'My Org', note: 'ID: org1', value: 'org1' }])
    })
  })

  describe('getOrganizationBoardsDictionary', () => {
    it('fetches boards for an organization', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([
        { id: 'b1', name: 'Org Board' },
      ])

      const result = await service.getOrganizationBoardsDictionary({ criteria: { id: 'org1' } })

      expect(result.items).toEqual([{ label: 'Org Board', note: 'ID: b1', value: 'b1' }])
    })
  })

  describe('getOrganizationMembersDictionary', () => {
    it('fetches members for an organization', async () => {
      mock.onGet(`${ BASE }/organizations/org1/members`).reply([
        { id: 'm1', username: 'testuser' },
      ])

      const result = await service.getOrganizationMembersDictionary({ criteria: { id: 'org1' } })

      expect(result.items).toEqual([{ label: 'testuser', note: 'ID: m1', value: 'm1' }])
    })
  })

  describe('getMemberNotificationsDictionary', () => {
    it('fetches notifications for a member', async () => {
      mock.onGet(`${ BASE }/members/m1/notifications`).reply([
        { id: 'n1', type: 'cardDueSoon' },
      ])

      const result = await service.getMemberNotificationsDictionary({ criteria: { idMember: 'm1' } })

      expect(result.items).toEqual([{ label: 'cardDueSoon', note: 'ID: n1', value: 'n1' }])
    })
  })

  // ── Board Management ──

  describe('getBoardById', () => {
    it('sends GET with correct URL and query params', async () => {
      mock.onGet(`${ BASE }/boards/board1`).reply({ id: 'board1', name: 'Test Board' })

      const result = await service.getBoardById('board1', 'all', 'mine')

      expect(result).toEqual({ id: 'board1', name: 'Test Board' })
      expect(mock.history[0].url).toBe(`${ BASE }/boards/board1`)
      expect(mock.history[0].query).toMatchObject({ actions: 'all', boardStars: 'mine' })
    })
  })

  describe('findBoardByName', () => {
    it('returns the matching board', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([
        { id: 'b1', name: 'Alpha' },
        { id: 'b2', name: 'Beta' },
      ])

      const result = await service.findBoardByName('org1', 'Beta')

      expect(result).toEqual({ id: 'b2', name: 'Beta' })
    })

    it('returns undefined when no match', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([{ id: 'b1', name: 'Alpha' }])

      const result = await service.findBoardByName('org1', 'Nope')

      expect(result).toBeUndefined()
    })
  })

  describe('findOrCreateBoard', () => {
    it('returns existing board when found', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([{ id: 'b1', name: 'Existing' }])

      const result = await service.findOrCreateBoard('org1', 'Existing')

      expect(result).toEqual({ id: 'b1', name: 'Existing' })
      expect(mock.history).toHaveLength(1)
    })

    it('creates board when not found', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([])
      mock.onPost(`${ BASE }/boards`).reply({ id: 'b2', name: 'New Board' })

      const result = await service.findOrCreateBoard('org1', 'New Board')

      expect(result).toEqual({ id: 'b2', name: 'New Board' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].query).toMatchObject({ idOrganization: 'org1', name: 'New Board' })
    })
  })

  describe('createBoard', () => {
    it('sends POST with board params', async () => {
      mock.onPost(`${ BASE }/boards`).reply({ id: 'b1', name: 'New' })

      await service.createBoard('New', true, false, 'A desc', 'org1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({
        name: 'New',
        defaultLabels: true,
        defaultLists: false,
        desc: 'A desc',
        idOrganization: 'org1',
      })
    })

    it('maps prefs_ prefixed query params', async () => {
      mock.onPost(`${ BASE }/boards`).reply({ id: 'b1' })

      await service.createBoard(
        'B', undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        'private', 'members', 'members', 'admins', true, false, 'blue', 'regular'
      )

      expect(mock.history[0].query).toMatchObject({
        prefs_permissionLevel: 'private',
        prefs_voting: 'members',
        prefs_comments: 'members',
        prefs_invitations: 'admins',
        prefs_selfJoin: true,
        prefs_cardCovers: false,
        prefs_background: 'blue',
        prefs_cardAging: 'regular',
      })
    })
  })

  describe('closeBoard', () => {
    it('sends PUT with closed=true', async () => {
      mock.onPut(`${ BASE }/boards/board1`).reply({ id: 'board1', closed: true })

      await service.closeBoard('board1')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toMatchObject({ closed: true })
    })
  })

  describe('copyBoard', () => {
    it('sends POST with idBoardSource and name', async () => {
      mock.onPost(`${ BASE }/boards`).reply({ id: 'copy1' })

      await service.copyBoard('org1', 'sourceBoard', 'Copy Name')

      expect(mock.history[0].query).toMatchObject({
        idOrganization: 'org1',
        idBoardSource: 'sourceBoard',
        name: 'Copy Name',
      })
    })
  })

  // ── List Management ──

  describe('getBoardLists', () => {
    it('sends GET with correct query', async () => {
      mock.onGet(`${ BASE }/boards/board1/lists`).reply([])

      await service.getBoardLists('board1', 'open', 'name', 'open', 'all')

      expect(mock.history[0].query).toMatchObject({
        cards: 'open',
        card_fields: 'name',
        filter: 'open',
        fields: 'all',
      })
    })
  })

  describe('createBoardList', () => {
    it('sends POST to create a list', async () => {
      mock.onPost(`${ BASE }/boards/board1/lists`).reply({ id: 'l1', name: 'New List' })

      await service.createBoardList('board1', 'New List', 'top')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({ name: 'New List', pos: 'top' })
    })
  })

  describe('findBoardListByName', () => {
    it('finds a list by name', async () => {
      mock.onGet(`${ BASE }/boards/board1/lists`).reply([
        { id: 'l1', name: 'To Do' },
        { id: 'l2', name: 'Done' },
      ])

      const result = await service.findBoardListByName('board1', 'Done')

      expect(result).toEqual({ id: 'l2', name: 'Done' })
    })
  })

  describe('findOrCreateBoardList', () => {
    it('returns existing list when found', async () => {
      mock.onGet(`${ BASE }/boards/board1/lists`).reply([{ id: 'l1', name: 'Existing' }])

      const result = await service.findOrCreateBoardList('board1', 'Existing')

      expect(result).toEqual({ id: 'l1', name: 'Existing' })
      expect(mock.history).toHaveLength(1)
    })

    it('creates list when not found', async () => {
      mock.onGet(`${ BASE }/boards/board1/lists`).reply([])
      mock.onPost(`${ BASE }/boards/board1/lists`).reply({ id: 'l2', name: 'New List' })

      const result = await service.findOrCreateBoardList('board1', 'New List')

      expect(result).toEqual({ id: 'l2', name: 'New List' })
      expect(mock.history).toHaveLength(2)
    })
  })

  describe('getListById', () => {
    it('sends GET with list ID', async () => {
      mock.onGet(`${ BASE }/lists/list1`).reply({ id: 'list1', name: 'My List' })

      const result = await service.getListById('board1', 'list1', 'name,closed')

      expect(result).toEqual({ id: 'list1', name: 'My List' })
      expect(mock.history[0].query).toMatchObject({ fields: 'name,closed' })
    })
  })

  describe('getListCards', () => {
    it('fetches cards for a list', async () => {
      mock.onGet(`${ BASE }/lists/list1/cards`).reply([{ id: 'c1' }])

      const result = await service.getListCards('board1', 'list1')

      expect(result).toEqual([{ id: 'c1' }])
    })
  })

  describe('updateList', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ BASE }/lists/list1`).reply({ id: 'list1' })

      await service.updateList('board1', 'list1', 'Renamed', false, 'board2', 'bottom', true)

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toMatchObject({
        name: 'Renamed',
        closed: false,
        idBoard: 'board2',
        pos: 'bottom',
        subscribed: true,
      })
    })
  })

  describe('archiveList', () => {
    it('sends PUT with value=true', async () => {
      mock.onPut(`${ BASE }/lists/list1/closed`).reply({})

      await service.archiveList('board1', 'list1')

      expect(mock.history[0].query).toMatchObject({ value: true })
    })
  })

  // ── Card Management ──

  describe('createCard', () => {
    it('sends POST with card params', async () => {
      mock.onPost(`${ BASE }/cards`).reply({ id: 'c1', name: 'New Card' })

      await service.createCard('board1', 'list1', 'New Card', 'desc', 'top', null, null, false, null, null, 'https://example.com')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({
        idList: 'list1',
        name: 'New Card',
        desc: 'desc',
        pos: 'top',
        urlSource: 'https://example.com',
      })
    })
  })

  describe('updateCard', () => {
    it('sends PUT with updated fields', async () => {
      mock.onPut(`${ BASE }/cards/card1`).reply({ id: 'card1' })

      await service.updateCard('board1', 'list1', 'card1', 'Updated Name', 'New desc')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toMatchObject({ name: 'Updated Name', desc: 'New desc' })
    })

    it('maps newIdBoard and newIdList to idBoard and idList in query', async () => {
      mock.onPut(`${ BASE }/cards/card1`).reply({ id: 'card1' })

      await service.updateCard(
        'board1', 'list1', 'card1',
        undefined, undefined, undefined,
        'newBoard', 'newList'
      )

      expect(mock.history[0].query).toMatchObject({
        idBoard: 'newBoard',
        idList: 'newList',
      })
    })
  })

  describe('archiveCard', () => {
    it('sends PUT to card closed endpoint with value=true', async () => {
      mock.onPut(`${ BASE }/cards/card1/closed`).reply({})

      await service.archiveCard('board1', 'list1', 'card1')

      expect(mock.history[0].query).toMatchObject({ value: true })
    })
  })

  describe('unarchiveCard', () => {
    it('sends PUT to card closed endpoint with value=false', async () => {
      mock.onPut(`${ BASE }/cards/card1/closed`).reply({})

      await service.unarchiveCard('board1', 'card1')

      expect(mock.history[0].query).toMatchObject({ value: false })
    })
  })

  describe('deleteCard', () => {
    it('sends DELETE to correct URL', async () => {
      mock.onDelete(`${ BASE }/cards/card1`).reply({})

      await service.deleteCard('board1', 'list1', 'card1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/cards/card1`)
    })
  })

  describe('getCardById', () => {
    it('sends GET with card fields', async () => {
      mock.onGet(`${ BASE }/cards/card1`).reply({ id: 'card1', name: 'My Card' })

      await service.getCardById('board1', 'list1', 'card1', 'all', undefined, 'true', 'all')

      expect(mock.history[0].query).toMatchObject({
        fields: 'all',
        attachments: 'true',
        attachment_fields: 'all',
      })
    })
  })

  describe('findCardByName', () => {
    it('finds a card by name', async () => {
      mock.onGet(`${ BASE }/boards/board1/cards`).reply([
        { id: 'c1', name: 'Alpha' },
        { id: 'c2', name: 'Beta' },
      ])

      const result = await service.findCardByName('org1', 'board1', 'Beta')

      expect(result).toEqual({ id: 'c2', name: 'Beta' })
    })
  })

  describe('findOrCreateCard', () => {
    it('returns existing card when found', async () => {
      mock.onGet(`${ BASE }/boards/board1/cards`).reply([{ id: 'c1', name: 'Existing' }])

      const result = await service.findOrCreateCard('org1', 'board1', 'list1', 'Existing')

      expect(result).toEqual({ id: 'c1', name: 'Existing' })
      expect(mock.history).toHaveLength(1)
    })

    it('creates card when not found', async () => {
      mock.onGet(`${ BASE }/boards/board1/cards`).reply([])
      mock.onPost('/cards').reply({ id: 'c2', name: 'New Card' })

      const result = await service.findOrCreateCard('org1', 'board1', 'list1', 'New Card')

      expect(result).toEqual({ id: 'c2', name: 'New Card' })
      expect(mock.history).toHaveLength(2)
      expect(mock.history[1].query).toMatchObject({ idList: 'list1', name: 'New Card' })
    })
  })

  describe('moveCardToList', () => {
    it('sends PUT with new list ID', async () => {
      mock.onPut(`${ BASE }/cards/card1`).reply({ id: 'card1' })

      await service.moveCardToList('board1', 'list1', 'card1', 'newList')

      expect(mock.history[0].query).toMatchObject({ idList: 'newList' })
    })
  })

  describe('getCardActions', () => {
    it('sends GET with filter and page', async () => {
      mock.onGet(`${ BASE }/cards/card1/actions`).reply([])

      await service.getCardActions('board1', 'list1', 'card1', 'commentCard', 2)

      expect(mock.history[0].query).toMatchObject({ filter: 'commentCard', page: 2 })
    })
  })

  // ── Board Members ──

  describe('getBoardMembers', () => {
    it('fetches board members', async () => {
      mock.onGet(`${ BASE }/boards/board1/members`).reply([{ id: 'm1' }])

      const result = await service.getBoardMembers('board1')

      expect(result).toEqual([{ id: 'm1' }])
    })
  })

  // ── Board Actions ──

  describe('getBoardActions', () => {
    it('sends GET with all query params', async () => {
      mock.onGet(`${ BASE }/boards/board1/actions`).reply([])

      await service.getBoardActions('board1', 'all', 'createCard', 'list', undefined, 10, true, 'fullName', true, 'fullName', 0, true, undefined, undefined)

      expect(mock.history[0].query).toMatchObject({
        fields: 'all',
        filter: 'createCard',
        format: 'list',
        limit: 10,
        member: true,
        member_fields: 'fullName',
        memberCreator: true,
        memberCreator_fields: 'fullName',
        page: 0,
        reactions: true,
      })
    })
  })

  // ── Board Power-Ups ──

  describe('getBoardPowerUps', () => {
    it('fetches board plugins', async () => {
      mock.onGet(`${ BASE }/boards/board1/boardPlugins`).reply([{ id: 'p1' }])

      const result = await service.getBoardPowerUps('board1')

      expect(result).toEqual([{ id: 'p1' }])
    })
  })

  // ── Label Management ──

  describe('getBoardLabels', () => {
    it('sends GET with fields and limit', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([])

      await service.getBoardLabels('board1', 'all', 100)

      expect(mock.history[0].query).toMatchObject({ fields: 'all', limit: 100 })
    })
  })

  describe('createBoardLabel', () => {
    it('sends POST with name and color', async () => {
      mock.onPost(`${ BASE }/boards/board1/labels`).reply({ id: 'lbl1' })

      await service.createBoardLabel('board1', 'Bug', 'red')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({ name: 'Bug', color: 'red' })
    })
  })

  describe('updateBoardLabel', () => {
    it('sends PUT to labels endpoint', async () => {
      mock.onPut(`${ BASE }/labels/lbl1`).reply({ id: 'lbl1' })

      await service.updateBoardLabel('board1', 'lbl1', 'Feature', 'blue')

      expect(mock.history[0].method).toBe('put')
      expect(mock.history[0].query).toMatchObject({ name: 'Feature', color: 'blue' })
    })
  })

  describe('deleteBoardLabel', () => {
    it('sends DELETE to labels endpoint', async () => {
      mock.onDelete(`${ BASE }/labels/lbl1`).reply({})

      await service.deleteBoardLabel('board1', 'lbl1')

      expect(mock.history[0].method).toBe('delete')
      expect(mock.history[0].url).toBe(`${ BASE }/labels/lbl1`)
    })
  })

  describe('findBoardLabelByName', () => {
    it('finds a label by name', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([
        { id: 'lbl1', name: 'Bug' },
        { id: 'lbl2', name: 'Feature' },
      ])

      const result = await service.findBoardLabelByName('org1', 'board1', 'Feature')

      expect(result).toEqual({ id: 'lbl2', name: 'Feature' })
    })
  })

  describe('findOrCreateBoardLabel', () => {
    it('returns existing label when found', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([{ id: 'lbl1', name: 'Bug' }])

      const result = await service.findOrCreateBoardLabel('org1', 'board1', 'Bug', 'red')

      expect(result).toEqual({ id: 'lbl1', name: 'Bug' })
      expect(mock.history).toHaveLength(1)
    })

    it('creates label when not found', async () => {
      mock.onGet(`${ BASE }/boards/board1/labels`).reply([])
      mock.onPost(`${ BASE }/boards/board1/labels`).reply({ id: 'lbl2', name: 'New' })

      const result = await service.findOrCreateBoardLabel('org1', 'board1', 'New', 'green')

      expect(result).toEqual({ id: 'lbl2', name: 'New' })
      expect(mock.history[1].query).toMatchObject({ name: 'New', color: 'green' })
    })
  })

  // ── Checklist Management ──

  describe('getCardChecklists', () => {
    it('sends GET with filter and fields', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([])

      await service.getCardChecklists('board1', 'list1', 'card1', 'all', 'name')

      expect(mock.history[0].query).toMatchObject({ filter: 'all', fields: 'name' })
    })
  })

  describe('getCardChecklistById', () => {
    it('sends GET to checklists endpoint with query', async () => {
      mock.onGet(`${ BASE }/checklists/cl1`).reply({ id: 'cl1' })

      await service.getCardChecklistById('board1', 'list1', 'card1', 'cl1', 'all', 'all', 'name', 'all')

      expect(mock.history[0].query).toMatchObject({
        cards: 'all',
        checkItems: 'all',
        checkItem_fields: 'name',
        fields: 'all',
      })
    })
  })

  describe('addChecklistToCard', () => {
    it('sends POST to card checklists', async () => {
      mock.onPost(`${ BASE }/cards/card1/checklists`).reply({ id: 'cl1' })

      await service.addChecklistToCard('org1', 'board1', 'list1', 'card1', 'My Checklist', 'source1', 'top')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({ name: 'My Checklist', idChecklistSource: 'source1', pos: 'top' })
    })
  })

  describe('deleteCardChecklist', () => {
    it('sends DELETE to card checklist', async () => {
      mock.onDelete(`${ BASE }/cards/card1/checklists/cl1`).reply({})

      await service.deleteCardChecklist('board1', 'list1', 'card1', 'cl1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('createChecklist', () => {
    it('sends POST to /checklists endpoint', async () => {
      mock.onPost('/checklists').reply({ id: 'cl1' })

      await service.createChecklist('board1', 'list1', 'card1', 'My CL', 'top', 'src1')

      expect(mock.history[0].query).toMatchObject({ idCard: 'card1', name: 'My CL', pos: 'top', idChecklistSource: 'src1' })
    })
  })

  describe('findChecklistByName', () => {
    it('finds checklist by name', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([
        { id: 'cl1', name: 'Alpha' },
        { id: 'cl2', name: 'Beta' },
      ])

      const result = await service.findChecklistByName('board1', 'list1', 'card1', 'Beta')

      expect(result).toEqual({ id: 'cl2', name: 'Beta' })
    })
  })

  describe('findOrCreateChecklist', () => {
    it('returns existing checklist when found', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([{ id: 'cl1', name: 'Existing' }])

      const result = await service.findOrCreateChecklist('board1', 'list1', 'card1', 'Existing')

      expect(result).toEqual({ id: 'cl1', name: 'Existing' })
    })

    it('creates checklist when not found', async () => {
      mock.onGet(`${ BASE }/cards/card1/checklists`).reply([])
      mock.onPost('/checklists').reply({ id: 'cl2', name: 'New' })

      const result = await service.findOrCreateChecklist('board1', 'list1', 'card1', 'New')

      expect(result).toEqual({ id: 'cl2', name: 'New' })
    })
  })

  describe('addChecklistItem', () => {
    it('sends POST to checklist checkItems', async () => {
      mock.onPost(`${ BASE }/checklists/cl1/checkItems`).reply({ id: 'ci1' })

      await service.addChecklistItem('board1', 'list1', 'card1', 'cl1', 'Task 1', 'top', true, '2025-01-01', 3, 'm1')

      expect(mock.history[0].method).toBe('post')
      expect(mock.history[0].query).toMatchObject({
        name: 'Task 1',
        pos: 'top',
        checked: true,
        due: '2025-01-01',
        dueReminder: 3,
        idMember: 'm1',
      })
    })
  })

  describe('updateChecklistItem', () => {
    it('sends PUT to card checkItem', async () => {
      mock.onPut(`${ BASE }/cards/card1/checkItem/ci1`).reply({ id: 'ci1' })

      await service.updateChecklistItem('board1', 'list1', 'card1', 'ci1', 'Updated', 'complete', 'cl1', 'bottom')

      expect(mock.history[0].query).toMatchObject({
        name: 'Updated',
        state: 'complete',
        idChecklist: 'cl1',
        pos: 'bottom',
      })
    })
  })

  describe('completeCheckItem', () => {
    it('sends PUT with state=complete', async () => {
      mock.onPut(`${ BASE }/cards/card1/checkItem/ci1`).reply({ id: 'ci1' })

      await service.completeCheckItem('board1', 'list1', 'card1', 'ci1')

      expect(mock.history[0].query).toMatchObject({ state: 'complete' })
    })
  })

  describe('findChecklistItemByName', () => {
    it('finds a check item by name', async () => {
      mock.onGet(`${ BASE }/checklists/cl1`).reply({
        id: 'cl1',
        checkItems: [
          { id: 'ci1', name: 'Item A' },
          { id: 'ci2', name: 'Item B' },
        ],
      })

      const result = await service.findChecklistItemByName('board1', 'list1', 'card1', 'cl1', 'Item B')

      expect(result).toEqual({ id: 'ci2', name: 'Item B' })
    })
  })

  describe('deleteChecklistItem', () => {
    it('sends DELETE to card checkItem', async () => {
      mock.onDelete(`${ BASE }/cards/card1/checkItem/ci1`).reply({})

      await service.deleteChecklistItem('board1', 'list1', 'card1', 'ci1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  // ── Card Content ──

  describe('getCardStickers', () => {
    it('sends GET with fields query', async () => {
      mock.onGet(`${ BASE }/cards/card1/stickers`).reply([])

      await service.getCardStickers('board1', 'list1', 'card1', 'all')

      expect(mock.history[0].query).toMatchObject({ fields: 'all' })
    })
  })

  describe('addStickerToCard', () => {
    it('sends POST with sticker params', async () => {
      mock.onPost(`${ BASE }/cards/card1/stickers`).reply({ id: 's1' })

      await service.addStickerToCard('board1', 'list1', 'card1', 'taco-cool', 10, 20, 1, 45)

      expect(mock.history[0].query).toMatchObject({
        image: 'taco-cool',
        top: 10,
        left: 20,
        zIndex: 1,
        rotate: 45,
      })
    })
  })

  describe('deleteStickerFromCard', () => {
    it('sends DELETE for a sticker', async () => {
      mock.onDelete(`${ BASE }/cards/card1/stickers/s1`).reply({})

      await service.deleteStickerFromCard('board1', 'list1', 'card1', 's1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getCardAttachments', () => {
    it('sends GET with fields and filter', async () => {
      mock.onGet(`${ BASE }/cards/card1/attachments`).reply([])

      await service.getCardAttachments('board1', 'list1', 'card1', 'all', 'cover')

      expect(mock.history[0].query).toMatchObject({ fields: 'all', filter: 'cover' })
    })
  })

  describe('addAttachment', () => {
    it('sends POST with attachment params', async () => {
      mock.onPost(`${ BASE }/cards/card1/attachments`).reply({ id: 'att1' })

      await service.addAttachment('board1', 'list1', 'card1', 'file.pdf', 'data', 'application/pdf', null, true)

      expect(mock.history[0].query).toMatchObject({
        name: 'file.pdf',
        file: 'data',
        mimeType: 'application/pdf',
        setCover: true,
      })
    })
  })

  describe('deleteAttachment', () => {
    it('sends DELETE for an attachment', async () => {
      mock.onDelete(`${ BASE }/cards/card1/attachments/att1`).reply({})

      await service.deleteAttachment('board1', 'list1', 'card1', 'att1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('addComment', () => {
    it('sends POST with comment text', async () => {
      mock.onPost(`${ BASE }/cards/card1/actions/comments`).reply({ id: 'a1' })

      await service.addComment('board1', 'list1', 'card1', 'Hello World')

      expect(mock.history[0].query).toMatchObject({ text: 'Hello World' })
    })
  })

  // ── Member Management ──

  describe('getCardMembers', () => {
    it('fetches card members with fields', async () => {
      mock.onGet(`${ BASE }/cards/card1/members`).reply([{ id: 'm1' }])

      await service.getCardMembers('board1', 'list1', 'card1', 'all')

      expect(mock.history[0].query).toMatchObject({ fields: 'all' })
    })
  })

  describe('addMemberToCard', () => {
    it('sends POST with member value', async () => {
      mock.onPost(`${ BASE }/cards/card1/idMembers`).reply([])

      await service.addMemberToCard('org1', 'board1', 'list1', 'card1', 'm1')

      expect(mock.history[0].query).toMatchObject({ value: 'm1' })
    })
  })

  describe('deleteMemberFromCard', () => {
    it('sends DELETE for a member', async () => {
      mock.onDelete(`${ BASE }/cards/card1/idMembers/m1`).reply({})

      await service.deleteMemberFromCard('board1', 'list1', 'card1', 'm1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('addLabelToCard', () => {
    it('sends POST with label value', async () => {
      mock.onPost(`${ BASE }/cards/card1/idLabels`).reply([])

      await service.addLabelToCard('org1', 'board1', 'list1', 'card1', 'lbl1')

      expect(mock.history[0].query).toMatchObject({ value: 'lbl1' })
    })
  })

  describe('deleteCardLabel', () => {
    it('sends DELETE for a label', async () => {
      mock.onDelete(`${ BASE }/cards/card1/idLabels/lbl1`).reply({})

      await service.deleteCardLabel('org1', 'board1', 'list1', 'card1', 'lbl1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getMemberById', () => {
    it('sends GET with member query params', async () => {
      mock.onGet(`${ BASE }/members/m1`).reply({ id: 'm1' })

      await service.getMemberById('board1', 'm1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'all')

      expect(mock.history[0].query).toMatchObject({ fields: 'all' })
    })
  })

  describe('findMemberByName', () => {
    it('finds a member by username', async () => {
      mock.onGet(`${ BASE }/organizations/org1/members`).reply([
        { id: 'm1', username: 'alice' },
        { id: 'm2', username: 'bob' },
      ])

      const result = await service.findMemberByName('org1', 'bob')

      expect(result).toEqual({ id: 'm2', username: 'bob' })
    })
  })

  describe('addMemberToBoard', () => {
    it('sends PUT with type', async () => {
      mock.onPut(`${ BASE }/boards/board1/members/m1`).reply({})

      await service.addMemberToBoard('org1', 'board1', 'm1', 'normal', false)

      expect(mock.history[0].query).toMatchObject({ type: 'normal', allowBillableGuest: false })
    })
  })

  describe('deleteMemberFromBoard', () => {
    it('sends DELETE', async () => {
      mock.onDelete(`${ BASE }/boards/board1/members/m1`).reply({})

      await service.deleteMemberFromBoard('board1', 'm1')

      expect(mock.history[0].method).toBe('delete')
    })
  })

  describe('getMemberCards', () => {
    it('sends GET with filter', async () => {
      mock.onGet(`${ BASE }/members/m1/cards`).reply([])

      await service.getMemberCards('org1', 'm1', 'visible')

      expect(mock.history[0].query).toMatchObject({ filter: 'visible' })
    })
  })

  // ── Notification Management ──

  describe('getMemberNotifications', () => {
    it('sends GET with notification params', async () => {
      mock.onGet(`${ BASE }/members/m1/notifications`).reply([])

      await service.getMemberNotifications('org1', 'm1', true, false, 'all', 'unread', 'all', 50, 0)

      expect(mock.history[0].query).toMatchObject({
        entities: true,
        display: false,
        filter: 'all',
        read_filter: 'unread',
        fields: 'all',
        limit: 50,
        page: 0,
      })
    })
  })

  describe('markNotificationAsRead', () => {
    it('sends PUT with unread=false', async () => {
      mock.onPut(`${ BASE }/notifications/n1`).reply({})

      await service.markNotificationAsRead('org1', 'm1', 'n1')

      expect(mock.history[0].query).toMatchObject({ unread: false })
    })
  })

  // ── Organization Management ──

  describe('getOrganizationById', () => {
    it('sends GET with org ID', async () => {
      mock.onGet(`${ BASE }/organizations/org1`).reply({ id: 'org1' })

      const result = await service.getOrganizationById('org1')

      expect(result).toEqual({ id: 'org1' })
    })
  })

  describe('getOrganizationBoards', () => {
    it('sends GET with filter and fields', async () => {
      mock.onGet(`${ BASE }/organizations/org1/boards`).reply([])

      await service.getOrganizationBoards('org1', 'open', 'name,id')

      expect(mock.history[0].query).toMatchObject({ filter: 'open', fields: 'name,id' })
    })
  })

  // ── Error Handling ──

  describe('error handling', () => {
    it('throws on API error', async () => {
      mock.onGet(`${ BASE }/members/me/boards`).replyWithError({
        message: 'Unauthorized',
        body: { message: 'Invalid API key' },
      })

      await expect(service.getBoardsDictionary({})).rejects.toThrow()
    })
  })
})
