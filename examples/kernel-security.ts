#!/usr/bin/env -S deno run --allow-all
/**
 * Example: Kernel Security with Allowed Types
 * 
 * This example demonstrates how to restrict which kernel types can be created
 * for security purposes. By default, main thread kernels are disabled to prevent
 * potential security issues.
 */

import { KernelManager, KernelMode, KernelLanguage } from "../kernel/manager.ts";

async function demonstrateKernelSecurity() {
  console.log("=== Kernel Security Example ===\n");
  
  // Example 1: Default configuration (secure by default)
  console.log("1. Default Configuration (Worker kernels only):");
  const defaultManager = new KernelManager();
  
  try {
    // This should work - worker Python kernel
    const workerId = await defaultManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Worker Python kernel created successfully:", workerId);
    
    // This should fail - main thread kernel not allowed by default
    try {
      await defaultManager.createKernel({
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      console.log("✗ Main thread kernel should have been rejected!");
    } catch (error) {
      console.log("✓ Main thread kernel correctly rejected:", (error as Error).message);
    }
    
    // Clean up
    await defaultManager.destroyKernel(workerId);
  } finally {
    await defaultManager.destroyAll();
  }
  
  console.log("\n2. Custom Restricted Configuration:");
  
  // Example 2: Only allow Python worker kernels
  const restrictedManager = new KernelManager({
    allowedKernelTypes: [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      // Only Python workers allowed
    ]
  });
  
  try {
    // This should work
    const pythonId = await restrictedManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Python worker kernel created:", pythonId);
    
    // This should fail - TypeScript not allowed
    try {
      await restrictedManager.createKernel({
        mode: KernelMode.WORKER,
        lang: KernelLanguage.TYPESCRIPT
      });
      console.log("✗ TypeScript kernel should have been rejected!");
    } catch (error) {
      console.log("✓ TypeScript kernel correctly rejected:", (error as Error).message);
    }
    
    // Show allowed types
    const allowedTypes = restrictedManager.getAllowedKernelTypes();
    console.log("Allowed kernel types:", allowedTypes);
    
    // Clean up
    await restrictedManager.destroyKernel(pythonId);
  } finally {
    await restrictedManager.destroyAll();
  }
  
  console.log("\n3. Permissive Configuration (for development):");
  
  // Example 3: Allow all kernel types (for development environments)
  const permissiveManager = new KernelManager({
    allowedKernelTypes: [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
      { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT },
      { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.PYTHON },
      { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.TYPESCRIPT }
    ]
  });
  
  try {
    // All of these should work
    const workerPython = await permissiveManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Worker Python kernel created:", workerPython);
    
    const workerTS = await permissiveManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT
    });
    console.log("✓ Worker TypeScript kernel created:", workerTS);
    
    const mainPython = await permissiveManager.createKernel({
      mode: KernelMode.MAIN_THREAD,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Main thread Python kernel created:", mainPython);
    
    // Clean up
    await permissiveManager.destroyKernel(workerPython);
    await permissiveManager.destroyKernel(workerTS);
    await permissiveManager.destroyKernel(mainPython);
  } finally {
    await permissiveManager.destroyAll();
  }
  
  console.log("\n4. Pool Configuration with Security:");
  
  // Example 4: Pool with security restrictions
  const poolManager = new KernelManager({
    allowedKernelTypes: [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
    ],
    pool: {
      enabled: true,
      poolSize: 2,
      autoRefill: true,
      preloadConfigs: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
        // These will be filtered out automatically:
        { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.PYTHON },
        { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
      ]
    }
  });
  
  try {
    // Wait for pool to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const poolStats = poolManager.getPoolStats();
    console.log("Pool stats (filtered):", poolStats);
    console.log("✓ Pool automatically filtered disallowed kernel types");
    
    // Fast kernel creation from pool
    const start = Date.now();
    const poolKernelId = await poolManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    const duration = Date.now() - start;
    
    console.log(`✓ Fast kernel creation from pool: ${duration}ms`);
    
    // Clean up
    await poolManager.destroyKernel(poolKernelId);
  } finally {
    await poolManager.destroyAll();
  }
  
  console.log("\n=== Security Recommendations ===");
  console.log("1. Use worker mode by default for better isolation");
  console.log("2. Only enable main thread kernels when necessary");
  console.log("3. Restrict kernel types based on your security requirements");
  console.log("4. Pool configurations are automatically filtered by allowed types");
  console.log("5. Use getAllowedKernelTypes() to inspect current restrictions");
}

// Run the example
if (import.meta.main) {
  try {
    await demonstrateKernelSecurity();
    console.log("\n✓ Kernel security example completed successfully!");
  } catch (error) {
    console.error("Error in kernel security example:", error);
    Deno.exit(1);
  }
} 