// Tests for the Kernel Manager
// This file tests creating and managing kernels in both main thread and worker modes

import { assert, assertEquals } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode } from "../kernel/manager.ts";
import { KernelEvents } from "../kernel/index.ts";
import { EventEmitter } from "node:events";

// Create a single instance of the kernel manager for all tests
const manager = new KernelManager();

// Helper function to wait for an event
async function waitForEvent(kernelId: string, eventType: KernelEvents): Promise<any> {
  return new Promise((resolve) => {
    const listener = (data: any) => {
      manager.offKernelEvent(kernelId, eventType, listener);
      resolve(data);
    };
    manager.onKernelEvent(kernelId, eventType, listener);
  });
}

// Clean up kernels after all tests
Deno.test("Cleanup", async () => {
  await manager.destroyAll();
});

// Test creating and using a main thread kernel
Deno.test({
  name: "1. Create and use a main thread kernel",
  async fn() {
    // Create a kernel
    const kernelId = await manager.createKernel({
      id: "main-test",
      mode: KernelMode.MAIN_THREAD
    });
    
    assertEquals(kernelId, "main-test", "Kernel ID should match");
    
    // Get the kernel instance
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    assertEquals(instance?.mode, KernelMode.MAIN_THREAD, "Kernel mode should be MAIN_THREAD");
    
    // Initialize the kernel
    await instance?.kernel.initialize();
    assert(await instance?.kernel.isInitialized(), "Kernel should be initialized");
    
    // Set up the event promise before executing code
    const streamPromise = waitForEvent(kernelId, KernelEvents.STREAM);
    
    // Execute code
    const result = await instance?.kernel.execute("print('Hello from main thread kernel')");
    assert(result?.success, "Execution should succeed");
    
    // Wait for the stdout event
    const streamEvent = await streamPromise;
    assert(streamEvent.text.includes("Hello from main thread kernel"), "Should receive correct stdout");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test creating and using a worker kernel
Deno.test({
  name: "2. Create and use a worker kernel",
  async fn() {
    // Create a kernel
    const kernelId = await manager.createKernel({
      id: "worker-test",
      mode: KernelMode.WORKER
    });
    
    assertEquals(kernelId, "worker-test", "Kernel ID should match");
    
    // Get the kernel instance
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    assertEquals(instance?.mode, KernelMode.WORKER, "Kernel mode should be WORKER");
    assert(instance?.worker instanceof Worker, "Worker should be a Worker instance");
    
    // Initialize the kernel
    await instance?.kernel.initialize();
    assert(await instance?.kernel.isInitialized(), "Kernel should be initialized");
    
    // Set up the event promise before executing code
    const streamPromise = waitForEvent(kernelId, KernelEvents.STREAM);
    
    // Execute code
    const result = await instance?.kernel.execute("print('Hello from worker kernel')");
    assert(result?.success, "Execution should succeed");
    
    // Wait for the stdout event
    const streamEvent = await streamPromise;
    assert(streamEvent.text.includes("Hello from worker kernel"), "Should receive correct stdout");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test multiple kernels running simultaneously
Deno.test({
  name: "3. Run multiple kernels simultaneously",
  async fn() {
    // Create two kernels
    const mainKernelId = await manager.createKernel({
      id: "multi-main",
      mode: KernelMode.MAIN_THREAD
    });
    
    const workerKernelId = await manager.createKernel({
      id: "multi-worker",
      mode: KernelMode.WORKER
    });
    
    // Get kernel instances
    const mainInstance = manager.getKernel(mainKernelId);
    const workerInstance = manager.getKernel(workerKernelId);
    
    // Initialize both kernels
    await mainInstance?.kernel.initialize();
    await workerInstance?.kernel.initialize();
    
    // Execute code in both kernels to set distinct variables
    await mainInstance?.kernel.execute("x = 'main'");
    await workerInstance?.kernel.execute("x = 'worker'");
    
    // Set up event promises
    const mainResultPromise = waitForEvent(mainKernelId, KernelEvents.EXECUTE_RESULT);
    const workerResultPromise = waitForEvent(workerKernelId, KernelEvents.EXECUTE_RESULT);
    
    // Execute code to show the variables
    await mainInstance?.kernel.execute("x");
    await workerInstance?.kernel.execute("x");
    
    // Wait for results
    const mainResult = await mainResultPromise;
    const workerResult = await workerResultPromise;
    
    // Check that the kernels have isolated state
    assert(mainResult.data["text/plain"].includes("main"), "Main kernel should have 'main' as x");
    assert(workerResult.data["text/plain"].includes("worker"), "Worker kernel should have 'worker' as x");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test destroying kernels
Deno.test({
  name: "4. Destroy kernels",
  async fn() {
    // Create a kernel
    const kernelId = await manager.createKernel({
      id: "destroy-test"
    });
    
    // Verify kernel exists
    assert(manager.getKernel(kernelId), "Kernel should exist");
    
    // Destroy the kernel
    await manager.destroyKernel(kernelId);
    
    // Verify kernel is gone
    assertEquals(manager.getKernel(kernelId), undefined, "Kernel should be destroyed");
    
    // Verify that calling destroyKernel again throws an error
    try {
      await manager.destroyKernel(kernelId);
      assert(false, "Should throw an error when destroying a non-existent kernel");
    } catch (error) {
      assert(error instanceof Error, "Should throw an Error");
      assert(error.message.includes("not found"), "Error message should indicate kernel not found");
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test automatic kernel ID generation
Deno.test({
  name: "5. Auto-generate kernel IDs",
  async fn() {
    // Create kernels without specifying IDs
    const id1 = await manager.createKernel();
    const id2 = await manager.createKernel();
    
    // Verify they are different
    assert(id1 !== id2, "Auto-generated IDs should be different");
    
    // Verify they follow the expected pattern
    assert(id1.startsWith("kernel-"), "ID should start with 'kernel-'");
    assert(id2.startsWith("kernel-"), "ID should start with 'kernel-'");
    
    // Clean up
    await manager.destroyKernel(id1);
    await manager.destroyKernel(id2);
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test kernel manager events
Deno.test({
  name: "6. Kernel manager events",
  async fn() {
    // Create a kernel
    const kernelId = await manager.createKernel({
      id: "event-test"
    });
    
    // Store the listener for later removal
    let globalListener: (event: { kernelId: string, data: any }) => void;
    
    // Setup promises for global event listeners
    const globalStreamPromise = new Promise<{ kernelId: string, data: any }>(resolve => {
      globalListener = (event: { kernelId: string, data: any }) => {
        if (event.kernelId === kernelId && event.data.text.includes("Event test")) {
          resolve(event);
        }
      };
      
      // Cast to EventEmitter to access on method
      (manager as unknown as EventEmitter).on(KernelEvents.STREAM, globalListener);
    });
    
    // Get kernel
    const instance = manager.getKernel(kernelId);
    await instance?.kernel.initialize();
    
    // Execute code
    await instance?.kernel.execute("print('Event test')");
    
    // Wait for the global event
    const globalEvent = await globalStreamPromise;
    assertEquals(globalEvent.kernelId, kernelId, "Event should include correct kernel ID");
    assert(globalEvent.data.text.includes("Event test"), "Event should include correct output");
    
    // Clean up
    (manager as unknown as EventEmitter).off(KernelEvents.STREAM, globalListener!);
    await manager.destroyKernel(kernelId);
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test event listener management
Deno.test({
  name: "7. Event listener management",
  async fn() {
    // Create two kernels
    const kernel1Id = await manager.createKernel({
      id: "event-kernel-1",
      mode: KernelMode.MAIN_THREAD
    });
    
    const kernel2Id = await manager.createKernel({
      id: "event-kernel-2",
      mode: KernelMode.MAIN_THREAD
    });
    
    // Get kernel instances
    const kernel1 = manager.getKernel(kernel1Id);
    const kernel2 = manager.getKernel(kernel2Id);
    
    // Initialize kernels
    await kernel1?.kernel.initialize();
    await kernel2?.kernel.initialize();
    
    console.log("Kernels initialized");
    
    // Set up tracking for received events
    const receivedEvents: Array<{ kernelId: string, data: any }> = [];
    
    // Set up listeners for both kernels - filtering out newline-only events
    const listener1 = (data: any) => {
      console.log("Listener 1 received event:", data);
      // Only track non-newline events
      if (data.text && data.text.trim() !== "") {
        receivedEvents.push({ kernelId: kernel1Id, data });
      }
    };
    
    const listener2 = (data: any) => {
      console.log("Listener 2 received event:", data);
      // Only track non-newline events
      if (data.text && data.text.trim() !== "") {
        receivedEvents.push({ kernelId: kernel2Id, data });
      }
    };
    
    // Add listeners
    manager.onKernelEvent(kernel1Id, KernelEvents.STREAM, listener1);
    manager.onKernelEvent(kernel2Id, KernelEvents.STREAM, listener2);
    
    console.log("Added kernel event listeners");
    
    // Execute code on both kernels
    console.log("Executing kernel 1 code");
    await kernel1?.kernel.execute("print('Message from kernel 1')");
    
    console.log("Executing kernel 2 code");
    await kernel2?.kernel.execute("print('Message from kernel 2')");
    
    // Wait longer for events to be processed
    console.log("Waiting for events...");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Debug output
    console.log("Received events:", receivedEvents.length);
    receivedEvents.forEach((evt, i) => {
      console.log(`Event ${i+1}:`, evt.kernelId, evt.data?.text);
    });
    
    // Check that both events were received by the correct listeners
    assert(receivedEvents.length === 2, "Should receive exactly 2 events");
    assert(receivedEvents.some(e => e.kernelId === kernel1Id && e.data.text.includes("kernel 1")), 
      "Should receive event from kernel 1");
    assert(receivedEvents.some(e => e.kernelId === kernel2Id && e.data.text.includes("kernel 2")), 
      "Should receive event from kernel 2");
    
    // Reset tracking and remove listener for kernel 1
    console.log("Removing listener for kernel 1");
    receivedEvents.length = 0;
    manager.offKernelEvent(kernel1Id, KernelEvents.STREAM, listener1);
    
    // Execute code on both kernels again
    console.log("Executing second round of code");
    await kernel1?.kernel.execute("print('Second message from kernel 1')");
    await kernel2?.kernel.execute("print('Second message from kernel 2')");
    
    // Wait longer for events to be processed
    console.log("Waiting for second round of events...");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Debug output
    console.log("Received events (second round):", receivedEvents.length);
    receivedEvents.forEach((evt, i) => {
      console.log(`Event ${i+1}:`, evt.kernelId, evt.data?.text);
    });
    
    // Check that only the kernel 2 event was received
    assert(receivedEvents.length === 1, "Should receive exactly 1 event after removing listener");
    assert(receivedEvents[0].kernelId === kernel2Id, "Remaining event should be from kernel 2");
    assert(receivedEvents[0].data.text.includes("kernel 2"), "Remaining event should contain correct text");
    
    // Clean up
    await manager.destroyKernel(kernel1Id);
    await manager.destroyKernel(kernel2Id);
  },
  sanitizeResources: false,
  sanitizeOps: false
}); 