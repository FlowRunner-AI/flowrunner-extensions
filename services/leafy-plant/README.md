# Leafy Plant

FlowRunner extension for the [Leafy Plant API](https://leafyplant.app/developers) — identify
any plant from a photo URL, fetch care guides, search 40,000+ species, and check plant
toxicity for humans and pets.

## Configuration

| Setting | Required | Description |
| ------- | -------- | ----------- |
| API Key | Yes | Your Leafy Plant API key, sent as the `x-api-key` header. Get it from https://leafyplant.app/developers |

## Operations

| Operation | Inputs | Returns |
| --------- | ------ | ------- |
| **Identify Plant** | Image URL (public), Language | Ranked candidate species, confidence, genus, and a description of the image |
| **Get Care Guide** | Species (searchable), Language | Watering, light, soil, and temperature guidance |
| **Search Plants** | Query, Limit | Matching plants with scientific/common names, family, genus, slug, and care/toxicity flags |
| **Get Toxicity** | Species (searchable), Animal | Toxicity information for humans and pets |

The **Species** fields on Get Care Guide and Get Toxicity are backed by a searchable plant
picker (powered by Search Plants). You may also type a name directly.

## Notes

- **Identify Plant** accepts a publicly accessible image URL; Leafy fetches and processes the
  image server-side.
- Supported languages: English (`en`), French (`fr`), Portuguese (`pt`).
