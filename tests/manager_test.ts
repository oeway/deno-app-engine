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
      assert(mainInterruptResult, "Main thread kernel interrupt should succeed");
      
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