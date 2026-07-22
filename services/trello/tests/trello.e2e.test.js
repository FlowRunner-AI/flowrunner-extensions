'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Trello Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('trello')
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

  // ── Dictionaries ──

  describe('getBoardsDictionary', () => {
    it('returns boards with expected shape', async () => {
      const result = await service.getBoardsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      if (result.items.length > 0) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
        expect(result.items[0]).toHaveProperty('note')
      }
    })

    it('filters boards by search', async () => {
      const all = await service.getBoardsDictionary({})

      if (all.items.length > 0) {
        const searchTerm = all.items[0].label.substring(0, 3)
        const filtered = await service.getBoardsDictionary({ search: searchTerm })

        expect(Array.isArray(filtered.items)).toBe(true)
      }
    })
  })

  describe('getOrganizationsDictionary', () => {
    it('returns organizations with expected shape', async () => {
      const result = await service.getOrganizationsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Board Management ──

  describe('board operations', () => {
    it('gets a board by ID', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardById: testValues.boardId not set')
        return
      }

      const result = await service.getBoardById(boardId)

      expect(result).toHaveProperty('id', boardId)
      expect(result).toHaveProperty('name')
    })

    it('gets board lists', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardLists: testValues.boardId not set')
        return
      }

      const result = await service.getBoardLists(boardId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets board members', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardMembers: testValues.boardId not set')
        return
      }

      const result = await service.getBoardMembers(boardId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets board labels', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardLabels: testValues.boardId not set')
        return
      }

      const result = await service.getBoardLabels(boardId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets board actions', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardActions: testValues.boardId not set')
        return
      }

      const result = await service.getBoardActions(boardId, undefined, undefined, undefined, undefined, 5)

      expect(Array.isArray(result)).toBe(true)
    })

    it('gets board power-ups', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardPowerUps: testValues.boardId not set')
        return
      }

      const result = await service.getBoardPowerUps(boardId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── List Operations ──

  describe('list operations', () => {
    it('gets list by ID', async () => {
      const { boardId, listId } = testValues

      if (!boardId || !listId) {
        console.log('Skipping getListById: testValues.boardId or testValues.listId not set')
        return
      }

      const result = await service.getListById(boardId, listId)

      expect(result).toHaveProperty('id', listId)
    })

    it('gets list cards', async () => {
      const { boardId, listId } = testValues

      if (!boardId || !listId) {
        console.log('Skipping getListCards: testValues.boardId or testValues.listId not set')
        return
      }

      const result = await service.getListCards(boardId, listId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Card CRUD Lifecycle ──

  describe('card lifecycle', () => {
    let createdCardId

    it('creates a card', async () => {
      const { boardId, listId } = testValues

      if (!boardId || !listId) {
        console.log('Skipping createCard: testValues.boardId or testValues.listId not set')
        return
      }

      const result = await service.createCard(boardId, listId, 'E2E Test Card', 'Created by e2e test')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Card')
      createdCardId = result.id
    })

    it('gets the created card by ID', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping getCardById: no createdCardId or missing testValues')
        return
      }

      const result = await service.getCardById(boardId, listId, createdCardId)

      expect(result).toHaveProperty('id', createdCardId)
      expect(result).toHaveProperty('name', 'E2E Test Card')
    })

    it('updates the created card', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping updateCard: no createdCardId or missing testValues')
        return
      }

      const result = await service.updateCard(boardId, listId, createdCardId, 'E2E Updated Card')

      expect(result).toHaveProperty('name', 'E2E Updated Card')
    })

    it('adds a comment to the card', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping addComment: no createdCardId or missing testValues')
        return
      }

      const result = await service.addComment(boardId, listId, createdCardId, 'E2E test comment')

      expect(result).toHaveProperty('type', 'commentCard')
    })

    it('gets card actions', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping getCardActions: no createdCardId or missing testValues')
        return
      }

      const result = await service.getCardActions(boardId, listId, createdCardId)

      expect(Array.isArray(result)).toBe(true)
    })

    it('archives the card', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping archiveCard: no createdCardId or missing testValues')
        return
      }

      const result = await service.archiveCard(boardId, listId, createdCardId)

      expect(result).toHaveProperty('closed', true)
    })

    it('unarchives the card', async () => {
      const { boardId } = testValues

      if (!createdCardId || !boardId) {
        console.log('Skipping unarchiveCard: no createdCardId or missing testValues')
        return
      }

      const result = await service.unarchiveCard(boardId, createdCardId)

      expect(result).toHaveProperty('closed', false)
    })

    it('deletes the card', async () => {
      const { boardId, listId } = testValues

      if (!createdCardId || !boardId || !listId) {
        console.log('Skipping deleteCard: no createdCardId or missing testValues')
        return
      }

      await expect(service.deleteCard(boardId, listId, createdCardId)).resolves.toBeDefined()
    })
  })

  // ── Label Lifecycle ──

  describe('label lifecycle', () => {
    let createdLabelId

    it('creates a board label', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping createBoardLabel: testValues.boardId not set')
        return
      }

      const result = await service.createBoardLabel(boardId, 'E2E Test Label', 'green')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Test Label')
      createdLabelId = result.id
    })

    it('updates the label', async () => {
      const { boardId } = testValues

      if (!createdLabelId || !boardId) {
        console.log('Skipping updateBoardLabel: no createdLabelId or missing testValues')
        return
      }

      const result = await service.updateBoardLabel(boardId, createdLabelId, 'E2E Updated Label', 'blue')

      expect(result).toHaveProperty('name', 'E2E Updated Label')
    })

    it('deletes the label', async () => {
      const { boardId } = testValues

      if (!createdLabelId || !boardId) {
        console.log('Skipping deleteBoardLabel: no createdLabelId or missing testValues')
        return
      }

      await expect(service.deleteBoardLabel(boardId, createdLabelId)).resolves.toBeDefined()
    })
  })

  // ── Checklist Lifecycle ──

  describe('checklist lifecycle', () => {
    let tempCardId
    let createdChecklistId
    let createdCheckItemId

    it('creates a temp card for checklist tests', async () => {
      const { boardId, listId } = testValues

      if (!boardId || !listId) {
        console.log('Skipping: testValues.boardId or testValues.listId not set')
        return
      }

      const result = await service.createCard(boardId, listId, 'E2E Checklist Test Card')

      tempCardId = result.id
    })

    it('adds a checklist to the card', async () => {
      const { boardId, listId } = testValues

      if (!tempCardId || !boardId || !listId) {
        console.log('Skipping addChecklistToCard: missing IDs')
        return
      }

      const result = await service.addChecklistToCard(undefined, boardId, listId, tempCardId, 'E2E Checklist')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Checklist')
      createdChecklistId = result.id
    })

    it('gets card checklists', async () => {
      const { boardId, listId } = testValues

      if (!tempCardId || !boardId || !listId) {
        console.log('Skipping getCardChecklists: missing IDs')
        return
      }

      const result = await service.getCardChecklists(boardId, listId, tempCardId)

      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('adds a check item', async () => {
      const { boardId, listId } = testValues

      if (!createdChecklistId || !tempCardId || !boardId || !listId) {
        console.log('Skipping addChecklistItem: missing IDs')
        return
      }

      const result = await service.addChecklistItem(boardId, listId, tempCardId, createdChecklistId, 'E2E Check Item')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name', 'E2E Check Item')
      createdCheckItemId = result.id
    })

    it('completes the check item', async () => {
      const { boardId, listId } = testValues

      if (!createdCheckItemId || !tempCardId || !boardId || !listId) {
        console.log('Skipping completeCheckItem: missing IDs')
        return
      }

      const result = await service.completeCheckItem(boardId, listId, tempCardId, createdCheckItemId)

      expect(result).toHaveProperty('state', 'complete')
    })

    it('deletes the checklist', async () => {
      const { boardId, listId } = testValues

      if (!createdChecklistId || !tempCardId || !boardId || !listId) {
        console.log('Skipping deleteCardChecklist: missing IDs')
        return
      }

      await expect(
        service.deleteCardChecklist(boardId, listId, tempCardId, createdChecklistId)
      ).resolves.toBeDefined()
    })

    it('cleans up temp card', async () => {
      const { boardId, listId } = testValues

      if (!tempCardId || !boardId || !listId) {
        return
      }

      await service.deleteCard(boardId, listId, tempCardId)
    })
  })

  // ── Organization Management ──

  describe('organization operations', () => {
    it('gets an organization by ID', async () => {
      const { organizationId } = testValues

      if (!organizationId) {
        console.log('Skipping getOrganizationById: testValues.organizationId not set')
        return
      }

      const result = await service.getOrganizationById(organizationId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('name')
    })

    it('gets organization boards', async () => {
      const { organizationId } = testValues

      if (!organizationId) {
        console.log('Skipping getOrganizationBoards: testValues.organizationId not set')
        return
      }

      const result = await service.getOrganizationBoards(organizationId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Member Management ──

  describe('member operations', () => {
    it('gets a member by ID', async () => {
      const { boardId, memberId } = testValues

      if (!boardId || !memberId) {
        console.log('Skipping getMemberById: testValues.boardId or testValues.memberId not set')
        return
      }

      const result = await service.getMemberById(boardId, memberId)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('username')
    })

    it('gets member cards', async () => {
      const { organizationId, memberId } = testValues

      if (!organizationId || !memberId) {
        console.log('Skipping getMemberCards: testValues.organizationId or testValues.memberId not set')
        return
      }

      const result = await service.getMemberCards(organizationId, memberId)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  // ── Board Lists Dictionary (with board dependency) ──

  describe('getBoardListsDictionary', () => {
    it('returns lists for a board', async () => {
      const { boardId } = testValues

      if (!boardId) {
        console.log('Skipping getBoardListsDictionary: testValues.boardId not set')
        return
      }

      const result = await service.getBoardListsDictionary({ criteria: { idBoard: boardId } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })
})
