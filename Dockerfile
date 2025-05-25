FROM --platform=linux/amd64 denoland/deno:alpine-2.2.12

WORKDIR /app

# Copy dependency files first to leverage Docker layer caching
COPY deno.json deno.lock ./

# Copy application code
COPY . .

# Create directory for Pyodide cache
RUN mkdir -p /home/deno/.cache/pyodide

# Make start script executable
RUN chmod +x scripts/start-hypha-service.sh

# Set permissions for deno user
RUN chown -R deno:deno /app /home/deno/.cache

# Compile and cache dependencies (deno cache doesn't accept permission flags)
USER deno
RUN deno cache --lock=deno.lock scripts/hypha-service.ts

# Expose the Hypha service port
EXPOSE 8000

# Run the service directly without tini
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-ffi", "scripts/hypha-service.ts"] 