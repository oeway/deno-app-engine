import { KernelManager, KernelMode, KernelLanguage } from "./kernel/mod.ts";
import type { IKernelManagerOptions } from "./kernel/manager.ts";
import { Status } from "https://deno.land/std@0.201.0/http/http_status.ts";
import { contentType } from "https://deno.land/std/media_types/mod.ts";

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
  const poolEnabled = Deno.env.get("KERNEL_POOL_ENABLED") === "true";
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

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Serve index.html at root
  if (path === "/" || path === "/index.html") {
    return await serveStaticFile("index.html");
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
          const kernelList = kernelManager.listKernels();
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
          
          const kernelId = await kernelManager.createKernel({
            id: body.id || crypto.randomUUID(),
            mode: body.mode || KernelMode.WORKER,
            lang: body.lang,
          });
          
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            throw new Error("Failed to get kernel after creation");
          }
          
          // Initialize history for this kernel
          kernelHistory.set(kernelId, []);
          
          return jsonResponse({
            id: kernelId,
            mode: kernel.mode,
            language: kernel.language || "python",
            status: kernel.kernel.status || "unknown",
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
        
        return jsonResponse({
          id: kernelId,
          name: `Kernel-${kernelId.slice(0, 8)}`,
          mode: kernel.mode,
          language: kernel.language || "python",
          created: kernel.created,
          status: kernel.kernel.status || "unknown",
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
              try {
                // Create a function to send an event
                const sendEvent = (data: any) => {
                  const event = `data: ${JSON.stringify(data)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(event));
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
                  controller.close();
                } catch (error) {
                  sendEvent({
                    type: "error",
                    data: { message: error instanceof Error ? error.message : String(error) }
                  });
                  controller.close();
                }

                // Clean up listener
                const listenerIndex = session.listeners.indexOf(outputListener);
                if (listenerIndex !== -1) {
                  session.listeners.splice(listenerIndex, 1);
                }
              } catch (error: unknown) {
                const errorEvent = `data: ${JSON.stringify({
                  type: "error",
                  data: { message: error instanceof Error ? error.message : String(error) },
                })}\n\n`;
                controller.enqueue(new TextEncoder().encode(errorEvent));
                controller.close();
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
              try {
                const sendData = (data: any) => {
                  const jsonLine = JSON.stringify(data) + '\n';
                  controller.enqueue(new TextEncoder().encode(jsonLine));
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
                
                controller.close();
                
              } catch (error) {
                console.error(`Stream error for kernel ${kernelId}:`, error);
                const errorData = JSON.stringify({
                  type: "error",
                  data: { message: error instanceof Error ? error.message : String(error) },
                }) + '\n';
                controller.enqueue(new TextEncoder().encode(errorData));
                controller.close();
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
              try {
                // Create a function to send an event
                const sendEvent = (data: any) => {
                  controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
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
                  controller.close();
                } catch (error) {
                  sendEvent({
                    type: "error",
                    data: { message: error instanceof Error ? error.message : String(error) },
                  });
                  controller.close();
                } finally {
                  // Clean up listener
                  const listenerIndex = session.listeners.indexOf(outputListener);
                  if (listenerIndex !== -1) {
                    session.listeners.splice(listenerIndex, 1);
                  }
                }
              } catch (error: unknown) {
                const errorEvent = `data: ${JSON.stringify({
                  type: "error",
                  data: { message: error instanceof Error ? error.message : String(error) },
                })}\n\n`;
                controller.enqueue(new TextEncoder().encode(errorEvent));
                controller.close();
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
  console.log(`Starting kernel HTTP server on port ${port}...`);
  return Deno.serve({ port }, handleRequest);
}

// Start the server if this is the main module
if (import.meta.main) {
  await startServer();
} 