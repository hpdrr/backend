# Use an official Node.js runtime as a parent image
# Using 'slim' for a smaller image size
FROM node:18-slim

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package*.json ./

# Install app dependencies
# Use --only=production to install only necessary packages for a smaller image
RUN npm install --only=production

# Bundle app source
COPY . .

# Your Hapi app listens on a port defined by the PORT environment variable.
# Cloud Run will automatically provide this variable. Let's expose a default.
EXPOSE 3000

# Define the command to run your app
CMD [ "npm", "start" ]
