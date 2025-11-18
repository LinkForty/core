import { FastifyInstance } from 'fastify';
import { db } from '../lib/database.js';

/**
 * Detect if the request is from a social media scraper/bot
 * These bots crawl links to generate previews when shared on social platforms
 */
function isSocialScraper(userAgent: string): boolean {
  const scraperPatterns = [
    /facebookexternalhit/i,      // Facebook
    /Facebot/i,                  // Facebook
    /Twitterbot/i,               // Twitter
    /LinkedInBot/i,              // LinkedIn
    /Slackbot/i,                 // Slack
    /Discordbot/i,               // Discord
    /TelegramBot/i,              // Telegram
    /WhatsApp/i,                 // WhatsApp
    /PinterestBot/i,             // Pinterest
    /SkypeUriPreview/i,          // Skype
    /Googlebot/i,                // Google (for search previews)
    /bingbot/i,                  // Bing
    /ia_archiver/i,              // Alexa
  ];

  return scraperPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Generate HTML preview page with Open Graph meta tags
 */
function generatePreviewHTML(
  link: any,
  shortUrl: string,
  autoRedirect: boolean = true
): string {
  // Use OG-specific values if provided, otherwise fall back to regular title/description
  const ogTitle = link.og_title || link.title || 'Shared Link';
  const ogDescription = link.og_description || link.description || '';
  const ogImage = link.og_image_url || '';
  const ogType = link.og_type || 'website';
  const ogUrl = shortUrl;

  // Auto-redirect after 2 seconds for human visitors
  const metaRefresh = autoRedirect
    ? `<meta http-equiv="refresh" content="2;url=${link.original_url}">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(ogTitle)}</title>

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="${escapeHtml(ogType)}">
  <meta property="og:url" content="${escapeHtml(ogUrl)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}">` : ''}
  ${ogImage ? `<meta property="og:image:secure_url" content="${escapeHtml(ogImage)}">` : ''}

  <!-- Twitter -->
  <meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:url" content="${escapeHtml(ogUrl)}">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  ${ogImage ? `<meta name="twitter:image" content="${escapeHtml(ogImage)}">` : ''}

  <!-- LinkedIn -->
  <meta property="og:site_name" content="LinkForty">

  ${metaRefresh}

  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 20px;
    }
    .container {
      max-width: 600px;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 1rem;
    }
    p {
      font-size: 1.25rem;
      margin-bottom: 2rem;
      opacity: 0.9;
    }
    .link {
      display: inline-block;
      padding: 12px 24px;
      background: white;
      color: #667eea;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      transition: transform 0.2s;
    }
    .link:hover {
      transform: translateY(-2px);
    }
    .loader {
      margin: 2rem auto;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    ${ogImage ? `<img src="${escapeHtml(ogImage)}" alt="${escapeHtml(ogTitle)}" style="max-width: 100%; border-radius: 12px; margin-bottom: 2rem; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);">` : ''}
    <h1>${escapeHtml(ogTitle)}</h1>
    ${ogDescription ? `<p>${escapeHtml(ogDescription)}</p>` : ''}
    ${autoRedirect ? '<div class="loader"></div><p>Redirecting you...</p>' : ''}
    <a href="${escapeHtml(link.original_url)}" class="link">
      ${autoRedirect ? 'Click here if not redirected' : 'Continue to destination'}
    </a>
  </div>
</body>
</html>`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

export async function previewRoutes(fastify: FastifyInstance) {
  /**
   * GET /:shortCode/preview
   * Always return HTML preview page with Open Graph tags
   * Auto-redirects after 2 seconds for human visitors
   */
  fastify.get('/:shortCode/preview', async (request, reply) => {
    const { shortCode } = request.params as { shortCode: string };
    const baseUrl = request.headers.host
      ? `${request.protocol}://${request.headers.host}`
      : 'https://link.forty';

    try {
      // Lookup link by short code
      const result = await db.query(
        `SELECT * FROM links
         WHERE short_code = $1 AND is_active = true
         AND (expires_at IS NULL OR expires_at > NOW())`,
        [shortCode]
      );

      if (result.rows.length === 0) {
        return reply.status(404).send('Link not found');
      }

      const link = result.rows[0];
      const shortUrl = `${baseUrl}/${shortCode}`;

      // Return HTML with OG tags and auto-redirect
      const html = generatePreviewHTML(link, shortUrl, true);

      return reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(html);
    } catch (error: any) {
      fastify.log.error(`Error generating preview: ${error}`);
      return reply.status(500).send('Error generating preview');
    }
  });

  /**
   * Middleware for /:shortCode route to detect social scrapers
   * If scraper detected, return OG preview instead of redirecting
   *
   * Note: This should be registered BEFORE the main redirect route
   */
  fastify.addHook('preHandler', async (request, reply) => {
    // Only apply to short code routes (not API routes, not preview routes)
    const path = request.url.split('?')[0]; // Remove query string
    if (
      path.startsWith('/api/') ||
      path.endsWith('/preview') ||
      path === '/' ||
      path.includes('.')
    ) {
      return; // Skip this hook
    }

    const userAgent = request.headers['user-agent'] || '';
    const shortCode = path.split('/').pop() || '';
    const baseUrl = request.headers.host
      ? `${request.protocol}://${request.headers.host}`
      : 'https://link.forty';

    // If it's a social scraper, return OG preview HTML
    if (isSocialScraper(userAgent)) {
      try {
        const result = await db.query(
          `SELECT * FROM links
           WHERE short_code = $1 AND is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())`,
          [shortCode]
        );

        if (result.rows.length > 0) {
          const link = result.rows[0];
          const shortUrl = `${baseUrl}/${shortCode}`;

          // Return HTML with OG tags, no auto-redirect for bots
          const html = generatePreviewHTML(link, shortUrl, false);

          reply
            .header('Content-Type', 'text/html; charset=utf-8')
            .send(html);

          // Stop the request here, don't continue to redirect route
          return reply;
        }
      } catch (error: any) {
        fastify.log.error(`Error in social scraper detection: ${error}`);
        // Continue to normal redirect route on error
      }
    }

    // Not a social scraper, continue to normal redirect logic
  });
}
