# Deno Pyodide Kernel in Web Worker

This implementation demonstrates how to run the Deno Pyodide kernel in a separate web worker thread using Comlink for communication.

## Overview

The implementation consists of:

1. **worker.ts**: A web worker that creates and exposes the kernel via Comlink
2. **worker_test.ts**: A test file that creates a worker and communicates with it using Comlink

## How It Works

### Web Worker (worker.ts)

The web worker:
- Creates a Kernel instance
- Exposes it via Comlink for the main thread to access
- Sets up event forwarding using MessageChannel
- Handles cleanup when the worker is terminated

### Main Thread (worker_test.ts)

The main thread:
- Creates a worker and connects to it using Comlink
- Sets up message channels for event forwarding
- Makes calls to the kernel instance in the worker
- Properly terminates the worker when done

## Event Forwarding

Events from the kernel need special handling since they can't be automatically forwarded by Comlink:

1. A MessageChannel is created with two ports
2. One port is sent to the worker
3. The worker forwards kernel events through this port
4. The main thread listens for these events and processes them

## Usage

Run the worker test with:

```bash
deno task worker:test
```

Or directly with:

```bash
deno run --allow-net --allow-read --allow-env --allow-ffi worker_test.ts
```

## Benefits of Web Worker Architecture

1. **Performance**: Computation-heavy tasks run in a separate thread, keeping the main UI responsive
2. **Isolation**: Errors in the kernel won't crash the main application
3. **Clean Separation**: The kernel runs in an isolated environment

## Implementation Details

### Comlink

Comlink provides a simple API for main thread/worker communication:
- On the worker side: `Comlink.expose(kernel)`
- On the main thread: `const kernel = Comlink.wrap(worker)`

### Event Handling

Since EventEmitter events don't automatically transfer across worker boundaries:
1. Worker listens for kernel events and forwards them through the MessageChannel
2. Main thread receives these events and processes them appropriately 

### Cleanup

The worker properly cleans up resources when terminated:
1. Main thread calls `worker.terminate()` in a finally block
2. Worker listens for "beforeunload" event to clean up resources 