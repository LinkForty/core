# Contributing Infrastructure Templates

Thank you for your interest in contributing infrastructure templates to Link Forty! This guide will help you add support for new cloud platforms and deployment methods.

## Overview

We welcome community contributions for additional infrastructure providers. This allows Link Forty users to deploy on their preferred platforms with minimal setup.

## Official vs Community Support

### Official Support (Maintained by Core Team)
- Docker & Docker Compose (`examples/`)
- Fly.io (`infra/fly.io/`)

### Community Support (Maintained by Contributors)
- All other platforms
- We validate they work but may not provide detailed troubleshooting

## Contribution Guidelines

### Before You Start

1. **Check existing issues/PRs** to avoid duplicate work
2. **Open a discussion** on GitHub to gauge interest
3. **Choose a popular platform** that benefits many users
4. **Test thoroughly** before submitting

### Requested Providers

We're especially interested in templates for:
- **AWS** (ECS/Fargate, Elastic Beanstalk)
- **Google Cloud** (Cloud Run, GKE)
- **Azure** (Container Instances, App Service)
- **Railway**
- **Render**
- **DigitalOcean App Platform**
- **Kubernetes** (generic manifests)
- **Terraform** (multi-cloud IaC)

## Template Requirements

### Must-Have Components

Your infrastructure template **must** include:

1. **Configuration Files**
   - Platform-specific deployment config (e.g., `app.yaml`, `terraform.tf`)
   - Environment variable template
   - Build/deployment instructions

2. **Documentation**
   - `DEPLOYMENT.md` - Step-by-step deployment guide
   - Database setup instructions
   - Redis setup instructions (optional but recommended)
   - Cost estimates for different tiers

3. **Security Guidelines**
   - SSL/TLS configuration
   - Secret management best practices
   - Network security recommendations
   - Backup strategy

4. **Testing**
   - Proof of successful deployment
   - Screenshots or deployment logs
   - Performance benchmarks (optional)

### Directory Structure

Add your template under `infra/[provider]/`:

```
infra/
├── your-provider/
│   ├── README.md                    # Quick overview
│   ├── DEPLOYMENT.md                # Detailed deployment guide
│   ├── config.[ext]                 # Platform-specific config
│   ├── .env.production.example      # Environment variables
│   └── [additional files]           # Provider-specific resources
```

### Example Structure: AWS ECS

```
infra/
├── aws-ecs/
│   ├── README.md                    # Overview of AWS ECS deployment
│   ├── DEPLOYMENT.md                # Step-by-step guide
│   ├── task-definition.json         # ECS task definition
│   ├── service.json                 # ECS service config
│   ├── cloudformation.yaml          # Infrastructure template (optional)
│   ├── .env.production.example      # Environment variables
│   └── scripts/
│       ├── setup.sh                 # Automated setup script (optional)
│       └── deploy.sh                # Deployment script (optional)
```

## Documentation Standards

### DEPLOYMENT.md Template

Your `DEPLOYMENT.md` should include:

```markdown
# Deploying Link Forty to [Provider Name]

## Prerequisites
- Account setup
- CLI tools needed
- Required permissions

## Step 1: Database Setup
- PostgreSQL 13+ configuration
- Connection string format
- Security settings

## Step 2: Redis Setup (Optional)
- Redis configuration
- Connection string format

## Step 3: Application Deployment
- Configuration steps
- Secret management
- Build and deploy process

## Step 4: Verification
- Health check verification
- Test redirect creation
- Troubleshooting common issues

## Scaling
- Vertical scaling
- Horizontal scaling
- Multi-region deployment

## Monitoring
- Logs access
- Metrics dashboard
- Alerts setup

## Cost Estimation
- Free tier (if available)
- Small production setup
- Large production setup

## Troubleshooting
- Common issues and solutions

## Resources
- Platform documentation links
```

### README.md Template

```markdown
# Link Forty on [Provider Name]

Quick overview of deploying Link Forty to [Provider].

## Quick Start

[One-click deploy button if available]

## Features
- What makes this platform good for Link Forty
- Key benefits

## Cost Estimate
- Starting at $X/month

## Documentation
- [Full deployment guide](./DEPLOYMENT.md)

## Support
- Community-maintained
- Link to platform's support
```

## Code Quality Standards

### Configuration Files

