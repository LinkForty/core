# Changelog

All notable changes to this project will be documented in this file. This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Automated releases are managed by [semantic-release](https://github.com/semantic-release/semantic-release).

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
