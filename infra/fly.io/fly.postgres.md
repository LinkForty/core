# PostgreSQL Setup on Fly.io

This guide covers setting up and managing PostgreSQL for LinkForty on Fly.io.

## Overview

LinkForty requires PostgreSQL 13 or higher. Fly.io offers managed PostgreSQL clusters with:
- Automated backups
- Point-in-time recovery
- High availability options
- Built-in monitoring
- Private networking

## Creating a PostgreSQL Cluster

### Option 1: Development/Small Production

For testing or small deployments:

```bash
fly postgres create --name linkforty-db \
  --region iad \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 10
```

**Configuration:**
- 1 machine (no high availability)
- 1 CPU, 256MB RAM
- 10GB storage
- **Cost:** Free tier eligible

### Option 2: Production with High Availability

For production deployments:

```bash
fly postgres create --name linkforty-db \
  --region iad \
  --initial-cluster-size 3 \
  --vm-size shared-cpu-2x \
  --volume-size 20
```

**Configuration:**
- 3 machines (1 primary + 2 replicas)
- 2 CPUs, 512MB RAM per machine
- 20GB storage per machine
- Automatic failover
- **Cost:** ~$20-30/month

### Interactive Creation

Simply run without arguments for interactive prompts:

```bash
fly postgres create
```

The CLI will ask:
1. App name (e.g., `linkforty-db`)
2. Region (choose closest to your app)
3. Configuration (Development vs Production)

## Attaching Database to Your App

After creating the cluster:

```bash
fly postgres attach linkforty-db --app your-linkforty-app
```

This automatically:
- Creates a dedicated database and user for your app
- Sets the `DATABASE_URL` secret in your app
- Configures connection pooling
- Enables SSL connections

## Manual Connection String Setup

If you prefer manual setup or use external PostgreSQL:

```bash
# Get connection details
fly postgres connect -a linkforty-db

# In psql:
CREATE DATABASE linkforty;
CREATE USER linkforty_user WITH ENCRYPTED PASSWORD 'your-strong-password';
GRANT ALL PRIVILEGES ON DATABASE linkforty TO linkforty_user;
\q

# Set the DATABASE_URL secret
fly secrets set DATABASE_URL="postgresql://linkforty_user:your-strong-password@linkforty-db.internal:5432/linkforty?sslmode=require" --app your-linkforty-app
```

## Connection String Format

Your `DATABASE_URL` should follow this format:

```
postgresql://username:password@host:port/database?sslmode=require
```

**Components:**
- `username` - Database user (created by `attach` or manually)
- `password` - Strong password (20+ characters)
- `host` - For Fly Postgres: `appname.internal` (private network)
- `port` - Usually `5432`
- `database` - Database name
- `sslmode=require` - **Required** for secure connections

## Running Migrations

### Automatic (Recommended)

Migrations run automatically on deploy via `fly.toml`:

```toml
[deploy]
  release_command = "npm run migrate"
```

Every deployment:
1. Builds your app
2. Runs `npm run migrate` (before starting the app)
3. Deploys if migrations succeed

### Manual Migration

If you need to run migrations manually:

```bash
# SSH into your app
fly ssh console --app your-linkforty-app

# Run migrations
npm run migrate

# Exit
exit
```

Or connect directly to the database:

```bash
# Connect via psql
fly postgres connect -a linkforty-db

# Run SQL manually
\i /path/to/migration.sql

# Or use LinkForty's migration tool
\q
```

## Database Management

### Viewing Database Info

```bash
# Status of Postgres cluster
fly postgres status linkforty-db

# List databases
fly postgres db list linkforty-db

# List users
fly postgres users list linkforty-db

# View connection info
fly postgres config view linkforty-db
```

### Connecting to Database

```bash
# Interactive psql session
fly postgres connect -a linkforty-db

# Once connected:
\l          # List databases
\c linkforty  # Connect to specific database
\dt         # List tables
\d links    # Describe table schema
SELECT COUNT(*) FROM links;  # Query data
\q          # Quit
```

### Monitoring

