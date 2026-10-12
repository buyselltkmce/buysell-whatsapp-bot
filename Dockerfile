# Use Node.js LTS with required Chromium dependencies
FROM node:20-slim

# Install latest chrome dev package and fonts to support major charsets
RUN apt-get update \
    && apt-get install -y wget gnupg ca-certificates procps libxss1 \
    && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to skip installing Chrome and use the installed package
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Expose microservice port
EXPOSE 5001

# Start the microservice
CMD [ "npm", "start" ]
