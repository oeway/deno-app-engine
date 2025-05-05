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

```bash
deno test tests/manager_test.ts -A --unstable-worker-options
```

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
