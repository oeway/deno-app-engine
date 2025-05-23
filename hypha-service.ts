import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelManager, KernelMode } from "./kernel/mod.ts";

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

// Create a global kernel manager instance
const kernelManager = new KernelManager();

// Store kernel execution history
interface KernelHistory {
  id: string; // execution id
  script: string;
  outputs: unknown[];
}

const kernelHistory = new Map<string, KernelHistory[]>();

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
    "token": token
  });
  
  console.log("Connected to hypha server, registering service...");
  
  const svc = await server.registerService({
    "name": "Deno Code Interpreter",
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
        created: kernel.created.toISOString(),
        status: kernel.kernel.status || "unknown",
        history: kernelHistory.get(kernelId) || [],
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