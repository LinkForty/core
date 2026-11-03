# Redirects

```bash
GET /:shortCode
GET /:templateSlug/:shortCode
```

Automatically redirects users to the appropriate URL based on device type (iOS/Android/web), evaluates targeting rules, and tracks the click asynchronously.

**Not-found page:** When a link can't be served, a browser gets a small HTML page ("Link not found") with status 404, `noindex`, `Cache-Control: no-store` and a content-security policy that allows no script. That covers an unknown code, an expired or switched-off link, a link on another organization's host, a visitor outside the link's targeting rules, and a link with no destination for the visitor's device. All of these render the same page, so an expired link can't be told apart from a code that never existed. Clients that don't send `Accept: text/html` (API callers, scripts) keep the JSON body: `{ "error": "Link not found" }`, or `{ "error": "No destination URL configured for this link" }` for a link with no destination. A link withdrawn for abuse keeps its own 410 notice.

You can change the page or send browsers somewhere else instead, without writing code. The first of these that is set wins:

1. **The organization's settings**, `organizations.settings.notFound`, on a host that belongs to the organization. On a shared host, only a live link that has nothing for this visitor (a targeting miss, no destination) uses its organization's settings. An unknown, expired or switched-off code there uses the instance's.

   ```json
   {
     "notFound": {
       "redirectUrl": "https://example.com",   // send browsers here (302); the rest is ignored
       "title": "This link has expired",
       "message": "Open the app to continue.",
       "logoUrl": "https://cdn.example/logo.png",
       "accentColor": "#0f766e",                     // the button
       "backgroundColor": "#f6f7f8",                 // light mode only
       "buttonLabel": "Get the app",                 // shown only with buttonUrl
       "buttonUrl": "https://example.com/app"
     }
   }
   ```

   Changes show within a minute.
2. **The instance's defaults**: the `notFound` section of `linkforty.config.json` (see [Configuration file](configuration.md#configuration-file)), with the same fields.
3. **The built-in page.**

URLs must be http(s) and colors hex; anything else is dropped, and all text is escaped. The `notFound` option below decides in code ahead of all three.

**Mobile interstitial:** When a link has `appScheme` configured and a store fallback URL (iOS App Store or Google Play), mobile requests receive a smart interstitial page instead of a raw 302 redirect. The interstitial tries to open the app via URI scheme and falls back to the app store after 1.5 seconds. This handles the case where a 302 to a custom URI scheme fails silently when the app is not installed. URL fragments are preserved through the redirect, enabling patterns like E2E encryption where the decryption key lives in the fragment.

**Launchpad page (desktop):** A link to app-only content has nowhere to send a desktop visitor. When the chain resolves no web destination (link → template → workspace `appConfig`), a desktop request gets a hosted landing page instead of an error: the link's title, description and image (`ogTitle` / `ogDescription` / `ogImageUrl`, falling back to `title` / `description`), the app's icon and name, the official App Store / Google Play badges (embedded in the page, so it makes no third-party request), and a QR code so the visitor can finish on their phone. The page is `noindex`, sent with `Cache-Control: no-store` and a content-security policy that allows no script without a per-response nonce, and it never navigates on its own — no timers, no automatic scheme attempts.

When the link does have a web destination, the page offers it as a "Continue on the web" link, and the title links there too, so a visitor is never trapped. By default it appears **only** where the alternative is nothing; a link that resolves to a destination still gets its 302. Two knobs change that:

- `organizations.settings.launchpad` (per workspace):

  ```json
  {
    "launchpad": {
      "desktop": "no-destination",     // "no-destination" (default) | "always" | "off"
      "mobile": "store",               // "store" (default) | "page"
      "appName": "Example App",
      "appIconUrl": "https://cdn.example/icon.png",
      "appWebsiteUrl": "https://example.com", // optional; the header's icon and name link here
      "accentColor": "#0f766e",           // buttons, the web link, focus rings
      "backgroundColor": "#101418"        // optional; fixes the page's palette (see below)
    }
  }
  ```

  `appWebsiteUrl` is deliberately explicit rather than derived from a link's web fallback, which may be someone else's page (an event listing, a video). Unset, the header is not a link.

  Without `backgroundColor` the page follows the visitor's light/dark preference. With one, the background is fixed and the text, surfaces and borders are derived from it — a light or a dark brand color both stay legible, and the visitor's theme no longer changes the page.

- The `launchpad` section of `linkforty.config.json` (per instance): the same fields except `templateId`, which names a host-rendered template and stays per workspace. It's the default for every link, including links with no workspace. A workspace's `settings.launchpad` overrides it **field by field**: a workspace that sets only `accentColor` keeps the instance's `appName`, icon and modes. (The not-found page works differently: a workspace's `settings.notFound` replaces the instance's as a whole.)

- `links.launchpad_mode` (per link, `launchpadMode` on the links API): `inherit` (default), `on` or `off`. The link's value wins over the workspace's and the instance's.

With `desktop: "off"` (or `launchpad_mode: "off"`), a link with no web destination gets the plain "This link opens in an app" page instead.

**Launchpad page (mobile):** With `mobile: "page"`, a phone visitor whose platform has no Universal Link / App Link on the link gets the same page instead of the store redirect or the scheme interstitial: an "Open in app" button when the link has a URI scheme (a tap, not a navigation — the URL fragment is appended on tap), the visitor's own store button, and the web fallback as a "Continue on the web" link. That last one matters inside in-app browsers (Gmail, Facebook, Instagram…), which bypass Universal Links: the store redirect would send someone who *has* the app to the store, so the redirect path prefers the web fallback there to give the OS a second chance on the next hop — and the page keeps that hop available as a tap. Links that carry a Universal Link / App Link keep their 302 regardless, because the OS resolves the installed case before the request reaches this server. `launchpad_mode: "off"` opts a link out; `"on"` does not force the page onto a workspace that chose `"store"`. The default, `"store"`, is unchanged behaviour.

Two hooks on `RedirectRouteOptions` let a host application extend the page without forking it — see [Server Options](configuration.md#server-options).
