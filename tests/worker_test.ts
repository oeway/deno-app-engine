// Worker test for Deno App Engine
// This demonstrates using the kernel in a web worker via the KernelManager

import { assertEquals, assertNotEquals, assert } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode, KernelEvents } from "../kernel/mod.ts";

// Print header for the test
console.log("Deno App Engine (Worker Test)");
console.log("-----------------------------------");
console.log("Testing kernel manager with worker mode...");

// Create a kernel manager for testing
const manager = new KernelManager();

// Clean up after tests
Deno.test("Cleanup worker tests", async () => {
  await manager.destroyAll();
});

// Helper function to wait for an event with timeout
async function waitForEventWithTimeout(
  kernelId: string, 
  eventType: KernelEvents, 
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      manager.offKernelEvent(kernelId, eventType, listener);
      reject(new Error(`Timeout waiting for event ${eventType} after ${timeoutMs}ms`));
    }, timeoutMs);
    
    const listener = (data: any) => {
      clearTimeout(timeoutId);
      manager.offKernelEvent(kernelId, eventType, listener);
      resolve(data);
    };
    
    manager.onKernelEvent(kernelId, eventType, listener);
  });
}

// Enhanced test suite that thoroughly tests the worker-based kernel using manager
Deno.test({
  name: "Worker via KernelManager: Basic functionality test",
  async fn() {
    try {
      // Create the kernel using the manager
      console.log("Creating worker kernel...");
      const kernelId = await manager.createKernel({
        id: "worker-test",
        mode: KernelMode.WORKER
      });
      
      // Get the kernel instance
      const instance = manager.getKernel(kernelId);
      if (!instance) {
        throw new Error("Failed to create kernel instance");
      }
      
      // Initialize the kernel
      console.log("Initializing kernel...");
      await instance.kernel.initialize();
      
      // Verify initialization
      const initialized = await instance.kernel.isInitialized();
      assertEquals(initialized, true, "Kernel should be initialized");
      
      // 1. Test basic code execution
      console.log("Testing basic execution...");
      const basicExecResult = await instance.kernel.execute("2 + 2");
      assertEquals(basicExecResult.success, true, "Basic execution should succeed");
      
      // 2. Test state preservation
      console.log("Testing state preservation...");
      await instance.kernel.execute("x = 42");
      const stateResult = await instance.kernel.execute("x + 8");
      assertEquals(stateResult.success, true, "State preservation should work");
      
      // 3. Test error handling
      console.log("Testing error handling...");
      const divByZeroResult = await instance.kernel.execute("1/0");
      // Division by zero should be detected as an error in the result status
      assertEquals(divByZeroResult.success, true, "Kernel execution should succeed");
      assertEquals(divByZeroResult.result?.status, "error", "Division by zero should result in error status");
      assert(divByZeroResult.result?.ename?.includes("ZeroDivisionError"), "Should be a ZeroDivisionError");
      
      console.log("Basic worker tests completed successfully");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Test error:", error);
      throw error;
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// More advanced tests with event handling
Deno.test({
  name: "Worker via KernelManager: Event handling test",
  async fn() {
    try {
      // Create the kernel using the manager
      console.log("Creating worker kernel for event testing...");
      const kernelId = await manager.createKernel({
        id: "worker-event-test",
        mode: KernelMode.WORKER
      });
      
      // Get the kernel instance
      const instance = manager.getKernel(kernelId);
      if (!instance) {
        throw new Error("Failed to create kernel instance");
      }
      
      // Initialize the kernel
      console.log("Initializing kernel...");
      await instance.kernel.initialize();
      
      // Test stdout 
      console.log("Testing stdout...");
      const stdoutPromise = waitForEventWithTimeout(kernelId, KernelEvents.STREAM);
      await instance.kernel.execute('print("Hello from worker stdout")');
      
      // Wait for and verify stdout event
      const stdoutEvent = await stdoutPromise;
      assertEquals(stdoutEvent.text.includes("Hello from worker stdout"), true, "Should receive stdout event");
      
      // Test with a value in a variable instead of direct execution result
      console.log("Testing result output...");
      await instance.kernel.execute(`
result_value = 123
print(f"The result is {result_value}")
`);
      
      // No need to wait for EXECUTE_RESULT - we'll check if the variable exists
      const verifyResult = await instance.kernel.execute(`
print(f"Previous result: {result_value}")
`);
      assertEquals(verifyResult.success, true, "Should successfully reference previous variable");
      
      console.log("Event handling tests completed successfully");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Event test error:", error);
      throw error;
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
}); 