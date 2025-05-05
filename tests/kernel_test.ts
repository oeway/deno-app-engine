// Tests for the Kernel in main thread mode
// This file tests the kernel functionality through the kernel manager

import { assert } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode, KernelEvents } from "../kernel/mod.ts";

// Create a single kernel manager instance for all tests
const manager = new KernelManager();
let kernelId: string;

// Helper function to wait for an event
async function waitForEvent(eventType: KernelEvents): Promise<any> {
  return new Promise((resolve) => {
    const listener = (data: any) => {
      manager.offKernelEvent(kernelId, eventType, listener);
      resolve(data);
    };
    manager.onKernelEvent(kernelId, eventType, listener);
  });
}

// Setup: Create a kernel for testing
Deno.test({
  name: "0. Setup kernel",
  async fn() {
    // Create a kernel in main thread mode
    kernelId = await manager.createKernel({
      id: "test-main-thread",
      mode: KernelMode.MAIN_THREAD
    });
    
    // Get the kernel instance
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Initialize the kernel
    await instance?.kernel.initialize();
    assert(await instance?.kernel.isInitialized(), "Kernel should be initialized");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test basic execution
Deno.test({
  name: "1. Kernel initialization and basic execution",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");

    // Test basic execution
    const result = await instance?.kernel.execute("import sys; print(sys.version)");
    assert(result?.success, "Basic execution should succeed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test state preservation
Deno.test({
  name: "2. Execute Python code with state preservation",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test arithmetic expression
    console.log("Testing arithmetic expression...");
    const addResult = await instance?.kernel.execute(`
result = 2 + 3
print(f"Result: {result}")
    `);
    console.log("Addition result:", addResult);
    assert(addResult?.success, "Addition should succeed");
    
    // Test Python functions
    console.log("Testing factorial function...");
    const functionResult = await instance?.kernel.execute(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)

result = factorial(5)
print(f"Factorial of 5: {result}")
    `);
    console.log("Factorial result:", functionResult);
    assert(functionResult?.success, "Factorial function should succeed");
    
    // Test error handling
    console.log("Testing error handling...");
    const divResult = await instance?.kernel.execute("1/0");
    console.log("Division result:", divResult);
    assert(!divResult?.success, "Division by zero should return success=false");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test stdout and stderr streams
Deno.test({
  name: "3. Test stdout and stderr streams",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive stdout
    const stdoutPromise = waitForEvent(KernelEvents.STREAM);
    
    // Execute code that writes to stdout
    await instance?.kernel.execute('print("Hello from stdout")');
    
    // Wait for stdout event
    const stdoutEvent = await stdoutPromise;
    assert(stdoutEvent.name === "stdout" && stdoutEvent.text.includes("Hello from stdout"), 
      "Should receive stdout event");
    
    // Create a promise that will be resolved when we receive stderr
    const stderrPromise = waitForEvent(KernelEvents.STREAM);
    
    // Execute code that writes to stderr
    await instance?.kernel.execute('import sys; sys.stderr.write("Error message on stderr\\n")');
    
    // Wait for stderr event
    const stderrEvent = await stderrPromise;
    assert(stderrEvent.name === "stderr" && stderrEvent.text.includes("Error message on stderr"), 
      "Should receive stderr event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test display data
Deno.test({
  name: "4. Test display data",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive display data
    const displayDataPromise = waitForEvent(KernelEvents.DISPLAY_DATA);
    
    // Execute code that displays HTML
    await instance?.kernel.execute(`
from IPython.display import display, HTML
display(HTML("<b>Bold HTML</b>"))
`);
    
    // Wait for display data event
    const displayDataEvent = await displayDataPromise;
    assert(displayDataEvent?.data?.["text/html"]?.includes("<b>Bold HTML</b>"), 
      "Should receive display data event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test execution result
Deno.test({
  name: "5. Test execution result",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive execution result
    const executeResultPromise = waitForEvent(KernelEvents.EXECUTE_RESULT);
    
    // Execute code that produces a result
    await instance?.kernel.execute('42');
    
    // Wait for execute result event
    const executeResultEvent = await executeResultPromise;
    assert(executeResultEvent?.data?.["text/plain"]?.includes("42"), 
      "Should receive execute result event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test input request
Deno.test({
  name: "6. Test input request",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive input request
    const inputRequestPromise = waitForEvent(KernelEvents.INPUT_REQUEST);
    
    // Start executing code that requests input
    setTimeout(async () => {
      await instance?.kernel.execute('name = input("Enter your name: "); print(f"Hello, {name}")');
    }, 100);
    
    // Wait for input request event
    const inputRequestEvent = await inputRequestPromise;
    assert(inputRequestEvent?.prompt?.includes("Enter your name"), 
      "Should receive input request event");
    
    // Reply to the input request using the interface method
    await instance?.kernel.inputReply({ value: "Test User" });
    
    // Test passes if we get this far without hanging
    assert(true, "Input request test completed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Clean up
Deno.test({
  name: "7. Clean up",
  async fn() {
    await manager.destroyKernel(kernelId);
  },
  sanitizeResources: false,
  sanitizeOps: false
});
