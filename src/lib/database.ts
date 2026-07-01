import pg from 'pg';

const { Pool } = pg;

export interface DatabaseOptions {
  url?: string;
  pool?: {
    min?: number;
    max?: number;
  };
}

export let db: pg.Pool;

// Helper function to wait for a specified time
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Retry database connection with exponential backoff
async function connectWithRetry(maxRetries: number = 10, baseDelay: number = 1000): Promise<pg.PoolClient> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = await db.connect();
      console.log('Database connection established successfully');
      return client;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Database connection attempt ${attempt} failed. Retrying in ${delay}ms...`);
        await sleep(delay);
      } else {
        console.error('Failed to connect to database after all retries:', error);
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// Initialize database schema
export async function initializeDatabase(options: DatabaseOptions = {}) {
  // Initialize pool
  db = new Pool({
    connectionString: options.url || process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/linkforty',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    min: options.pool?.min || 2,
    max: options.pool?.max || 10,
  });

  const client = await connectWithRetry();

  try {
    // Link templates table (must be created before links, which references it)
    await client.query(`
      CREATE TABLE IF NOT EXISTS link_templates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        settings JSONB DEFAULT '{}',
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Links table
    await client.query(`
      CREATE TABLE IF NOT EXISTS links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        short_code VARCHAR(20) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        title VARCHAR(255),
        description TEXT,
        ios_url TEXT,
        android_url TEXT,
        web_fallback_url TEXT,
        utm_parameters JSONB DEFAULT '{}',
        targeting_rules JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
        append_click_id BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Click events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS click_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id UUID NOT NULL REFERENCES links(id) ON DELETE CASCADE,
        clicked_at TIMESTAMP DEFAULT NOW(),
        ip_address INET,
        user_agent TEXT,
        device_type VARCHAR(20),
        platform VARCHAR(20),
        country_code CHAR(2),
        country_name VARCHAR(100),
        region VARCHAR(100),
        city VARCHAR(100),
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        timezone VARCHAR(100),
        utm_source VARCHAR(255),
        utm_medium VARCHAR(255),
        utm_campaign VARCHAR(255),
        referrer TEXT,
        is_bot BOOLEAN NOT NULL DEFAULT false,
        bot_reason VARCHAR(16)
      )
    `);

    // Device fingerprints table - stores individual fingerprint components for probabilistic matching
    await client.query(`
      CREATE TABLE IF NOT EXISTS device_fingerprints (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        click_id UUID NOT NULL REFERENCES click_events(id) ON DELETE CASCADE,
        fingerprint_hash VARCHAR(64) NOT NULL,
        ip_address INET,
        user_agent TEXT,
        timezone VARCHAR(100),
        language VARCHAR(10),
        screen_width INTEGER,
        screen_height INTEGER,
        platform VARCHAR(50),
        platform_version VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Install events table - tracks app installations and matches to clicks via fingerprinting
    await client.query(`
      CREATE TABLE IF NOT EXISTS install_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        link_id UUID REFERENCES links(id) ON DELETE SET NULL,
        click_id UUID REFERENCES click_events(id) ON DELETE SET NULL,
        fingerprint_hash VARCHAR(64) NOT NULL,
        confidence_score DECIMAL(5, 2),
        installed_at TIMESTAMP DEFAULT NOW(),
        first_open_at TIMESTAMP,
        deep_link_retrieved BOOLEAN DEFAULT false,
        deep_link_data JSONB DEFAULT '{}',
        attribution_window_hours INTEGER DEFAULT 168,
        ip_address INET,
        user_agent TEXT,
        timezone VARCHAR(100),
        language VARCHAR(10),
        screen_width INTEGER,
        screen_height INTEGER,
        platform VARCHAR(50),
        platform_version VARCHAR(50),
        device_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // In-app events table - tracks conversion events from mobile apps
    await client.query(`
      CREATE TABLE IF NOT EXISTS in_app_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        install_id UUID NOT NULL REFERENCES install_events(id) ON DELETE CASCADE,
        event_name VARCHAR(255) NOT NULL,
        event_data JSONB DEFAULT '{}',
        event_timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Webhooks table - stores webhook configurations for event postbacks
    await client.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        name VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        secret VARCHAR(255) NOT NULL,
        events TEXT[] NOT NULL DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        retry_count INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 10000,
        headers JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Add template_id column to links table
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='template_id'
        ) THEN
          ALTER TABLE links ADD COLUMN template_id UUID REFERENCES link_templates(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add description column to existing links table if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='description'
        ) THEN
          ALTER TABLE links ADD COLUMN description TEXT;
        END IF;
      END $$;
    `);

    // Add Open Graph (OG) tag columns for social media previews
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='og_title'
        ) THEN
          ALTER TABLE links ADD COLUMN og_title VARCHAR(255);
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='og_description'
        ) THEN
          ALTER TABLE links ADD COLUMN og_description TEXT;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='og_image_url'
        ) THEN
          ALTER TABLE links ADD COLUMN og_image_url TEXT;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='og_type'
        ) THEN
          ALTER TABLE links ADD COLUMN og_type VARCHAR(50) DEFAULT 'website';
        END IF;
      END $$;
    `);

    // Add attribution window column for configurable install attribution windows
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='attribution_window_hours'
        ) THEN
          ALTER TABLE links ADD COLUMN attribution_window_hours INTEGER DEFAULT 168;
        END IF;
      END $$;
    `);

    // Rename ios_url to ios_app_store_url for clarity
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='ios_url'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='ios_app_store_url'
        ) THEN
          ALTER TABLE links RENAME COLUMN ios_url TO ios_app_store_url;
        END IF;
      END $$;
    `);

    // Rename android_url to android_app_store_url for clarity
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='android_url'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='android_app_store_url'
        ) THEN
          ALTER TABLE links RENAME COLUMN android_url TO android_app_store_url;
        END IF;
      END $$;
    `);

    // Add app URL scheme column (same for iOS and Android per industry best practice)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='app_scheme'
        ) THEN
          ALTER TABLE links ADD COLUMN app_scheme VARCHAR(255);
        END IF;
      END $$;
    `);

    // Add iOS Universal Link URL column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='ios_universal_link'
        ) THEN
          ALTER TABLE links ADD COLUMN ios_universal_link TEXT;
        END IF;
      END $$;
    `);

    // Add Android App Link URL column
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='android_app_link'
        ) THEN
          ALTER TABLE links ADD COLUMN android_app_link TEXT;
        END IF;
      END $$;
    `);

    // Add deep link path column for in-app navigation
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='deep_link_path'
        ) THEN
          ALTER TABLE links ADD COLUMN deep_link_path TEXT;
        END IF;
      END $$;
    `);

    // Add deep link parameters column for custom app parameters
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='deep_link_parameters'
        ) THEN
          ALTER TABLE links ADD COLUMN deep_link_parameters JSONB DEFAULT '{}';
        END IF;
      END $$;
    `);

    // Click correlation id passthrough (opt-in, default off). When enabled per
    // link, the redirect appends ?lf_click=<click id> to web/HTTPS destinations
    // so a downstream analytics tool on the landing page can tie the landing
    // visit back to the exact originating click. Off by default so the redirect
    // never alters a destination's query string unless explicitly opted in.
    // App-scheme/deep-link destinations are never appended to regardless.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='append_click_id'
        ) THEN
          ALTER TABLE links ADD COLUMN append_click_id BOOLEAN DEFAULT false;
        END IF;
      END $$;
    `);

    // Bot classification columns on click_events (SIT-298). Classified at
    // ingestion (see lib/bot-detection.ts) and persisted so every consumer reads
    // one consistent flag; analytics excludes is_bot rows. Backward compatible:
    // legacy rows default to is_bot=false until the one-time backfill runs.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='click_events' AND column_name='is_bot') THEN
          ALTER TABLE click_events ADD COLUMN is_bot BOOLEAN NOT NULL DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='click_events' AND column_name='bot_reason') THEN
          ALTER TABLE click_events ADD COLUMN bot_reason VARCHAR(16);
        END IF;
      END $$;
    `);

    // Last-click attribution columns on in_app_events (SIT-237).
    // Events (screen views + custom events) are attributed to the deep link that
    // drove them, not just the original install link. The SDK stamps each event
    // with the active link, when it opened, and the app-open session; the window
    // (organic vs attributed) is applied at query time. Nullable + backward
    // compatible: legacy/organic rows stay null and fall back to the install link.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='attributed_link_id') THEN
          ALTER TABLE in_app_events ADD COLUMN attributed_link_id UUID REFERENCES links(id) ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='attributed_click_id') THEN
          ALTER TABLE in_app_events ADD COLUMN attributed_click_id UUID;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='attributed_at') THEN
          ALTER TABLE in_app_events ADD COLUMN attributed_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='session_id') THEN
          ALTER TABLE in_app_events ADD COLUMN session_id UUID;
        END IF;
      END $$;
    `);

    // SDK identity columns (SIT-235) — name + version of the SDK that sent the
    // install/event, for SDK version diagnostics. Persisted on BOTH tables:
    // install_events (version at install time) and in_app_events because an app
    // that updates keeps its original install row but sends events with the new
    // version — so version-fragmentation / outdated-version checks must read from
    // the event stream. Nullable + backward compatible (older SDKs omit them).
    // NOTE: no index on sdk_name/sdk_version yet — deferred until a consumer
    // aggregates them (e.g. "installs by version"), so the index can match the
    // real query shape.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='install_events' AND column_name='sdk_name') THEN
          ALTER TABLE install_events ADD COLUMN sdk_name VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='install_events' AND column_name='sdk_version') THEN
          ALTER TABLE install_events ADD COLUMN sdk_version VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='sdk_name') THEN
          ALTER TABLE in_app_events ADD COLUMN sdk_name VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='in_app_events' AND column_name='sdk_version') THEN
          ALTER TABLE in_app_events ADD COLUMN sdk_version VARCHAR(50);
        END IF;
      END $$;
    `);

    // Create indexes for performance
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON click_events(link_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_timestamp ON click_events(clicked_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_link_date ON click_events(link_id, clicked_at DESC)');
    // Partial index for the common analytics filter (human clicks only, is_bot = false).
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_human_link_date ON click_events(link_id, clicked_at DESC) WHERE is_bot = false');
    // Indexes for deferred deep linking
    await client.query('CREATE INDEX IF NOT EXISTS idx_fingerprints_hash ON device_fingerprints(fingerprint_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_fingerprints_click_id ON device_fingerprints(click_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_installs_fingerprint ON install_events(fingerprint_hash)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_installs_link_id ON install_events(link_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_installs_timestamp ON install_events(installed_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_installs_link_date ON install_events(link_id, installed_at DESC)');

    // Indexes for link templates
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_link_templates_slug ON link_templates(slug)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_link_templates_user_id ON link_templates(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_links_template_id ON links(template_id)');

    // Indexes for webhooks
    await client.query('CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON webhooks(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(is_active) WHERE is_active = true');

    // Indexes for in-app events
    await client.query('CREATE INDEX IF NOT EXISTS idx_in_app_events_install_id ON in_app_events(install_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_in_app_events_name ON in_app_events(event_name)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_in_app_events_timestamp ON in_app_events(event_timestamp DESC)');
    // Attribution lookups: per-link conversion aggregation + per-session screen flow
    await client.query('CREATE INDEX IF NOT EXISTS idx_in_app_events_attributed_link ON in_app_events(attributed_link_id, event_timestamp DESC)');
    // Partial: session_id is null for legacy/organic in-app events (the majority);
    // per-session screen-flow lookups always filter `session_id IS NOT NULL`.
    await client.query('CREATE INDEX IF NOT EXISTS idx_in_app_events_session ON in_app_events(session_id) WHERE session_id IS NOT NULL');

    // Add deep_link_parameters column for custom deep link parameters
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name='links' AND column_name='deep_link_parameters'
        ) THEN
          ALTER TABLE links ADD COLUMN deep_link_parameters JSONB DEFAULT '{}';
        END IF;
      END $$;
    `);

    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}
