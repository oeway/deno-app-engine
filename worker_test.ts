// Worker test for Deno Code Interpreter
// This demonstrates using the kernel in a web worker via Comlink

import * as Comlink from "comlink";
import { KernelEvents } from "./kernel/index.ts";
import type { Kernel } from "./kernel/index.ts";
import { assertEquals } from "https://deno.land/std/assert/mod.ts";

// Print header for the test
console.log("Deno Code Interpreter (Worker Test)");
console.log("-----------------------------------");
console.log("Initializing Python kernel in worker...");

// Function to create the worker proxy
async function createKernelWorker() {
  // Create a new worker with the worker.ts file
  const worker = new Worker(new URL("./kernel/worker.ts", import.meta.url).href, {
    type: "module",
  });

  // Create a proxy to the worker using Comlink
  const kernel = Comlink.wrap<Kernel>(worker);
  return { kernel, worker };
}

// Function to cleanly terminate worker
function terminateWorker(worker: Worker) {
  worker.terminate();
}

// Simple test that just checks if the kernel initializes and can execute code
Deno.test("Worker: Kernel basic functionality", async () => {
  let worker: Worker | null = null;
  
  try {
    // Create the kernel worker
    const result = await createKernelWorker();
    const kernel = result.kernel;
    worker = result.worker;
    
    // Initialize the kernel
    await kernel.initialize();
    
    // Verify initialization
    const initialized = await kernel.isInitialized();
    assertEquals(initialized, true, "Kernel should be initialized");
    
    // Execute a simple piece of code
    const execResult = await kernel.execute("2 + 2");
    
    // Verify the execution was successful
    assertEquals(execResult.success, true, "Execution should succeed");
    
    // Define a variable and use it in a subsequent execution
    await kernel.execute("x = 42");
    const varResult = await kernel.execute("x + 8");
    
    // Verify the execution was successful
    assertEquals(varResult.success, true, "Variable execution should succeed");
    
    // Test error handling
    const errorResult = await kernel.execute("1/0");
    
    // Verify the execution failed
    assertEquals(errorResult.success, false, "Division by zero should fail");
    assertEquals(
      errorResult.error?.message.includes("ZeroDivisionError"), 
      true, 
      "Error should be ZeroDivisionError"
    );
    
    console.log("Worker tests completed successfully");
  } finally {
    // Clean up
    if (worker) {
      terminateWorker(worker);
    }
  }
}); 