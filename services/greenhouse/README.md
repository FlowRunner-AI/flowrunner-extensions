# Greenhouse FlowRunner Extension

Integrates with the Greenhouse Recruiting Harvest API to manage candidates, applications, jobs, and the full hiring pipeline. Manage candidates (including notes and file attachments), move/advance/reject/hire applications, read scorecards, interviews, and offers, and pull reference data for sources, rejection reasons, departments, offices, and custom fields.

## Ideal Use Cases

- Syncing candidates and prospects from sourcing tools into Greenhouse and attaching resumes to their profiles
- Automating pipeline progression by moving, advancing, rejecting, or hiring applications from a workflow
- Logging notes and activity to a candidate's feed when an external event occurs
- Reporting on jobs, openings, scorecards, interviews, and offers to a spreadsheet or dashboard
- Notifying recruiters or hiring managers when an application reaches a specific stage or an offer is created

## List of Actions

### Candidates
- Add Attachment to Candidate
- Add Note to Candidate
- Create Candidate
- Delete Candidate
- Get Candidate
- List Candidate Applications
- List Candidates
- Update Candidate

### Applications
- Advance Application
- Get Application
- Hire Application
- List Applications
- Move Application Stage
- Reject Application
- Update Application

### Scorecards & Interviews
- List Application Scorecards
- List Scheduled Interviews for Application

### Offers
- Get Current Offer for Application
- List Application Offers

### Jobs
- Create Job Opening
- Get Job
- Get Job Stages
- List Job Openings
- List Jobs

### Job Posts
- Get Job Posts for Job
- List Job Posts

### Users
- Get User
- List Users

### Reference
- List Custom Fields
- List Departments
- List Offices
- List Rejection Reasons
- List Sources

## List of Triggers

This service does not define any triggers.

## Authentication

Uses HTTP Basic auth with a Greenhouse Harvest API key as the username and an empty password. Create the key in Greenhouse under Configure → Dev Center → API Credential Management (type "Harvest"), granting the permissions your workflow needs.

## Configuration

- **API Key** (required) — your Greenhouse Harvest API key.
- **On-Behalf-Of User ID** — numeric Greenhouse user id used to audit write operations (create/update/delete). Greenhouse requires it for all writes; find a user id via List Users. Individual write actions can override this with their own On-Behalf-Of User ID parameter.

## Agent Ideas

- After a candidate reaches the final stage, use **Greenhouse** "Get Current Offer for Application" and **Gmail** "Send Message" to email the hiring manager the offer's compensation and start date for sign-off.
- When a **Greenhouse** "List Scheduled Interviews for Application" call returns upcoming interviews, use **Google Calendar** "Create Event" to place each interview on the interviewer's calendar with the correct times.
- When an application is moved with **Greenhouse** "Advance Application", post to **Slack** "Send Message To Channel" so the recruiting channel sees the candidate's new stage.
