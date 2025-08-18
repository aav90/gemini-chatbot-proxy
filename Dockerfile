# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if it exists) first
# This allows Docker to cache the npm install layer if dependencies haven't changed
COPY package*.json ./

# Install all dependencies
RUN npm install --production

# Copy the rest of your application code
COPY . .

# Expose the port your app runs on (Cloud Run will use the PORT environment variable)
EXPOSE 8080

# Command to run your application
CMD ["node", "server.js"]
