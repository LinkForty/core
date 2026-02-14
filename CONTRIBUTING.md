<div align="center">
  <img src="./assets/logo.png" alt="LinkForty Logo" width="150"/>

  # Contributing to @linkforty/core

  Thank you for your interest in contributing to LinkForty Core! This document provides guidelines and instructions for contributing.
</div>

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and considerate in all interactions.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Redis 6+ (optional but recommended)
- Git

### Development Setup

1. **Fork and clone the repository**

```bash
git clone https://github.com/YOUR_USERNAME/core.git
cd core
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env with your local database credentials
```

4. **Start PostgreSQL and Redis**

```bash
# Using Docker
docker compose -f examples/docker-compose.yml up -d postgres redis
```

5. **Run database migrations**

```bash
npm run migrate
```

6. **Start development server**

```bash
npm run dev
```

The server will be running at `http://localhost:3000`.

## Development Workflow

### Branch Naming

- `feature/` - New features (e.g., `feature/webhook-support`)
- `fix/` - Bug fixes (e.g., `fix/redirect-caching`)
- `docs/` - Documentation updates (e.g., `docs/api-reference`)
- `refactor/` - Code refactoring (e.g., `refactor/database-connection`)

### Commit Messages

Follow conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

**Examples:**
```
feat(analytics): add webhook support for click events
fix(redirect): cache invalidation on link update
docs(readme): update API examples
```

### Making Changes

1. **Create a new branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**

- Write clean, readable code
- Follow existing code style and patterns
- Add comments for complex logic
- Update documentation if needed

3. **Test your changes**

```bash
npm run build
npm run test  # When tests are available
```

4. **Commit your changes**

```bash
git add .
git commit -m "feat(scope): description"
```

5. **Push to your fork**

```bash
git push origin feature/your-feature-name
```

6. **Create a Pull Request**

- Go to the original repository on GitHub
- Click "New Pull Request"
- Select your fork and branch
- Fill out the PR template with details

## Code Style Guidelines

### TypeScript

- Use TypeScript strict mode
- Define explicit types for function parameters and return values
- Use interfaces for object shapes
- Avoid `any` types when possible

**Example:**
```typescript
interface CreateLinkParams {
  userId: string;
  originalUrl: string;
  title?: string;
}

async function createLink(params: CreateLinkParams): Promise<Link> {
  // Implementation
}
```

### Naming Conventions

- **Files**: kebab-case (e.g., `redirect-handler.ts`)
- **Classes**: PascalCase (e.g., `LinkManager`)
- **Functions**: camelCase (e.g., `createShortLink`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RETRIES`)
- **Interfaces**: PascalCase (e.g., `DatabaseConfig`)

### File Organization

```
src/
├── index.ts              # Main entry point
├── lib/                  # Shared utilities
│   ├── database.ts       # Database connection
│   ├── utils.ts          # Helper functions
│   └── auth.ts           # Authentication
├── routes/               # API routes
│   ├── links.ts
│   ├── analytics.ts
│   └── redirect.ts
└── types/                # TypeScript types
    └── index.ts
```

### Error Handling

- Use try-catch blocks for async operations
- Provide meaningful error messages
- Log errors appropriately

**Example:**
```typescript
try {
  const result = await db.query('SELECT * FROM links WHERE id = $1', [id]);
  if (result.rows.length === 0) {
    throw new Error('Link not found');
  }
  return result.rows[0];
} catch (error) {
  fastify.log.error(`Error fetching link: ${error}`);
  throw error;
}
```

## Testing

### Running Tests

```bash
npm run test
npm run test:watch  # Watch mode
npm run test:coverage  # Coverage report
```

### Writing Tests

- Write tests for all new features
- Ensure existing tests pass
- Aim for >80% code coverage

**Example:**
```typescript
import { describe, it, expect } from 'vitest';
import { detectDevice } from '../lib/utils';

describe('detectDevice', () => {
  it('should detect iOS devices', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)';
    expect(detectDevice(ua)).toBe('ios');
  });

  it('should detect Android devices', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 11; Pixel 5)';
    expect(detectDevice(ua)).toBe('android');
  });

  it('should default to web for unknown devices', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
    expect(detectDevice(ua)).toBe('web');
  });
});
```

## Pull Request Guidelines

### Before Submitting

- [ ] Code builds successfully (`npm run build`)
- [ ] All tests pass (`npm run test`)
- [ ] Documentation is updated
- [ ] No linting errors
- [ ] Commit messages follow conventional format
- [ ] Branch is up to date with main

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Changes Made
- List key changes
- Include relevant details

## Testing
Describe how you tested the changes

## Screenshots (if applicable)
Add screenshots for UI changes

## Related Issues
Closes #123
```

## Documentation

- Update README.md for new features
- Add JSDoc comments for exported functions
- Update API documentation
- Include examples for new functionality

## Questions or Need Help?

- **GitHub Discussions**: For general questions
- **GitHub Issues**: For bug reports and feature requests
- **Discord**: [Join our community](https://discord.gg/linkforty) (if available)

## Contributor License Agreement (CLA)

All contributors must sign our [Contributor License Agreement](CLA.md) before their first pull request can be merged. When you open a PR, the CLA Assistant bot will post a link to sign via GitHub OAuth — it's a one-time step.

The CLA allows us to use your contributions in both the open-source Core project (AGPL-3.0) and the commercial LinkForty Cloud product. You retain full ownership of your contributions.

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License, and you agree to the terms of the [CLA](CLA.md).

## Recognition

Contributors will be recognized in:
- README.md contributors section
- CHANGELOG.md for significant contributions
- GitHub releases notes

Thank you for contributing to LinkForty Core! 🎉
