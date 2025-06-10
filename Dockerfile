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

# Create a writable directory for worker lockfiles
RUN mkdir -p /tmp/deno-worker-cache

# Make start script executable
RUN chmod +x scripts/start-hypha-service.sh

# Pre-cache dependencies as root (nodeModulesDir: "none" means no node_modules created)
# First update lockfile with all dependencies (including worker files)
RUN deno cache --reload --lock=deno.lock scripts/hypha-service.ts mod.ts kernel/worker.ts kernel/tsWorker.ts vectordb/worker.ts agents/manager.ts

# Then cache all TypeScript files with frozen lockfile to prevent further updates
RUN find kernel/ vectordb/ agents/ -name "*.ts" -exec deno cache --lock=deno.lock --frozen {} \;

# Set ownership for deno user
RUN chown -R deno:deno /app /home/deno/.cache

# Switch to deno user
USER deno

# Expose the Hypha service port
EXPOSE 8000

# Run the service (dependencies fully pre-cached, so --frozen may not be needed)
# Set DENO_DIR to writable location for worker processes  
ENV DENO_DIR=/tmp/deno-worker-cache
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "scripts/hypha-service.ts"] 