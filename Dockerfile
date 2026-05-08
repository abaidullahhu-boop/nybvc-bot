FROM node:20-slim

# Set environment variables to avoid interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies for Playwright and Chrome
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    # Core dependencies for Chrome/Playwright
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libnss3 \
    libxshmfence1 \
    fonts-liberation \
    # Ajoutez ces dépendances
    libgl1-mesa-dri \
    libgl1-mesa-glx \
    libgles2-mesa \
    libegl1 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libharfbuzz-icu0 \
    libglib2.0-0 \
    # Virtual display for non-headless mode
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    dbus-x11 \
    # Clean up unnecessary packages
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Google Chrome
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create a valid machine-id file for Chrome
RUN echo $(cat /proc/sys/kernel/random/uuid | tr -d '-') > /etc/machine-id

# Set working directory
WORKDIR /app

# Copy package files (including bun.lockb if you're using Bun alongside npm)
COPY package*.json ./
COPY bun.lockb ./

COPY google-sheet-credentials.json /app/google-sheet-credentials.json
COPY google-datastore-credentials.json /app/google-datastore-credentials.json

# Install Node.js dependencies
RUN npm install --frozen-lockfile

# Install Playwright and ensure Chromium is available (Chrome can be used too)
RUN npx patchright install --with-deps --force chrome 

# Copy the rest of your application
COPY . .

# Set environment variable for Chrome path (optional, Playwright can find it)
ENV CHROME_PATH=/usr/bin/google-chrome-stable
ENV DISPLAY=:99

# Copy the start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Start Xvfb and run your app
CMD ["/app/start.sh"]