# WhatsApp Business FlowRunner Extension

Enables seamless integration with the WhatsApp Business API for automating customer communications. Send messages, share media, use templates, and manage business conversations at scale. Supports text, images, documents, locations, and pre-approved message templates.

## Ideal Use Cases

- Send automated notifications and alerts to customers
- Share order confirmations and shipping updates
- Distribute marketing messages using approved templates
- Send documents, invoices, and receipts
- Share location information for deliveries or meetings
- Build conversational customer support workflows
- Manage high-volume business communications

## List of Actions

- Send Text Message
- Send Image Message
- Send Document
- Send Template Message
- Send Location
- Mark Message as Read
- Get Business Profile
- Get Templates Dictionary

## Configuration

To use this service, you need to configure the following:

1. **Access Token** - WhatsApp Business API access token from Meta Business Platform
2. **Phone Number ID** - WhatsApp Business phone number ID from Meta Business Platform
3. **Business ID** (Optional) - Business account ID for template management
4. **Webhook Verify Token** (Optional) - Token for webhook verification when receiving messages

## Prerequisites

1. A Meta Business account
2. WhatsApp Business API access
3. A verified WhatsApp Business phone number
4. Approved message templates (for template messaging)

## Features

- **Text Messaging** - Send plain text messages with Unicode and emoji support
- **Media Sharing** - Send images, documents, and files up to 100MB
- **Template Messages** - Use pre-approved templates for notifications
- **Location Sharing** - Send GPS coordinates with optional labels
- **Read Receipts** - Mark incoming messages as read
- **Business Profile** - Retrieve and display business information
- **Template Management** - Dynamic template selection via dictionary

## Supported Media Formats

### Images
- JPEG (.jpg, .jpeg)
- PNG (.png)
- WebP (.webp)
- Maximum size: 5MB

### Documents
- PDF (.pdf)
- Microsoft Word (.doc, .docx)
- Microsoft Excel (.xls, .xlsx)
- Microsoft PowerPoint (.ppt, .pptx)
- Text files (.txt)
- Maximum size: 100MB

## Rate Limits

The WhatsApp Business API has rate limits that vary based on your business verification status and messaging tier. Please refer to the official Meta documentation for current rate limit information.