```bash
# View Postgres logs
fly logs -a linkforty-db

# Check CPU/memory usage
fly status -a linkforty-db

# Dashboard with metrics
fly dashboard linkforty-db
```

## Backups and Recovery

### Automatic Backups

Fly Postgres includes automated backups:
- **Development tier:** Daily backups, 7-day retention
- **Production tier:** Daily backups, 30-day retention
- Point-in-time recovery available

### Manual Backup

```bash
# Create a snapshot
fly volumes snapshots create <volume-id> -a linkforty-db

# List snapshots
fly volumes snapshots list <volume-id> -a linkforty-db

# Get volume ID
fly volumes list -a linkforty-db
```

### Export Database (Manual Backup)

```bash
# Dump entire database
fly postgres connect -a linkforty-db -c "pg_dump linkforty" > backup.sql

# Dump only schema
fly postgres connect -a linkforty-db -c "pg_dump --schema-only linkforty" > schema.sql

# Dump only data
fly postgres connect -a linkforty-db -c "pg_dump --data-only linkforty" > data.sql
```

### Restore from Backup

```bash
# Restore from SQL dump
fly postgres connect -a linkforty-db

# In psql:
DROP DATABASE linkforty;  # ⚠️ CAUTION: Deletes all data
CREATE DATABASE linkforty;
\q

# Import dump
cat backup.sql | fly postgres connect -a linkforty-db -d linkforty
```

### Point-in-Time Recovery

Contact Fly.io support for point-in-time recovery:

```bash
fly support create "Need PITR for linkforty-db to <timestamp>"
```

## Scaling PostgreSQL

### Vertical Scaling (More Resources)

```bash
# Scale VM size
fly postgres update linkforty-db --vm-size shared-cpu-2x

# Increase storage
fly volumes extend <volume-id> --size 40 -a linkforty-db
```

Available VM sizes:
- `shared-cpu-1x` - 256MB RAM (free tier)
- `shared-cpu-2x` - 512MB RAM
- `shared-cpu-4x` - 1GB RAM
- `shared-cpu-8x` - 2GB RAM
- `performance-1x` - 2GB RAM (dedicated CPU)
- `performance-2x` - 4GB RAM (dedicated CPU)

### Horizontal Scaling (Read Replicas)

Add replicas for read scaling:

```bash
# Add replica in same region
fly postgres update linkforty-db --add-replica

# Add replica in different region (multi-region)
fly postgres update linkforty-db --add-replica --region lhr
```

**Note:** LinkForty's connection pool handles read/write routing automatically.

### High Availability

For production, use 3-node cluster:

```bash
fly postgres update linkforty-db --initial-cluster-size 3
```

Benefits:
- Automatic failover (30-60 seconds)
- 2 replicas for read scaling
- Higher durability

## Performance Tuning

### Connection Pooling

LinkForty includes connection pooling (configured in `src/database/pool.ts`):

```typescript
// Default configuration
min: 2,      // Minimum connections
max: 10,     // Maximum connections
```

Adjust based on your VM size:
- 256MB RAM: max 5-10 connections
- 512MB RAM: max 10-20 connections
- 1GB+ RAM: max 20-50 connections

### Indexes

LinkForty creates these indexes automatically (via migrations):

```sql
-- Fast lookups by code
CREATE INDEX idx_links_code ON links(code);

-- User isolation
CREATE INDEX idx_links_user_id ON links(user_id);

-- Analytics queries
CREATE INDEX idx_click_events_link_id ON click_events(link_id);
CREATE INDEX idx_click_events_created_at ON click_events(created_at);
```

### Query Performance

Monitor slow queries:

```bash
fly postgres connect -a linkforty-db

# Enable logging of slow queries (>1s)
ALTER DATABASE linkforty SET log_min_duration_statement = 1000;

# View slow queries in logs
\q

fly logs -a linkforty-db | grep "duration:"
```

### Vacuum and Analyze

PostgreSQL automatically runs `VACUUM` and `ANALYZE`. To run manually:

```bash
fly postgres connect -a linkforty-db

VACUUM ANALYZE links;
VACUUM ANALYZE click_events;
```

## Security

