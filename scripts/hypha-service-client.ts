import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelMode } from "../kernel/mod.ts";

// Usage: deno run -A scripts/hypha-service-client.ts

interface TestResult {
  test: string;
  success: boolean;
  message: string;
  data?: any;
}

async function runClientTests() {
  const results: TestResult[] = [];
  
  try {
    console.log("🔗 Connecting to Hypha server...");
    
    const server = await hyphaWebsocketClient.connectToServer({
      server_url: "https://hypha.aicell.io"
    });
    
    console.log(`✅ Connected to workspace: ${server.config.workspace}`);
    
    // Find our service
    console.log("🔍 Looking for Deno App Engine service...");
    const services = await server.listServices();
    console.log(`Found ${services.length} services in workspace`);
    
    const service = services.find((s: any) => 
      s.id.includes('deno-app-engine') || 
      s.name === 'Deno App Engine'
    );
    
    if (!service) {
      console.error("❌ Deno App Engine service not found!");
      console.log("Available services:", services.map((s: any) => `${s.name} (${s.id})`));
      return;
    }
    
    console.log(`✅ Found service: ${service.name} (${service.id})`);
    
    // Test 1: Get service status
    console.log("\n🧪 Test 1: Service Status");
    try {
      const status = await service.getStatus();
      results.push({
        test: "Service Status",
        success: true,
        message: `Uptime: ${status.systemStats.uptimeFormatted}, Kernels: ${status.kernelStats.total}`,
        data: status
      });
      console.log(`✅ Status: ${status.systemStats.uptimeFormatted} uptime, ${status.kernelStats.total} kernels`);
    } catch (error) {
      results.push({
        test: "Service Status",
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
      console.error("❌ Status check failed:", error);
    }
    
    // Test 2: Create and manage a kernel
    console.log("\n🧪 Test 2: Kernel Management");
    let kernelId: string | undefined;
    
    try {
      // Create kernel
      const kernel = await service.createKernel({
        id: "client-test-kernel",
        mode: KernelMode.WORKER
      });
      
      kernelId = kernel.id;
      console.log(`✅ Created kernel: ${kernel.id}`);
      
      // List kernels
      const kernels = await service.listKernels();
      console.log(`✅ Listed kernels: ${kernels.length} total`);
      
      // Get kernel info
      const kernelInfo = await service.getKernelInfo({ kernelId: kernel.id });
      console.log(`✅ Kernel info: ${kernelInfo.name} (${kernelInfo.status || 'unknown'})`);
      
      results.push({
        test: "Kernel Management",
        success: true,
        message: `Created and managed kernel ${kernel.id}`,
        data: { kernelId: kernel.id, kernelCount: kernels.length }
      });
      
    } catch (error) {
      results.push({
        test: "Kernel Management", 
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
      console.error("❌ Kernel management failed:", error);
    }
    
    // Test 3: Code execution (if we have a kernel)
    if (kernelId) {
      console.log("\n🧪 Test 3: Code Execution");
      
      try {
        const testCode = `
import sys
import datetime
print("Hello from client test!")
print(f"Current time: {datetime.datetime.now()}")
print(f"Python version: {sys.version}")
result = 42 * 2
print(f"42 * 2 = {result}")
result
`;
        
        // Execute code
        const execResult = await service.executeCode({
          kernelId,
          code: testCode
        });
        
        console.log(`✅ Started execution: ${execResult.execution_id}`);
        
        // Wait a bit for execution
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Get results
        const outputs = await service.getExecutionResult({
          kernelId,
          executionId: execResult.execution_id
        });
        
        console.log(`✅ Execution completed with ${outputs.length} outputs`);
        
        results.push({
          test: "Code Execution",
          success: true,
          message: `Executed code with ${outputs.length} outputs`,
          data: { executionId: execResult.execution_id, outputCount: outputs.length }
        });
        
      } catch (error) {
        results.push({
          test: "Code Execution",
          success: false,
          message: error instanceof Error ? error.message : String(error)
        });
        console.error("❌ Code execution failed:", error);
      }
    }
    
    // Test 4: Vector Database
    console.log("\n🧪 Test 4: Vector Database");
    let vectorIndexId: string | undefined;
    
    try {
      // Create vector index
      const vectorIndex = await service.createVectorIndex({
        id: "client-test-vector-index",
        embeddingModel: "mock-model"
      });
      
      vectorIndexId = vectorIndex.id;
      console.log(`✅ Created vector index: ${vectorIndex.id}`);
      
      // Add some test documents
      const documents = [
        {
          id: "test-doc-1",
          text: "This is a test document about artificial intelligence and machine learning.",
          metadata: { category: "ai", source: "test" }
        },
        {
          id: "test-doc-2",
          text: "Another document discussing data science, analytics, and statistical methods.",
          metadata: { category: "data-science", source: "test" }
        }
      ];
      
      const addResult = await service.addDocuments({
        indexId: vectorIndex.id,
        documents
      });
      
      console.log(`✅ Added ${addResult.addedCount} documents`);
      
      // Query the index
      const queryResult = await service.queryVectorIndex({
        indexId: vectorIndex.id,
        query: "machine learning and AI",
        options: { k: 3 }
      });
      
      console.log(`✅ Query returned ${queryResult.resultCount} results`);
      
      results.push({
        test: "Vector Database",
        success: true,
        message: `Created index, added ${addResult.addedCount} docs, queried ${queryResult.resultCount} results`,
        data: { indexId: vectorIndex.id, docCount: addResult.addedCount, queryResults: queryResult.resultCount }
      });
      
    } catch (error) {
      results.push({
        test: "Vector Database",
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
      console.error("❌ Vector database test failed:", error);
    }
    
    // Test 5: Agent Management
    console.log("\n🧪 Test 5: Agent Management");
    let agentId: string | undefined;
    
    try {
      // Create agent
      const agent = await service.createAgent({
        id: "client-test-agent",
        name: "Client Test Agent",
        description: "A test agent created by the client",
        instructions: "You are a helpful assistant for testing purposes.",
        kernelType: "python",
        autoAttachKernel: true
      });
      
      agentId = agent.id;
      console.log(`✅ Created agent: ${agent.id}`);
      
      // List agents
      const agents = await service.listAgents();
      console.log(`✅ Listed agents: ${agents.length} total`);
      
      results.push({
        test: "Agent Management",
        success: true,
        message: `Created agent ${agent.id}, ${agents.length} total agents`,
        data: { agentId: agent.id, agentCount: agents.length }
      });
      
    } catch (error) {
      results.push({
        test: "Agent Management",
        success: false,
        message: error instanceof Error ? error.message : String(error)
      });
      console.error("❌ Agent management failed:", error);
    }
    
    // Cleanup
    console.log("\n🧹 Cleanup Phase");
    
    // Cleanup agent
    if (agentId) {
      try {
        await service.destroyAgent({ agentId });
        console.log(`✅ Destroyed agent: ${agentId}`);
      } catch (error) {
        console.error(`❌ Failed to destroy agent ${agentId}:`, error);
      }
    }
    
    // Cleanup vector index
    if (vectorIndexId) {
      try {
        await service.destroyVectorIndex({ indexId: vectorIndexId });
        console.log(`✅ Destroyed vector index: ${vectorIndexId}`);
      } catch (error) {
        console.error(`❌ Failed to destroy vector index ${vectorIndexId}:`, error);
      }
    }
    
    // Cleanup kernel
    if (kernelId) {
      try {
        await service.destroyKernel({ kernelId });
        console.log(`✅ Destroyed kernel: ${kernelId}`);
      } catch (error) {
        console.error(`❌ Failed to destroy kernel ${kernelId}:`, error);
      }
    }
    
    // Final summary
    console.log("\n📊 Test Summary");
    console.log("=".repeat(50));
    
    let passedTests = 0;
    let totalTests = results.length;
    
    for (const result of results) {
      const status = result.success ? "✅ PASS" : "❌ FAIL";
      console.log(`${status} ${result.test}: ${result.message}`);
      if (result.success) passedTests++;
    }
    
    console.log("=".repeat(50));
    console.log(`Overall: ${passedTests}/${totalTests} tests passed`);
    
    if (passedTests === totalTests) {
      console.log("🎉 All tests passed!");
    } else {
      console.log("⚠️ Some tests failed. Check the details above.");
    }
    
  } catch (error) {
    console.error("❌ Client test setup failed:", error);
  }
}

// Run the tests if this is the main module
if (import.meta.main) {
  console.log("🚀 Starting Hypha Service Client Tests");
  console.log("Make sure the hypha service is running first!");
  console.log();
  
  try {
    await runClientTests();
  } catch (error) {
    console.error("Client tests failed:", error);
    Deno.exit(1);
  }
} 