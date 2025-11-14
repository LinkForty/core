# Deploying Link Forty to Fly.io

This guide walks you through deploying Link Forty to [Fly.io](https://fly.io), a global application platform that makes deployment simple.

## Prerequisites

1. **Fly.io Account**
   - Sign up at https://fly.io/app/sign-up
   - Credit card required (but has generous free tier)

2. **Fly CLI Installed**
   ```bash
   # macOS/Linux
   curl -L https://fly.io/install.sh | sh

   # Windows
   iwr https://fly.io/install.ps1 -useb | iex
   ```

3. **Authenticate**
   ```bash
   fly auth login
   ```

4. **Link Forty Built Locally**
   ```bash
   npm install
   npm run build
   ```

## Step 1: Customize Configuration

1. Edit `infra/fly.io/fly.toml`:
   ```toml
   app = "your-unique-app-name"  # Must be globally unique
   primary_region = "iad"         # Choose your region
   ```

2. Available regions (run `fly platform regions` for full list):
   - `iad` - Washington DC (US East)
   - `lax` - Los Angeles (US West)
   - `lhr` - London (Europe)
   - `fra` - Frankfurt (Europe)
   - `syd` - Sydney (Asia-Pacific)
   - `nrt` - Tokyo (Asia-Pacific)

## Step 2: Create PostgreSQL Database

Link Forty requires PostgreSQL 13+.

```bash
# Create a Postgres cluster
fly postgres create --name linkforty-db --region iad

# Choose configuration when prompted:
# - Development: 1GB RAM, 10GB storage (free tier eligible)
# - Production: 2GB+ RAM, 20GB+ storage

# Attach database to your app
fly postgres attach linkforty-db --app your-unique-app-name
```

This automatically sets the `DATABASE_URL` secret in your app.

**Alternative:** Use [Supabase](https://supabase.com) or another managed PostgreSQL provider and set `DATABASE_URL` manually (see Step 5).

📖 Detailed PostgreSQL setup: [fly.postgres.md](./fly.postgres.md)

## Step 3: Create Redis Cache (Optional but Recommended)

Redis improves performance by ~90% for repeated link lookups.

```bash
# Create Upstash Redis (Fly's Redis partner)
fly redis create --name linkforty-redis --region iad

# Choose plan when prompted:
# - Development: Free tier (256MB)
# - Production: Eviction-$10 or Eviction-$40

# Note the REDIS_URL provided - you'll set it in Step 5
```

📖 Detailed Redis setup: [fly.redis.md](./fly.redis.md)

## Step 4: Create Your Fly.io App

From the root of your Link Forty project:

```bash
# Copy fly.toml to root directory
cp infra/fly.io/fly.toml fly.toml

# Create the app (don't deploy yet)
fly apps create your-unique-app-name --org personal
```

## Step 5: Set Secrets (Environment Variables)

```bash
# DATABASE_URL (automatically set if you used fly postgres attach)
# If using external PostgreSQL:
fly secrets set DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"

# REDIS_URL (from Step 3 output)
fly secrets set REDIS_URL="redis://default:password@host:6379"

# CORS Origin (your frontend domain)
fly secrets set CORS_ORIGIN="https://yourdomain.com"

# Optional: Custom port (defaults to 8080)
fly secrets set PORT="8080"

# View configured secrets (values are hidden)
fly secrets list
```

⚠️ **Security Note:** Never commit secrets to git. Use `fly secrets set` only.

## Step 6: Initial Deployment

```bash
# Deploy from the root directory (where fly.toml is located)
fly deploy

# This will:
# 1. Build your Docker image
# 2. Push to Fly.io registry
# 3. Run migrations (via release_command in fly.toml)
# 4. Deploy to your chosen region(s)
# 5. Start health checks
```

**First deployment takes 3-5 minutes.** Subsequent deployments are faster.

## Step 7: Verify Deployment

```bash
# Check app status
fly status

# View recent logs
fly logs

# Open your app in browser
fly open

# Test the health endpoint
curl https://your-app.fly.dev/health
```

## Step 8: Create Your First Link

```bash
# Using curl
curl -X POST https://your-app.fly.dev/api/links \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "iosUrl": "myapp://product/123",
    "androidUrl": "myapp://product/123",
    "webUrl": "https://mysite.com/product/123"
  }'

# Response includes your short code
# {"code":"abc123","shortUrl":"https://your-app.fly.dev/abc123"}
```

Test the redirect:
```bash
curl -L https://your-app.fly.dev/abc123
```

## Scaling Your Deployment

### Vertical Scaling (More Resources Per Machine)

Edit `fly.toml`:
```toml
[vm]
  cpu_kind = "shared"    # or "performance" for dedicated CPUs
  cpus = 2
  memory_mb = 512        # or 1024, 2048, etc.
```

Then deploy:
```bash
fly deploy
```

### Horizontal Scaling (More Machines)

```bash
# Scale to 3 machines in primary region
fly scale count 3

# Or use auto-scaling (edit fly.toml first)
# Uncomment the [[services.autoscaling]] section
fly deploy
```

### Multi-Region Deployment

Edit `fly.toml` to uncomment regions:
```toml
[[regions]]
name = "iad"  # US East
[[regions]]
name = "lhr"  # Europe
[[regions]]
name = "nrt"  # Asia
```

Deploy:
```bash
fly deploy
```

Fly.io automatically routes users to the nearest region.

## Database Migrations

Migrations run automatically on deploy (via `release_command` in fly.toml).

To run manually:
```bash
# SSH into a machine
fly ssh console

# Run migrations
npm run migrate

# Exit
exit
```

## Monitoring and Logs

```bash
# Real-time logs
fly logs

# Filter by app instance
fly logs -i instance-id

# View metrics dashboard
fly dashboard

# Check machine status
fly status

# View recent deployments
fly releases
```

## Troubleshooting

### Deployment Fails

```bash
# Check build logs
fly logs --app your-app

# Verify secrets are set
fly secrets list

# Check app configuration
fly config show
```

### Health Checks Failing

Ensure your app exposes `/health` endpoint:

```typescript
// In your Fastify setup
fastify.get('/health', async (request, reply) => {
  return { status: 'ok' };
});
```

Check `fly.toml` health check path matches.

### Database Connection Issues

```bash
# Verify DATABASE_URL is set
fly secrets list

# Check database status
fly postgres status linkforty-db

# View database connection info
fly postgres db list linkforty-db
```

### Out of Memory Errors

Increase memory allocation in `fly.toml`:
```toml
[vm]
  memory_mb = 512  # Increase from 256
```

### High Latency

Consider:
- Enabling Redis cache (see Step 3)
- Multi-region deployment
- Increasing machine resources
- Database connection pooling (already configured)

## Updating Your Deployment

```bash
# After making code changes:
npm run build
fly deploy

# To rollback to previous version:
fly releases
fly releases rollback <version>
```

## Cost Optimization

**Free Tier Eligible Setup:**
- 1x shared-cpu-1x machine (256MB) = Free
- Fly Postgres (1GB, development tier) = Free
- Upstash Redis (256MB) = Free
- **Total: $0/month** for low-traffic apps

**Small Production Setup (~$10-15/month):**
- 1x shared-cpu-1x (512MB) = ~$3.50/month
- Fly Postgres (2GB) = ~$7/month
- Upstash Redis (Eviction-$10) = ~$10/month
- **Total: ~$20/month**

**View your costs:**
```bash
fly billing show
```

## Security Checklist

Before going to production, review [SECURITY.md](./SECURITY.md) for:
- Environment variable security
- Database SSL configuration
- CORS settings
- Secret rotation
- Backup strategy

## Next Steps

- Set up custom domain: https://fly.io/docs/app-guides/custom-domains-with-fly/
- Configure TLS certificates: Automatic with Fly.io
- Set up monitoring alerts: https://fly.io/docs/reference/metrics/
- Enable database backups: See [fly.postgres.md](./fly.postgres.md)

## Getting Help

- **Fly.io Docs:** https://fly.io/docs/
- **Fly.io Community:** https://community.fly.io/
- **Link Forty Issues:** https://github.com/yourusername/linkforty-core/issues
- **Security Issues:** See [SECURITY.md](../../SECURITY.md)

## Resources

- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Fly.io Regions](https://fly.io/docs/reference/regions/)
- [Fly.io Node.js Guide](https://fly.io/docs/languages-and-frameworks/node/)
- [Fly.io PostgreSQL](https://fly.io/docs/postgres/)
