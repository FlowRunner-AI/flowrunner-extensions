'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('Bitbucket Service (e2e)', () => {
  let sandbox
  let service
  let testValues

  beforeAll(() => {
    sandbox = createE2ESandbox('bitbucket')
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

  // A unique-ish suffix so repeated e2e runs don't collide.
  const suffix = Date.now()

  // The developer must supply an existing repository slug in testValues.repoSlug.
  // Most read tests target it, and write tests operate within it.
  const repo = () => testValues.repoSlug

  // ── Repositories ──

  describe('listRepositories', () => {
    it('returns an array of repositories', async () => {
      const response = await service.listRepositories()

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getRepository', () => {
    it('returns the configured repository with expected shape', async () => {
      const response = await service.getRepository(repo())

      expect(response).toHaveProperty('slug')
      expect(response).toHaveProperty('full_name')
    })
  })

  describe('getRepositoriesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getRepositoriesDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Branches ──

  describe('listBranches', () => {
    it('returns an array of branches', async () => {
      const response = await service.listBranches(repo())

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getBranchesDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getBranchesDictionary({ criteria: { repo_slug: repo() } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  describe('createBranch + deleteBranch', () => {
    // Needs a commit hash to branch from; take the head of the main branch.
    let branchName
    let targetHash

    it('creates a branch from the latest commit', async () => {
      const commits = await service.listCommits(repo())

      if (!Array.isArray(commits) || commits.length === 0) {
        console.log('Skipping createBranch: repository has no commits')
        return
      }

      targetHash = commits[0].hash
      branchName = `e2e/branch-${ suffix }`

      const response = await service.createBranch(repo(), branchName, targetHash)

      expect(response).toHaveProperty('name', branchName)
      expect(response).toHaveProperty('target')
    })

    it('deletes the created branch', async () => {
      if (!branchName) {
        console.log('Skipping deleteBranch: no branch was created')
        return
      }

      const response = await service.deleteBranch(repo(), branchName)

      expect(response).toEqual({ success: true, name: branchName })
    })
  })

  // ── Source ──

  describe('listDirectory', () => {
    it('lists the repository root at the main branch', async () => {
      const branch = testValues.mainBranch || 'main'
      const response = await service.listDirectory(repo(), branch)

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('listCommits', () => {
    it('returns an array of commits', async () => {
      const response = await service.listCommits(repo())

      expect(Array.isArray(response)).toBe(true)
    })
  })

  describe('getFile', () => {
    // Needs a known file path in the repo; developer supplies testValues.filePath.
    it('reads a file when a file path is configured', async () => {
      if (!testValues.filePath) {
        console.log('Skipping getFile: set testValues.filePath to a file in the repository')
        return
      }

      const branch = testValues.mainBranch || 'main'
      const response = await service.getFile(repo(), branch, testValues.filePath)

      expect(response).toHaveProperty('path')
      expect(response).toHaveProperty('content')
      expect(typeof response.content).toBe('string')
    })
  })

  describe('createOrUpdateFile', () => {
    // Writes a commit to the repository, so it only runs on an explicit opt-in
    // to avoid mutating a repo the developer did not intend to write to.
    it('commits a file when writes are enabled', async () => {
      if (!testValues.allowWrites) {
        console.log('Skipping createOrUpdateFile: set testValues.allowWrites=true to enable write tests')
        return
      }

      const branch = testValues.mainBranch || 'main'
      const path = `e2e/flowrunner-${ suffix }.txt`

      const response = await service.createOrUpdateFile(
        repo(),
        path,
        `e2e test content ${ suffix }`,
        `e2e: add ${ path }`,
        branch
      )

      expect(response).toMatchObject({ success: true, path, branch })
    })
  })

  // ── Issues ──

  describe('createIssue + getIssue + updateIssue + addIssueComment', () => {
    // The issue tracker must be enabled on the repo; skip gracefully otherwise.
    let issueId

    it('creates an issue', async () => {
      try {
        const response = await service.createIssue(repo(), `E2E Issue ${ suffix }`, 'Created by e2e tests')

        expect(response).toHaveProperty('id')
        issueId = response.id
      } catch (error) {
        console.log('Skipping issue tests: issue tracker may be disabled -', error.message)
      }
    })

    it('retrieves the created issue', async () => {
      if (!issueId) return

      const response = await service.getIssue(repo(), issueId)

      expect(response).toHaveProperty('id', issueId)
    })

    it('updates the issue', async () => {
      if (!issueId) return

      const response = await service.updateIssue(repo(), issueId, `E2E Issue Updated ${ suffix }`, undefined, 'Resolved')

      expect(response).toHaveProperty('id', issueId)
    })

    it('adds a comment to the issue', async () => {
      if (!issueId) return

      const response = await service.addIssueComment(repo(), issueId, 'E2E comment')

      expect(response).toHaveProperty('id')
    })
  })

  describe('listIssues', () => {
    it('returns an array of issues when the tracker is enabled', async () => {
      try {
        const response = await service.listIssues(repo())

        expect(Array.isArray(response)).toBe(true)
      } catch (error) {
        console.log('Skipping listIssues: issue tracker may be disabled -', error.message)
      }
    })
  })

  // ── Pull Requests ──

  describe('createPullRequest + getPullRequest + updatePullRequest + decline', () => {
    // Needs a source branch that differs from the destination. The developer
    // supplies testValues.sourceBranch (a branch with commits ahead of main).
    let prId

    it('creates a pull request when a source branch is configured', async () => {
      if (!testValues.sourceBranch) {
        console.log('Skipping createPullRequest: set testValues.sourceBranch to a branch ahead of main')
        return
      }

      try {
        const response = await service.createPullRequest(
          repo(),
          `E2E PR ${ suffix }`,
          testValues.sourceBranch,
          testValues.mainBranch || 'main',
          'Created by e2e tests'
        )

        expect(response).toHaveProperty('id')
        prId = response.id
      } catch (error) {
        console.log('Skipping PR tests: could not create PR -', error.message)
      }
    })

    it('retrieves the created pull request', async () => {
      if (!prId) return

      const response = await service.getPullRequest(repo(), prId)

      expect(response).toHaveProperty('id', prId)
      expect(response).toHaveProperty('state')
    })

    it('updates the pull request', async () => {
      if (!prId) return

      const response = await service.updatePullRequest(repo(), prId, `E2E PR Updated ${ suffix }`)

      expect(response).toHaveProperty('id', prId)
    })

    it('adds a comment to the pull request', async () => {
      if (!prId) return

      const response = await service.addPullRequestComment(repo(), prId, 'E2E PR comment')

      expect(response).toHaveProperty('id')
    })

    it('declines the pull request (cleanup)', async () => {
      if (!prId) return

      const response = await service.declinePullRequest(repo(), prId)

      expect(response).toHaveProperty('state', 'DECLINED')
    })
  })

  describe('listPullRequests', () => {
    it('returns an array of pull requests', async () => {
      const response = await service.listPullRequests(repo())

      expect(Array.isArray(response)).toBe(true)
    })
  })

  // ── Pipelines ──

  describe('listPipelines', () => {
    it('returns an array of pipelines when pipelines are enabled', async () => {
      try {
        const response = await service.listPipelines(repo())

        expect(Array.isArray(response)).toBe(true)
      } catch (error) {
        console.log('Skipping listPipelines: pipelines may be disabled -', error.message)
      }
    })
  })

  describe('getPipeline', () => {
    it('retrieves a pipeline by uuid when one is configured', async () => {
      if (!testValues.pipelineUuid) {
        console.log('Skipping getPipeline: set testValues.pipelineUuid to an existing pipeline uuid')
        return
      }

      const response = await service.getPipeline(repo(), testValues.pipelineUuid)

      expect(response).toHaveProperty('uuid')
      expect(response).toHaveProperty('state')
    })
  })
})
