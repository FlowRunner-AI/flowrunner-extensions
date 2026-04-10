# Jira Issues FlowRunner Service

A comprehensive FlowRunner extension for integrating Jira Cloud. This service provides full CRUD operations for issues, comments, attachments, and project management.

## Features

- **Issue Management**: Create, read, update, delete, and search Jira issues
- **Comment Operations**: Add, retrieve, update, and delete issue comments
- **Attachment Handling**: Upload attachments from files
- **Workflow Transitions**: Move issues through workflow states
- **Project Information**: Retrieve project details and metadata
- **Dynamic Dictionaries**: Dropdown selections for projects, issue types, priorities, and transitions

## Configuration

This service requires the following configuration:

### Site URL
Your Jira Cloud instance URL (e.g., `https://your-domain.atlassian.net`)

### Email
The email address associated with your Jira account

### API Token
Generate an API token from [Atlassian Account Security](https://id.atlassian.com/manage-profile/security/api-tokens)

## Authentication

This service uses Basic Authentication with email and API token. The API token is more secure than using passwords and is the recommended authentication method for Jira Cloud REST API.

## Available Operations

### Issues
- **Create Issue**: Create new issues with custom fields
- **Get Issue**: Retrieve detailed issue information
- **Update Issue**: Modify existing issue fields
- **Delete Issue**: Permanently remove issues
- **Search Issues**: Query issues using JQL (Jira Query Language)
- **Transition Issue**: Move issues through workflow states
- **Assign Issue**: Assign or unassign issues to users

### Comments
- **Add Comment**: Create new comments on issues
- **Get Comments**: Retrieve all comments for an issue
- **Update Comment**: Modify existing comments
- **Delete Comment**: Remove comments from issues

### Attachments
- **Add Attachment**: Upload files from any file storage to Jira issues

### Projects
- **Get Project**: Retrieve project details and configuration

## JQL (Jira Query Language)

The Search Issues operation supports JQL for advanced querying. Examples:

```jql
project = PROJ AND status = "In Progress"
assignee = currentUser() AND priority = High
created >= -7d
labels = urgent AND type = Bug
```

## Notes

- All operations use Jira Cloud REST API v3
- Descriptions and comments use Atlassian Document Format (ADF)
- File attachments are downloaded from a file service and uploaded to Jira
- Dictionary methods provide dynamic parameter selection in FlowRunner UI

## References

- [Jira Cloud REST API Documentation](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [JQL Reference](https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
- [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/)
