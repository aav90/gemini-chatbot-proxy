FROM node:20-slim

WORKDIR /app

# Copy package.json and package-lock.json (if it exists) first
# This allows Docker to cache the npm install layer if dependencies haven't changed
COPY package*.json ./

# Install all dependencies (remove --production)
RUN npm install

# Copy the rest of your application code
COPY . .

# Command to run your application
CMD ["node", "server.js"]
