# Twitch FlowRunner Extension

Connect a Twitch account via OAuth2 to work with the Twitch Helix API: read and update your channel and profile, monitor streams, capture clips and stream markers, manage videos, send chat messages, run polls, and pull subscription, follower, and Bits data. Broadcaster/user parameters default to the connected account when omitted.

## Ideal Use Cases

- Automatically update your stream title and category (game) before going live, and post an announcement to chat.
- Capture a clip or drop a stream marker at key moments while you are broadcasting so highlights are easy to find later.
- Track channel growth by pulling followers, subscribers, and the Bits leaderboard on a schedule.
- Run and resolve chat polls as part of interactive stream segments.
- Discover trending games and live streams to inform content decisions.

## List of Actions

- **Users**: Get Current User, Get Users, Update User Description
- **Channels**: Get Channel Information, Modify Channel Information, Search Channels, Get Channel Followers, Get Followed Channels
- **Streams**: Get Streams, Get Followed Streams, Create Stream Marker, Get Stream Key
- **Categories**: Search Categories, Get Top Games, Get Games
- **Clips**: Create Clip, Get Clips
- **Videos**: Get Videos, Delete Videos
- **Chat**: Send Chat Message, Get Chat Settings, Get Chatters
- **Schedule**: Get Channel Stream Schedule
- **Polls**: Create Poll, Get Polls, End Poll
- **Subscriptions**: Get Broadcaster Subscriptions
- **Bits**: Get Bits Leaderboard

## List of Triggers

This service does not define any triggers.

## Authentication

OAuth2 (Authorization Code). Register an application at https://dev.twitch.tv/console/apps, add the FlowRunner redirect URL, and supply its Client ID and Client Secret. The connection requests these scopes: `user:read:email`, `user:edit`, `user:read:follows`, `user:write:chat`, `channel:manage:broadcast`, `channel:read:subscriptions`, `channel:read:stream_key`, `channel:manage:polls`, `channel:manage:videos`, `moderator:read:followers`, `moderator:read:chatters`, `clips:edit`, `bits:read`.

## Notes

- **Create Clip** and **Create Stream Marker** require the channel to be live; they cannot run against an offline channel.
- Get Broadcaster Subscriptions requires a Twitch Affiliate or Partner account. Get Stream Key returns a secret — treat the value accordingly.

## Agent Ideas

- Before a broadcast, call **Twitch** "Modify Channel Information" to set the title and game, then post a go-live announcement with **Discord** "Send Message" and **X / Twitter** "Create Post".
- When a memorable moment happens on a live stream, use **Twitch** "Create Clip", then share the resulting clip link via **Discord** "Send Message" to your community server.
- Pull channel growth with **Twitch** "Get Channel Followers" and "Get Broadcaster Subscriptions", then log the totals into **Google Sheets** "Add Row" for weekly reporting.
