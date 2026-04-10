# Parseur Document Parser Service

Parseur is an AI-powered document parsing service that extracts structured data from emails, PDFs, and other documents. This FlowRunner extension integrates Parseur's powerful document processing capabilities.

## Features

### Document Management Actions
- **Create Mailbox** - Set up new mailboxes for document collection
- **Upload Document** - Send documents for parsing (PDFs, Word docs, images, emails)
- **Get Parsed Data** - Retrieve extracted structured data from processed documents
- **List Documents** - View all documents in a mailbox with filtering options
- **Reprocess Document** - Re-run parsing with updated templates
- **Delete Document** - Remove documents from mailboxes

### Trigger Options
- **On Document Processed (Polling)** - Periodically checks for newly processed documents
- **On Document Processed (Realtime)** - Instant webhooks when documents are processed

### Dynamic Dictionaries
- **Get Mailboxes Dictionary** - Dynamic dropdown for mailbox selection
- **Get Templates Dictionary** - Context-aware template selection based on mailbox

## Configuration

### Required Settings
- **API Key** - Your Parseur API key (get it from https://app.parseur.com/account/api-keys)

## Trigger Configuration

### Polling Trigger
- **Mailbox** - Select which mailbox to monitor
- **Include Failed** - Also trigger for failed document processing
- **Polling Interval** - Configurable (minimum 30 seconds)

### Realtime Trigger
- **Mailbox** - Select which mailbox to monitor  
- **Include Failed** - Also trigger for failed document processing
- **Automatic Webhook Management** - Webhooks are created and cleaned up automatically

## Use Cases

### Invoice Processing
Automatically extract invoice data including:
- Invoice numbers and dates
- Vendor information
- Line items and amounts
- Tax details

### Email Parsing
Extract structured data from emails such as:
- Contact information
- Order details
- Support tickets
- Lead information

### Document Automation
- Resume parsing for HR systems
- Receipt processing for expense tracking
- Form data extraction
- Contract analysis

## Getting Started

1. **Create a Mailbox**
   - Use the "Create Mailbox" action to set up a new parsing inbox
   - Each mailbox gets a unique email address for document submission

2. **Upload Documents**
   - Send documents via the "Upload Document" action
   - Supports PDFs, images, Word documents, and emails

3. **Retrieve Parsed Data**
   - Use "Get Parsed Data" to access extracted information
   - Data is returned as structured JSON

4. **Set Up Automation**
   - Choose **Realtime Trigger** for instant notifications (recommended)
   - Choose **Polling Trigger** if webhooks aren't suitable for your setup

## API Limits

- Rate limit: 5 requests per second per IP
- Burst capacity: 20 requests
- Processing is asynchronous - documents are queued for parsing

## Best Practices

1. **Trigger Selection**
   - Use **Realtime Trigger** for production environments (instant, efficient)
   - Use **Polling Trigger** for development or when webhooks aren't available

2. **Template Management**
   - Create templates in Parseur web app for consistent parsing
   - Use template IDs when uploading documents for predictable results

3. **Error Handling**
   - Check document status before retrieving parsed data
   - Handle "pending" and "processing" states appropriately
   - Enable "Include Failed" in triggers to handle parsing failures

4. **Performance**
   - Realtime triggers have no delay - events fire instantly
   - Polling triggers have configurable intervals (minimum 30 seconds)

## Trigger Event Data

Both trigger types return structured data:

```json
{
  "id": "doc_xyz789",
  "status": "processed",
  "parsedData": {
    "invoice_number": "INV-2024-001",
    "amount": "1250.00",
    "date": "2024-01-15"
  },
  "mailboxId": "mb_abc123",
  "filename": "invoice.pdf",
  "processed": "2024-01-15T10:36:00Z"
}
```

## Support

For more information about Parseur's capabilities, visit:
- [Parseur Documentation](https://help.parseur.com/)
- [API Documentation](https://developer.parseur.com/)
- [Parseur Support](https://help.parseur.com/)