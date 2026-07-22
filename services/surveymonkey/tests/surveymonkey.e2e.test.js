'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

const SUFFIX = Date.now()

describe('SurveyMonkey Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('surveymonkey')
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

  describe('getMe', () => {
    it('returns the authenticated account profile', async () => {
      const result = await service.getMe()

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('username')
    })
  })

  // ── Surveys ──

  describe('listSurveys', () => {
    it('returns a paginated envelope of surveys', async () => {
      const result = await service.listSurveys(1, 5)

      expect(result).toHaveProperty('data')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result).toHaveProperty('page')
      expect(result).toHaveProperty('per_page')
    })

    it('accepts sorting options', async () => {
      const result = await service.listSurveys(1, 5, undefined, 'Title', 'Ascending')

      expect(Array.isArray(result.data)).toBe(true)
    })
  })

  // ── Survey lifecycle (create → read → collectors → delete) ──

  describe('survey lifecycle', () => {
    let surveyId
    let pageId
    let collectorId

    it('creates a survey', async () => {
      const result = await service.createSurvey(`FlowRunner E2E ${ SUFFIX }`, undefined, undefined, 'e2e')

      expect(result).toHaveProperty('id')
      surveyId = result.id
    })

    it('gets the created survey', async () => {
      if (!surveyId) {
        console.log('Skipping getSurvey: survey was not created')

        return
      }

      const result = await service.getSurvey(surveyId)

      expect(result).toHaveProperty('id', surveyId)
      expect(result).toHaveProperty('title')
    })

    it('gets the full survey details', async () => {
      if (!surveyId) {
        console.log('Skipping getSurveyDetails: survey was not created')

        return
      }

      const result = await service.getSurveyDetails(surveyId)

      expect(result).toHaveProperty('id', surveyId)
      expect(Array.isArray(result.pages)).toBe(true)
    })

    it('lists the survey pages', async () => {
      if (!surveyId) {
        console.log('Skipping listSurveyPages: survey was not created')

        return
      }

      const result = await service.listSurveyPages(surveyId, 1, 10)

      expect(Array.isArray(result.data)).toBe(true)
      pageId = result.data[0] && result.data[0].id
    })

    it('gets a single page and its questions', async () => {
      if (!surveyId || !pageId) {
        console.log('Skipping getPage/listPageQuestions: no page available')

        return
      }

      const page = await service.getPage(surveyId, pageId)

      expect(page).toHaveProperty('id', pageId)

      const questions = await service.listPageQuestions(surveyId, pageId, 1, 10)

      expect(Array.isArray(questions.data)).toBe(true)
    })

    it('creates a web link collector', async () => {
      if (!surveyId) {
        console.log('Skipping createCollector: survey was not created')

        return
      }

      const result = await service.createCollector(surveyId, 'Web Link', `E2E Link ${ SUFFIX }`)

      expect(result).toHaveProperty('id')
      collectorId = result.id
    })

    it('lists the survey collectors', async () => {
      if (!surveyId) {
        console.log('Skipping listCollectors: survey was not created')

        return
      }

      const result = await service.listCollectors(surveyId, 1, 10)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('gets the created collector and its responses', async () => {
      if (!collectorId) {
        console.log('Skipping getCollector: collector was not created')

        return
      }

      const collector = await service.getCollector(collectorId)

      expect(collector).toHaveProperty('id', collectorId)

      const responses = await service.getCollectorResponses(collectorId, 1, 5)

      expect(Array.isArray(responses.data)).toBe(true)
    })

    it('lists the survey responses', async () => {
      if (!surveyId) {
        console.log('Skipping listSurveyResponses: survey was not created')

        return
      }

      const result = await service.listSurveyResponses(surveyId, 1, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('lists all responses in bulk', async () => {
      if (!surveyId) {
        console.log('Skipping listAllResponsesBulk: survey was not created')

        return
      }

      const result = await service.listAllResponsesBulk(surveyId, 1, 5)

      expect(Array.isArray(result.data)).toBe(true)
    })

    it('deletes the created survey', async () => {
      if (!surveyId) {
        console.log('Skipping deleteSurvey: survey was not created')

        return
      }

      const result = await service.deleteSurvey(surveyId)

      expect(result).toHaveProperty('id', surveyId)
    })
  })

  // ── Responses on an existing survey (requires testValues) ──

  describe('getResponseDetails', () => {
    it('returns a response with a readable mapping', async () => {
      const { surveyId, responseId } = testValues

      if (!surveyId || !responseId) {
        console.log('Skipping getResponseDetails: testValues.surveyId or testValues.responseId not set')

        return
      }

      const result = await service.getResponseDetails(surveyId, responseId, true)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('mapping_note')
      expect(result).toHaveProperty('mapped_answers')
    })
  })

  // ── Dictionaries ──

  describe('getSurveysDictionary', () => {
    it('returns dictionary items for surveys', async () => {
      const result = await service.getSurveysDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)

      result.items.forEach(item => {
        expect(item).toHaveProperty('label')
        expect(item).toHaveProperty('value')
      })
    })

    it('accepts a search term', async () => {
      const result = await service.getSurveysDictionary({ search: 'zzz-unlikely-title' })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('getCollectorsDictionary', () => {
    it('returns an empty list without a survey id in criteria', async () => {
      const result = await service.getCollectorsDictionary({})

      expect(result.items).toEqual([])
    })

    it('returns collectors for a survey from testValues', async () => {
      const { surveyId } = testValues

      if (!surveyId) {
        console.log('Skipping getCollectorsDictionary: testValues.surveyId not set')

        return
      }

      const result = await service.getCollectorsDictionary({ criteria: { survey_id: surveyId } })

      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Errors ──

  describe('error handling', () => {
    it('throws a wrapped error for an unknown survey', async () => {
      await expect(service.getSurvey('000000000')).rejects.toThrow(/SurveyMonkey API error/)
    })
  })
})
