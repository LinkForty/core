# API

## Links

### Create a Link

`userId` is optional. When provided, the link is scoped to that user (multi-tenant mode). When omitted, the link has no owner (single-tenant mode).

```bash
POST /api/links
Content-Type: application/json

{
  "userId": "user-uuid",
  "originalUrl": "https://example.com",
  "title": "My Link",
  "description": "Summer campaign link",
  "iosAppStoreUrl": "https://apps.apple.com/app/id123456",
  "androidAppStoreUrl": "https://play.google.com/store/apps/details?id=com.example",
  "webFallbackUrl": "https://example.com/product/123",
  "appScheme": "myapp",
  "iosUniversalLink": "https://example.com/app/product/123",
  "androidAppLink": "https://example.com/app/product/123",
  "deepLinkPath": "/product/123",
  "deepLinkParameters": { "ref": "campaign-1" },
  "utmParameters": {
    "source": "twitter",
    "medium": "social",
    "campaign": "summer-sale"
  },
  "ogTitle": "Check out this deal",
  "ogDescription": "50% off summer sale",
  "ogImageUrl": "https://example.com/og-image.png",
  "targetingRules": {
    "countries": ["US", "CA"],
    "devices": ["ios", "android"],
    "languages": ["en"]
  },
  "attributionWindowHours": 168,
  "customCode": "summer-sale",
  "expiresAt": "2026-12-31T23:59:59Z"
}
```

All fields except `originalUrl` are optional.

Install attribution settings, per link:

- `attributionWindowHours` (1–2160, default 168): how long after a click an install can still be matched to it.
- `attributionWindowMinutes` (5–129600): the same window in minutes, for windows under an hour. Send one or the other; when set it replaces the hours, and updating the link with `attributionWindowHours` clears it.
- `oneInstallPerClick` (default `false`): a click is matched to one install only. A second install that would have matched the same click is matched to another click, or recorded as organic. Suited to single-use links, such as sign-in links.

### Get All Links

```bash
# Single-tenant (all links)
GET /api/links

# Multi-tenant (scoped to user)
GET /api/links?userId=user-uuid
```

### Get a Specific Link

```bash
GET /api/links/:id
GET /api/links/:id?userId=user-uuid
```

### Update a Link

```bash
PUT /api/links/:id?userId=user-uuid
Content-Type: application/json

{
  "title": "Updated Title",
  "isActive": false
}
```

### Duplicate a Link

```bash
POST /api/links/:id/duplicate?userId=user-uuid
```

### Delete a Link

```bash
DELETE /api/links/:id?userId=user-uuid
```

## Templates

```bash
GET    /api/templates?userId=user-uuid
GET    /api/templates/:id?userId=user-uuid
POST   /api/templates                    # Body: { name, description?, settings, userId? }
PUT    /api/templates/:id?userId=user-uuid
DELETE /api/templates/:id?userId=user-uuid
PUT    /api/templates/:id/set-default?userId=user-uuid
```

## Analytics

### Get Analytics Overview

```bash
# All links
GET /api/analytics/overview?days=30

# Scoped to user
GET /api/analytics/overview?userId=user-uuid&days=30
```

Returns: `totalClicks`, `uniqueClicks`, `clicksByDate`, `clicksByCountry`, `clicksByDevice`, `clicksByPlatform`, `topLinks`

### Get Link-Specific Analytics

```bash
GET /api/analytics/links/:linkId?days=30
```

## Redirect

```bash
GET /:shortCode
GET /:templateSlug/:shortCode
```

Redirects users to the appropriate URL based on device type (iOS/Android/web), evaluates targeting rules, and tracks the click asynchronously. See [Redirects](redirects.md) for the not-found page, the mobile interstitial and the Launchpad page.

## QR Codes

```bash
GET /api/links/:id/qr?format=png&size=300
GET /api/links/:id/qr?format=svg
GET /api/links/:id/qr?url=https://links.example.com/spring/abc123   # encode the link on a custom host / template path
```

Without `url` the code encodes `SHORTLINK_DOMAIN/{shortCode}`. `url` must be an http(s) URL whose path ends in the link's short code; anything else is a 400. The Launchpad page uses it to encode its own address, so a phone that scans the code lands on the same host and path the visitor is on.

## Webhooks

```bash
GET    /api/webhooks?userId=user-uuid
POST   /api/webhooks                     # Body: { name, url, events, userId? }
GET    /api/webhooks/:id?userId=user-uuid
PUT    /api/webhooks/:id?userId=user-uuid
DELETE /api/webhooks/:id?userId=user-uuid
POST   /api/webhooks/:id/test?userId=user-uuid
```

Events: `click_event`, `install_event`, `conversion_event`, `sdk_event`. Payloads are HMAC SHA-256 signed.

Which webhooks hear about a link: one with an `organization_id` receives events for every link in that organization; one without receives events for links created by its `user_id`; one with neither receives events for links that have neither. To keep a delivery log, pass a function to `setWebhookDeliveryLogger()`. It is called with the webhook id, the attempt's result and the payload sent.

## Mobile SDK Endpoints

```bash
POST /api/sdk/v1/install               # Report app install, get deferred deep link
GET  /api/sdk/v1/attribution/:fingerprint  # Debug attribution lookups
POST /api/sdk/v1/event                 # Track in-app conversion events
GET  /api/sdk/v1/resolve/:shortCode    # Resolve link to deep link data (no redirect)
GET  /api/sdk/v1/resolve/:templateSlug/:shortCode
GET  /api/sdk/v1/health                # Health check
```

An event whose `installId` this server no longer has is **recovered, not
refused**: the install is recorded again (marked `recovered`, with no link,
click or confidence score, so it is never mistaken for a fresh attributed
install) and the event is stored against it.

This matters because the id lives in the app's storage for the life of the
install while the server's copy may not: a restore from an older backup, a
manual cleanup, an app build pointed at a fresh database, or an analytics
retention job all leave a live device holding an id nothing resolves. The
bundled SDKs store the id once and never re-register, so without recovery
that device is refused forever with no way back. The 404 that remains carries
`code: "INSTALL_NOT_FOUND"` and `action: "reregister"`.

## Health

```bash
GET  /health                           # Liveness — process is up (no DB access)
GET  /health/ready                     # Readiness — 503 if the database is unreachable
```

## Debug & Testing

```bash
POST /api/debug/simulate               # Simulate a link click with custom parameters
WS   /api/debug/live?userId=user-uuid  # WebSocket live click event stream
GET  /api/debug/user-agents            # Common UA strings for testing
GET  /api/debug/countries              # Common countries list
GET  /api/debug/languages              # Common languages list
```

## Well-Known Routes

```bash
GET /.well-known/apple-app-site-association   # iOS Universal Links
GET /.well-known/assetlinks.json              # Android App Links
```

## OG Preview

```bash
GET /:shortCode/preview                # OG meta tag page for social scrapers
```
