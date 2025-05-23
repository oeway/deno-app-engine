#!/usr/bin/env -S deno run --allow-all
/**
 * Configuration Demo
 * 
 * This script demonstrates how to configure the kernel manager
 * with different security and performance settings.
 */

import { KernelManager, KernelMode, KernelLanguage } from "../kernel/manager.ts";

async function demonstrateConfiguration() {
  console.log("=== Kernel Manager Configuration Demo ===\n");
  
  // Demo 1: Default configuration (secure)
  console.log("1. Default Configuration (Secure):");
  const defaultManager = new KernelManager();
  
  console.log("Allowed kernel types:", defaultManager.getAllowedKernelTypes());
  console.log("Pool stats:", defaultManager.getPoolStats());
  
  try {
    // This should work
    const workerId = await defaultManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Worker Python kernel created:", workerId);
    await defaultManager.destroyKernel(workerId);
    
    // This should fail
    try {
      await defaultManager.createKernel({
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      console.log("✗ Main thread kernel should have been rejected!");
    } catch (error) {
      console.log("✓ Main thread kernel correctly rejected");
    }
  } finally {
    await defaultManager.destroyAll();
  }
  
  console.log("\n2. Custom Configuration with Pool:");
  
  // Demo 2: Custom configuration with pool
  const customManager = new KernelManager({
    allowedKernelTypes: [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
      { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.PYTHON }
    ],
    pool: {
      enabled: true,
      poolSize: 2,
      autoRefill: true,
      preloadConfigs: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ]
    }
  });
  
  console.log("Allowed kernel types:", customManager.getAllowedKernelTypes());
  
  // Wait for pool to initialize
  console.log("Waiting for pool initialization...");
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log("Pool stats after initialization:", customManager.getPoolStats());
  
  try {
    // Test fast kernel creation from pool
    const start = Date.now();
    const poolKernelId = await customManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    const duration = Date.now() - start;
    
    console.log(`✓ Fast kernel creation from pool: ${duration}ms`);
    
    const instance = customManager.getKernel(poolKernelId);
    if (instance?.isFromPool) {
      console.log("✓ Kernel was retrieved from pool");
    } else {
      console.log("○ Kernel was created on-demand (pool not ready)");
    }
    
    await customManager.destroyKernel(poolKernelId);
  } finally {
    await customManager.destroyAll();
  }
  
  console.log("\n3. Environment Variable Simulation:");
  
  // Demo 3: Simulate environment variable configuration
  // This shows how the server.ts and hypha-service.ts would work
  const envConfig = {
    ALLOWED_KERNEL_TYPES: "worker-python,worker-typescript",
    KERNEL_POOL_ENABLED: "true",
    KERNEL_POOL_SIZE: "3",
    KERNEL_POOL_AUTO_REFILL: "true",
    KERNEL_POOL_PRELOAD_CONFIGS: "worker-python"
  };
  
  console.log("Simulated environment variables:");
  for (const [key, value] of Object.entries(envConfig)) {
    console.log(`  ${key}=${value}`);
  }
  
  // Parse the configuration (similar to server.ts)
  const allowedTypes = envConfig.ALLOWED_KERNEL_TYPES.split(",").map(typeStr => {
    const [modeStr, langStr] = typeStr.trim().split("-");
    const mode = modeStr === "main_thread" ? KernelMode.MAIN_THREAD : KernelMode.WORKER;
    const language = langStr === "typescript" ? KernelLanguage.TYPESCRIPT : KernelLanguage.PYTHON;
    return { mode, language };
  });
  
  const envManager = new KernelManager({
    allowedKernelTypes: allowedTypes,
    pool: {
      enabled: envConfig.KERNEL_POOL_ENABLED === "true",
      poolSize: parseInt(envConfig.KERNEL_POOL_SIZE),
      autoRefill: envConfig.KERNEL_POOL_AUTO_REFILL !== "false",
      preloadConfigs: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }
      ]
    }
  });
  
  console.log("\nParsed configuration:");
  console.log("- Allowed types:", allowedTypes);
  console.log("- Pool enabled:", envConfig.KERNEL_POOL_ENABLED === "true");
  console.log("- Pool size:", parseInt(envConfig.KERNEL_POOL_SIZE));
  
  try {
    // Test both allowed types
    const pythonId = await envManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });
    console.log("✓ Python worker kernel created");
    
    const tsId = await envManager.createKernel({
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT
    });
    console.log("✓ TypeScript worker kernel created");
    
    // Test rejected type
    try {
      await envManager.createKernel({
        mode: KernelMode.MAIN_THREAD,
        lang: KernelLanguage.PYTHON
      });
      console.log("✗ Main thread kernel should have been rejected!");
    } catch (error) {
      console.log("✓ Main thread kernel correctly rejected by env config");
    }
    
    await envManager.destroyKernel(pythonId);
    await envManager.destroyKernel(tsId);
  } finally {
    await envManager.destroyAll();
  }
  
  console.log("\n=== Configuration Recommendations ===");
  console.log("Development: ALLOWED_KERNEL_TYPES=worker-python,worker-typescript,main_thread-python");
  console.log("Production:  ALLOWED_KERNEL_TYPES=worker-python,worker-typescript");
  console.log("High Security: ALLOWED_KERNEL_TYPES=worker-python");
  console.log("Performance: KERNEL_POOL_ENABLED=true KERNEL_POOL_SIZE=5");
}

// Run the demo
if (import.meta.main) {
  try {
    await demonstrateConfiguration();
    console.log("\n✓ Configuration demo completed successfully!");
  } catch (error) {
    console.error("Error in configuration demo:", error);
    Deno.exit(1);
  }
} 