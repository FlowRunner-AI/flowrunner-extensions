# FlowRunner Extension Development Guide

> **Note**: For AI agents working on service review/improvement, use the consolidated guides in `/docs/ai/` folder as primary reference.

## Service JSDoc Annotations

### Basic Service Tags

- `@integrationName` - Service display name in marketplace
- `@integrationIcon` - Path to icon file in `public/` (e.g. `/icon.png`, `/icon.svg`). Must be a real file — never inline as base64/data: URI.
- `@requireOAuth` - (Optional) Enables OAuth2 authentication

## Service Config Items

When a service installing to a FlowRunner App it might be configured with different options required and optional.
Pass as a second argument a list of config items when registering the service.
Each config item can have the following properties:

- `name` {String} - required, used in the service code to access the configured value
- `displayName` {String} - optional, displays in the UI as the input label (do not include the service name, it is already shown in the service context)
- `defaultValue` {String} - optional, used as a default value
- `type` {String} - required, according to the type it renders a particular UI input and then serialize/deserialize the value
- `required` {String} - optional, when it's `true` the UI will require the input to be filled
- `hint` {String} - optional, a string describes a help message for the input
- `shared` {Boolean} - optional, set `true` only for OAuth client credentials (e.g. Client ID / Client Secret) in `@requireOAuth` services; otherwise `false`

Available Types:

- `STRING` - for a regular single-line input
- `BOOL` - for a togglable values
- `DATE` - to render a datetime picker to select a specific Date
- `CHOICE` - predefined list of options, requires additional `options` property in the config item, it must be a list of string values
- `TEXT` - to get a multi-line string

Example:

```javascript
class MyService {

}


Flowrunner.ServerCode.addService(MyService, [
  {
    name: 'clientId',
    displayName: 'Client ID',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true, // OAuth client credential in a @requireOAuth service
    hint: 'Required value. You can find in Your Service Console.',
  },
  {
    name: 'clientSecret',
    displayName: 'Client Secret',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: true,
    shared: true, // OAuth client credential in a @requireOAuth service
    hint: 'Required value. You can find in Your Service Console.',
  },
  {
    name: 'defaultSender',
    displayName: 'Default Sender',
    defaultValue: '',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.STRING,
    required: false,
    shared: false,
    hint: 'Used if method argument "Sender" was not passed',
  },
  {
    name: 'defaultPriority',
    displayName: 'Default Priority',
    defaultValue: 'medium',
    type: Flowrunner.ServerCode.ConfigItems.TYPES.CHOICE,
    required: false,
    shared: false,
    options: ['low', 'medium', 'critical'],
    hint: 'Used if method argument "Priority" was not passed',
  },
])


```

## Method Definition

- `@registerAs` - method's type
- `@description` - method's description
- `@route` - method's HTTP method and URI
- `@paramDef` - method's arguments
- `@returns` - method's output type
- `@sampleResult` - method's output example
- `@sampleResultLoader` - dynamic sample result generation

### @registerAs

Optional JSDoc tag describes the method type, possible values are [`DICTIONARY`, `SYSTEM`]:

- If it's not provided such method will be listed in the FlowRunner actions list
- Value `DICTIONARY` it means such method intended for populating `Dynamic Argument Options` values and it won't be visible in the FlowRunner actions list
- When it is `SYSTEM` it means such method is for system purposes so it won't be visible in the FlowRunner actions list

```
@registerAs SYSTEM
...
@registerAs DICTIONARY
```

### @description

Optional JSDoc tag describes what the method/action is for

```
@description Sends a message to all customers in the specified channel
```

### @route

Optional JSDoc tag to specify the method `HTTP method` and `URI`

Use REST-appropriate verbs: `GET` for reads, `POST`/`PUT`/`PATCH`/`DELETE` for writes. `GET` is also acceptable for action-style methods that don't mutate state.

```
@route POST /send-message-to-channel
@route GET /list-channels
```

For OAuth2 `SYSTEM` methods, keep the conventional verbs:

```
@route GET /getOAuth2ConnectionURL
@route POST /executeCallback
@route PUT /refreshToken
```

### @paramDef

Optional JSDoc tag describes each method argument

```
@paramDef {"type":"String","name":"message"}
@paramDef {"type":"String","name":"channel"}
@paramDef {"type":"Boolean","name":"isCritical"}
```

### @returns

If a method returns any value the `@returns` tag must be provided to specify what type of value the action will respond for generating documentation.

```
@returns {Object}
```

### @sampleResult

If a method returns any value the `@sampleResult` tag must be provided
to specify a sample value (any valid JSON string) the action will respond
for generating documentation and describing the action output in the FlowRunner UI

