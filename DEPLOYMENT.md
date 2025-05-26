 p# Deployment Guide

This guide covers deployment options for the Deno App Engine, including automated CI/CD and Docker containerization.

## 🚀 Automated CI/CD

The project includes GitHub Actions workflows that automatically:

- ✅ Run all tests on every push and pull request
- 🐳 Build and publish Docker containers to GitHub Packages
- 🏷️ Create version tags and GitHub releases
- 📊 Generate and upload test coverage reports

### Workflow Overview

1. **Test Workflow** (`test.yml`): Runs on all pushes and PRs
2. **Container Publishing** (`publish-container.yml`): Runs on main branch changes
3. **Combined CI/CD** (`ci.yml`): Comprehensive workflow that does both

### Version Management

Versions are automatically managed based on the `version` field in `deno.json`:

```json
{
  "version": "0.2.0"
}
```

When you update this version and push to main:
1. Tests run automatically
2. Docker images are built and tagged
3. Git tag `v0.2.0` is created
4. GitHub release is published
5. Container is available at `ghcr.io/oeway/deno-app-engine:0.2.0`

## 🐳 Docker Deployment

### Pre-built Images

Docker images are automatically built and published to GitHub Container Registry:

```bash
# Latest version
docker pull ghcr.io/oeway/deno-app-engine:latest

# Specific version
docker pull ghcr.io/oeway/deno-app-engine:0.1.8
```

### Running the Container

#### HTTP Server Mode

```bash
# Basic HTTP server
docker run -p 8000:8000 ghcr.io/oeway/deno-app-engine:latest

# With custom configuration
docker run -p 8000:8000 \
  -e ALLOWED_KERNEL_TYPES="worker-python,worker-typescript" \
  -e KERNEL_POOL_SIZE="4" \
  ghcr.io/oeway/deno-app-engine:latest
```

#### Hypha Service Mode

```bash
# With Hypha configuration
docker run -p 8000:8000 \
  -e HYPHA_SERVER_URL="https://hypha.aicell.io" \
  -e HYPHA_WORKSPACE="your-workspace" \
  -e HYPHA_TOKEN="your-token" \
  -e HYPHA_CLIENT_ID="your-client-id" \
  ghcr.io/oeway/deno-app-engine:latest
```

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.8'

services:
  deno-app-engine:
    image: ghcr.io/oeway/deno-app-engine:latest
    ports:
      - "8000:8000"
    environment:
      - HYPHA_SERVER_URL=https://hypha.aicell.io
      - HYPHA_WORKSPACE=your-workspace
      - ALLOWED_KERNEL_TYPES=worker-python,worker-typescript
      - KERNEL_POOL_ENABLED=true
      - KERNEL_POOL_SIZE=4
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/kernels"]
      interval: 30s
      timeout: 10s
      retries: 3
```

Run with:
```bash
docker-compose up -d
```

## 🚢 Production Deployment

### Kubernetes

Example Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: deno-app-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: deno-app-engine
  template:
    metadata:
      labels:
        app: deno-app-engine
    spec:
      containers:
      - name: deno-app-engine
        image: ghcr.io/oeway/deno-app-engine:latest
        ports:
        - containerPort: 8000
        env:
        - name: ALLOWED_KERNEL_TYPES
          value: "worker-python,worker-typescript"
        - name: KERNEL_POOL_SIZE
          value: "6"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        readinessProbe:
          httpGet:
            path: /kernels
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /kernels  
            port: 8000
          initialDelaySeconds: 60
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: deno-app-engine-service
spec:
  selector:
    app: deno-app-engine
  ports:
  - port: 80
    targetPort: 8000
  type: LoadBalancer
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `HYPHA_SERVER_URL` | `https://hypha.aicell.io` | Hypha server URL |
| `HYPHA_WORKSPACE` | - | Hypha workspace name |
| `HYPHA_TOKEN` | - | Hypha authentication token |
| `ALLOWED_KERNEL_TYPES` | `worker-python,worker-typescript` | Allowed kernel types |
| `KERNEL_POOL_ENABLED` | `true` | Enable kernel pooling |
| `KERNEL_POOL_SIZE` | `2` | Number of kernels in pool |
| `KERNEL_POOL_AUTO_REFILL` | `true` | Auto-refill pool |
| `KERNEL_POOL_PRELOAD_CONFIGS` | Auto-detected | Kernel types to preload |

## 🔧 Development Deployment

### Local Development

```bash
# Clone and setup
git clone https://github.com/oeway/deno-app-engine.git
cd deno-app-engine

# Run tests
deno test --allow-all

# Start HTTP server
./start-server.sh

# Or start Hypha service
deno run --allow-all scripts/hypha-service.ts
```

### Building Custom Images

```bash
# Build locally
docker build -t my-deno-app-engine .

# Build with specific target
docker build --target production -t my-deno-app-engine:prod .

# Multi-platform build
docker buildx build --platform linux/amd64,linux/arm64 -t my-deno-app-engine .
```

## 📊 Monitoring and Observability

### Health Checks

The container exposes health check endpoints:

- **HTTP Server**: `GET /kernels` - Returns list of kernels
- **Basic Health**: Container stays healthy as long as Deno process is running

### Logs

View container logs:

```bash
# Follow logs
docker logs -f <container-id>

# View specific time range
docker logs --since="2024-01-01T00:00:00" <container-id>
```

### Metrics

The service provides basic metrics through the HTTP API:

```bash
# Get system status
curl http://localhost:8000/status

# Get kernel information
curl http://localhost:8000/kernels
```

## 🔐 Security Considerations

### Production Security

1. **Kernel Types**: Use only `worker-` kernels in production
2. **Network**: Run behind a reverse proxy with TLS
3. **Resources**: Set appropriate memory and CPU limits
4. **Secrets**: Use secure secret management for tokens
5. **Updates**: Regularly update to latest container versions

### Example Secure Configuration

```bash
# Production-secure settings
export ALLOWED_KERNEL_TYPES="worker-python"
export KERNEL_POOL_ENABLED="true"
export KERNEL_POOL_SIZE="4"

# Run with limited privileges
docker run -p 8000:8000 \
  --read-only \
  --tmpfs /tmp \
  --user 1000:1000 \
  -e ALLOWED_KERNEL_TYPES="worker-python" \
  ghcr.io/oeway/deno-app-engine:latest
```

## 🆘 Troubleshooting

### Common Issues

1. **Container won't start**: Check environment variables and port conflicts
2. **Permission errors**: Ensure Docker has necessary permissions
3. **Memory issues**: Increase container memory limits
4. **Network issues**: Check firewall and port accessibility

### Debug Mode

```bash
# Run with debug logging
docker run -p 8000:8000 \
  -e DENO_LOG=debug \
  ghcr.io/oeway/deno-app-engine:latest

# Interactive debugging
docker run -it --entrypoint /bin/sh \
  ghcr.io/oeway/deno-app-engine:latest
``` 