# GitHub Actions Workflows

This directory contains GitHub Actions workflows for the Deno App Engine project.

## Workflows

### 1. CI/CD (`ci.yml`)
- **Triggers**: Push to main/master, Pull Requests
- **Features**:
  - Runs all tests with coverage reporting
  - Builds and publishes Docker containers to GitHub Packages
  - Creates GitHub releases for new versions
  - Automatic version tagging based on `deno.json`

### 2. Test Only (`test.yml`)
- **Triggers**: Push to main/master, Pull Requests  
- **Features**:
  - Runs the full test suite
  - Generates coverage reports
  - Uploads coverage to Codecov

### 3. Docker Publishing (`publish-container.yml`)
- **Triggers**: Push to main/master (when specific files change)
- **Features**:
  - Builds and publishes Docker containers
  - Creates version tags based on `deno.json`
  - Publishes to GitHub Container Registry

## Docker Images

Published Docker images are available at:
- **Latest**: `ghcr.io/[owner]/deno-app-engine:latest`
- **Versioned**: `ghcr.io/[owner]/deno-app-engine:0.1.8`

### Usage

```bash
# Pull the latest image
docker pull ghcr.io/[owner]/deno-app-engine:latest

# Run the container
docker run -p 8000:8000 ghcr.io/[owner]/deno-app-engine:latest

# Run with environment variables
docker run -p 8000:8000 \
  -e HYPHA_SERVER_URL=https://hypha.aicell.io \
  -e HYPHA_WORKSPACE=your-workspace \
  -e HYPHA_CLIENT_ID=your-client-id \
  ghcr.io/[owner]/deno-app-engine:latest
```

## Version Management

Versions are automatically detected from the `version` field in `deno.json`. To create a new release:

1. Update the version in `deno.json`:
   ```json
   {
     "version": "0.2.0"
   }
   ```

2. Commit and push to main/master
3. The workflow will automatically:
   - Build and tag a new Docker image
   - Create a Git tag (`v0.2.0`)
   - Create a GitHub release

## Coverage

Test coverage reports are automatically uploaded to Codecov. You can view coverage reports at:
`https://codecov.io/gh/[owner]/deno-app-engine`

## Environment Variables

The Docker container supports these environment variables:

- `HYPHA_SERVER_URL`: Hypha server URL (default: https://hypha.aicell.io)
- `HYPHA_WORKSPACE`: Hypha workspace name
- `HYPHA_TOKEN`: Authentication token for Hypha
- `ALLOWED_KERNEL_TYPES`: Comma-separated list of allowed kernel types
- `KERNEL_POOL_ENABLED`: Enable/disable kernel pooling (default: true)
- `KERNEL_POOL_SIZE`: Number of kernels in pool (default: 2) 