### SSL/TLS Connections

Always use `sslmode=require` in production:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
```

Verify SSL is active:

```bash
fly postgres connect -a linkforty-db

SELECT ssl.* FROM pg_stat_ssl ssl, pg_stat_activity a
WHERE ssl.pid = a.pid AND a.usename = 'linkforty_user';
```

### Password Rotation

Rotate database passwords quarterly:

```bash
fly postgres connect -a linkforty-db

ALTER USER linkforty_user WITH PASSWORD 'new-strong-password';
\q

# Update secret in your app
fly secrets set DATABASE_URL="postgresql://linkforty_user:new-strong-password@linkforty-db.internal:5432/linkforty?sslmode=require" --app your-linkforty-app
```

### Network Isolation

Fly Postgres is only accessible:
- Within your Fly.io private network (`.internal`)
- Via WireGuard VPN (for admin access)

Not exposed to public internet.

## Monitoring and Alerts

### Key Metrics to Monitor

```bash
# Connection count
fly postgres connect -a linkforty-db -c "SELECT count(*) FROM pg_stat_activity;"

# Database size
fly postgres connect -a linkforty-db -c "SELECT pg_size_pretty(pg_database_size('linkforty'));"

# Table sizes
fly postgres connect -a linkforty-db -c "
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

### Set Up Alerts

Monitor these conditions:
- Storage > 80% full
- Connection pool exhausted
- Replication lag > 10s
- CPU > 80% for 5+ minutes

Use Fly.io monitoring or integrate with:
- Datadog
- New Relic
- Prometheus + Grafana

## Troubleshooting

### Connection Refused

```bash
# Check Postgres status
fly postgres status linkforty-db

# Check DATABASE_URL is correct
fly secrets list --app your-linkforty-app

# Verify Postgres is running
fly logs -a linkforty-db
```

### Out of Connections

Increase max connections or reduce pool size:

```bash
# Check current connections
fly postgres connect -a linkforty-db -c "SELECT count(*) FROM pg_stat_activity;"

# Check max_connections
fly postgres connect -a linkforty-db -c "SHOW max_connections;"
```

### Slow Queries

```bash
# Enable query logging
fly postgres connect -a linkforty-db

ALTER DATABASE linkforty SET log_min_duration_statement = 1000;

# Analyze slow queries
EXPLAIN ANALYZE SELECT * FROM links WHERE code = 'abc123';
```

### Storage Full

```bash
# Check current usage
fly volumes list -a linkforty-db

# Extend volume
fly volumes extend <volume-id> --size 40 -a linkforty-db
```

## Alternative: External PostgreSQL

Instead of Fly Postgres, you can use:

### Supabase

```bash
# Create project at https://supabase.com
# Get connection string from project settings

fly secrets set DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.xxxxx.supabase.co:5432/postgres?sslmode=require"
```

### Neon

```bash
# Create project at https://neon.tech
# Copy connection string

fly secrets set DATABASE_URL="postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
```

### AWS RDS

```bash
# Create RDS PostgreSQL instance
# Ensure security group allows Fly.io IPs

fly secrets set DATABASE_URL="postgresql://admin:password@mydb.xxxxx.us-east-1.rds.amazonaws.com:5432/linkforty?sslmode=require"
```

## Cost Optimization

### Free Tier Setup
- 1x shared-cpu-1x (256MB)
- 10GB storage
- 1 region
- **Cost: $0/month**

### Small Production (~$7/month)
- 1x shared-cpu-2x (512MB)
- 20GB storage
- Daily backups
- **Cost: ~$7/month**

### High Availability (~$20/month)
- 3x shared-cpu-2x (512MB each)
- 20GB storage per instance
- Auto-failover
- **Cost: ~$20/month**

Check pricing:
```bash
fly pricing postgres
```

## Resources

- [Fly.io Postgres Docs](https://fly.io/docs/postgres/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Connection Pooling Best Practices](https://www.postgresql.org/docs/current/runtime-config-connection.html)

---

**Need Help?**
- Fly.io Community: https://community.fly.io/
- PostgreSQL Help: https://www.postgresql.org/support/
