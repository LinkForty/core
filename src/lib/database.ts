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
    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Links table
    await client.query(`
      CREATE TABLE IF NOT EXISTS links (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        short_code VARCHAR(20) UNIQUE NOT NULL,
        original_url TEXT NOT NULL,
        title VARCHAR(255),
        ios_url TEXT,
        android_url TEXT,
        web_fallback_url TEXT,
        utm_parameters JSONB DEFAULT '{}',
        targeting_rules JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        expires_at TIMESTAMP,
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
        referrer TEXT
      )
    `);

    // Create indexes for performance
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_links_short_code ON links(short_code)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_links_user_id ON links(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_links_created_at ON links(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON click_events(link_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_timestamp ON click_events(clicked_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_clicks_link_date ON click_events(link_id, clicked_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');

    console.log('Database schema initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}
