/**
 * Hypha Service for Deno App Engine
 * 
 * This service provides kernel management, vector database, and AI agent capabilities
 * through a Hypha-compatible WebSocket service interface.
 * 
 * Environment Variables Configuration:
 * 
 * === HYPHA CONNECTION ===
 * - HYPHA_SERVER_URL: Hypha server URL (default: https://hypha.aicell.io)
 * - HYPHA_WORKSPACE: Hypha workspace name
 * - HYPHA_TOKEN: Authentication token for Hypha server
 * - HYPHA_CLIENT_ID: Client identifier for Hypha connections
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

import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";
import type { IKernelManagerOptions } from "../kernel/manager.ts";
import { VectorDBManager, VectorDBEvents, VectorDBPermission, type IVectorDBManagerOptions, type IDocument, type IQueryOptions, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";
import { AgentManager, AgentEvents, KernelType, type IAgentConfig } from "../agents/mod.ts";
import type { ChatMessage } from "../agents/chatCompletion.ts";

// Add type declaration for global variable
declare global {
  var cpuBaseline: number | undefined;
}

// Helper functions for formatting
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0) parts.push(`${remainingSeconds}s`);
  
  return parts.join(' ');
}

// Function to get approximate CPU usage
// This is a simple approximation in Deno, as there is no direct API for CPU usage
let lastCpuUsage = { time: Date.now(), usage: 0 };
async function getCpuUsage(): Promise<number> {
  try {
    // Use cached value if it's recent (within last second)
    const now = Date.now();
    if (now - lastCpuUsage.time < 1000) {
      return lastCpuUsage.usage;
    }
    
    // Create a simple CPU-intensive task to measure relative performance
    const startTime = now;
    let counter = 0;
    
    // Run a computation for a short time to measure CPU load
    const sampleDuration = 50; // ms - shorter duration to be less intrusive
    while (Date.now() - startTime < sampleDuration) {
      counter++;
      // Simple math operations to use CPU
      Math.sqrt(Math.random() * 10000);
    }
    
    const endTime = Date.now();
    const actualDuration = endTime - startTime;
    
    // Calculate operations per millisecond
    const opsPerMs = counter / actualDuration;
    
    // Measure against a reasonable baseline that varies by machine
    // We'll use a dynamic approach based on the first measurement
    if (!globalThis.cpuBaseline) {
      // First run - assume this is a baseline (low load)
      // Store it with a safety margin
      globalThis.cpuBaseline = opsPerMs * 0.8; // 80% of first measurement
      console.log(`CPU baseline established: ${globalThis.cpuBaseline.toFixed(2)} ops/ms`);
      return 0.2; // Assume 20% load on first measurement
    }
    
    // Calculate load factor as inverse ratio of current perf to baseline
    // Lower ops/ms means higher CPU usage
    const loadFactor = 1 - (opsPerMs / globalThis.cpuBaseline);
    
    // Clamp between 0 and 1 (0-100%)
    const usage = Math.min(1, Math.max(0, loadFactor));
    
    // Store the last measurement
    lastCpuUsage = { time: endTime, usage };
    
    return usage;
  } catch (error) {
    console.error("Error measuring CPU usage:", error);
    // Return last known usage or 0 if none
    return lastCpuUsage.usage || 0;
  }
}

// Track service start time
const serviceStartTime = Date.now();

// Store kernel execution history
interface KernelHistory {
  id: string; // execution id
  script: string;
  outputs: unknown[];
}

const kernelHistory = new Map<string, KernelHistory[]>();

// Store vector database query history
interface VectorDBHistory {
  id: string; // query id
  query: string | number[];
  results: unknown[];
  timestamp: Date;
}

const vectorDBHistory = new Map<string, VectorDBHistory[]>();

// create a function to ensure the kernel id starts with the namespace
// if : is in the id, it should match the namespace
// otherwise, we should add the namespace to the id
function ensureKernelId(id: string, namespace: string) {
    if (id.includes(':')) {
        if (id.startsWith(namespace + ":")) {
            return id;
        }
    }
    return namespace + ":" + id;
}

// Helper function to handle vector index access across workspaces
async function ensureVectorIndexAccess(indexId: string, requestingNamespace: string, vectorDBManager: VectorDBManager, operation: "read" | "add" | "remove"): Promise<string> {
  // If indexId contains namespace, check if it's accessible
  if (indexId.includes(':')) {
    const fullIndexId = indexId;
    let instance = vectorDBManager.getInstance(fullIndexId);
    
    // If not in memory, try to auto-load from disk
    if (!instance) {
      try {
        instance = await vectorDBManager.autoLoadInstance(fullIndexId);
      } catch (error) {
        console.warn(`Failed to auto-load index ${fullIndexId}:`, error);
      }
    }
    
    if (!instance) {
      throw new Error("Vector index not found");
    }
    
    // Check permission for cross-workspace access
    if (!vectorDBManager.checkPermission(fullIndexId, requestingNamespace, operation)) {
      const instanceNamespace = fullIndexId.split(':')[0];
      const permission = instance.options.permission || VectorDBPermission.PRIVATE;
      
      throw new Error(
        `Access denied: Cannot ${operation} on vector index ${fullIndexId}. ` +
        `Index is in workspace '${instanceNamespace}' with permission '${permission}', ` +
        `but request is from workspace '${requestingNamespace}'.`
      );
    }
    
    return fullIndexId;
  } else {
    // If no namespace in ID, assume it's in the requesting namespace
    return ensureKernelId(indexId, requestingNamespace);
  }
}

function ensureAgentAccess(agentId: string, namespace: string): string {
  // If the agent ID is namespaced and matches the expected namespace, allow access
  if (agentId.includes(':')) {
    const [agentNamespace] = agentId.split(':');
    if (agentNamespace === namespace) {
      return agentId;
    } else {
      throw new Error(`Access denied: Agent ${agentId} is not in workspace ${namespace}`);
    }
  }
  
  // For non-namespaced agents, construct the full namespaced ID
  const fullAgentId = `${namespace}:${agentId}`;
  console.log(`Converting non-namespaced agent ID ${agentId} to namespaced ID ${fullAgentId} for workspace ${namespace}`);
  return fullAgentId;
}

// Configure kernel manager options from environment variables
function getKernelManagerOptions(): IKernelManagerOptions {
  // Parse allowed kernel types from environment variable
  // Format: "worker-python,worker-typescript,main_thread-python"
  const allowedTypesEnv = Deno.env.get("ALLOWED_KERNEL_TYPES");
  let allowedKernelTypes: Array<{ mode: KernelMode; language: KernelLanguage }> = [];
  
  if (allowedTypesEnv) {
    allowedKernelTypes = allowedTypesEnv.split(",").map(typeStr => {
      const [modeStr, langStr] = typeStr.trim().split("-");
      
      const mode = modeStr === "main_thread" ? KernelMode.MAIN_THREAD : KernelMode.WORKER;
      const language = langStr === "typescript" ? KernelLanguage.TYPESCRIPT : KernelLanguage.PYTHON;
      
      return { mode, language };
    });
  } else {
    // Default: only worker kernels for security
    allowedKernelTypes = [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
      { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
    ];
  }
  
  // Parse pool configuration from environment variables
  const poolEnabled = Deno.env.get("KERNEL_POOL_ENABLED") !== "false";
  const poolSize = parseInt(Deno.env.get("KERNEL_POOL_SIZE") || "2");
  const autoRefill = Deno.env.get("KERNEL_POOL_AUTO_REFILL") !== "false"; // Default true
  
  // Parse preload configs from environment variable
  // Format: "worker-python,main_thread-python"
  const preloadConfigsEnv = Deno.env.get("KERNEL_POOL_PRELOAD_CONFIGS");
  let preloadConfigs: Array<{ mode: KernelMode; language: KernelLanguage }> = [];
  
  if (preloadConfigsEnv) {
    preloadConfigs = preloadConfigsEnv.split(",").map(typeStr => {
      const [modeStr, langStr] = typeStr.trim().split("-");
      
      const mode = modeStr === "main_thread" ? KernelMode.MAIN_THREAD : KernelMode.WORKER;
      const language = langStr === "typescript" ? KernelLanguage.TYPESCRIPT : KernelLanguage.PYTHON;
      
      return { mode, language };
    });
  } else {
    // Default: preload Python worker kernels only
    preloadConfigs = allowedKernelTypes.filter(type => 
      type.language === KernelLanguage.PYTHON
    );
  }
  
  const options: IKernelManagerOptions = {
    allowedKernelTypes,
    pool: {
      enabled: poolEnabled,
      poolSize,
      autoRefill,
      preloadConfigs
    }
  };
  
  console.log("Hypha Service Kernel Manager Configuration:");
  console.log(`- Allowed kernel types: ${allowedKernelTypes.map(t => `${t.mode}-${t.language}`).join(", ")}`);
  console.log(`- Pool enabled: ${poolEnabled}`);
  if (poolEnabled) {
    console.log(`- Pool size: ${poolSize}`);
    console.log(`- Auto refill: ${autoRefill}`);
    console.log(`- Preload configs: ${preloadConfigs.map(t => `${t.mode}-${t.language}`).join(", ")}`);
  }
  
  return options;
}

/**
 * Load and execute deno-app artifacts from the artifact manager
 */
async function loadDenoApps(server: any, kernelManager: KernelManager) {
  try {
    console.log("🔍 Loading deno-app artifacts from artifact manager...");
    
    // Get the artifact manager service
    const artifactManager = await server.getService('public/artifact-manager');
    
    // List all artifacts with type 'deno-app' from 'hypha-agents/agents'
    const artifacts = await artifactManager.list({
      parent_id: "hypha-agents/agents",
      filters: { type: 'deno-app' },
      limit: 100,
      _rkwargs: true
    });
    
    console.log(`📦 Found ${artifacts.length} deno-app artifacts`);
    
    for (const artifact of artifacts) {
      try {
        console.log(`🚀 Loading deno-app: ${artifact.id} (${artifact.name})`);
        
        // Read the artifact to get the manifest
        const artifactData = await artifactManager.read(artifact.id);
        
        if (!artifactData.manifest || !artifactData.manifest.startup_script) {
          console.log(`⚠️  Skipping ${artifact.id}: No startup script found`);
          continue;
        }
        
        const startupScript = artifactData.manifest.startup_script;
        console.log(`📝 Startup script length: ${startupScript.length} characters`);
        
        // Determine kernel language from manifest.lang field
        let kernelLanguage = KernelLanguage.PYTHON; // Default to Python
        if (artifactData.manifest.lang) {
          switch (artifactData.manifest.lang.toLowerCase()) {
            case 'typescript':
            case 'ts':
              kernelLanguage = KernelLanguage.TYPESCRIPT;
              break;
            case 'javascript':
            case 'js':
              kernelLanguage = KernelLanguage.JAVASCRIPT;
              break;
            case 'python':
            case 'py':
            default:
              kernelLanguage = KernelLanguage.PYTHON;
              break;
          }
        }
        
        console.log(`🔧 Creating ${artifactData.manifest.lang || 'python'} kernel for app ${artifact.id}`);
        
        // Create a kernel with the artifact ID as kernel ID
        const kernelId = await kernelManager.createKernel({
          id: artifact.id,
          mode: KernelMode.WORKER,
          lang: kernelLanguage,
          namespace: "deno-apps", // Use a special namespace for deno apps
          inactivityTimeout: 1000 * 60 * 60 * 24, // 24 hours - apps should run long
          maxExecutionTime: 1000 * 60 * 60 * 24 * 365 // 1 year - essentially unlimited
        });
        
        console.log(`🔧 Created kernel ${kernelId} for app ${artifact.id}`);
        
        // Execute the startup script
        console.log(`▶️  Executing startup script for ${artifact.id}...`);
        
        const executionId = crypto.randomUUID();
        const outputs: unknown[] = [];
        
        let hasOutput = false;
        for await (const output of kernelManager.executeStream(kernelId, startupScript)) {
          hasOutput = true;
          outputs.push(output);
          console.log(`📤 [${artifact.id}] Output:`, output);
          
          // If there's an error, log it but continue with other apps
          if (output.type === 'error') {
            console.error(`❌ [${artifact.id}] Execution error:`, output);
          }
        }
        
        // Store the startup script execution in history
        const history = kernelHistory.get(kernelId) || [];
        history.push({
          id: executionId,
          script: startupScript,
          outputs,
        });
        kernelHistory.set(kernelId, history);
        
        if (!hasOutput) {
          console.log(`✅ [${artifact.id}] Startup script executed (no output)`);
        } else {
          console.log(`✅ [${artifact.id}] Startup script completed`);
        }
        
      } catch (error) {
        console.error(`❌ Failed to load deno-app ${artifact.id}:`, error);
        // Continue with other apps even if one fails
        continue;
      }
    }
    
    console.log(`🎉 Finished loading ${artifacts.length} deno-app artifacts`);
    
  } catch (error) {
    console.error("❌ Failed to load deno-apps:", error);
    throw error;
  }
}

