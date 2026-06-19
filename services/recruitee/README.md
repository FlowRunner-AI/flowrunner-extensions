# Recruitee FlowRunner Extension

Automate Recruitee, an applicant tracking system: candidates, jobs, pipelines, interviews, notes, tasks, requisitions, and communication. Uses a Personal API Token and Company ID.

## Ideal Use Cases

- Add and route candidates into the right job and pipeline stage
- Move, disqualify, tag, and source candidates in a hiring flow
- Create and publish jobs; schedule interviews and submit scorecards
- Email or SMS candidates and log notes, tasks, and activity

## List of Actions

- General: Test Connection
- Candidates: Find, Get, Add, Update, Delete, Add to Job, Move to Stage, Disqualify, Restore, Add Tags, Add Source, Add to Talent Pool, Parse CV, Merge
- Jobs: Find, Get, Create, Update, Update Status, Duplicate, Delete, Tag, Get Job Candidates, List Job Stages
- Pipeline: List/Get/Create/Update/Delete Template, Add/Update/Delete Stage
- Organization: manage Disqualify Reasons, Departments, Locations, Talent Pools; List Tags, Sources, Team Members
- Notes & Tasks: Add/List Candidate Note, manage Notes and Tasks
- Activity & Custom Fields: List Activity, manage Field Sets, Set Candidate Custom Field
- Interviews: Schedule/List/Get/Update/Cancel, Submit/List Scorecards, Request Feedback, manage Templates, List Schedules/Rooms/Calendars
- Communication: Send/Schedule Email, List Emails, Get Email Thread, manage Email Templates, Send/List SMS
- Requisitions: Find, Get, Create, Update, Update Status, Delete
- Advanced: manage Saved Searches and Imports

## List of Triggers

- On New Application
- On New Candidate
- On Candidate Moved to Stage
- On Status Change

## Agent Ideas

- On **Recruitee** "On New Candidate", use **Gmail** "Send Message" to email the hiring manager the applicant's CV link.
- On **Recruitee** "On Candidate Moved to Stage" for "Interview", use **Slack** "Send Message To Channel" to alert the team.
- On **Recruitee** "On Status Change" for hires, use **Google Sheets** "Add Row" to log the new hire to a tracker.
