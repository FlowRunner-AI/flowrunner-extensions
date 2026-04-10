# Gemini AI FlowRunner Extension

Integrates Google's Gemini generative AI models into FlowRunner workflows. Upload files (documents, images, audio, video) to the Gemini Files API and generate content using configurable prompts, system instructions, temperature, and text or JSON output formats.

## Ideal Use Cases

- Analyzing uploaded documents, invoices, and contracts with natural language prompts
- Extracting structured JSON data from images, PDFs, or scanned documents
- Summarizing or translating text and multimedia content at scale
- Building AI-powered content generation pipelines with configurable model parameters
- Processing audio and video files for transcription or content analysis

## List of Actions

### Content Generation

- Generate Content

### Files

- Delete File
- Get File Info
- List Files
- Upload File

## Agent Ideas

- Use **Google Drive** "Download File" to fetch a document, then call **Gemini AI** "Upload File" followed by "Generate Content" to extract structured data, and write the results into **Google Sheets** "Add Row" for automated document processing
- When a **Gmail** "On New Attachment" trigger fires, use **Gemini AI** "Upload File" and "Generate Content" to summarize the attachment, then send the summary back via **Gmail** "Send Message"
- Use **S3 Storage** "Get Presigned URL" to obtain a temporary link for a stored file, pass it to **Gemini AI** "Upload File" and "Generate Content" with JSON response format, then use **Slack** "Send Message To Channel" to share the AI analysis with the team
