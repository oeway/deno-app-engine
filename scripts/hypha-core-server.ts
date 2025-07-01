/**
 * HyphaCore Server for Deno App Engine
 * 
 * This script starts a local HyphaCore server with deno-app-engine services
 * available as default services. This allows for standalone operation without
 * needing an external Hypha server.
 * 
 * Environment Variables Configuration:
 * 
 * === HYPHA CORE SERVER ===
 * - HYPHA_CORE_PORT: Port for HyphaCore server (default: 9527)
 * - HYPHA_CORE_HOST: Host for HyphaCore server (default: localhost)
 * - HYPHA_CORE_WORKSPACE: Default workspace for HyphaCore (default: default)
 * - HYPHA_CORE_JWT_SECRET: JWT secret for HyphaCore authentication (default: random)
 * 
 * === KERNEL MANAGER ===
 * - ALLOWED_KERNEL_TYPES: Comma-separated allowed kernel types (e.g., "worker-python,worker-typescript,main_thread-python")
 * - KERNEL_POOL_ENABLED: Enable kernel pooling (default: true)
 * - KERNEL_POOL_SIZE: Pool size for kernels (default: 2)
 * - KERNEL_POOL_AUTO_REFILL: Auto-refill kernel pool (default: true)
 * - KERNEL_POOL_PRELOAD_CONFIGS: Comma-separated preload configs (e.g., "worker-python,main_thread-python")
 * 
 * === VECTOR DATABASE ===
 * - EMBEDDING_MODEL: Default embedding model (default: "mock-model")
 * - DEFAULT_EMBEDDING_PROVIDER_NAME: Name of default embedding provider from registry
 * - MAX_VECTOR_DB_INSTANCES: Maximum vector DB instances (default: 20)
 * - VECTORDB_OFFLOAD_DIRECTORY: Directory for offloaded vector indices (default: "./vectordb_offload")
 * - VECTORDB_DEFAULT_INACTIVITY_TIMEOUT: Default inactivity timeout in ms (default: 1800000 = 30 minutes)
 * - VECTORDB_ACTIVITY_MONITORING: Enable activity monitoring (default: true)
 * - OLLAMA_HOST: Ollama server host for embedding providers (default: "http://localhost:11434")
 * 
 * === AI AGENT MODEL SETTINGS ===
 * - AGENT_MODEL_BASE_URL: Base URL for agent model API (default: "http://localhost:11434/v1/")
 * - AGENT_MODEL_API_KEY: API key for agent model (default: "ollama")
 * - AGENT_MODEL_NAME: Model name for agents (default: "qwen2.5-coder:7b")
 * - AGENT_MODEL_TEMPERATURE: Model temperature (default: 0.7)
 * 
 * === AGENT MANAGER ===
 * - MAX_AGENTS: Maximum number of agents (default: 10)
 * - AGENT_DATA_DIRECTORY: Directory for agent data (default: "./agent_data")
 * - AUTO_SAVE_CONVERSATIONS: Auto-save agent conversations (default: true)
 * - AGENT_MAX_STEPS_CAP: Maximum steps cap for agents (default: 10)
 */

import { HyphaCore } from 'hypha-core';
import { DenoWebSocketServer, DenoWebSocketClient } from 'hypha-core/deno-websocket-server';
import { registerService } from './hypha-service.ts';
import { createPlaygroundService } from './playground-service.ts';

// Generate a random JWT secret for HyphaCore
function generateRandomJwtSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}


async function startHyphaCoreServer(options: {
  port?: number;
  host?: string;
  workspace?: string;
  jwtSecret?: string;
} = {}) {
  // Configuration from environment variables
  const port = options.port || parseInt(Deno.env.get("HYPHA_CORE_PORT") || "9527");
  const host = options.host || Deno.env.get("HYPHA_CORE_HOST") || "localhost";
  const workspace = options.workspace || Deno.env.get("HYPHA_CORE_WORKSPACE") || "default";
  const jwtSecret = options.jwtSecret || Deno.env.get("HYPHA_CORE_JWT_SECRET") || generateRandomJwtSecret();
  
  console.log(`🚀 Starting HyphaCore server on ${host}:${port}`);
  console.log(`📁 Default workspace: ${workspace}`);

  // Create HyphaCore instance with deno-app-engine services as default services
  const hyphaCore = new HyphaCore({
    url: `http://${host}:${port}`,
    ServerClass: DenoWebSocketServer,
    WebSocketClass: DenoWebSocketClient,
    jwtSecret: jwtSecret,
  });

  // Start the HyphaCore server
  const hyphaAPI = await hyphaCore.start();

  await registerService(hyphaAPI);
  
  // Register the playground service
  await createPlaygroundService(hyphaAPI, {
    id: 'playground-service',
    name: 'Playground Service',
    description: 'Frontend playground interfaces for kernels, agents, and vector databases'
  });
  
  console.log(`✅ HyphaCore server started successfully!`);
  console.log(`🌐 Server URL: http://${host}:${port}`);
  console.log(`🔌 WebSocket URL: ws://${host}:${port}/ws`);
  console.log(`📁 Default workspace: ${workspace}`);
  console.log();
  console.log(`============================================================`);
  console.log(`🎉 Playground Service is running!`);
  console.log(`🌐 **Access the Playground:**`);
  console.log(`   Main Dashboard: http://${host}:${port}/${workspace}/apps/playground-service/`);
  console.log(`   Kernel Playground: http://${host}:${port}/${workspace}/apps/playground-service/kernels`);
  console.log(`   Agent Playground: http://${host}:${port}/${workspace}/apps/playground-service/agents`);
  console.log(`   VectorDB Playground: http://${host}:${port}/${workspace}/apps/playground-service/vectordb`);
  console.log(`📡 **API endpoints:**`);
  console.log(`   Service API: http://${host}:${port}/${workspace}/services/root:deno-app-engine/`);
  console.log(`✨ All playground interfaces are ready!`);
  console.log(`🚀 Ready to accept connections!`);
  
  // Keep the server running
  return { hyphaCore, hyphaAPI };
}

// Export for testing
export { startHyphaCoreServer };

// Start the server if this is the main module
if (import.meta.main) {
  try {
    await startHyphaCoreServer();
    console.log("HyphaCore server is running. Press Ctrl+C to exit.");
  } catch (error) {
    console.error("Failed to start HyphaCore server:", error);
    Deno.exit(1);
  }
} 