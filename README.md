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

- **Dual Execution Modes**
  - Main Thread Mode: Direct Pyodide execution
  - Worker Mode: Isolated execution in Web Workers

- **Intelligent Agent System**
  - Advanced agent management with configurable environment variables
  - Automatic kernel attachment and lifecycle management
  - Conversation history and memory management
  - Event-driven architecture with comprehensive monitoring

- **Comprehensive Environment Variables Support**
  - Agent-level environment configuration
  - Kernel environment variable inheritance
  - Cross-language environment support (Python/TypeScript)
  - Secure environment variable handling and validation

- **Vector Database Integration**
  - High-performance vector search and storage
  - Concurrent operations and memory management
  - Automatic offloading and resource optimization
  - Event-driven monitoring and statistics

- **Filesystem Integration**
  - Mount local directories into the Python environment
  - Cross-mode file access and manipulation
  - Secure filesystem permissions management

- **Event System**
  - Jupyter-compatible event bus
  - Stream, display, and execution result events
  - Cross-thread event forwarding

- **Security**
  - Granular permission control for workers
  - Filesystem access restrictions
  - Network access management

- **Execution Management**
  - Automatic tracking of code execution
  - Inactivity timeout for idle kernels
  - Detection of stalled/deadlocked executions

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
    model: "qwen2.5-coder:7b",
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

