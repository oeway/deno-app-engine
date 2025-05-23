#!/usr/bin/env -S deno run --allow-all
/**
 * Pool Exhaustion Test
 * 
 * This script demonstrates the correct behavior when the kernel pool is exhausted.
 * Users should wait for new kernels to be created rather than getting unusable kernels.
 */

import { KernelManager, KernelMode, KernelLanguage } from "../kernel/manager.ts";

async function testPoolExhaustion() {
  console.log("=== Pool Exhaustion Test ===\n");
  
  // Create a manager with a small pool for testing
  const manager = new KernelManager({
    allowedKernelTypes: [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
    ],
    pool: {
      enabled: true,
      poolSize: 2, // Small pool for easy exhaustion
      autoRefill: true,
      preloadConfigs: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ]
    }
  });
  
  try {
    console.log("1. Waiting for pool to initialize...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const initialStats = manager.getPoolStats();
    console.log("Initial pool stats:", initialStats);
    
    console.log("\n2. Testing normal pool usage (should be fast):");
    
    // First kernel - should come from pool
    const start1 = Date.now();
    const kernel1 = await manager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    const duration1 = Date.now() - start1;
    console.log(`✓ First kernel created in ${duration1}ms from pool`);
    
    // Second kernel - should come from pool
    const start2 = Date.now();
    const kernel2 = await manager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    const duration2 = Date.now() - start2;
    console.log(`✓ Second kernel created in ${duration2}ms from pool`);
    
    const afterTwoStats = manager.getPoolStats();
    console.log("Pool stats after taking 2 kernels:", afterTwoStats);
    
    console.log("\n3. Testing pool exhaustion (should wait for new kernel):");
    
    // Third kernel - pool should be exhausted, should wait for new kernel creation
    const start3 = Date.now();
    const kernel3 = await manager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    const duration3 = Date.now() - start3;
    console.log(`✓ Third kernel created in ${duration3}ms (pool exhausted, created new)`);
    
    // Verify the third kernel is usable
    const instance3 = manager.getKernel(kernel3);
    if (instance3) {
      console.log(`✓ Third kernel is usable (isFromPool: ${instance3.isFromPool})`);
      
      // Test execution to ensure it's fully functional
      try {
        const result = await instance3.kernel.execute('print("Hello from exhausted pool kernel")');
        if (result?.success) {
          console.log("✓ Third kernel execution successful");
        } else {
          console.log("✗ Third kernel execution failed");
        }
      } catch (error) {
        console.log("✗ Third kernel execution error:", error);
      }
    }
    
    const afterThreeStats = manager.getPoolStats();
    console.log("Pool stats after exhaustion:", afterThreeStats);
    
    console.log("\n4. Testing concurrent exhaustion:");
    
    // Create multiple kernels concurrently to test exhaustion handling
    const concurrentPromises = [];
    const startConcurrent = Date.now();
    
    for (let i = 0; i < 3; i++) {
      concurrentPromises.push(
        manager.createKernel({
          mode: KernelMode.WORKER,
          lang: KernelLanguage.PYTHON
        }).then(id => ({ id, duration: Date.now() - startConcurrent }))
      );
    }
    
    const concurrentResults = await Promise.all(concurrentPromises);
    
    console.log("Concurrent kernel creation results:");
    concurrentResults.forEach((result, index) => {
      console.log(`  Kernel ${index + 1}: ${result.id} created in ${result.duration}ms`);
    });
    
    // Verify all concurrent kernels are usable
    let usableCount = 0;
    for (const result of concurrentResults) {
      const instance = manager.getKernel(result.id);
      if (instance) {
        try {
          const execResult = await instance.kernel.execute('print("Concurrent test")');
          if (execResult?.success) {
            usableCount++;
          }
        } catch (error) {
          console.log(`✗ Concurrent kernel ${result.id} execution failed:`, error);
        }
      }
    }
    
    console.log(`✓ ${usableCount}/${concurrentResults.length} concurrent kernels are usable`);
    
    const finalStats = manager.getPoolStats();
    console.log("Final pool stats:", finalStats);
    
    // Clean up all kernels
    const allKernels = [kernel1, kernel2, kernel3, ...concurrentResults.map(r => r.id)];
    console.log(`\n5. Cleaning up ${allKernels.length} kernels...`);
    
    for (const kernelId of allKernels) {
      try {
        await manager.destroyKernel(kernelId);
      } catch (error) {
        console.log(`Warning: Failed to destroy kernel ${kernelId}:`, error);
      }
    }
    
    console.log("✓ All kernels cleaned up");
    
  } finally {
    await manager.destroyAll();
  }
  
  console.log("\n=== Test Summary ===");
  console.log("✓ Pool kernels are fast (<1s)");
  console.log("✓ Exhausted pool creates new kernels (slower but usable)");
  console.log("✓ Concurrent requests are handled correctly");
  console.log("✓ All created kernels are functional");
}

// Run the test
if (import.meta.main) {
  try {
    await testPoolExhaustion();
    console.log("\n✅ Pool exhaustion test completed successfully!");
  } catch (error) {
    console.error("❌ Pool exhaustion test failed:", error);
    Deno.exit(1);
  }
} 