async function startHyphaService(options: {
  skipLogin?: boolean;
  serverUrl?: string;
  workspace?: string;
  token?: string;
  clientId?: string;
} = {}) {
  console.log("Connecting to hypha server...");
  let token = options.token || Deno.env.get("HYPHA_TOKEN");
  
  // Skip login if explicitly requested (for testing)
  if(!token && !options.skipLogin){
    token = await hyphaWebsocketClient.login({
        "server_url": options.serverUrl || Deno.env.get("HYPHA_SERVER_URL") || "https://hypha.aicell.io",
    })
  }
  
  const server = await hyphaWebsocketClient.connectToServer({
    // read the following from environment variables and use default
    "server_url": options.serverUrl || Deno.env.get("HYPHA_SERVER_URL") || "https://hypha.aicell.io",
    "workspace": options.workspace || Deno.env.get("HYPHA_WORKSPACE") || undefined,
    "token": token,
    "client_id": options.clientId || Deno.env.get("HYPHA_CLIENT_ID") || undefined,
  });
  
  console.log("Connected to hypha server, registering service...");
  // Create a global kernel manager instance with configuration
  const kernelManager = new KernelManager(getKernelManagerOptions());
  
  // Configure agent model settings from environment variables
  const DEFAULT_AGENT_MODEL_SETTINGS = {
    baseURL: Deno.env.get("AGENT_MODEL_BASE_URL") || "http://localhost:11434/v1/",
    apiKey: Deno.env.get("AGENT_MODEL_API_KEY") || "ollama",
    model: Deno.env.get("AGENT_MODEL_NAME") || "qwen2.5-coder:7b",
    temperature: parseFloat(Deno.env.get("AGENT_MODEL_TEMPERATURE") || "0.7")
  };

  // Configure vector database manager options from environment variables
  const vectorDBOffloadDirectory = Deno.env.get("VECTORDB_OFFLOAD_DIRECTORY") || "./vectordb_offload";
  const vectorDBDefaultTimeout = parseInt(Deno.env.get("VECTORDB_DEFAULT_INACTIVITY_TIMEOUT") || "1800000"); // 30 minutes default
  const vectorDBActivityMonitoring = Deno.env.get("VECTORDB_ACTIVITY_MONITORING") !== "false"; // Default true
  const defaultEmbeddingProviderName = Deno.env.get("DEFAULT_EMBEDDING_PROVIDER_NAME") || undefined;

  // Create a global vector database manager instance
  const vectorDBManager = new VectorDBManager({
    defaultEmbeddingModel: Deno.env.get("EMBEDDING_MODEL") || "mock-model",
    defaultEmbeddingProviderName: defaultEmbeddingProviderName,
    maxInstances: parseInt(Deno.env.get("MAX_VECTOR_DB_INSTANCES") || "20"),
    allowedNamespaces: undefined, // Allow all namespaces for now
    offloadDirectory: vectorDBOffloadDirectory,
    defaultInactivityTimeout: vectorDBDefaultTimeout,
    enableActivityMonitoring: vectorDBActivityMonitoring
  });
  
  // Setup default Ollama providers if available
  const defaultProviders = [
    {
      name: "ollama-nomic-embed-text",
      model: "nomic-embed-text",
      dimension: 768,
      description: "Ollama nomic-embed-text model (768D)"
    },
    {
      name: "ollama-all-minilm",
      model: "all-minilm",
      dimension: 384,
      description: "Ollama all-minilm model (384D)"
    },
    {
      name: "ollama-mxbai-embed-large",
      model: "mxbai-embed-large",
      dimension: 1024,
      description: "Ollama mxbai-embed-large model (1024D)"
    }
  ];

  const ollamaHost = Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
  let providersAdded = 0;

  for (const providerConfig of defaultProviders) {
    try {
      const provider = createOllamaEmbeddingProvider(
        providerConfig.name,
        ollamaHost,
        providerConfig.model,
        providerConfig.dimension
      );
      
      const success = vectorDBManager.addEmbeddingProvider(providerConfig.name, provider);
      if (success) {
        console.log(`✅ Added Ollama provider: ${providerConfig.name}`);
        providersAdded++;
      } else {
        console.log(`⚠️ Provider ${providerConfig.name} already exists`);
      }
    } catch (error) {
      console.log(`⚠️ Failed to add Ollama provider ${providerConfig.name}:`, error instanceof Error ? error.message : String(error));
    }
  }

  if (providersAdded === 0) {
    console.log("⚠️ No Ollama providers were added (Ollama may not be available)");
  } else {
    console.log(`✅ Successfully added ${providersAdded} Ollama providers`);
  }

  // Validate that the default embedding provider name exists if specified
  if (defaultEmbeddingProviderName) {
    const hasProvider = vectorDBManager.getEmbeddingProvider(defaultEmbeddingProviderName);
    if (!hasProvider) {
      console.warn(`⚠️ Warning: DEFAULT_EMBEDDING_PROVIDER_NAME "${defaultEmbeddingProviderName}" was specified but provider not found.`);
      console.warn(`   Available providers will be listed after service registration.`);
      console.warn(`   Vector indices will fall back to default embedding model: ${Deno.env.get("EMBEDDING_MODEL") || "mock-model"}`);
    } else {
      console.log(`✅ Default embedding provider "${defaultEmbeddingProviderName}" is available`);
    }
  }

  console.log("Hypha Service VectorDB Manager Configuration:");
  console.log(`- Default embedding model: ${Deno.env.get("EMBEDDING_MODEL") || "mock-model"}`);
  console.log(`- Default embedding provider: ${defaultEmbeddingProviderName || "none (will use default embedding model)"}`);
  console.log(`- Offload directory: ${vectorDBOffloadDirectory}`);
  console.log(`- Default inactivity timeout: ${vectorDBDefaultTimeout}ms (${Math.round(vectorDBDefaultTimeout / 60000)} minutes)`);
  console.log(`- Activity monitoring enabled: ${vectorDBActivityMonitoring}`);

  // Configure agent manager options from environment variables
  const agentDataDirectory = Deno.env.get("AGENT_DATA_DIRECTORY") || "./agent_data";
  const maxAgents = parseInt(Deno.env.get("MAX_AGENTS") || "10");
  const autoSaveConversations = Deno.env.get("AUTO_SAVE_CONVERSATIONS") !== "false"; // Default true
  const maxStepsCap = parseInt(Deno.env.get("AGENT_MAX_STEPS_CAP") || "10");

  // Create a global agent manager instance
  const agentManager = new AgentManager({
    defaultModelSettings: DEFAULT_AGENT_MODEL_SETTINGS,
    agentDataDirectory,
    maxAgents,
    autoSaveConversations,
    defaultKernelType: KernelType.PYTHON,
    maxStepsCap
  });

  // Set the kernel manager for agent kernel integration
  agentManager.setKernelManager(kernelManager);

  console.log("Hypha Service Agent Manager Configuration:");
  console.log(`- Default model: ${DEFAULT_AGENT_MODEL_SETTINGS.model}`);
  console.log(`- Default base URL: ${DEFAULT_AGENT_MODEL_SETTINGS.baseURL}`);
  console.log(`- Default API key: ${DEFAULT_AGENT_MODEL_SETTINGS.apiKey.substring(0, 8)}...`);
  console.log(`- Default temperature: ${DEFAULT_AGENT_MODEL_SETTINGS.temperature}`);
  console.log(`- Max agents: ${maxAgents}`);
  console.log(`- Agent data directory: ${agentDataDirectory}`);
  console.log(`- Auto save conversations: ${autoSaveConversations}`);
  console.log(`- Max steps cap: ${maxStepsCap}`);
  
  // Log the actual environment variable values for debugging
  console.log("Environment Variable Values:");
  console.log(`- AGENT_MODEL_NAME: ${Deno.env.get("AGENT_MODEL_NAME")}`);
  console.log(`- AGENT_MODEL_BASE_URL: ${Deno.env.get("AGENT_MODEL_BASE_URL")}`);
  console.log(`- AGENT_MODEL_API_KEY: ${Deno.env.get("AGENT_MODEL_API_KEY")?.substring(0, 8)}...`);
  console.log(`- AGENT_MODEL_TEMPERATURE: ${Deno.env.get("AGENT_MODEL_TEMPERATURE")}`);

  
  const svc = await server.registerService({
    "name": "Deno App Engine",
    "id": "deno-app-engine",
    "type": "deno-app-engine",
    "config": {
      "visibility": "public",
      "require_context": true
    },
    
    // Service methods
    async createKernel(options: {id: string, mode: KernelMode, inactivity_timeout?: number, max_execution_time?: number}, context: {user: any, ws: string}) {
      try {
        options = options || {};
        const namespace = context.ws;
        console.log(`Creating kernel with namespace: ${namespace}, requested ID: ${options.id || "auto-generated"}`);
        
        // Get existing kernels before creation
        const existingKernels = kernelManager.getKernelIds();
        console.log(`Existing kernels before creation: ${existingKernels.length}`);
        
        const kernelId = await kernelManager.createKernel({
          id: options.id || crypto.randomUUID(),
          mode: options.mode || KernelMode.WORKER,
          namespace: namespace, // Use workspace as namespace for isolation
          inactivityTimeout: options.inactivity_timeout || 1000 * 60 * 10, // 10 minutes default
          maxExecutionTime: options.max_execution_time || 1000 * 60 * 60 * 24 * 10 // 10 days default
        });
        
        console.log(`Kernel created with ID: ${kernelId}`);
        
        // Verify kernel exists in manager
        const allKernelsAfter = kernelManager.getKernelIds();
        console.log(`All kernels after creation: ${allKernelsAfter.join(', ')}`);
        
        // Verify kernel exists
        const kernel = kernelManager.getKernel(kernelId);
        if (!kernel) {
          console.error(`Failed to get kernel after creation: ${kernelId}`);
          throw new Error("Failed to get kernel after creation");
        }
        
        // Verify it appears in list for this namespace
        const kernelsInNamespace = kernelManager.listKernels(namespace);
        console.log(`Kernels in namespace ${namespace} after creation: ${kernelsInNamespace.length}`);
        const kernelExists = kernelsInNamespace.some(k => k.id === kernelId);
        if (!kernelExists) {
          console.error(`Kernel ${kernelId} created but not found in namespace ${namespace} list`);
        }
        
        // Initialize the kernel
        if (typeof kernel.kernel.initialize === 'function') {
          await kernel.kernel.initialize();
        }
        
        // Initialize history for this kernel
        kernelHistory.set(kernelId, []);
        
        return {
          id: kernelId,
          mode: kernel.mode,
          language: kernel.language,
          created: kernel.created.toISOString(),
          name: `Kernel-${kernelId.split(":")[1].slice(0, 8)}`
        };
      } catch (error) {
        console.error("Error creating kernel:", error);
        throw error;
      }
    },
    
    listKernels(context: {user: any, ws: string}) {
      // Only list kernels in the user's workspace namespace
      console.log(`Listing kernels for namespace: ${context.ws}, total kernels in manager: ${kernelManager.getKernelIds().length}`);
      console.log(`All kernel IDs: ${kernelManager.getKernelIds().join(', ')}`);
      const kernelList = kernelManager.listKernels(context.ws);
      console.log(`Found ${kernelList.length} kernels for namespace ${context.ws}`);
      return kernelList.map(kernel => ({
        id: kernel.id,
        name: `Kernel-${kernel.id.split(":")[1].slice(0, 8)}`,
        mode: kernel.mode,
        language: kernel.language,
        created: kernel.created.toISOString(),
      }));
    },
    
    async destroyKernel({kernelId}: {kernelId: string}, context: {user: any, ws: string}) {
      kernelId = ensureKernelId(kernelId, context.ws);
      console.log(`Attempting to destroy kernel: ${kernelId}`);
      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        console.log(`Kernel not found: ${kernelId}`);
        throw new Error("Kernel not found or access denied");
      }
      
      // Clean up history
      kernelHistory.delete(kernelId);
      
      await kernelManager.destroyKernel(kernelId);
      console.log(`Kernel destroyed: ${kernelId}`);
      return { success: true };
    },
    
    getKernelInfo({kernelId}: {kernelId: string}, context: {user: any, ws: string}) {
        kernelId = ensureKernelId(kernelId, context.ws);
      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }
      
      return {
        id: kernelId,
        name: `Kernel-${kernelId.split(":")[1].slice(0, 8)}`,
        mode: kernel.mode,
        language: kernel.language,
        created: kernel.created.toISOString(),
        status: kernel.kernel.status || "unknown",
        history: kernelHistory.get(kernelId) || [],
      };
    },

    async pingKernel({kernelId}: {kernelId: string}, context: {user: any, ws: string}) {
      kernelId = ensureKernelId(kernelId, context.ws);
      
      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }
      
      // Ping the kernel to reset activity timer
      const success = kernelManager.pingKernel(kernelId);
      
      if (!success) {
        throw new Error("Failed to ping kernel");
      }
      
      return { 
        success: true, 
        message: "Kernel activity timer reset",
        timestamp: new Date().toISOString()
      };
    },

    async restartKernel({kernelId}: {kernelId: string}, context: {user: any, ws: string}) {
      kernelId = ensureKernelId(kernelId, context.ws);
      
      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }
      
      // Restart the kernel
      const success = await kernelManager.restartKernel(kernelId);
      
      if (!success) {
        throw new Error("Failed to restart kernel");
      }
      
      console.log(`Kernel ${kernelId} restarted by user in workspace ${context.ws}`);
      return { 
        success: true, 
        message: "Kernel restarted successfully",
        timestamp: new Date().toISOString()
      };
    },

    async interruptKernel({kernelId}: {kernelId: string}, context: {user: any, ws: string}) {
      kernelId = ensureKernelId(kernelId, context.ws);
      
      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }
      
      // Interrupt the kernel
      const success = await kernelManager.interruptKernel(kernelId);
      
      if (!success) {
        throw new Error("Failed to interrupt kernel");
      }
      
      console.log(`Kernel ${kernelId} interrupted by user in workspace ${context.ws}`);
      return { 
        success: true, 
        message: "Kernel execution interrupted",
        timestamp: new Date().toISOString()
      };
    },

    async getStatus(context: {user: any, ws: string}) {
      // Get total kernels across all namespaces
      const allKernels = kernelManager.getKernelIds();
      const totalKernels = allKernels.length;
      
      // Get kernels in current namespace - use a more robust approach
      // to avoid errors with partially initialized kernels
      const userKernelIds = allKernels.filter(id => id.startsWith(context.ws + ':'));
      const namespaceKernelCount = userKernelIds.length;
      
      // Get active executions counts across all kernels
      let totalActiveExecutions = 0;
      let namespaceActiveExecutions = 0;
      
      // Map to store executions by status
      const executionsByStatus = {
        total: { active: 0, stuck: 0 },
        namespace: { active: 0, stuck: 0 }
      };
      
      // Calculate active executions and check for stuck kernels
      for (const kernelId of allKernels) {
        try {
          const execInfo = kernelManager.getExecutionInfo(kernelId);
          totalActiveExecutions += execInfo.count;
          
          if (execInfo.isStuck) {
            executionsByStatus.total.stuck += 1;
          }
          
          if (execInfo.count > 0) {
            executionsByStatus.total.active += 1;
          }
          
          // Check if this kernel belongs to the user's namespace
          if (kernelId.startsWith(context.ws + ':')) {
            namespaceActiveExecutions += execInfo.count;
            
            if (execInfo.isStuck) {
              executionsByStatus.namespace.stuck += 1;
            }
            
            if (execInfo.count > 0) {
              executionsByStatus.namespace.active += 1;
            }
          }
        } catch (error) {
          console.warn(`Error getting execution info for kernel ${kernelId}:`, error);
          // Continue with other kernels if one fails
          continue;
        }
      }
      
      // Get memory usage information
      const memoryUsage = Deno.memoryUsage();
      
      // Get uptime in seconds
      const uptime = (Date.now() - serviceStartTime) / 1000;
      
      // Calculate average memory per kernel if kernels exist
      const avgMemoryPerKernel = totalKernels > 0 
        ? Math.round(memoryUsage.heapUsed / totalKernels) 
        : 0;
      
      // Get CPU usage
      const cpuUsage = await getCpuUsage();
      
      // Get pool configuration and statistics
      const poolConfig = kernelManager.getPoolConfig();
      const poolStats = kernelManager.getPoolStats();
      
      return {
        systemStats: {
          uptime: Math.round(uptime),
          uptimeFormatted: formatUptime(uptime),
          memoryUsage: {
            heapTotal: formatBytes(memoryUsage.heapTotal),
            heapUsed: formatBytes(memoryUsage.heapUsed),
            rss: formatBytes(memoryUsage.rss),
            external: formatBytes(memoryUsage.external)
          },
          avgMemoryPerKernel: formatBytes(avgMemoryPerKernel),
          cpuUsage: `${Math.round(cpuUsage * 100)}%`
        },
        kernelStats: {
          total: totalKernels,
          namespaceCount: namespaceKernelCount,
          activeExecutions: {
            total: totalActiveExecutions,
            namespace: namespaceActiveExecutions
          },
          executionsByStatus
        },
        poolStats: {
          config: {
            enabled: poolConfig.enabled,
            poolSize: poolConfig.poolSize,
            autoRefill: poolConfig.autoRefill,
            preloadConfigs: poolConfig.preloadConfigs.map(config => `${config.mode}-${config.language}`),
            isPreloading: poolConfig.isPreloading
          },
          statistics: poolStats
        }
      };
    },

    async executeCode({kernelId, code}: {kernelId: string, code: string}, context: {user: any, ws: string}) {
        kernelId = ensureKernelId(kernelId, context.ws);
      if (!code) {
        throw new Error("No code provided");
      }

      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }

      const executionId = crypto.randomUUID();
      
      // Execute in background and store result in history when complete
      (async () => {
        try {
          const outputs: unknown[] = [];
          for await (const output of kernelManager.executeStream(kernelId, code)) {
            outputs.push(output);
          }
          
          // Add to kernel history after completion
          const history = kernelHistory.get(kernelId) || [];
          history.push({
            id: executionId,
            script: code,
            outputs,
          });
          kernelHistory.set(kernelId, history);
        } catch (error) {
          console.error(`Execution error for ${kernelId}:`, error);
          // Still record the execution with error
          const history = kernelHistory.get(kernelId) || [];
          history.push({
            id: executionId,
            script: code,
            outputs: [{
              type: "error",
              data: { message: error instanceof Error ? error.message : String(error) }
            }],
          });
          kernelHistory.set(kernelId, history);
        }
      })();
      
      return { execution_id: executionId };
    },
    
    async getExecutionResult({kernelId, executionId}: {kernelId: string, executionId: string}, context: {user: any, ws: string}) {
        kernelId = ensureKernelId(kernelId, context.ws);

      const history = kernelHistory.get(kernelId) || [];
      const execution = history.find(h => h.id === executionId);
      
      if (!execution) {
        throw new Error("Execution not found");
      }

      return execution.outputs;
    },
    
    // Stream execution as outputs
    async *streamExecution({kernelId, code}: {kernelId: string, code: string}, context: {user: any, ws: string}) {
        kernelId = ensureKernelId(kernelId, context.ws);
        if (!code) {
        throw new Error("No code provided");
      }

      // Verify kernel belongs to user's namespace
      const kernel = kernelManager.getKernel(kernelId);
      if (!kernel) {
        throw new Error("Kernel not found or access denied");
      }

      try {
        // Stream outputs directly from the kernel manager
        for await (const output of kernelManager.executeStream(kernelId, code)) {
          yield output;
        }
        
        // Signal completion
        yield { type: 'complete', status: 'success' };
        
        // Add to kernel history after completion
        const executionId = crypto.randomUUID();
        const history = kernelHistory.get(kernelId) || [];
        history.push({
          id: executionId,
          script: code,
          outputs: [], // We don't store outputs for streamed executions
        });
        kernelHistory.set(kernelId, history);
      } catch (error) {
        yield { 
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    // Vector Database Services
    
    async createVectorIndex(options: {
      id?: string, 
      embeddingModel?: string,
      embeddingProviderName?: string,
      maxDocuments?: number,
      inactivityTimeout?: number,
      enableActivityMonitoring?: boolean,
      resume?: boolean,
      permission?: VectorDBPermission
    }, context: {user: any, ws: string}) {
      try {
        console.log(`Creating vector index with namespace: ${context.ws}, requested ID: ${options.id || "auto-generated"}, resume: ${options.resume || false}`);
        
        const indexId = await vectorDBManager.createIndex({
          id: options.id || crypto.randomUUID(),
          namespace: context.ws,
          embeddingModel: options.embeddingModel,
          embeddingProviderName: options.embeddingProviderName,
          maxDocuments: options.maxDocuments,
          inactivityTimeout: options.inactivityTimeout,
          enableActivityMonitoring: options.enableActivityMonitoring,
          resume: options.resume,
          permission: options.permission || VectorDBPermission.PRIVATE
        });
        
        console.log(`Vector index created with ID: ${indexId}`);
        
        // Initialize history for this index
        vectorDBHistory.set(indexId, []);
        
        return {
          id: indexId,
          created: new Date().toISOString(),
          name: `VectorDB-${indexId.split(":")[1].slice(0, 8)}`,
          activityMonitoring: {
            enabled: options.enableActivityMonitoring !== false && vectorDBActivityMonitoring,
            timeout: options.inactivityTimeout || vectorDBDefaultTimeout
          }
        };
      } catch (error) {
        console.error("Error creating vector index:", error);
        throw error;
      }
    },

    listVectorIndices(context: {user: any, ws: string}) {
      console.log(`Listing vector indices for namespace: ${context.ws}`);
      const indices = vectorDBManager.listInstances(context.ws);
      return indices.map(index => {
        const instance = vectorDBManager.getInstance(index.id);
        const lastActivity = vectorDBManager.getLastActivityTime(index.id);
        const timeUntilOffload = vectorDBManager.getTimeUntilOffload(index.id);
        
        return {
          id: index.id,
          name: `VectorDB-${index.id.split(":")[1].slice(0, 8)}`,
          created: index.created.toISOString(),
          documentCount: index.documentCount,
          embeddingDimension: index.embeddingDimension,
          isFromOffload: instance?.isFromOffload || false,
          activityMonitoring: {
            lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
            timeUntilOffload: timeUntilOffload,
            inactivityTimeout: vectorDBManager.getInactivityTimeout(index.id)
          }
        };
      });
    },

    async destroyVectorIndex({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      console.log(`Attempting to destroy vector index: ${fullIndexId}`);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      // Clean up history
      vectorDBHistory.delete(fullIndexId);
      
      await vectorDBManager.destroyIndex(fullIndexId);
      console.log(`Vector index destroyed: ${fullIndexId}`);
      return { success: true };
    },

    getVectorIndexInfo({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      const lastActivity = vectorDBManager.getLastActivityTime(fullIndexId);
      const timeUntilOffload = vectorDBManager.getTimeUntilOffload(fullIndexId);
      
      return {
        id: fullIndexId,
        name: `VectorDB-${fullIndexId.split(":")[1].slice(0, 8)}`,
        created: index.created.toISOString(),
        documentCount: index.documentCount,
        embeddingDimension: index.embeddingDimension,
        isFromOffload: index.isFromOffload || false,
        history: vectorDBHistory.get(fullIndexId) || [],
        activityMonitoring: {
          lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
          timeUntilOffload: timeUntilOffload,
          inactivityTimeout: vectorDBManager.getInactivityTimeout(fullIndexId),
          enabled: index.options.enableActivityMonitoring !== false && vectorDBActivityMonitoring
        }
      };
    },

    async addDocuments({indexId, documents}: {indexId: string, documents: IDocument[]}, context: {user: any, ws: string}) {
      const fullIndexId = await ensureVectorIndexAccess(indexId, context.ws, vectorDBManager, "add");
      
      if (!documents || documents.length === 0) {
        throw new Error("No documents provided");
      }
      
      // Validate documents
      for (const doc of documents) {
        if (!doc.id) {
          throw new Error("Document must have an id");
        }
        if (!doc.text && !doc.vector) {
          throw new Error("Document must have either text or vector");
        }
      }
      
      await vectorDBManager.addDocuments(fullIndexId, documents, context.ws);
      
      console.log(`Added ${documents.length} documents to vector index ${fullIndexId}`);
      return { 
        success: true, 
        addedCount: documents.length,
        timestamp: new Date().toISOString()
      };
    },

    async queryVectorIndex({indexId, query, options}: {indexId: string, query: string | number[], options?: IQueryOptions}, context: {user: any, ws: string}) {
      const fullIndexId = await ensureVectorIndexAccess(indexId, context.ws, vectorDBManager, "read");
      
      if (!query) {
        throw new Error("No query provided");
      }
      
      const queryOptions = {
        k: 10,
        threshold: 0,
        includeMetadata: true,
        ...options
      };
      
      const results = await vectorDBManager.queryIndex(fullIndexId, query, queryOptions, context.ws);
      
      // Add to query history
      const queryId = crypto.randomUUID();
      const history = vectorDBHistory.get(fullIndexId) || [];
      history.push({
        id: queryId,
        query,
        results,
        timestamp: new Date()
      });
      vectorDBHistory.set(fullIndexId, history);
      
      console.log(`Query executed on vector index ${fullIndexId}, returned ${results.length} results`);
      return {
        queryId,
        results,
        resultCount: results.length,
        timestamp: new Date().toISOString()
      };
    },

    async removeDocuments({indexId, documentIds}: {indexId: string, documentIds: string[]}, context: {user: any, ws: string}) {
      const fullIndexId = await ensureVectorIndexAccess(indexId, context.ws, vectorDBManager, "remove");
      
      if (!documentIds || documentIds.length === 0) {
        throw new Error("No document IDs provided");
      }
      
      await vectorDBManager.removeDocuments(fullIndexId, documentIds, context.ws);
      
      console.log(`Removed ${documentIds.length} documents from vector index ${fullIndexId}`);
      return { 
        success: true, 
        removedCount: documentIds.length,
        timestamp: new Date().toISOString()
      };
    },

    getVectorDBStats(context: {user: any, ws: string}) {
      // Get overall stats
      const overallStats = vectorDBManager.getStats();
      
      // Get namespace-specific stats
      const namespaceIndices = vectorDBManager.listInstances(context.ws);
      const namespaceStats = {
        totalIndices: namespaceIndices.length,
        totalDocuments: namespaceIndices.reduce((sum, index) => sum + index.documentCount, 0)
      };
      
      return {
        overall: overallStats,
        namespace: namespaceStats,
        indices: namespaceIndices.map(index => {
          const lastActivity = vectorDBManager.getLastActivityTime(index.id);
          const timeUntilOffload = vectorDBManager.getTimeUntilOffload(index.id);
          
          return {
            id: index.id,
            name: `VectorDB-${index.id.split(":")[1].slice(0, 8)}`,
            documentCount: index.documentCount,
            embeddingDimension: index.embeddingDimension,
            created: index.created.toISOString(),
            activityMonitoring: {
              lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
              timeUntilOffload: timeUntilOffload
            }
          };
        })
      };
    },

    async pingVectorIndex({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      // Ping the index to reset activity timer
      const success = vectorDBManager.pingInstance(fullIndexId);
      
      if (!success) {
        throw new Error("Failed to ping vector index");
      }
      
      return { 
        success: true, 
        message: "Vector index activity timer reset",
        timestamp: new Date().toISOString()
      };
    },

    async setVectorIndexTimeout({indexId, timeout}: {indexId: string, timeout: number}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      // Set the timeout
      const success = vectorDBManager.setInactivityTimeout(fullIndexId, timeout);
      
      if (!success) {
        throw new Error("Failed to set inactivity timeout");
      }
      
      return { 
        success: true, 
        message: `Inactivity timeout set to ${timeout}ms`,
        timeout: timeout,
        timestamp: new Date().toISOString()
      };
    },

    async manualOffloadVectorIndex({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      // Manually offload the index
      await vectorDBManager.manualOffload(fullIndexId);
      
      console.log(`Vector index ${fullIndexId} manually offloaded by user in workspace ${context.ws}`);
      return { 
        success: true, 
        message: "Vector index offloaded successfully",
        timestamp: new Date().toISOString()
      };
    },

    async saveVectorIndex({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      // Save the index to disk (keeping it in memory)
      await vectorDBManager.saveIndex(fullIndexId);
      
      console.log(`Vector index ${fullIndexId} saved by user in workspace ${context.ws}`);
      return { 
        success: true, 
        message: "Vector index saved successfully",
        timestamp: new Date().toISOString()
      };
    },

    async listOffloadedVectorIndices(context: {user: any, ws: string}) {
      console.log(`Listing offloaded vector indices for namespace: ${context.ws}`);
      const offloadedIndices = await vectorDBManager.listOffloadedIndices(context.ws);
      
      return offloadedIndices.map(index => ({
        id: index.id,
        name: `VectorDB-${index.id.split(":")[1].slice(0, 8)}`,
        created: index.created.toISOString(),
        offloadedAt: index.offloadedAt.toISOString(),
        documentCount: index.documentCount,
        embeddingDimension: index.embeddingDimension
      }));
    },

    async deleteOffloadedVectorIndex({indexId}: {indexId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Delete the offloaded index
      await vectorDBManager.deleteOffloadedIndex(fullIndexId);
      
      console.log(`Offloaded vector index ${fullIndexId} deleted by user in workspace ${context.ws}`);
      return { 
        success: true, 
        message: "Offloaded vector index deleted successfully",
        timestamp: new Date().toISOString()
      };
    },

    // ===== EMBEDDING PROVIDER MANAGEMENT METHODS =====

    listEmbeddingProviders(context: {user: any, ws: string}) {
      console.log(`Listing embedding providers for workspace: ${context.ws}`);
      
      const providers = vectorDBManager.listEmbeddingProviders();
      const stats = vectorDBManager.getEmbeddingProviderStats();
      
      return {
        providers: providers.map(entry => ({
          id: entry.id,
          name: entry.provider.name,
          type: entry.provider.type,
          dimension: entry.provider.dimension,
          created: entry.created.toISOString(),
          lastUsed: entry.lastUsed?.toISOString()
        })),
        stats: {
          totalProviders: stats.totalProviders,
          providersByType: stats.providersByType,
          providersInUse: stats.providersInUse
        }
      };
    },

    getEmbeddingProvider({providerId}: {providerId: string}, context: {user: any, ws: string}) {
      console.log(`Getting embedding provider details: ${providerId} for workspace: ${context.ws}`);
      
      const providerEntry = vectorDBManager.getEmbeddingProvider(providerId);
      if (!providerEntry) {
        throw new Error(`Embedding provider ${providerId} not found`);
      }

      // Count instances using this provider in the user's workspace
      const instances = vectorDBManager.listInstances(context.ws);
      const instancesUsingProvider = instances.filter(instance => {
        const instanceObj = vectorDBManager.getInstance(instance.id);
        return instanceObj?.options.embeddingProviderName === providerId;
      });

      return {
        id: providerEntry.id,
        name: providerEntry.provider.name,
        type: providerEntry.provider.type,
        dimension: providerEntry.provider.dimension,
        created: providerEntry.created.toISOString(),
        lastUsed: providerEntry.lastUsed?.toISOString(),
        instancesUsing: instancesUsingProvider.length,
        instanceIds: instancesUsingProvider.map(i => i.id)
      };
    },

    async addEmbeddingProvider({name, type, config}: {
      name: string, 
      type: string, 
      config: {host?: string, model?: string, dimension?: number}
    }, context: {user: any, ws: string}) {
      console.log(`Adding embedding provider: ${name} (${type}) for workspace: ${context.ws}`);
      
      if (!name || !type || !config) {
        throw new Error("Name, type, and config are required");
      }

      if (type === "ollama") {
        const { host, model, dimension } = config;
        if (!host || !model || !dimension) {
          throw new Error("Ollama provider requires host, model, and dimension");
        }

        try {
          const provider = createOllamaEmbeddingProvider(name, host, model, dimension);
          const success = vectorDBManager.addEmbeddingProvider(name, provider);

          if (!success) {
            throw new Error("Provider with this name already exists");
          }

          console.log(`✅ Added Ollama provider: ${name}`);
          return {
            success: true,
            message: `Ollama provider ${name} added successfully`,
            provider: {
              name,
              type: provider.type,
              dimension: provider.dimension,
              model,
              host
            },
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error(`Failed to create Ollama provider: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        throw new Error(`Unsupported provider type: ${type}`);
      }
    },

    async removeEmbeddingProvider({providerId}: {providerId: string}, context: {user: any, ws: string}) {
      console.log(`Removing embedding provider: ${providerId} for workspace: ${context.ws}`);
      
      const success = vectorDBManager.removeEmbeddingProvider(providerId);
      
      if (!success) {
        throw new Error("Provider not found");
      }
      
      console.log(`✅ Removed embedding provider: ${providerId}`);
      return {
        success: true,
        message: `Provider ${providerId} removed successfully`,
        timestamp: new Date().toISOString()
      };
    },

    async updateEmbeddingProvider({providerId, type, config}: {
      providerId: string,
      type: string,
      config: {host?: string, model?: string, dimension?: number}
    }, context: {user: any, ws: string}) {
      console.log(`Updating embedding provider: ${providerId} for workspace: ${context.ws}`);
      
      if (!type || !config) {
        throw new Error("Type and config are required");
      }

      if (type === "ollama") {
        const { host, model, dimension } = config;
        if (!host || !model || !dimension) {
          throw new Error("Ollama provider requires host, model, and dimension");
        }

        try {
          const provider = createOllamaEmbeddingProvider(providerId, host, model, dimension);
          const success = vectorDBManager.updateEmbeddingProvider(providerId, provider);

          if (!success) {
            throw new Error("Provider not found");
          }

          console.log(`✅ Updated Ollama provider: ${providerId}`);
          return {
            success: true,
            message: `Provider ${providerId} updated successfully`,
            provider: {
              name: providerId,
              type: provider.type,
              dimension: provider.dimension,
              model,
              host
            },
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error(`Failed to update Ollama provider: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        throw new Error(`Unsupported provider type: ${type}`);
      }
    },

    async testEmbeddingProvider({providerId}: {providerId: string}, context: {user: any, ws: string}) {
      console.log(`Testing embedding provider: ${providerId} for workspace: ${context.ws}`);
      
      const providerEntry = vectorDBManager.getEmbeddingProvider(providerId);
      if (!providerEntry) {
        throw new Error(`Embedding provider ${providerId} not found`);
      }

      try {
        const testEmbedding = await providerEntry.provider.embed("test");
        
        console.log(`✅ Provider ${providerId} test successful`);
        return {
          available: true,
          message: "Provider is working correctly",
          provider: providerId,
          dimension: providerEntry.provider.dimension,
          testEmbeddingLength: testEmbedding.length,
          timestamp: new Date().toISOString()
        };
      } catch (error) {
        console.log(`❌ Provider ${providerId} test failed:`, error);
        return {
          available: false,
          message: error instanceof Error ? error.message : String(error),
          provider: providerId,
          timestamp: new Date().toISOString()
        };
      }
    },

    async changeIndexEmbeddingProvider({indexId, providerId}: {indexId: string, providerId: string}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      console.log(`Changing embedding provider for index ${fullIndexId} to ${providerId}`);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }

      // Change the provider
      await vectorDBManager.changeIndexEmbeddingProvider(fullIndexId, providerId);
      
      console.log(`✅ Changed embedding provider for index ${fullIndexId} to ${providerId}`);
      return {
        success: true,
        message: `Embedding provider changed to ${providerId}`,
        indexId: fullIndexId,
        providerId,
        timestamp: new Date().toISOString()
      };
    },

    getEmbeddingProviderStats(context: {user: any, ws: string}) {
      console.log(`Getting embedding provider statistics for workspace: ${context.ws}`);
      
      const stats = vectorDBManager.getEmbeddingProviderStats();
      
      // Filter usage stats to only show providers used in this workspace
      const workspaceInstances = vectorDBManager.listInstances(context.ws);
      const workspaceProviderUsage = stats.providerUsage.map(provider => {
        const instancesInWorkspace = workspaceInstances.filter(instance => {
          const instanceObj = vectorDBManager.getInstance(instance.id);
          return instanceObj?.options.embeddingProviderName === provider.id;
        }).length;

        return {
          ...provider,
          instancesInWorkspace
        };
      });

      return {
        global: stats,
        workspace: {
          totalInstances: workspaceInstances.length,
          providerUsage: workspaceProviderUsage
        }
      };
    },

    // ===== AGENT MANAGEMENT METHODS =====

    listAgents(context: {user: any, ws: string}) {
      console.log(`Listing agents for workspace: ${context.ws}`);
      try {
        const agents = agentManager.listAgents(context.ws);
        return agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          kernelType: agent.kernel_type,
          hasKernel: agent.hasKernel,
          created: agent.created.toISOString(),
          conversationLength: agent.conversationLength,
          namespace: agent.namespace
        }));
      } catch (error) {
        console.error("Error listing agents:", error);
        throw error;
      }
    },

    agentExists({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      console.log(`Checking if agent exists: ${agentId} for workspace: ${context.ws}`);
      try {
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const exists = agentManager.agentExists(validAgentId);
        return { exists };
      } catch (error) {
        // If the error is due to access denied (namespace mismatch), return false
        if (error instanceof Error && error.message.includes('Access denied')) {
          console.log(`Agent ${agentId} not accessible in workspace ${context.ws}`);
          return { exists: false };
        }
        // For other errors, still throw
        console.error("Error checking agent existence:", error);
        throw error;
      }
    },

    getAgentStats(context: {user: any, ws: string}) {
      console.log(`Getting agent statistics for workspace: ${context.ws}`);
      try {
        const stats = agentManager.getStats();
        return stats;
      } catch (error) {
        console.error("Error getting agent stats:", error);
        throw error;
      }
    },

    async createAgent(options: {
      id?: string,
      name?: string,
      description?: string,
      instructions?: string,
      startupScript?: string,
      kernelType?: string,
      kernelEnvirons?: Record<string, string>,
      maxSteps?: number,
      ModelSettings?: any,
      autoAttachKernel?: boolean
    }, context: {user: any, ws: string}) {
      try {
        console.log(`Creating agent for workspace: ${context.ws}`);
        
        // Convert kernelType string to enum value
        let kernelType: KernelType | undefined;
        if (options.kernelType && typeof options.kernelType === 'string') {
          const kernelTypeKey = options.kernelType.toUpperCase() as keyof typeof KernelType;
          if (kernelTypeKey in KernelType) {
            kernelType = KernelType[kernelTypeKey];
            console.log(`✅ Converted kernelType "${options.kernelType}" to ${kernelType}`);
          } else {
            console.warn(`⚠️ Invalid kernelType: ${options.kernelType}`);
          }
        }
        
        const config: IAgentConfig = {
          id: options.id || crypto.randomUUID(),
          name: options.name || "New Agent",
          description: options.description || "",
          instructions: options.instructions || "You are a helpful assistant.",
          startupScript: options.startupScript && options.startupScript.trim() ? options.startupScript : undefined,
          kernelType: kernelType,
          kernelEnvirons: options.kernelEnvirons,
          maxSteps: options.maxSteps,
          ModelSettings: options.ModelSettings,
          autoAttachKernel: options.autoAttachKernel,
          namespace: context.ws
        };
        
        console.log(`🤖 Creating agent with config:`, {
          id: config.id,
          name: config.name,
          kernelType: config.kernelType,
          autoAttachKernel: config.autoAttachKernel,
          namespace: config.namespace,
          customModelSettings: !!config.ModelSettings
        });
        
        // Log which model settings will be used
        if (config.ModelSettings) {
          console.log(`🔧 Agent will use CUSTOM model settings:`, {
            model: config.ModelSettings.model,
            baseURL: config.ModelSettings.baseURL,
            temperature: config.ModelSettings.temperature
          });
        } else {
          console.log(`🔧 Agent will use DEFAULT model settings:`, {
            model: DEFAULT_AGENT_MODEL_SETTINGS.model,
            baseURL: DEFAULT_AGENT_MODEL_SETTINGS.baseURL,
            temperature: DEFAULT_AGENT_MODEL_SETTINGS.temperature
          });
        }
        
        let agentId: string;
        try {
          agentId = await agentManager.createAgent(config);
        } catch (error) {
          // If we hit the namespace limit, try cleaning up old agents
          if (error instanceof Error && error.message.includes('Maximum number of agents per namespace')) {
            console.log(`🧹 Namespace limit reached for ${context.ws}, cleaning up old agents...`);
            const cleanedUp = await agentManager.cleanupOldAgentsInNamespace(context.ws, 5);
            console.log(`🧹 Cleaned up ${cleanedUp} old agents in namespace ${context.ws}`);
            
            // Retry creating the agent
            agentId = await agentManager.createAgent(config);
          } else {
            throw error;
          }
        }
        const agent = agentManager.getAgent(agentId);
        
        // If auto-attach kernel is requested and we have a kernelType, attach it
        if (config.autoAttachKernel && config.kernelType) {
          try {
            console.log(`🔧 Auto-attaching ${config.kernelType} kernel to agent ${agentId}`);
            await agentManager.attachKernelToAgent(agentId, config.kernelType);
            console.log(`✅ Kernel attached successfully to agent ${agentId}`);
          } catch (kernelError) {
            console.error(`❌ Failed to auto-attach kernel to agent ${agentId}:`, kernelError);
            // Don't fail the agent creation, just log the error
          }
        }
        
        // Get updated agent info after potential kernel attachment
        const updatedAgent = agentManager.getAgent(agentId);
        
        // Extract base ID from namespaced ID for consistency with listAgents
        const namespaceMatch = agentId.match(/^([^:]+):/);
        const baseAgentId = namespaceMatch ? agentId.substring(namespaceMatch[1].length + 1) : agentId;
        
        return {
          id: baseAgentId, // Return base ID for consistency with listAgents
          name: updatedAgent?.name,
          description: updatedAgent?.description,
          instructions: updatedAgent?.instructions,
          startupScript: updatedAgent?.startupScript,
          kernelType: updatedAgent?.kernelType,
          hasKernel: !!updatedAgent?.kernel,
          hasStartupError: !!updatedAgent?.getStartupError(),
          startupError: updatedAgent?.getStartupError() ? {
            message: updatedAgent.getStartupError()!.message,
            fullError: updatedAgent.getStartupError()!.fullError,
            stackTrace: updatedAgent.getStartupError()!.stackTrace
          } : undefined,
          created: updatedAgent?.created.toISOString(),
          maxSteps: updatedAgent?.maxSteps
        };
      } catch (error) {
        console.error("Error creating agent:", error);
        throw error;
      }
    },

    getAgentInfo({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      console.log(`Getting agent info: ${agentId} for workspace: ${context.ws}`);
      try {
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const agent = agentManager.getAgent(validAgentId);
         
        if (!agent) {
          throw new Error("Agent not found");
        }
         
         // Extract base ID from namespaced ID for consistency with listAgents
         const namespaceMatch = validAgentId.match(/^([^:]+):/);
         const baseAgentId = namespaceMatch ? validAgentId.substring(namespaceMatch[1].length + 1) : validAgentId;
         
         return {
           id: baseAgentId, // Return base ID for consistency with listAgents
           name: agent.name,
           description: agent.description,
           instructions: agent.instructions,
           startupScript: agent.startupScript,
           kernelType: agent.kernelType,
           hasKernel: !!agent.kernel,
           hasStartupError: !!agent.getStartupError(),
           startupError: agent.getStartupError() ? {
             message: agent.getStartupError()!.message,
             fullError: agent.getStartupError()!.fullError,
             stackTrace: agent.getStartupError()!.stackTrace
           } : undefined,
           maxSteps: agent.maxSteps,
           created: agent.created.toISOString(),
           conversationLength: agent.conversationHistory.length,
           ModelSettings: agent.ModelSettings
         };
      } catch (error) {
        console.error("Error getting agent info:", error);
        throw error;
      }
    },

    async updateAgent({agentId, name, description, instructions, startupScript, kernelType, maxSteps, ModelSettings}: {
      agentId: string,
      name?: string,
      description?: string,
      instructions?: string,
      startupScript?: string,
      kernelType?: string,
      maxSteps?: number,
      ModelSettings?: any
    }, context: {user: any, ws: string}) {
      try {
        console.log(`Updating agent: ${agentId} for workspace: ${context.ws}`);
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        
        // Convert kernelType string to enum value if provided
        let kernelTypeEnum: KernelType | undefined;
        if (kernelType) {
          kernelTypeEnum = KernelType[kernelType as keyof typeof KernelType];
        }
        
        await agentManager.updateAgent(validAgentId, {
          name,
          description,
          instructions,
          startupScript: startupScript && startupScript.trim() ? startupScript : undefined,
          kernelType: kernelTypeEnum,
          maxSteps,
          ModelSettings
        });
        
        const agent = agentManager.getAgent(validAgentId);
        return {
          success: true,
          message: "Agent updated successfully",
          agent: {
            id: agent?.id,
            name: agent?.name,
            description: agent?.description,
            instructions: agent?.instructions,
            startupScript: agent?.startupScript,
            kernelType: agent?.kernelType,
            hasKernel: !!agent?.kernel,
            hasStartupError: !!agent?.getStartupError(),
            startupError: agent?.getStartupError() ? {
              message: agent.getStartupError()!.message,
              fullError: agent.getStartupError()!.fullError,
              stackTrace: agent.getStartupError()!.stackTrace
            } : undefined
          }
        };
      } catch (error) {
        console.error("Error updating agent:", error);
        throw error;
      }
    },

    async destroyAgent({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      try {
        console.log(`Destroying agent: ${agentId} for workspace: ${context.ws}`);
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        await agentManager.destroyAgent(validAgentId);
        
        return {
          success: true,
          message: `Agent ${agentId} deleted successfully`
        };
      } catch (error) {
        console.error("Error destroying agent:", error);
        throw error;
      }
    },

    async *chatWithAgent({agentId, message}: {agentId: string, message: string}, context: {user: any, ws: string}) {
      try {
        console.log(`Starting chat with agent: ${agentId} for workspace: ${context.ws}`);
        console.log(`🔍 [Agent ${agentId}] Current query:`, message);
        
        if (!message) {
          throw new Error("Message is required");
        }
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const agent = agentManager.getAgent(validAgentId);
        if (!agent) {
          throw new Error("Agent not found");
        }
        
        // Create messages for this chat completion - include conversation history and new message
        const newUserMessage = { role: "user" as const, content: message };
        
        // Always include the new message in the context for the agent
        const messages = [...agent.conversationHistory, newUserMessage];
        
        try {
          let hasYieldedResponse = false;
          
          // Start chat completion stream
          for await (const chunk of agent.chatCompletion(messages)) {
            hasYieldedResponse = true;
            yield chunk;
            
            // If there's an error, break the stream
            if (chunk.type === 'error') {
              break;
            }
          }
          
          // If no response was yielded, it means the agent completed without any output
          // This shouldn't happen with our fix to agent.ts, but just in case
          if (!hasYieldedResponse) {
            yield {
              type: "error",
              error: "Agent completed without generating any response"
            };
          }
          
        } catch (error) {
          console.error(`Error in agent chat completion:`, error);
          yield {
            type: "error",
            error: error instanceof Error ? error.message : String(error)
          };
        }
      } catch (error) {
        console.error(`Error in chatWithAgent:`, error);
        yield {
          type: "error", 
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    getAgentConversation({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      console.log(`Getting conversation for agent: ${agentId} for workspace: ${context.ws}`);
      try {
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const agent = agentManager.getAgent(validAgentId);
        
        if (!agent) {
          throw new Error("Agent not found");
        }
        
        return {
          conversation: agent.conversationHistory,
          length: agent.conversationHistory.length
        };
      } catch (error) {
        console.error("Error getting agent conversation:", error);
        throw error;
      }
    },

    async clearAgentConversation({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      try {
        console.log(`Clearing conversation for agent: ${agentId} for workspace: ${context.ws}`);
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        await agentManager.clearConversation(validAgentId);
        
        return {
          success: true,
          message: "Conversation cleared successfully"
        };
      } catch (error) {
        console.error("Error clearing agent conversation:", error);
        throw error;
      }
    },

    async setAgentConversationHistory({agentId, messages}: {agentId: string, messages: ChatMessage[]}, context: {user: any, ws: string}) {
      try {
        console.log(`Setting conversation history for agent: ${agentId} for workspace: ${context.ws}`);
        
        if (!messages || !Array.isArray(messages)) {
          throw new Error("Messages must be an array");
        }
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        await agentManager.setConversationHistory(validAgentId, messages);
        
        return {
          success: true,
          message: `Conversation history set with ${messages.length} messages`,
          messageCount: messages.length
        };
      } catch (error) {
        console.error("Error setting agent conversation history:", error);
        throw error;
      }
    },

    async attachKernelToAgent({agentId, kernelType}: {agentId: string, kernelType?: string}, context: {user: any, ws: string}) {
      try {
        console.log(`Attaching kernel to agent: ${agentId} for workspace: ${context.ws}`);
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const kernelTypeEnum = kernelType ? KernelType[kernelType as keyof typeof KernelType] : KernelType.PYTHON;
        
        await agentManager.attachKernelToAgent(validAgentId, kernelTypeEnum);
        
        const agent = agentManager.getAgent(validAgentId);
        return {
          success: true,
          message: "Kernel attached successfully",
          hasKernel: !!agent?.kernel,
          kernelType: agent?.kernelType
        };
      } catch (error) {
        console.error("Error attaching kernel to agent:", error);
        throw error;
      }
    },

    async detachKernelFromAgent({agentId}: {agentId: string}, context: {user: any, ws: string}) {
      try {
        console.log(`Detaching kernel from agent: ${agentId} for workspace: ${context.ws}`);
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        await agentManager.detachKernelFromAgent(validAgentId);
        
        return {
          success: true,
          message: "Kernel detached successfully"
        };
      } catch (error) {
        console.error("Error detaching kernel from agent:", error);
        throw error;
      }
    },

    // ===== ADDITIONAL VECTOR DATABASE METHODS =====

    generateRandomDocuments({count}: {count?: number}, context: {user: any, ws: string}) {
      try {
        console.log(`Generating random documents for workspace: ${context.ws}`);
        const docCount = Math.min(count || 10, 100); // Limit to 100 documents
        
        const topics = [
          "artificial intelligence and machine learning algorithms",
          "web development with modern JavaScript frameworks",
          "data science and statistical analysis techniques", 
          "cloud computing and distributed systems architecture",
          "mobile application development for iOS and Android",
          "cybersecurity threats and protection strategies",
          "blockchain technology and cryptocurrency systems",
          "internet of things devices and sensor networks",
          "virtual reality gaming and immersive experiences",
          "robotics automation and industrial applications",
          "quantum computing and advanced physics research",
          "renewable energy and sustainable technology solutions",
          "biotechnology and genetic engineering breakthroughs",
          "space exploration and astronomical discoveries",
          "environmental science and climate change research"
        ];
        
        const documents: IDocument[] = [];
        
        for (let i = 0; i < docCount; i++) {
          const topic = topics[i % topics.length];
          const randomSuffix = Math.random().toString(36).substring(7);
          const randomNumber = Math.floor(Math.random() * 1000);
          
          documents.push({
            id: `doc-${Date.now()}-${i}-${randomSuffix}`,
            text: `${topic} - Document ${randomNumber} discussing advanced concepts and practical applications in this field. This content includes detailed analysis and research findings with unique identifier ${randomSuffix}.`,
            metadata: {
              topic: topic.split(" ")[0],
              category: i % 3 === 0 ? "research" : i % 3 === 1 ? "tutorial" : "analysis",
              priority: Math.floor(Math.random() * 5) + 1,
              created: new Date().toISOString(),
              randomId: randomSuffix
            }
          });
        }
        
        return {
          documents,
          count: documents.length,
          message: `Generated ${documents.length} random documents`
        };
      } catch (error) {
        console.error("Error generating random documents:", error);
        throw error;
      }
    },

    async *chatWithAgentStateless({agentId, messages}: {agentId: string, messages: ChatMessage[]}, context: {user: any, ws: string}) {
      try {
        console.log(`Starting stateless chat with agent: ${agentId} for workspace: ${context.ws}`);
        
        if (!messages || messages.length === 0) {
          throw new Error("Messages array is required and cannot be empty");
        }
        
        const validAgentId = ensureAgentAccess(agentId, context.ws);
        const agent = agentManager.getAgent(validAgentId);
        if (!agent) {
          throw new Error("Agent not found");
        }
        // print the current query:
        console.log(`🔍 [Agent ${agentId}] Current query:`, messages[messages.length - 1].content); 

        try {
          let hasYieldedResponse = false;
          
          // Start stateless chat completion stream
          for await (const chunk of agent.statelessChatCompletion(messages)) {
            hasYieldedResponse = true;
            yield chunk;
            
            // If there's an error, break the stream
            if (chunk.type === 'error') {
              break;
            }
          }
          
          // If no response was yielded, it means the agent completed without any output
          if (!hasYieldedResponse) {
            yield {
              type: "error",
              error: "Agent completed without generating any response"
            };
          }
          
        } catch (error) {
          console.error(`Error in agent stateless chat completion:`, error);
          yield {
            type: "error",
            error: error instanceof Error ? error.message : String(error)
          };
        }
      } catch (error) {
        console.error(`Error in chatWithAgentStateless:`, error);
        yield {
          type: "error", 
          error: error instanceof Error ? error.message : String(error)
        };
      }
    },

    // ===== DENO APP MANAGEMENT METHODS =====

    async notifyAppUpdates(context: {user: any, ws: string}) {
      try {
        // Check permission - only hypha-agents workspace can manage apps
        if (context.ws !== "hypha-agents") {
          throw new Error(`Permission denied: Only hypha-agents workspace can manage deno-apps. Current workspace: ${context.ws}`);
        }
        
        console.log("🔄 Checking for deno-app updates...");
        
        // Get the artifact manager service
        const artifactManager = await server.getService('public/artifact-manager');
        
        // List all artifacts with type 'deno-app' from 'hypha-agents/agents'
        const artifacts = await artifactManager.list({
          parent_id: "hypha-agents/agents",
          filters: { type: 'deno-app' },
          limit: 100,
          _rkwargs: true
        });
        
        console.log(`📦 Found ${artifacts.length} deno-app artifacts`);
        
        const results = {
          totalApps: artifacts.length,
          skippedApps: [] as string[],
          startedApps: [] as string[],
          failedApps: [] as {id: string, error: string}[]
        };
        
        for (const artifact of artifacts) {
          try {
            const appKernelId = `deno-apps:${artifact.id}`;
            
            // Check if kernel already exists
            const existingKernel = kernelManager.getKernel(appKernelId);
            if (existingKernel) {
              console.log(`⏭️  Skipping ${artifact.id}: Kernel already running`);
              results.skippedApps.push(artifact.id);
              continue;
            }
            
            console.log(`🚀 Starting new deno-app: ${artifact.id} (${artifact.name})`);
            
            // Read the artifact to get the manifest
            const artifactData = await artifactManager.read(artifact.id);
            
            if (!artifactData.manifest || !artifactData.manifest.startup_script) {
              console.log(`⚠️  Skipping ${artifact.id}: No startup script found`);
              results.failedApps.push({
                id: artifact.id,
                error: "No startup script found"
              });
              continue;
            }
            
            const startupScript = artifactData.manifest.startup_script;
            console.log(`📝 Startup script length: ${startupScript.length} characters`);
            
            // Determine kernel language from manifest.lang field
            let kernelLanguage = KernelLanguage.PYTHON; // Default to Python
            if (artifactData.manifest.lang) {
              switch (artifactData.manifest.lang.toLowerCase()) {
                case 'typescript':
                case 'ts':
                  kernelLanguage = KernelLanguage.TYPESCRIPT;
                  break;
                case 'javascript':
                case 'js':
                  kernelLanguage = KernelLanguage.JAVASCRIPT;
                  break;
                case 'python':
                case 'py':
                default:
                  kernelLanguage = KernelLanguage.PYTHON;
                  break;
              }
            }
            
            console.log(`🔧 Creating ${artifactData.manifest.lang || 'python'} kernel for app ${artifact.id}`);
            
            // Create a kernel with the artifact ID as kernel ID
            const kernelId = await kernelManager.createKernel({
              id: artifact.id,
              mode: KernelMode.WORKER,
              lang: kernelLanguage,
              namespace: "deno-apps", // Use a special namespace for deno apps
              inactivityTimeout: 1000 * 60 * 60 * 24, // 24 hours - apps should run long
              maxExecutionTime: 1000 * 60 * 60 * 24 * 365 // 1 year - essentially unlimited
            });
            
            console.log(`🔧 Created kernel ${kernelId} for app ${artifact.id}`);
            
            // Execute the startup script
            console.log(`▶️  Executing startup script for ${artifact.id}...`);
            
            let hasOutput = false;
            for await (const output of kernelManager.executeStream(kernelId, startupScript)) {
              hasOutput = true;
              console.log(`📤 [${artifact.id}] Output:`, output);
              
              // If there's an error, log it but continue with other apps
              if (output.type === 'error') {
                console.error(`❌ [${artifact.id}] Execution error:`, output);
              }
            }
            
            if (!hasOutput) {
              console.log(`✅ [${artifact.id}] Startup script executed (no output)`);
            } else {
              console.log(`✅ [${artifact.id}] Startup script completed`);
            }
            
            results.startedApps.push(artifact.id);
            
          } catch (error) {
            console.error(`❌ Failed to start deno-app ${artifact.id}:`, error);
            results.failedApps.push({
              id: artifact.id,
              error: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
        }
        
        console.log(`🎉 App update check completed. Started: ${results.startedApps.length}, Skipped: ${results.skippedApps.length}, Failed: ${results.failedApps.length}`);
        
        return {
          success: true,
          message: `App update check completed`,
          results,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error("❌ Failed to check for app updates:", error);
        throw error;
      }
    },

    async reloadApp({appId}: {appId: string}, context: {user: any, ws: string}) {
      try {
        // Check permission - only hypha-agents workspace can manage apps
        if (context.ws !== "hypha-agents") {
          throw new Error(`Permission denied: Only hypha-agents workspace can reload deno-apps. Current workspace: ${context.ws}`);
        }
        
        console.log(`🔄 Reloading deno-app: ${appId}`);
        
        const appKernelId = `deno-apps:${appId}`;
        
        // Check if kernel exists
        const existingKernel = kernelManager.getKernel(appKernelId);
        if (!existingKernel) {
          throw new Error(`App ${appId} is not currently running (kernel not found)`);
        }
        
        console.log(`🔧 Restarting kernel for app ${appId}`);
        
        // Restart the kernel to clear any stuck or dead state
        const success = await kernelManager.restartKernel(appKernelId);
        
        if (!success) {
          throw new Error(`Failed to restart kernel for app ${appId}`);
        }
        
        console.log(`✅ Successfully reloaded app ${appId}`);
        
        return {
          success: true,
          message: `App ${appId} reloaded successfully`,
          appId,
          kernelId: appKernelId,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Failed to reload app ${appId}:`, error);
        throw error;
      }
    },

    async listApps(context: {user: any, ws: string}) {
      try {
        console.log("📋 Listing all deno-apps...");
        
        // Get all kernels in the deno-apps namespace using proper namespace filtering
        const appKernelList = kernelManager.listKernels("deno-apps");
        
        console.log(`Found ${appKernelList.length} app kernels in deno-apps namespace`);
        
        const apps = [];
        
        // Try to get artifact manager to fetch app metadata
        let artifactManager = null;
        try {
          artifactManager = await server.getService('public/artifact-manager');
        } catch (error) {
          console.warn("⚠️ Could not access artifact manager for app metadata:", error);
        }
        
        for (const kernelInfo of appKernelList) {
          try {
            const kernel = kernelManager.getKernel(kernelInfo.id);
            if (!kernel) continue;
            
            // Extract app ID from kernel ID (format: deno-apps:appId)
            const appId = kernelInfo.id.split(':')[1];
            
            let appName = appId;
            let appDescription = "";
            
            // Try to get metadata from artifact manager
            if (artifactManager) {
              try {
                const artifactData = await artifactManager.read(appId);
                if (artifactData && artifactData.manifest) {
                  appName = artifactData.manifest.name || artifactData.name || appId;
                  appDescription = artifactData.manifest.description || artifactData.description || "";
                }
              } catch (error) {
                console.warn(`⚠️ Could not get metadata for app ${appId}:`, error);
                // Continue with default values
              }
            }
            
            // Determine kernel status
            let status = "unknown";
            try {
              const execInfo = kernelManager.getExecutionInfo(kernelInfo.id);
              if (execInfo.isStuck) {
                status = "stuck";
              } else if (execInfo.count > 0) {
                status = "executing";
              } else {
                status = "idle";
              }
            } catch (error) {
              console.warn(`⚠️ Could not get execution info for ${kernelInfo.id}:`, error);
              status = "error";
            }
            
            apps.push({
              id: appId,
              name: appName,
              description: appDescription,
              status: status,
              kernelId: kernelInfo.id,
              language: kernel.language,
              created: kernel.created ? kernel.created.toISOString() : new Date().toISOString()
            });
            
          } catch (error) {
            console.error(`❌ Error processing app kernel ${kernelInfo.id}:`, error);
            continue;
          }
        }
        
        console.log(`📋 Listed ${apps.length} deno-apps`);
        
        return {
          apps,
          totalCount: apps.length,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error("❌ Failed to list apps:", error);
        throw error;
      }
    },

    async killApp({appId}: {appId: string}, context: {user: any, ws: string}) {
      try {
        // Check permission - only hypha-agents workspace can kill apps
        if (context.ws !== "hypha-agents") {
          throw new Error(`Permission denied: Only hypha-agents workspace can kill deno-apps. Current workspace: ${context.ws}`);
        }
        
        console.log(`🔪 Killing deno-app: ${appId}`);
        
        const appKernelId = `deno-apps:${appId}`;
        
        // Check if kernel exists
        const existingKernel = kernelManager.getKernel(appKernelId);
        if (!existingKernel) {
          throw new Error(`App ${appId} is not currently running (kernel not found)`);
        }
        
        console.log(`🔧 Destroying kernel for app ${appId}`);
        
        // Clean up history
        kernelHistory.delete(appKernelId);
        
        // Destroy the kernel to stop the app
        await kernelManager.destroyKernel(appKernelId);
        
        console.log(`✅ Successfully killed app ${appId}`);
        
        return {
          success: true,
          message: `App ${appId} killed successfully`,
          appId,
          kernelId: appKernelId,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Failed to kill app ${appId}:`, error);
        throw error;
      }
    },

    async getAppStats(context: {user: any, ws: string}) {
      try {
        console.log("📊 Getting deno-app statistics...");
        
        // Get all kernels in the deno-apps namespace using proper namespace filtering
        const appKernelList = kernelManager.listKernels("deno-apps");
        
        const stats = {
          totalApps: appKernelList.length,
          runningApps: 0,
          idleApps: 0,
          executingApps: 0,
          stuckApps: 0,
          errorApps: 0,
          totalExecutions: 0,
          memoryUsage: 0,
          apps: [] as any[]
        };
        
        for (const kernelInfo of appKernelList) {
          try {
            const kernel = kernelManager.getKernel(kernelInfo.id);
            if (!kernel) {
              stats.errorApps++;
              continue;
            }
            
            stats.runningApps++;
            
            // Extract app ID from kernel ID (format: deno-apps:appId)
            const appId = kernelInfo.id.split(':')[1];
            
            let status = "unknown";
            let execInfo = { count: 0, isStuck: false };
            
            try {
              execInfo = kernelManager.getExecutionInfo(kernelInfo.id);
              if (execInfo.isStuck) {
                status = "stuck";
                stats.stuckApps++;
              } else if (execInfo.count > 0) {
                status = "executing";
                stats.executingApps++;
              } else {
                status = "idle";
                stats.idleApps++;
              }
              stats.totalExecutions += execInfo.count;
            } catch (error) {
              console.warn(`⚠️ Could not get execution info for ${kernelInfo.id}:`, error);
              status = "error";
              stats.errorApps++;
              stats.runningApps--; // Don't count error apps as running
            }
            
            // Get kernel history count
            const history = kernelHistory.get(kernelInfo.id) || [];
            
            stats.apps.push({
              id: appId,
              status: status,
              kernelId: kernelInfo.id,
              language: kernel.language,
              created: kernel.created ? kernel.created.toISOString() : new Date().toISOString(),
              activeExecutions: execInfo.count,
              isStuck: execInfo.isStuck,
              historyCount: history.length,
              uptime: kernel.created ? Date.now() - kernel.created.getTime() : 0
            });
            
          } catch (error) {
            console.error(`❌ Error processing app kernel ${kernelInfo.id}:`, error);
            stats.errorApps++;
            continue;
          }
        }
        
        // Calculate average memory usage per app
        const memoryUsage = Deno.memoryUsage();
        stats.memoryUsage = stats.runningApps > 0 ? Math.round(memoryUsage.heapUsed / stats.runningApps) : 0;
        
        console.log(`📊 App statistics: ${stats.totalApps} total, ${stats.runningApps} running, ${stats.idleApps} idle, ${stats.executingApps} executing, ${stats.stuckApps} stuck, ${stats.errorApps} error`);
        
        return {
          ...stats,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error("❌ Failed to get app statistics:", error);
        throw error;
      }
    },

    async getAppInfo({appId}: {appId: string}, context: {user: any, ws: string}) {
      try {
        console.log(`ℹ️ Getting info for deno-app: ${appId}`);
        
        const appKernelId = `deno-apps:${appId}`;
        
        // Check if kernel exists
        const kernel = kernelManager.getKernel(appKernelId);
        if (!kernel) {
          throw new Error(`App ${appId} is not currently running (kernel not found)`);
        }
        
        let appName = appId;
        let appDescription = "";
        let appManifest = null;
        
        // Try to get metadata from artifact manager
        try {
          const artifactManager = await server.getService('public/artifact-manager');
          const artifactData = await artifactManager.read(appId);
          if (artifactData && artifactData.manifest) {
            appName = artifactData.manifest.name || artifactData.name || appId;
            appDescription = artifactData.manifest.description || artifactData.description || "";
            appManifest = artifactData.manifest;
          }
        } catch (error) {
          console.warn(`⚠️ Could not get metadata for app ${appId}:`, error);
        }
        
        // Get kernel status and execution info
        let status = "unknown";
        let execInfo = { count: 0, isStuck: false };
        
        try {
          execInfo = kernelManager.getExecutionInfo(appKernelId);
          if (execInfo.isStuck) {
            status = "stuck";
          } else if (execInfo.count > 0) {
            status = "executing";
          } else {
            status = "idle";
          }
        } catch (error) {
          console.warn(`⚠️ Could not get execution info for ${appKernelId}:`, error);
          status = "error";
        }
        
        // Get execution history
        const history = kernelHistory.get(appKernelId) || [];
        
        // Calculate uptime
        const uptime = kernel.created ? Date.now() - kernel.created.getTime() : 0;
        
        const appInfo = {
          id: appId,
          name: appName,
          description: appDescription,
          status: status,
          kernelId: appKernelId,
          language: kernel.language,
          created: kernel.created ? kernel.created.toISOString() : new Date().toISOString(),
          uptime: uptime,
          uptimeFormatted: formatUptime(uptime / 1000),
          activeExecutions: execInfo.count,
          isStuck: execInfo.isStuck,
          historyCount: history.length,
          manifest: appManifest,
          mode: kernel.mode
        };
        
        console.log(`ℹ️ Retrieved info for app ${appId}: ${status}`);
        
        return {
          ...appInfo,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Failed to get app info for ${appId}:`, error);
        throw error;
      }
    },

    async executeInApp({appId, code}: {appId: string, code: string}, context: {user: any, ws: string}) {
      try {
        // Check permission - only hypha-agents workspace can execute code in apps
        if (context.ws !== "hypha-agents") {
          throw new Error(`Permission denied: Only hypha-agents workspace can execute code in deno-apps. Current workspace: ${context.ws}`);
        }
        
        console.log(`🔧 Executing code in deno-app: ${appId}`);
        
        if (!code) {
          throw new Error("No code provided");
        }
        
        const appKernelId = `deno-apps:${appId}`;
        
        // Check if kernel exists
        const kernel = kernelManager.getKernel(appKernelId);
        if (!kernel) {
          throw new Error(`App ${appId} is not currently running (kernel not found)`);
        }
        
        const executionId = crypto.randomUUID();
        
        // Execute in background and store result in history when complete
        (async () => {
          try {
            const outputs: unknown[] = [];
            for await (const output of kernelManager.executeStream(appKernelId, code)) {
              outputs.push(output);
            }
            
            // Add to kernel history after completion
            const history = kernelHistory.get(appKernelId) || [];
            history.push({
              id: executionId,
              script: code,
              outputs,
            });
            kernelHistory.set(appKernelId, history);
          } catch (error) {
            console.error(`Execution error for ${appKernelId}:`, error);
            // Still record the execution with error
            const history = kernelHistory.get(appKernelId) || [];
            history.push({
              id: executionId,
              script: code,
              outputs: [{
                type: "error",
                data: { message: error instanceof Error ? error.message : String(error) }
              }],
            });
            kernelHistory.set(appKernelId, history);
          }
        })();
        
        console.log(`🔧 Started code execution in app ${appId} with execution ID: ${executionId}`);
        
        return { 
          executionId,
          appId,
          message: "Code execution started",
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Failed to execute code in app ${appId}:`, error);
        throw error;
      }
    },

    async getAppKernelLogs({appId, lines}: {appId: string, lines?: number}, context: {user: any, ws: string}) {
      try {
        console.log(`📜 Getting kernel logs for app: ${appId}`);
        
        const appKernelId = `deno-apps:${appId}`;
        
        // Check if kernel exists
        const kernel = kernelManager.getKernel(appKernelId);
        if (!kernel) {
          throw new Error(`App ${appId} is not currently running (kernel not found)`);
        }
        
        // Get execution history for this kernel
        const history = kernelHistory.get(appKernelId) || [];
        const maxLines = Math.min(lines || 100, 1000); // Default 100 lines, max 1000
        
        console.log(`📜 Found ${history.length} execution entries in history for app ${appId}`);
        
        // Collect all outputs from execution history
        const allLogs = [];
        
        for (const execution of history) {
          // Add execution start log
          allLogs.push({
            timestamp: new Date().toISOString(),
            type: 'execution_start',
            content: `--- Execution ${execution.id} started ---\nScript: ${execution.script.substring(0, 200)}${execution.script.length > 200 ? '...' : ''}`,
            executionId: execution.id
          });
          
          for (const output of execution.outputs) {
            // Extract console output from different output types
            let logEntry = null;
            
            if (output && typeof output === 'object') {
              const outputObj = output as any;
              
              // Handle different output types
              if (outputObj.type === 'stream' && outputObj.data) {
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'stream',
                  stream: outputObj.data.name || 'stdout',
                  content: outputObj.data.text || outputObj.data.content || String(outputObj.data),
                  executionId: execution.id
                };
              } else if (outputObj.type === 'display_data' && outputObj.data) {
                // Handle display data (like print statements)
                const content = outputObj.data['text/plain'] || outputObj.data.content || String(outputObj.data);
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'display',
                  content: content,
                  executionId: execution.id
                };
              } else if (outputObj.type === 'execute_result' && outputObj.data) {
                // Handle execution results
                const content = outputObj.data['text/plain'] || outputObj.data.content || String(outputObj.data);
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'result',
                  content: content,
                  executionId: execution.id
                };
              } else if (outputObj.type === 'error') {
                // Handle errors
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'error',
                  content: outputObj.message || outputObj.error || String(outputObj),
                  executionId: execution.id
                };
              } else if (outputObj.message || outputObj.content) {
                // Generic message handling
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'message',
                  content: outputObj.message || outputObj.content,
                  executionId: execution.id
                };
              } else {
                // Handle any other output types by stringifying
                logEntry = {
                  timestamp: new Date().toISOString(),
                  type: 'raw_output',
                  content: JSON.stringify(outputObj, null, 2),
                  executionId: execution.id
                };
              }
            } else {
              // Handle primitive outputs
              logEntry = {
                timestamp: new Date().toISOString(),
                type: 'raw_output',
                content: String(output),
                executionId: execution.id
              };
            }
            
            if (logEntry) {
              allLogs.push(logEntry);
            }
          }
          
          // Add execution end log
          allLogs.push({
            timestamp: new Date().toISOString(),
            type: 'execution_end',
            content: `--- Execution ${execution.id} completed with ${execution.outputs.length} outputs ---`,
            executionId: execution.id
          });
        }
        
        // Also get current execution information from kernel manager
        try {
          const execInfo = kernelManager.getExecutionInfo(appKernelId);
          if (execInfo.count > 0) {
            allLogs.push({
              timestamp: new Date().toISOString(),
              type: 'current_executions',
              content: `--- Currently running ${execInfo.count} executions ---\nExecution IDs: ${execInfo.executionIds.join(', ')}\nLongest running: ${execInfo.longestRunningTime}ms`,
              executionId: 'current'
            });
            
            // Add details for each current execution
            for (const exec of execInfo.executions) {
              allLogs.push({
                timestamp: new Date().toISOString(),
                type: exec.isStuck ? 'stuck_execution' : 'active_execution',
                content: `Execution ${exec.id}: running for ${exec.runtime}ms${exec.isStuck ? ' (STUCK)' : ''}${exec.code ? `\nCode: ${exec.code.substring(0, 100)}${exec.code.length > 100 ? '...' : ''}` : ''}`,
                executionId: exec.id
              });
            }
          }
        } catch (error) {
          console.warn(`⚠️ Could not get current execution info for logs:`, error);
          allLogs.push({
            timestamp: new Date().toISOString(),
            type: 'error',
            content: `Failed to get current execution info: ${error instanceof Error ? error.message : String(error)}`,
            executionId: 'system'
          });
        }
        
        // Sort by timestamp and take the most recent entries
        allLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const recentLogs = allLogs.slice(0, maxLines);
        
        // Also get current kernel status for additional context
        let kernelStatus = "unknown";
        let currentExecution = null;
        
        try {
          const execInfo = kernelManager.getExecutionInfo(appKernelId);
          if (execInfo.isStuck) {
            kernelStatus = "stuck";
          } else if (execInfo.count > 0) {
            kernelStatus = "executing";
            currentExecution = {
              activeExecutions: execInfo.count,
              isStuck: execInfo.isStuck
            };
          } else {
            kernelStatus = "idle";
          }
        } catch (error) {
          console.warn(`⚠️ Could not get execution info for ${appKernelId}:`, error);
          kernelStatus = "error";
        }
        
        console.log(`📜 Retrieved ${recentLogs.length} log entries for app ${appId}`);
        
        return {
          appId,
          kernelId: appKernelId,
          logs: recentLogs,
          totalLogEntries: allLogs.length,
          requestedLines: maxLines,
          kernelStatus,
          currentExecution,
          timestamp: new Date().toISOString()
        };
        
      } catch (error) {
        console.error(`❌ Failed to get kernel logs for app ${appId}:`, error);
        throw error;
      }
    }
  });
  
  console.log("Service registered successfully!");
  console.log(`Service is available (id: ${svc.id}), you can try it at: ${server.config.public_base_url}/${server.config.workspace}/services/${svc.id.split("/")[1]}`);
  
  // Load deno-app artifacts if requested
  if (Deno.env.get("LOAD_APPS") === "true") {
    console.log("🔄 Loading deno-app artifacts...");
    try {
      await loadDenoApps(server, kernelManager);
    } catch (error) {
      console.error("⚠️ Failed to load deno-apps, but service will continue running:", error);
    }
  }
  
  // Keep the connection alive
  return { server, service: svc };
}

// Export for testing
export { startHyphaService };

// Start the service if this is the main module
if (import.meta.main) {
  try {
    await startHyphaService();
    console.log("Hypha service is running. Press Ctrl+C to exit.");
  } catch (error) {
    console.error("Failed to start hypha service:", error);
    Deno.exit(1);
  }
} 