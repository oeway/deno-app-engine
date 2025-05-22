import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelManager, KernelMode } from "./kernel/mod.ts";

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
  const server = await hyphaWebsocketClient.connectToServer({
    "server_url": "https://hypha.aicell.io"
  });
  
  console.log("Connected to hypha server, registering service...");
  
  const svc = await server.registerService({
    "name": "Deno Code Interpreter",
    "id": "deno-code-interpreter",
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