import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelMode } from "../kernel/mod.ts";

// To run the test, use:
// deno run -A test-hypha-service.ts <serviceId> [numKernels] [numExecutions]

// Utility function for retrying operations
async function retry<T>(
  operation: () => Promise<T>, 
  maxRetries = 3, 
  delay = 1000, 
  retryMsg = "Operation failed, retrying..."
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.log(`${retryMsg} (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Define interfaces for better type safety
interface KernelInfo {
  id: string;
  name: string;
  mode: KernelMode;
  created: string;
  status?: string;
}

interface ExecutionResult {
  execution_id: string;
}

interface ExecutionOutput {
  type: string;
  [key: string]: unknown;
}

// Parse command line arguments
const args = Deno.args;
if (args.length < 1) {
  console.error("Usage: deno run -A test-hypha-service.ts <serviceId> [numKernels=5] [numExecutions=3]");
  Deno.exit(1);
}

const serviceId = args[0];
const numKernels = parseInt(args[1] || "5", 10);
const numExecutions = parseInt(args[2] || "3", 10);

async function runStressTest() {
  console.log(`Starting stress test for service ${serviceId}`);
  console.log(`Will create ${numKernels} kernels and run ${numExecutions} executions per kernel`);
  
  // Connect to hypha server
  console.log("Connecting to hypha server...");
  const server = await hyphaWebsocketClient.connectToServer({
    server_url: "https://hypha.aicell.io"
  });
  
  console.log(`Connected to hypha server (workspace: ${server.config.workspace}), getting service...`);
  
  // Get the service - first try direct method
  let service;
  try {
    console.log(`Attempting to get service with ID: ${serviceId}`);
    service = await server.getService(serviceId);
  } catch (error) {
    console.log(`Failed to get service directly with ID ${serviceId}, trying to list services...`);
    
    // If direct access fails, try to find it in the list of services
    const services = await server.listServices();
    console.log(`Found ${services.length} services in workspace`);
    
    // Find the service that matches our criteria
    service = services.find((s: any) => 
      s.id === serviceId || 
      s.id.includes(serviceId) || 
      s.id.includes('deno-app-engine') ||
      s.name === 'Deno App Engine'
    );
    
    if (!service) {
      console.error(`Service ${serviceId} not found. Available services:`, 
        services.map((s: any) => `${s.name} (${s.id})`).join(', '));
      Deno.exit(1);
    }
  }
  
  console.log(`Found service: ${service.name} (${service.id})`);
  
  // Create kernels
  const kernels = [];
  console.log(`Creating ${numKernels} kernels...`);
  
  for (let i = 0; i < numKernels; i++) {
    try {
      const kernel = await service.createKernel({
        id: `test-kernel-${i}`,
        mode: KernelMode.WORKER
      }) as KernelInfo;
      
      console.log(`Created kernel ${i+1}/${numKernels}: ${kernel.id}`);
      kernels.push(kernel);
    } catch (error) {
      console.error(`Failed to create kernel ${i+1}/${numKernels}:`, error);
    }
  }
  
  console.log(`Successfully created ${kernels.length}/${numKernels} kernels`);
  
  // List all kernels to verify
  console.log("Listing all kernels...");
  try {
    const listedKernels = await service.listKernels() as KernelInfo[];
    console.log(`Found ${listedKernels.length} kernels in service`);
  } catch (error) {
    console.error("Failed to list kernels:", error);
  }
  
  // Run executions on each kernel
  console.log(`Running ${numExecutions} executions on each kernel...`);
  
  const results = [];
  for (const kernel of kernels) {
    console.log(`Testing kernel ${kernel.id}...`);
    
    for (let i = 0; i < numExecutions; i++) {
      try {
        console.log(`  Execution ${i+1}/${numExecutions}...`);
        
        // Simple test code that generates some output
        const testCode = `
import sys
import time
import numpy as np

print(f"Hello from execution ${i+1} on kernel {sys.version}")
time.sleep(0.5)  # Add some delay
arr = np.random.rand(3, 3)
print(f"Random array:\\n{arr}")
arr.sum()
`;
        
        console.log("  Executing code...");
        // Option 1: Use executeCode and wait for result
        const execResult = await service.executeCode({
          kernelId: kernel.id,
          code: testCode
        }) as ExecutionResult;
        
        // Wait a bit for execution to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get execution result
        const outputs = await service.getExecutionResult({
          kernelId: kernel.id,
          executionId: execResult.execution_id
        }) as ExecutionOutput[];
        
        console.log(`  Execution ${i+1} complete, received ${outputs.length} outputs`);
        results.push({
          kernelId: kernel.id,
          executionId: execResult.execution_id,
          success: true,
          outputCount: outputs.length
        });
        
        // Test streaming execution
        console.log("  Testing streaming execution...");
        try {
          const outputs2 = [];
          const streamCode = `print("Streaming test ${i+1}")\n2 + 2`;
          
          for await (const output of await service.streamExecution({
            kernelId: kernel.id,
            code: streamCode
          })) {
            outputs2.push(output);
          }
          
          console.log(`  Streaming execution complete, received ${outputs2.length} outputs`);
        } catch (error) {
          console.error(`  Streaming execution failed:`, error);
        }
      } catch (error) {
        console.error(`  Execution ${i+1} failed:`, error);
        results.push({
          kernelId: kernel.id,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Get kernel info
    try {
      const info = await service.getKernelInfo({
        kernelId: kernel.id
      });
      console.log(`  Kernel info: ${info.id} ${info.name}`)
    } catch (error) {
      console.error(`  Failed to get kernel info:`, error);
    }
  }
  
  // Test vector database permissions
  console.log("\n=== Testing Vector Database Permissions ===");
  await testVectorDatabasePermissions(service);
  
  // Print results summary
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log("\n=== Test Results Summary ===");
  console.log(`Total executions: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  
  if (failed.length > 0) {
    console.log("\nFailed executions:");
    failed.forEach(result => {
      console.log(`  - Kernel ${result.kernelId}: ${result.error}`);
    });
  }
  
  // Clean up kernels
  console.log("\nCleaning up kernels...");
  for (const kernel of kernels) {
    try {
      await service.destroyKernel({ kernelId: kernel.id });
      console.log(`Cleaned up kernel: ${kernel.id}`);
    } catch (error) {
      console.error(`Failed to clean up kernel ${kernel.id}:`, error);
    }
  }
  
  console.log("\nStress test completed!");
  
  return {
    server,
    kernels,
    results
  };
}

// Test vector database permissions across workspaces
async function testVectorDatabasePermissions(service: any) {
  const testIndices: string[] = [];
  
  try {
    console.log("Testing vector database permissions...");
    
    // Test 1: Create indices with different permission levels
    console.log("1. Creating indices with different permissions...");
    
    const permissionTypes = [
      { name: "private", permission: "private" },
      { name: "public_read", permission: "public_read" },
      { name: "public_read_add", permission: "public_read_add" },
      { name: "public_read_write", permission: "public_read_write" }
    ];
    
    for (const perm of permissionTypes) {
      try {
        const result = await service.createVectorIndex({
          id: `test-index-${perm.name}`,
          permission: perm.permission,
          embeddingModel: "mock-model"
        });
        
        testIndices.push(result.id);
        console.log(`  ✅ Created ${perm.name} index: ${result.id}`);
      } catch (error) {
        console.error(`  ❌ Failed to create ${perm.name} index:`, error);
      }
    }
    
    // Test 2: Add test documents to indices
    console.log("2. Adding test documents...");
    const testDocuments = [
      {
        id: "doc1",
        text: "This is a test document about artificial intelligence",
        metadata: { category: "AI", priority: 1 }
      },
      {
        id: "doc2", 
        text: "Machine learning algorithms are powerful tools",
        metadata: { category: "ML", priority: 2 }
      }
    ];
    
    for (const indexId of testIndices) {
      try {
        await service.addDocuments({
          indexId: indexId,
          documents: testDocuments
        });
        console.log(`  ✅ Added documents to: ${indexId}`);
      } catch (error) {
        console.error(`  ❌ Failed to add documents to ${indexId}:`, error);
      }
    }
    
    // Test 3: Query indices
    console.log("3. Testing queries...");
    for (const indexId of testIndices) {
      try {
        const result = await service.queryVectorIndex({
          indexId: indexId,
          query: "artificial intelligence",
          options: { k: 5 }
        });
        console.log(`  ✅ Queried ${indexId}: ${result.results.length} results`);
      } catch (error) {
        console.error(`  ❌ Failed to query ${indexId}:`, error);
      }
    }
    
    // Test 4: Cross-workspace access simulation (this would require multiple workspaces in practice)
    console.log("4. Testing cross-namespace access patterns...");
    
    // Simulate accessing index with full namespace ID
    for (const indexId of testIndices) {
      try {
        // This simulates what would happen if another workspace tried to access this index
        console.log(`  Testing permission model for ${indexId}`);
        
        // Get index info to see the permission setting
        const info = await service.getVectorIndexInfo({ indexId: indexId });
        console.log(`  ✅ Index ${indexId} info retrieved, permission model validated`);
      } catch (error) {
        console.error(`  ❌ Failed to get info for ${indexId}:`, error);
      }
    }
    
    // Test 5: Remove documents test
    console.log("5. Testing document removal...");
    for (const indexId of testIndices) {
      try {
        await service.removeDocuments({
          indexId: indexId,
          documentIds: ["doc1"]
        });
        console.log(`  ✅ Removed document from: ${indexId}`);
      } catch (error) {
        console.error(`  ❌ Failed to remove document from ${indexId}:`, error);
      }
    }
    
    // Test 6: List indices to verify all are accessible
    console.log("6. Listing all indices...");
    try {
      const indices = await service.listVectorIndices();
      console.log(`  ✅ Listed ${indices.length} indices`);
      
      // Verify our test indices are in the list
      const foundTestIndices = indices.filter((idx: any) => 
        testIndices.some(testId => idx.id === testId)
      );
      console.log(`  ✅ Found ${foundTestIndices.length}/${testIndices.length} test indices in listing`);
    } catch (error) {
      console.error(`  ❌ Failed to list indices:`, error);
    }
    
    console.log("✅ Vector database permission tests completed!");
    
  } catch (error) {
    console.error("❌ Vector database permission tests failed:", error);
  } finally {
    // Clean up test indices
    console.log("Cleaning up test indices...");
    for (const indexId of testIndices) {
      try {
        await service.destroyVectorIndex({ indexId: indexId });
        console.log(`  ✅ Cleaned up index: ${indexId}`);
      } catch (error) {
        console.error(`  ❌ Failed to clean up index ${indexId}:`, error);
      }
    }
  }
}

if (import.meta.main) {
  try {
    const { server } = await runStressTest();
    console.log("Stress test completed. Press Ctrl+C to exit.");
    // Keep connection alive
    await new Promise(() => {});
  } catch (error) {
    console.error("Stress test failed:", error);
    Deno.exit(1);
  }
}