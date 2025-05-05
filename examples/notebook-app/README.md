# Deno Notebook Application

A Jupyter-like notebook interface built with Deno and the Deno Code Interpreter. This application demonstrates how to use the kernel and kernel manager to create an interactive notebook experience.

## Features

- Interactive Python code execution using the Deno Code Interpreter
- Support for multiple kernels with isolation
- Real-time output and display using WebSockets
- Support for matplotlib and plotly visualization
- Support for ipywidgets interactive components
- Notebook management (create, save, load)
- Example notebooks with common data visualization scenarios

## Running the Application

To run the application, use the following command from the project root:

```bash
deno run --allow-all examples/notebook-app/server.ts
```

Then open your browser to [http://localhost:8200](http://localhost:8200).

## Architecture

The application consists of:

1. **Backend Server**: A Deno server that manages kernels and notebooks
   - Kernel creation and management through the Deno Code Interpreter
   - WebSocket interface for real-time communication with kernels
   - Simple REST API for notebook management

2. **Frontend UI**: A Preact-based single-page application
   - Notebook interface with code cells and output display
   - Interactive UI for executing code and viewing results
   - Support for various output types (text, images, HTML, etc.)

## API Endpoints

- `POST /api/kernels`: Create a new kernel
- `GET /api/kernels`: List all kernels
- `GET /api/kernels/:id`: Get kernel info
- `DELETE /api/kernels/:id`: Delete a kernel
- `POST /api/kernels/:id/execute`: Execute code in a kernel
- `GET /api/kernels/:id/events`: WebSocket for kernel events

- `POST /api/notebooks`: Create a new notebook
- `GET /api/notebooks`: List all notebooks
- `GET /api/notebooks/:id`: Get a notebook
- `PUT /api/notebooks/:id`: Update a notebook

## Example Notebooks

The application comes with several example notebooks:

1. **Matplotlib Example**: Demonstrates basic plotting with matplotlib
2. **Plotly Example**: Shows interactive plotting with Plotly
3. **IPyWidgets Example**: Demonstrates interactive widgets

## How It Works

The application uses the Deno Code Interpreter to run Python code in Pyodide. Here's how it works:

1. When the application loads, it creates a new kernel using the kernel manager
2. When you execute code in a cell, it sends the code to the kernel through the API
3. The kernel executes the code and emits events for outputs (stdout, results, display data, etc.)
4. The frontend receives these events through a WebSocket connection and updates the UI

## Customization

You can customize the application by:

- Adding more example notebooks
- Adding support for additional output types
- Implementing more interactive features
- Adding authentication and user management
- Implementing persistent storage for notebooks 