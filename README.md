# Deno Code Interpreter

A Deno-based code interpreter that provides Jupyter kernel-like functionality with Pyodide integration. This project enables running Python code in both main thread and worker contexts, with filesystem mounting capabilities and secure permission management.

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

## Prerequisites

- Deno 1.x or higher
- Python 3.x (for wheel generation)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/deno-code-interpreter.git
cd deno-code-interpreter
```

2. Generate Python wheels (first time only):
```bash
cd kernel
python3 generate-wheels-js.py
```

## Usage

### Starting the Server

1. Make the start script executable:
```bash
chmod +x start-server.sh
```

2. Start the server:
```bash
./start-server.sh
```

The server will start with all necessary permissions. Once running, you can access the web interface at `http://localhost:8000`.

### Basic Example

```typescript
import { KernelManager, KernelMode } from "./kernel/mod.ts";

// Create a kernel manager
const manager = new KernelManager();

// Create a kernel
const kernelId = await manager.createKernel({
  mode: KernelMode.MAIN_THREAD
});

// Get the kernel instance
const kernel = manager.getKernel(kernelId);

// Execute Python code
const result = await kernel.execute('print("Hello from Python!")');
```

### Filesystem Mounting

```typescript
const kernelId = await manager.createKernel({
  mode: KernelMode.WORKER,
  filesystem: {
    enabled: true,
    root: "/path/to/local/directory",
    mountPoint: "/home/pyodide"
  }
});
```

### Event Handling

```typescript
import { KernelEvents } from "./kernel/mod.ts";

manager.onKernelEvent(kernelId, KernelEvents.STREAM, (data) => {
  console.log("Stream output:", data.text);
});
```

### Restricted Permissions

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

### KernelManager

The main class for managing kernel instances.

- `createKernel(options?)`: Creates a new kernel instance
- `destroyKernel(id)`: Destroys a kernel instance
- `getKernel(id)`: Gets a kernel instance by ID
- `onKernelEvent(id, event, listener)`: Registers an event listener

### Kernel Events

- `STREAM`: Output stream events (stdout/stderr)
- `DISPLAY_DATA`: Rich display data
- `EXECUTE_RESULT`: Execution results
- `EXECUTE_ERROR`: Error events

## Development

### Running Tests

To run all tests (including worker and server tests):

```bash
deno test -A --unstable-worker-options
```

To run a specific test file (e.g., the server test):

```bash
deno test --allow-net --allow-read tests/server_test.ts
```

- `-A` grants all permissions (required for filesystem/network tests).
- `--unstable-worker-options` is needed for custom worker permissions.

### Common Commands

- **Run all tests:**  
  `deno test -A --unstable-worker-options`
- **Run a single test file:**  
  `deno test --allow-net --allow-read tests/server_test.ts`
- **Format code:**  
  `deno fmt`
- **Check for lint errors:**  
  `deno lint`

### Project Structure

```
.
├── kernel/
│   ├── mod.ts           # Main entry point
│   ├── manager.ts       # Kernel manager implementation
│   ├── worker.ts        # Worker implementation
│   ├── index.ts         # Core interfaces and types
│   └── pypi/           # Python wheel files
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
