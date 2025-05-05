#!/bin/bash

# Start the notebook application
echo "Starting Deno Notebook Application..."
echo "Open your browser to http://localhost:8200"

# Run the server with necessary permissions
deno run --allow-all server.ts 