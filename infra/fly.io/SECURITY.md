# Security Checklist for Production Deployment

This checklist helps ensure your LinkForty deployment on Fly.io follows security best practices.

## ✅ Pre-Deployment Security Checklist

### Environment Variables & Secrets

- [ ] All sensitive values are set using `fly secrets set` (never in `fly.toml`)
- [ ] `DATABASE_URL` includes `?sslmode=require` for PostgreSQL
- [ ] `REDIS_URL` includes authentication credentials
- [ ] `CORS_ORIGIN` is set to your actual frontend domain(s), not `*`
- [ ] `NODE_ENV` is set to `"production"`
- [ ] No secrets are committed to version control
- [ ] `.env` files are in `.gitignore`

### Database Security

- [ ] PostgreSQL uses SSL/TLS connections (`sslmode=require`)
- [ ] Database password is strong (20+ characters, random)
- [ ] Database is not publicly accessible (Fly Postgres is private by default)
- [ ] Connection pooling is configured (default: 2-10 connections)
- [ ] Database backups are enabled (see [fly.postgres.md](./fly.postgres.md))
- [ ] Backup retention policy is configured

### Redis Security

- [ ] Redis requires authentication (Upstash Redis includes this by default)
- [ ] Redis connection uses TLS (`rediss://` protocol)
- [ ] Redis is not publicly accessible
- [ ] Connection timeout is configured

### Application Security

- [ ] CORS is properly configured (not set to `*` in production)
- [ ] Rate limiting is enabled for link creation endpoints
- [ ] Input validation is active (Zod schemas)
- [ ] SQL injection protection via parameterized queries (pg library handles this)
- [ ] Health check endpoint (`/health`) exposes no sensitive data
- [ ] Error messages don't leak sensitive information
- [ ] Logging doesn't include secrets or PII

### Network Security

- [ ] HTTPS is enforced (`force_https = true` in fly.toml)
- [ ] HTTP is redirected to HTTPS
- [ ] Health checks use HTTPS
- [ ] No sensitive services are exposed publicly

### Access Control

- [ ] Fly.io account uses strong password + 2FA
- [ ] Fly.io organization access is limited to required team members
- [ ] Deploy tokens (if used in CI/CD) have minimum required permissions
- [ ] Database credentials are rotated regularly (quarterly minimum)

---

## 🔐 Security Configuration Details

### 1. Database URL Security

Your `DATABASE_URL` should look like:
```
postgresql://user:password@host:5432/dbname?sslmode=require
```

Key requirements:
- `sslmode=require` - Forces SSL/TLS encryption
- Strong password (20+ characters)
- Host should be internal Fly network (`.internal` domain) if using Fly Postgres

Set it securely:
```bash
fly secrets set DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
```

### 2. Redis URL Security

Your `REDIS_URL` should look like:
```
rediss://default:password@host:6379
```

Key requirements:
- `rediss://` protocol (TLS encrypted)
- Authentication password included
- Upstash Redis (recommended) includes TLS by default

Set it securely:
```bash
fly secrets set REDIS_URL="rediss://default:password@host:6379"
```

### 3. CORS Configuration

For production, set specific origins:

```bash
# Single origin
fly secrets set CORS_ORIGIN="https://yourdomain.com"

# Multiple origins (comma-separated)
fly secrets set CORS_ORIGIN="https://yourdomain.com,https://app.yourdomain.com"
```

Never use `*` in production - this allows any website to make requests to your API.

### 4. Rate Limiting

LinkForty includes built-in rate limiting. Verify it's enabled in your deployment:

- Link creation: Limited by IP address
- Analytics queries: Limited by userId
- Redirect endpoints: Unlimited (by design for fast redirects)

Monitor rate limit metrics:
```bash
fly logs | grep "rate limit"
```

### 5. Input Validation

LinkForty uses Zod for input validation. Ensure validation errors are logged:

```bash
fly logs | grep "validation"
```

Common validation issues to monitor:
- Invalid URLs
- Malformed userId
- Invalid UTM parameters
- Expired links

---

## 🔄 Secret Rotation Policy

Rotate secrets regularly to minimize compromise risk.

### Quarterly Rotation (Every 3 months)

1. **Database Password**
   ```bash
   # On Fly Postgres
   fly postgres connect -a linkforty-db
   ALTER USER your_user WITH PASSWORD 'new-strong-password';
   \q

   # Update secret
   fly secrets set DATABASE_URL="postgresql://user:new-password@host:5432/dbname?sslmode=require"
   ```

2. **Redis Password**
   ```bash
   # Generate new Upstash Redis credentials
   # In Upstash dashboard: Reset password

   # Update secret
   fly secrets set REDIS_URL="rediss://default:new-password@host:6379"
   ```

3. **API Keys** (if you add API authentication)
   ```bash
   fly secrets set API_KEY="new-random-key"
   ```

### After Security Incident

Rotate ALL secrets immediately:
- Database credentials
- Redis credentials
- Any API keys
- Fly.io deploy tokens (if compromised)

