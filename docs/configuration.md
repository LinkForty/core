# Configuration

## Server Options

```typescript
interface ServerOptions {
  database?: {
    url?: string;           // PostgreSQL connection string
    pool?: {
      min?: number;         // Minimum pool connections (default: 2)
      max?: number;         // Maximum pool connections (default: 10)
    };
  };
  redis?: {
    url: string;            // Redis connection string (optional)
  };
  cors?: {
    origin: string | string[];  // CORS allowed origins (default: '*')
  };
  logger?: boolean;         // Enable Fastify logger (default: true)
  trustProxy?: boolean | number;  // Trust X-Forwarded-For when behind a proxy (default: false)
  redirect?: RedirectRouteOptions;  // See below
  sdk?: SdkRouteOptions;            // See below
  config?: LinkFortyConfig;         // linkforty.config.json, from loadConfig()
}

interface RedirectRouteOptions {
  abuseReportUrl?: string;  // Linked from the link-safety warning page
  launchpad?: {
    // Supply richer content for the launchpad page than the link row carries:
    // a rendered share image, a templated hero. Return null for the default.
    // A hook that throws is logged and treated as null — the page never fails
    // because of it. `heroHtml` is inserted unescaped: render it yourself,
    // never from end-user input.
    // `context.webUrl` is the link's web destination, decorated exactly as
    // "Continue on the web" uses it (or null), so a hero that draws its own
    // title can link it the way the default page does.
    resolveContent?: (link, settings, context: { webUrl: string | null }) => Promise<LaunchpadContent | null>;
    // Endpoint that receives `{ linkId, event }` beacons from the page —
    // "view" on load; "cta_ios" / "cta_android" / "cta_open" / "cta_web" /
    // "cta_app_website" on tap. No cookies or identifiers. Unset means the
    // page sends nothing. If you validate event names, accept all of these.
    beaconUrl?: string;
  };
  // Return true when the request is on a host reserved for web links. Every
  // link on it then sends every device to its web destination with a plain
  // 302: no launchpad page, no scheme attempt, no store. Don't serve
  // association files on that host, so no installed app can claim its URLs.
  // A hook that throws is logged and treated as false.
  isWebLinkRequest?: (request) => Promise<boolean> | boolean;
  // The instance's not-found page or redirect, used when the organization has
  // no settings.notFound of its own. createServer() fills it from the
  // `notFound` section of the config file (ServerOptions.config).
  notFoundDefaults?: NotFoundSettings;
  // Decide the not-found response in code, ahead of the organization's
  // settings and notFoundDefaults: page content (title,
  // message, logoUrl, accentColor, backgroundColor, buttonLabel, buttonUrl — all
  // optional, all escaped; non-http(s) URLs and non-hex colors are dropped),
  // a URL to 302 to (http(s) only), or null to fall through. Called only
  // for requests that accept HTML, and never for a link withdrawn for abuse.
  // `context.reason` is "unknown" | "disabled" | "not_targeted" |
  // "no_destination"; `context.link` is the link row (null for "unknown");
  // `context.scope` is the host's organization, if any. Use the reason to
  // decide whose settings apply, not to vary the page: an expired link must
  // look like a code that never existed. A hook that throws is logged and
  // treated as null.
  notFound?: (request, context: { reason, link, scope }) =>
    Promise<NotFoundResolution | null> | NotFoundResolution | null;
}

interface SdkRouteOptions {
  // Narrow the clicks an install can be attributed to. A server shared by
  // several apps resolves the installing app (from the SDK's `appToken`, say)
  // and returns its organization, so an install only ever matches — and
  // receives the deep link of — that organization's links. Return null to
  // match against every click, as when the option is absent. A hook that
  // throws is logged and treated as null.
  resolveInstallScope?: (request, body: { appToken?: string }) =>
    Promise<{ organizationId?: string } | null> | { organizationId?: string } | null;
}
```

Install matching only considers clicks from the installing device's own network (its IPv4 /24 or IPv6 /64), since no other click can reach the confidence threshold, so the attribution window holds however much traffic the server takes. It relies on the `idx_fingerprints_ip` index, which `initializeDatabase()` builds concurrently on first start so click writes are never blocked.

`renderLaunchpadPage()`, `defaultLaunchpadContent()` and `shouldServeLaunchpadOnDesktop()` are exported so a host can render the same page elsewhere (a settings preview, for instance). `renderNotFoundPage()` is exported for the same reason, and for a host that answers some requests before they reach the redirect route.

## Configuration file

Core splits its configuration the way most self-hosted platforms do:

