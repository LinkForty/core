# Security Policy

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in LinkForty Core, please send an email to:

**security@linkforty.com**

### What to Include

Please include the following information in your report:

- **Description**: A clear description of the vulnerability
- **Impact**: What an attacker could do with this vulnerability
- **Reproduction**: Step-by-step instructions to reproduce the issue
- **Version**: The version of LinkForty Core affected
- **Suggested Fix**: If you have a proposed solution (optional)

### What to Expect

- **Acknowledgment**: We'll acknowledge your email within 48 hours
- **Updates**: We'll keep you informed about our progress
- **Credit**: With your permission, we'll credit you in the security advisory
- **Timeline**: We aim to patch critical vulnerabilities within 7 days

## Supported Versions

We provide security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Security Measures

### CI/CD Security

Our CI/CD pipeline implements several security measures:

1. **Fork PR Isolation**: Pull requests from forks cannot access repository secrets
2. **Branch Protection**: Main branch requires reviews and passing CI checks
3. **Automated Releases**: Only automated releases can publish to NPM
4. **Provenance**: All NPM packages include build provenance
5. **Secret Scanning**: GitHub's secret scanning is enabled

### Package Security

- **NPM 2FA**: Publishing requires 2-factor authentication
- **Provenance**: Packages include cryptographic proof of origin
- **Dependency Scanning**: Dependabot monitors for vulnerable dependencies
- **Regular Updates**: We keep dependencies up to date

### Code Security

- **Input Validation**: All user inputs are validated and sanitized
- **SQL Injection**: We use parameterized queries to prevent SQL injection
- **XSS Protection**: Output is properly escaped
- **Rate Limiting**: API endpoints support rate limiting
- **Authentication**: JWT-based authentication with secure defaults

## Security Best Practices for Contributors

### Do's

✅ **Do** use environment variables for sensitive configuration
✅ **Do** validate and sanitize all user inputs
✅ **Do** use parameterized queries for database operations
✅ **Do** keep dependencies updated
✅ **Do** review security implications of your changes

### Don'ts

❌ **Don't** commit secrets, API keys, or passwords
❌ **Don't** use `eval()` or similar dynamic code execution
❌ **Don't** trust user input without validation
❌ **Don't** expose internal error details to users
❌ **Don't** use outdated or vulnerable dependencies

## Known Security Considerations

### Environment Variables

The following environment variables should be kept secure:

- `DATABASE_URL` - Contains database credentials
- `REDIS_URL` - Contains Redis credentials (if used)
- `JWT_SECRET` - Used for token signing
- Any custom API keys or secrets

### Production Deployment

For production deployments:

1. **Use strong passwords** for database and Redis
2. **Enable SSL/TLS** for all connections
3. **Set secure JWT secret** (minimum 32 characters)
4. **Implement rate limiting** to prevent abuse
5. **Use environment-specific configurations**
6. **Keep the package updated** to get security patches

## Security Updates

We publish security updates through:

- **GitHub Security Advisories**: For disclosed vulnerabilities
- **NPM Package Updates**: Patched versions published to npm
- **CHANGELOG.md**: Security fixes documented in changelog
- **GitHub Releases**: Release notes include security information

Subscribe to our releases to stay informed about security updates.

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [npm Security](https://docs.npmjs.com/packages-and-modules/securing-your-code)

## Questions?

If you have questions about security that don't involve reporting a vulnerability:

- Open a [Discussion](https://github.com/linkforty/core/discussions)
- Email: hello@linkforty.com

Thank you for helping keep LinkForty Core secure! 🔒
