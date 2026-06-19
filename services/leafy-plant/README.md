# Leafy Plant FlowRunner Extension

Identify plants from a photo URL and look up horticultural data using the [Leafy Plant API](https://leafyplant.app/developers). Search 40,000+ species, fetch care guides (watering, light, soil, temperature), and check toxicity for humans and pets.

## Ideal Use Cases

- Identify a plant from a user-submitted or stored image and return its species and a description.
- Build a plant-care assistant that returns watering, light, soil, and temperature guidance for a species.
- Warn pet owners whether a plant is toxic to cats, dogs, horses, or people.
- Power a searchable species picker across common and scientific plant names.

## List of Actions

- Get Care Guide
- Get Toxicity
- Identify Plant
- Search Plants

## List of Triggers

This service has no triggers.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Leafy Plant API key, sent as the `x-api-key` header. Get it from https://leafyplant.app/developers |

## Notes

- **Identify Plant** accepts a publicly accessible image URL; Leafy fetches and processes the image server-side.
- The **Species** fields on Get Care Guide and Get Toxicity are backed by a searchable plant picker (powered by Search Plants); you may also type a name directly.
- Supported languages: English (`en`), French (`fr`), Portuguese (`pt`).

## Agent Ideas

- Use **Leafy Plant** "Identify Plant" on a customer photo, then **Gmail** "Send Message" to reply with the identified species and its care guide.
- After **Leafy Plant** "Search Plants" and "Get Care Guide", use **Google Sheets** "Add Row" to log each species with its watering and light requirements.
- Combine **Leafy Plant** "Get Toxicity" with **Airtable** "Create Record" to maintain a pet-safety database of plants flagged toxic to cats or dogs.
