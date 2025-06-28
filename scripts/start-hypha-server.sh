#!/bin/bash

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo "Deno is not installed. Please install Deno first:"
    echo "Visit https://deno.land/#installation for installation instructions"
    exit 1
fi

# Parse command line arguments
LOAD_APPS=""
PORT=""
HOST=""
WORKSPACE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --load-apps)
      LOAD_APPS="true"
      shift
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --load-apps         Load deno-app artifacts on startup"
      echo "  --port PORT         Set the server port (default: 9527)"
      echo "  --host HOST         Set the server host (default: localhost)"
      echo "  --workspace NAME    Set the default workspace (default: default)"
      echo "  --help              Show this help message"
      echo ""
      echo "Environment Variables:"
      echo "  HYPHA_CORE_PORT                   Server port (default: 9527)"
      echo "  HYPHA_CORE_HOST                   Server host (default: localhost)"
      echo "  HYPHA_CORE_WORKSPACE              Default workspace (default: default)"
      echo "  HYPHA_CORE_JWT_SECRET             JWT secret (default: random)"
      echo ""
      echo "  ALLOWED_KERNEL_TYPES              Allowed kernel types"
      echo "  KERNEL_POOL_ENABLED               Enable kernel pooling"
      echo "  KERNEL_POOL_SIZE                  Pool size for kernels"
      echo ""
      echo "  AGENT_MODEL_BASE_URL              Agent model API base URL"
      echo "  AGENT_MODEL_API_KEY               Agent model API key"
      echo "  AGENT_MODEL_NAME                  Agent model name"
      echo "  AGENT_MODEL_TEMPERATURE           Agent model temperature"
      echo ""
      echo "  EMBEDDING_MODEL                   Default embedding model"
      echo "  OLLAMA_HOST                       Ollama server host"
      echo ""
      echo "Example:"
      echo "  $0 --port 9000 --workspace my-workspace"
      echo "  $0 --load-apps --host 0.0.0.0"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Set environment variables from command line arguments
if [ -n "$PORT" ]; then
  export HYPHA_CORE_PORT="$PORT"
fi

if [ -n "$HOST" ]; then
  export HYPHA_CORE_HOST="$HOST"
fi

if [ -n "$WORKSPACE" ]; then
  export HYPHA_CORE_WORKSPACE="$WORKSPACE"
fi

if [ -n "$LOAD_APPS" ]; then
  export LOAD_APPS="$LOAD_APPS"
fi

# Start the server with necessary permissions
echo "Starting HyphaCore server..."
echo "Port: ${HYPHA_CORE_PORT:-9527}"
echo "Host: ${HYPHA_CORE_HOST:-localhost}"
echo "Workspace: ${HYPHA_CORE_WORKSPACE:-default}"
echo "Load Apps: ${LOAD_APPS:-false}"
echo ""

deno run --allow-net --allow-read --allow-write --allow-env --allow-ffi scripts/hypha-core-server.ts 