# Microsoft Power BI FlowRunner Extension

Connect to Microsoft Power BI through Microsoft OAuth2 (Entra ID) with delegated Power BI Service permissions to manage workspaces, datasets, reports, dashboards, dataflows, and apps via the Power BI REST API. Run DAX queries, stream rows into push datasets, refresh semantic models, and export reports to PDF, PowerPoint, or PNG into FlowRunner file storage.

## Ideal Use Cases

- Trigger dataset refreshes on a schedule or after upstream data lands, then verify the outcome via refresh history
- Push live data into streaming/push datasets to drive real-time dashboard tiles
- Run DAX queries to pull KPIs and metrics into other automations
- Export reports to PDF/PowerPoint/PNG and distribute them by email or chat
- Clone and rebind reports across workspaces, or manage dataset ownership and Power Query parameters

## List of Actions

### Workspaces
- List Workspaces

### Datasets
- Get Dataset, List Datasets, Delete Dataset, Refresh Dataset, Get Refresh History, Get Dataset Parameters, Update Dataset Parameters, Take Over Dataset

### DAX Queries
- Execute DAX Query

### Push Datasets
- Create Push Dataset, Get Dataset Tables, Add Rows to Table, Delete Rows from Table, Update Table Schema

### Reports
- Get Report, List Reports, Get Report Pages, Clone Report, Delete Report

### Report Export
- Export Report to File, Start Report Export, Get Report Export Status, Save Exported Report File

### Dashboards
- Get Dashboard, List Dashboards, List Dashboard Tiles

### Dataflows
- List Dataflows, Refresh Dataflow

### Apps
- Get App, List Apps, List App Reports, List App Dashboards

### Platform
- List Imports, List Gateways, List Capacities

## List of Triggers

This service does not define any triggers.

## Authentication & Configuration

Authentication uses Microsoft OAuth2 (Entra ID) against the Power BI resource. Configure your Entra app registration credentials:

| Item | Description |
| --- | --- |
| Client ID | Application (client) ID of your Microsoft Entra app registration with delegated Power BI Service permissions |
| Client Secret | Client secret of the app registration |

The app registration needs delegated Power BI Service permissions (Workspace.Read.All, Dataset.ReadWrite.All, Report.ReadWrite.All, Dashboard.Read.All, Dataflow.ReadWrite.All, App.Read.All, Capacity.Read.All, Content.Create) plus `openid`, `profile`, `email`, and `offline_access`.

## Notes

- Most operations accept an optional Workspace; leave it empty to target **My workspace**. Dataflows and Take Over Dataset require a shared workspace.
- Report export requires the report's workspace to be on Premium, Embedded, or Fabric capacity. Export Report to File waits up to ~4 minutes; for longer exports use Start Report Export → Get Report Export Status → Save Exported Report File.
- Execute DAX Query requires the "Dataset Execute Queries REST API" tenant setting to be enabled, plus read and build permission on the dataset (DAX only; no MDX/DMV).
- Push dataset limits: up to 10,000 rows per Add Rows request and 120 requests per minute.

## Agent Ideas

- Use **Microsoft Power BI** "Execute DAX Query" to pull the latest KPI figures from a semantic model, then use **Microsoft Teams** "Send Channel Message" to post the summary to a leadership channel.
- Use **Microsoft SQL Server** "Execute Query" to extract fresh transactional records, then stream them into a **Microsoft Power BI** push dataset with "Add Rows to Table" so dashboard tiles update in real time.
- Use **Microsoft Power BI** "Export Report to File" to render a report to PDF, then use **Microsoft Excel 365** "Update Range Values" to log the export URL and timestamp into a distribution tracking workbook.
