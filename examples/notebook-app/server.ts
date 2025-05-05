// Notebook application server
// This file sets up a server for a Jupyter-like notebook interface

import { Application, Router } from "https://deno.land/x/oak/mod.ts";
import { KernelManager, KernelMode, KernelEvents } from "../../kernel/mod.ts";

// Create global kernel manager instance
const manager = new KernelManager();

// Create a simple in-memory store for notebooks
const notebooks: Record<string, any> = {};

// Create Oak application and router
const app = new Application();
const router = new Router();

// Middleware for logging requests
app.use(async (ctx, next) => {
  console.log(`${ctx.request.method} ${ctx.request.url.pathname}`);
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  ctx.response.headers.set("X-Response-Time", `${ms}ms`);
});

// API Routes for kernel management
router.post("/api/kernels", async (ctx) => {
  try {
    // Create a new kernel
    const kernelId = await manager.createKernel({
      mode: KernelMode.WORKER // Use worker mode by default for isolation
    });
    
    // Get the kernel instance
    const instance = manager.getKernel(kernelId);
    
    // Initialize the kernel
    await instance?.kernel.initialize();
    
    ctx.response.body = { kernelId, status: "created" };
    ctx.response.status = 201;
  } catch (error: unknown) {
    console.error("Error creating kernel:", error);
    ctx.response.body = { error: error instanceof Error ? error.message : String(error) };
    ctx.response.status = 500;
  }
});

router.get("/api/kernels", (ctx) => {
  // List all kernels
  const kernelIds = manager.getKernelIds();
  ctx.response.body = { kernels: kernelIds };
});

router.get("/api/kernels/:id", async (ctx) => {
  // Get kernel info
  const kernelId = ctx.params.id;
  const instance = manager.getKernel(kernelId);
  
  if (!instance) {
    ctx.response.body = { error: `Kernel ${kernelId} not found` };
    ctx.response.status = 404;
    return;
  }
  
  ctx.response.body = {
    id: kernelId,
    mode: instance.mode,
    isInitialized: await instance.kernel.isInitialized()
  };
});

router.delete("/api/kernels/:id", async (ctx) => {
  // Destroy a kernel
  const kernelId = ctx.params.id;
  
  try {
    await manager.destroyKernel(kernelId);
    ctx.response.body = { status: "destroyed" };
  } catch (error: unknown) {
    ctx.response.body = { error: error instanceof Error ? error.message : String(error) };
    ctx.response.status = 404;
  }
});

// API Route for executing code
router.post("/api/kernels/:id/execute", async (ctx) => {
  const kernelId = ctx.params.id;
  const instance = manager.getKernel(kernelId);
  
  if (!instance) {
    ctx.response.body = { error: `Kernel ${kernelId} not found` };
    ctx.response.status = 404;
    return;
  }
  
  // Check if body exists
  if (!ctx.request.hasBody) {
    ctx.response.body = { error: "No request body" };
    ctx.response.status = 400;
    return;
  }
  
  try {
    // Get the request body using the correct method
    const body = await ctx.request.body.json();
    
    if (!body || !body.code) {
      ctx.response.body = { error: "No code provided" };
      ctx.response.status = 400;
      return;
    }
    
    const cellId = body.cellId; // Get the cell ID
    
    // Execute the code (let the event handlers in the client handle the output)
    const result = await instance.kernel.execute(body.code);
    
    // Add cell ID to the response
    if (cellId) {
      ctx.response.body = {
        ...result,
        cellId
      };
    } else {
      ctx.response.body = result;
    }
  } catch (error: unknown) {
    console.error("Error executing code:", error);
    ctx.response.body = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
    ctx.response.status = 500;
  }
});

