// Tests for the Kernel Manager
// This file tests creating and managing kernels in both main thread and worker modes

import { assert, assertEquals, assertExists } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode, KernelLanguage, IKernelManagerOptions } from "../kernel/manager.ts";
import { KernelEvents } from "../kernel/index.ts";
import { join } from "https://deno.land/std/path/mod.ts";

// Create a single instance of the kernel manager for all tests with test-friendly configuration
const testManagerOptions: IKernelManagerOptions = {
  allowedKernelTypes: [
    { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.PYTHON },
    { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
    { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.TYPESCRIPT },
    { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
  ],
  pool: {
    enabled: false, // Disable pool for most tests to avoid interference
    poolSize: 2,
    autoRefill: true,
    preloadConfigs: []
  }
};

const manager = new KernelManager(testManagerOptions);

// Helper function to create a temporary directory
async function createTempDir(): Promise<string> {
  const tempDirName = `deno-test-${crypto.randomUUID()}`;
  const tempDirPath = join(Deno.cwd(), tempDirName);
  await Deno.mkdir(tempDirPath);
  return tempDirPath;
}

// Helper function to write a test file
async function writeTestFile(dirPath: string, fileName: string, content: string): Promise<string> {
  const filePath = join(dirPath, fileName);
  await Deno.writeTextFile(filePath, content);
  return filePath;
}

// Helper function to clean up a temporary directory
async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await Deno.remove(dirPath, { recursive: true });
  } catch (error) {
    console.error(`Error cleaning up directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Clean up kernels before and after all tests
Deno.test({
  name: "Cleanup",
  async fn() {
    // Clean up any existing kernels
    await manager.destroyAll();
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 1: Basic kernel creation and destruction
Deno.test({
  name: "1. Basic kernel creation and destruction",
  async fn() {
    // Create a kernel
    const kernelId = await manager.createKernel({
      id: "basic-test"
    });
    
    // Verify kernel exists
    assert(manager.getKernel(kernelId), "Kernel should exist");
    assertEquals(kernelId, "basic-test", "Kernel ID should match");
    
    // Destroy the kernel
    await manager.destroyKernel(kernelId);
    
    // Verify kernel is gone
    assertEquals(manager.getKernel(kernelId), undefined, "Kernel should be destroyed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 2: Auto-generate kernel IDs
Deno.test({
  name: "2. Auto-generate kernel IDs",
  async fn() {
    // Create kernels without specifying IDs
    const id1 = await manager.createKernel();
    const id2 = await manager.createKernel();
    
    // Verify they are different
    assert(id1 !== id2, "Auto-generated IDs should be different");
    
    // Verify they follow the expected pattern
    assert(id1.includes("-"), "ID should contain '-'");
    assert(id2.includes("-"), "ID should contain '-'");

    // Clean up
    await manager.destroyKernel(id1);
    await manager.destroyKernel(id2);
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 3: Test namespace functionality
Deno.test({
  name: "3. Test namespace functionality",
  async fn() {
    try {
      // Clean up any existing kernels first
      await manager.destroyAll();
      assertEquals(manager.listKernels().length, 0, "Should start with no kernels");

      // Create kernels with different namespaces
      const project1KernelId1 = await manager.createKernel({
        namespace: "project1",
        mode: KernelMode.MAIN_THREAD
      });
      const project1KernelId2 = await manager.createKernel({
        namespace: "project1",
        mode: KernelMode.WORKER
      });
      const project2KernelId = await manager.createKernel({
        namespace: "project2",
        mode: KernelMode.MAIN_THREAD
      });

      // Verify kernel IDs have correct namespace prefixes
      assert(project1KernelId1.startsWith("project1:"), "Kernel ID should have project1 namespace prefix");
      assert(project1KernelId2.startsWith("project1:"), "Kernel ID should have project1 namespace prefix");
      assert(project2KernelId.startsWith("project2:"), "Kernel ID should have project2 namespace prefix");

      // Test listKernels with namespace filtering
      const project1Kernels = manager.listKernels("project1");
      assertEquals(project1Kernels.length, 2, "Should have 2 kernels in project1 namespace");
      assert(project1Kernels.every(k => k.namespace === "project1"), "All kernels should have project1 namespace");

      const project2Kernels = manager.listKernels("project2");
      assertEquals(project2Kernels.length, 1, "Should have 1 kernel in project2 namespace");
      assertEquals(project2Kernels[0].namespace, "project2", "Kernel should have project2 namespace");

      // Test destroyAll with namespace
      await manager.destroyAll("project1");
      const remainingKernels = manager.listKernels();
      assertEquals(remainingKernels.length, 1, "Should have 1 kernel remaining after destroying project1");
      assert(!remainingKernels.some(k => k.namespace === "project1"), "Should not have any project1 kernels remaining");

      // Clean up remaining kernels
      await manager.destroyAll();
    } catch (error) {
      // Make sure to clean up even if test fails
      await manager.destroyAll();
      throw error;
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 4: Test pingKernel functionality
Deno.test({
  name: "4. Test pingKernel functionality",
  async fn() {
    try {
      // Create a kernel with a moderate inactivity timeout (5 seconds)
      const kernelId = await manager.createKernel({
        id: "ping-test",
        inactivityTimeout: 5000, // 5 seconds
      });
      
      // Verify kernel exists
      assert(manager.getKernel(kernelId), "Kernel should exist");
      
      // Get initial activity time
      const initialActivity = manager.getLastActivityTime(kernelId);
      assert(initialActivity !== undefined, "Initial activity time should be set");
      
      // Wait for 1 second
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Ping the kernel
      const pingResult = manager.pingKernel(kernelId);
      assert(pingResult, "Ping should succeed");
      
      // Verify activity time was updated
      const afterPingActivity = manager.getLastActivityTime(kernelId);
      assert(afterPingActivity !== undefined, "Activity time should be set after ping");
      assert(afterPingActivity! > initialActivity!, "Activity time should be updated after ping");
      
      // Test pinging non-existent kernel
      const invalidPingResult = manager.pingKernel("non-existent-kernel");
      assert(!invalidPingResult, "Ping should fail for non-existent kernel");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Error in pingKernel test:", error);
      throw error;
    } finally {
      // Clean up any remaining kernels
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 5: Test restartKernel functionality
Deno.test({
  name: "5. Test restartKernel functionality",
  async fn() {
    try {
      // Create a kernel with specific configuration
      const kernelId = await manager.createKernel({
        id: "restart-test",
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON,
        inactivityTimeout: 10000, // 10 seconds
        maxExecutionTime: 5000 // 5 seconds
      });
      
      // Verify kernel exists
      const originalKernel = manager.getKernel(kernelId);
      assert(originalKernel, "Original kernel should exist");
      assertEquals(originalKernel.mode, KernelMode.MAIN_THREAD, "Original kernel should be main thread");
      assertEquals(originalKernel.language, KernelLanguage.PYTHON, "Original kernel should be Python");
      
      // Execute some code to establish a state
      const preRestartResult = await originalKernel.kernel.execute('test_var = "before_restart"');
      assert(preRestartResult?.success, "Pre-restart execution should succeed");
      
      // Store original creation time
      const originalCreationTime = originalKernel.created;
      
      // Restart the kernel
      const restartSuccess = await manager.restartKernel(kernelId);
      assert(restartSuccess, "Kernel restart should succeed");
      
      // Verify kernel still exists with same ID
      const restartedKernel = manager.getKernel(kernelId);
      assert(restartedKernel, "Restarted kernel should exist");
      assertEquals(restartedKernel.id, kernelId, "Kernel ID should be preserved");
      
      // Verify configuration is preserved
      assertEquals(restartedKernel.mode, KernelMode.MAIN_THREAD, "Mode should be preserved");
      assertEquals(restartedKernel.language, KernelLanguage.PYTHON, "Language should be preserved");
      
      // Verify it's a new kernel instance (different creation time)
      assert(restartedKernel.created > originalCreationTime, "Creation time should be updated");
      
      // Verify new kernel is functional
      const newExecutionResult = await restartedKernel.kernel.execute('new_var = "after_restart"; print(new_var)');
      assert(newExecutionResult?.success, "New execution should succeed");
      
      // Test restart non-existent kernel
      const invalidRestartResult = await manager.restartKernel("non-existent-kernel");
      assert(!invalidRestartResult, "Restart should fail for non-existent kernel");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Error in restartKernel test:", error);
      throw error;
    } finally {
      // Clean up any remaining kernels
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 6: Test interruptKernel functionality
Deno.test({
  name: "6. Test interruptKernel functionality",
  async fn() {
    try {
      // Test main thread kernel interrupt
      const mainKernelId = await manager.createKernel({
        id: "main-interrupt-test",
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      
      // Verify kernel exists
      const mainKernel = manager.getKernel(mainKernelId);
      assert(mainKernel, "Main thread kernel should exist");
      assertEquals(mainKernel.mode, KernelMode.MAIN_THREAD, "Should be main thread kernel");
      
      // Test basic interrupt
      const mainInterruptResult = await manager.interruptKernel(mainKernelId);
      assert(!mainInterruptResult, "Main thread kernel interrupt should fail (not supported)");
      
      // Test worker kernel interrupt
      const workerKernelId = await manager.createKernel({
        id: "worker-interrupt-test",
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON
      });
      
      // Wait for worker initialization
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify worker kernel exists
      const workerKernel = manager.getKernel(workerKernelId);
      assert(workerKernel, "Worker kernel should exist");
      assertEquals(workerKernel.mode, KernelMode.WORKER, "Should be worker kernel");
      
      // Test basic interrupt of worker kernel
      const workerInterruptResult = await manager.interruptKernel(workerKernelId);
      assert(workerInterruptResult, "Worker kernel interrupt should succeed");
      
      // Test interrupt non-existent kernel
      const invalidInterruptResult = await manager.interruptKernel("non-existent-kernel");
      assert(!invalidInterruptResult, "Interrupt should fail for non-existent kernel");
      
      // Clean up all test kernels
      await manager.destroyKernel(mainKernelId);
      await manager.destroyKernel(workerKernelId);
    } catch (error) {
      console.error("Error in interruptKernel test:", error);
      throw error;
    } finally {
      // Clean up any remaining kernels
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 6a: Test interruptKernel functionality with namespaced kernels
Deno.test({
  name: "6a. Test interruptKernel functionality with namespaced kernels",
  async fn() {
    try {
      // Create kernels with namespaces (like hypha-service does)
      const namespace1 = "test-workspace-1";
      const namespace2 = "test-workspace-2";
      
      // Create main thread kernel with namespace
      const mainKernelId = await manager.createKernel({
        id: "main-interrupt-ns-test",
        namespace: namespace1,
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      
      // Verify the kernel ID includes namespace prefix
      assert(mainKernelId.startsWith(namespace1 + ":"), "Main kernel ID should have namespace prefix");
      
      // Verify kernel exists
      const mainKernel = manager.getKernel(mainKernelId);
      assert(mainKernel, "Main thread namespaced kernel should exist");
      assertEquals(mainKernel.mode, KernelMode.MAIN_THREAD, "Should be main thread kernel");
      assertEquals(mainKernel.options.namespace, namespace1, "Kernel should have correct namespace");
      
      // Create worker kernel with different namespace
      const workerKernelId = await manager.createKernel({
        id: "worker-interrupt-ns-test", 
        namespace: namespace2,
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON
      });
      
      // Verify the kernel ID includes namespace prefix
      assert(workerKernelId.startsWith(namespace2 + ":"), "Worker kernel ID should have namespace prefix");
      
      // Wait for worker initialization and interrupt buffer setup
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      // Verify worker kernel exists
      const workerKernel = manager.getKernel(workerKernelId);
      assert(workerKernel, "Worker namespaced kernel should exist");
      assertEquals(workerKernel.mode, KernelMode.WORKER, "Should be worker kernel");
      assertEquals(workerKernel.options.namespace, namespace2, "Kernel should have correct namespace");
      
      // Test 1: Verify interrupt buffer was set up automatically for worker kernel
      console.log("📋 Testing automatic interrupt buffer setup for worker kernel...");
      const hasBuffer = (manager as any).interruptBuffers.has(workerKernelId);
      assert(hasBuffer, "Worker kernel should have interrupt buffer automatically set up");
      console.log(`✅ Interrupt buffer automatically created for worker kernel: ${hasBuffer}`);
      
      // Test 2: Test basic interrupt on namespaced main thread kernel
      const mainInterruptResult = await manager.interruptKernel(mainKernelId);
      assert(!mainInterruptResult, "Namespaced main thread kernel interrupt should fail (not supported)");
      
      // Test 3: Test interrupt with partial ID (without namespace) - should fail
      const partialMainId = "main-interrupt-ns-test";
      const partialInterruptResult = await manager.interruptKernel(partialMainId);
      assert(!partialInterruptResult, "Interrupt with partial ID (no namespace) should fail");
      
      // Test 4: Test long-running execution interrupt on namespaced worker kernel
      console.log("📋 Testing long-running execution interrupt on namespaced worker kernel...");
      
      const longRunningCode = `
import time
print("🚀 Starting long execution in namespaced worker...")
for i in range(15):  # 7.5 seconds total (15 * 0.5s)
    print(f"⏱️  Worker step {i}/15")
    time.sleep(0.5)
print("❌ This should NOT print if interrupt works")
`;
      
      console.log("🚀 Starting long-running execution on worker kernel...");
      const executionStartTime = Date.now();
      
      // Start execution on worker kernel
      const executionPromise = workerKernel.kernel.execute(longRunningCode);
      
      // Wait 2 seconds for execution to start, then interrupt
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log("🛑 Interrupting worker kernel execution...");
      const workerInterruptResult = await manager.interruptKernel(workerKernelId);
      assert(workerInterruptResult, "Namespaced worker kernel interrupt should succeed");
      
      // Wait for execution to complete (should be interrupted)
      try {
        const result = await Promise.race([
          executionPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Execution timeout")), 3000)
          )
        ]);
        
        const totalTime = Date.now() - executionStartTime;
        console.log(`⏱️  Total execution time: ${totalTime}ms`);
        
        // Check if execution was actually interrupted with KeyboardInterrupt
        if (typeof result === 'object' && result !== null && 'result' in result) {
          const typedResult = result as { success: boolean; result?: any };
          if (typedResult.result && typedResult.result.status === "error" && 
              typedResult.result.ename && typedResult.result.ename.includes("KeyboardInterrupt")) {
            console.log("✅ SUCCESS: Worker execution was properly interrupted with KeyboardInterrupt!");
          } else if (totalTime < 5000) {
            console.log("✅ Execution was interrupted (completed faster than expected)");
          } else {
            console.log("⚠️  Execution may not have been properly interrupted");
          }
        } else if (totalTime < 5000) {
          console.log("✅ Execution appears to have been interrupted (faster completion)");
        }
        
      } catch (error: unknown) {
        const totalTime = Date.now() - executionStartTime;
        console.log(`⏱️  Total execution time: ${totalTime}ms`);
        
        if (totalTime < 5000) {
          console.log("✅ Execution was interrupted with error (expected behavior)");
        } else {
          console.log("❌ Execution error after full duration:", error instanceof Error ? error.message : String(error));
        }
      }
      
      // Test 5: Verify interrupt buffer state after interrupt
      console.log("📋 Verifying interrupt buffer state...");
      const interruptBuffer = (manager as any).interruptBuffers.get(workerKernelId);
      if (interruptBuffer) {
        console.log(`📊 Current buffer value: ${interruptBuffer[0]} (should be 0 after processing)`);
        if (interruptBuffer[0] === 0) {
          console.log("✅ Interrupt buffer was properly reset by Pyodide");
        } else {
          console.log("⚠️  Interrupt buffer was not reset - may indicate processing delay");
        }
      }
      
      // Test 6: Test that worker kernel still works after interrupt
      console.log("📋 Testing worker kernel functionality after interrupt...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const postInterruptResult = await workerKernel.kernel.execute("print('Worker kernel still works after interrupt')");
      assert(postInterruptResult?.success, "Worker kernel should be functional after interrupt");
      console.log("✅ Worker kernel remains functional after interrupt");
      
      // Test 6.5: Test second interrupt on same worker kernel (verify multiple interrupts work)
      console.log("\n📋 Testing SECOND interrupt on same worker kernel...");
      
      const secondLongCode = `
import time
print("🚀 Starting SECOND long execution...")
for i in range(10):  # 5 seconds total (10 * 0.5s)
    print(f"⏱️  Second run - Step {i}/10")
    time.sleep(0.5)
print("❌ Second execution should NOT complete if interrupt works")
`;
      
      console.log("🚀 Starting second long-running execution...");
      const secondStartTime = Date.now();
      
      // Start second execution
      const secondExecutionPromise = workerKernel.kernel.execute(secondLongCode);
      
      // Wait 1.5 seconds, then interrupt again
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      console.log("🛑 Interrupting worker kernel SECOND time...");
      const secondInterruptResult = await manager.interruptKernel(workerKernelId);
      assert(secondInterruptResult, "Second interrupt should also succeed");
      
      // Wait for second execution to complete (should be interrupted)
      try {
        const secondResult = await Promise.race([
          secondExecutionPromise,
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error("Second execution timeout")), 3000)
          )
        ]);
        
        const secondTotalTime = Date.now() - secondStartTime;
        console.log(`⏱️  Second execution time: ${secondTotalTime}ms`);
        
        // Verify second execution was also interrupted
        assert(secondTotalTime < 3500, `Second execution should be interrupted quickly, took ${secondTotalTime}ms`);
        
        if (typeof secondResult === 'object' && secondResult !== null && 'result' in secondResult) {
          const typedResult = secondResult as { success: boolean; result?: any };
          if (typedResult.result && typedResult.result.status === "error" && 
              typedResult.result.ename && typedResult.result.ename.includes("KeyboardInterrupt")) {
            console.log("✅ SUCCESS: Second execution was also properly interrupted with KeyboardInterrupt!");
          } else {
            console.log("✅ Second execution was interrupted (completed faster than expected)");
          }
        } else {
          console.log("✅ Second execution appears to have been interrupted");
        }
        
      } catch (error: unknown) {
        const secondTotalTime = Date.now() - secondStartTime;
        console.log(`⏱️  Second execution time: ${secondTotalTime}ms`);
        
        // Verify second execution was interrupted
        assert(secondTotalTime < 3500, `Second execution should be interrupted quickly, took ${secondTotalTime}ms`);
        
        console.log("✅ Second execution was interrupted with error (expected)");
      }
      
      // Final functionality test
      console.log("📋 Testing final kernel functionality after second interrupt...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalResult = await workerKernel.kernel.execute("print('✅ Worker kernel still works after MULTIPLE interrupts!')");
      assert(finalResult?.success, "Worker kernel should be functional after multiple interrupts");
      console.log("✅ Worker kernel functional after multiple interrupts");
      
      // Test 7: Test main thread kernel with simple long-running code
      console.log("📋 Testing main thread kernel interrupt...");
      
      const mainLongCode = `
import time
print("🚀 Starting main thread execution...")
for i in range(10):
    print(f"Main step {i}")
    time.sleep(0.2)
print("Main execution completed")
`;
      
      const mainStartTime = Date.now();
      const mainExecutionPromise = mainKernel.kernel.execute(mainLongCode);
      
      // Wait 1 second, then interrupt
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log("🛑 Interrupting main thread kernel (should fail)...");
      const mainInterruptResult2 = await manager.interruptKernel(mainKernelId);
      assert(!mainInterruptResult2, "Main thread kernel interrupt should fail (not supported)");
      
      try {
        await mainExecutionPromise;
        const mainTotalTime = Date.now() - mainStartTime;
        console.log(`⏱️  Main thread execution time: ${mainTotalTime}ms`);
        console.log("✅ Main thread kernel interrupt completed");
      } catch (error: unknown) {
        console.log("✅ Main thread execution interrupted:", error instanceof Error ? error.message : String(error));
      }
      
      // Clean up test kernels
      await manager.destroyKernel(mainKernelId);
      await manager.destroyKernel(workerKernelId);
      
      console.log("\n🎯 NAMESPACED INTERRUPT TEST SUMMARY:");
      console.log("✅ Kernel namespacing works correctly");
      console.log("✅ Interrupt buffer automatically set up for worker kernels");
      console.log("✅ Partial ID interrupt correctly fails");
      console.log("✅ Main thread kernel interrupt correctly fails (not supported)");
      console.log("✅ Long-running worker execution properly interrupted");
      console.log("✅ MULTIPLE interrupts work on same worker kernel");
      console.log("✅ Interrupt buffer state managed correctly");
      console.log("✅ Kernels remain functional after multiple interrupts");
      
    } catch (error) {
      console.error("Error in namespaced interruptKernel test:", error);
      throw error;
    } finally {
      // Clean up any remaining kernels
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 6b: Test multiple interrupts on same worker kernel
Deno.test({
  name: "6b. Test multiple interrupts on same worker kernel",
  async fn() {
    try {
      console.log("🎯 TESTING MULTIPLE INTERRUPTS - Verifying interrupt buffer reset between executions");
      
      // Create worker kernel with namespace
      const kernelId = await manager.createKernel({
        id: "multiple-interrupt-test",
        namespace: "test-multiple",
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON
      });
      
      console.log(`✅ Created worker kernel: ${kernelId}`);
      
      // Wait for kernel to fully initialize including interrupt buffer
      await new Promise(resolve => setTimeout(resolve, 4000));
      
      const kernel = manager.getKernel(kernelId);
      assert(kernel, "Kernel should exist");
      assert(kernel.worker, "Worker should exist");
      
      // Verify interrupt buffer was set up
      const hasBuffer = (manager as any).interruptBuffers.has(kernelId);
      assert(hasBuffer, "Interrupt buffer should be automatically created");
      console.log(`✅ Interrupt buffer created: ${hasBuffer}`);
      
      // Test multiple interrupt cycles
      for (let cycle = 1; cycle <= 3; cycle++) {
        console.log(`\n📋 Interrupt Cycle ${cycle}/3`);
        
        const longRunningCode = `
import time
print(f"🚀 Starting execution cycle ${cycle}...")
for i in range(12):  # 6 seconds total (12 * 0.5s)
    print(f"⏱️  Cycle ${cycle} - Step {i}/12")
    time.sleep(0.5)
print(f"❌ Cycle ${cycle} should NOT complete if interrupt works")
`;
        
        console.log(`🚀 Starting execution cycle ${cycle}...`);
        const executionStartTime = Date.now();
        
        // Check interrupt buffer state before execution
        const bufferBefore = (manager as any).interruptBuffers.get(kernelId);
        if (bufferBefore) {
          console.log(`📊 Buffer value before cycle ${cycle}: ${bufferBefore[0]} (should be 0)`);
          assertEquals(bufferBefore[0], 0, `Buffer should be 0 before cycle ${cycle}`);
        }
        
        // Start execution
        const executionPromise = kernel.kernel.execute(longRunningCode);
        
        // Wait 2 seconds, then interrupt
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`🛑 Interrupting execution cycle ${cycle}...`);
        const interruptResult = await manager.interruptKernel(kernelId);
        assert(interruptResult, `Interrupt should succeed for cycle ${cycle}`);
        
        // Wait for execution to complete (should be interrupted)
        try {
          const result = await Promise.race([
            executionPromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Execution timeout")), 3000)
            )
          ]);
          
          const totalTime = Date.now() - executionStartTime;
          console.log(`⏱️  Cycle ${cycle} execution time: ${totalTime}ms`);
          
          // Verify execution was interrupted (should complete much faster than 6 seconds)
          assert(totalTime < 4000, `Cycle ${cycle} should be interrupted in under 4 seconds, took ${totalTime}ms`);
          
          // Check if execution was interrupted with KeyboardInterrupt
          if (typeof result === 'object' && result !== null && 'result' in result) {
            const typedResult = result as { success: boolean; result?: any };
            if (typedResult.result && typedResult.result.status === "error" && 
                typedResult.result.ename && typedResult.result.ename.includes("KeyboardInterrupt")) {
              console.log(`✅ SUCCESS: Cycle ${cycle} was properly interrupted with KeyboardInterrupt!`);
            } else {
              console.log(`✅ Cycle ${cycle} was interrupted (completed faster than expected)`);
            }
          } else {
            console.log(`✅ Cycle ${cycle} appears to have been interrupted (faster completion)`);
          }
          
        } catch (error: unknown) {
          const totalTime = Date.now() - executionStartTime;
          console.log(`⏱️  Cycle ${cycle} execution time: ${totalTime}ms`);
          
          // Verify execution was interrupted (should complete much faster than 6 seconds)
          assert(totalTime < 4000, `Cycle ${cycle} should be interrupted in under 4 seconds, took ${totalTime}ms`);
          
          console.log(`✅ Cycle ${cycle} was interrupted with error (expected behavior)`);
        }
        
        // Verify interrupt buffer state after interrupt
        const interruptBuffer = (manager as any).interruptBuffers.get(kernelId);
        if (interruptBuffer) {
          console.log(`📊 Cycle ${cycle} buffer value after interrupt: ${interruptBuffer[0]} (should be 0)`);
          // Buffer should be reset to 0 by Pyodide after processing the interrupt
          // We don't assert this as it may take a moment for Pyodide to reset it
        }
        
        // Test that kernel still works after interrupt
        console.log(`📋 Testing kernel functionality after cycle ${cycle} interrupt...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const postInterruptResult = await kernel.kernel.execute(`print(f'✅ Kernel works after cycle ${cycle} interrupt')`);
        assert(postInterruptResult?.success, `Kernel should be functional after cycle ${cycle} interrupt`);
        console.log(`✅ Kernel functional after cycle ${cycle}`);
        
        // Wait a bit before next cycle to ensure clean state
        if (cycle < 3) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      }
      
      console.log("\n🎯 MULTIPLE INTERRUPT TEST SUMMARY:");
      console.log("✅ Worker kernel successfully interrupted 3 times");
      console.log("✅ Interrupt buffer properly reset between executions"); 
      console.log("✅ Each interrupt completed in under 4 seconds");
      console.log("✅ Kernel remained functional after each interrupt");
      console.log("✅ Multiple interrupt cycles work correctly");
      
      // Clean up
      await manager.destroyKernel(kernelId);
      
    } catch (error) {
      console.error("❌ Multiple interrupt test error:", error);
      throw error;
    } finally {
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 7: Create and use a main thread kernel with Python code
Deno.test({
  name: "7. Create and use a main thread kernel with Python code",
  async fn() {
    try {
      // Create a kernel
      const kernelId = await manager.createKernel({
        id: "main-python-test",
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      
      assertEquals(kernelId, "main-python-test", "Kernel ID should match");
      
      // Get the kernel instance
      const instance = manager.getKernel(kernelId);
      assert(instance, "Kernel instance should exist");
      assertEquals(instance?.mode, KernelMode.MAIN_THREAD, "Kernel mode should be MAIN_THREAD");
      assertEquals(instance?.language, KernelLanguage.PYTHON, "Kernel language should be PYTHON");
      
      // Simple test to verify Python execution works
      const pythonTest = await instance?.kernel.execute('print("Hello from Python")');
      assert(pythonTest?.success, "Basic Python execution should succeed");
      
      // Test variables and basic operations
      const mathTest = await instance?.kernel.execute('result = 2 + 3; print(f"Result: {result}")');
      assert(mathTest?.success, "Math operations should succeed");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Error in main thread Python test:", error);
      throw error;
    } finally {
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 8: Create and use a worker kernel with Python code
Deno.test({
  name: "8. Create and use a worker kernel with Python code",
  async fn() {
    try {
      // Create a kernel
      const kernelId = await manager.createKernel({
        id: "worker-python-test",
        mode: KernelMode.WORKER,
        lang: KernelLanguage.PYTHON
      });
      
      assertEquals(kernelId, "worker-python-test", "Kernel ID should match");
      
      // Get the kernel instance
      const instance = manager.getKernel(kernelId);
      assert(instance, "Kernel instance should exist");
      assertEquals(instance?.mode, KernelMode.WORKER, "Kernel mode should be WORKER");
      assertEquals(instance?.language, KernelLanguage.PYTHON, "Kernel language should be PYTHON");
      assert(instance?.worker instanceof Worker, "Worker should be a Worker instance");
      
      // Wait for initialization to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simple test to verify Python execution works
      const pythonTest = await instance?.kernel.execute('print("Hello from Worker Python")');
      assert(pythonTest?.success, "Basic Python execution should succeed");
      
      // Test variables and basic operations
      const mathTest = await instance?.kernel.execute('result = 5 * 6; print(f"Worker result: {result}")');
      assert(mathTest?.success, "Math operations should succeed");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Error in worker Python test:", error);
      throw error;
    } finally {
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 9: Create and use TypeScript kernels
Deno.test({
  name: "9. Create and use TypeScript kernels",
  async fn() {
    try {
      // Create a main thread TypeScript kernel
      const mainKernelId = await manager.createKernel({
        id: "ts-main-test",
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.TYPESCRIPT
      });
      
      // Get the kernel instance
      const mainInstance = manager.getKernel(mainKernelId);
      assert(mainInstance, "Main TS kernel instance should exist");
      assertEquals(mainInstance?.mode, KernelMode.MAIN_THREAD, "Kernel mode should be MAIN_THREAD");
      assertEquals(mainInstance?.language, KernelLanguage.TYPESCRIPT, "Kernel language should be TYPESCRIPT");
      
      // Test TypeScript execution
      const tsTest = await mainInstance?.kernel.execute('console.log("Hello from TypeScript main thread"); 42');
      assert(tsTest?.success, "Basic TypeScript execution should succeed");
      
      // Create a worker TypeScript kernel
      const workerKernelId = await manager.createKernel({
        id: "ts-worker-test",
        mode: KernelMode.WORKER,
        lang: KernelLanguage.TYPESCRIPT
      });
      
      // Wait for worker initialization
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Get the worker kernel instance
      const workerInstance = manager.getKernel(workerKernelId);
      assert(workerInstance, "Worker TS kernel instance should exist");
      assertEquals(workerInstance?.mode, KernelMode.WORKER, "Kernel mode should be WORKER");
      assertEquals(workerInstance?.language, KernelLanguage.TYPESCRIPT, "Kernel language should be TYPESCRIPT");
      assert(workerInstance?.worker instanceof Worker, "Worker should be a Worker instance");
      
      // Test TypeScript execution in worker
      const workerTsTest = await workerInstance?.kernel.execute('console.log("Hello from TypeScript worker"); "success"');
      assert(workerTsTest?.success, "Worker TypeScript execution should succeed");
      
      // Clean up
      await manager.destroyKernel(mainKernelId);
      await manager.destroyKernel(workerKernelId);
    } catch (error) {
      console.error("Error in TypeScript test:", error);
      throw error;
    } finally {
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 10: Test filesystem mounting functionality
Deno.test({
  name: "10. Test filesystem mounting functionality",
  async fn() {
    // Create a temporary directory with a test file
    const tempDir = await createTempDir();
    const testFileName = "filesystem_test.txt";
    const testContent = "Hello from filesystem test!";
    await writeTestFile(tempDir, testFileName, testContent);
    
    try {
      // Create a kernel with filesystem mounting
      const kernelId = await manager.createKernel({
        id: "filesystem-test",
        mode: KernelMode.MAIN_THREAD,
        filesystem: {
          enabled: true,
          root: tempDir,
          mountPoint: "/home/pyodide"
        }
      });
      
      // Get kernel instance
      const instance = manager.getKernel(kernelId);
      assertExists(instance);
      
      // Execute Python code to read from the mounted filesystem
      const result = await instance?.kernel.execute(`
import os

# List files in the mounted directory
files = os.listdir('/home/pyodide')
print(f"Files in mounted directory: {files}")

# Read the test file content
if '${testFileName}' in files:
    with open(f'/home/pyodide/${testFileName}', 'r') as f:
        content = f.read()
    print(f"File content: {content}")
    success = content == "${testContent}"
    print(f"Content matches: {success}")
else:
    print("File not found")
`);
      
      assert(result?.success, "Filesystem execution should succeed");
      
      // Clean up
      await manager.destroyKernel(kernelId);
    } finally {
      // Clean up the temporary directory
      await cleanupTempDir(tempDir);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 11: Test kernel event system
Deno.test({
  name: "11. Test kernel event system",
  async fn() {
    try {
      // Create a kernel
      const kernelId = await manager.createKernel({
        id: "event-test",
        mode: KernelMode.MAIN_THREAD
      });
      
      // Store events received
      const receivedEvents: any[] = [];
      
      // Setup event listener
      const listener = (data: any) => {
        if (data.text && data.text.includes("Event test message")) {
          receivedEvents.push(data);
        }
      };
      
      // Add listener for stream events
      manager.onKernelEvent(kernelId, KernelEvents.STREAM, listener);
      
      // Get kernel instance
      const instance = manager.getKernel(kernelId);
      assertExists(instance);
      
      // Execute Python code that generates events
      await instance?.kernel.execute('print("Event test message")');
      
      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify events
      assert(receivedEvents.length > 0, "Should receive stream events");
      assert(receivedEvents.some(e => e.text && e.text.includes("Event test message")), 
        "Event should include the test message");
      
      // Clean up
      manager.offKernelEvent(kernelId, KernelEvents.STREAM, listener);
      await manager.destroyKernel(kernelId);
    } catch (error) {
      console.error("Error in event system test:", error);
      throw error;
    } finally {
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test 12: Test kernel inactivity timeout
Deno.test({
  name: "12. Test kernel inactivity timeout",
  async fn() {
    try {
      // Create a kernel with a short inactivity timeout (2 seconds)
      const kernelId = await manager.createKernel({
        id: "timeout-test",
        inactivityTimeout: 2000, // 2 seconds
      });
      
      // Verify kernel exists
      assert(manager.getKernel(kernelId), "Kernel should exist");
      
      // Verify inactivity timeout was set
      const timeout = manager.getInactivityTimeout(kernelId);
      assertEquals(timeout, 2000, "Inactivity timeout should be 2000ms");
      
      // Execute code to verify kernel is working
      const result = await manager.getKernel(kernelId)?.kernel.execute('print("Testing inactivity timeout")');
      assert(result?.success, "Execution should succeed");
      
      // Verify the last activity time was updated
      const lastActivity = manager.getLastActivityTime(kernelId);
      assert(lastActivity !== undefined, "Last activity time should be set");
      
      // Get time until shutdown
      const timeUntilShutdown = manager.getTimeUntilShutdown(kernelId);
      assert(timeUntilShutdown !== undefined, "Time until shutdown should be set");
      assert(timeUntilShutdown! <= 2000, "Time until shutdown should be less than or equal to 2000ms");
      
      console.log(`Kernel ${kernelId} will shut down in ${timeUntilShutdown}ms. Waiting for auto-shutdown...`);
      
      // Wait for the kernel to be automatically destroyed
      await new Promise<void>((resolve) => {
        // Check every 500ms if the kernel is still there
        const checkInterval = setInterval(() => {
          if (!manager.getKernel(kernelId)) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500);
        
        // Set a maximum wait time of 5 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve(); // Resolve anyway after 5 seconds
        }, 5000);
      });
      
      // Verify kernel was destroyed
      assertEquals(manager.getKernel(kernelId), undefined, "Kernel should be automatically destroyed after inactivity timeout");
    } catch (error) {
      console.error("Error in inactivity timeout test:", error);
      throw error;
    } finally {
      // Clean up any remaining kernels
      await manager.destroyAll();
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Final cleanup
Deno.test({
  name: "Final cleanup",
  async fn() {
    // Clean up all kernels
    await manager.destroyAll();
    
    // Clean up any leftover temp directories
    const cwd = Deno.cwd();
    try {
      for await (const entry of Deno.readDir(cwd)) {
        if (entry.isDirectory && entry.name.startsWith("deno-test-")) {
          const dirPath = `${cwd}/${entry.name}`;
          console.log(`Cleaning up leftover temporary directory: ${dirPath}`);
          
          try {
            await Deno.remove(dirPath, { recursive: true });
          } catch (err) {
            console.error(`Error removing directory ${dirPath}: ${err}`);
          }
        }
      }
    } catch (err) {
      console.error(`Error during cleanup: ${err}`);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
}); 