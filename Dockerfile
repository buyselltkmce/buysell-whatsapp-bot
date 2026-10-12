FROM node:20-slim

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose microservice port
EXPOSE 5001

# Start the microservice
CMD [ "npm", "start" ]
