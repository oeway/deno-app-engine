// Web Worker file for running the Kernel in a separate thread
// Import necessary modules
import * as Comlink from "comlink";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { Kernel, KernelEvents, IKernelOptions } from "./index.ts";


// Create a new kernel instance
const kernel = new Kernel();

// Variable to store the event port
let eventPort: MessagePort | null = null;

// Store kernel initialization options
let kernelOptions: IKernelOptions = {};

// Listen for messages to set up the event port and initialize kernel
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_EVENT_PORT" && event.data?.port) {
    eventPort = event.data.port;
    setupEventForwarding();
  } else if (event.data?.type === "INITIALIZE_KERNEL") {
    // Save the options for kernel initialization
    kernelOptions = event.data.options || {};
    
    // Initialize the kernel with the provided options
    initializeKernel(kernelOptions).catch(error => {
      console.error("[WORKER] Error initializing kernel in worker:", error);
      if (eventPort) {
        eventPort.postMessage({
          type: KernelEvents.EXECUTE_ERROR,
          data: {
            ename: "WorkerInitError",
            evalue: `Failed to initialize kernel: ${error.message}`,
            traceback: [error.stack || ""]
          }
        });
      }
    });
  }
});

// Initialize the kernel with provided options
async function initializeKernel(options: IKernelOptions): Promise<void> {
  try {
    console.log("Initializing kernel in worker with options:", options);
    await kernel.initialize(options);
    
    if (eventPort) {
      eventPort.postMessage({
        type: "KERNEL_INITIALIZED",
        data: { success: true }
      });
    }
  } catch (error) {
    console.error("Kernel initialization failed:", error);
    throw error;
  }
}

// Set up event forwarding from kernel to main thread
function setupEventForwarding() {
  if (!eventPort) return;

  // Forward all kernel events to the main thread
  Object.values(KernelEvents).forEach((eventType) => {
    // Cast kernel to EventEmitter to access the 'on' method
    (kernel as unknown as EventEmitter).on(eventType, (data: any) => {
      if (eventPort) {
        // Send just the event type and raw data
        // This matches the structure used in main thread mode
        eventPort.postMessage({
          type: eventType,
          data: data // Keep data in same format as direct kernel events
        });
      }
    });
  });
}

// Handle cleanup when worker is terminated
self.addEventListener("beforeunload", async () => {
  // Close any resources or connections
  try {
    // Send a final message before termination if needed
    if (eventPort) {
      eventPort.postMessage({
        type: "WORKER_TERMINATING",
        data: { message: "Worker is shutting down" }
      });
    }
    
    // Clean up any Pyodide resources if kernel has them
    if ((kernel as any).pyodide) {
      console.log("Cleaning up Pyodide resources...");
      // Any cleanup needed for Pyodide
    }
  } catch (error) {
    console.error("Error during worker cleanup:", error);
  }
});

// Log available methods for debugging

// Create a simplified proxy that only exposes the methods we need
// We're not trying to implement the full EventEmitter interface
const simpleProxy = {
  // Required methods from IKernel interface
  initialize: async (options?: IKernelOptions) => {
    try {
      await kernel.initialize(options);
      return undefined;
    } catch (error) {
      console.error("[WORKER] Initialize error:", error);
      throw error;
    }
  },
  
  execute: async (code: string, parent?: any) => {
      try {
      const result = await kernel.execute(code, parent);
      return result;
    } catch (error) {
      console.error("[WORKER] Execute error:", error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  },
  
  isInitialized: () => {
    try {
      const result = kernel.isInitialized();
      return result;
    } catch (error) {
      console.error("[WORKER] IsInitialized error:", error);
      return false;
    }
  },
  
  inputReply: async (content: { value: string }) => {
    try {
      await kernel.inputReply(content);
    } catch (error) {
      console.error("[WORKER] InputReply error:", error);
      throw error;
    }
  },
  
  // Instead of a getter, use a regular method for status
  getStatus: () => {
    try {
      const status = kernel.status;
      return status;
    } catch (error) {
      console.error("[WORKER] getStatus error:", error);
      return "unknown";
    }
  }
};

// Expose the proxy through Comlink
try {
  Comlink.expose(simpleProxy);
} catch (error) {
  console.error("Error exposing proxy:", error);
} 