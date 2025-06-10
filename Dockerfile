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

# Create directory for agent data
RUN mkdir -p /app/agent_data

# Make start script executable
RUN chmod +x scripts/start-hypha-service.sh

# Pre-cache dependencies as root (nodeModulesDir: "none" means no node_modules created)
# Use --frozen to prevent lock file updates during build
RUN deno cache --lock=deno.lock --frozen scripts/hypha-service.ts

# Also cache the main module
RUN deno cache --lock=deno.lock --frozen mod.ts

# Set ownership for deno user
RUN chown -R deno:deno /app /home/deno/.cache

# Switch to deno user
USER deno

# Expose the Hypha service port
EXPOSE 8000

# Run the service with frozen lock to prevent lock file updates at runtime
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "--lock=deno.lock", "--frozen", "scripts/hypha-service.ts"] 