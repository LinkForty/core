# LinkForty SDK Feature Specification

> **Purpose:** Single source of truth for what every LinkForty SDK must support. When a new feature is added to the platform, update this document first, then update each SDK to match.
>
> This spec defines **what** each SDK must accomplish, not **how**. Implementation details (method names, parameter conventions, error types) are platform-specific and left to each SDK.

**Last updated:** 2026-02-16

---

## Table of Contents

- [1. Initialization](#1-initialization)
- [2. Deferred Deep Linking (Install Attribution)](#2-deferred-deep-linking-install-attribution)
- [3. Direct Deep Linking](#3-direct-deep-linking)
- [4. Server-Side URL Resolution](#4-server-side-url-resolution)
- [5. Event Tracking](#5-event-tracking)
- [6. Revenue Tracking](#6-revenue-tracking)
- [7. Programmatic Link Creation](#7-programmatic-link-creation)
- [8. Attribution Data Access](#8-attribution-data-access)
- [9. Data Management](#9-data-management)
- [10. Configuration](#10-configuration)
- [11. Error Handling](#11-error-handling)
- [12. Offline Resilience](#12-offline-resilience)
- [API Endpoints Reference](#api-endpoints-reference)
- [Models Reference](#models-reference)
- [Feature Parity Matrix](#feature-parity-matrix)

---

## 1. Initialization

The SDK must be initialized before any other functionality is used. Initialization performs these steps:

1. **Validate configuration** (base URL, attribution window bounds, HTTPS enforcement)
2. **Set up internal components** (networking, storage, fingerprint collection, deep link handling)
3. **Detect first launch** and persist that state
4. **On first launch:** collect a device fingerprint and report the install to the server (see [Deferred Deep Linking](#2-deferred-deep-linking-install-attribution))
5. **On subsequent launches:** load cached attribution data from local storage

### Behavioral requirements

- Initialization must be idempotent or guard against double-init
- Methods that require initialization must fail clearly if called before init
- The SDK should be usable as a singleton or single shared instance

---

## 2. Deferred Deep Linking (Install Attribution)

Matches a new app install back to the link click that drove it, using probabilistic device fingerprinting.

### What the SDK must do

1. On first launch, collect a device fingerprint containing:
   - User agent string
   - Timezone identifier
   - Device language
   - Screen dimensions (native pixels)
   - Platform (`iOS` / `Android`)
   - Platform version
   - App version
   - Optional device ID (IDFA/GAID, only if user consented)
2. Send the fingerprint to the server
3. Receive an attribution response containing: install ID, whether attributed, confidence score, matched factors, and deep link data (if attributed)
4. Persist the install ID and deep link data locally
5. Deliver the result to a registered callback (or null/nil for organic installs)
6. Allow the callback to be registered before or after initialization (if registered after and data is already available, invoke immediately)

### API endpoint

`POST /api/sdk/v1/install` -- see [endpoints reference](#api-endpoints-reference)

---

## 3. Direct Deep Linking

Handles the case where a user taps a LinkForty link and the app is already installed. The OS opens the app directly (via Universal Links on iOS, App Links on Android, or custom URL schemes).

### What the SDK must do

1. Accept an incoming URL from the app's deep link handler
2. Parse the URL to extract the short code, UTM parameters, and custom query parameters
3. If the SDK is configured with a server connection, resolve the URL server-side for enriched data (see [Server-Side URL Resolution](#4-server-side-url-resolution))
4. Deliver the URL and parsed data to a registered callback
5. Support multiple callback registrations

### Platform notes

- **iOS:** The app must manually pass the URL to the SDK (from `onOpenURL` or `AppDelegate`)
- **Android:** Same -- the app passes the intent URL to the SDK
- **React Native / Expo:** The SDK may automatically listen via the platform's linking API, but must still support explicit URL handling

---

## 4. Server-Side URL Resolution

When a Universal Link or App Link bypasses the redirect server (the OS opens the app directly), the SDK must resolve the link server-side to get the full link metadata that would normally come from the redirect.

### What the SDK must do

1. Extract path segments from the URL to determine the resolve path:
   - Single segment: `/api/sdk/v1/resolve/{shortCode}`
   - Two segments: `/api/sdk/v1/resolve/{templateSlug}/{shortCode}`
2. Collect a device fingerprint and send it as query parameters (`fp_tz`, `fp_lang`, `fp_sw`, `fp_sh`, `fp_platform`, `fp_pv`)
3. Return the enriched `DeepLinkData` from the server response
4. **Fall back to local URL parsing** if the server request fails (network error, timeout, etc.)

### API endpoint

`GET /api/sdk/v1/resolve/:shortCode` (or `/:templateSlug/:shortCode`) -- see [endpoints reference](#api-endpoints-reference)

---

## 5. Event Tracking

Tracks in-app events for conversion attribution. Events are tied to the install ID so the server can correlate them with the original link click.

### What the SDK must do

1. Accept an event name and optional properties dictionary
2. Send the event to the server with the install ID and timestamp
3. Handle failures gracefully (see [Offline Resilience](#12-offline-resilience))

### API endpoint

`POST /api/sdk/v1/event` -- see [endpoints reference](#api-endpoints-reference)

---

## 6. Revenue Tracking

A convenience for tracking revenue-specific events with structured amount and currency fields.

### What the SDK must do

1. Accept an amount, currency code, and optional additional properties
2. Send as an event with revenue fields included in the event data

### Implementation note

This can be a dedicated method or handled through the general event tracking method with structured properties. The key requirement is that revenue events include `amount` and `currency` as distinct fields in the event data sent to the server.

---

## 7. Programmatic Link Creation

Allows apps to create short links on behalf of the user (e.g., for sharing content).

### What the SDK must do

1. Accept link creation options (deep link parameters, title, description, custom code, UTM parameters)
2. Require an API key to be configured
3. Send the request to the server and return the created link's URL, short code, and link ID
4. Support two creation paths:
   - **Without template ID:** Use `POST /api/sdk/v1/links` (Cloud-only, auto-selects template)
   - **With template ID:** Use `POST /api/links` (dashboard endpoint, requires template ID and optionally template slug for URL construction)

### API endpoints

- `POST /api/sdk/v1/links` (simplified, Cloud-only)
- `POST /api/links` (dashboard endpoint)

### Important

- This feature requires an API key. SDKs must fail clearly if no API key is configured.
- The simplified endpoint (`/api/sdk/v1/links`) only exists in Cloud, not in self-hosted Core.

---

## 8. Attribution Data Access

The SDK must provide access to cached attribution data from local storage without requiring a network call.

### What the SDK must expose

- **Install ID** -- the server-assigned UUID for this install
- **Install data** -- the `DeepLinkData` from attribution (null if organic)
- **First launch status** -- whether this is the first launch of the app

---

## 9. Data Management

### What the SDK must support

- **Clear data** -- wipe all locally stored SDK data (install ID, attribution data, cached deep links, event queue). Used for testing and GDPR compliance.
- **Reset** -- return the SDK to an uninitialized state so it can be re-initialized. This is separate from clearing data.

---

## 10. Configuration

### Required configuration

| Field | Description |
|-------|-------------|
| Base URL | The LinkForty server URL (e.g., `https://go.yourdomain.com`) |

### Optional configuration

| Field | Description | Default |
|-------|-------------|---------|
| API key | Required for link creation and Cloud features | None |
| Debug mode | Enable verbose logging | Off |
| Attribution window | How far back to match installs to clicks | 7 days (168 hours) |

### Validation requirements

- Base URL must be HTTPS (except `localhost` / `127.0.0.1` for local development)
- Attribution window must be between 1 hour and 2160 hours (90 days)

---

## 11. Error Handling

SDKs must handle these error scenarios. The mechanism (typed enums, error codes, exceptions) is platform-specific.

| Scenario | Expected behavior |
|----------|-------------------|
| Method called before initialization | Throw/return an error |
| Double initialization | Warn or throw |
| Network failure during install report | Treat as organic install, deliver null to callback |
| Network failure during URL resolution | Fall back to local URL parsing |
| Network failure during event tracking | Queue the event for retry (see [Offline Resilience](#12-offline-resilience)) |
| Link creation without API key | Throw/return an error |
| Server returns error response | Surface the error to the caller |
| Invalid configuration | Throw/return an error during initialization |

---

## 12. Offline Resilience

### Event queue

Events should be queued locally when the network is unavailable and retried when connectivity is restored.

- Maximum queue size: 100 events
- Queue must persist across app restarts (local storage)
- Provide a way to manually flush the queue
- Provide a way to clear the queue without sending
- Provide a way to check the queue size

### Other operations

- Install reporting: if the network call fails on first launch, treat as organic. The install can be re-attributed on a subsequent launch if the SDK detects it hasn't successfully reported yet.
- URL resolution: fall back to local parsing (never block the deep link flow on a network call)

---

## API Endpoints Reference

All endpoints are relative to the configured base URL.

### Core endpoints (available in both self-hosted Core and Cloud)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/sdk/v1/install` | None | Report install, get deferred deep link |
| `GET` | `/api/sdk/v1/resolve/:shortCode` | None | Resolve link without redirect |
| `GET` | `/api/sdk/v1/resolve/:templateSlug/:shortCode` | None | Resolve template link without redirect |
| `POST` | `/api/sdk/v1/event` | None | Track in-app events |
| `GET` | `/api/sdk/v1/health` | None | Health check |

### Cloud-only endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/sdk/v1/links` | API key | Create link (auto-selects template) |
| `POST` | `/api/links` | API key | Create link (explicit template ID) |

### Authentication

When an API key is configured, send it as: `Authorization: Bearer <api_key>`

---

## Models Reference

Canonical field names for cross-SDK data models. SDKs should use platform-appropriate naming conventions (camelCase for Swift/Kotlin, camelCase for JS/TS) but the data must map to these fields.

### DeepLinkData

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| shortCode | string | Yes | The link's short code |
| iosUrl | string | No | iOS destination URL |
| androidUrl | string | No | Android destination URL |
| webUrl | string | No | Web fallback URL |
| utmParameters | UTMParameters | No | UTM tracking parameters |
| customParameters | map<string, string> | No | Custom query parameters |
| deepLinkPath | string | No | In-app routing path (e.g., `/product/123`) |
| appScheme | string | No | App URI scheme (e.g., `myapp`) |
| clickedAt | datetime | No | When the link was clicked (ISO 8601) |
| linkId | string | No | Link UUID from the backend |

### InstallResponse

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| installId | string | Yes | Server-assigned install UUID |
| attributed | boolean | Yes | Whether install was matched to a click |
| confidenceScore | number | Yes | Match confidence (0-100) |
| matchedFactors | string[] | Yes | Which fingerprint factors matched |
| deepLinkData | DeepLinkData | No | Link data if attributed (null/empty if organic) |

### CreateLinkOptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| templateId | string | No | Template UUID (uses `/api/links` if provided) |
| templateSlug | string | No | Template slug (for URL construction with templateId) |
| deepLinkParameters | map<string, string> | No | In-app routing parameters |
| title | string | No | Link title |
| description | string | No | Link description |
| customCode | string | No | Custom short code |
| utmParameters | UTMParameters | No | Campaign tracking parameters |

### CreateLinkResult

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| url | string | Yes | Full shareable URL |
| shortCode | string | Yes | Generated short code |
| linkId | string | Yes | Link UUID |

### UTMParameters

| Field | Type | Required |
|-------|------|----------|
| source | string | No |
| medium | string | No |
| campaign | string | No |
| term | string | No |
| content | string | No |

### DeviceFingerprint

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| userAgent | string | Yes | App/version + OS/version |
| timezone | string | No | IANA timezone identifier |
| language | string | No | Device language/locale |
| screenWidth | number | No | Native screen width in pixels |
| screenHeight | number | No | Native screen height in pixels |
| platform | string | No | `iOS`, `Android`, etc. |
| platformVersion | string | No | OS version string |
| appVersion | string | No | Host app version |
| deviceId | string | No | IDFA/GAID (only if user consented) |
| attributionWindowHours | number | No | Attribution window in hours |

---

## Feature Parity Matrix

Status of each feature across SDKs. Update this table when adding features or SDKs.

| # | Feature | iOS | React Native | Android | Expo |
|---|---------|-----|-------------|---------|------|
| 1 | [Initialization](#1-initialization) | Done | Done | Done | Done |
| 2 | [Deferred deep linking](#2-deferred-deep-linking-install-attribution) | Done | Done | Done | Done |
| 3 | [Direct deep linking](#3-direct-deep-linking) | Done | Done | Done | Done |
| 4 | [Server-side URL resolution](#4-server-side-url-resolution) | Done | Done | Done | Done |
| 5 | [Event tracking](#5-event-tracking) | Done | Done | Done | Done |
| 6 | [Revenue tracking](#6-revenue-tracking) | Done | Missing | Done | Done |
| 7 | [Link creation](#7-programmatic-link-creation) | Done | Done | Done | Done |
| 8 | [Attribution data access](#8-attribution-data-access) | Done | Partial | Done | Done |
| 9 | [Data management](#9-data-management) | Done | Partial | Done | Done |
| 10 | [Configuration validation](#10-configuration) | Done | Missing | Done | Done |
| 11 | [Error handling](#11-error-handling) | Done | Partial | Done | Done |
| 12 | [Offline resilience (event queue)](#12-offline-resilience) | Done | Missing | Done | Done |

### Parity notes

- **React Native -- Revenue tracking:** No dedicated revenue method; must use generic event tracking
- **React Native -- Attribution data access:** `isFirstLaunch()` is private, not exposed to consumers
- **React Native -- Data management:** No `reset()` method (only `clearData()`)
- **React Native -- Error handling:** Uses generic `Error` throws instead of typed error cases
- **React Native -- Configuration validation:** No HTTPS enforcement or attribution window bounds checking
- **React Native -- Offline resilience:** Events are fire-and-forget; no queue, no retry on failure

---

## Contributing an SDK

We welcome community SDKs for any platform. Before an SDK can be listed on the LinkForty docs, we verify it works end-to-end.

### Submission requirements

1. **Repository link** and intended package registry name (npm, pub.dev, Maven, CocoaPods, etc.)
2. **Example app** or `/example` folder demonstrating the core flows: initialization, deferred deep linking, direct deep linking, and link creation
3. **CI pipeline** with linting and tests (GitHub Actions or equivalent)
4. **Install and quickstart documentation** in the README

### How SDKs are listed

| Tier | Requirements | Listed as |
|------|-------------|-----------|
| **Community** | Passes end-to-end verification, meets submission requirements | "Community SDK" with link to your repo |
| **Official** | Multiple stable releases, co-maintained with LinkForty team, transferred to the LinkForty GitHub org | "Official SDK" with full documentation |

To get started, open an issue on [GitHub](https://github.com/linkforty/core/issues) to coordinate with the team and avoid duplicate work.
