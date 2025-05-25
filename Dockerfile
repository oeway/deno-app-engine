FROM --platform=linux/amd64 denoland/deno:debian-2.2.12

WORKDIR /app

# Install required system dependencies for native modules
USER root
RUN apt-get update && apt-get install -y \
    libstdc++6 \
    libc6 \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files first to leverage Docker layer caching
COPY deno.json deno.lock ./

# Copy application code
COPY . .

# Create directory for Pyodide cache
RUN mkdir -p /home/deno/.cache/pyodide

# Make start script executable
RUN chmod +x scripts/start-hypha-service.sh

# Pre-cache dependencies as root to avoid permission issues with node_modules
RUN deno cache --lock=deno.lock scripts/hypha-service.ts

# Set permissions for deno user (including node_modules if it exists)
RUN chown -R deno:deno /app /home/deno/.cache

# Ensure node_modules/.bin files are executable by deno user
RUN if [ -d "/app/node_modules/.bin" ]; then \
    chmod -R 755 /app/node_modules/.bin && \
    chown -R deno:deno /app/node_modules; \
    fi

# Switch to deno user
USER deno

# Expose the Hypha service port
EXPOSE 8000

# Run the service directly without tini
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "scripts/hypha-service.ts"] 