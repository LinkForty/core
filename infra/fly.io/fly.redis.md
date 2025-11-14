# Redis Setup on Fly.io

This guide covers setting up and managing Redis for LinkForty on Fly.io.

## Overview

Redis is **optional but highly recommended** for LinkForty. According to the project documentation, Redis caching can reduce database queries by ~90% for repeated link lookups.

Fly.io partners with [Upstash](https://upstash.com/) to provide managed Redis with:
- Serverless pricing (pay per request)
- Global replication
- TLS encryption
- Automatic scaling
- No idle charges

## Creating a Redis Instance

### Option 1: Upstash Redis via Fly.io (Recommended)

```bash
fly redis create --name linkforty-redis --region iad
```

You'll be prompted to choose a plan:

**Free Tier:**
- 256MB storage
- 10,000 commands/day
- Perfect for development
- **Cost: $0/month**

**Eviction-$10:**
- 1GB storage
- 100K commands/day
- Evicts least-recently-used keys when full
- **Cost: $10/month**

**Eviction-$40:**
- 5GB storage
- 500K commands/day
- Evicts least-recently-used keys when full
- **Cost: $40/month**

**No-Eviction-$120:**
- 5GB storage
- 1M commands/day
- Never evicts keys (blocks writes when full)
- **Cost: $120/month**

### Option 2: Direct Upstash Setup

Alternatively, create directly at [Upstash](https://upstash.com/):

1. Sign up at https://upstash.com
2. Create a new Redis database
3. Choose region (match your Fly.io region)
4. Select pricing plan
5. Copy the connection string

## Setting Redis URL

After creation, you'll receive a `REDIS_URL`. Set it as a secret:

```bash
fly secrets set REDIS_URL="rediss://default:password@host:6379" --app your-linkforty-app
```

**Important:** Use `rediss://` (with double 's') for TLS encryption.

## Redis URL Format

Your `REDIS_URL` should follow this format:

```
rediss://default:password@host:6379
```

**Components:**
- `rediss://` - Redis with TLS (**required** for security)
- `default` - Username (Upstash default)
- `password` - Authentication token from Upstash
- `host` - Upstash endpoint (e.g., `xxx-us-east-1.upstash.io`)
- `6379` - Standard Redis port

## Verifying Redis Connection

After setting the `REDIS_URL`, deploy and check logs:

```bash
fly deploy
fly logs
```

Look for:
```
Redis connected successfully
```

If Redis is unavailable, LinkForty will still work but will query the database for every link lookup (slower).

## How LinkForty Uses Redis

### Cache Strategy

LinkForty caches link lookups with this pattern:

1. **Request:** User visits `https://your-app.fly.dev/abc123`
2. **Check Redis:** Look for cached link data
   - **Cache hit:** Return immediately (< 5ms)
   - **Cache miss:** Query database, cache result
3. **TTL:** Cached for 1 hour (configurable)

### What Gets Cached

- Link metadata (URLs, targeting rules, UTM params)
- Link expiration status
- User ID associations

### What Doesn't Get Cached

- Click events (always written to database)
- Analytics aggregations
- Link creation/updates

## Performance Benefits

With Redis enabled:
- **Link redirects:** ~5ms (vs ~50-200ms without cache)
- **Database load:** Reduced by ~90% for popular links
- **Scalability:** Handle 1000+ req/s on small instances

Without Redis:
- Every redirect hits the database
- Higher latency for users
- More database resources needed
- Lower maximum throughput

## Monitoring Redis

### Check Connection

```bash
# View app logs
fly logs --app your-linkforty-app | grep -i redis

# Check if REDIS_URL is set
fly secrets list --app your-linkforty-app
```

### Monitor Usage (Upstash Dashboard)

Visit [Upstash Console](https://console.upstash.com/):
- View daily command count
- Monitor memory usage
- Check hit/miss ratio
- See latency metrics

### Redis CLI Access

Connect to your Redis instance:

```bash
# Install redis-cli if needed
brew install redis  # macOS
apt-get install redis-tools  # Linux

# Connect using REDIS_URL
redis-cli -u "rediss://default:password@host:6379"

# Once connected:
PING                    # Should return PONG
KEYS link:*             # List cached links
GET link:abc123         # View specific cached link
TTL link:abc123         # Check time-to-live
INFO stats              # View Redis stats
DBSIZE                  # Count of keys
FLUSHDB                 # ⚠️ Clear all cache (use with caution)
```

## Cache Invalidation

### Automatic Invalidation

LinkForty automatically invalidates cache when:
- Link is updated
- Link is deleted
- Link expires

### Manual Invalidation

If needed, clear cache for a specific link:

```bash
redis-cli -u "rediss://default:password@host:6379" DEL link:abc123
```

Clear all cached links:

```bash
redis-cli -u "rediss://default:password@host:6379" FLUSHDB
```

### Cache TTL Configuration

Default TTL is 1 hour. To adjust, modify the caching layer in LinkForty:

```typescript
// In your Redis cache implementation
const TTL = 60 * 60; // 1 hour in seconds
await redis.set(key, value, 'EX', TTL);
```

Consider:
- **Short TTL (5-15 min):** More accurate, higher DB load
- **Long TTL (1-4 hours):** Lower DB load, potentially stale data
- **No TTL:** Manual invalidation only (not recommended)

## Scaling Redis

### When to Upgrade

Monitor these metrics:
- **Commands/day approaching limit** → Upgrade plan
- **Memory usage > 80%** → Upgrade plan or enable eviction
- **High latency (>10ms)** → Consider global replication
- **Frequent cache misses** → Increase TTL or memory

### Upgrade Plan

```bash
# Via Upstash dashboard
# https://console.upstash.com/ → Select database → Change plan
```

No downtime during plan changes.

### Global Replication (Multi-Region)

For lower latency worldwide, enable global replication:

1. In Upstash dashboard, enable "Read Replicas"
2. Choose replica regions (e.g., `us-east`, `eu-west`, `ap-southeast`)
3. Upstash automatically routes reads to nearest replica

**Cost:** ~2x base price per replica region

## Security

### TLS Encryption

Always use `rediss://` (TLS) in production:

```bash
# ✅ Correct (encrypted)
rediss://default:password@host:6379

# ❌ Wrong (unencrypted)
redis://default:password@host:6379
```

### Password Rotation

Rotate Redis password quarterly:

1. In Upstash dashboard: **Database → Settings → Reset Password**
2. Copy new password
3. Update secret:
   ```bash
   fly secrets set REDIS_URL="rediss://default:NEW_PASSWORD@host:6379"
   ```
4. Deploy:
   ```bash
   fly deploy
   ```

### Network Security

Upstash Redis is publicly accessible but:
- Requires authentication (password)
- Uses TLS encryption
- Supports IP allowlisting (in Upstash dashboard)

For extra security, enable IP allowlisting:
1. Get your Fly.io app's public IPs: `fly ips list`
2. In Upstash dashboard: **Settings → IP Allowlist**
3. Add Fly.io IPs

## Troubleshooting

### Redis Connection Fails

```bash
# Check REDIS_URL is set correctly
fly secrets list --app your-linkforty-app

# Test connection manually
redis-cli -u "rediss://default:password@host:6379" PING

# Check app logs for errors
fly logs --app your-linkforty-app | grep -i redis
```

Common issues:
- Wrong password → Reset in Upstash dashboard
- Missing `rediss://` protocol → Use TLS version
- Firewall blocking port 6379 → Check Upstash IP allowlist

### High Latency

```bash
# Test latency
redis-cli -u "rediss://default:password@host:6379" --latency

# Check from your app
redis-cli -u "rediss://default:password@host:6379" SLOWLOG GET 10
```

Solutions:
- Enable global replication for multi-region apps
- Check Upstash status page
- Verify region matches your app region

### Memory Full (Eviction Errors)

```bash
# Check memory usage
redis-cli -u "rediss://default:password@host:6379" INFO memory

# Check eviction stats
redis-cli -u "rediss://default:password@host:6379" INFO stats | grep evicted
```

Solutions:
- Upgrade to larger plan
- Reduce cache TTL
- Implement selective caching (only cache popular links)

### Cache Hit Rate Too Low

```bash
# Check hit rate
redis-cli -u "rediss://default:password@host:6379" INFO stats
# Look for: keyspace_hits and keyspace_misses
```

Low hit rate causes:
- TTL too short
- Traffic pattern (mostly unique links)
- Not enough memory (evictions)

Solutions:
- Increase TTL (if data staleness is acceptable)
- Increase memory (upgrade plan)
- Profile which links are being accessed

## Running Without Redis

LinkForty works without Redis, but with performance trade-offs:

### Performance Without Redis

- **Latency:** ~50-200ms per redirect (vs ~5ms with Redis)
- **Database load:** 10x higher
- **Throughput:** Lower maximum requests/second
- **Costs:** Higher database instance needed

### Disabling Redis

Simply don't set `REDIS_URL`:

```bash
fly secrets unset REDIS_URL --app your-linkforty-app
```

LinkForty detects missing Redis and falls back to database-only mode.

### When to Skip Redis

Skip Redis if:
- Very low traffic (< 100 redirects/day)
- Budget is extremely tight
- All links are unique (no repeated lookups)
- Development/testing only

## Cost Optimization

### Free Tier (Good for Development)
- 256MB storage
- 10,000 commands/day
- ~300 redirects/day with caching
- **Cost: $0/month**

### Small Production ($10/month)
- 1GB storage
- 100K commands/day
- ~3,000 redirects/day with caching
- **Cost: $10/month**

### Estimate Your Needs

Calculate commands/day:
- Link redirect with cache hit: 1 command (`GET`)
- Link redirect with cache miss: 2 commands (`GET` + `SET`)
- Assume 50% hit rate: 1.5 commands per redirect
- For 10,000 redirects/day: ~15,000 commands/day

Choose plan accordingly.

### Cost Monitoring

```bash
# In Upstash dashboard
# View: Billing → Current Usage
```

Set up alerts for:
- 80% of command limit reached
- 80% of storage used

## Alternative: Self-Hosted Redis

Instead of Upstash, you can run Redis on Fly.io:

### Create Redis Machine

```bash
fly launch --image redis:7-alpine --name linkforty-redis --region iad
```

**Pros:**
- Lower cost for high traffic
- Full control

**Cons:**
- You manage backups
- You manage security
- No automatic scaling
- More operational overhead

**Not recommended** unless you have specific requirements or very high traffic (>1M commands/day).

## Best Practices

1. **Always use TLS** (`rediss://`)
2. **Set reasonable TTL** (1-4 hours for links)
3. **Monitor hit rate** (target >70%)
4. **Rotate passwords** quarterly
5. **Enable global replication** for multi-region deployments
6. **Set up alerts** for command limits
7. **Start small** (free tier) and scale up based on metrics

## Resources

- [Upstash Documentation](https://docs.upstash.com/redis)
- [Redis Documentation](https://redis.io/documentation)
- [Fly.io Redis Guide](https://fly.io/docs/reference/redis/)
- [Cache Invalidation Strategies](https://redis.io/docs/manual/keyspace-notifications/)

---

**Need Help?**
- Upstash Support: https://upstash.com/docs/redis/support
- Redis Community: https://redis.io/community
- Fly.io Community: https://community.fly.io/
