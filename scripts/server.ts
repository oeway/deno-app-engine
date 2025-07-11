import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";
import type { IKernelManagerOptions } from "../kernel/manager.ts";
import { VectorDBManager, type IDocument, type IQueryOptions, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";
import { AgentManager, AgentEvents, KernelType, type IAgentConfig } from "../agents/mod.ts";
import { Status } from "https://deno.land/std@0.201.0/http/http_status.ts";
import { contentType } from "https://deno.land/std/media_types/mod.ts";

// Available embedding providers configuration
const EMBEDDING_PROVIDERS = {
  "mock-model": { type: "builtin", description: "Built-in mock model for testing" },
  "ollama-nomic-embed-text": { 
    type: "ollama", 
    model: "nomic-embed-text", 
    host: Deno.env.get("OLLAMA_HOST") || "http://localhost:11434",
    dimension: 768,
    description: "Ollama nomic-embed-text model (768D)"
  },
  "ollama-all-minilm": { 
    type: "ollama", 
    model: "all-minilm", 
    host: Deno.env.get("OLLAMA_HOST") || "http://localhost:11434",
    dimension: 384,
    description: "Ollama all-minilm model (384D)"
  },
  "ollama-mxbai-embed-large": { 
    type: "ollama", 
    model: "mxbai-embed-large", 
    host: Deno.env.get("OLLAMA_HOST") || "http://localhost:11434",
    dimension: 1024,
    description: "Ollama mxbai-embed-large model (1024D)"
  },
  "ollama-snowflake-arctic-embed": {
    type: "ollama",
    model: "snowflake-arctic-embed",
    host: Deno.env.get("OLLAMA_HOST") || "http://localhost:11434",
    dimension: 1024,
    description: "Ollama snowflake-arctic-embed model (1024D)"
  },
};

// Default model settings for agents
const DEFAULT_AGENT_MODEL_SETTINGS = {
  baseURL: Deno.env.get("AGENT_MODEL_BASE_URL") || "http://localhost:11434/v1/",
  apiKey: Deno.env.get("AGENT_MODEL_API_KEY") || "ollama",
  model: Deno.env.get("AGENT_MODEL_NAME") || "qwen2.5-coder:7b",
  temperature: parseFloat(Deno.env.get("AGENT_MODEL_TEMPERATURE") || "0.7")
};

// Helper function to create preconfigured providers for the manager
function createPreconfiguredProviders(): Record<string, any> {
  const providers: Record<string, any> = {};
  
  for (const [name, config] of Object.entries(EMBEDDING_PROVIDERS)) {
    if (config.type === "ollama" && "host" in config && "model" in config && "dimension" in config) {
      try {
        const provider = createOllamaEmbeddingProvider(
          name,
          config.host,
          config.model,
          config.dimension
        );
        providers[name] = provider;
        console.log(`✅ Prepared Ollama provider: ${name}`);
      } catch (error) {
        console.warn(`⚠️ Failed to prepare Ollama provider ${name}:`, error);
      }
    }
  }
  
  return providers;
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
      let language: KernelLanguage;
      switch (langStr?.toLowerCase()) {
        case "typescript":
        case "ts":
          language = KernelLanguage.TYPESCRIPT;
          break;
        case "javascript":
        case "js":
          language = KernelLanguage.JAVASCRIPT;
          break;
        case "python":
        case "py":
        default:
          language = KernelLanguage.PYTHON;
          break;
      }
      
      return { mode, language };
    });
  } else {
    // Default: only worker kernels for security, supporting all three languages
    allowedKernelTypes = [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
      { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT },
      { mode: KernelMode.WORKER, language: KernelLanguage.JAVASCRIPT }
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
      let language: KernelLanguage;
      switch (langStr?.toLowerCase()) {
        case "typescript":
        case "ts":
          language = KernelLanguage.TYPESCRIPT;
          break;
        case "javascript":
        case "js":
          language = KernelLanguage.JAVASCRIPT;
          break;
        case "python":
        case "py":
        default:
          language = KernelLanguage.PYTHON;
          break;
      }
      
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
  
  console.log("Kernel Manager Configuration:");
  console.log(`- Allowed kernel types: ${allowedKernelTypes.map(t => `${t.mode}-${t.language}`).join(", ")}`);
  console.log(`- Pool enabled: ${poolEnabled}`);
  if (poolEnabled) {
    console.log(`- Pool size: ${poolSize}`);
    console.log(`- Auto refill: ${autoRefill}`);
    console.log(`- Preload configs: ${preloadConfigs.map(t => `${t.mode}-${t.language}`).join(", ")}`);
  }
  
  return options;
}

// Create a global kernel manager instance with configuration
const kernelManager = new KernelManager(getKernelManagerOptions());

// Configure vector database manager options from environment variables
const vectorDBOffloadDirectory = Deno.env.get("VECTORDB_OFFLOAD_DIRECTORY") || "./vectordb_offload";
const vectorDBDefaultTimeout = parseInt(Deno.env.get("VECTORDB_DEFAULT_INACTIVITY_TIMEOUT") || "1800000"); // 30 minutes default
const vectorDBActivityMonitoring = Deno.env.get("VECTORDB_ACTIVITY_MONITORING") !== "false"; // Default true

// Create preconfigured providers
const preconfiguredProviders = createPreconfiguredProviders();

// Create a global vector database manager instance
const vectorDBManager = new VectorDBManager({
  defaultEmbeddingModel: Deno.env.get("EMBEDDING_MODEL") || "mock-model", // Use mock for demo to avoid dependency issues
  maxInstances: parseInt(Deno.env.get("MAX_VECTOR_DB_INSTANCES") || "10"),
  allowedNamespaces: undefined, // Allow all namespaces for now
  offloadDirectory: vectorDBOffloadDirectory,
  defaultInactivityTimeout: vectorDBDefaultTimeout,
  enableActivityMonitoring: vectorDBActivityMonitoring,
  providerRegistry: preconfiguredProviders
});

console.log("Server VectorDB Manager Configuration:");
console.log(`- Embedding model: ${Deno.env.get("EMBEDDING_MODEL") || "mock-model"}`);
console.log(`- Max instances: ${parseInt(Deno.env.get("MAX_VECTOR_DB_INSTANCES") || "10")}`);
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

console.log("Server Agent Manager Configuration:");
console.log(`- Default model: ${DEFAULT_AGENT_MODEL_SETTINGS.model}`);
console.log(`- Max agents: ${maxAgents}`);
console.log(`- Agent data directory: ${agentDataDirectory}`);
console.log(`- Auto save conversations: ${autoSaveConversations}`);
console.log(`- Max steps cap: ${maxStepsCap}`);

// Store execution sessions and their results
interface ExecutionSession {
  id: string;
  kernelId: string;
  script: string;
  outputs: unknown[];
  promise: Promise<unknown[]>;
  complete: boolean;
  listeners: ((output: unknown) => void)[];
}

const sessions = new Map<string, ExecutionSession>();

// Store kernel execution history
interface KernelHistory {
  id: string; // session id
  script: string;
  outputs: unknown[];
}

const kernelHistory = new Map<string, KernelHistory[]>();

// Helper to send JSON response
function jsonResponse(data: unknown, status = 200) {
  const headers = new Headers({
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  return new Response(JSON.stringify(data), { status, headers });
}

// Helper to create a new execution session
async function createExecutionSession(kernelId: string, code: string): Promise<ExecutionSession> {
  const sessionId = crypto.randomUUID();
  let resolvePromise!: (value: unknown[]) => void;
  let rejectPromise!: (error: Error) => void;
  
  const session: ExecutionSession = {
    id: sessionId,
    kernelId,
    script: code,
    outputs: [],
    promise: new Promise<unknown[]>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    complete: false,
    listeners: []
  };
  
  sessions.set(sessionId, session);
  
  // Initialize history for this kernel if it doesn't exist
  if (!kernelHistory.has(kernelId)) {
    kernelHistory.set(kernelId, []);
  }
  
  // Start execution in background
  (async () => {
    try {
      for await (const output of kernelManager.executeStream(kernelId, code)) {
        session.outputs.push(output);
        // Notify all listeners
        session.listeners?.forEach(listener => listener(output));
      }
      session.complete = true;
      resolvePromise(session.outputs);
      
      // Add to kernel history
      const history = kernelHistory.get(kernelId) || [];
      history.push({
        id: sessionId,
        script: code,
        outputs: session.outputs,
      });
      kernelHistory.set(kernelId, history);
    } catch (error) {
      const errorOutput = {
        type: "error",
        data: { message: error instanceof Error ? error.message : String(error) },
      };
      session.outputs.push(errorOutput);
      session.complete = true;
      // Notify all listeners of the error
      session.listeners?.forEach(listener => listener(errorOutput));
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
      
      // Still add to history, but with error
      const history = kernelHistory.get(kernelId) || [];
      history.push({
        id: sessionId,
        script: code,
        outputs: session.outputs,
      });
      kernelHistory.set(kernelId, history);
    }
  })();
  
  return session;
}

// Helper to serve static files
async function serveStaticFile(path: string): Promise<Response> {
  try {
    const file = await Deno.readFile(path);
    const mediaType = contentType(path.split('.').pop() || '');
    return new Response(file, {
      headers: {
        "Content-Type": mediaType || "application/octet-stream",
      },
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("404 Not Found", { status: 404 });
    }
    return new Response("500 Internal Server Error", { status: 500 });
  }
}

// Helper function to extract namespace from request
function getNamespaceFromRequest(req: Request): string | undefined {
  const url = new URL(req.url);
  
  // Try query parameter first
  const namespaceParam = url.searchParams.get("namespace");
  if (namespaceParam) {
    return namespaceParam;
  }
  
  // Try header
  const namespaceHeader = req.headers.get("X-Namespace");
  if (namespaceHeader) {
    return namespaceHeader;
  }
  
  // No namespace specified
  return undefined;
}

// Helper function to validate agent access within namespace
function validateAgentAccess(agentId: string, namespace?: string): string {
  // If namespace is provided, ensure agent ID matches namespace or is accessible
  if (namespace) {
    // If the agent ID is namespaced and matches the expected namespace, allow access
    if (agentId.includes(':')) {
      const [agentNamespace] = agentId.split(':');
      if (agentNamespace === namespace) {
        return agentId;
      } else {
        throw new Error(`Access denied: Agent ${agentId} is not in namespace ${namespace}`);
      }
    }
    
    // For non-namespaced agents, allow access but warn
    console.warn(`Accessing non-namespaced agent ${agentId} from namespace ${namespace}. This is deprecated.`);
    return agentId;
  }
  
  // No namespace specified, allow direct access
  return agentId;
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Serve index.html at root
  if (path === "/" || path === "/index.html") {
    return await serveStaticFile("static/index.html");
  }

  // Serve vector database playground
  if (path === "/vectordb" || path === "/vectordb.html") {
    return await serveStaticFile("static/vectordb.html");
  }

  // Serve agent playground
  if (path === "/agents" || path === "/agents.html") {
    return await serveStaticFile("static/agents.html");
  }

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // API routes
    if (path.startsWith("/api/")) {
      // List kernels
      if (path === "/api/kernels" && req.method === "GET") {
        try {
          const kernelList = await kernelManager.listKernels();
          const kernels = kernelList.map(kernel => ({
            id: kernel.id,
            name: `Kernel-${kernel.id.slice(0, 8)}`,
            mode: kernel.mode,
            status: kernel.status,
            created: kernel.created,
          }));
          return jsonResponse(kernels);
        } catch (error) {
          console.error("Error listing kernels:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Create kernel
      if (path === "/api/kernels" && req.method === "POST") {
        try {
          const body = await req.json();
          
          // Map language string to KernelLanguage enum
          let language: KernelLanguage = KernelLanguage.PYTHON; // Default
          if (body.lang) {
            switch (body.lang.toLowerCase()) {
              case "typescript":
              case "ts":
                language = KernelLanguage.TYPESCRIPT;
                break;
              case "javascript":
              case "js":
                language = KernelLanguage.JAVASCRIPT;
                break;
              case "python":
              case "py":
              default:
                language = KernelLanguage.PYTHON;
                break;
            }
          }
          
          const kernelId = await kernelManager.createKernel({
            id: body.id || crypto.randomUUID(),
            mode: body.mode || KernelMode.WORKER,
            lang: language,
          });
          
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            throw new Error("Failed to get kernel after creation");
          }
          
          // Initialize history for this kernel
          kernelHistory.set(kernelId, []);
          
          // Get status asynchronously
          let status = "unknown";
          try {
            if (kernel.kernel && typeof kernel.kernel.getStatus === 'function') {
              status = await kernel.kernel.getStatus();
            }
          } catch (error) {
            status = "unknown";
          }

          return jsonResponse({
            id: kernelId,
            mode: kernel.mode,
            language: kernel.language || "python",
            status: status,
            created: kernel.created,
            name: `Kernel-${kernelId.slice(0, 8)}`
          });
        } catch (error: unknown) {
          console.error("Error creating kernel:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Delete kernel
      if (path.match(/^\/api\/kernels\/[\w-]+$/) && req.method === "DELETE") {
        const kernelId = path.split("/").pop()!;
        
        // Clean up sessions for this kernel
        for (const [sessionId, session] of sessions.entries()) {
          if (session.kernelId === kernelId) {
            sessions.delete(sessionId);
          }
        }
        
        // Clean up history
        kernelHistory.delete(kernelId);
        
        await kernelManager.destroyKernel(kernelId);
        return new Response(null, { status: 200 });
      }

      // Get kernel info
      if (path.match(/^\/api\/kernels\/[\w-]+\/info$/) && req.method === "GET") {
        const kernelId = path.split("/")[3];
        const kernel = kernelManager.getKernel(kernelId);
        
        if (!kernel) {
          return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
        }
        
        // Get or create history for this kernel
        const history = kernelHistory.get(kernelId) || [];
        
        // Ensure the kernelHistory Map has an entry for this kernel
        if (!kernelHistory.has(kernelId)) {
          kernelHistory.set(kernelId, []);
        }
        
        // Get status asynchronously
        let status = "unknown";
        try {
          if (kernel.kernel && typeof kernel.kernel.getStatus === 'function') {
            status = await kernel.kernel.getStatus();
          }
        } catch (error) {
          status = "unknown";
        }

        return jsonResponse({
          id: kernelId,
          name: `Kernel-${kernelId.slice(0, 8)}`,
          mode: kernel.mode,
          language: kernel.language || "python",
          created: kernel.created,
          status: status,
          history: history,
        });
      }

      // Submit async execution
      if (path.match(/^\/api\/kernels\/[\w-]+\/execute\/submit$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        const { code } = await req.json();

        if (!code) {
          return jsonResponse({ error: "No code provided" }, Status.BadRequest);
        }

        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }

          const session = await createExecutionSession(kernelId, code);
          return jsonResponse({ session_id: session.id });
        } catch (error) {
          console.error("Error in execute/submit:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get async execution result
      if (path.match(/^\/api\/kernels\/[\w-]+\/execute\/result\/[\w-]+$/) && req.method === "GET") {
        const kernelId = path.split("/")[3];
        const sessionId = path.split("/")[6];

        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }

          const session = sessions.get(sessionId);
          if (!session) {
            return jsonResponse({ error: "Session not found" }, Status.NotFound);
          }

          const result = await session.promise;
          return jsonResponse(result);
        } catch (error) {
          console.error("Error in execute/result:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Stream execution results
      if (path.match(/^\/api\/kernels\/[\w-]+\/execute\/stream\/[\w-]+$/) && req.method === "GET") {
        const kernelId = path.split("/")[3];
        const sessionId = path.split("/").pop()!;
        
        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }

          const session = sessions.get(sessionId);
          if (!session) {
            return jsonResponse({ error: "Session not found" }, Status.NotFound);
          }

          // Set up SSE stream
          const stream = new ReadableStream({
            async start(controller) {
              let isClosed = false;
              
              try {
                // Create a function to send an event
                const sendEvent = (data: any) => {
                  if (!isClosed) {
                    try {
                      const event = `data: ${JSON.stringify(data)}\n\n`;
                      controller.enqueue(new TextEncoder().encode(event));
                    } catch (error) {
                      // Controller is already closed, mark as closed
                      isClosed = true;
                    }
                  }
                };

                // Send any existing outputs first
                for (const output of session.outputs) {
                  sendEvent(output);
                }

                // Set up event listener for new outputs
                const outputListener = (output: any) => {
                  session.outputs.push(output);
                  sendEvent(output);
                };

                // Add listener to session
                session.listeners = session.listeners || [];
                session.listeners.push(outputListener);

                // Wait for completion or error
                try {
                  await session.promise;
                  if (!isClosed) {
                    controller.close();
                    isClosed = true;
                  }
                } catch (error) {
                  sendEvent({
                    type: "error",
                    data: { message: error instanceof Error ? error.message : String(error) }
                  });
                  if (!isClosed) {
                    controller.close();
                    isClosed = true;
                  }
                }

                // Clean up listener
                const listenerIndex = session.listeners.indexOf(outputListener);
                if (listenerIndex !== -1) {
                  session.listeners.splice(listenerIndex, 1);
                }
              } catch (error: unknown) {
                if (!isClosed) {
                  try {
                    const errorEvent = `data: ${JSON.stringify({
                      type: "error",
                      data: { message: error instanceof Error ? error.message : String(error) },
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(errorEvent));
                    controller.close();
                    isClosed = true;
                  } catch (closeError) {
                    // Controller already closed
                    isClosed = true;
                  }
                }
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        } catch (error) {
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Execute code (streaming)
      if (path.match(/^\/api\/kernels\/[\w-]+\/execute$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        const { code } = await req.json();

        if (!code) {
          return jsonResponse({ error: "No code provided" }, Status.BadRequest);
        }

        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }

          // Initialize history for this kernel if it doesn't exist
          if (!kernelHistory.has(kernelId)) {
            kernelHistory.set(kernelId, []);
          }

          // Set up readable stream that directly uses kernelManager.executeStream
          const stream = new ReadableStream({
            async start(controller) {
              let isClosed = false;
              
              try {
                const sendData = (data: any) => {
                  if (!isClosed) {
                    try {
                      const jsonLine = JSON.stringify(data) + '\n';
                      controller.enqueue(new TextEncoder().encode(jsonLine));
                    } catch (error) {
                      // Controller is already closed, mark as closed
                      isClosed = true;
                    }
                  }
                };

                // Send start marker
                sendData({ type: "stream_start", data: { message: "Execution started" } });

                let outputCount = 0;
                const sessionId = crypto.randomUUID();
                const outputs: any[] = [];
                
                // Use the kernel manager's executeStream method
                for await (const output of kernelManager.executeStream(kernelId, code)) {
                  outputCount++;
                  outputs.push(output);
                  sendData(output);
                }
                
                // Send completion marker
                sendData({ type: "stream_complete", data: { message: "Execution completed", outputCount } });
                
                // Add to kernel history
                const history = kernelHistory.get(kernelId) || [];
                history.push({
                  id: sessionId,
                  script: code,
                  outputs: outputs,
                });
                kernelHistory.set(kernelId, history);
                
                if (!isClosed) {
                  controller.close();
                  isClosed = true;
                }
                
              } catch (error) {
                console.error(`Stream error for kernel ${kernelId}:`, error);
                if (!isClosed) {
                  try {
                    const errorData = JSON.stringify({
                      type: "error",
                      data: { message: error instanceof Error ? error.message : String(error) },
                    }) + '\n';
                    controller.enqueue(new TextEncoder().encode(errorData));
                    controller.close();
                    isClosed = true;
                  } catch (closeError) {
                    // Controller already closed
                    isClosed = true;
                  }
                }
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "application/x-ndjson",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        } catch (error) {
          console.error(`Error setting up execution stream for kernel ${kernelId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Execute code with SSE streaming
      if (path.match(/^\/api\/kernels\/[\w-]+\/execute\/stream$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        const { code } = await req.json();

        if (!code) {
          return jsonResponse({ error: "No code provided" }, Status.BadRequest);
        }

        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }

          // Create a session
          const session = await createExecutionSession(kernelId, code);

          // Set up SSE stream
          const stream = new ReadableStream({
            async start(controller) {
              let isClosed = false;
              
              try {
                // Create a function to send an event
                const sendEvent = (data: any) => {
                  if (!isClosed) {
                    try {
                      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
                    } catch (error) {
                      // Controller is already closed, mark as closed
                      isClosed = true;
                    }
                  }
                };

                // Send any existing outputs first
                for (const output of session.outputs) {
                  sendEvent(output);
                }

                // Set up event listener for new outputs
                const outputListener = (output: any) => {
                  sendEvent(output);
                };

                // Add listener to session
                session.listeners = session.listeners || [];
                session.listeners.push(outputListener);

                // Wait for completion or error
                try {
                  await session.promise;
                  if (!isClosed) {
                    controller.close();
                    isClosed = true;
                  }
                } catch (error) {
                  sendEvent({
                    type: "error",
                    data: { message: error instanceof Error ? error.message : String(error) },
                  });
                  if (!isClosed) {
                    controller.close();
                    isClosed = true;
                  }
                } finally {
                  // Clean up listener
                  const listenerIndex = session.listeners.indexOf(outputListener);
                  if (listenerIndex !== -1) {
                    session.listeners.splice(listenerIndex, 1);
                  }
                }
              } catch (error: unknown) {
                if (!isClosed) {
                  try {
                    const errorEvent = `data: ${JSON.stringify({
                      type: "error",
                      data: { message: error instanceof Error ? error.message : String(error) },
                    })}\n\n`;
                    controller.enqueue(new TextEncoder().encode(errorEvent));
                    controller.close();
                    isClosed = true;
                  } catch (closeError) {
                    // Controller already closed
                    isClosed = true;
                  }
                }
              }
            },
          });

          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          });
        } catch (error) {
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Ping kernel to reset activity timer
      if (path.match(/^\/api\/kernels\/[\w-]+\/ping$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        
        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }
          
          const success = kernelManager.pingKernel(kernelId);
          
          if (!success) {
            return jsonResponse({ error: "Failed to ping kernel" }, Status.InternalServerError);
          }
          
          return jsonResponse({ 
            success: true, 
            message: "Kernel activity timer reset",
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error pinging kernel ${kernelId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Restart kernel
      if (path.match(/^\/api\/kernels\/[\w-]+\/restart$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        
        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }
          
          // Clean up sessions for this kernel
          for (const [sessionId, session] of sessions.entries()) {
            if (session.kernelId === kernelId) {
              sessions.delete(sessionId);
            }
          }
          
          // Clean up history
          kernelHistory.delete(kernelId);
          
          const success = await kernelManager.restartKernel(kernelId);
          
          if (!success) {
            return jsonResponse({ error: "Failed to restart kernel" }, Status.InternalServerError);
          }
          
          // Reinitialize history for the restarted kernel
          kernelHistory.set(kernelId, []);
          
          return jsonResponse({ 
            success: true, 
            message: "Kernel restarted successfully",
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error restarting kernel ${kernelId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Interrupt kernel execution
      if (path.match(/^\/api\/kernels\/[\w-]+\/interrupt$/) && req.method === "POST") {
        const kernelId = path.split("/")[3];
        
        try {
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
          }
          
          const success = await kernelManager.interruptKernel(kernelId);
          
          if (!success) {
            return jsonResponse({ error: "Failed to interrupt kernel" }, Status.InternalServerError);
          }
          
          return jsonResponse({ 
            success: true, 
            message: "Kernel execution interrupted",
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error interrupting kernel ${kernelId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Vector Database API Routes
      
      // List available embedding providers
      if (path === "/api/vectordb/providers" && req.method === "GET") {
        try {
          const registryProviders = vectorDBManager.listEmbeddingProviders().map(entry => ({
            name: entry.id,
            type: entry.provider.type,
            dimension: entry.provider.dimension,
            description: `${entry.provider.name} (${entry.provider.type})`,
            created: entry.created.toISOString(),
            lastUsed: entry.lastUsed?.toISOString()
          }));

          const configProviders = Object.entries(EMBEDDING_PROVIDERS).map(([name, config]) => ({
            name,
            type: config.type,
            description: config.description,
            available: vectorDBManager.hasEmbeddingProvider(name)
          }));

          // For backward compatibility, also provide a unified providers list
          const providers = registryProviders.map(p => ({
            name: p.name,
            type: p.type,
            model: p.name, // Use name as model for compatibility
            dimension: p.dimension,
            description: p.description
          }));
          
          return jsonResponse({ 
            providers, // For backward compatibility
            registryProviders,
            configProviders,
            stats: vectorDBManager.getEmbeddingProviderStats()
          });
        } catch (error) {
          console.error("Error listing embedding providers:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Test embedding provider availability
      if (path === "/api/vectordb/providers/test" && req.method === "POST") {
        try {
          const body = await req.json();
          const providerName = body.provider;
          
          if (!providerName) {
            return jsonResponse({ error: "Provider name is required" }, Status.BadRequest);
          }
          
          const providerEntry = vectorDBManager.getEmbeddingProvider(providerName);
          
          if (!providerEntry) {
            return jsonResponse({ 
              available: false, 
              message: "Provider not found in registry",
              provider: providerName
            });
          }
          
          // Test the provider with a simple embedding
          try {
            const testEmbedding = await providerEntry.provider.embed("test");
            return jsonResponse({ 
              available: true, 
              message: "Provider is working correctly",
              provider: providerName,
              dimension: providerEntry.provider.dimension,
              testEmbeddingLength: testEmbedding.length
            });
          } catch (error) {
            return jsonResponse({ 
              available: false, 
              message: error instanceof Error ? error.message : String(error),
              provider: providerName
            });
          }
        } catch (error) {
          console.error("Error testing embedding provider:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Add embedding provider to registry
      if (path === "/api/vectordb/providers" && req.method === "POST") {
        try {
          const body = await req.json();
          const { name, type, config } = body;
          
          if (!name || !type || !config) {
            return jsonResponse({ error: "Name, type, and config are required" }, Status.BadRequest);
          }
          
          if (type === "ollama") {
            const { host, model, dimension } = config;
            if (!host || !model || !dimension) {
              return jsonResponse({ error: "Ollama provider requires host, model, and dimension" }, Status.BadRequest);
            }
            
            try {
              const provider = createOllamaEmbeddingProvider(name, host, model, dimension);
              const success = vectorDBManager.addEmbeddingProvider(name, provider);
              
              if (!success) {
                return jsonResponse({ error: "Provider with this name already exists" }, Status.Conflict);
              }
              
              return jsonResponse({ 
                success: true, 
                message: `Ollama provider ${name} added successfully`,
                provider: {
                  name,
                  type: provider.type,
                  dimension: provider.dimension,
                  model,
                  host
                }
              });
            } catch (error) {
              return jsonResponse({ 
                error: `Failed to create Ollama provider: ${error instanceof Error ? error.message : String(error)}` 
              }, Status.BadRequest);
            }
          } else {
            return jsonResponse({ error: `Unsupported provider type: ${type}` }, Status.BadRequest);
          }
        } catch (error) {
          console.error("Error adding embedding provider:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Remove embedding provider from registry
      if (path.match(/^\/api\/vectordb\/providers\/[\w-]+$/) && req.method === "DELETE") {
        try {
          const providerName = path.split("/").pop()!;
          
          const success = vectorDBManager.removeEmbeddingProvider(providerName);
          
          if (!success) {
            return jsonResponse({ error: "Provider not found" }, Status.NotFound);
          }
          
          return jsonResponse({ 
            success: true, 
            message: `Provider ${providerName} removed successfully` 
          });
        } catch (error) {
          console.error("Error removing embedding provider:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Update embedding provider in registry
      if (path.match(/^\/api\/vectordb\/providers\/[\w-]+$/) && req.method === "PUT") {
        try {
          const providerName = path.split("/").pop()!;
          const body = await req.json();
          const { type, config } = body;
          
          if (!type || !config) {
            return jsonResponse({ error: "Type and config are required" }, Status.BadRequest);
          }
          
          if (type === "ollama") {
            const { host, model, dimension } = config;
            if (!host || !model || !dimension) {
              return jsonResponse({ error: "Ollama provider requires host, model, and dimension" }, Status.BadRequest);
            }
            
            try {
              const provider = createOllamaEmbeddingProvider(providerName, host, model, dimension);
              const success = vectorDBManager.updateEmbeddingProvider(providerName, provider);
              
              if (!success) {
                return jsonResponse({ error: "Provider not found" }, Status.NotFound);
              }
              
              return jsonResponse({ 
                success: true, 
                message: `Provider ${providerName} updated successfully`,
                provider: {
                  name: providerName,
                  type: provider.type,
                  dimension: provider.dimension,
                  model,
                  host
                }
              });
            } catch (error) {
              return jsonResponse({ 
                error: `Failed to update Ollama provider: ${error instanceof Error ? error.message : String(error)}` 
              }, Status.BadRequest);
            }
          } else {
            return jsonResponse({ error: `Unsupported provider type: ${type}` }, Status.BadRequest);
          }
        } catch (error) {
          console.error("Error updating embedding provider:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get specific embedding provider details
      if (path.match(/^\/api\/vectordb\/providers\/[\w-]+$/) && req.method === "GET") {
        try {
          const providerName = path.split("/").pop()!;
          
          const providerEntry = vectorDBManager.getEmbeddingProvider(providerName);
          
          if (!providerEntry) {
            return jsonResponse({ error: "Provider not found" }, Status.NotFound);
          }
          
          // Count instances using this provider
          const instances = vectorDBManager.listInstances();
          const instancesUsingProvider = instances.filter(instance => {
            const instanceObj = vectorDBManager.getInstance(instance.id);
            return instanceObj?.options.embeddingProviderName === providerName;
          });
          
          return jsonResponse({
            id: providerEntry.id,
            name: providerEntry.provider.name,
            type: providerEntry.provider.type,
            dimension: providerEntry.provider.dimension,
            created: providerEntry.created.toISOString(),
            lastUsed: providerEntry.lastUsed?.toISOString(),
            instancesUsing: instancesUsingProvider.length,
            instanceIds: instancesUsingProvider.map(i => i.id)
          });
        } catch (error) {
          console.error("Error getting embedding provider details:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }
      
      // List vector database instances
      if (path === "/api/vectordb/instances" && req.method === "GET") {
        try {
          const url = new URL(req.url);
          const namespace = url.searchParams.get("namespace") || undefined;
          
          const instances = vectorDBManager.listInstances(namespace);
          const enhancedInstances = instances.map(instance => {
            const lastActivity = vectorDBManager.getLastActivityTime(instance.id);
            const timeUntilOffload = vectorDBManager.getTimeUntilOffload(instance.id);
            const inactivityTimeout = vectorDBManager.getInactivityTimeout(instance.id);
            const instanceObj = vectorDBManager.getInstance(instance.id);
            
            return {
              ...instance,
              isFromOffload: instanceObj?.isFromOffload || false,
              embeddingProvider: instanceObj?.options.embeddingProvider?.name || instanceObj?.options.embeddingProviderName || "Built-in",
              activityMonitoring: {
                lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
                timeUntilOffload: timeUntilOffload,
                inactivityTimeout: inactivityTimeout,
                enabled: instanceObj?.options.enableActivityMonitoring !== false && vectorDBActivityMonitoring
              }
            };
          });
          
          return jsonResponse(enhancedInstances);
        } catch (error) {
          console.error("Error listing vector database instances:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get vector database stats
      if (path === "/api/vectordb/stats" && req.method === "GET") {
        try {
          const stats = vectorDBManager.getStats();
          return jsonResponse(stats);
        } catch (error) {
          console.error("Error getting vector database stats:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Create vector database index
      if (path === "/api/vectordb/indices" && req.method === "POST") {
        try {
          const body = await req.json();
          
          // Use embedding provider from registry if specified
          let embeddingProviderName: string | undefined;
          if (body.embeddingProvider && body.embeddingProvider !== "default") {
            if (vectorDBManager.hasEmbeddingProvider(body.embeddingProvider)) {
              embeddingProviderName = body.embeddingProvider;
            } else {
              throw new Error(`Embedding provider ${body.embeddingProvider} not found in registry`);
            }
          }
          
          const indexId = await vectorDBManager.createIndex({
            id: body.id || crypto.randomUUID(),
            namespace: body.namespace || "default",
            embeddingModel: body.embeddingModel,
            embeddingProviderName: embeddingProviderName,
            inactivityTimeout: body.inactivityTimeout,
            enableActivityMonitoring: body.enableActivityMonitoring,
            resume: body.resume
          });
          
          const instance = vectorDBManager.getInstance(indexId);
          const namespaceMatch = indexId.match(/^([^:]+):/);
          const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
          
          return jsonResponse({
            id: indexId,
            namespace: namespace,
            documentCount: instance?.documentCount || 0,
            embeddingDimension: instance?.embeddingDimension,
            embeddingProvider: embeddingProviderName || "Built-in",
            created: new Date().toISOString(),
            activityMonitoring: {
              enabled: body.enableActivityMonitoring !== false && vectorDBActivityMonitoring,
              timeout: body.inactivityTimeout || vectorDBDefaultTimeout
            }
          });
        } catch (error) {
          console.error("Error creating vector database index:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Add documents to vector database
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/documents$/) && req.method === "POST") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const body = await req.json();
          const documents: IDocument[] = body.documents || [];
          
          await vectorDBManager.addDocuments(indexId, documents);
          
          const instance = vectorDBManager.getInstance(indexId);
          return jsonResponse({
            success: true,
            message: `Added ${documents.length} documents`,
            documentCount: instance?.documentCount || 0
          });
        } catch (error) {
          console.error(`Error adding documents to index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Query vector database
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/query$/) && req.method === "POST") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const body = await req.json();
          const query = body.query;
          const options: IQueryOptions = {
            k: body.k || 10,
            threshold: body.threshold || 0,
            includeMetadata: body.includeMetadata !== false
          };
          
          const results = await vectorDBManager.queryIndex(indexId, query, options);
          
          return jsonResponse({
            results,
            count: results.length,
            query: typeof query === "string" ? query : "[vector]"
          });
        } catch (error) {
          console.error(`Error querying index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Remove documents from vector database
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/documents$/) && req.method === "DELETE") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const body = await req.json();
          const documentIds: string[] = body.documentIds || [];
          
          await vectorDBManager.removeDocuments(indexId, documentIds);
          
          const instance = vectorDBManager.getInstance(indexId);
          return jsonResponse({
            success: true,
            message: `Removed ${documentIds.length} documents`,
            documentCount: instance?.documentCount || 0
          });
        } catch (error) {
          console.error(`Error removing documents from index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Delete vector database index
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+$/) && req.method === "DELETE") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          await vectorDBManager.destroyIndex(indexId);
          return jsonResponse({
            success: true,
            message: `Index ${indexId} deleted successfully`
          });
        } catch (error) {
          console.error(`Error deleting index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Ping vector database index to reset activity timer
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/ping$/) && req.method === "POST") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const success = vectorDBManager.pingInstance(indexId);
          
          if (!success) {
            return jsonResponse({ error: "Failed to ping vector index or index not found" }, Status.NotFound);
          }
          
          return jsonResponse({ 
            success: true, 
            message: "Vector index activity timer reset",
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error pinging vector index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Set vector database index inactivity timeout
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/timeout$/) && req.method === "POST") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const body = await req.json();
          const timeout = body.timeout;
          
          if (typeof timeout !== "number" || timeout < 0) {
            return jsonResponse({ error: "Invalid timeout value" }, Status.BadRequest);
          }
          
          const success = vectorDBManager.setInactivityTimeout(indexId, timeout);
          
          if (!success) {
            return jsonResponse({ error: "Vector index not found" }, Status.NotFound);
          }
          
          return jsonResponse({ 
            success: true, 
            message: `Inactivity timeout set to ${timeout}ms`,
            timeout: timeout,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error setting timeout for vector index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Manual offload vector database index
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/offload$/) && req.method === "POST") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          await vectorDBManager.manualOffload(indexId);
          
          return jsonResponse({ 
            success: true, 
            message: "Vector index offloaded successfully",
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          console.error(`Error offloading vector index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // List offloaded vector database indices
      if (path === "/api/vectordb/offloaded" && req.method === "GET") {
        try {
          const url = new URL(req.url);
          const namespace = url.searchParams.get("namespace") || undefined;
          
          const offloadedIndices = await vectorDBManager.listOffloadedIndices(namespace);
          
          return jsonResponse({
            indices: offloadedIndices.map(index => ({
              id: index.id,
              namespace: index.namespace,
              created: index.created.toISOString(),
              offloadedAt: index.offloadedAt.toISOString(),
              documentCount: index.documentCount,
              embeddingDimension: index.embeddingDimension
            })),
            count: offloadedIndices.length
          });
        } catch (error) {
          console.error("Error listing offloaded vector indices:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Delete offloaded vector database index
      if (path.match(/^\/api\/vectordb\/offloaded\/[^\/]+$/) && req.method === "DELETE") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          await vectorDBManager.deleteOffloadedIndex(indexId);
          
          return jsonResponse({
            success: true,
            message: `Offloaded vector index ${indexId} deleted successfully`
          });
        } catch (error) {
          console.error(`Error deleting offloaded vector index ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get vector database index info with activity monitoring data
      if (path.match(/^\/api\/vectordb\/indices\/[^\/]+\/info$/) && req.method === "GET") {
        const indexId = decodeURIComponent(path.split("/")[4]);
        
        try {
          const instance = vectorDBManager.getInstance(indexId);
          if (!instance) {
            return jsonResponse({ error: "Vector index not found" }, Status.NotFound);
          }
          
          const lastActivity = vectorDBManager.getLastActivityTime(indexId);
          const timeUntilOffload = vectorDBManager.getTimeUntilOffload(indexId);
          const inactivityTimeout = vectorDBManager.getInactivityTimeout(indexId);
          
          const namespaceMatch = indexId.match(/^([^:]+):/);
          const namespace = namespaceMatch ? namespaceMatch[1] : undefined;
          
          return jsonResponse({
            id: indexId,
            namespace: namespace,
            documentCount: instance.documentCount,
            embeddingDimension: instance.embeddingDimension,
            created: instance.created.toISOString(),
            isFromOffload: instance.isFromOffload || false,
            activityMonitoring: {
              lastActivity: lastActivity ? new Date(lastActivity).toISOString() : undefined,
              timeUntilOffload: timeUntilOffload,
              inactivityTimeout: inactivityTimeout,
              enabled: instance.options.enableActivityMonitoring !== false && vectorDBActivityMonitoring
            }
          });
        } catch (error) {
          console.error(`Error getting vector index info ${indexId}:`, error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Generate random documents for testing
      if (path === "/api/vectordb/generate-documents" && req.method === "POST") {
        try {
          const body = await req.json();
          const count = Math.min(body.count || 10, 100); // Limit to 100 documents
          
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
          
          for (let i = 0; i < count; i++) {
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
          
          return jsonResponse({
            documents,
            count: documents.length,
            message: `Generated ${documents.length} random documents`
          });
        } catch (error) {
          console.error("Error generating random documents:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Agent API Routes
      
      // List agents
      if (path === "/api/agents" && req.method === "GET") {
        try {
          const namespace = getNamespaceFromRequest(req);
          const agents = agentManager.listAgents(namespace);
          return jsonResponse(agents);
        } catch (error) {
          console.error("Error listing agents:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get agent stats
      if (path === "/api/agents/stats" && req.method === "GET") {
        try {
          const stats = agentManager.getStats();
          return jsonResponse(stats);
        } catch (error) {
          console.error("Error getting agent stats:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Create agent
      if (path === "/api/agents" && req.method === "POST") {
        try {
          const body = await req.json();
          const namespace = getNamespaceFromRequest(req) || body.namespace;
          
          // Convert kernelType string to enum value
          let kernelType: KernelType | undefined;
          if (body.kernelType && typeof body.kernelType === 'string') {
            // Handle both uppercase keys (from frontend) and lowercase values
            const kernelTypeKey = body.kernelType.toUpperCase() as keyof typeof KernelType;
            if (kernelTypeKey in KernelType) {
              kernelType = KernelType[kernelTypeKey];
              console.log(`✅ Converted kernelType "${body.kernelType}" to ${kernelType}`);
            } else {
              console.warn(`⚠️ Invalid kernelType: ${body.kernelType}`);
            }
          }
          
          const config: IAgentConfig = {
            id: body.id || crypto.randomUUID(),
            name: body.name || "New Agent",
            description: body.description || "",
            instructions: body.instructions || "You are a helpful assistant.",
            startupScript: body.startupScript && body.startupScript.trim() ? body.startupScript : undefined,
            kernelType: kernelType,
            maxSteps: body.maxSteps,
            ModelSettings: body.ModelSettings,
            autoAttachKernel: body.autoAttachKernel,
            namespace: namespace
          };
          
          console.log(`🤖 Creating agent with config:`, {
            id: config.id,
            name: config.name,
            kernelType: config.kernelType,
            autoAttachKernel: config.autoAttachKernel,
            namespace: config.namespace
          });
          
          let agentId: string;
          try {
            agentId = await agentManager.createAgent(config);
          } catch (error) {
            // If we hit the namespace limit, try cleaning up old agents
            if (error instanceof Error && error.message.includes('Maximum number of agents per namespace') && namespace) {
              console.log(`🧹 Namespace limit reached for ${namespace}, cleaning up old agents...`);
              const cleanedUp = await agentManager.cleanupOldAgentsInNamespace(namespace, 5);
              console.log(`🧹 Cleaned up ${cleanedUp} old agents in namespace ${namespace}`);
              
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
          
          return jsonResponse({
            id: agentId,
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
            maxSteps: updatedAgent?.maxSteps,
            namespace: namespace
          });
        } catch (error) {
          console.error("Error creating agent:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Get agent info
      if (path.match(/^\/api\/agents\/[^\/]+$/) && req.method === "GET") {
        try {
          const agentId = decodeURIComponent(path.split("/")[3]);
          const namespace = getNamespaceFromRequest(req);
          const validAgentId = validateAgentAccess(agentId, namespace);
          const agent = agentManager.getAgent(validAgentId);
          
          if (!agent) {
            return jsonResponse({ error: "Agent not found" }, Status.NotFound);
          }
          
          return jsonResponse({
            id: agent.id,
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
          });
        } catch (error) {
          console.error("Error getting agent info:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Update agent
      if (path.match(/^\/api\/agents\/[^\/]+$/) && req.method === "PUT") {
        try {
          const agentId = decodeURIComponent(path.split("/")[3]);
          const namespace = getNamespaceFromRequest(req);
          const validAgentId = validateAgentAccess(agentId, namespace);
          const body = await req.json();
          
          await agentManager.updateAgent(validAgentId, {
            name: body.name,
            description: body.description,
            instructions: body.instructions,
            startupScript: body.startupScript && body.startupScript.trim() ? body.startupScript : undefined,
            kernelType: body.kernelType ? KernelType[body.kernelType as keyof typeof KernelType] : undefined,
            maxSteps: body.maxSteps,
            ModelSettings: body.ModelSettings
          });
          
          const agent = agentManager.getAgent(validAgentId);
          return jsonResponse({
            success: true,
            message: "Agent updated successfully",
            agent: {
              id: agent?.id,
              name: agent?.name,
              description: agent?.description,
              instructions: agent?.instructions,
              startupScript: agent?.startupScript,
              kernelType: agent?.kernelType,
              hasKernel: !!agent?.kernel
            }
          });
        } catch (error) {
          console.error("Error updating agent:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Delete agent
      if (path.match(/^\/api\/agents\/[^\/]+$/) && req.method === "DELETE") {
        try {
          const agentId = decodeURIComponent(path.split("/")[3]);
          const namespace = getNamespaceFromRequest(req);
          const validAgentId = validateAgentAccess(agentId, namespace);
          
          await agentManager.destroyAgent(validAgentId);
          
          return jsonResponse({
            success: true,
            message: `Agent ${agentId} deleted successfully`
          });
        } catch (error) {
          console.error("Error deleting agent:", error);
          return jsonResponse(
            { error: error instanceof Error ? error.message : String(error) },
            Status.InternalServerError
          );
        }
      }

      // Chat with agent (regular - modifies history)
      if (path.startsWith("/api/agents/") && req.method === "POST" && path.endsWith("/chat")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          const body = await req.json();
          const { message } = body;
          
          if (!message || typeof message !== 'string') {
            return jsonResponse({ error: "Message is required and must be a string" }, Status.BadRequest);
          }
          
          const agent = agentManager.getAgent(validAgentId);
          if (!agent) {
            return jsonResponse({ error: "Agent not found" }, Status.NotFound);
          }
          
          // Return streaming response for regular chat
          const stream = new ReadableStream({
            async start(controller) {
              try {
                const encoder = new TextEncoder();
                
                // Send initial headers
                const headers = "data: " + JSON.stringify({ type: "start", message: "Starting chat..." }) + "\n\n";
                controller.enqueue(encoder.encode(headers));
                
                let hasContent = false;
                
                for await (const chunk of agent.chatCompletion([{ role: 'user', content: message }])) {
                  hasContent = true;
                  const data = "data: " + JSON.stringify(chunk) + "\n\n";
                  controller.enqueue(encoder.encode(data));
                  
                  if (chunk.type === 'error') {
                    break;
                  }
                }
                
                if (!hasContent) {
                  const errorData = "data: " + JSON.stringify({ 
                    type: "error", 
                    error: "Agent completed without generating any response" 
                  }) + "\n\n";
                  controller.enqueue(encoder.encode(errorData));
                }
                
                // Send completion signal
                const endData = "data: " + JSON.stringify({ type: "complete" }) + "\n\n";
                controller.enqueue(encoder.encode(endData));
              } catch (error) {
                const encoder = new TextEncoder();
                const errorData = "data: " + JSON.stringify({ 
                  type: "error", 
                  error: error instanceof Error ? error.message : String(error) 
                }) + "\n\n";
                controller.enqueue(encoder.encode(errorData));
              } finally {
                controller.close();
              }
            }
          });
          
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Namespace"
            }
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Chat with agent (stateless - no history modification)
      if (path.startsWith("/api/agents/") && req.method === "POST" && path.endsWith("/chat-stateless")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          const body = await req.json();
          const { messages } = body;
          
          if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return jsonResponse({ error: "Messages array is required and cannot be empty" }, Status.BadRequest);
          }
          
          const agent = agentManager.getAgent(validAgentId);
          if (!agent) {
            return jsonResponse({ error: "Agent not found" }, Status.NotFound);
          }
          
          // Return streaming response for stateless chat
          const stream = new ReadableStream({
            async start(controller) {
              try {
                const encoder = new TextEncoder();
                
                // Send initial headers
                const headers = "data: " + JSON.stringify({ type: "start", message: "Starting stateless chat..." }) + "\n\n";
                controller.enqueue(encoder.encode(headers));
                
                let hasContent = false;
                
                for await (const chunk of agent.statelessChatCompletion(messages)) {
                  hasContent = true;
                  const data = "data: " + JSON.stringify(chunk) + "\n\n";
                  controller.enqueue(encoder.encode(data));
                  
                  if (chunk.type === 'error') {
                    break;
                  }
                }
                
                if (!hasContent) {
                  const errorData = "data: " + JSON.stringify({ 
                    type: "error", 
                    error: "Agent completed without generating any response" 
                  }) + "\n\n";
                  controller.enqueue(encoder.encode(errorData));
                }
                
                // Send completion signal
                const endData = "data: " + JSON.stringify({ type: "complete" }) + "\n\n";
                controller.enqueue(encoder.encode(endData));
              } catch (error) {
                const encoder = new TextEncoder();
                const errorData = "data: " + JSON.stringify({ 
                  type: "error", 
                  error: error instanceof Error ? error.message : String(error) 
                }) + "\n\n";
                controller.enqueue(encoder.encode(errorData));
              } finally {
                controller.close();
              }
            }
          });
          
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Namespace"
            }
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Get agent conversation history
      if (path.startsWith("/api/agents/") && req.method === "GET" && path.endsWith("/conversation")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          const agent = agentManager.getAgent(validAgentId);
          
          if (!agent) {
            return jsonResponse({ error: "Agent not found" }, Status.NotFound);
          }
          
          return jsonResponse({
            agentId: validAgentId,
            conversation: agent.conversationHistory,
            messages: agent.conversationHistory,
            messageCount: agent.conversationHistory.length,
            length: agent.conversationHistory.length
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Attach kernel to agent
      if (path.startsWith("/api/agents/") && req.method === "POST" && path.endsWith("/kernel")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          const body = await req.json();
          const { kernelType } = body;
          
          if (!kernelType || typeof kernelType !== 'string') {
            return jsonResponse({ error: "kernelType is required and must be a string" }, Status.BadRequest);
          }
          
          // Convert kernelType string to enum value
          const kernelTypeKey = kernelType.toUpperCase() as keyof typeof KernelType;
          if (!(kernelTypeKey in KernelType)) {
            return jsonResponse({ error: `Invalid kernelType: ${kernelType}` }, Status.BadRequest);
          }
          
          const kernelTypeEnum = KernelType[kernelTypeKey];
          await agentManager.attachKernelToAgent(validAgentId, kernelTypeEnum);
          
          const agent = agentManager.getAgent(validAgentId);
          return jsonResponse({
            success: true,
            message: "Kernel attached successfully",
            agentId: validAgentId,
            kernelType: kernelTypeEnum,
            hasKernel: !!agent?.kernel,
            kernelId: agent?.kernelId
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Detach kernel from agent
      if (path.startsWith("/api/agents/") && req.method === "DELETE" && path.endsWith("/kernel")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          await agentManager.detachKernelFromAgent(validAgentId);
          
          return jsonResponse({
            success: true,
            message: "Kernel detached successfully",
            agentId: validAgentId,
            hasKernel: false
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Clear agent conversation
      if (path.startsWith("/api/agents/") && req.method === "DELETE" && path.endsWith("/conversation")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          await agentManager.clearConversation(validAgentId);
          return jsonResponse({ success: true, message: "Conversation cleared successfully" });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Set agent conversation history
      if (path.startsWith("/api/agents/") && req.method === "POST" && path.endsWith("/set-conversation")) {
        const agentId = path.split("/")[3];
        const namespace = getNamespaceFromRequest(req);
        
        try {
          const validAgentId = validateAgentAccess(agentId, namespace);
          const body = await req.json();
          const { messages } = body;
          
          if (!messages || !Array.isArray(messages)) {
            return jsonResponse({ error: "Messages must be an array" }, Status.BadRequest);
          }
          
          await agentManager.setConversationHistory(validAgentId, messages);
          return jsonResponse({ 
            success: true, 
            message: `Conversation history set with ${messages.length} messages`,
            messageCount: messages.length
          });
        } catch (error) {
          return jsonResponse({ 
            error: error instanceof Error ? error.message : "Unknown error occurred" 
          }, Status.InternalServerError);
        }
      }

      // Not found
      return jsonResponse({ error: "Not found" }, Status.NotFound);
    }

    // Not found
    return jsonResponse({ error: "Not found" }, Status.NotFound);
  } catch (error: unknown) {
    console.error("Error handling request:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      Status.InternalServerError,
    );
  }
}

export async function startServer(port = 8000) {
  // Add global error handlers to prevent server crashes
  globalThis.addEventListener("error", (event) => {
    console.error("🚨 Uncaught error:", event.error);
    console.error("Error details:", {
      message: event.error?.message,
      stack: event.error?.stack,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
    // Don't prevent default to allow error reporting but keep server running
  });

  globalThis.addEventListener("unhandledrejection", (event) => {
    console.error("🚨 Unhandled promise rejection:", event.reason);
    console.error("Promise rejection details:", {
      reason: event.reason,
      stack: event.reason?.stack,
      promise: event.promise
    });
    // Prevent the unhandled rejection from crashing the process
    event.preventDefault();
  });

  console.log(`Starting kernel HTTP server on port ${port}...`);
  return Deno.serve({ port }, handleRequest);
}

// Start the server if this is the main module
if (import.meta.main) {
  const port = Deno.args[0] ? parseInt(Deno.args[0], 10) : 8000;
  await startServer(port);
} 