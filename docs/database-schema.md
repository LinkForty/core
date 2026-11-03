# Database Schema

Core does not create a `users` table. Authentication and user management are the consumer's responsibility. The `user_id` column on `links` and `webhooks` is optional (nullable, no foreign key) — use it for multi-tenant scoping when your auth layer provides a user identity.

## Short codes and URL resolution

Every short code is unique across the server. Links created through Core's API have no organization, so they all share one set of codes.

An application that builds on Core and assigns links to organizations (by setting `links.organization_id`) gets one set of codes per organization: two organizations can each have `promo`. Template slugs stay unique across the server, and URLs resolve like this:

- `/{templateSlug}/{shortCode}` resolves to exactly one link.
- `/{shortCode}` on a request that belongs to an organization resolves only that organization's link with that code.
- A request that belongs to an organization is served only that organization's links, in either form: another organization's link is answered with 404, and the refusal is logged.
- `/{shortCode}` on any other request prefers a link without a template, then the oldest link with that code.

To tell Core which organization a request belongs to, for example by custom domain, register a resolver:

```typescript
import { setLinkScopeResolver } from '@linkforty/core';

setLinkScopeResolver(async (request) => organizationIdForHost(request.headers.host) ?? null);
```

The redirect, SDK resolve and preview routes all use it. A resolver that throws is logged and treated as null.

## Links Table

| Column                  | Type         | Description                              |
|-------------------------|--------------|------------------------------------------|
| id                      | UUID         | Primary key                              |
| user_id                 | UUID         | Optional owner/tenant identifier         |
| short_code              | VARCHAR(20)  | Short code, unique per organization_id   |
| original_url            | TEXT         | Original URL                             |
| title                   | VARCHAR(255) | Link title                               |
| description             | TEXT         | Link description                         |
| ios_app_store_url       | TEXT         | iOS App Store URL                        |
| android_app_store_url   | TEXT         | Android Play Store URL                   |
| web_fallback_url        | TEXT         | Web fallback URL                         |
| app_scheme              | VARCHAR(255) | URI scheme (e.g., "myapp")               |
| ios_universal_link      | TEXT         | iOS Universal Link URL                   |
| android_app_link        | TEXT         | Android App Link URL                     |
| deep_link_path          | TEXT         | In-app destination path                  |
| deep_link_parameters    | JSONB        | Custom app parameters                    |
| utm_parameters          | JSONB        | UTM tracking parameters                  |
| targeting_rules         | JSONB        | Country/device/language targeting         |
| og_title                | VARCHAR(255) | Open Graph title                         |
| og_description          | TEXT         | Open Graph description                   |
| og_image_url            | TEXT         | Open Graph image URL                     |
| og_type                 | VARCHAR(50)  | Open Graph type (default: "website")     |
| launchpad_mode          | VARCHAR(10)  | Launchpad page: inherit / on / off       |
| attribution_window_hours| INTEGER      | Install attribution window (default: 168)|
| attribution_window_minutes| INTEGER    | Window in minutes; replaces the hours when set |
| one_install_per_click   | BOOLEAN      | A click matches one install only (default: false) |
| is_active               | BOOLEAN      | Active status                            |
| expires_at              | TIMESTAMP    | Expiration date                          |
| created_at              | TIMESTAMP    | Creation timestamp                       |
| updated_at              | TIMESTAMP    | Last update timestamp                    |

## Click Events Table

