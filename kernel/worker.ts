// Web Worker file for running the Kernel in a separate thread
// Import necessary modules
import * as Comlink from "comlink";
import { Kernel, KernelEvents } from "./index.ts";

// Create a new kernel instance
const kernel = new Kernel();

// Variable to store the event port
let eventPort: MessagePort | null = null;

// Listen for messages to set up the event port
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_EVENT_PORT" && event.data?.port) {
    eventPort = event.data.port;
    setupEventForwarding();
  }
});

// Set up event forwarding from kernel to main thread
function setupEventForwarding() {
  if (!eventPort) return;

  // Forward all kernel events to the main thread
  Object.values(KernelEvents).forEach((eventType) => {
    // Use EventEmitter's on method
    (kernel as any).on(eventType, (data: any) => {
      if (eventPort) {
        eventPort.postMessage({
          type: eventType,
          data
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

// Expose the kernel through Comlink
Comlink.expose(kernel); 