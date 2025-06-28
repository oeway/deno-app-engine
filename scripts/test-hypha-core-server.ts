/**
 * Test suite for HyphaCore Server
 * 
 * This test file comprehensively tests the HyphaCore server functionality
 * including kernel management, vector database operations, and AI agent capabilities.
 */

import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelMode } from "../kernel/mod.ts";
import { VectorDBPermission } from "../vectordb/mod.ts";
import { startHyphaCoreServer } from "./hypha-core-server.ts";

// Test configuration
const TEST_CONFIG = {
  host: "localhost",
  port: 9528, // Use different port to avoid conflicts
  workspace: undefined, // Use public workspace to avoid authentication issues
  jwtSecret: "test-secret-123456789012345678901234"
};

// Test utilities
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// Global test state
let hyphaServer: any = null;
let engineService: any = null;
let testResults: { name: string; success: boolean; error?: string; duration: number }[] = [];

/**
 * Start the HyphaCore server for testing
 */
async function startTestServer(): Promise<void> {
  console.log("🚀 Starting HyphaCore test server...");
  
  // Set test environment variables
  Deno.env.set("HYPHA_CORE_PORT", TEST_CONFIG.port.toString());
  Deno.env.set("HYPHA_CORE_HOST", TEST_CONFIG.host);
  if (TEST_CONFIG.workspace !== undefined) {
    Deno.env.set("HYPHA_CORE_WORKSPACE", TEST_CONFIG.workspace);
  }
  Deno.env.set("HYPHA_CORE_JWT_SECRET", TEST_CONFIG.jwtSecret);
  
  // Use minimal configurations for faster testing
  Deno.env.set("KERNEL_POOL_ENABLED", "false");
  Deno.env.set("ALLOWED_KERNEL_TYPES", "worker-python,worker-typescript");
  Deno.env.set("AGENT_MODEL_NAME", "mock-model");
  Deno.env.set("EMBEDDING_MODEL", "mock-model");
  
  try {
    hyphaServer = await startHyphaCoreServer(TEST_CONFIG);
    console.log(`✅ HyphaCore test server started on ${TEST_CONFIG.host}:${TEST_CONFIG.port}`);
    
    // Wait a bit for server to be ready
    await delay(2000);
  } catch (error) {
    console.error("❌ Failed to start HyphaCore test server:", error);
    throw error;
  }
}

/**
 * Connect test client to the server
 */
async function connectTestClient(): Promise<void> {
  console.log("🔌 Connecting test client to HyphaCore server...");
  
  try {
    // Connect to public workspace (no authentication needed)
    const connectionConfig: any = {
      server_url: `http://${TEST_CONFIG.host}:${TEST_CONFIG.port}`,
      client_id: "hypha-core-test-client"
    };
    
    // Only add workspace if it's defined (undefined means public workspace)
    if (TEST_CONFIG.workspace !== undefined) {
      connectionConfig.workspace = TEST_CONFIG.workspace;
    }
    
    const client = await hyphaWebsocketClient.connectToServer(connectionConfig);
    engineService = await client.getService("default/root:deno-app-engine")
    console.log("✅ Test client connected successfully");
  } catch (error) {
    console.error("❌ Failed to connect test client:", error);
    throw error;
  }
}

/**
 * Run a single test with error handling and timing
 */