- **Use comments** to explain non-obvious settings
- **Include defaults** that work for most users
- **Parameterize** where possible (don't hardcode values)
- **Follow platform conventions** (naming, structure)

### Environment Variables

- **Match Link Forty's standards** (see `examples/.env.example`)
- **Include all required variables**
- **Document optional variables**
- **Show example values** (with placeholders for secrets)

### Security

- **Never include actual secrets** in example files
- **Use secure defaults** (SSL/TLS, authentication)
- **Document security best practices**
- **Include secret rotation instructions**

## Testing Your Template

Before submitting, test your template:

### 1. Fresh Deployment Test

- [ ] Start from scratch (new account or clean environment)
- [ ] Follow your DEPLOYMENT.md step-by-step
- [ ] Verify all commands work as documented
- [ ] Note any issues or unclear steps

### 2. Functional Test

- [ ] Application starts successfully
- [ ] Health check endpoint responds
- [ ] Create a test link via API
- [ ] Verify redirect works
- [ ] Check logs are accessible
- [ ] Test database connection
- [ ] Test Redis connection (if used)

### 3. Security Test

- [ ] HTTPS is enforced
- [ ] Secrets are not exposed in logs
- [ ] Database uses SSL
- [ ] CORS is configurable
- [ ] No public exposure of internal services

### 4. Documentation Test

- [ ] Another person can follow your guide successfully
- [ ] All prerequisites are listed
- [ ] Cost estimates are accurate
- [ ] Troubleshooting section is helpful

## Pull Request Process

### 1. Prepare Your PR

Create a branch:
```bash
git checkout -b infra/add-[provider-name]
```

Add your files:
```bash
git add infra/[provider-name]/
```

Commit with clear message:
```bash
git commit -m "Add infrastructure template for [Provider Name]"
```

### 2. Update Main README

Add your provider to `infra/README.md`:

```markdown
### [Provider Name] (Community)
**Location:** [`infra/[provider-name]/`](./[provider-name]/)

**Best for:**
- [Use case 1]
- [Use case 2]

[View deployment guide →](./[provider-name]/DEPLOYMENT.md)
```

### 3. PR Description Template

```markdown
## Summary
Adds infrastructure template for deploying Link Forty to [Provider Name].

## What's Included
- [ ] Configuration files
- [ ] Deployment guide
- [ ] Environment variable template
- [ ] Security documentation
- [ ] Cost estimates

## Testing
- [ ] Successfully deployed to [Provider]
- [ ] Verified all features work
- [ ] Tested by at least one other person

## Screenshots/Logs
[Include proof of successful deployment]

## Cost Estimate
- Free tier: [Yes/No]
- Small production: ~$X/month
- Medium production: ~$Y/month

## Additional Notes
[Any platform-specific quirks or considerations]
```

### 4. Review Process

Your PR will be reviewed for:
- **Completeness** - All required components present
- **Accuracy** - Instructions work as documented
- **Security** - Follows best practices
- **Quality** - Clear, well-documented
- **Maintenance** - Reasonable to maintain

We may request changes or improvements.

### 5. After Merge

- Your template will be listed in the main README
- You'll be credited as the maintainer
- Users may open issues specific to your platform
- You'll be tagged for platform-specific questions

## Maintenance Expectations

### As a Contributor

You're expected to:
- **Respond to issues** related to your platform (within reason)
- **Update templates** when platform changes significantly
- **Test updates** before merging changes
- **Notify maintainers** if you can no longer maintain

### If You Can't Maintain

If you can't continue maintaining:
1. Open an issue titled "Seeking maintainer for [Provider]"
2. Tag current maintainers
3. We'll mark it as "community-seeking-maintainer"

### What Core Maintainers Will Do

- Review and merge PRs for your platform
- Help with general Link Forty questions
- Validate deployments still work (periodically)
- Archive unmaintained platforms (if necessary)

### What Core Maintainers Won't Do

- Debug provider-specific issues (beyond basic validation)
- Maintain deep expertise in all platforms
- Provide 24/7 support for community platforms

## Support Boundaries

### In-Scope Support (You Provide)

- Platform-specific deployment questions
- Configuration issues unique to the platform
- Cost optimization for that platform
- Platform CLI/API usage

### Out-of-Scope Support (User's Responsibility)

- Cloud account setup and billing
- Platform account permissions/access issues
- General cloud computing questions
- Non-Link-Forty application issues

### Core Link Forty Support (Maintainers Provide)

- Application bugs
- Database schema issues
- API behavior questions
- General architecture questions

## Examples to Learn From

### Good Example: Fly.io Template

Located at `infra/fly.io/`, this template demonstrates:
- ✅ Clear, step-by-step instructions
- ✅ Complete configuration files with comments
- ✅ Security checklist
- ✅ Cost estimates at multiple tiers
- ✅ Troubleshooting section
- ✅ Links to platform documentation

### What Not to Do

- ❌ One-liner deployment without explanation
- ❌ Missing environment variables
- ❌ No security guidance
- ❌ Untested instructions
- ❌ Hardcoded values (like app names)
- ❌ No cost information

## Getting Help

### Questions About Contributing

- Open a discussion on GitHub
- Tag maintainers: @[maintainer-username]
- Join our community chat (if available)

### Technical Questions

- Review existing templates (especially `infra/fly.io/`)
- Check Link Forty's main documentation
- Ask in GitHub Discussions

## Recognition

Contributors will be:
- Listed in the template's README as maintainer
- Mentioned in release notes
- Credited in the project's contributors list

Thank you for helping make Link Forty accessible on more platforms!

## License

All infrastructure templates are licensed under the same MIT license as Link Forty Core.

By contributing, you agree to license your contribution under this license.
