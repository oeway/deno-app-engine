// Worker test for Deno Code Interpreter
// This demonstrates using the kernel in a web worker via Comlink

import * as Comlink from "comlink";
import { KernelEvents } from "./mod.ts";
import type { Kernel } from "./mod.ts";

// Function to create the worker proxy
async function createKernelWorker() {
  // Create a new worker with the worker.ts file
  const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
    type: "module",
  });

  // Create a proxy to the worker using Comlink
  const kernel = Comlink.wrap<Kernel>(worker);
  return { kernel, worker };
}

// Set up event forwarding from worker to main thread
function setupEventForwarding(kernel: any, worker: Worker) {
  // Create a message channel for events
  const { port1, port2 } = new MessageChannel();

  // Set up event listeners
  port1.onmessage = (event) => {
    const { type, data } = event.data;
    switch (type) {
      case KernelEvents.EXECUTE_RESULT:
        console.log("\nResult:", data.data["text/plain"]);
        break;
      case KernelEvents.STREAM:
        if (data.name === "stdout") {
          console.log(data.text);
        } else if (data.name === "stderr") {
          console.error(data.text);
        }
        break;
      case KernelEvents.EXECUTE_ERROR:
        console.error(`\nError (${data.ename}): ${data.evalue}`);
        break;
      default:
        console.log(`Event: ${type}`, data);
    }
  };

  // Transfer port2 to the worker
  worker.postMessage({ type: "SET_EVENT_PORT", port: port2 }, [port2]);
}

// Function to cleanly terminate worker
function terminateWorker(worker: Worker) {
  console.log("Terminating worker...");
  worker.terminate();
  console.log("Worker terminated.");
}

async function main() {
  console.log("Deno Code Interpreter (Worker Test)");
  console.log("-----------------------------------");
  console.log("Initializing Python kernel in worker...");
  
  let worker: Worker | null = null;
  
  try {
    // Create the kernel worker
    const result = await createKernelWorker();
    const kernel = result.kernel;
    worker = result.worker;

    // Set up event forwarding
    setupEventForwarding(kernel, worker);
    
    // Initialize the kernel
    await kernel.initialize();
    console.log("Kernel initialized successfully!");
    
    // Run some basic Python examples
    console.log("\nExample 1: Basic calculation");
    await kernel.execute("2 + 3");
    
    console.log("\nExample 2: Variable assignment and reuse");
    await kernel.execute(`
x = 42
y = "hello"
print(f"{y}, the answer is {x}")
`);
    
    console.log("\nExample 3: Handling errors");
    await kernel.execute("1/0");
    
    console.log("\nDeno Code Interpreter worker test complete!");
  } catch (error) {
    console.error("Failed to initialize the kernel:", error);
  } finally {
    // Make sure to terminate the worker when done
    if (worker) {
      terminateWorker(worker);
    }
  }
}

// Run the main function when this file is run directly
main().catch(console.error); 