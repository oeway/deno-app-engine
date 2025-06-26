# Deno App Engine

[![CI/CD](https://github.com/oeway/deno-app-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/oeway/deno-app-engine/actions/workflows/ci.yml)
[![Docker Image](https://ghcr-badge.egpl.dev/oeway/deno-app-engine/latest_tag?color=%2344cc11&ignore=latest&label=docker&trim=)](https://github.com/oeway/deno-app-engine/pkgs/container/deno-app-engine)
[![Docker Size](https://ghcr-badge.egpl.dev/oeway/deno-app-engine/size?color=%2344cc11&tag=latest&label=docker%20size&trim=)](https://github.com/oeway/deno-app-engine/pkgs/container/deno-app-engine)

A comprehensive Deno-based app engine that provides Jupyter kernel-like functionality with Pyodide integration, intelligent agents, and vector database capabilities. This project enables running Python code in both main thread and worker contexts, with advanced agent management, environment variables support, and secure permission management.

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Pull and run the latest image
docker run -p 8000:8000 ghcr.io/oeway/deno-app-engine:latest

# Or with environment configuration
docker run -p 8000:8000 \
  -e HYPHA_SERVER_URL=https://hypha.aicell.io \
  -e HYPHA_WORKSPACE=your-workspace \
  -e HYPHA_CLIENT_ID=your-client-id \
  ghcr.io/oeway/deno-app-engine:latest
```

### Using Deno

```bash
# Clone and run locally
git clone https://github.com/oeway/deno-app-engine.git
cd deno-app-engine
./start-server.sh
```

## Features

- **Kernel Management**: Multiple kernel execution modes (main thread, worker) supporting Python, TypeScript, and JavaScript
- **Vector Database**: Built-in vector storage and retrieval system with multiple provider support
- **Agent System**: Create, manage, and interact with AI agents
- **Deno App Engine**: Load and execute Deno applications from artifacts with the `--load-apps` flag
- **HTTP API**: RESTful endpoints for kernel, agent, and vector database operations
- **Streaming Support**: Real-time execution output and agent communication
- **Security**: Configurable permissions and secure execution environments

## Quick Start

### Basic Server

```bash
# Start server on default port 8000
./scripts/start-server.sh

# Start server on custom port
./scripts/start-server.sh --port 3000

# Show help
./scripts/start-server.sh --help
```

### Deno App Engine

The server can automatically load and execute Deno applications from the Hypha artifact manager:

```bash
# Load and execute deno-app artifacts on startup
./scripts/start-server.sh --load-apps

# Set Hypha connection environment variables (optional)
export HYPHA_SERVER_URL="https://hypha.aicell.io"
export HYPHA_WORKSPACE="your-workspace"
export HYPHA_TOKEN="your-token"
./scripts/start-server.sh --load-apps
```

When `--load-apps` is enabled, the server will:
1. Connect to the Hypha artifact manager
2. List all artifacts with type `deno-app` from `hypha-agents/agents`
3. For each artifact, create a kernel and execute its `startup_script`
4. Keep the applications running in the background

### Environment Variables

The following environment variables can be used to configure the server:

#### Hypha Integration (for --load-apps)
- `HYPHA_SERVER_URL`: Hypha server URL (default: https://hypha.aicell.io)
- `HYPHA_WORKSPACE`: Hypha workspace (optional)
- `HYPHA_TOKEN`: Hypha auth token (optional, will prompt if not set)
- `HYPHA_CLIENT_ID`: Hypha client ID (optional)

#### Kernel Configuration
- `ALLOWED_KERNEL_TYPES`: Comma-separated list of allowed kernel types (e.g., "worker-python,main_thread-typescript")
- `KERNEL_POOL_ENABLED`: Enable kernel pooling (default: true)
- `KERNEL_POOL_SIZE`: Number of pre-created kernels in pool (default: 2)
- `KERNEL_POOL_AUTO_REFILL`: Auto-refill pool when kernels are used (default: true)
- `KERNEL_POOL_PRELOAD_CONFIGS`: Kernel types to preload in pool

#### Agent Configuration
- `AGENT_MODEL_BASE_URL`: Base URL for agent model API
- `AGENT_MODEL_API_KEY`: API key for agent model
- `AGENT_MODEL_NAME`: Model name to use for agents
- `AGENT_MODEL_TEMPERATURE`: Model temperature setting

#### Vector Database Configuration  
- `VECTORDB_OFFLOAD_DIRECTORY`: Directory for vector DB persistence
- `VECTORDB_DEFAULT_INACTIVITY_TIMEOUT`: Timeout for inactive vector DBs
- `VECTORDB_ACTIVITY_MONITORING`: Enable activity monitoring
- `MAX_VECTOR_DB_INSTANCES`: Maximum number of vector DB instances
- `EMBEDDING_MODEL`: Default embedding model to use

## Creating Deno Applications

You can create Deno applications using the Agent Lab interface:

1. Open Agent Lab in your browser
2. Click on "Edit Agent" in the canvas panel
3. Select "Deno Application" as the type
4. Fill in the application details:
   - **Name**: Your app name
   - **Description**: What your app does
   - **License**: License for your app
   - **Startup Script**: TypeScript/JavaScript code to run when the app starts
5. Publish your app

### Example Deno App Startup Script

```typescript
// Example: Simple HTTP server
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';

const handler = (req: Request): Response => {
  const url = new URL(req.url);
  
  if (url.pathname === '/') {
    return new Response('Hello from Deno App!', {
      headers: { 'content-type': 'text/plain' },
    });
  }
  
  if (url.pathname === '/api/status') {
    return new Response(JSON.stringify({ 
      status: 'running',
      timestamp: new Date().toISOString() 
    }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  
  return new Response('Not Found', { status: 404 });
};

console.log('Starting Deno app server on port 8080...');
serve(handler, { port: 8080 });
```

Published Deno applications with type `deno-app` will be automatically loaded and executed when the server starts with the `--load-apps` flag.

## Hypha Service

The Deno App Engine can also run as a Hypha service, providing kernel management, vector database, and AI agent capabilities through a WebSocket interface.

### Starting the Hypha Service

```bash
# Start the Hypha service
./scripts/start-hypha-service.sh

# Start with deno-app loading enabled
./scripts/start-hypha-service.sh --load-apps
```

### Environment Variables for Hypha Service

Create a `.env` file in the project root with the following variables:

```env
# Required: Hypha server connection
HYPHA_SERVER_URL=https://hypha.aicell.io
HYPHA_WORKSPACE=your-workspace-name
HYPHA_TOKEN=your-workspace-token
HYPHA_CLIENT_ID=deno-app-engine

# Optional: Kernel Manager Configuration
ALLOWED_KERNEL_TYPES=worker-python,worker-typescript,main_thread-python
KERNEL_POOL_ENABLED=true
KERNEL_POOL_SIZE=2

# Optional: Vector Database Configuration
EMBEDDING_MODEL=mock-model
OLLAMA_HOST=http://localhost:11434

# Optional: AI Agent Model Settings
AGENT_MODEL_BASE_URL=http://localhost:11434/v1/
AGENT_MODEL_API_KEY=ollama
AGENT_MODEL_NAME=llama3.2:1b  # Small model for CI, use qwen2.5-coder:7b for production
AGENT_MODEL_TEMPERATURE=0.7
```

### Deno App Loading

When the `--load-apps` flag is used, the Hypha service will:

1. Connect to the Hypha artifact manager
2. Search for artifacts with type `deno-app` in the `hypha-agents/agents` collection
3. Create TypeScript kernels for each found application
4. Execute the `startup_script` from each application's manifest
5. Keep the applications running in dedicated kernel instances

This allows you to publish Deno applications through the Agent Lab interface and have them automatically loaded and executed when the service starts.

## Prerequisites

- Deno 1.x or higher
- Python 3.x (for wheel generation)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/deno-app-engine.git
cd deno-app-engine
```

2. Generate Python wheels (first time only):
```bash
deno run --allow-read --allow-write --allow-run kernel/check-wheels.ts
```

## Running the HTTP Server

The HTTP server provides a REST API for kernel management and code execution.

### Using the Shell Script

The easiest way to start the HTTP server is using the provided shell script:

```bash
# Make the script executable (first time only)
chmod +x start-server.sh

# Start the server
./start-server.sh
```

The script will:
- Check if Deno is installed
- Start the server with necessary permissions on port 8000
- Enable all required permissions: `--allow-net --allow-read --allow-write --allow-env`

### Manual HTTP Server Start

You can also start the HTTP server manually:

```bash
# Start HTTP server on default port 8000
deno run --allow-net --allow-read --allow-write --allow-env server.ts
```

### HTTP Server Environment Variables

The HTTP server can be configured using these environment variables:

```bash
# Allowed kernel types (comma-separated: mode-language pairs)
# Default: "worker-python,worker-typescript"
export ALLOWED_KERNEL_TYPES="worker-python,worker-typescript,main_thread-python"

# Enable kernel pooling for better performance
# Default: true
export KERNEL_POOL_ENABLED="true"

# Number of kernels to keep ready in the pool
# Default: 2
export KERNEL_POOL_SIZE="4"

# Automatically refill the pool when kernels are taken
# Default: true
export KERNEL_POOL_AUTO_REFILL="true"

# Kernel types to preload in the pool (comma-separated)
# Default: Same as ALLOWED_KERNEL_TYPES filtered to Python kernels
export KERNEL_POOL_PRELOAD_CONFIGS="worker-python,main_thread-python"
```

### HTTP Server Example Configuration

```bash
# Production security configuration
export ALLOWED_KERNEL_TYPES="worker-python,worker-typescript"
export KERNEL_POOL_ENABLED="true"
export KERNEL_POOL_SIZE="6"

# Start the HTTP server
./start-server.sh
```

## Running the Hypha Service

The Hypha service provides integration with the Hypha ecosystem for distributed computing and collaboration.

### Manual Hypha Service Start

```bash
# Start Hypha service
deno run --allow-net --allow-read --allow-write --allow-env hypha-service.ts
```

### Hypha Service Environment Variables

The Hypha service uses all the kernel configuration variables from the HTTP server, plus these additional ones:

```bash
# Hypha server URL
# Default: "https://hypha.aicell.io"
export HYPHA_SERVER_URL="https://your-hypha-server.com"

# Hypha workspace name
# Optional - if not set, will use default workspace
export HYPHA_WORKSPACE="my-workspace"

# Hypha authentication token
# Optional - if not set, will attempt interactive login
export HYPHA_TOKEN="your-auth-token"

# Kernel configuration (same as HTTP server)
export ALLOWED_KERNEL_TYPES="worker-python,worker-typescript"
export KERNEL_POOL_ENABLED="true"
export KERNEL_POOL_SIZE="4"
export KERNEL_POOL_AUTO_REFILL="true"
export KERNEL_POOL_PRELOAD_CONFIGS="worker-python"
```

### Hypha Service Example Configuration

```bash
# Set up Hypha connection
export HYPHA_SERVER_URL="https://hypha.aicell.io"
export HYPHA_WORKSPACE="my-team"
export HYPHA_TOKEN="your-auth-token"

# Configure kernels for security
export ALLOWED_KERNEL_TYPES="worker-python"
export KERNEL_POOL_ENABLED="true"
export KERNEL_POOL_SIZE="4"

# Start the Hypha service
deno run --allow-net --allow-read --allow-write --allow-env hypha-service.ts
```

## Kernel Types Reference

The kernel type format is `mode-language` where:

**Modes:**
- `worker`: Runs in a Web Worker (recommended for security)
- `main_thread`: Runs in the main thread (less secure, better debugging)

**Languages:**
- `python`: Python execution with Pyodide
- `typescript`: TypeScript execution (experimental)

**Examples:**
- `worker-python`: Python kernel in Web Worker
- `main_thread-python`: Python kernel in main thread
- `worker-typescript`: TypeScript kernel in Web Worker

## Usage

### Agent Namespace Support

The agent system now supports namespaces to provide workspace isolation and prevent agent conflicts between different users or projects. Namespaces ensure that agents are properly isolated and resources are managed per workspace.

#### Key Features

- **Workspace Isolation**: Agents in different namespaces cannot access each other
- **Per-Namespace Limits**: Maximum number of agents per namespace (default: 10)
- **Automatic Cleanup**: Old agents are automatically removed when namespace limits are reached
- **Access Control**: Ensures agents can only be accessed within their designated namespace
- **Resource Management**: Prevents resource exhaustion across workspaces

#### Creating Agents with Namespaces

```typescript
// Import agent modules
import { AgentManager, KernelType } from "./agents/mod.ts";

// Create agent manager with namespace support
const agentManager = new AgentManager({
  maxAgentsPerNamespace: 10, // Maximum agents per namespace
  defaultModelSettings: {
    model: "llama3.2:1b" // Small model for CI, use "qwen2.5-coder:7b" for production
  }
});

// Create an agent in a specific namespace
const agentId = await agentManager.createAgent({
  id: "data-analyst",
  name: "Data Analysis Agent",
  instructions: "You are a data analysis assistant.",
  namespace: "workspace-123", // Specify namespace
  kernelType: KernelType.PYTHON
});

// The actual agent ID will be prefixed with namespace: "workspace-123:data-analyst"
console.log("Created agent:", agentId); // "workspace-123:data-analyst"
```

#### Listing Agents by Namespace

```typescript
// List all agents in a specific namespace
const workspaceAgents = agentManager.listAgents("workspace-123");
console.log("Agents in workspace-123:", workspaceAgents);

// List all agents (all namespaces)
const allAgents = agentManager.listAgents();
console.log("All agents:", allAgents);

// Each agent object includes namespace information
workspaceAgents.forEach(agent => {
  console.log(`Agent ${agent.id} in namespace ${agent.namespace}`);
});
```

#### Automatic Cleanup and Limits

```typescript
// When namespace limit is reached, oldest agents are automatically removed
for (let i = 0; i < 12; i++) {
  try {
    const agentId = await agentManager.createAgent({
      id: `agent-${i}`,
      name: `Agent ${i}`,
      namespace: "workspace-123",
      instructions: "Test agent"
    });
    console.log(`Created agent ${i}: ${agentId}`);
  } catch (error) {
    console.log(`Failed to create agent ${i}: ${error.message}`);
  }
}

// Manual cleanup of old agents in a namespace
const cleanedUp = await agentManager.cleanupOldAgentsInNamespace("workspace-123", 5);
console.log(`Cleaned up ${cleanedUp} old agents`);
```

#### HTTP API with Namespace Support

The HTTP server now supports namespace parameters via query parameters or headers:

```bash
# Create agent in namespace via query parameter
curl -X POST "http://localhost:8000/api/agents?namespace=workspace-123" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "my-agent",
    "name": "My Agent",
    "instructions": "You are a helpful assistant."
  }'

# Or use X-Namespace header
curl -X POST "http://localhost:8000/api/agents" \
  -H "Content-Type: application/json" \
  -H "X-Namespace: workspace-123" \
  -d '{
    "id": "my-agent",
    "name": "My Agent",
    "instructions": "You are a helpful assistant."
  }'

# List agents in namespace
curl "http://localhost:8000/api/agents?namespace=workspace-123"

# Access specific agent (namespace validation)
curl "http://localhost:8000/api/agents/workspace-123:my-agent?namespace=workspace-123"
```

#### Hypha Service Integration

The Hypha service automatically uses the workspace context (`context.ws`) as the namespace:

```typescript
// In Hypha service, namespace is automatically set to context.ws
// No manual namespace specification needed

// Create agent - namespace is set automatically
const agent = await hyphaService.createAgent({
  id: "analysis-agent",
  name: "Analysis Agent",
  type: "assistant",
  model: "llama3.2:1b" // Small model for CI, use "qwen2.5-coder:7b" for production
});
// Agent ID will be: "{context.ws}:analysis-agent"

// List agents - automatically filtered by workspace
const agents = await hyphaService.listAgents();
// Only returns agents in current workspace
```

#### Migration from Non-Namespaced Agents

Existing agents without namespaces continue to work but receive deprecation warnings. To migrate:

```typescript
// Old way (still works but deprecated)
const oldAgent = await agentManager.createAgent({
  id: "legacy-agent",
  name: "Legacy Agent"
  // No namespace specified
});

// New way (recommended)
const newAgent = await agentManager.createAgent({
  id: "modern-agent", 
  name: "Modern Agent",
  namespace: "my-workspace" // Explicit namespace
});
```

### Agent Management with Environment Variables

```typescript
// Import agent modules
import { AgentManager, KernelType } from "./agents/mod.ts";
import { KernelManager } from "./kernel/mod.ts";

// Create agent manager with model configuration
const agentManager = new AgentManager({
  defaultModelSettings: {
    baseURL: "http://localhost:11434/v1/",
    apiKey: "ollama",
    model: "llama3.2:1b", // Small model for CI, use "qwen2.5-coder:7b" for production
    temperature: 0.3
  },
  agentDataDirectory: "./agent_data"
});

// Set up kernel manager for agent execution
const kernelManager = new KernelManager();
agentManager.setKernelManager(kernelManager);

// Create an agent with environment variables
const agentId = await agentManager.createAgent({
  id: "data-analysis-agent",
  name: "Data Analysis Assistant",
  instructions: "You are a Python data analysis assistant with configured environment variables.",
  kernelType: KernelType.PYTHON,
  kernelEnvirons: {
    "API_KEY": "your-secret-api-key",
    "DATABASE_URL": "postgresql://localhost:5432/analytics",
    "DEBUG_MODE": "true",
    "MAX_WORKERS": "4"
  },
  autoAttachKernel: true
});

// Create an agent with startup script and environment
const tsAgentId = await agentManager.createAgent({
  id: "web-dev-agent", 
  name: "Web Development Assistant",
  instructions: "You are a TypeScript web development assistant.",
  kernelType: KernelType.TYPESCRIPT,
  kernelEnvirons: {
    "NODE_ENV": "development",
    "API_ENDPOINT": "https://api.example.com",
    "VERSION": "1.0.0"
  },
  startupScript: `
// Initialize development environment
const config = {
  apiUrl: (globalThis as any).ENVIRONS?.API_ENDPOINT,
  environment: (globalThis as any).ENVIRONS?.NODE_ENV,
  version: (globalThis as any).ENVIRONS?.VERSION
};
console.log("Development environment initialized:", config);
`,
  autoAttachKernel: true
});

// Update agent environment variables
agentManager.updateAgent(agentId, {
  kernelEnvirons: {
    "API_KEY": "updated-secret-key",
    "NEW_CONFIG": "additional-setting"
  }
});

// Get agent information
const agent = agentManager.getAgent(agentId);
console.log("Agent environment variables:", agent?.kernelEnvirons);
```

### Basic Kernel Usage

```typescript
// Import from the main module
import { createKernel, createKernelManager, KernelMode, KernelEvents } from "./mod.ts";

// Method 1: Direct kernel usage (simpler)
const kernel = await createKernel({
  filesystem: {
    enabled: true,
    root: ".",
    mountPoint: "/home/pyodide"
  }
});

// Execute Python code directly
const result = await kernel.execute('print("Hello from Python!")');

// Method 2: Using KernelManager (recommended for multiple kernels)
const manager = createKernelManager();

// Create a kernel
const kernelId = await manager.createKernel({
  mode: KernelMode.MAIN_THREAD,
  filesystem: {
    enabled: true,
    root: ".",
    mountPoint: "/home/pyodide"
  }
});

// Get the kernel instance
const kernelInstance = manager.getKernel(kernelId);

// Execute Python code with the manager (tracks execution automatically)
const managerResult = await manager.execute(kernelId, 'print("Hello from managed kernel!")');

// Or execute directly on the kernel instance
const directResult = await kernelInstance.kernel.execute('print("Hello again!")');

// Destroy the kernel when done
await manager.destroyKernel(kernelId);
```

### Streaming Execution Results

```typescript
// Execute with streaming output
const generator = manager.executeStream(kernelId, `
for i in range(5):
    print(f"Count: {i}")
import numpy as np
np.random.seed(42)
data = np.random.rand(3, 3)
print(data)
`);

// Process stream events
for await (const event of generator) {
  if (event.type === 'stream') {
    console.log("Stream output:", event.data.text);
  } else if (event.type === 'display_data') {
    console.log("Display data:", event.data);
  }
}
```

### Event Handling

```typescript
// Listen for specific kernel events
manager.onKernelEvent(kernelId, KernelEvents.STREAM, (data) => {
  console.log("Stream output:", data.text);
});

manager.onKernelEvent(kernelId, KernelEvents.DISPLAY_DATA, (data) => {
  console.log("Rich output:", data);
});

manager.onKernelEvent(kernelId, KernelEvents.EXECUTE_RESULT, (data) => {
  console.log("Execution result:", data);
});

manager.onKernelEvent(kernelId, KernelEvents.EXECUTE_ERROR, (data) => {
  console.error("Error:", data.ename, data.evalue);
  console.error("Traceback:", data.traceback);
});
```

### Kernel Management Functions

The kernel manager provides several functions for controlling kernel lifecycle and execution:

#### Ping Kernel

Reset the inactivity timer to prevent automatic shutdown of idle kernels:

```typescript
// Ping a kernel to reset its activity timer
const success = manager.pingKernel(kernelId);

if (success) {
  console.log("Kernel activity timer reset");
} else {
  console.log("Kernel not found");
}

// Use case: Keep a kernel alive during periods of expected inactivity
setInterval(() => {
  if (shouldKeepKernelAlive) {
    manager.pingKernel(kernelId);
  }
}, 60000); // Ping every minute
```

#### Restart Kernel

Restart a kernel while preserving its ID and configuration. This destroys the existing kernel and creates a new one with the same settings:

```typescript
// Restart a kernel to clear its state
const success = await manager.restartKernel(kernelId);

if (success) {
  console.log("Kernel restarted successfully");
  
  // The kernel now has a fresh Python environment
  // All variables and imports are cleared
  const result = await manager.execute(kernelId, 'print("Fresh start!")');
} else {
  console.log("Failed to restart kernel or kernel not found");
}

// Use case: Clear corrupted state or memory leaks
const kernelId = await manager.createKernel({
  mode: KernelMode.MAIN_THREAD,
  inactivityTimeout: 30 * 60 * 1000 // 30 minutes
});

// After heavy computation that might have corrupted state
await manager.execute(kernelId, 'import numpy as np; large_array = np.ones((10000, 10000))');

// Restart to free memory and reset state
await manager.restartKernel(kernelId);

// Kernel configuration (mode, timeouts, filesystem mounts) is preserved
const kernel = manager.getKernel(kernelId);
console.log("Mode preserved:", kernel?.mode); // Still MAIN_THREAD
```

#### Interrupt Kernel

Interrupt any currently running execution in a kernel. This is useful for stopping long-running or stuck operations:

```typescript
// Interrupt a running execution
const success = await manager.interruptKernel(kernelId);

if (success) {
  console.log("Kernel execution interrupted");
} else {
  console.log("Failed to interrupt kernel or kernel not found");
}

// Use case: Stop a long-running computation
const kernelId = await manager.createKernel({ mode: KernelMode.WORKER });

// Start a long-running computation
const executionPromise = manager.execute(kernelId, `
import time
for i in range(1000000):
    # Simulate heavy computation
    time.sleep(0.001)
    if i % 10000 == 0:
        print(f"Progress: {i}")
`);

// After some time, interrupt the execution
setTimeout(async () => {
  const interrupted = await manager.interruptKernel(kernelId);
  console.log("Interrupt successful:", interrupted);
}, 5000); // Interrupt after 5 seconds

// The execution will be interrupted and throw a KeyboardInterrupt error
try {
  await executionPromise;
} catch (error) {
  console.log("Execution was interrupted:", error);
}
```

#### Interrupt Behavior by Kernel Mode

The interrupt mechanism works differently depending on the kernel mode:

- **Main Thread Kernels**: Limited interrupt support. Uses the kernel's built-in interrupt method if available, otherwise emits a synthetic KeyboardInterrupt event.

- **Worker Kernels**: More robust interrupt support using SharedArrayBuffer when available, with fallback to message-based interruption.

```typescript
// For worker kernels with better interrupt support
const workerKernelId = await manager.createKernel({
  mode: KernelMode.WORKER
});

// For main thread kernels with limited interrupt support  
const mainThreadKernelId = await manager.createKernel({
  mode: KernelMode.MAIN_THREAD
});

// Both can be interrupted, but worker kernels are more reliable
await manager.interruptKernel(workerKernelId);    // More reliable
await manager.interruptKernel(mainThreadKernelId); // Limited support
```

### Environment Variables

Kernels support setting environment variables that are accessible within the execution environment:

```typescript
// Create a kernel with environment variables
const kernelId = await manager.createKernel({
  mode: KernelMode.WORKER,
  env: {
    "API_KEY": "your-secret-key",
    "DEBUG_MODE": "true",
    "DATABASE_URL": "postgresql://localhost:5432/mydb",
    "CONFIG_JSON": JSON.stringify({
      "timeout": 5000,
      "retries": 3
    })
  }
});

// For Python kernels, environment variables are available via os.environ
const pythonResult = await manager.execute(kernelId, `
import os
import json

# Access environment variables
api_key = os.environ.get('API_KEY')
debug_mode = os.environ.get('DEBUG_MODE') == 'true'
database_url = os.environ.get('DATABASE_URL')

# Parse JSON configuration
config_json = os.environ.get('CONFIG_JSON')
if config_json:
    config = json.loads(config_json)
    print(f"Timeout: {config['timeout']}")
    print(f"Retries: {config['retries']}")

print(f"API Key: {api_key}")
print(f"Debug Mode: {debug_mode}")
print(f"Database URL: {database_url}")

# Environment variables are properly filtered (null/undefined values are skipped)
print("All environment variables:")
for key, value in os.environ.items():
    if key.startswith(('API_', 'DEBUG_', 'DATABASE_', 'CONFIG_')):
        print(f"  {key}: {value}")
`);

// For TypeScript/JavaScript kernels, environment variables are available via globalThis.ENVIRONS
const tsKernelId = await manager.createKernel({
  mode: KernelMode.WORKER,
  lang: KernelLanguage.TYPESCRIPT,
  env: {
    "NODE_ENV": "development",
    "API_ENDPOINT": "https://api.example.com",
    "VERSION": "1.0.0",
    "FEATURES": JSON.stringify(["auth", "analytics", "logging"])
  }
});

const tsResult = await manager.execute(tsKernelId, `
// Access environment variables
const env = (globalThis as any).ENVIRONS;
const nodeEnv = env?.NODE_ENV || 'production';
const apiEndpoint = env?.API_ENDPOINT;
const version = env?.VERSION;

// Parse JSON features
const features = env?.FEATURES ? JSON.parse(env.FEATURES) : [];

console.log('Environment:', nodeEnv);
console.log('API Endpoint:', apiEndpoint);
console.log('Version:', version);
console.log('Features:', features);

// Type-safe environment access
interface AppEnvironment {
  NODE_ENV: string;
  API_ENDPOINT: string;
  VERSION: string;
  FEATURES: string;
}

const typedEnv = env as AppEnvironment;
console.log('Typed environment access:', typedEnv.NODE_ENV);
`);
```

### Worker with Restricted Permissions

```typescript
const kernelId = await manager.createKernel({
  mode: KernelMode.WORKER,
  deno: {
    permissions: {
      read: ["/allowed/path"],
      write: ["/writable/path"],
      net: ["api.example.com:443"]
    }
  }
});
```

## API Reference

### Main Module Exports

- `createKernel(options?)`: Creates a standalone kernel instance
- `createKernelManager()`: Creates a kernel manager for handling multiple kernels
- `KernelMode`: Enum for kernel execution modes (MAIN_THREAD, WORKER)
- `KernelEvents`: Enum for kernel event types
- `ensureWheelsExist()`: Utility to check and generate Python wheels

### Agent Management

The agent system provides intelligent task automation with environment variable support:

#### AgentManager

- `createAgent(config)`: Creates a new agent instance
  - `config.id`: Unique agent identifier
  - `config.name`: Human-readable agent name
  - `config.instructions`: Agent behavior instructions
  - `config.kernelType`: Kernel type (PYTHON, TYPESCRIPT, JAVASCRIPT)
  - `config.kernelEnvirons`: Environment variables as key-value pairs
  - `config.startupScript`: Code to execute when kernel is attached
  - `config.autoAttachKernel`: Whether to automatically attach a kernel
  - `config.enablePlanning`: Enable agent planning capabilities
  - `config.maxSteps`: Maximum steps for agent execution
- `updateAgent(id, updates)`: Updates agent configuration including environment variables
- `getAgent(id)`: Gets agent instance by ID
- `listAgents()`: Lists all agents with their configurations
- `destroyAgent(id)`: Destroys an agent and its associated resources
- `attachKernelToAgent(agentId, kernelType)`: Attaches a kernel to an agent
- `detachKernelFromAgent(agentId)`: Detaches kernel from an agent

#### Environment Variables in Agents

Agents support comprehensive environment variable configuration:

```typescript
// Environment variables are passed to attached kernels
const agent = await agentManager.createAgent({
  kernelEnvirons: {
    "API_CREDENTIALS": "secret-key",
    "SERVICE_CONFIG": JSON.stringify(config),
    "ENVIRONMENT": "production"
  }
});

// Environment variables are automatically available in kernel execution context
// Python kernels: os.environ['API_CREDENTIALS']
// TypeScript kernels: globalThis.ENVIRONS.API_CREDENTIALS
```

### KernelManager

The main class for managing kernel instances.

- `createKernel(options?)`: Creates a new kernel instance
  - `options.mode`: Execution mode (MAIN_THREAD or WORKER)
  - `options.lang`: Kernel language (PYTHON, TYPESCRIPT, JAVASCRIPT)
  - `options.env`: Environment variables as key-value pairs
  - `options.filesystem`: Filesystem mounting options
  - `options.deno.permissions`: Deno permissions for worker mode
  - `options.inactivityTimeout`: Auto-shutdown timeout in milliseconds
  - `options.maxExecutionTime`: Maximum execution time before considering stuck
- `destroyKernel(id)`: Destroys a kernel instance
- `destroyAll(namespace?)`: Destroys all kernels or those in a namespace
- `getKernel(id)`: Gets a kernel instance by ID
- `getKernelIds()`: Gets all kernel IDs
- `listKernels(namespace?)`: Lists all kernels with details
- `execute(id, code, parent?)`: Executes code with tracking
- `executeStream(id, code, parent?)`: Executes code with streaming results
- `onKernelEvent(id, event, listener)`: Registers an event listener
- `offKernelEvent(id, event, listener)`: Removes an event listener
- `pingKernel(id)`: Resets kernel activity timer to prevent inactivity shutdown
- `restartKernel(id)`: Restarts a kernel while preserving its ID and configuration
- `interruptKernel(id)`: Interrupts any running execution in the kernel

### Inactivity and Execution Management

- `setInactivityTimeout(id, timeout)`: Sets inactivity timeout for a kernel
- `getInactivityTimeout(id)`: Gets current inactivity timeout
- `getTimeUntilShutdown(id)`: Gets time until auto-shutdown
- `getExecutionInfo(id)`: Gets information about ongoing executions
- `getOngoingExecutionCount(id)`: Gets count of ongoing executions
- `forceTerminateKernel(id, reason?)`: Force terminates a stuck kernel

### Kernel Events

- `STREAM`: Output stream events (stdout/stderr)
- `DISPLAY_DATA`: Rich display data
- `UPDATE_DISPLAY_DATA`: Updates to display data
- `EXECUTE_RESULT`: Execution results
- `EXECUTE_ERROR`: Error events
- `EXECUTION_STALLED`: Stalled execution events

## Development

### Running Tests

To run all tests (including enhanced agent, kernel, and vectordb tests):

```bash
# Run complete test suite with enhanced coverage
deno test -A --unstable-worker-options

# Run enhanced agent tests (18+ test scenarios)
deno test -A --no-check tests/agents_enhanced_test.ts

# Run enhanced kernel tests with environment variables
deno test -A --no-check tests/kernel_enhanced_test.ts

# Run enhanced vectordb tests with concurrent operations
deno test -A --no-check tests/vectordb_enhanced_test.ts

# Run all enhanced tests together
deno test -A --no-check tests/agents_enhanced_test.ts tests/kernel_enhanced_test.ts tests/vectordb_enhanced_test.ts
```

### Enhanced Test Coverage

The project includes comprehensive test coverage for:

- **Agent Environment Variables**: Testing environment variable configuration, inheritance, and validation across agent lifecycle
- **Kernel Environment Variables**: Testing environment variable handling in both Python and TypeScript kernels
- **Cross-System Integration**: Testing environment variable flow from agents through kernels to execution contexts
- **Edge Cases**: Testing null/undefined handling, invalid configurations, and error scenarios
- **Resource Management**: Testing proper cleanup and memory management
- **Concurrent Operations**: Testing multi-agent and multi-kernel scenarios

The enhanced test suite includes 18+ test scenarios covering:
- Environment variables configuration and inheritance
- Startup script execution with environment context
- Agent lifecycle management and resource cleanup
- Error handling and edge cases
- Performance and memory management
- Event system integration

To run a specific test file:

```bash
deno test --allow-net --allow-read tests/manager_test.ts
```

- `-A` grants all permissions (required for filesystem/network tests).
- `--unstable-worker-options` is needed for custom worker permissions.

### Common Commands

- **Run all tests:**  
  `deno test -A --unstable-worker-options`
- **Run enhanced tests:**  
  `deno test -A --no-check tests/*_enhanced_test.ts`
- **Format code:**  
  `deno fmt`
- **Check for lint errors:**  
  `deno lint`

### Project Structure

```
.
├── agents/
│   ├── manager.ts       # Agent management with environment variables
│   ├── agent.ts         # Individual agent implementation
│   └── mod.ts           # Agent module exports
├── kernel/
│   ├── index.ts         # Core interfaces and types
│   ├── manager.ts       # Kernel manager implementation
│   ├── worker.ts        # Worker implementation
│   ├── check-wheels.ts  # Wheel checking functionality
│   └── pypi/            # Python wheel files
├── vectordb/
│   ├── manager.ts       # Vector database management
│   ├── worker.ts        # Vector database worker implementation
│   └── mod.ts           # VectorDB module exports
├── tests/
│   ├── *_enhanced_test.ts # Enhanced test suites
│   └── manager_test.ts    # Original test suite
├── mod.ts               # Main entry point and public API
└── README.md
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Pyodide](https://pyodide.org/) - Python scientific stack in WebAssembly
- [Deno](https://deno.land/) - A modern runtime for JavaScript and TypeScript
- [JupyterLite](https://github.com/jupyterlite/jupyterlite) - Jupyter running in the browser

## Kernel Inactivity and Execution Monitoring

The kernel manager supports automatic shutdown of inactive kernels and monitoring of long-running executions:

### Inactivity Timeout

Kernels can be configured to automatically shut down after a period of inactivity:

```typescript
// Create a kernel with an inactivity timeout of 5 minutes
const kernelId = await manager.createKernel({
  inactivityTimeout: 5 * 60 * 1000 // 5 minutes in milliseconds
});

// Disable inactivity timeout
manager.setInactivityTimeout(kernelId, 0);

// Change inactivity timeout to 10 minutes
manager.setInactivityTimeout(kernelId, 10 * 60 * 1000);

// Get current inactivity timeout
const timeout = manager.getInactivityTimeout(kernelId);

// Get time until auto-shutdown
const timeRemaining = manager.getTimeUntilShutdown(kernelId);
```

The inactivity detection is intelligent:
- Kernels with ongoing executions are not considered inactive
- Only kernels with no running tasks will be shut down after the timeout

### Stalled Execution Detection

Detect potentially stuck or deadlocked kernels by setting a maximum execution time:

```typescript
// Create a kernel with a maximum execution time of 30 seconds
const kernelId = await manager.createKernel({
  maxExecutionTime: 30 * 1000 // 30 seconds in milliseconds
});

// Listen for stalled execution events
manager.onKernelEvent(kernelId, KernelEvents.EXECUTION_STALLED, (event) => {
  console.log(`Execution ${event.executionId} has been running for over ${event.maxExecutionTime}ms`);
  
  // Optionally terminate the kernel
  manager.forceTerminateKernel(kernelId, "Execution took too long");
});

// Get information about ongoing executions
const execInfo = manager.getExecutionInfo(kernelId);
console.log(`Kernel has ${execInfo.count} ongoing executions`);
console.log(`Is kernel stuck? ${execInfo.isStuck}`);
console.log(`Longest running time: ${execInfo.longestRunningTime}ms`);
```

### Execution Tracking

The kernel manager automatically tracks code execution to:
1. Prevent auto-shutdown of busy kernels
2. Detect stalled executions
3. Provide visibility into kernel activity

When using the kernel manager to execute code (instead of calling kernel.execute directly), all execution tracking happens automatically.

## Development

### Running the service

```bash
deno run --allow-net --allow-read --allow-write --allow-env hypha-service.ts
```

### Build docker image

```bash
docker build --platform linux/amd64 -t oeway/deno-app-engine:0.1.0 . && docker push oeway/deno-app-engine:0.1.0
```

#### Startup Script Error Handling

The agent system includes robust error handling for startup scripts to ensure reliable operation:

**Error Capture & Prevention**
- If a startup script fails during execution, the error is captured with full stack trace
- Agents with failed startup scripts cannot proceed with normal chat operations
- Any attempt to chat with a failed agent immediately returns the startup error
- This prevents inconsistent agent states and ensures fast failure detection

**Error Information**
- `hasStartupError`: Boolean flag indicating if startup script failed
- `startupError`: Detailed error object containing:
  - `message`: Brief error description
  - `fullError`: Complete error details including script content
  - `stackTrace`: Full Python stack trace for debugging

**Example Error Response**
```json
{
  "hasStartupError": true,
  "startupError": {
    "message": "Startup script failed: NameError: name 'undefined_function' is not defined",
    "fullError": "Startup script execution failed for agent: my-agent\n\nError: NameError: name 'undefined_function' is not defined\n\nError Output:\nNameError: name 'undefined_function' is not defined\n...",
    "stackTrace": "Traceback (most recent call last):\n  File \"<stdin>\", line 2, in <module>\nNameError: name 'undefined_function' is not defined"
  }
}
```

**Best Practices**
- Test startup scripts thoroughly before deploying agents
- Use try-catch blocks in startup scripts for graceful error handling
- Keep startup scripts simple and focused on essential initialization
- Monitor agent creation logs for startup script failures

#### Stateless Chat Completion

For functional programming approaches or cases where you need to perform chat without leaving any server-side traces, the agent system supports stateless chat completion:

**Key Features**
- No modification of conversation history or memory
- Acts like a pure function: input messages → response
- Useful for one-off queries, testing, or privacy-sensitive operations
- Still benefits from agent's system prompt, kernel capabilities, and error handling

**Usage Example**
```typescript
// Regular chat (modifies history)
const messages = [{ role: "user", content: "Hello!" }];
for await (const chunk of agent.chatCompletion(messages)) {
  // Agent history is updated
}

// Stateless chat (no history modification)
const testMessages = [
  { role: "user", content: "What is 2 + 2?" },
  { role: "assistant", content: "2 + 2 = 4" },
  { role: "user", content: "What is 3 + 3?" }
];

for await (const chunk of agent.statelessChatCompletion(testMessages)) {
  // Agent history remains unchanged
  // Memory is not modified
}
```

**HTTP API Endpoint**
```bash
# Stateless chat (no history modification)
curl -X POST http://localhost:8000/api/agents/{agentId}/chat-stateless \\
  -H "Content-Type: application/json" \\
  -H "X-Namespace: your-workspace" \\
  -d '{
    "messages": [
      {"role": "user", "content": "What is 2 + 2?"},
      {"role": "assistant", "content": "2 + 2 = 4"},
      {"role": "user", "content": "What is 3 + 3?"}
    ]
  }'
```

**Hypha Service Method**
```javascript
// Stateless chat via Hypha service
await service.chatWithAgentStateless({
  agentId: "my-agent",
  messages: [
    { role: "user", content: "Hello!" },
    { role: "assistant", content: "Hi there!" },
    { role: "user", content: "How are you?" }
  ]
});
```

**When to Use Stateless Chat**
- Testing and development scenarios
- One-off queries that shouldn't affect conversation flow
- Privacy-sensitive operations
- Functional programming patterns
- Batch processing where conversation state should be preserved

#### Conversation History Management

The agent system provides flexible conversation history management capabilities:

**Setting Conversation History**
- Set custom conversation history to initialize agents with prior context
- Useful for continuing previous conversations or setting up specific scenarios
- History can be set via agent manager, Hypha service, or HTTP API

**Usage Examples**
```typescript
// Set conversation history via agent manager
const history = [
  { role: "user", content: "Hello, how are you?" },
  { role: "assistant", content: "I'm doing great! How can I help you today?" }
];

await agentManager.setConversationHistory(agentId, history);

// Set conversation history directly on agent instance
const agent = agentManager.getAgent(agentId);
agent.setConversationHistory(history);
```

**HTTP API Endpoints**
- `POST /api/agents/{agentId}/set-conversation`: Set conversation history
- `POST /api/agents/{agentId}/clear-conversation`: Clear conversation history
- `GET /api/agents/{agentId}/conversation`: Get current conversation history

**Hypha Service Methods**
- `setAgentConversationHistory({agentId, messages})`: Set conversation history
- `clearAgentConversation({agentId})`: Clear conversation
- `getAgentConversation({agentId})`: Get conversation history

#### Stateless Chat Completion

