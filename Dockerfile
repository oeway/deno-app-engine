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
RUN deno cache --lock=deno.lock scripts/hypha-service.ts

# Set ownership for deno user
RUN chown -R deno:deno /app /home/deno/.cache

# Switch to deno user
USER deno

# Expose the Hypha service port
EXPOSE 8000

# Run the service
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "scripts/hypha-service.ts"] 