# Deno Code Interpreter

A Deno-based Python code interpreter using Pyodide, designed to mimic the behavior of a Jupyter kernel.

## Features

- Direct integration with Pyodide (no WebWorkers)
- Event-based communication interface
- Support for Python code execution with state preservation
- Error handling and display of execution results
- Similar architecture to Jupyter kernels but simplified

## Architecture

The code interpreter consists of the following components:

1. **Kernel Manager**: Handles the initialization and execution of Python code
2. **Event Bus**: Uses EventEmitter for communicating execution results
3. **Pyodide Integration**: Direct integration with Pyodide in the main thread

## Usage

```typescript
import { kernel } from "./mod.ts";

// Initialize the kernel
await kernel.initialize();

// Execute Python code
const result = await kernel.execute(`
import numpy as np
x = np.array([1, 2, 3])
print(f"Array: {x}")
`);

// Check execution status
console.log("Execution success:", result.success);

// Listen for output events
kernel.on("stream", (data) => {
  console.log(`${data.name}: ${data.text}`);
});

// Execute more code with the same state
await kernel.execute(`
y = x * 2
print(f"Array * 2 = {y}")
`);
```

## Events

The kernel emits the following events:

- `stream`: Standard output and error streams
- `execute_result`: Results from code execution
- `execute_error`: Errors from code execution
- `display_data`: Rich display data (e.g., plots, HTML, etc.)
- `input_request`: Requests for user input

## Running the Tests

```bash
deno test --allow-all main_test.ts
```

## Requirements

- Deno 1.40 or higher

## License

MIT
