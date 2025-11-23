# Docker Deployment Guide

This guide covers deploying LinkForty using Docker and Docker Compose.

## Quick Start

### Using Docker Compose (Recommended)

1. **Download the docker-compose.yml file:**
   ```bash
   curl -O https://raw.githubusercontent.com/linkforty/core/main/docker-compose.yml
   ```

2. **Create a `.env` file:**
   ```bash
   # Download the example
   curl -O https://raw.githubusercontent.com/linkforty/core/main/.env.example
   mv .env.example .env

   # Edit with your settings
   nano .env
   ```

3. **Start LinkForty:**
   ```bash
   docker-compose up -d
   ```

4. **Access your instance:**
   - API: http://localhost:3000
   - Health check: http://localhost:3000/health

### Using Docker CLI

```bash
# Pull the latest image
docker pull linkforty/linkforty:latest

# Run with required services
docker run -d \
  --name linkforty \
  -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host:5432/db \
  -e REDIS_URL=redis://host:6379 \
  linkforty/linkforty:latest
```

## Configuration

### Environment Variables

| Variable       | Required | Default      | Description                           |
|----------------|----------|--------------|---------------------------------------|
| `DATABASE_URL` | Yes      | -            | PostgreSQL connection string          |
| `REDIS_URL`    | No       | -            | Redis connection string (recommended) |
| `PORT`         | No       | `3000`       | Server port                           |
| `NODE_ENV`     | No       | `production` | Environment mode                      |
| `JWT_SECRET`   | No       | -            | JWT signing secret                    |

See [.env.example](.env.example) for complete configuration options.

### Docker Compose Configuration

The `docker-compose.yml` file includes:
- **LinkForty API** - Main application server
- **PostgreSQL** - Database for persistent storage
- **Redis** - Caching layer for performance

#### Customizing Ports

Edit your `.env` file:
```env
LINKFORTY_PORT=8080  # Change API port
POSTGRES_PORT=5433   # Change Postgres port
REDIS_PORT=6380      # Change Redis port
```

#### Using Your Own Database

If you have an existing PostgreSQL or Redis instance:

```yaml
# docker-compose.yml
services:
  linkforty:
    image: linkforty/linkforty:latest
    environment:
      DATABASE_URL: postgresql://user:pass@your-db-host:5432/linkforty
      REDIS_URL: redis://your-redis-host:6379
    # Remove the postgres and redis services
```

## Production Deployment

### Security Best Practices

1. **Change default passwords:**
   ```bash
   # Generate secure random password
   openssl rand -base64 32
   ```

2. **Use secrets for sensitive data:**
   ```bash
   # Create a secrets file
   echo "postgresql://user:$(openssl rand -base64 32)@postgres:5432/linkforty" > db_url.secret
   ```

   ```yaml
   # docker-compose.yml
   services:
     linkforty:
       secrets:
         - db_url
   secrets:
     db_url:
       file: ./db_url.secret
   ```

3. **Use a reverse proxy (Nginx/Traefik):**
   ```yaml
   # Add Nginx service
   services:
     nginx:
       image: nginx:alpine
       ports:
         - "80:80"
         - "443:443"
       volumes:
         - ./nginx.conf:/etc/nginx/nginx.conf:ro
         - ./ssl:/etc/nginx/ssl:ro
   ```

### Persistent Data

Volumes are automatically created for:
- `postgres_data` - Database files
- `redis_data` - Redis persistence

**Backup your data:**
```bash
# Backup PostgreSQL
docker-compose exec postgres pg_dump -U linkforty linkforty > backup.sql

# Backup volumes
docker run --rm -v linkforty_postgres_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/postgres-backup.tar.gz /data
```

### Health Checks

The LinkForty container includes a built-in health check:

```bash
# Check container health
docker ps

# View health check logs
docker inspect --format='{{json .State.Health}}' linkforty | jq
```

## Versioning

### Available Tags

- `latest` - Latest stable release
- `v1.3.0` - Specific version
- `v1.3` - Latest patch of minor version
- `v1` - Latest minor of major version
- `sha-abc123` - Specific commit build

### Pinning Versions

**Recommended for production:**
```yaml
services:
  linkforty:
    image: linkforty/linkforty:v1.3.0  # Pin to specific version
```

### Updating

```bash
# Pull latest version
docker-compose pull

# Restart with new version
docker-compose up -d

# View logs
docker-compose logs -f linkforty
```

## Troubleshooting

### Container won't start

1. **Check logs:**
   ```bash
   docker-compose logs linkforty
   ```

2. **Verify database connection:**
   ```bash
   docker-compose exec linkforty sh -c 'echo "SELECT 1" | psql $DATABASE_URL'
   ```

3. **Check health status:**
   ```bash
   docker-compose ps
   ```

### Database migration issues

Run migrations manually:
```bash
docker-compose exec linkforty tsx dist/scripts/migrate.js
```

### Port already in use

Change the port mapping in `.env`:
```env
LINKFORTY_PORT=8080
```

Or use different ports in docker-compose:
```yaml
services:
  linkforty:
    ports:
      - "8080:3000"  # External:Internal
```

## Advanced Configuration

### Multi-Architecture Support

The published images support both AMD64 and ARM64:
```bash
# Automatically pulls correct architecture
docker pull linkforty/linkforty:latest
```

### Custom Dockerfile

If you need to customize the image:

```dockerfile
FROM linkforty/linkforty:latest

# Add custom scripts
COPY ./custom-scripts /app/scripts

# Install additional tools
RUN apk add --no-cache curl

# Custom entrypoint
COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

### Development Mode

Build and run locally:
```bash
# Clone repository
git clone https://github.com/linkforty/core.git
cd core

# Build image
docker build -t linkforty-dev .

# Run with development settings
docker-compose -f docker-compose.yml up
```

## GitHub Actions Auto-Publishing

Images are automatically published when:
- **Tags are pushed** (e.g., `v1.3.0`) → Triggers release build
- **Main branch updated** → Updates `latest` tag
- **Pull requests** → Test build only (not published)

### Setting Up Auto-Publishing (For Maintainers)

1. Create Docker Hub access token at https://hub.docker.com/settings/security

2. Add GitHub secrets:
   - Go to repository Settings → Secrets and variables → Actions
   - Add `DOCKERHUB_USERNAME` (your Docker Hub username)
   - Add `DOCKERHUB_TOKEN` (your access token)

3. Create a new release:
   ```bash
   git tag v1.3.1
   git push origin v1.3.1
   ```

4. GitHub Actions will automatically:
   - Build the Docker image
   - Run tests
   - Push to Docker Hub
   - Create GitHub release notes

## Support

- **Issues:** https://github.com/linkforty/core/issues
- **Discussions:** https://github.com/linkforty/core/discussions
- **Documentation:** https://docs.linkforty.com

## License

MIT License - see [LICENSE](LICENSE) for details
