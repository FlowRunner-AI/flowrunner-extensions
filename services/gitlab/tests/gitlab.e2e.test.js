'use strict'

const { createE2ESandbox } = require('../../../service-sandbox')

describe('GitLab Service (e2e)', () => {
  let sandbox
  let service
  let testValues
  let project
  let defaultBranch

  beforeAll(() => {
    sandbox = createE2ESandbox('gitlab')
    require('../src/index.js')

    try {
      sandbox.validateConfigs()
    } catch (error) {
      console.log(error)
      process.exit(1)
    }

    service = sandbox.getService()
    testValues = sandbox.getTestValues()
    project = testValues.project

    if (!project) {
      console.log('Missing testValues.project in e2e-config.json for gitlab (a project ID or "group/project" path)')
      process.exit(1)
    }

    // Falls back to "main"; override with testValues.defaultBranch for repos using a different default.
    defaultBranch = testValues.defaultBranch || 'main'
  })

  afterAll(() => {
    sandbox.cleanup()
  })

  // A unique-ish suffix so repeated e2e runs don't collide on branch/tag names.
  const suffix = Date.now()

  // ── Projects ──

  describe('listProjects', () => {
    it('returns projects with expected shape', async () => {
      const result = await service.listProjects(undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('path_with_namespace')
      }
    })
  })

  describe('getProject', () => {
    it('returns the configured project with expected shape', async () => {
      const result = await service.getProject(project)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('path_with_namespace')
      expect(result).toHaveProperty('default_branch')
    })
  })

  // ── Dictionaries ──

  describe('getProjectsDictionary', () => {
    it('returns dictionary items array', async () => {
      const result = await service.getProjectsDictionary({})

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
      if (result.items.length) {
        expect(result.items[0]).toHaveProperty('label')
        expect(result.items[0]).toHaveProperty('value')
      }
    })
  })

  describe('getBranchesDictionary', () => {
    it('returns dictionary items array for the project', async () => {
      const result = await service.getBranchesDictionary({ criteria: { project } })

      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    })
  })

  // ── Repository (read) ──

  describe('listBranches', () => {
    it('returns branches with expected shape', async () => {
      const result = await service.listBranches(project, undefined, 1, 10)

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('name')
        expect(result[0]).toHaveProperty('commit')
      }
    })
  })

  describe('listCommits', () => {
    it('returns commits with expected shape', async () => {
      const result = await service.listCommits(project, defaultBranch, 1, 5)

      expect(Array.isArray(result)).toBe(true)
      if (result.length) {
        expect(result[0]).toHaveProperty('id')
        expect(result[0]).toHaveProperty('title')
      }
    })
  })

  // ── Repository (write): branch + file lifecycle ──

  describe('createBranch + saveFile + getFile + createCommit + deleteBranch', () => {
    const branchName = `e2e-branch-${ suffix }`
    const filePath = `e2e-tests/e2e-file-${ suffix }.txt`
    let branchCreated = false

    it('creates a branch from the default branch', async () => {
      const result = await service.createBranch(project, branchName, defaultBranch)

      expect(result).toHaveProperty('name', branchName)
      branchCreated = true
    })

    it('creates a file on the new branch (POST path)', async () => {
      const result = await service.saveFile(
        project,
        filePath,
        branchName,
        'initial content',
        `e2e: add file ${ suffix }`
      )

      expect(result).toHaveProperty('file_path', filePath)
      expect(result).toHaveProperty('branch', branchName)
    })

    it('reads the created file with decoded content', async () => {
      const result = await service.getFile(project, filePath, branchName)

      expect(result).toHaveProperty('file_path', filePath)
      expect(result).toHaveProperty('content', 'initial content')
      expect(result).toHaveProperty('raw', true)
    })

    it('updates the existing file (PUT path)', async () => {
      const result = await service.saveFile(
        project,
        filePath,
        branchName,
        'updated content',
        `e2e: update file ${ suffix }`
      )

      expect(result).toHaveProperty('file_path', filePath)
    })

    it('creates a multi-file commit on the branch', async () => {
      const result = await service.createCommit(project, branchName, `e2e: multi-file commit ${ suffix }`, [
        { action: 'create', file_path: `e2e-tests/extra-${ suffix }.txt`, content: 'extra' },
        { action: 'delete', file_path: filePath },
      ])

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title')
    })

    afterAll(async () => {
      if (branchCreated) {
        try {
          await service.deleteBranch(project, branchName)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Issues ──

  describe('createIssue + getIssue + listIssues + updateIssue + createIssueNote', () => {
    let issueIid

    it('creates an issue', async () => {
      const result = await service.createIssue(project, `E2E Issue ${ suffix }`, 'Created by an automated e2e test.')

      expect(result).toHaveProperty('iid')
      issueIid = result.iid
    })

    it('retrieves the created issue', async () => {
      const result = await service.getIssue(project, issueIid)

      expect(result).toHaveProperty('iid', issueIid)
      expect(result).toHaveProperty('title', `E2E Issue ${ suffix }`)
    })

    it('lists issues with expected shape', async () => {
      const result = await service.listIssues(project, 'Opened', undefined, undefined, undefined, 1, 10)

      expect(Array.isArray(result)).toBe(true)
    })

    it('adds a note to the issue', async () => {
      const result = await service.createIssueNote(project, issueIid, 'E2E automated note.')

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('body', 'E2E automated note.')
    })

    it('closes the issue via update', async () => {
      const result = await service.updateIssue(
        project,
        issueIid,
        undefined,
        undefined,
        'Close'
      )

      expect(result).toHaveProperty('iid', issueIid)
      expect(result).toHaveProperty('state', 'closed')
    })
  })

  // ── Merge Requests ──

  describe('createMergeRequest + getMergeRequest + listMergeRequests + updateMergeRequest', () => {
    const mrBranch = `e2e-mr-branch-${ suffix }`
    let mrIid
    let mrBranchCreated = false

    it('creates a source branch with a change for the MR', async () => {
      await service.createBranch(project, mrBranch, defaultBranch)
      mrBranchCreated = true

      const result = await service.saveFile(
        project,
        `e2e-tests/mr-file-${ suffix }.txt`,
        mrBranch,
        'mr change',
        `e2e: mr change ${ suffix }`
      )

      expect(result).toHaveProperty('file_path')
    })

    it('creates a merge request', async () => {
      const result = await service.createMergeRequest(
        project,
        mrBranch,
        defaultBranch,
        `E2E MR ${ suffix }`,
        'Created by an automated e2e test.'
      )

      expect(result).toHaveProperty('iid')
      expect(result).toHaveProperty('source_branch', mrBranch)
      mrIid = result.iid
    })

    it('retrieves the created merge request', async () => {
      const result = await service.getMergeRequest(project, mrIid)

      expect(result).toHaveProperty('iid', mrIid)
    })

    it('lists merge requests with expected shape', async () => {
      const result = await service.listMergeRequests(project, 'Opened', undefined, 1, 10)

      expect(Array.isArray(result)).toBe(true)
    })

    it('adds a note to the merge request', async () => {
      const result = await service.addMergeRequestNote(project, mrIid, 'E2E automated MR note.')

      expect(result).toHaveProperty('id')
    })

    it('closes the merge request via update', async () => {
      const result = await service.updateMergeRequest(project, mrIid, undefined, undefined, undefined, 'Close')

      expect(result).toHaveProperty('iid', mrIid)
      expect(result).toHaveProperty('state', 'closed')
    })

    afterAll(async () => {
      if (mrBranchCreated) {
        try {
          await service.deleteBranch(project, mrBranch)
        } catch (e) {
          // ignore cleanup errors
        }
      }
    })
  })

  // ── Pipelines ──

  describe('listPipelines', () => {
    it('returns pipelines with expected shape', async () => {
      const result = await service.listPipelines(project, undefined, undefined, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('triggerPipeline (optional)', () => {
    // Triggering a pipeline requires a .gitlab-ci.yml in the repo and consumes CI
    // minutes, so this only runs when the developer opts in via testValues.runPipeline.
    it('triggers a pipeline on the default branch when enabled', async () => {
      if (!testValues.runPipeline) {
        console.log('Skipping triggerPipeline: set testValues.runPipeline=true (requires .gitlab-ci.yml)')
        return
      }

      const result = await service.triggerPipeline(project, defaultBranch)

      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('status')
    })
  })

  // ── Releases ──

  describe('listReleases', () => {
    it('returns releases with expected shape', async () => {
      const result = await service.listReleases(project, 1, 5)

      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('createRelease (optional)', () => {
    // Creating a release makes a permanent tag, so this only runs when the
    // developer opts in via testValues.createRelease.
    it('creates a release from the default branch when enabled', async () => {
      if (!testValues.createRelease) {
        console.log('Skipping createRelease: set testValues.createRelease=true')
        return
      }

      const tagName = `e2e-v${ suffix }`
      const result = await service.createRelease(
        project,
        tagName,
        `E2E Release ${ suffix }`,
        'Created by an automated e2e test.',
        defaultBranch
      )

      expect(result).toHaveProperty('tag_name', tagName)
    })
  })
})
