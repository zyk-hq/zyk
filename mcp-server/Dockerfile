FROM node:20-alpine

WORKDIR /app

# Install all deps (including devDeps needed for tsc)
COPY package.json package-lock.json* ./
RUN npm install

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --omit=dev

# Create workflows directory
RUN mkdir -p /app/workflows

EXPOSE 3100

CMD ["node", "dist/index.js"]
