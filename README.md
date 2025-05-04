# Deno Code Interpreter

A Deno-based code interpreter that mimics the behavior of a Jupyter kernel, providing a lightweight and browser-compatible Python execution environment using Pyodide.

## Overview

This project implements a code interpreter that runs Python code in the browser using Deno and Pyodide. It follows a similar architecture to Jupyter kernels but is designed to be more lightweight and browser-native.

### Key Features

- **Deno-based Kernel Manager**: Runs in Deno and manages worker instances
- **Pyodide Workers**: Spawns WebWorkers running Pyodide for code execution
- **Event-based Communication**: Uses EventEmitter for message passing
- **Jupyter-compatible**: Follows similar patterns to Jupyter kernels
- **Browser-native**: Designed to run entirely in the browser

## Architecture

### Components

1. **Kernel Manager**
   - Manages worker lifecycle
   - Handles communication between client and workers
   - Implements EventEmitter for event handling

2. **Worker Interface**
   - Simple execution interface with `execute()` function
   - Event bus for output streaming (replacement for Jupyter's IOPub)
   - Based on Pyodide kernel implementation from JupyterLite

3. **Event System**
   - Uses EventEmitter for message passing
   - Replaces Jupyter's IOPub system
   - Handles:
     - Code execution status
     - Output streams (stdout/stderr)
     - Display data
     - Execution results

### Core Interfaces

```typescript
interface ICodeInterpreter {
  execute(code: string): Promise<ExecutionResult>;
  // Event emitter interface inherited from EventEmitter
}

interface ExecutionResult {
  status: 'ok' | 'error';
  execution_count: number;
  data?: any;
  error?: {
    ename: string;
    evalue: string;
    traceback: string[];
  };
}
```

## Implementation Details

### Worker Setup

The worker implementation follows JupyterLite's Pyodide kernel setup:

1. **Pyodide Initialization**
   - Loads Pyodide directly from npm
   - Sets up required Python packages:
     - ipykernel
     - comm
     - pyodide_kernel
     - jedi
     - ipython

2. **Callback System**
   - Implements display callbacks
   - Handles input requests
   - Manages comm messages

3. **Event Communication**
   - Uses EventEmitter for all message passing
   - Standardized event format for consistency

## Usage

```javascript
import { CodeInterpreter } from './code-interpreter.ts';

const interpreter = new CodeInterpreter();

// Execute code
const result = await interpreter.execute('print("Hello World")');

// Listen for outputs
interpreter.on('output', (data) => {
  console.log('Output:', data);
});

// Listen for errors
interpreter.on('error', (error) => {
  console.error('Error:', error);
});
```

## Development

### Key Files

- `kernel-manager.ts`: Main kernel manager implementation
- `worker.ts`: Pyodide worker implementation
- `event-bus.ts`: Event system implementation
- `types.ts`: TypeScript type definitions

### Dependencies

- Deno
- Pyodide
- EventEmitter

## Comparison with JupyterLite

This implementation is inspired by JupyterLite's Pyodide kernel but with key differences:

1. **Platform**: Deno-based instead of Node.js
2. **Communication**: EventEmitter instead of Jupyter's messaging protocol
3. **Scope**: Focused on code execution rather than full notebook support
4. **Dependencies**: Simplified dependency management using Deno

## Future Improvements

- Add support for magic commands
- Implement variable inspection
- Add code completion support
- Support for interactive widgets
- Add streaming output support
