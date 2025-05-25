# Deno App Engine Configuration

This document describes the environment variables used to configure the Deno App Engine's kernel manager.

## Kernel Security Configuration

### ALLOWED_KERNEL_TYPES
Comma-separated list of allowed kernel types that can be created.

**Format:** `mode-language` (e.g., `worker-python`, `main_thread-typescript`)

**Default:** `worker-python,worker-typescript` (secure by default)

**Examples:**
```bash
# Default secure configuration (worker kernels only)
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript

# Development environment (allow main thread kernels)
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript,main_thread-python,main_thread-typescript

# Maximum security (Python only)
ALLOWED_KERNEL_TYPES=worker-python

# TypeScript only
ALLOWED_KERNEL_TYPES=worker-typescript,main_thread-typescript
```

## Kernel Pool Configuration

The kernel pool preloads kernels to reduce startup time from several seconds to <1 second.

### KERNEL_POOL_ENABLED
Enable or disable kernel pooling.

**Default:** `true`

**Examples:**
```bash
KERNEL_POOL_ENABLED=true   # Enable pooling
KERNEL_POOL_ENABLED=false  # Disable pooling
```

### KERNEL_POOL_SIZE
Number of kernels to keep ready per configuration.

**Default:** `2`

**Examples:**
```bash
KERNEL_POOL_SIZE=2   # Keep 2 kernels ready per type
KERNEL_POOL_SIZE=5   # Keep 5 kernels ready per type (production)
KERNEL_POOL_SIZE=1   # Minimal pooling
```

### KERNEL_POOL_AUTO_REFILL
Automatically refill the pool when kernels are taken.

**Default:** `true`

**Examples:**
```bash
KERNEL_POOL_AUTO_REFILL=true   # Auto-refill (recommended)
KERNEL_POOL_AUTO_REFILL=false  # Manual refill only
```

### KERNEL_POOL_PRELOAD_CONFIGS
Kernel types to preload in the pool.

**Format:** `mode-language` (e.g., `worker-python`, `main_thread-python`)

**Default:** Python kernels from allowed types

**Examples:**
```bash
# Preload Python workers only
KERNEL_POOL_PRELOAD_CONFIGS=worker-python

# Preload both Python and TypeScript workers
KERNEL_POOL_PRELOAD_CONFIGS=worker-python,worker-typescript

# Preload main thread Python for faster development
KERNEL_POOL_PRELOAD_CONFIGS=worker-python,main_thread-python
```

## Hypha Service Configuration

When using `hypha-service.ts`, these additional variables are available:

### HYPHA_SERVER_URL
Hypha server URL.

**Default:** `https://hypha.aicell.io`

### HYPHA_WORKSPACE
Hypha workspace name.

### HYPHA_TOKEN
Hypha authentication token.

## Example Configurations

### Development Environment
```bash
# Permissive settings for development
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript,main_thread-python
KERNEL_POOL_ENABLED=true
KERNEL_POOL_SIZE=3
KERNEL_POOL_AUTO_REFILL=true
KERNEL_POOL_PRELOAD_CONFIGS=worker-python,main_thread-python
```

### Production Environment
```bash
# Secure settings for production
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript
KERNEL_POOL_ENABLED=true
KERNEL_POOL_SIZE=5
KERNEL_POOL_AUTO_REFILL=true
KERNEL_POOL_PRELOAD_CONFIGS=worker-python
```

### High Security Environment
```bash
# Maximum security (Python only, no pooling)
ALLOWED_KERNEL_TYPES=worker-python
KERNEL_POOL_ENABLED=false
```

### Performance Optimized
```bash
# Fast startup with larger pool
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript
KERNEL_POOL_ENABLED=true
KERNEL_POOL_SIZE=10
KERNEL_POOL_AUTO_REFILL=true
KERNEL_POOL_PRELOAD_CONFIGS=worker-python,worker-typescript
```

## Security Considerations

1. **Worker Mode Default**: By default, only worker kernels are allowed for better isolation
2. **Main Thread Kernels**: Only enable main thread kernels when necessary for development
3. **Language Restrictions**: Restrict to specific languages based on your security requirements
4. **Pool Filtering**: Pool configurations are automatically filtered by allowed types

## Performance Considerations

1. **Pool Size**: Larger pools provide faster kernel creation but use more memory
2. **Preload Configs**: Only preload kernel types you frequently use
3. **Auto Refill**: Keep enabled for consistent performance
4. **Memory Usage**: Each pooled kernel uses ~50-100MB of memory

## Usage

Set these environment variables before starting the server:

```bash
# Using server.ts
KERNEL_POOL_ENABLED=true KERNEL_POOL_SIZE=3 deno run --allow-all server.ts

# Using hypha-service.ts
ALLOWED_KERNEL_TYPES=worker-python KERNEL_POOL_ENABLED=true deno run --allow-all hypha-service.ts
```

Or create a `.env` file and use a tool like `dotenv` to load the variables. 