# Leafy Plant

FlowRunner extension for the [Leafy Plant API](https://leafyplant.app/developers) — identify
any plant from a photo URL, fetch full care guides, search 40,000+ species, and diagnose
plant health issues.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Leafy Plant API key, sent as the `x-api-key` header. Get it from https://leafyplant.app/developers |

## Operations

| Operation | Inputs | Returns |
| --------- | ------ | ------- |
| **Identify Plant** | Image URL (public), Language | Scientific name, confidence, common names, family |
| **Get Care Guide** | Plant Name (searchable), Language | Watering, light, humidity, temperature, fertilizing, repotting, common issues |
| **Search Plants** | Query, Limit, Language | Matching plants with IDs, family, and common names |
| **Diagnose Plant** | Plant Name (searchable), Symptoms, Language | Ranked diseases/pests with confidence and treatment |
| **Health Check** | — | API status and version |

The **Plant Name** fields on Get Care Guide and Diagnose Plant are backed by a searchable
plant picker (powered by Search Plants). You may also type a plant name directly.

## Notes

- **Identify Plant** accepts a publicly accessible image URL; Leafy fetches and processes the
  image server-side.
- All vision endpoints respond in roughly 2-3 seconds; lookup endpoints respond in under 200ms.
- Supported languages: English (`en`), French (`fr`), Portuguese (`pt`).
