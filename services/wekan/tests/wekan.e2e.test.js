'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('Wekan Service (e2e)', () => {
  let sandbox
  let service

  beforeAll(() => {
    sandbox = createE2ESandbox('wekan')
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

  // ── Boards ──

  describe('getUserBoards', () => {
    it('returns the boards of the authenticated user', async () => {
      const result = await service.getUserBoards()

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('getBoardsDictionary', () => {
    it('returns dictionary items with a label and value', async () => {
      const result = await service.getBoardsDictionary({})

      expect(Array.isArray(result.items)).toBe(true)

      for (const item of result.items) {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      }
    })
  })

  // ── Full lifecycle on a temporary board ──

  describe('board / list / card lifecycle', () => {
    let boardId
    let swimlaneId
    let listId
    let cardId
    let secondListId

    afterAll(async () => {
      if (boardId) {
        try {
          await service.deleteBoard(boardId)
        } catch (error) {
          console.log(`Cleanup: could not delete board ${ boardId }: ${ error.message }`)
        }
      }
    })

    it('creates a board', async () => {
      const result = await service.createBoard(`FlowRunner e2e ${ SUFFIX }`, undefined, 'Private', 'Belize')

      expect(result).toHaveProperty('_id')

      boardId = result._id
      swimlaneId = result.defaultSwimlaneId
    })

    it('reads the board back', async () => {
      const result = await service.getBoard(boardId)

      expect(result).toHaveProperty('_id', boardId)
      expect(result).toHaveProperty('title', `FlowRunner e2e ${ SUFFIX }`)
    })

    it('finds the board through the dictionary', async () => {
      const result = await service.getBoardsDictionary({ search: `e2e ${ SUFFIX }` })

      expect(result.items.some(item => item.value === boardId)).toBe(true)
    })

    it('lists the swimlanes of the board', async () => {
      const result = await service.getSwimlanes(boardId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)

      if (!swimlaneId) {
        swimlaneId = result[0]._id
      }
    })

    it('creates an extra swimlane', async () => {
      const result = await service.createSwimlane(boardId, 'E2E Swimlane')

      expect(result).toHaveProperty('_id')
    })

    it('creates a list', async () => {
      const result = await service.createList(boardId, 'E2E To Do')

      expect(result).toHaveProperty('_id')

      listId = result._id
    })

    it('lists the lists of the board', async () => {
      const result = await service.getLists(boardId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.some(item => item._id === listId)).toBe(true)
    })

    it('reads a single list', async () => {
      const result = await service.getList(boardId, listId)

      expect(result).toHaveProperty('_id', listId)
    })

    it('returns the lists through the lists dictionary', async () => {
      const result = await service.getListsDictionary({ criteria: { boardId } })

      expect(result.items.some(item => item.value === listId)).toBe(true)
    })

    it('creates a card', async () => {
      const result = await service.createCard(boardId, listId, swimlaneId, 'E2E Card', 'Created by the e2e suite')

      expect(result).toHaveProperty('_id')

      cardId = result._id
    })

    it('lists the cards in the list', async () => {
      const result = await service.getCardsInList(boardId, listId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.some(item => item._id === cardId)).toBe(true)
    })

    it('reads a single card', async () => {
      const result = await service.getCard(boardId, listId, cardId)

      expect(result).toHaveProperty('_id', cardId)
    })

    it('lists the cards by swimlane', async () => {
      const result = await service.getCardsBySwimlane(boardId, swimlaneId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('counts the cards on the board', async () => {
      const result = await service.getBoardCardsCount(boardId)

      expect(result).toHaveProperty('board_cards_count')
    })

    it('edits the card title, description and due date', async () => {
      const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      const result = await service.editCard(
        boardId,
        listId,
        cardId,
        'E2E Card (updated)',
        'Updated by the e2e suite',
        undefined,
        dueAt
      )

      expect(result).toBeDefined()
    })

    it('moves the card to another list', async () => {
      const created = await service.createList(boardId, 'E2E Doing')

      secondListId = created._id

      const result = await service.editCard(boardId, listId, cardId, undefined, undefined, secondListId)

      expect(result).toBeDefined()
    })

    it('creates and lists a checklist on the card', async () => {
      const created = await service.createChecklist(boardId, cardId, 'E2E Checklist')

      expect(created).toHaveProperty('_id')

      const checklists = await service.getCardChecklists(boardId, cardId)

      expect(Array.isArray(checklists)).toBe(true)
    })

    it('deletes the card', async () => {
      const result = await service.deleteCard(boardId, secondListId || listId, cardId)

      expect(result).toMatchObject({ boardId, cardId, deleted: true })
    })

    it('deletes the lists', async () => {
      const result = await service.deleteList(boardId, listId)

      expect(result).toMatchObject({ boardId, listId, deleted: true })

      if (secondListId) {
        await service.deleteList(boardId, secondListId)
      }
    })

    it('deletes the board', async () => {
      const result = await service.deleteBoard(boardId)

      expect(result).toEqual({ boardId, deleted: true })

      boardId = undefined
    })
  })

  // ── Validation ──

  describe('editCard validation', () => {
    it('rejects an update with no fields to change', async () => {
      await expect(service.editCard('board', 'list', 'card')).rejects.toThrow(
        'Nothing to update: provide at least one field to change on the card.'
      )
    })
  })
})
