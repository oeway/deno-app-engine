#!/bin/bash

# Example Environment Configuration for Hypha Service
# This script demonstrates how to configure the hypha-service.ts using environment variables

echo "🔧 Setting up Hypha Service Environment Variables..."

# === HYPHA CONNECTION SETTINGS ===
export HYPHA_SERVER_URL="https://hypha.aicell.io"
export HYPHA_WORKSPACE="my-workspace"
# export HYPHA_TOKEN="your-token-here"  # Uncomment and set your token
# export HYPHA_CLIENT_ID="my-client-id"  # Uncomment if using custom client ID

# === KERNEL MANAGER SETTINGS ===
export ALLOWED_KERNEL_TYPES="worker-python,worker-typescript"
export KERNEL_POOL_ENABLED="true"
export KERNEL_POOL_SIZE="3"
export KERNEL_POOL_AUTO_REFILL="true"
export KERNEL_POOL_PRELOAD_CONFIGS="worker-python"

# === VECTOR DATABASE SETTINGS ===
export EMBEDDING_MODEL="mock-model"
export DEFAULT_EMBEDDING_PROVIDER_NAME="ollama-nomic-embed-text"  # Use one of the automatically created Ollama providers
export MAX_VECTOR_DB_INSTANCES="25"
export VECTORDB_OFFLOAD_DIRECTORY="./my_vectordb_offload"
export VECTORDB_DEFAULT_INACTIVITY_TIMEOUT="2700000"  # 45 minutes
export VECTORDB_ACTIVITY_MONITORING="true"
export OLLAMA_HOST="http://localhost:11434"

# === AI AGENT MODEL SETTINGS ===
export AGENT_MODEL_BASE_URL="http://localhost:11434/v1/"
export AGENT_MODEL_API_KEY="ollama"
export AGENT_MODEL_NAME="llama3.1:8b"  # Use a different model
export AGENT_MODEL_TEMPERATURE="0.5"

# === AGENT MANAGER SETTINGS ===
export MAX_AGENTS="15"
export AGENT_DATA_DIRECTORY="./my_agent_data"
export AUTO_SAVE_CONVERSATIONS="true"
export AGENT_MAX_STEPS_CAP="15"

echo "✅ Environment variables configured!"
echo ""
echo "🚀 Now run: deno run --allow-all scripts/hypha-service.ts"
echo ""
echo "📋 Configuration Summary:"
echo "- Vector DB will use '$DEFAULT_EMBEDDING_PROVIDER_NAME' as default embedding provider"
echo "- Agents will use '$AGENT_MODEL_NAME' model with temperature $AGENT_MODEL_TEMPERATURE"
echo "- Maximum $MAX_AGENTS agents allowed with $AGENT_MAX_STEPS_CAP max steps each"
echo "- Kernel pool: $KERNEL_POOL_SIZE kernels of types: $ALLOWED_KERNEL_TYPES" 