---

## 🔍 Security Monitoring

### Log Monitoring

Monitor these security-relevant events:

```bash
# Failed database connections
fly logs | grep "connection refused"

# Rate limit hits
fly logs | grep "rate limit"

# Validation errors
fly logs | grep "validation error"

# Suspicious activity patterns
fly logs | grep "error"
```

### Metrics to Watch

- **Unusual traffic spikes** - Potential DDoS or abuse
- **High error rates** - Potential attack or misconfiguration
- **Database connection errors** - Credential issues or network problems
- **Redis connection failures** - Service degradation

Access metrics:
```bash
fly dashboard  # Web UI with graphs
fly status     # Current health
```

### Automated Alerts (Recommended)

Set up alerts for:
- High error rates (>5% of requests)
- Service downtime
- Database connection failures
- Unusual traffic patterns

Fly.io integrates with:
- Sentry (error tracking)
- Datadog (monitoring)
- Prometheus (metrics)

---

## 🛡️ Incident Response Plan

### If Secrets Are Compromised

1. **Immediately rotate all secrets**
   ```bash
   # See "Secret Rotation Policy" section above
   ```

2. **Review access logs**
   ```bash
   fly logs --all
   ```

3. **Check for unauthorized database changes**
   ```bash
   fly postgres connect -a linkforty-db
   SELECT * FROM users ORDER BY created_at DESC LIMIT 100;
   SELECT * FROM links ORDER BY created_at DESC LIMIT 100;
   ```

4. **Review Fly.io access logs**
   - Check Fly.io dashboard for recent deploys
   - Review team member access
   - Check for unknown IP addresses

5. **Deploy with new secrets**
   ```bash
   fly deploy
   ```

6. **Document the incident**
   - What was compromised?
   - How was it discovered?
   - What actions were taken?
   - How to prevent in the future?

### If Database Is Compromised

1. **Restore from backup**
   ```bash
   # See fly.postgres.md for backup/restore instructions
   ```

2. **Analyze what data was accessed/modified**

3. **Notify affected users** (if PII was compromised)

4. **Review and strengthen security measures**

---

## 🔒 Data Protection

### Personal Identifiable Information (PII)

LinkForty collects:
- IP addresses (for geolocation)
- User agent strings (for device detection)
- Referrer URLs (for analytics)
- User IDs (provided by you)

**Your responsibilities:**
- Comply with GDPR, CCPA, or relevant privacy laws
- Implement data retention policies
- Provide user data deletion endpoints
- Maintain privacy policy
- Obtain user consent where required

### Data Retention

Consider implementing:
- Automatic deletion of click events older than X days
- User data export functionality
- Data anonymization for old analytics

Example cleanup query:
```sql
DELETE FROM click_events WHERE created_at < NOW() - INTERVAL '90 days';
```

Schedule via cron or Fly.io scheduled tasks.

### Encryption

- **In transit:** HTTPS/TLS for all connections (enforced by Fly.io)
- **At rest:** Fly Postgres encrypts data at rest automatically
- **Application level:** Consider encrypting sensitive user data in JSONB fields

---

## 🚨 Security Vulnerabilities

### Reporting Security Issues

**DO NOT** open public GitHub issues for security vulnerabilities.

Instead:
- Email security@yourdomain.com (set up a security contact)
- Use GitHub Security Advisories (private disclosure)
- Allow 90 days for responsible disclosure

### Keeping Dependencies Updated

```bash
# Check for vulnerabilities
npm audit

# Fix automatically where possible
npm audit fix

# Review and update dependencies quarterly
npm outdated
npm update
```

Subscribe to security advisories:
- Node.js security releases
- Fastify security updates
- PostgreSQL security announcements

---

## ✅ Security Checklist Summary

Print and complete this checklist before every production deployment:

**Pre-Deploy:**
- [ ] Secrets set via `fly secrets set` (not in code)
- [ ] Database uses SSL (`sslmode=require`)
- [ ] CORS configured for specific domains
- [ ] HTTPS enforced in `fly.toml`
- [ ] No secrets in version control

**Post-Deploy:**
- [ ] Health check passes
- [ ] HTTPS redirect works
- [ ] CORS allows only intended domains
- [ ] Database connection successful
- [ ] Redis connection successful
- [ ] Rate limiting active
- [ ] Error logging working

**Ongoing:**
- [ ] Secrets rotated quarterly
- [ ] Dependencies updated monthly
- [ ] Logs monitored weekly
- [ ] Backups verified monthly
- [ ] Access control reviewed quarterly

---

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Fly.io Security Best Practices](https://fly.io/docs/reference/security/)
- [PostgreSQL Security](https://www.postgresql.org/docs/current/runtime-config-connection.html#RUNTIME-CONFIG-CONNECTION-SSL)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Fastify Security](https://www.fastify.io/docs/latest/Guides/Security/)

---

**Last Updated:** 2025-01-13

Review and update this checklist quarterly or after any security incident.
