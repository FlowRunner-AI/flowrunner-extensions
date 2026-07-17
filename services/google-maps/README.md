# Google Maps FlowRunner Extension

Integrates the Google Maps Platform for geocoding, place search, routing, address validation, and map imagery. Covers forward/reverse/place-ID geocoding, Places API (New) text search, nearby search, place details, autocomplete, and photo download, Routes API route and route-matrix computation, address validation, elevation, time zone lookup, and Static Maps image generation (photos and static maps are saved to FlowRunner file storage). Authenticates with a Google Cloud API key.

## Ideal Use Cases

- Turn user-entered addresses into coordinates (and back) to enrich CRM, order, or lead records
- Resolve partial user input into place IDs with autocomplete, then pull full place details (phone, website, hours, ratings)
- Compute driving/walking/transit ETAs and distances, or build a distance matrix across many origin-destination pairs
- Validate and standardize shipping/billing addresses (with optional USPS CASS) before saving them
- Look up elevation and local time zone for a coordinate to support scheduling or geospatial logic
- Generate a labeled static map image or download a place photo and store it for use in reports and notifications

## List of Actions

### Geocoding
- Geocode Address
- Geocode by Place ID
- Reverse Geocode

### Places
- Autocomplete Places
- Get Place Details
- Get Place Photo
- Search Nearby Places
- Search Places by Text

### Routes
- Compute Route
- Compute Route Matrix

### Address Validation
- Validate Address

### Geo Data
- Get Elevation
- Get Time Zone

### Static Maps
- Generate Static Map

## List of Triggers

This service does not define any triggers.

## Configuration

- **API Key** (`apiKey`, required) — A Google Cloud API key with billing enabled. Each Maps Platform product is enabled independently, so turn on only the APIs you use: Geocoding API, Places API (New), Routes API, Address Validation API, Elevation API, Time Zone API, and Maps Static API. Create the key in Google Cloud Console under APIs & Services > Credentials. Actions that call a product whose API is not enabled will return an authorization error.

## Notes

- **Billing is required.** The Maps Platform bills per request, and calls fail without a billing account attached to the key's project.
- Get Place Photo and Generate Static Map save their output to FlowRunner file storage and return the stored file URL.
- Place-ID parameters are backed by a searchable place picker (Places Text Search); you can also paste a place ID directly.

## Agent Ideas

- Use **Google Maps** "Autocomplete Places" then "Get Place Details" to resolve a user-typed business name into a phone number and website, and log the result with **Google Sheets** "Add Row"
- When a new lead arrives, use **Google Maps** "Validate Address" to standardize the shipping address and "Compute Route Matrix" to find the nearest store, then post the summary with **Slack** "Send Message To Channel"
- Use **Google Maps** "Search Places by Text" to find candidate venues, "Generate Static Map" to render a labeled map image, and **Gmail** "Send Message" to email the shortlist with the map attached
