# FlowRunner OAuth2 Integration Reference

> **Note**: For AI agents working on service review/improvement, use the consolidated guides in `/docs/ai/` folder as primary reference. This document provides detailed OAuth2 implementation reference.

If the 3rd-party service supports OAuth2 login need to add the `@requireOAuth` in the service JSDoc.
When the tag presents in the UI there will be the ability to create a connection between an account
and the service to use API

```
/**
 *  @requireOAuth
 *  ...
 *    other basic JSDoc tags for a service
 **/
 class MyService {
  ...
```

## Required System Methods for OAuth2 Integration

- `getOAuth2ConnectionURL` - returns a URL to render a login/connect dialog
- `executeCallback` - retrieves access and refresh token along with getting logged in account info
- `refreshToken` - refreshes an access token when it's expired

### getOAuth2ConnectionURL

Composes the login/connect account dialog

#### Required JSDoc tags:

- `@registerAs SYSTEM` - to hide the method in the FlowRunner extensions list since the method is system
- `@route GET /getOAuth2ConnectionURL` - the endpoint must exactly as it described here since the system uses the HTTP method and URI for execution

#### Input Arguments

The method does not get any arguments

#### Output Result

It must return a URL to connect a particular account to the service.
Normally it returns a URL with a few required query params like `clientId` or `apiKey` and `scope` to request particular permission from the account.

#### Example

```javascript
 /**
   * @registerAs SYSTEM
   * @route GET /getOAuth2ConnectionURL
   */
  async getOAuth2ConnectionURL() {
    const params = new URLSearchParams()

    const codeVerifier = generateCodeVerifier()
    const codeChallenge = generateCodeChallenge(codeVerifier)

    params.append('client_id', CLIENT_ID)
    params.append('scope', SCOPE)

    // any additional query params depends on the specific service

    return `${OAUTH_BASE_URL}/authorize?${params.toString()}`
  }
```

### executeCallback

Once a user connects to the service using its account
the system invokes the method to complete the connection process.

#### Required JSDoc tags:

- `@registerAs SYSTEM` - to hide the method in the FlowRunner extensions list since the method is system
- `@route POST /executeCallback` - the endpoint must be exactly as it's described here since the system uses the HTTP method and URI for execution
- `@param {Object} callbackObject` - register required argument with data to retrieve access and refresh tokens and logged in account info

#### Input Arguments

The `callbackObject` argument is an `Object` with all necessary data to retrieve the connection token and current account information.
It contains the following properties:

- `code` {String} - This is secret code received from the 3rd-party service after connecting account. The code uses for getting `token` from the service.
- `redirectURI` {String} - This a redirect URI which is used in the authorization URL to create a new connection, some services require the value for getting access token in the `executeCallback` method
- `state` {String} - Optional string data passed from the `getOAuth2ConnectionURL` method, some services require the value for the login popup and then compare the value during getting access token

#### Output Result

The method must return an object with the following properties:

- `token` {String} - Required value, the token will be passed to each method invocation in the `oauth-access-token` HTTP header so it can be used for running 3rd party service API
- `expirationInSeconds` {Number} - Optional value reflects how long the token is valid, if it's `0` the system will consider the token as infinity and will not execute the `refreshToken` method to retrieve a new token to prolong the connection access
- `refreshToken` {String} - Optional value, if the 3rd-party service support access token refreshing the property must be provided. Once the current `token` is expired the system runs the `refreshToken` with the value
- `connectionIdentityName` {String} - Required value identifies current connection, it could any string which reflect current account, for example it could account nickname or display name.
- `connectionIdentityImageURL` {String} - Optional value represents current connection avatar, it has to be a valid public URL to an image file.
- `overwrite` {Boolean} - Optional value, when it's `true` it overrides already existing connection with the same `connectionIdentityName`, when it's `false` it's create a new connection if it does not exist yet and fails if there is a connection with the same `connectionIdentityName`
- `userData` {Object} - Optional value, there can be any additional data about the connected account. In the FlowRunner Console on the `Manage -> OAuth Connections` screen you can see this data for a particular connection

#### Example

```javascript
  /**
   * @registerAs SYSTEM
   * @route POST /executeCallback
   * @param {Object} [callbackObject]
   */
  async executeCallback(callbackObject) {
    const params = new URLSearchParams()

    params.append('client_secret', CLIENT_SECRET)
    params.append('code', callbackObject.code)
    params.append('redirect_uri', callbackObject.redirectURI)
    params.append('code_verifier', callbackObject.state)

    const authorizationToken = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

    // Each service has it's own implementaion and requirements for communication with its server,
    // so check their documention on how to retrieve the access token.
    // Below it's just a example
    const codeExchangeResponse = await Flowrunner.Request.post(`${OAUTH_BASE_URL}/token`)
      .set({ Authorization: `Basic ${authorizationToken}` })
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    const userInfo = await Flowrunner.Request.get(`${API_BASE_URL}/whoami`)
      .set({ Authorization: `Basic ${codeExchangeResponse['access_token']}` })

    return {
      token: codeExchangeResponse['access_token'],
      expirationInSeconds: codeExchangeResponse['expires_in'],
      refreshToken: codeExchangeResponse['refresh_token'],
      connectionIdentityName: userInfo.username,
      connectionIdentityImageURL: userInfo.avaURL,
      overwrite: true,
      userData: {
        userEmail: userInfo.email
      },
    }
  }

```

### refreshToken

The method provides the ability to refresh an access token when it's expired in runtime.
It means when the system runs a specific action with configured connection and the connection token was expired
the system runs the method to refresh the token and remember it.

#### Required JSDoc tags:

- `@registerAs SYSTEM` - to hide the method in the FlowRunner extensions list since the method is system
- `@route PUT /refreshToken` - the endpoint must be exactly as it's described here since the system uses the HTTP method and URI for execution
- `@param {String} refreshToken` - register required argument which contains a refresh token string data to refresh the access token

#### Input Arguments

- `refreshToken` {String} - This is a refresh token string required by the 3rd-part service to refresh the access token

#### Output Result

The method must return an object with the following properties:

- `token` {String} - Required value, the token will be passed to each method invocation in the `oauth-access-token` HTTP header so it can be used for running 3rd party service API
- `expirationInSeconds` {Number} - Optional value reflects how long the token is valid, if it's `0` the system will consider the token as infinity and will not execute the `refreshToken` method to retrieve a new token to prolong the connection access
- `refreshToken` {String} - Optional value, if the 3rd-party service support access token refreshing the property must be provided. Once the current `token` is expired the system runs the `refreshToken` with the value

#### Example

```javascript
 /**
   * @registerAs SYSTEM
   * @route PUT /refreshToken
   * @param {String} refreshToken
   */
  async refreshToken(refreshToken) {
    const params = new URLSearchParams()

    params.append('refresh_token', refreshToken)

    const authorizationToken = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')

    // Each service has it's own implementaion and requirements for communication with its server,
    // so check their documention on how to retrieve the access token.
    // Below it's just a example
    const response = await Flowrunner.Request.post(`${OAUTH_BASE_URL}/token`)
      .set({ Authorization: `Basic ${authorizationToken}` })
      .set({ 'Content-Type': 'application/x-www-form-urlencoded' })
      .send(params.toString())

    return {
      token: response.access_token,
      expirationInSeconds: response.expires_in,
      refreshToken: response.refresh_token,
    }
  }
```

## Composite Token Pattern (Embedding Extra Data in Access Token)

Some 3rd-party services require additional context for every API call beyond just the access token. For example, QuickBooks Online requires a `realmId` (company ID) in every API request URL. While `userData` returned from `executeCallback` is stored and visible in the Console under `Manage -> OAuth Connections`, it is **not** reliably passed back to the service during method invocations via request headers.

When a service needs two or more pieces of data (the access token plus one or more identifiers) available during every method invocation, the solution is to **embed the extra data into the `token` field** returned from both `executeCallback` and `refreshToken`. Since the platform passes the `token` value back via the `oauth-access-token` header on every invocation, all embedded data becomes available.

### When to Use

Use this pattern when:
- The service API requires a per-account/per-company identifier (e.g., `realmId`, `tenantId`, `siteId`) in every API call
- This identifier is obtained during the OAuth callback and must persist across all subsequent invocations

Do **not** use this pattern when:
- Only the access token is needed for API calls
- The extra data is only needed occasionally (consider passing it as a method parameter instead)

### Implementation

**1. Choose a delimiter** that cannot appear in a valid OAuth access token:

```javascript
const TOKEN_REALM_DELIMITER = '::realm::'
```

**2. In `executeCallback`**, concatenate the extra data onto the token:

```javascript
async executeCallback(callbackObject) {
  const realmId = callbackObject.realmId // service-specific extra data

  // ... exchange code for tokens ...

  return {
    token: `${tokenResponse.access_token}${TOKEN_REALM_DELIMITER}${realmId}`,
    expirationInSeconds: tokenResponse.expires_in,
    refreshToken: tokenResponse.refresh_token,
    connectionIdentityName: '...',
    overwrite: true,
    userData: { realmId }, // still store in userData for Console visibility
  }
}
```

**3. In `refreshToken`**, extract the extra data from the current composite token and re-embed it with the new access token:

```javascript
async refreshToken(refreshToken) {
  // Extract realmId from current composite token in headers
  const realmId = this.#getRealmId()

  // ... exchange refresh token for new access token ...

  return {
    token: `${response.access_token}${TOKEN_REALM_DELIMITER}${realmId}`,
    expirationInSeconds: response.expires_in,
    refreshToken: response.refresh_token || refreshToken,
  }
}
```

**4. Create private helper methods** to split the composite token:

```javascript
#getCompositeToken() {
  const compositeToken = this.request.headers['oauth-access-token']

  if (!compositeToken) {
    throw new Error('Access token is not available. Please reconnect your account.')
  }

  return compositeToken
}

#getAccessTokenHeader() {
  const compositeToken = this.#getCompositeToken()
  const accessToken = compositeToken.split(TOKEN_REALM_DELIMITER)[0]

  return { Authorization: `Bearer ${accessToken}` }
}

#getRealmId() {
  const compositeToken = this.#getCompositeToken()
  const realmId = compositeToken.split(TOKEN_REALM_DELIMITER)[1]

  if (!realmId) {
    throw new Error('Company ID (realmId) is not available. Please reconnect your account.')
  }

  return realmId
}
```

### Multiple Extra Values

If you need to embed more than one value, chain additional delimiters or use a structured format:

```javascript
// Two extra values
const DELIMITER = '::meta::'
token: `${accessToken}${DELIMITER}${realmId}${DELIMITER}${tenantId}`

// Parsing
const parts = compositeToken.split(DELIMITER)
const accessToken = parts[0]
const realmId = parts[1]
const tenantId = parts[2]
```

## Optional System Methods for OAuth2 Integration

Optionally you can create any methods in the service class
and adding the specific `@private` JSDoc tag you can make it private and it will be not available through API

- `getAccessToken` - a shortcut to resolve current access token from an execution context

### getAccessToken

To avoid code duplication you can create the method to retrieve the access token from the context

```javascript

#getAccessToken() {
    return this.request.headers['oauth-access-token']
}

actionMethod(){
  return await Flowrunner.Request.get(`${OAUTH_BASE_URL}/get-data`)
    .set({ Authorization: `Bearer ${this.#getAccessToken()}` })
}
```