// WebSocket endpoint for real-time kernel events
router.get("/api/kernels/:id/events", (ctx) => {
  if (!ctx.isUpgradable) {
    ctx.response.status = 400;
    ctx.response.body = "WebSocket connection required";
    return;
  }
  
  const kernelId = ctx.params.id;
  const instance = manager.getKernel(kernelId);
  
  if (!instance) {
    ctx.response.status = 404;
    ctx.response.body = { error: `Kernel ${kernelId} not found` };
    return;
  }
  
  // Get the current cell ID from query string
  const url = new URL(ctx.request.url);
  const cellId = url.searchParams.get("cellId");
  
  // Upgrade to WebSocket connection
  const ws = ctx.upgrade();
  
  // Create a map for event listeners
  const listeners = new Map<string, (data: any) => void>();
  
  // Register all event listeners
  Object.values(KernelEvents).forEach(eventType => {
    const listener = (data: any) => {
      // Send the event to the client, include cellId if available
      if (ws.readyState === WebSocket.OPEN) {
        // Include the cellId in the event data
        const enhancedData = cellId ? { ...data, cell_id: cellId } : data;
        
        ws.send(JSON.stringify({
          type: eventType,
          data: enhancedData
        }));
      }
    };
    
    // Store the listener for later removal
    listeners.set(eventType, listener);
    
    // Register the listener
    manager.onKernelEvent(kernelId, eventType, listener);
  });
  
  // Handle WebSocket close
  ws.onclose = () => {
    // Clean up all listeners when WebSocket is closed
    listeners.forEach((listener, eventType) => {
      manager.offKernelEvent(kernelId, eventType as KernelEvents, listener);
    });
    listeners.clear();
  };
  
  // Handle WebSocket messages (for input reply)
  ws.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      
      if (message.type === "input_reply") {
        // Handle input reply
        await instance.kernel.inputReply(message.content);
      } else if (message.type === "set_cell_id") {
        // Update the cell ID when a new cell is being executed
        const newCellId = message.cellId;
        // We would store this in a map of active WebSockets by cell ID
        // For now, just log it
        console.log(`Updated cell ID for WebSocket to: ${newCellId}`);
      }
    } catch (error) {
      console.error("Error handling WebSocket message:", error);
    }
  };
});

// Routes for notebook management
router.post("/api/notebooks", async (ctx) => {
  // Check if body exists
  if (!ctx.request.hasBody) {
    ctx.response.body = { error: "No request body" };
    ctx.response.status = 400;
    return;
  }
  
  try {
    // Get the request body using the correct method
    const body = await ctx.request.body.json();
    
    if (!body || !body.name) {
      ctx.response.body = { error: "Notebook name is required" };
      ctx.response.status = 400;
      return;
    }
    
    const id = crypto.randomUUID();
    notebooks[id] = {
      id,
      name: body.name,
      cells: body.cells || [],
      created_at: new Date().toISOString()
    };
    
    ctx.response.body = { id, status: "created" };
    ctx.response.status = 201;
  } catch (error: unknown) {
    ctx.response.body = { error: error instanceof Error ? error.message : String(error) };
    ctx.response.status = 400;
  }
});

router.get("/api/notebooks", (ctx) => {
  ctx.response.body = Object.values(notebooks).map(notebook => ({
    id: notebook.id,
    name: notebook.name,
    created_at: notebook.created_at
  }));
});

router.get("/api/notebooks/:id", (ctx) => {
  const id = ctx.params.id;
  const notebook = notebooks[id];
  
  if (!notebook) {
    ctx.response.body = { error: `Notebook ${id} not found` };
    ctx.response.status = 404;
    return;
  }
  
  ctx.response.body = notebook;
});

router.put("/api/notebooks/:id", async (ctx) => {
  const id = ctx.params.id;
  const notebook = notebooks[id];
  
  if (!notebook) {
    ctx.response.body = { error: `Notebook ${id} not found` };
    ctx.response.status = 404;
    return;
  }
  
  // Check if body exists
  if (!ctx.request.hasBody) {
    ctx.response.body = { error: "No request body" };
    ctx.response.status = 400;
    return;
  }
  
  try {
    // Get the request body using the correct method
    const body = await ctx.request.body.json();
    
    // Update notebook
    notebooks[id] = {
      ...notebook,
      ...body,
      updated_at: new Date().toISOString()
    };
    
    ctx.response.body = { status: "updated" };
  } catch (error: unknown) {
    ctx.response.body = { error: error instanceof Error ? error.message : String(error) };
    ctx.response.status = 400;
  }
});

// Serve static files
app.use(async (ctx, next) => {
  try {
    await ctx.send({
      root: `./static`,
      index: "index.html",
    });
  } catch {
    await next();
  }
});

// Use the router
app.use(router.routes());
app.use(router.allowedMethods());

// Start the server
const port = 8200;
console.log(`Notebook server starting on http://localhost:${port}/`);

app.addEventListener("listen", ({ hostname, port, secure }) => {
  console.log(
    `Listening on: ${secure ? "https://" : "http://"}${
      hostname ?? "localhost"
    }:${port}`
  );
});

// Clean up kernels on exit
Deno.addSignalListener("SIGINT", async () => {
  console.log("Cleaning up kernels...");
  await manager.destroyAll();
  Deno.exit();
});

await app.listen({ port });

// Helper function to get all active WebSocket connections for a kernel
function getActiveWebSockets(kernelId: string): WebSocket[] {
  // This is a simplification - in a real app you'd need to track WebSocket connections
  // Return all active WebSocket connections for this kernel
  // For now we'll just return an empty array since the code above isn't actually using it
  return [];
} 