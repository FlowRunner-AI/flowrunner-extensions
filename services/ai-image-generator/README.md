# AI Image Generator FlowRunner Extension

Generate images from text prompts using OpenAI's DALL-E models. Supports multiple sizes, quality levels, and returns a hosted file URL ready for use in downstream flow steps.

## Ideal Use Cases

- Generating product visuals or marketing images from text descriptions on demand
- Creating custom illustrations for blog posts, social media, or email campaigns
- Building image generation pipelines where output URLs feed directly into other services
- Producing concept art or design mockups from natural language prompts

## List of Actions

- Generate Image
- Get Quality Options
- Get Size Options

## Agent Ideas

- Use **AI Image Generator** "Generate Image" to create a product photo from a description, then pass the returned URL to **Brevo** "Send Transactional Email" to include it in a customer notification
- When a **Google Sheets** "On New Row" trigger fires with a prompt column, use **AI Image Generator** "Generate Image" and write the resulting URL back with **Google Sheets** "Update Cell"
- Combine with **Slack** "Send Message To Channel" to post newly generated images directly to a design review channel with a Block Kit image block