## <small>1.14.2 (2026-03-26)</small>

* fix(ci): remove dist asset uploads from GitHub releases ([99b669b](https://github.com/LinkForty/core/commit/99b669b))

## <small>1.14.1 (2026-03-26)</small>

* Clean up features from README ([02141a0](https://github.com/LinkForty/core/commit/02141a0))
* Merge pull request #20 from RaoUsama7/fix/link-cache-invalidation ([74febe4](https://github.com/LinkForty/core/commit/74febe4)), closes [#20](https://github.com/LinkForty/core/issues/20)
* Merge pull request #21 from RaoUsama7/fix/client-ip-followup ([cdea12c](https://github.com/LinkForty/core/commit/cdea12c)), closes [#21](https://github.com/LinkForty/core/issues/21)
* Update README.md (#19) ([9b7dd91](https://github.com/LinkForty/core/commit/9b7dd91)), closes [#19](https://github.com/LinkForty/core/issues/19)
* fix(cache): invalidate link resolution cache on update and delete ([151af71](https://github.com/LinkForty/core/commit/151af71))
* fix(cache): invalidate link resolution cache on update and delete ([7c2510a](https://github.com/LinkForty/core/commit/7c2510a))

## 1.14.0 (2026-03-23)

* feat: extend interstitial page to all mobile requests and preserve URL fragments ([9b20190](https://github.com/LinkForty/core/commit/9b20190))

## <small>1.13.7 (2026-03-16)</small>

* fix: implement URL fallback chain in redirect handler to prevent 500 errors (#17) ([3e3ee12](https://github.com/LinkForty/core/commit/3e3ee12)), closes [#17](https://github.com/LinkForty/core/issues/17)

## <small>1.13.6 (2026-03-16)</small>

* fix: correct repository URL casing for npm provenance verification ([4e0487a](https://github.com/LinkForty/core/commit/4e0487a))

## <small>1.13.5 (2026-03-16)</small>

* fix: update release workflow for npm trusted publishing with OIDC ([b26ad63](https://github.com/linkforty/core/commit/b26ad63))
* fix: upgrade @semantic-release/npm to v13 for OIDC trusted publishing support ([386048a](https://github.com/linkforty/core/commit/386048a))
* fix: upgrade semantic-release to v25 for OIDC trusted publishing ([1050651](https://github.com/linkforty/core/commit/1050651))

## [1.13.4](https://github.com/linkforty/core/compare/v1.13.3...v1.13.4) (2026-03-16)


### Bug Fixes

* **server:** trust proxy and trusted client IP for redirect and attribution ([#10](https://github.com/linkforty/core/issues/10)) ([de12521](https://github.com/linkforty/core/commit/de12521699bb08ece3d9afa49375546da97525ab))

## [1.13.3](https://github.com/linkforty/core/compare/v1.13.2...v1.13.3) (2026-03-13)


### Documentation

* add User Identity section and update SDK spec for setExternalUserId ([735bf72](https://github.com/linkforty/core/commit/735bf72bbe27dd822b2a02215c67278c19951f67)), closes [#8](https://github.com/linkforty/core/issues/8)

## [1.13.2](https://github.com/linkforty/core/compare/v1.13.1...v1.13.2) (2026-03-10)


### Bug Fixes

* restore .js extension in fingerprint.ts database import for ESM resolution ([486cd65](https://github.com/linkforty/core/commit/486cd654a8cf91363009547df2183012c80602af))

## [1.13.1](https://github.com/linkforty/core/compare/v1.13.0...v1.13.1) (2026-03-10)


### Bug Fixes

* use vitest Mock type for db.query mock to fix CI type errors ([86237e1](https://github.com/linkforty/core/commit/86237e1e8092ebd330247864a1738776a2e2f71d))

## [1.13.0](https://github.com/linkforty/core/compare/v1.12.2...v1.13.0) (2026-03-10)


### Features

* add sdk_event webhook event type ([3a2809f](https://github.com/linkforty/core/commit/3a2809f164fadd4b8863a38dc151e5a5db9beb00))

## [1.12.2](https://github.com/linkforty/core/compare/v1.12.1...v1.12.2) (2026-03-04)


### Documentation

* add revenue event convention to SDK event endpoint comment ([5880109](https://github.com/linkforty/core/commit/588010969ad20a006c76e17aca5b8577ae2a7745))

## [1.6.6](https://github.com/linkforty/core/compare/v1.6.5...v1.6.6) (2026-03-03)


### Documentation

* require template ID for SDK link creation ([#4](https://github.com/linkforty/core/issues/4)) ([bff8420](https://github.com/linkforty/core/commit/bff8420))

## [1.6.5](https://github.com/linkforty/core/compare/v1.6.4...v1.6.5) (2026-03-02)


### Bug Fixes

* rename ios_url/android_url to ios_app_store_url/android_app_store_url in SQL queries ([#3](https://github.com/linkforty/core/issues/3)) ([49f52c0](https://github.com/linkforty/core/commit/49f52c0d4ee78af416288c219b3c24c1ee24145d))

## [1.6.4](https://github.com/linkforty/core/compare/v1.6.3...v1.6.4) (2026-02-28)


### Documentation

* add Docker Hub overview with competitor positioning ([48353b9](https://github.com/linkforty/core/commit/48353b9e2aa4099db65a78464c70332a04d8dbdb))
* remove shields.io badge from Docker Hub overview ([33c5f20](https://github.com/linkforty/core/commit/33c5f2024ca2e918ea28c2c77bbe665d3109dfc6))

## [1.6.3](https://github.com/linkforty/core/compare/v1.6.2...v1.6.3) (2026-02-27)


### Documentation

* optimize README for LLM discoverability and fix SDK listings ([2804f7e](https://github.com/linkforty/core/commit/2804f7ec0c57e67b4b8a889da83478b7a7742b49))

## [1.6.2](https://github.com/linkforty/core/compare/v1.6.1...v1.6.2) (2026-02-27)


### Documentation

* add llms.txt for LLM-optimized integration reference ([52c95dd](https://github.com/linkforty/core/commit/52c95dde70f88002e1f31cf69b7be8b15736492c))

## [1.6.1](https://github.com/linkforty/core/compare/v1.6.0...v1.6.1) (2026-02-25)


### Documentation

* add SDK feature specification for contributors ([9272bb7](https://github.com/linkforty/core/commit/9272bb7fec6c94e571947984496f76c8f8eb6e63))

# Changelog

All notable changes to this project will be documented in this file. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Automated releases are managed by [semantic-release](https://github.com/semantic-release/semantic-release).

## 1.6.0 (2026-02-20)

### Features

* **Add link templates** — New `link_templates` table and full CRUD API (`GET/POST/PUT/DELETE /api/templates`, `PUT /api/templates/:id/set-default`). Templates provide reusable default settings (platform URLs, UTM parameters, targeting rules, attribution windows) that are applied when creating links. Auto-generates unique 8-character alphanumeric slugs for template-based short URLs (`/:templateSlug/:shortCode`).
* **Add `templateId` to link creation** — Links can now be assigned to a template via the optional `templateId` field. Template slug is included in link query responses as `template_slug`.
* **Add `LinkTemplate`, `LinkTemplateSettings`, `CreateTemplateRequest`, `UpdateTemplateRequest` types** — New TypeScript interfaces for template management, exported from `@linkforty/core/types`.

## 1.5.1 (2026-02-20)

### Documentation

* **Rewrite README for v1.5.0 framework changes** — Updated description to reflect framework-first philosophy, removed `users` table from schema docs, made `userId` optional in all API examples, added missing endpoints (webhooks, QR codes, SDK, debug, well-known, OG preview), added missing database tables (device_fingerprints, install_events, in_app_events, webhooks), fixed field names (`iosAppStoreUrl`/`androidAppStoreUrl`), fixed SDK package name to `@linkforty/mobile-sdk-react-native`

## 1.5.0 (2026-02-20)

### BREAKING CHANGES - Making Core less opinionated

* **Remove `users` table from Core** — Core no longer creates or manages a `users` table. Authentication and user management are now the consumer's responsibility, aligning Core with a framework-first philosophy (bring your own auth). Consumers that relied on Core's `users` table must create it themselves before any tables that reference `users(id)`.
* **Make `user_id` nullable on `links` and `webhooks` tables** — The `user_id` column on both `links` and `webhooks` is now nullable with no foreign key constraint. This enables single-tenant usage without a user model.
* **Remove `User`, `Organization`, `AppConfig`, and `OrganizationSettings` types** — These Cloud-only types have been removed from `@linkforty/core/types`. Consumers that imported them must define their own.

### Features

* **Optional `userId` across all API endpoints** — All link, analytics, webhook, and debug endpoints now accept `userId` as an optional parameter. When provided, queries are scoped to that user (multi-tenant mode). When omitted, all records are accessible (single-tenant mode).
* **Single-tenant mode** — Core can now be used without any user/auth model. Create and manage links, view analytics, and configure webhooks without providing a `userId`.
* **WebSocket live debug stream no longer requires `userId`** — When `userId` is omitted, the `/api/debug/live` WebSocket streams all click events.

### Removed

* `users` table DDL and `idx_users_email` index from `initializeDatabase()`
* `JWT_SECRET` and email configuration sections from `.env.example`
* `User`, `Organization`, `AppConfig`, `OrganizationSettings` interfaces from types

## 1.4.4 (2026-02-11)

### Features

* Add SDK resolve endpoint for App Links and Universal Links deep linking (`GET /api/sdk/v1/resolve/:shortCode` and `GET /api/sdk/v1/resolve/:templateSlug/:shortCode`) — returns deep link data as JSON when the mobile OS intercepts a LinkForty URL before the server can process the redirect
* Include `deep_link_parameters` in deferred deep linking responses from `/api/sdk/v1/install` and `/api/sdk/v1/attribution/:fingerprint`

### Bug Fixes

* Fix deferred deep links not returning custom parameters — the install attribution query now selects `deep_link_parameters` from the links table and includes them in the SDK response

## 1.0.0 (2025-12-11)

### Features

* Add debugging and testing routes for link validation ([c51d68c](https://github.com/linkforty/core/commit/c51d68c60cf4fb9d6536739d05d0372a44ec671c))
* Add deferred deep linking with probabilistic fingerprint matching ([03c1d3e](https://github.com/linkforty/core/commit/03c1d3e3f249ceda82f810885603b14b3b1bcb32))
* Add event emitter for real-time click event streaming ([5641adf](https://github.com/linkforty/core/commit/5641adfb61c4770d2bca521ef62d968eb92c8d43))
* Add OG tags and attribution windows to link API ([0b3cd3c](https://github.com/linkforty/core/commit/0b3cd3c218a3ef02eaaca262b14887ba43748780))
* Add Open Graph preview route for social media scrapers ([1402d65](https://github.com/linkforty/core/commit/1402d655ca7d644be98e9bd2f811daab16c1e730))
* Add Open Graph tags, attribution windows, and description to links schema ([ed6575f](https://github.com/linkforty/core/commit/ed6575fdb456d5a07a4b09004618e8598f71b479))
* Add QR code generation for short links ([3601b2c](https://github.com/linkforty/core/commit/3601b2c7813633c19a389899b6d5eedcd9ed3e1e))
* Emit real-time click events and fix device detection ([331900c](https://github.com/linkforty/core/commit/331900ce0bb8e84119b09ac2471e633a960dcfe3))
* Export new routes and modules ([6e874bb](https://github.com/linkforty/core/commit/6e874bbe68415973698364e3465d77be2b7618d2))
* Update Link types with OG tags and attribution windows ([5fa2686](https://github.com/linkforty/core/commit/5fa268646d3f57b99cefaa0ce1c06ecfb849b45c))


### Bug Fixes

* Remove Cloud-only webhook-logger and add missing types ([e9668c4](https://github.com/linkforty/core/commit/e9668c4841cd021745b08937962ba7a879f09521))
* Use compatible Fastify WebSocket version and fix module output ([970cd8c](https://github.com/linkforty/core/commit/970cd8ccd486c411dbd68912b66838a077eba68d))
* Use SHORTLINK_DOMAIN env var for QR code URLs ([72d9f69](https://github.com/linkforty/core/commit/72d9f69244708aa0aa3e2c8442f0cd4f7edca119))


### Documentation

* add CI and code coverage badges to README ([2903a34](https://github.com/linkforty/core/commit/2903a3444bb62a80f04f71feed0b8dd8783b52d0))
* add comprehensive CI/CD and contribution documentation ([dcb4c5b](https://github.com/linkforty/core/commit/dcb4c5bf79f43aac89b507ec7a0d2c7e717ad944))