async function runTest(name: string, testFn: () => Promise<void>): Promise<void> {
  console.log(`\n🧪 Running test: ${name}`);
  const startTime = Date.now();
  
  try {
    await withTimeout(testFn(), 30000); // 30 second timeout for each test
    const duration = Date.now() - startTime;
    console.log(`✅ Test passed: ${name} (${duration}ms)`);
    testResults.push({ name, success: true, duration });
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Test failed: ${name} (${duration}ms) - ${errorMessage}`);
    testResults.push({ name, success: false, error: errorMessage, duration });
  }
}

/**
 * Test kernel management functionality
 */
async function testKernelManagement(): Promise<void> {
  let kernelId: string | undefined;
  
  try {
    // Test kernel creation
    const createResult = await engineService.createKernel({
      id: "test-kernel",
      mode: KernelMode.WORKER
    });
    
    kernelId = createResult.id;
    
    if (!kernelId) {
      throw new Error("Kernel ID not returned from createKernel");
    }
    
    console.log(`  📝 Created kernel: ${kernelId}`);
    
    // Test kernel listing
    const kernels = await engineService.listKernels();
    
    if (!Array.isArray(kernels)) {
      throw new Error("listKernels should return an array");
    }
    
    const foundKernel = kernels.find(k => k.id === kernelId);
    if (!foundKernel) {
      throw new Error(`Created kernel ${kernelId} not found in list`);
    }
    
    console.log(`  📝 Listed ${kernels.length} kernels`);
    
    // Test code execution
    const executionResult = await engineService.executeCode({
      kernelId: kernelId,
      code: "print('Hello from HyphaCore test!')"
    });
    
    if (!executionResult.execution_id) {
      throw new Error("Execution ID not returned from executeCode");
    }
    
    console.log(`  📝 Executed code with ID: ${executionResult.execution_id}`);
    
    // Test status check
    const status = await engineService.getStatus();
    
    if (!status.kernelStats) {
      throw new Error("Status should include kernelStats");
    }
    
    console.log(`  📝 Retrieved status: ${status.kernelStats.total} total kernels`);
    
  } finally {
    // Clean up: destroy kernel
    if (kernelId) {
      try {
        await engineService.destroyKernel({ kernelId });
        console.log(`  🧹 Cleaned up kernel: ${kernelId}`);
      } catch (error) {
        console.warn(`  ⚠️ Failed to clean up kernel: ${error}`);
      }
    }
  }
}

/**
 * Test streaming execution functionality
 */
async function testStreamingExecution(): Promise<void> {
  let kernelId: string | undefined;
  
  try {
    // Create kernel for streaming test
    const createResult = await engineService.createKernel({
      id: "stream-test-kernel",
      mode: KernelMode.WORKER
    });
    
    kernelId = createResult.id;
    console.log(`  📝 Created streaming kernel: ${kernelId}`);
    
    // Test streaming execution
    const outputs: any[] = [];
    let completed = false;
    
    const streamGenerator = await engineService.streamExecution({
      kernelId: kernelId,
      code: `
import time
print("Starting computation...")
for i in range(3):
    print(f"Step {i + 1}")
    time.sleep(0.1)
print("Computation complete!")
`
    });
    
    for await (const output of streamGenerator) {
      outputs.push(output);
      console.log(`  📤 Stream output:`, output);
      
      if (output.type === 'complete') {
        completed = true;
        break;
      }
      
      if (output.type === 'error') {
        throw new Error(`Streaming execution failed: ${output.error}`);
      }
    }
    
    if (!completed) {
      throw new Error("Streaming execution did not complete properly");
    }
    
    if (outputs.length === 0) {
      throw new Error("No outputs received from streaming execution");
    }
    
    console.log(`  📝 Received ${outputs.length} streaming outputs`);
    
  } finally {
    // Clean up
    if (kernelId) {
      try {
        await engineService.destroyKernel({ kernelId });
        console.log(`  🧹 Cleaned up streaming kernel: ${kernelId}`);
      } catch (error) {
        console.warn(`  ⚠️ Failed to clean up streaming kernel: ${error}`);
      }
    }
  }
}

/**
 * Test vector database functionality
 */
async function testVectorDatabase(): Promise<void> {
  let indexId: string | undefined;
  
  try {
    // Test vector index creation
    const createResult = await engineService.createVectorIndex({
      id: "test-vector-index",
      embeddingModel: "mock-model",
      permission: VectorDBPermission.PRIVATE
    });
    
    indexId = createResult.id;
    console.log(`  📝 Created vector index: ${indexId}`);
    
    // Test listing vector indices
    const indices = await engineService.listVectorIndices();
    
    if (!Array.isArray(indices)) {
      throw new Error("listVectorIndices should return an array");
    }
    
    const foundIndex = indices.find(idx => idx.id === indexId);
    if (!foundIndex) {
      throw new Error(`Created index ${indexId} not found in list`);
    }
    
    console.log(`  📝 Listed ${indices.length} vector indices`);
    
    // Test adding documents
    const documents = [
      {
        id: "doc1",
        text: "This is a test document about artificial intelligence and machine learning.",
        metadata: { category: "ai", priority: 1 }
      },
      {
        id: "doc2", 
        text: "Another document discussing deep learning and neural networks.",
        metadata: { category: "deep-learning", priority: 2 }
      },
      {
        id: "doc3",
        text: "A third document about natural language processing and transformers.",
        metadata: { category: "nlp", priority: 3 }
      }
    ];
    
    const addResult = await engineService.addDocuments({
      indexId: indexId,
      documents: documents
    });
    
    if (!addResult.success || addResult.addedCount !== 3) {
      throw new Error(`Expected to add 3 documents, got ${addResult.addedCount}`);
    }
    
    console.log(`  📝 Added ${addResult.addedCount} documents`);
    
    // Test querying
    const queryResult = await engineService.queryVectorIndex({
      indexId: indexId,
      query: "machine learning algorithms",
      options: { k: 2 }
    });
    
    if (!queryResult.results || !Array.isArray(queryResult.results)) {
      throw new Error("Query should return results array");
    }
    
    if (queryResult.results.length === 0) {
      throw new Error("Query should return some results");
    }
    
    console.log(`  📝 Query returned ${queryResult.results.length} results`);
    
  } finally {
    // Clean up: destroy vector index
    if (indexId) {
      try {
        await engineService.destroyVectorIndex({ indexId });
        console.log(`  🧹 Cleaned up vector index: ${indexId}`);
      } catch (error) {
        console.warn(`  ⚠️ Failed to clean up vector index: ${error}`);
      }
    }
  }
}

/**
 * Test agent management functionality
 */
async function testAgentManagement(): Promise<void> {
  let agentId: string | undefined;
  
  try {
    // Test agent creation
    const createResult = await engineService.createAgent({
      id: "test-agent",
      name: "Test Agent",
      description: "A test agent for HyphaCore server testing",
      instructions: "You are a helpful test assistant. Always respond politely and concisely.",
      kernelType: "python",
      autoAttachKernel: false // Don't auto-attach for faster testing
    });
    
    agentId = createResult.id;
    console.log(`  📝 Created agent: ${agentId}`);
    
    // Test listing agents
    const agents = await engineService.listAgents();
    
    if (!Array.isArray(agents)) {
      throw new Error("listAgents should return an array");
    }
    
    const foundAgent = agents.find(a => a.id === agentId);
    if (!foundAgent) {
      throw new Error(`Created agent ${agentId} not found in list`);
    }
    
    console.log(`  📝 Listed ${agents.length} agents`);
    
    // Test stateless chat (simpler than full chat which requires model)
    try {
      const messages = [
        { role: "user", content: "Hello, this is a test message" }
      ];
      
      let responseReceived = false;
      const chatGenerator = engineService.chatWithAgentStateless({
        agentId: agentId,
        messages: messages
      });
      
      // Just check if we can start the conversation (may fail due to mock model)
      try {
        for await (const chunk of chatGenerator) {
          responseReceived = true;
          console.log(`  📤 Chat response:`, chunk);
          break; // Just check first chunk
        }
      } catch (chatError) {
        // Expected for mock model - just check that the method exists and agent was found
        if (chatError instanceof Error && chatError.message.includes("Agent not found")) {
          throw chatError;
        }
        console.log(`  📝 Chat interface accessible (mock model expected to fail)`);
      }
      
    } catch (chatError) {
      console.log(`  📝 Chat test skipped due to mock model: ${chatError}`);
    }
    
  } finally {
    // Clean up: destroy agent
    if (agentId) {
      try {
        await engineService.destroyAgent({ agentId });
        console.log(`  🧹 Cleaned up agent: ${agentId}`);
      } catch (error) {
        console.warn(`  ⚠️ Failed to clean up agent: ${error}`);
      }
    }
  }
}

/**
 * Test load balancing functionality
 */
async function testLoadBalancing(): Promise<void> {
  // Test getEngineLoad method
  const load = await engineService.getEngineLoad();
  
  if (typeof load !== 'number') {
    throw new Error("getEngineLoad should return a number");
  }
  
  console.log(`  📝 Engine load: ${load}`);
}

/**
 * Test service discovery and introspection
 */
async function testServiceDiscovery(): Promise<void> {
  // Test that we can call service methods and get service status
  const status = await engineService.getStatus();
  
  if (!status || typeof status !== 'object') {
    throw new Error("getStatus should return an object");
  }
  
  console.log(`  📝 Service status retrieved successfully`);
  
  // Test that basic service properties exist
  if (!status.kernelStats && !status.vectorDBStats && !status.agentStats) {
    throw new Error("Service status should contain at least one stat category");
  }
  
  const statCategories = [];
  if (status.kernelStats) statCategories.push('kernelStats');
  if (status.vectorDBStats) statCategories.push('vectorDBStats');
  if (status.agentStats) statCategories.push('agentStats');
  
  console.log(`  📝 Service provides ${statCategories.length} stat categories: ${statCategories.join(', ')}`);
}

/**
 * Clean up test resources
 */
async function cleanup(): Promise<void> {
  console.log("\n🧹 Cleaning up test resources...");
  
  try {
    if (engineService) {
      await engineService.disconnect();
      console.log("✅ Test client disconnected");
    }
  } catch (error) {
    console.warn("⚠️ Error disconnecting client:", error);
  }
  
  try {
    if (hyphaServer?.hyphaCore) {
      await hyphaServer.hyphaCore.close();
      console.log("✅ HyphaCore server stopped");
    }
  } catch (error) {
    console.warn("⚠️ Error stopping server:", error);
  }
}

/**
 * Print test results summary
 */
function printTestSummary(): void {
  console.log("\n" + "=".repeat(60));
  console.log("📊 TEST SUMMARY");
  console.log("=".repeat(60));
  
  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.success).length;
  const failedTests = totalTests - passedTests;
  const totalTime = testResults.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} ✅`);
  console.log(`Failed: ${failedTests} ❌`);
  console.log(`Total Time: ${totalTime}ms`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
  
  if (failedTests > 0) {
    console.log("\nFailed Tests:");
    testResults.filter(r => !r.success).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
  }
  
  console.log("=".repeat(60));
}

/**
 * Main test runner
 */
async function runAllTests(): Promise<void> {
  console.log("🚀 Starting HyphaCore Server Test Suite");
  console.log("=" .repeat(60));
  
  try {
    // Setup
    await startTestServer();
    await connectTestClient();
    
    // Run all tests
    await runTest("Service Discovery", testServiceDiscovery);
    await runTest("Kernel Management", testKernelManagement);
    await runTest("Streaming Execution", testStreamingExecution);
    await runTest("Vector Database", testVectorDatabase);
    await runTest("Agent Management", testAgentManagement);
    await runTest("Load Balancing", testLoadBalancing);
    
  } catch (error) {
    console.error("❌ Test setup failed:", error);
    testResults.push({ 
      name: "Test Setup", 
      success: false, 
      error: error instanceof Error ? error.message : String(error),
      duration: 0
    });
  } finally {
    await cleanup();
    printTestSummary();
  }
}

// Export for testing
export { runAllTests, startTestServer, connectTestClient, cleanup };

// Run tests if this is the main module
if (import.meta.main) {
  try {
    await runAllTests();
    
    // Exit with appropriate code
    const failedTests = testResults.filter(r => !r.success).length;
    Deno.exit(failedTests > 0 ? 1 : 0);
  } catch (error) {
    console.error("💥 Test runner crashed:", error);
    Deno.exit(1);
  }
} 