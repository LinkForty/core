/**
 * Well-Known Routes for @linkforty/core
 *
 * Purpose: Serve domain verification files for iOS Universal Links and Android App Links
 *
 * Configuration via Environment Variables:
 * - IOS_TEAM_ID: Your Apple Developer Team ID (e.g., "ABC123XYZ")
 * - IOS_BUNDLE_ID: Your iOS app bundle identifier (e.g., "com.example.app")
 * - ANDROID_PACKAGE_NAME: Your Android package name (e.g., "com.example.app")
 * - ANDROID_SHA256_FINGERPRINTS: Comma-separated SHA-256 fingerprints (e.g., "AA:BB:CC:...,DD:EE:FF:...")
 */

import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';
import { buildAppleAppSiteAssociation, buildAssetLinks } from '../lib/app-association.js';

/**
 * Slugs of templates whose links must open the web, never the app (see
 * lib/app-association.ts). Single-tenant: every web-only template on this
 * deployment. A failed lookup claims every path, as before the flag existed —
 * missing exclusions are better than no association file at all.
 */
async function webOnlyTemplateSlugs(log: FastifyInstance['log']): Promise<string[]> {
  try {
    const result = await db.query(`SELECT slug FROM link_templates WHERE settings->>'webOnly' = 'true'`);
    return result.rows.map((r: { slug: string }) => r.slug);
  } catch (err) {
    log.error({ err }, 'Failed to load web-only templates; association file claims every path');
    return [];
  }
}

export async function wellKnownRoutes(fastify: FastifyInstance) {
  /**
   * Apple App Site Association (AASA)
   * Used by iOS to verify Universal Links
   * https://developer.apple.com/documentation/xcode/supporting-associated-domains
   *
   * Endpoint: GET /.well-known/apple-app-site-association
   */
  fastify.get('/.well-known/apple-app-site-association', async (request, reply) => {
    const teamId = process.env.IOS_TEAM_ID;
    const bundleId = process.env.IOS_BUNDLE_ID;

    if (!teamId || !bundleId) {
      return reply.status(404).send({
        error: 'Configuration missing',
        message: 'iOS app configuration not found. Please set IOS_TEAM_ID and IOS_BUNDLE_ID environment variables.',
        docs: 'https://docs.linkforty.com/guides/sdk-integration#ios-universal-links'
      });
    }

    const aasa = buildAppleAppSiteAssociation(
      `${teamId}.${bundleId}`,
      await webOnlyTemplateSlugs(fastify.log),
      (count, bytes) => fastify.log.error({ count, bytes }, 'AASA exclusions over budget; claiming every path')
    );

    // AASA file must be served:
    // 1. Without .json extension
    // 2. With application/json content-type
    // 3. Over HTTPS (in production)
    return reply
      .header('Content-Type', 'application/json')
      .send(aasa);
  });

  /**
   * Digital Asset Links (assetlinks.json)
   * Used by Android to verify App Links
   * https://developer.android.com/training/app-links/verify-android-applinks
   *
   * Endpoint: GET /.well-known/assetlinks.json
   */
  fastify.get('/.well-known/assetlinks.json', async (request, reply) => {
    const packageName = process.env.ANDROID_PACKAGE_NAME;
    const fingerprintsEnv = process.env.ANDROID_SHA256_FINGERPRINTS;

    if (!packageName || !fingerprintsEnv) {
      return reply.status(404).send({
        error: 'Configuration missing',
        message: 'Android app configuration not found. Please set ANDROID_PACKAGE_NAME and ANDROID_SHA256_FINGERPRINTS environment variables.',
        docs: 'https://docs.linkforty.com/guides/sdk-integration#android-app-links'
      });
    }

    // Parse comma-separated fingerprints
    const fingerprints = fingerprintsEnv
      .split(',')
      .map(fp => fp.trim())
      .filter(Boolean);

    if (fingerprints.length === 0) {
      return reply.status(500).send({
        error: 'Invalid configuration',
        message: 'ANDROID_SHA256_FINGERPRINTS is empty or invalid. Must be comma-separated list of SHA-256 fingerprints.',
        example: 'ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:DD:EE:FF:...,11:22:33:44:55:66:...'
      });
    }

    const assetlinks = buildAssetLinks(packageName, fingerprints, await webOnlyTemplateSlugs(fastify.log));

    return reply
      .header('Content-Type', 'application/json')
      .send(assetlinks);
  });
}
