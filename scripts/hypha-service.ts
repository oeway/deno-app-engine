import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";
import type { IKernelManagerOptions } from "../kernel/manager.ts";
import { VectorDBManager, VectorDBEvents, type IVectorDBManagerOptions, type IDocument, type IQueryOptions, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";

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

async function startHyphaService() {
  console.log("Connecting to hypha server...");
  let token = Deno.env.get("HYPHA_TOKEN");
  if(!token){
    token = await hyphaWebsocketClient.login({
        "server_url": Deno.env.get("HYPHA_SERVER_URL") || "https://hypha.aicell.io",
    })
  }
  const server = await hyphaWebsocketClient.connectToServer({
    // read the following from environment variables and use default
    "server_url": Deno.env.get("HYPHA_SERVER_URL") || "https://hypha.aicell.io",
    "workspace": Deno.env.get("HYPHA_WORKSPACE") || undefined,
    "token": token,
    "client_id": Deno.env.get("HYPHA_CLIENT_ID") || undefined,
  });
  
  console.log("Connected to hypha server, registering service...");
  // Create a global kernel manager instance with configuration
  const kernelManager = new KernelManager(getKernelManagerOptions());
  
  // Configure vector database manager options from environment variables
  const vectorDBOffloadDirectory = Deno.env.get("VECTORDB_OFFLOAD_DIRECTORY") || "./vectordb_offload";
  const vectorDBDefaultTimeout = parseInt(Deno.env.get("VECTORDB_DEFAULT_INACTIVITY_TIMEOUT") || "1800000"); // 30 minutes default
  const vectorDBActivityMonitoring = Deno.env.get("VECTORDB_ACTIVITY_MONITORING") !== "false"; // Default true
  
  // Create a global vector database manager instance
  const vectorDBManager = new VectorDBManager({
    defaultEmbeddingModel: Deno.env.get("EMBEDDING_MODEL") || "mock-model", // Use mock model as default
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

  console.log("Hypha Service VectorDB Manager Configuration:");
  console.log(`- Default embedding model: ${Deno.env.get("EMBEDDING_MODEL") || "mock-model"}`);
  console.log(`- Offload directory: ${vectorDBOffloadDirectory}`);
  console.log(`- Default inactivity timeout: ${vectorDBDefaultTimeout}ms (${Math.round(vectorDBDefaultTimeout / 60000)} minutes)`);
  console.log(`- Activity monitoring enabled: ${vectorDBActivityMonitoring}`);

  
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
      resume?: boolean
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
          resume: options.resume
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
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
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
      
      await vectorDBManager.addDocuments(fullIndexId, documents);
      
      console.log(`Added ${documents.length} documents to vector index ${fullIndexId}`);
      return { 
        success: true, 
        addedCount: documents.length,
        timestamp: new Date().toISOString()
      };
    },

    async queryVectorIndex({indexId, query, options}: {indexId: string, query: string | number[], options?: IQueryOptions}, context: {user: any, ws: string}) {
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      if (!query) {
        throw new Error("No query provided");
      }
      
      const queryOptions = {
        k: 10,
        threshold: 0,
        includeMetadata: true,
        ...options
      };
      
      const results = await vectorDBManager.queryIndex(fullIndexId, query, queryOptions);
      
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
      const fullIndexId = ensureKernelId(indexId, context.ws);
      
      // Verify index belongs to user's namespace
      const index = vectorDBManager.getInstance(fullIndexId);
      if (!index) {
        throw new Error("Vector index not found or access denied");
      }
      
      if (!documentIds || documentIds.length === 0) {
        throw new Error("No document IDs provided");
      }
      
      await vectorDBManager.removeDocuments(fullIndexId, documentIds);
      
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
    }
  });
  
  console.log("Service registered successfully!");
  console.log(`Service is available (id: ${svc.id}), you can try it at: https://hypha.aicell.io/${server.config.workspace}/services/${svc.id.split("/")[1]}`);
  
  // Keep the connection alive
  return server;
}

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