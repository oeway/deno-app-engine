# Deno Code Interpreter

A Deno-based app engine that provides Jupyter kernel-like functionality with Pyodide integration. This project enables running Python code in both main thread and worker contexts, with filesystem mounting capabilities and secure permission management.

## Features

- **Dual Execution Modes**
  - Main Thread Mode: Direct Pyodide execution
  - Worker Mode: Isolated execution in Web Workers

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

## Usage

### Basic Example

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

### KernelManager

The main class for managing kernel instances.

- `createKernel(options?)`: Creates a new kernel instance
- `destroyKernel(id)`: Destroys a kernel instance
- `destroyAll(namespace?)`: Destroys all kernels or those in a namespace
- `getKernel(id)`: Gets a kernel instance by ID
- `getKernelIds()`: Gets all kernel IDs
- `listKernels(namespace?)`: Lists all kernels with details
- `execute(id, code, parent?)`: Executes code with tracking
- `executeStream(id, code, parent?)`: Executes code with streaming results
- `onKernelEvent(id, event, listener)`: Registers an event listener
- `offKernelEvent(id, event, listener)`: Removes an event listener

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

To run all tests (including worker and server tests):

```bash
deno test -A --unstable-worker-options
```

To run a specific test file:

```bash
deno test --allow-net --allow-read tests/manager_test.ts
```

- `-A` grants all permissions (required for filesystem/network tests).
- `--unstable-worker-options` is needed for custom worker permissions.

### Common Commands

- **Run all tests:**  
  `deno test -A --unstable-worker-options`
- **Format code:**  
  `deno fmt`
- **Check for lint errors:**  
  `deno lint`

### Project Structure

```
.
├── kernel/
│   ├── index.ts         # Core interfaces and types
│   ├── manager.ts       # Kernel manager implementation
│   ├── worker.ts        # Worker implementation
│   ├── check-wheels.ts  # Wheel checking functionality
│   └── pypi/            # Python wheel files
├── mod.ts               # Main entry point and public API
├── tests/
│   └── manager_test.ts  # Test suite
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

