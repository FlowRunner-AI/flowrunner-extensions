const logger = {
  info: (...args) => console.log('[Jira Issues Service] info:', ...args),
  debug: (...args) => console.log('[Jira Issues Service] debug:', ...args),
  error: (...args) => console.log('[Jira Issues Service] error:', ...args),
  warn: (...args) => console.log('[Jira Issues Service] warn:', ...args),
}

const API_BASE_URL_SUFFIX = '/rest/api/3'

/**
 * @integrationName Jira Issues
 * @integrationIcon /icon.png
 **/
class JiraIssues {
  constructor(config) {
    this.siteUrl = config.siteUrl
    this.email = config.email
    this.apiToken = config.apiToken
    this.baseUrl = this.siteUrl + API_BASE_URL_SUFFIX
  }

  async #apiRequest({ url, method, body, query, logTag }) {
    method = method || 'get'

    try {
      logger.debug(`${ logTag } - api request: [${ method }::${ url }] q=[${ JSON.stringify(query) }]`)

      const authString = Buffer.from(`${ this.email }:${ this.apiToken }`).toString('base64')
      const request = Flowrunner.Request[method](url)
        .set({
          'Authorization': `Basic ${ authString }`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        })

      if (query) {
        request.query(query)
      }

      if (body) {
        return await request.send(body)
      }

      return await request
    } catch (error) {
      logger.error(`[${ logTag }] Error: ${ JSON.stringify(error.message) }`)
      throw error
    }
  }

  /**
   * @operationName Create Issue
   * @category Issues
   * @description Creates a new issue in a Jira project. Supports standard fields like summary, description, issue type, priority, and assignee. Custom fields can also be included in the fields object.
   * @route POST /create-issue
   *
   * @paramDef {"type":"String","label":"Project Key","name":"projectKey","required":true,"dictionary":"getProjectsDictionary","description":"The key of the project where the issue will be created (e.g., 'PROJ')."}
   * @paramDef {"type":"String","label":"Issue Type","name":"issueType","required":true,"dictionary":"getIssueTypesDictionary","dependsOn":["projectKey"],"description":"The type of issue to create (e.g., 'Task', 'Bug', 'Story')."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","required":true,"description":"A brief summary of the issue (required)."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Detailed description of the issue in plain text or Atlassian Document Format."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","dictionary":"getPrioritiesDictionary","description":"The priority level for the issue (e.g., 'High', 'Medium', 'Low')."}
   * @paramDef {"type":"String","label":"Assignee Account ID","name":"assigneeAccountId","description":"The account ID of the user to assign the issue to. Leave empty for automatic assignment."}
   * @paramDef {"type":"String","label":"Reporter Account ID","name":"reporterAccountId","description":"The account ID of the user who is reporting the issue. Defaults to the authenticated user."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"An array of labels to add to the issue."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Additional custom fields to include in the issue creation as key-value pairs."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10000","key":"PROJ-123","self":"https://your-domain.atlassian.net/rest/api/3/issue/10000"}
   */
  async createIssue(projectKey, issueType, summary, description, priority, assigneeAccountId, reporterAccountId, labels, additionalFields) {
    const fields = {
      project: { key: projectKey },
      issuetype: { name: issueType },
      summary,
      ...(description && { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } }),
      ...(priority && { priority: { name: priority } }),
      ...(assigneeAccountId && { assignee: { accountId: assigneeAccountId } }),
      ...(reporterAccountId && { reporter: { accountId: reporterAccountId } }),
      ...(labels && labels.length > 0 && { labels }),
      ...(additionalFields || {}),
    }

    const response = await this.#apiRequest({
      logTag: 'createIssue',
      url: `${ this.baseUrl }/issue`,
      method: 'post',
      body: { fields },
    })

    return response
  }

  /**
   * @operationName Get Issue
   * @category Issues
   * @description Retrieves detailed information about a specific Jira issue by its ID or key. Returns all issue fields including status, assignee, reporter, comments, and custom fields.
   * @route POST /get-issue
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to retrieve (e.g., 'PROJ-123' or '10000')."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of fields to return. Leave empty to return all fields."}
   * @paramDef {"type":"String","label":"Expand","name":"expand","description":"Comma-separated list of properties to expand (e.g., 'renderedFields,changelog')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10000","key":"PROJ-123","self":"https://your-domain.atlassian.net/rest/api/3/issue/10000","fields":{"summary":"Issue summary","status":{"name":"To Do"},"assignee":{"accountId":"123","displayName":"John Doe"}}}
   */
  async getIssue(issueIdOrKey, fields, expand) {
    const query = {}
    if (fields) query.fields = fields
    if (expand) query.expand = expand

    const response = await this.#apiRequest({
      logTag: 'getIssue',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }`,
      query,
    })

    return response
  }

  /**
   * @operationName Update Issue
   * @category Issues
   * @description Updates fields of an existing Jira issue. Can update summary, description, status, assignee, priority, labels, and custom fields. Only specified fields will be updated.
   * @route POST /update-issue
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to update (e.g., 'PROJ-123' or '10000')."}
   * @paramDef {"type":"String","label":"Summary","name":"summary","description":"Updated summary for the issue."}
   * @paramDef {"type":"String","label":"Description","name":"description","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Updated description for the issue."}
   * @paramDef {"type":"String","label":"Priority","name":"priority","dictionary":"getPrioritiesDictionary","description":"Updated priority level for the issue."}
   * @paramDef {"type":"String","label":"Assignee Account ID","name":"assigneeAccountId","description":"Account ID of the new assignee. Use 'null' string to unassign."}
   * @paramDef {"type":"Array<String>","label":"Labels","name":"labels","description":"Updated array of labels for the issue."}
   * @paramDef {"type":"Object","label":"Additional Fields","name":"additionalFields","description":"Additional fields to update as key-value pairs."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async updateIssue(issueIdOrKey, summary, description, priority, assigneeAccountId, labels, additionalFields) {
    const fields = {
      ...(summary && { summary }),
      ...(description && { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: description }] }] } }),
      ...(priority && { priority: { name: priority } }),
      ...(assigneeAccountId !== undefined && { assignee: assigneeAccountId === 'null' ? null : { accountId: assigneeAccountId } }),
      ...(labels && { labels }),
      ...(additionalFields || {}),
    }

    await this.#apiRequest({
      logTag: 'updateIssue',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }`,
      method: 'put',
      body: { fields },
    })

    return { success: true }
  }

  /**
   * @operationName Delete Issue
   * @category Issues
   * @description Permanently deletes a Jira issue. This action cannot be undone. Use with caution as it removes the issue and all its data from the project.
   * @route POST /delete-issue
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to delete (e.g., 'PROJ-123' or '10000')."}
   * @paramDef {"type":"Boolean","label":"Delete Subtasks","name":"deleteSubtasks","uiComponent":{"type":"TOGGLE"},"description":"Set to true to delete the issue even if it has subtasks."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteIssue(issueIdOrKey, deleteSubtasks) {
    const query = {}
    if (deleteSubtasks) query.deleteSubtasks = 'true'

    await this.#apiRequest({
      logTag: 'deleteIssue',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }`,
      method: 'delete',
      query,
    })

    return { success: true }
  }

  /**
   * @operationName Search Issues
   * @category Issues
   * @description Searches for issues using JQL (Jira Query Language). Returns a list of issues matching the query criteria with configurable fields and pagination support.
   * @route POST /search-issues
   *
   * @paramDef {"type":"String","label":"JQL Query","name":"jql","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The JQL query string to search for issues (e.g., 'project = PROJ AND status = Open')."}
   * @paramDef {"type":"Number","label":"Start At","name":"startAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first issue to return (for pagination, default is 0)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of issues to return (default is 50, maximum is 100)."}
   * @paramDef {"type":"String","label":"Fields","name":"fields","description":"Comma-separated list of fields to return. Leave empty to return all fields."}
   *
   * @returns {Object}
   * @sampleResult {"startAt":0,"maxResults":50,"total":2,"issues":[{"id":"10000","key":"PROJ-123","fields":{"summary":"Issue summary","status":{"name":"To Do"}}}]}
   */
  async searchIssues(jql, startAt, maxResults, fields) {
    const body = { jql }
    if (startAt !== undefined) body.startAt = startAt
    if (maxResults !== undefined) body.maxResults = maxResults
    if (fields) body.fields = fields.split(',').map(f => f.trim())

    const response = await this.#apiRequest({
      logTag: 'searchIssues',
      url: `${ this.baseUrl }/search`,
      method: 'post',
      body,
    })

    return response
  }

  /**
   * @operationName Add Comment
   * @category Comments
   * @description Adds a new comment to a Jira issue. Supports plain text or Atlassian Document Format for rich text formatting.
   * @route POST /add-comment
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to add a comment to (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"Comment Text","name":"commentText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The text content of the comment to add."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10000","self":"https://your-domain.atlassian.net/rest/api/3/issue/10000/comment/10000","body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Comment text"}]}]},"author":{"accountId":"123","displayName":"John Doe"},"created":"2024-01-15T10:30:00.000+0000"}
   */
  async addComment(issueIdOrKey, commentText) {
    const body = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: commentText,
              },
            ],
          },
        ],
      },
    }

    const response = await this.#apiRequest({
      logTag: 'addComment',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/comment`,
      method: 'post',
      body,
    })

    return response
  }

  /**
   * @operationName Get Comments
   * @category Comments
   * @description Retrieves all comments for a specific Jira issue. Returns a paginated list of comments with author information and timestamps.
   * @route POST /get-comments
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to retrieve comments from (e.g., 'PROJ-123')."}
   * @paramDef {"type":"Number","label":"Start At","name":"startAt","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"The index of the first comment to return (for pagination, default is 0)."}
   * @paramDef {"type":"Number","label":"Max Results","name":"maxResults","uiComponent":{"type":"NUMERIC_STEPPER"},"description":"Maximum number of comments to return (default is 50)."}
   *
   * @returns {Object}
   * @sampleResult {"startAt":0,"maxResults":50,"total":2,"comments":[{"id":"10000","body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Comment text"}]}]},"author":{"accountId":"123","displayName":"John Doe"},"created":"2024-01-15T10:30:00.000+0000"}]}
   */
  async getComments(issueIdOrKey, startAt, maxResults) {
    const query = {}
    if (startAt !== undefined) query.startAt = startAt
    if (maxResults !== undefined) query.maxResults = maxResults

    const response = await this.#apiRequest({
      logTag: 'getComments',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/comment`,
      query,
    })

    return response
  }

  /**
   * @operationName Update Comment
   * @category Comments
   * @description Updates the text of an existing comment on a Jira issue. Only the comment author or project administrators can update comments.
   * @route POST /update-comment
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue containing the comment (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to update."}
   * @paramDef {"type":"String","label":"Comment Text","name":"commentText","required":true,"uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"The new text content for the comment."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10000","self":"https://your-domain.atlassian.net/rest/api/3/issue/10000/comment/10000","body":{"type":"doc","version":1,"content":[{"type":"paragraph","content":[{"type":"text","text":"Updated comment"}]}]},"author":{"accountId":"123","displayName":"John Doe"},"updated":"2024-01-15T10:35:00.000+0000"}
   */
  async updateComment(issueIdOrKey, commentId, commentText) {
    const body = {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: commentText,
              },
            ],
          },
        ],
      },
    }

    const response = await this.#apiRequest({
      logTag: 'updateComment',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/comment/${ commentId }`,
      method: 'put',
      body,
    })

    return response
  }

  /**
   * @operationName Delete Comment
   * @category Comments
   * @description Permanently deletes a comment from a Jira issue. Only the comment author or project administrators can delete comments.
   * @route POST /delete-comment
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue containing the comment (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"Comment ID","name":"commentId","required":true,"description":"The ID of the comment to delete."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async deleteComment(issueIdOrKey, commentId) {
    await this.#apiRequest({
      logTag: 'deleteComment',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/comment/${ commentId }`,
      method: 'delete',
    })

    return { success: true }
  }

  /**
   * @operationName Transition Issue
   * @category Issues
   * @description Transitions an issue to a different status by executing a workflow transition. Use Get Transitions to see available transitions for an issue.
   * @route POST /transition-issue
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to transition (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"Transition ID","name":"transitionId","required":true,"dictionary":"getTransitionsDictionary","dependsOn":["issueIdOrKey"],"description":"The ID of the transition to execute (e.g., '11' for 'To Do')."}
   * @paramDef {"type":"String","label":"Comment","name":"comment","uiComponent":{"type":"MULTI_LINE_TEXT"},"description":"Optional comment to add when transitioning the issue."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async transitionIssue(issueIdOrKey, transitionId, comment) {
    const body = {
      transition: { id: transitionId },
    }

    if (comment) {
      body.update = {
        comment: [
          {
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: comment,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      }
    }

    await this.#apiRequest({
      logTag: 'transitionIssue',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/transitions`,
      method: 'post',
      body,
    })

    return { success: true }
  }

  /**
   * @operationName Assign Issue
   * @category Issues
   * @description Assigns a Jira issue to a specific user by their account ID. Use empty string to unassign the issue.
   * @route POST /assign-issue
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to assign (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"Assignee Account ID","name":"assigneeAccountId","description":"The account ID of the user to assign the issue to. Leave empty to unassign."}
   *
   * @returns {Object}
   * @sampleResult {"success":true}
   */
  async assignIssue(issueIdOrKey, assigneeAccountId) {
    const body = assigneeAccountId ? { accountId: assigneeAccountId } : null

    await this.#apiRequest({
      logTag: 'assignIssue',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/assignee`,
      method: 'put',
      body,
    })

    return { success: true }
  }

  /**
   * @operationName Add Attachment
   * @category Attachments
   * @description Adds an attachment to a Jira issue from a public file URL. Supports various file types including images, documents, and archives.
   * @route POST /add-attachment
   *
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The ID or key of the issue to add an attachment to (e.g., 'PROJ-123')."}
   * @paramDef {"type":"String","label":"File URL","name":"fileUrl","required":true,"uiComponent":{"type":"FILE_SELECTOR"},"description":"The public file URL to attach to the issue."}
   * @paramDef {"type":"String","label":"Filename","name":"filename","description":"Optional filename for the attachment. If not provided, extracts from URL."}
   *
   * @returns {Object}
   * @sampleResult [{"id":"10000","self":"https://your-domain.atlassian.net/rest/api/3/attachment/10000","filename":"document.pdf","author":{"accountId":"123","displayName":"John Doe"},"created":"2024-01-15T10:30:00.000+0000","size":12345,"mimeType":"application/pdf"}]
   */
  async addAttachment(issueIdOrKey, fileUrl, filename) {
    const fileData = await Flowrunner.Request.get(fileUrl).setEncoding(null)

    const actualFilename = filename || fileUrl.split('/').pop()

    const formData = new FormData()
    formData.append('file', new Blob([fileData]), actualFilename)

    const authString = Buffer.from(`${ this.email }:${ this.apiToken }`).toString('base64')
    const request = Flowrunner.Request.post(`${ this.baseUrl }/issue/${ issueIdOrKey }/attachments`)
      .set({
        'Authorization': `Basic ${ authString }`,
        'X-Atlassian-Token': 'no-check',
      })

    request.form(formData)
    request.set({ 'Content-Type': 'multipart/form-data' })

    const response = await request

    return response
  }

  /**
   * @operationName Get Project
   * @category Projects
   * @description Retrieves detailed information about a specific Jira project including its configuration, issue types, and components.
   * @route POST /get-project
   *
   * @paramDef {"type":"String","label":"Project Key","name":"projectKey","required":true,"dictionary":"getProjectsDictionary","description":"The key of the project to retrieve (e.g., 'PROJ')."}
   *
   * @returns {Object}
   * @sampleResult {"id":"10000","key":"PROJ","name":"Project Name","projectTypeKey":"software","self":"https://your-domain.atlassian.net/rest/api/3/project/10000","lead":{"accountId":"123","displayName":"John Doe"}}
   */
  async getProject(projectKey) {
    const response = await this.#apiRequest({
      logTag: 'getProject',
      url: `${ this.baseUrl }/project/${ projectKey }`,
    })

    return response
  }

  // Dictionary methods

  /**
   * @typedef {Object} getProjectsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter projects by name or key."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Projects Dictionary
   * @description Provides a searchable list of Jira projects for dynamic parameter selection.
   * @route POST /get-projects-dictionary
   * @paramDef {"type":"getProjectsDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering projects."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Project Name (PROJ)","value":"PROJ","note":"ID: 10000"}],"cursor":null}
   */
  async getProjectsDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getProjectsDictionary',
      url: `${ this.baseUrl }/project/search`,
      query: { query: search || '' },
    })

    const items = (response.values || [])
      .map(project => ({
        label: `${ project.name } (${ project.key })`,
        value: project.key,
        note: `ID: ${ project.id }`,
      }))

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getIssueTypesDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Project Key","name":"projectKey","required":true,"description":"The project key to retrieve issue types from."}
   */

  /**
   * @typedef {Object} getIssueTypesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter issue types by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getIssueTypesDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the project."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Issue Types Dictionary
   * @description Provides a list of issue types available for a specific project.
   * @route POST /get-issue-types-dictionary
   * @paramDef {"type":"getIssueTypesDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering issue types."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"Task","value":"Task","note":"ID: 10001"},{"label":"Bug","value":"Bug","note":"ID: 10002"}],"cursor":null}
   */
  async getIssueTypesDictionary(payload) {
    const { search, criteria } = payload || {}
    const projectKey = criteria?.projectKey

    if (!projectKey) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getIssueTypesDictionary',
      url: `${ this.baseUrl }/issue/createmeta/${ projectKey }/issuetypes`,
    })

    let items = (response.values || response.issueTypes || [])
      .map(issueType => ({
        label: issueType.name,
        value: issueType.name,
        note: `ID: ${ issueType.id }`,
      }))

    if (search) {
      const searchLower = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getPrioritiesDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter priorities by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Priorities Dictionary
   * @description Provides a list of available issue priorities in Jira.
   * @route POST /get-priorities-dictionary
   * @paramDef {"type":"getPrioritiesDictionary__payload","label":"Payload","name":"payload","description":"Contains optional search string and pagination cursor for retrieving and filtering priorities."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"High","value":"High","note":"ID: 2"},{"label":"Medium","value":"Medium","note":"ID: 3"},{"label":"Low","value":"Low","note":"ID: 4"}],"cursor":null}
   */
  async getPrioritiesDictionary(payload) {
    const { search } = payload || {}

    const response = await this.#apiRequest({
      logTag: 'getPrioritiesDictionary',
      url: `${ this.baseUrl }/priority`,
    })

    let items = (response || [])
      .map(priority => ({
        label: priority.name,
        value: priority.name,
        note: `ID: ${ priority.id }`,
      }))

    if (search) {
      const searchLower = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }

  /**
   * @typedef {Object} getTransitionsDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Issue ID or Key","name":"issueIdOrKey","required":true,"description":"The issue ID or key to retrieve available transitions from."}
   */

  /**
   * @typedef {Object} getTransitionsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter transitions by name."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination offset for retrieving the next page of results."}
   * @paramDef {"type":"getTransitionsDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the issue."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Transitions Dictionary
   * @description Provides a list of available workflow transitions for a specific issue.
   * @route POST /get-transitions-dictionary
   * @paramDef {"type":"getTransitionsDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering transitions."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"To Do","value":"11","note":"Transition to To Do status"},{"label":"In Progress","value":"21","note":"Transition to In Progress status"}],"cursor":null}
   */
  async getTransitionsDictionary(payload) {
    const { search, criteria } = payload || {}
    const issueIdOrKey = criteria?.issueIdOrKey

    if (!issueIdOrKey) {
      return { items: [], cursor: null }
    }

    const response = await this.#apiRequest({
      logTag: 'getTransitionsDictionary',
      url: `${ this.baseUrl }/issue/${ issueIdOrKey }/transitions`,
    })

    let items = (response.transitions || [])
      .map(transition => ({
        label: transition.name,
        value: transition.id,
        note: `Transition to ${ transition.to?.name || transition.name } status`,
      }))

    if (search) {
      const searchLower = search.toLowerCase()
      items = items.filter(item => item.label.toLowerCase().includes(searchLower))
    }

    return { items, cursor: null }
  }
}

Flowrunner.ServerCode.addService(JiraIssues, [
  {
    name: 'siteUrl',
    displayName: 'Site URL',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Your Jira site URL (e.g., https://your-domain.atlassian.net). Do not include trailing slash.',
  },
  {
    name: 'email',
    displayName: 'Email',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'The email address associated with your Jira account for Basic Authentication.',
  },
  {
    name: 'apiToken',
    displayName: 'API Token',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    hint: 'Generate an API token at https://id.atlassian.com/manage-profile/security/api-tokens',
  },
])