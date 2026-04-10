# Instantly Service

FlowRunner extension for Instantly AI - the AI-powered email outreach and deliverability platform.

## Overview

This service provides comprehensive integration with Instantly's email outreach platform, enabling automated campaign management, lead handling, email account setup, and real-time webhook triggers for activity events.

## Features

### Campaign Management
- List, create, update, and delete campaigns
- Add/remove leads from campaigns
- Campaign scheduling and configuration
- Campaign analytics and performance tracking
- Tag management for campaigns
- Pause/resume campaigns

### Lead Management
- List, find, create, update, and delete leads
- Bulk lead import
- Lead status updates (interested, not interested, meeting booked, etc.)
- Custom lead variables
- Lead tagging and labeling
- Lead list operations

### Email Account Management
- Create and configure email accounts
- Support for multiple providers (Google, Microsoft, AWS, Custom IMAP/SMTP)
- Account warmup settings with advanced configuration
- Tracking domain setup
- Account tagging
- Account status monitoring

### Analytics
- Campaign analytics with date ranges
- Campaign analytics overview
- Daily campaign analytics
- Customizable metrics and filters

### Tags and Labels
- Create and manage custom tags
- Lead labels with interest status tracking
- Apply tags to campaigns, accounts, and leads
- Tag-based filtering

### Blocklist Management
- Add domains and emails to blocklist
- List blocklist entries
- Remove from blocklist

### Triggers
- **Activity Event Trigger**: Real-time webhook triggers for 17+ event types including:
  - Email sent, opened, bounced
  - Reply received, auto-reply received
  - Link clicked
  - Lead status changes (interested, meeting booked, unsubscribed, etc.)
  - Campaign completed
  - Account errors

## Configuration

The service requires one configuration item:

- **API Key** (required): Your Instantly API key
  - Get it at: https://app.instantly.ai/app/settings/integrations

## Key Implementation Details

### Dynamic Dictionaries
Most ID-based parameters use dynamic dictionaries that fetch live data from your Instantly workspace:
- Campaign selector
- Email account selector
- Lead list selector
- Lead label selector
- Tag selector
- Lead selector

This provides a searchable dropdown experience with real-time data.

### Schema Loaders (Subforms)
Complex parameter groups are organized using collapsible subforms:
- **IMAP Settings**: Username, password, host, port
- **SMTP Settings**: Username, password, host, port
- **Warmup Settings**: Limits, increments, advanced options
- **Campaign Schedule**: Timezone, days, time slots

### Webhook Architecture
The Activity Event trigger uses FlowRunner's REALTIME_TRIGGER system with ALL_APPS scope:
- Single callback URL handles all event types
- Creates separate webhooks in Instantly for each event type subscribed
- Automatic event routing based on event type matching
- Supports multiple simultaneous event subscriptions

### Human-Readable Enums
All enum-based parameters use human-readable labels instead of codes:
- Provider: "Google", "Microsoft", "AWS", "Custom IMAP/SMTP" (not 1, 2, 3, 4)
- Campaign Status: "Active", "Paused" (not 1, 0)
- Account Status: "Active", "Paused", error states (not 1, 2, -1, -2, -3)
- Lead Status: "Lead Unsubscribed", "Lead Out Of Office", etc. (not snake_case)

## API Version

This service uses Instantly API v2.

API Documentation: https://developer.instantly.ai/

## Testing

Test files are located in `/testing-files/instantly/`:
- `test.js` - Comprehensive test suite for all methods
- `validate-paramdefs.py` - Validates all JSDoc @paramDef annotations
- `refactor-params.py` - Utility for parameter refactoring

Run validation:
```bash
cd /testing-files/instantly
python3 validate-paramdefs.py
```

Run tests:
```bash
cd /testing-files/instantly
node test.js                    # Run all tests with caching
node test.js --debug            # Debug mode with request/response logging
node test.js --test=methodName  # Test specific method
```

## Method Categories

### Campaigns (14 methods)
List, create, update, delete, pause, launch, add leads, remove leads, add tags, remove tags, get analytics, get analytics overview, get daily analytics, get summary

### Leads (14 methods)
List, find, create, update, delete, bulk import, update status, add variable, add tags, remove tags, get by email, get by campaign

### Email Accounts (5 methods)
List, create, update, delete, add/remove tags

### Lead Lists (5 methods)
List, create, get, update, delete, get verification stats

### Tags (5 methods)
List, create, get, update, delete

### Lead Labels (5 methods)
List, create, get, update, delete

### Blocklist (3 methods)
List, add, remove

### Triggers (1 method)
Activity Event (17+ event types)

## Notes

- All methods include comprehensive error handling
- Rate limiting and pagination handled automatically
- Supports optional parameters with proper null/undefined handling
- Uses clean() helper to remove null/undefined values from API requests

## Support

For issues or questions:
- Instantly API Support: https://help.instantly.ai/
- FlowRunner Documentation: Check repository docs
