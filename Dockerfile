# Use official Node.js 20 slim image
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy all app files
COPY . .

# Expose the port that Cloud Run will use
EXPOSE 8080

# Start the server using the port Cloud Run provides
CMD ["node", "server.js"]