- **Environment variables** hold infrastructure and secrets: `DATABASE_URL`, `REDIS_URL`, `PORT`, `TRUST_PROXY`, and so on.
- **`linkforty.config.json`** holds the instance's defaults and behavior, including text a visitor reads. Today that's the `notFound` and `launchpad` sections; see [linkforty.config.example.json](../linkforty.config.example.json) and [DOCKER.md](../DOCKER.md#configuration-file) for every setting.
- **`organizations.settings`** holds per-organization values, which take precedence over the file where both apply.

The file is optional. Core reads the path in `LINKFORTY_CONFIG`, or `linkforty.config.json` in the working directory. A file with an invalid value or unknown setting stops the server at startup with the setting named, rather than starting with it ignored. The Docker image does this for you. When you create the server yourself, load it and pass it in:

```typescript
import { createServer, loadConfig } from '@linkforty/core';

const { config } = loadConfig(); // throws ConfigError on a bad file
const server = await createServer({ database: { url: process.env.DATABASE_URL }, config });
```

Options passed in code (such as `redirect.notFoundDefaults`) take precedence over the file.

## Running behind a reverse proxy

When Core runs behind a reverse proxy, CDN, or load balancer, set `trustProxy` so the server uses the real client IP from `X-Forwarded-For` for redirect targeting, geo, attribution, and fingerprinting. Pass it when creating the server (e.g. `trustProxy: true` or a number of proxy hops) or set the `TRUST_PROXY` environment variable (e.g. `TRUST_PROXY=1`). Client-provided `ipAddress` in the SDK install request body is **not** used as the trusted IP; it is optional debug metadata only and must not be relied on for attribution.

## Email security scanner detection

Mail security services (Microsoft Defender Safe Links, Mimecast, Proofpoint and others) open every link in a delivered email to check where it leads. They send a normal desktop browser user agent, so without help those visits count as human clicks, and on links sent by email they can outnumber the people.

**This is optional and off by default.** Core needs no account, key, download or third-party service to run. Without an ASN source, clicks are classified by the other bot rules and these visits count as human clicks.

**This rule is experimental.** It decides from a click's network and user agent alone, and its accuracy hasn't been measured against known scanner traffic, so the network list and behavior may change. It can make mistakes in both directions:

- **Real people can be flagged:** for example, anyone using a desktop browser through a cloud desktop, or through a VPN or proxy hosted on these networks. Their clicks would be missing from your analytics.
- **Scanners can be missed:** a scanner on another network, or one sending a mobile user agent, still counts as a human click.

Before relying on the numbers, compare a sample of flagged clicks with your own data, such as sign-ups or purchases.

To turn it on, give Core a source of IP-to-ASN data, which is how it recognizes the networks scanners run from. Any of these works:

- **An MMDB file**, set with `ASN_DB_PATH` or `botDetection.asnDatabasePath`. [DB-IP's IP to ASN Lite](https://db-ip.com/db/download/ip-to-asn-lite) is one option. It needs no account and is updated monthly (`https://download.db-ip.com/free/dbip-asn-lite-YYYY-MM.mmdb.gz`; unzip it first).
- **Your own lookup**, a function from IP to ASN passed as `botDetection.asnLookup`. Use this for an in-house table or another format. The function is synchronous, so to use an API, keep its results in memory and look them up there.

```bash
ASN_DB_PATH=/data/asn.mmdb
```

```typescript
const server = await createServer({
  botDetection: { asnLookup: (ip) => myAsnTable.get(ip) ?? null },
});
```

A click is then recorded with `is_bot = true` and `bot_reason = 'email_scanner'` when it comes from a desktop browser on Microsoft, Amazon or Google's networks (ASNs 8075, 8070, 16509, 14618, 15169, 396982). Mobile browsers, app HTTP clients and SDK requests from those networks are not flagged. Without the database the rule is off; a file that can't be opened is logged and the server starts without it.

When a click is flagged:

- The visitor is redirected exactly as before.
- The row stays in `click_events`, but analytics no longer counts it.
- Click events and webhooks are still sent.
- Its non-reserved query parameters aren't stored, so they can't be passed to a deferred install and can't be recovered later.

To turn the rule off, remove the ASN source or set `botDetection.emailScannerAsns` to an empty list, then restart. To count clicks it already flagged again, run this, which can take a while on a large table:

```sql
UPDATE click_events SET is_bot = false, bot_reason = NULL WHERE bot_reason = 'email_scanner';
```

To change the networks, set `botDetection.emailScannerAsns` in `linkforty.config.json`. It replaces the built-in list, and an empty list turns the rule off. Networks iCloud Private Relay exits through (Apple, Cloudflare, Akamai, Fastly) are rejected, since real Safari users would be flagged.

A host that registers the routes itself instead of calling `createServer()` turns the rule on with `loadScannerDetection(path, { asns })` or `configureScannerDetection({ lookup, asns })`.

A database's license applies to you, not to Core. DB-IP's Lite data is CC BY 4.0: it allows commercial use, and asks for a link to DB-IP on pages that display or use its results. MaxMind's GeoLite2-ASN and GeoIP2-ISP files also work, but check their terms first, since MaxMind sells a separate commercial license for GeoLite.

Core reads the file once at startup, so restart after replacing it. A host that refreshes it while running can call `openAsnDatabase(path)` and pass the result to `configureScannerDetection({ lookup })`, which keeps the current database if the new file can't be opened.

## Environment Variables

```bash
DATABASE_URL=postgresql://localhost/linkforty
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=production
CORS_ORIGIN=*
# When behind a reverse proxy: TRUST_PROXY=1 (or number of hops) so client IP is read from X-Forwarded-For
# TRUST_PROXY=1
# Email security scanner detection (optional): path to an ASN database in MMDB format
# ASN_DB_PATH=/data/asn.mmdb

# Mobile SDK (optional — for iOS Universal Links and Android App Links)
IOS_TEAM_ID=ABC123XYZ
IOS_BUNDLE_ID=com.yourcompany.yourapp
ANDROID_PACKAGE_NAME=com.yourcompany.yourapp
ANDROID_SHA256_FINGERPRINTS=AA:BB:CC:DD:...

# Custom domain for QR code URLs (optional)
SHORTLINK_DOMAIN=yourdomain.com
```
