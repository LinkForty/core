FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY dist ./dist
COPY examples/basic-server.ts ./

# Install tsx for running TypeScript
RUN npm install -g tsx

# Run migrations on startup and then start server
CMD sh -c "tsx dist/scripts/migrate.js && tsx basic-server.ts"