```
@sampleResult { "name":"Jack", "age": 32 }
```

### @sampleResultLoader

Optional JSDoc tag that enables dynamic sample result generation based on parameter values. Instead of a static `@sampleResult`, this references a loader method that generates contextual sample results.

```
@sampleResultLoader { "methodName":"generateText_SampleResultLoader", "dependsOn":["includeMeta"] }
```

#### Properties:

- `methodName` - Name of the loader method that generates the sample result
- `dependsOn` - Array of parameter names that affect the sample result structure

#### Sample Result Loader Implementation:

The referenced loader method must be implemented as a `SAMPLE_RESULT_LOADER` system method:

```javascript
/**
 * @registerAs SAMPLE_RESULT_LOADER
 * @route POST /generateText_SampleResultLoader
 * @param {Object} payload
 */
async generateText_SampleResultLoader({ criteria }) {
  const { includeMeta } = criteria

  if (includeMeta) {
    return {
      lc: 1,
      kwargs: {
        usage_metadata: {
          total_tokens: 170,
          output_tokens: 82
        },
        content: "Generated text response"
      }
    }
  }

  return "Simple text response"
}
```

This enables the UI to show different sample results based on parameter values, improving user experience by providing contextual examples.

## Method Appearance

- `@operationName` action's name, appeared in the UI
- `@appearanceColor` action's color, it must be two hex colors

### @operationName

```
@operationName Send Channel Message
```

### @appearanceColor

```
@appearanceColor #f9566d #fb874b
```

## Method Execution Duration

To extends basic Cloud Code invocations time limits need to specify these both JSDoc tags:

```
@executionTimeoutInSeconds 120
```

## Method Argument Definition

- `type` - {String} - required, any valid JS type (`String`, `Number`, `Boolean`, `Array<String>`, etc.), see for details: https://jsdoc.app/tags-param
- `name` - {String} - required, argument name used in the request payload, changing such property breaks all already existed actions
- `label` - {String} - optional, argument label, can be changed anytime without any breaking changes
- `description` - {String} - optional, explains what the argument is for
- `required` - {Boolean} - optional, if `true` the system will require to populate such field before execute it
- `dictionary` - {String} - optional, references to a `DICTIONARY` method to render a helper dialog to populate options
- `dependsOn` - {String} - optional, describes what other argument must be filled first, normally works along with the `dictionary` property
- `uiComponent` - {String} - optional, configures UI input for the argument

Samples:

```
@paramDef {"type":"String", "label":"Channel", "name":"channelId", "required":true, "dictionary":"getChannelsDictionary", "description": "The ID of the Slack channel where the message will be sent."}
@paramDef {"type":"String", "label":"Message", "name":"messageText", "required":false, "description": "The text content of the message to send to the Slack channel. It supports Slack formatting such as @channel and @here, and to mention a user, use <@U123456789>, where U123456789 is the user ID."}
@paramDef {"type":"String", "label":"Thread", "name":"threadId", "required":false, "dictionary":"getThreadsDictionary", "dependsOn": ["channelId"], "description": "The ID of the thread to post the message in, if applicable."}
@paramDef {"type":"Boolean", "label":"Send as a bot", "name":"sendAsBot", "required":false, "uiComponent":{"type":"TOGGLE"}, "description": "Whether the message should be sent as a bot."}
```

### Method Argument UI Component Types

- `CHECKBOX`: displays a checkbox, suitable for `Boolean` arguments
- `TOGGLE`: displays a toggle, suitable for `Boolean` arguments
- `NUMERIC`: displays a numeric input, suitable for `Number` arguments
- `NUMERIC_STEPPER`: displays a numeric input with stepper, suitable for `Number` arguments
- `DATE_PICKER`: displays an input with Date picker to select date, target value is a `timestamp`, suitable for `Number` arguments
- `TIME_PICKER`: **NOT IMPLEMENTED YET**
- `DATE_TIME_PICKER`: displays an input with DateTime picker to select date and time, target value is a `timestamp`, suitable for `Number` arguments
- `DROPDOWN`: displays a combo-box with predefined values, suitable for `String` arguments, required options are: - `values` - list of available options
- `MULTI_LINE_TEXT`: displays a multiline text area, suitable for `String` arguments
- `SINGLE_LINE_TEXT`: displays a regular text input, suitable for `String` arguments
- `FILE_SELECTOR`: displays a button to select a file in the FlowRunner app files, target value is a relative path to the file in the app, suitable for `String` arguments

default ui type is `SINGLE_LINE_TEXT`

Samples:

```
@paramDef {"type":"String", "name":"priority", "uiComponent": {"type": "DROPDOWN", "options": {"values": ["low", "medium", "critical"]}} }
@paramDef {"type":"Boolean", "name":"replyBroadcast", "uiComponent": {"type": "TOGGLE"} }
@paramDef {"type":"String", "name":"message", "uiComponent": {"type": "MULTI_LINE_TEXT"} }
```

## Optional System Methods (Dictionaries) for Dynamic Argument Options

In order to provide a dynamic list of options for an input:

1. Specify in the `@paramDef` the `dictionary` property — the value is the name of a DICTIONARY method
2. Add a method with type `DICTIONARY` using the canonical payload + typedef pattern

### Input properties (inside `payload`):

- `search` {String} - optional, a string to filter items
- `criteria` {Object} - optional, a hash map of filled form input values (for dependent dictionaries)
- `cursor` {String} - optional, `cursor` from the previous request for paged listing

### Output properties:

- `cursor` {String} - optional, for paged listing when items are limited
- `items` {Array<Object>} - required, list of options:
  - `label` {String} - required, display text in the UI
  - `note` {String} - required, additional details (e.g. `ID: ${id}`)
  - `value` {any} - required, value passed to the input

### Simple Dictionary Example:

```javascript
  /**
   * @typedef {Object} getChannelsDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter channels."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for next page."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channels Dictionary
   * @description Provides a searchable list of channels for dynamic parameter selection.
   * @route POST /get-channels-dictionary
   * @paramDef {"type":"getChannelsDictionary__payload","label":"Payload","name":"payload","description":"Contains search and pagination parameters."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"general","value":"C123","note":"ID: C123"}],"cursor":null}
   */
  async getChannelsDictionary(payload) {
    const { search, cursor } = payload || {}

    const { channels, nextCursor } = search
      ? loadChannels(`channelName='%${search}%'`, { nextCursor: cursor })
      : loadChannels(null, { nextCursor: cursor })

    return {
      cursor: nextCursor,
      items: channels.map(({ channelName, channelId }) => ({
        label: channelName,
        note: `ID: ${channelId}`,
        value: channelId,
      })),
    }
  }
```

### Dependent Dictionary Example:

```javascript
  /**
   * @typedef {Object} getChannelMembersDictionary__payloadCriteria
   * @paramDef {"type":"String","label":"Channel ID","name":"channelId","required":true,"description":"The channel to list members from."}
   */

  /**
   * @typedef {Object} getChannelMembersDictionary__payload
   * @paramDef {"type":"String","label":"Search","name":"search","description":"Optional search string to filter members."}
   * @paramDef {"type":"String","label":"Cursor","name":"cursor","description":"Pagination cursor for next page."}
   * @paramDef {"type":"getChannelMembersDictionary__payloadCriteria","label":"Criteria","name":"criteria","required":true,"description":"Required parameters to identify the channel."}
   */

  /**
   * @registerAs DICTIONARY
   * @operationName Get Channel Members Dictionary
   * @description Provides a searchable list of members for the specified channel.
   * @route POST /get-channel-members-dictionary
   * @paramDef {"type":"getChannelMembersDictionary__payload","label":"Payload","name":"payload","description":"Contains search, cursor, and criteria for filtering channel members."}
   * @returns {Object}
   * @sampleResult {"items":[{"label":"johndoe","value":"U456","note":"ID: U456"}],"cursor":null}
   */
  async getChannelMembersDictionary(payload) {
    const { search, cursor, criteria } = payload || {}
    const channelId = criteria?.channelId

    const { members, nextCursor } = search
      ? loadChannelMembers(channelId, `username='%${search}%'`, { nextCursor: cursor })
      : loadChannelMembers(channelId, null, { nextCursor: cursor })

    return {
      cursor: nextCursor,
      items: members.map(({ username, userId }) => ({
        label: username,
        note: `ID: ${userId}`,
        value: userId,
      })),
    }
  }
```

### Action Using Dictionaries:

```javascript
  /**
   * @operationName Kick Member From Channel
   * @description Removes a member from the specified channel.
   *
   * @paramDef {"type":"String","label":"Channel","name":"channelId","required":true,"dictionary":"getChannelsDictionary","description":"The channel to remove the member from."}
   * @paramDef {"type":"String","label":"Member","name":"memberId","required":true,"dictionary":"getChannelMembersDictionary","dependsOn":["channelId"],"description":"The member to remove."}
   *
   * @returns {Object}
   * @sampleResult {"ok":true}
   */
  async kickMemberFromChannel(channelId, memberId) {
    return runAPIToKickMemberFromChannel({ channelId, memberId })
  }
```
