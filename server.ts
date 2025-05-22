import { KernelManager, KernelMode } from "./kernel/mod.ts";
import { Status } from "https://deno.land/std@0.201.0/http/http_status.ts";
import { contentType } from "https://deno.land/std/media_types/mod.ts";

// Create a global kernel manager instance
const kernelManager = new KernelManager();

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
          console.log("Creating kernel with options:", body);
          
          const kernelId = await kernelManager.createKernel({
            id: body.id || crypto.randomUUID(),
            mode: body.mode || KernelMode.WORKER,
          });
          console.log("Kernel created with ID:", kernelId, "and mode:", body.mode || KernelMode.WORKER);
          
          const kernel = kernelManager.getKernel(kernelId);
          if (!kernel) {
            throw new Error("Failed to get kernel after creation");
          }
          
          console.log("Initializing kernel...");
          try {
            // Check how to initialize this kernel
            if (typeof kernel.kernel.initialize === 'function') {
              await kernel.kernel.initialize();
            } else {
              console.log("Direct initialize not available, assuming already initialized");
            }
            console.log("Kernel initialized successfully");
            
            // Initialize history for this kernel
            kernelHistory.set(kernelId, []);
            
            return jsonResponse({
              id: kernelId,
              mode: kernel.mode,
              status: kernel.kernel.status || "unknown",
              created: kernel.created,
              name: `Kernel-${kernelId.slice(0, 8)}`
            });
          } catch (error: unknown) {
            console.error("Kernel initialization failed:", error);
            // Clean up the failed kernel
            await kernelManager.destroyKernel(kernelId);
            return jsonResponse(
              { error: error instanceof Error ? error.message : String(error) },
              Status.InternalServerError
            );
          }
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
        return new Response(null, { status: Status.NoContent });
      }

      // Get kernel info
      if (path.match(/^\/api\/kernels\/[\w-]+\/info$/) && req.method === "GET") {
        const kernelId = path.split("/")[3];
        const kernel = kernelManager.getKernel(kernelId);
        
        if (!kernel) {
          return jsonResponse({ error: "Kernel not found" }, Status.NotFound);
        }
        
        return jsonResponse({
          id: kernelId,
          name: `Kernel-${kernelId.slice(0, 8)}`,
          mode: kernel.mode,
          created: kernel.created,
          status: kernel.kernel.status || "unknown",
          history: kernelHistory.get(kernelId) || [],
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

          console.log("Creating execution session...");
          const session = await createExecutionSession(kernelId, code);
          console.log("Session created:", session);
          const response = jsonResponse({ session_id: session.id });
          console.log("Response content type:", response.headers.get("Content-Type"));
          console.log("Response body:", await response.clone().json());
          const headers: Record<string, string> = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          console.log("Response headers:", headers);
          return response;
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

          console.log("Getting result for session:", sessionId);
          const result = await session.promise;
          console.log("Result:", result);
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

      // Execute code (non-streaming)
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

          // Create a session
          const session = await createExecutionSession(kernelId, code);

          // Set up streaming response
          const stream = new ReadableStream({
            async start(controller) {
              try {
                // Create a function to send an event
                const sendOutput = (data: any) => {
                  controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + "\n"));
                };

                // Send any existing outputs first
                for (const output of session.outputs) {
                  sendOutput(output);
                }

                // Set up event listener for new outputs
                const outputListener = (output: any) => {
                  sendOutput(output);
                };

                // Add listener to session
                session.listeners = session.listeners || [];
                session.listeners.push(outputListener);

                // Wait for completion or error
                try {
                  await session.promise;
                  controller.close();
                } catch (error) {
                  sendOutput({
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
                const errorOutput = {
                  type: "error",
                  data: { message: error instanceof Error ? error.message : String(error) }
                };
                controller.enqueue(new TextEncoder().encode(JSON.stringify(errorOutput) + "\n"));
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
                // Wait for results and stream them
                const results = await session.promise;
                for (const output of results) {
                  const event = `data: ${JSON.stringify(output)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(event));
                }
                controller.close();
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