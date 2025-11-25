<div align="center">
  <img src="../assets/logo.png" alt="LinkForty Logo" width="150"/>

  # LinkForty Infrastructure

  This directory contains infrastructure-as-code templates and deployment guides for running LinkForty in production environments.
</div>

## Available Deployment Options

### Docker & Docker Compose (Self-Hosted)
For local development or self-managed infrastructure.

**Location:** [`examples/`](../examples/)

**Best for:**
- Local development
- Self-managed VPS/bare metal servers
- Custom infrastructure requirements
- Full control over all components

**What's included:**
- Multi-stage Dockerfile for production builds
- Docker Compose orchestration with PostgreSQL and Redis
- Environment configuration examples

[View Docker deployment guide →](../examples/README.md)

---

### Fly.io (Managed Platform)
Recommended for production deployments with minimal DevOps overhead.

**Location:** [`infra/fly.io/`](./fly.io/)

**Best for:**
- Production deployments
- Global edge distribution
- Auto-scaling applications
- Managed PostgreSQL and Redis
- Teams without dedicated DevOps

**What's included:**
- `fly.toml` - Application configuration
- Deployment guide with step-by-step instructions
- PostgreSQL and Redis setup guides
- Production security checklist
- Environment configuration templates

[View Fly.io deployment guide →](./fly.io/DEPLOYMENT.md)

**Estimated costs:** Starting at ~$10-15/month for small production deployments

---

## Choosing a Deployment Option

| Feature                       | Docker Compose             | Fly.io                      |
|-------------------------------|----------------------------|-----------------------------|
| **Setup complexity**          | Medium                     | Low                         |
| **Infrastructure management** | You manage                 | Fully managed               |
| **Scaling**                   | Manual                     | Automatic                   |
| **Global distribution**       | Manual setup               | Built-in edge regions       |
| **Database backups**          | You configure              | Automated                   |
| **SSL/TLS certificates**      | You configure              | Automatic                   |
| **Cost**                      | Infrastructure only        | ~$10-15+/month              |
| **Best for**                  | Custom needs, self-hosting | Production, fast deployment |

## Community-Contributed Providers

We welcome community contributions for additional infrastructure providers! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

**Requested providers:**
- AWS (ECS/Fargate)
- Google Cloud Run
- Azure Container Instances
- Railway
- Render
- DigitalOcean App Platform

## Support

### Official Support
We provide official support and maintenance for:
- Docker & Docker Compose templates (in `examples/`)
- Fly.io templates (in `infra/fly.io/`)

### Community Support
Additional provider templates are community-maintained. We validate they work but may not provide detailed troubleshooting for provider-specific issues.

### Getting Help

- **Application issues:** [GitHub Issues](https://github.com/yourusername/linkforty-core/issues)
- **Infrastructure questions:** Check provider-specific documentation first
- **Security concerns:** See [SECURITY.md](../SECURITY.md)

## Security Notice

**Production Deployment Responsibility**

While we provide infrastructure templates and security checklists, **you are responsible for**:
- Securing your cloud provider accounts
- Managing secrets and API keys
- Configuring firewalls and network policies
- Compliance with relevant regulations (GDPR, HIPAA, etc.)
- Monitoring and incident response
- Cost management and billing

Always review the security checklist for your chosen platform before deploying to production.

## Quick Start

1. Choose your deployment platform
2. Follow the deployment guide in the respective directory
3. Review the security checklist
4. Deploy and test
5. Set up monitoring and backups

## License

All infrastructure templates are provided under the same MIT license as LinkForty Core.