| Column       | Type         | Description                  |
|--------------|--------------|------------------------------|
| id           | UUID         | Primary key                  |
| link_id      | UUID         | Foreign key to links         |
| clicked_at   | TIMESTAMP    | Click timestamp              |
| ip_address   | INET         | User IP address              |
| user_agent   | TEXT         | User agent string            |
| device_type  | VARCHAR(20)  | Device type (ios/android/web)|
| platform     | VARCHAR(20)  | Platform (iOS/Android/Web)   |
| country_code | CHAR(2)      | Country code                 |
| country_name | VARCHAR(100) | Country name                 |
| region       | VARCHAR(100) | Region/state                 |
| city         | VARCHAR(100) | City                         |
| latitude     | DECIMAL      | Latitude                     |
| longitude    | DECIMAL      | Longitude                    |
| timezone     | VARCHAR(100) | Timezone                     |
| utm_source   | VARCHAR(255) | UTM source                   |
| utm_medium   | VARCHAR(255) | UTM medium                   |
| utm_campaign | VARCHAR(255) | UTM campaign                 |
| referrer     | TEXT         | Referrer URL                 |
| is_bot       | BOOLEAN      | Automated traffic, excluded from human analytics |
| bot_reason   | VARCHAR(16)  | Why: `edge`, `method`, `ua` or `email_scanner` |

## Device Fingerprints Table

| Column           | Type        | Description                         |
|------------------|-------------|-------------------------------------|
| id               | UUID        | Primary key                         |
| click_id         | UUID        | Foreign key to click_events         |
| fingerprint_hash | VARCHAR(64) | SHA-256 hash of fingerprint signals |
| ip_address       | INET        | IP address                          |
| user_agent       | TEXT        | User agent string                   |
| timezone         | VARCHAR(100)| Timezone                            |
| language         | VARCHAR(10) | Browser language                    |
| screen_width     | INTEGER     | Screen width                        |
| screen_height    | INTEGER     | Screen height                       |
| platform         | VARCHAR(50) | Platform                            |
| platform_version | VARCHAR(50) | Platform version                    |
| created_at       | TIMESTAMP   | Creation timestamp                  |

## Install Events Table

| Column                  | Type        | Description                        |
|-------------------------|-------------|------------------------------------|
| id                      | UUID        | Primary key                        |
| link_id                 | UUID        | Attributed link (nullable)         |
| click_id                | UUID        | Attributed click (nullable)        |
| fingerprint_hash        | VARCHAR(64) | Device fingerprint hash            |
| confidence_score        | DECIMAL     | Match confidence (0-100)           |
| installed_at            | TIMESTAMP   | Install timestamp                  |
| first_open_at           | TIMESTAMP   | First app open                     |
| deep_link_retrieved     | BOOLEAN     | Whether deferred link was fetched  |
| deep_link_data          | JSONB       | Deferred deep link data            |
| attribution_window_hours| INTEGER     | Attribution window used (default: 168) |
| device_id               | VARCHAR(255)| Optional device identifier         |
| created_at              | TIMESTAMP   | Creation timestamp                 |

## In-App Events Table

| Column          | Type         | Description                  |
|-----------------|--------------|------------------------------|
| id              | UUID         | Primary key                  |
| install_id      | UUID         | Foreign key to install_events|
| event_name      | VARCHAR(255) | Event name                   |
| event_data      | JSONB        | Custom event properties      |
| event_timestamp | TIMESTAMP    | When the event occurred      |
| created_at      | TIMESTAMP    | Creation timestamp           |

## Webhooks Table

| Column     | Type         | Description                      |
|------------|--------------|----------------------------------|
| id         | UUID         | Primary key                      |
| user_id    | UUID         | Optional owner/tenant identifier |
| organization_id | UUID    | Optional owning organization; receives events for all its links |
| name       | VARCHAR(255) | Webhook name                     |
| url        | TEXT         | Delivery URL                     |
| secret     | VARCHAR(255) | HMAC signing secret              |
| events     | TEXT[]       | Subscribed event types           |
| is_active  | BOOLEAN      | Active status                    |
| retry_count| INTEGER      | Max retries (default: 3)         |
| timeout_ms | INTEGER      | Request timeout (default: 10000) |
| headers    | JSONB        | Custom HTTP headers              |
| created_at | TIMESTAMP    | Creation timestamp               |
| updated_at | TIMESTAMP    | Last update timestamp            |
