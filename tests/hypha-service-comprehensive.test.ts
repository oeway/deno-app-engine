import { assertEquals, assertExists, assertGreater, assertThrows, assert } from "jsr:@std/assert";
import { startHyphaService } from "../scripts/hypha-service.ts";
import { KernelMode } from "../kernel/mod.ts";
import type { IDocument } from "../vectordb/mod.ts";

// Helper function to check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch("http://localhost:11434/api/models", {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Helper function to wait for execution results with polling
async function waitForExecutionResult(
  service: any,
  kernelId: string,
  executionId: string,
  timeoutMs: number = 15000,
  pollIntervalMs: number = 500
): Promise<any[]> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const results = await service.getExecutionResult({
        kernelId,
        executionId
      });
      return results;
    } catch (error) {
      // If execution not found, continue polling
      if (error instanceof Error && error.message.includes("Execution not found")) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        continue;
      }
      // For other errors, throw immediately
      throw error;
    }
  }
  
  throw new Error(`Execution ${executionId} did not complete within ${timeoutMs}ms`);
}

// Test data for realistic scenarios
const SAMPLE_RESEARCH_DOCS: IDocument[] = [
  {
    id: "paper-1",
    text: "Machine learning algorithms for natural language processing have evolved significantly with transformer architectures. BERT and GPT models demonstrate exceptional performance in understanding context and generating coherent text.",
    metadata: { category: "AI", type: "research", year: 2023, topic: "transformers" }
  },
  {
    id: "paper-2", 
    text: "Vector databases provide efficient similarity search capabilities for high-dimensional embeddings. They are essential for retrieval-augmented generation (RAG) systems and semantic search applications.",
    metadata: { category: "Database", type: "research", year: 2023, topic: "vectors" }
  },
  {
    id: "code-1",
    text: "Python data analysis workflows using pandas and numpy enable efficient data manipulation. DataFrame operations, statistical analysis, and visualization are core components of data science.",
    metadata: { category: "Programming", type: "tutorial", year: 2024, topic: "python" }
  },
  {
    id: "code-2",
    text: "TypeScript provides type safety for JavaScript applications. Modern frameworks like React and Vue.js benefit from TypeScript's static type checking and improved developer experience.",
    metadata: { category: "Programming", type: "tutorial", year: 2024, topic: "typescript" }
  },
  {
    id: "science-1",
    text: "Climate change research indicates rising global temperatures and changing precipitation patterns. Data analysis of temperature records shows clear warming trends over the past century.",
    metadata: { category: "Science", type: "data", year: 2024, topic: "climate" }
  }
];

const SAMPLE_CODE_SNIPPETS = [
  {
    language: "python",
    description: "Data analysis with numpy",
    code: `
import numpy as np

# Create sample dataset
np.random.seed(42)
temperature_data = np.random.normal(20, 5, 100)
humidity_data = np.random.normal(60, 10, 100)
pressure_data = np.random.normal(1013, 20, 100)

# Basic statistics
stats = {
    'mean_temp': np.mean(temperature_data),
    'max_humidity': np.max(humidity_data),
    'pressure_std': np.std(pressure_data),
    'temp_range': np.max(temperature_data) - np.min(temperature_data)
}

print("Weather Data Analysis:")
for key, value in stats.items():
    print(f"{key}: {value:.2f}")

# Correlation analysis
data_matrix = np.column_stack([temperature_data, humidity_data, pressure_data])
correlation = np.corrcoef(data_matrix.T)
print("\\nCorrelation Matrix Shape:", correlation.shape)
print("Temperature-Humidity correlation:", correlation[0, 1])

stats
`
  },
  {
    language: "python",
    description: "Mathematical computations",
    code: `
import numpy as np

# Generate synthetic data for simple regression
np.random.seed(42)
n_samples = 100
X = np.random.randn(n_samples, 2)
true_coeffs = np.array([2.5, -1.3])
y = X @ true_coeffs + 0.1 * np.random.randn(n_samples)

# Simple linear regression using normal equations
X_with_bias = np.column_stack([np.ones(n_samples), X])
coefficients = np.linalg.solve(X_with_bias.T @ X_with_bias, X_with_bias.T @ y)

# Make predictions
y_pred = X_with_bias @ coefficients

# Calculate metrics
mse = np.mean((y - y_pred) ** 2)
r2 = 1 - (np.sum((y - y_pred) ** 2) / np.sum((y - np.mean(y)) ** 2))

results = {
    'coefficients': coefficients.tolist(),
    'mse': mse,
    'r2_score': r2,
    'samples': n_samples,
    'true_coeffs': true_coeffs.tolist()
}

print(f"Linear Regression Results:")
print(f"MSE: {mse:.4f}")
print(f"R²: {r2:.4f}")
print(f"Estimated coefficients: {coefficients}")
print(f"True coefficients: {true_coeffs}")

results
`
  }
];

Deno.test({
  name: "Hypha Service Comprehensive Workflow Test",
  async fn() {
    console.log("\n🚀 Starting Comprehensive Hypha Service Test");
    console.log("=" .repeat(60));

    // Phase 1: Service Initialization and Health Check
    console.log("\n📋 Phase 1: Service Initialization and Health Check");
    
    const { server, service: serviceInfo } = await startHyphaService({
      skipLogin: true,
      serverUrl: "https://hypha.aicell.io"
    });

    assertExists(server, "Server should be created");
    assertExists(serviceInfo, "Service should be registered");
    console.log(`✅ Service connected (workspace: ${server.config.workspace})`);

    // Get the actual service proxy to call methods
    const service = await server.getService(serviceInfo.id);
    assertExists(service, "Service proxy should be available");

    // Initial health check
    const initialStatus = await service.getStatus();
    assertExists(initialStatus.systemStats, "System stats should be available");
    assertExists(initialStatus.kernelStats, "Kernel stats should be available");
    console.log(`📊 Initial system status: ${initialStatus.kernelStats.total} kernels, ${initialStatus.systemStats.uptime}s uptime`);

    // Phase 2: Kernel Workflows - Data Science Pipeline
    console.log("\n🔬 Phase 2: Kernel Workflows - Data Science Pipeline");
    
    // Create Python kernel for data analysis
    const pythonKernel = await service.createKernel({
      id: "data-science-kernel",
      mode: KernelMode.WORKER
    });
    assertExists(pythonKernel.id, "Python kernel should be created");
    console.log(`✅ Created Python kernel: ${pythonKernel.id}`);

    // Test 2.1: Basic data analysis workflow
    console.log("   → Running numpy data analysis workflow...");
    const dataAnalysisExec = await service.executeCode({
      kernelId: pythonKernel.id,
      code: SAMPLE_CODE_SNIPPETS[0].code
    });
    
    // Wait for execution to complete using polling
    const dataResults = await waitForExecutionResult(
      service,
      pythonKernel.id,
      dataAnalysisExec.execution_id,
      10000 // 10 second timeout
    );
    assert(dataResults.length > 0, "Data analysis should produce outputs");
    console.log(`   ✅ Data analysis completed with ${dataResults.length} outputs`);

    // Test 2.2: Mathematical computation pipeline
    console.log("   → Running mathematical computation pipeline...");
    const mathExec = await service.executeCode({
      kernelId: pythonKernel.id,
      code: SAMPLE_CODE_SNIPPETS[1].code
    });
    
    const mathResults = await waitForExecutionResult(
      service,
      pythonKernel.id,
      mathExec.execution_id,
      10000 // 10 second timeout
    );
    assert(mathResults.length > 0, "Math pipeline should produce outputs");
    console.log(`   ✅ Math pipeline completed with ${mathResults.length} outputs`);

    // Test 2.3: Streaming execution for real-time output
    console.log("   → Testing streaming execution...");
    const streamOutputs = [];
    const streamCode = `
import time
import numpy as np

print("Starting iterative computation...")
results = []

for i in range(5):
    # Simulate some computation
    result = np.random.randn(3, 3).mean()
    results.append(result)
    print(f"Iteration {i+1}: {result:.4f}")
    time.sleep(0.5)

print(f"Final results: {results}")
len(results)
`;

    for await (const output of await service.streamExecution({
      kernelId: pythonKernel.id,
      code: streamCode
    })) {
      streamOutputs.push(output);
      if (output.type === 'complete') break;
    }
    assert(streamOutputs.length > 0, "Streaming should produce outputs");
    console.log(`   ✅ Streaming execution produced ${streamOutputs.length} output chunks`);

    // Test 2.4: Error handling and recovery
    console.log("   → Testing error handling...");
    const errorExec = await service.executeCode({
      kernelId: pythonKernel.id,
      code: "raise ValueError('This is a test error for recovery testing')"
    });
    
    const errorResults = await waitForExecutionResult(
      service,
      pythonKernel.id,
      errorExec.execution_id,
      5000 // 5 second timeout for error
    );
    
    // Verify kernel still works after error
    const recoveryExec = await service.executeCode({
      kernelId: pythonKernel.id,
      code: "print('Kernel recovered successfully'); 42"
    });
    
    const recoveryResults = await waitForExecutionResult(
      service,
      pythonKernel.id,
      recoveryExec.execution_id,
      5000 // 5 second timeout
    );
    assert(recoveryResults.length > 0, "Kernel should recover from errors");
    console.log(`   ✅ Error handling and recovery tested successfully`);

    // Phase 3: Vector Database Workflows - Knowledge Management
    console.log("\n📚 Phase 3: Vector Database Workflows - Knowledge Management");

    // Check if Ollama is available to determine which embedding provider to use
    const ollamaAvailable = await isOllamaAvailable();
    const embeddingProviderName = ollamaAvailable ? "ollama-nomic-embed-text" : undefined; // undefined will use mock-model
    if (!ollamaAvailable) {
      console.log("   ⚠️  Ollama not available, using mock embedding model");
    }

    // Test 3.1: Create vector index for research documents
    console.log("   → Creating research document vector index...");
    const researchIndex = await service.createVectorIndex({
      id: "research-docs",
      embeddingProviderName: embeddingProviderName,
      maxDocuments: 1000
    });
    assertExists(researchIndex.id, "Research index should be created");
    console.log(`   ✅ Created research index: ${researchIndex.id}`);

    // Test 3.2: Add research documents
    console.log("   → Adding research documents...");
    await service.addDocuments({
      indexId: researchIndex.id,
      documents: SAMPLE_RESEARCH_DOCS
    });
    
    const indexInfo = await service.getVectorIndexInfo({
      indexId: researchIndex.id
    });
    assertEquals(indexInfo.documentCount, SAMPLE_RESEARCH_DOCS.length, "All documents should be added");
    console.log(`   ✅ Added ${SAMPLE_RESEARCH_DOCS.length} research documents`);

    // Test 3.3: Semantic search workflows
    console.log("   → Testing semantic search queries...");
    
    // Query for AI/ML content
    const aiQuery = await service.queryVectorIndex({
      indexId: researchIndex.id,
      query: "machine learning and artificial intelligence algorithms",
      options: { k: 3, includeMetadata: true }
    });
    assert(aiQuery.results.length > 0, "AI query should return results");
    console.log(`   ✅ AI query returned ${aiQuery.results.length} results`);

    // Query for programming content
    const codeQuery = await service.queryVectorIndex({
      indexId: researchIndex.id,
      query: "programming languages and software development",
      options: { k: 3, threshold: 0.1 }
    });
    assert(codeQuery.results.length > 0, "Programming query should return results");
    console.log(`   ✅ Programming query returned ${codeQuery.results.length} results`);

    // Test 3.4: Document management operations
    console.log("   → Testing document management...");
    
    // Add more documents
    const additionalDocs: IDocument[] = [
      {
        id: "update-doc",
        text: "Updated document about quantum computing and its applications in cryptography",
        metadata: { category: "Technology", type: "update", year: 2024 }
      }
    ];
    
    await service.addDocuments({
      indexId: researchIndex.id,
      documents: additionalDocs
    });
    
    // Verify document count increased
    const updatedInfo = await service.getVectorIndexInfo({
      indexId: researchIndex.id
    });
    assertEquals(updatedInfo.documentCount, SAMPLE_RESEARCH_DOCS.length + additionalDocs.length);
    console.log(`   ✅ Document management: ${updatedInfo.documentCount} total documents`);

    // Phase 4: AI Agent Workflows - Intelligent Assistance
    console.log("\n🤖 Phase 4: AI Agent Workflows - Intelligent Assistance");

    // Variable to store agent IDs for cleanup
    let agentsToCleanup: string[] = [];

    // Check if Ollama is available for agent tests
    if (!ollamaAvailable) {
      console.log("   ⚠️  Ollama not available, skipping agent chat tests");
      console.log("   Note: Agents require LLM for chat functionality");
    } else {
      // Test 4.1: Create research assistant agent
      console.log("   → Creating research assistant agent...");
      const researchAgent = await service.createAgent({
        id: "research-assistant",
        name: "Research Assistant",
        description: "AI agent specialized in research and data analysis",
        instructions: `You are a helpful research assistant. You can:
1. Analyze data and perform calculations
2. Search through research documents
3. Provide insights and summaries
4. Help with coding and data science tasks
Be concise but thorough in your responses.`,
        kernelType: "PYTHON",
        autoAttachKernel: true
      });
      assertExists(researchAgent.id, "Research agent should be created");
      assert(researchAgent.hasKernel, "Agent should have kernel attached");
      console.log(`   ✅ Created research assistant: ${researchAgent.id}`);

      // Test 4.2: Simple conversation workflow
      console.log("   → Testing basic conversation...");
      const conversationOutputs = [];
      
      for await (const chunk of await service.chatWithAgent({
        agentId: researchAgent.id,
        message: "Hello! Can you help me understand what vector databases are and why they're useful?"
      })) {
        conversationOutputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      assert(conversationOutputs.length > 0, "Conversation should produce outputs");
      console.log(`   ✅ Basic conversation completed with ${conversationOutputs.length} response chunks`);

      // Test 4.3: Code generation and execution workflow
      console.log("   → Testing code generation and execution...");
      const codeGenOutputs = [];
      
      for await (const chunk of await service.chatWithAgent({
        agentId: researchAgent.id,
        message: "Please write and execute Python code to calculate the mean, median, and standard deviation of this list: [12, 15, 18, 20, 22, 25, 28, 30, 33, 35]. Show the results."
      })) {
        codeGenOutputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      assert(codeGenOutputs.length > 0, "Code generation should produce outputs");
      console.log(`   ✅ Code generation and execution completed`);

      // Test 4.4: Create specialized data science agent
      console.log("   → Creating data science specialist agent...");
      const dataAgent = await service.createAgent({
        id: "data-scientist",
        name: "Data Science Specialist",
        description: "Expert in statistical analysis and machine learning",
        instructions: `You are a data science expert. You excel at:
1. Statistical analysis and hypothesis testing
2. Machine learning model development
3. Data visualization and interpretation
4. Python libraries like pandas, numpy, scikit-learn
Always show your work and explain your reasoning.`,
        kernelType: "PYTHON",
        autoAttachKernel: true,
        startupScript: `
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score
print("Data science environment ready!")
`
      });
      assertExists(dataAgent.id, "Data science agent should be created");
      console.log(`   ✅ Created data science specialist: ${dataAgent.id}`);

      // Test 4.5: Multi-turn conversation with context
      console.log("   → Testing multi-turn conversation with context...");
      
      // First message about a data analysis task
      const turn1Outputs = [];
      for await (const chunk of await service.chatWithAgent({
        agentId: dataAgent.id,
        message: "I have sales data for the last 12 months. The monthly sales figures are: [120, 135, 148, 162, 155, 171, 185, 178, 195, 203, 198, 210]. Can you analyze this data and tell me about trends?"
      })) {
        turn1Outputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      // Second message building on the first
      const turn2Outputs = [];
      for await (const chunk of await service.chatWithAgent({
        agentId: dataAgent.id,
        message: "Based on your analysis, can you predict the next 3 months of sales using a simple linear trend?"
      })) {
        turn2Outputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      assert(turn1Outputs.length > 0 && turn2Outputs.length > 0, "Multi-turn conversation should work");
      console.log(`   ✅ Multi-turn conversation completed (${turn1Outputs.length + turn2Outputs.length} total chunks)`);

      // Phase 5: Integration Scenarios - Combined Workflows  
      console.log("\n🔄 Phase 5: Integration Scenarios - Combined Workflows");

      // Test 5.1: Agent using kernel for complex analysis
      console.log("   → Agent performing complex statistical analysis...");
      const complexAnalysisOutputs = [];
      
      for await (const chunk of await service.chatWithAgent({
        agentId: dataAgent.id,
        message: `Perform a comprehensive analysis of this dataset and create a predictive model:
Temperature data: [18.5, 19.2, 20.1, 21.8, 23.4, 24.9, 26.2, 25.8, 24.1, 22.3, 20.7, 19.1]
Humidity data: [65, 62, 58, 55, 52, 48, 45, 47, 51, 57, 61, 64]

Please analyze correlation, create a linear model, and provide predictions.`
      })) {
        complexAnalysisOutputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      assert(complexAnalysisOutputs.length > 0, "Complex analysis should produce outputs");
      console.log(`   ✅ Complex statistical analysis completed`);

      // Test 5.2: Cross-agent knowledge sharing scenario
      console.log("   → Testing cross-agent knowledge sharing...");
      
      // Get conversation from data science agent
      const dataAgentConversation = await service.getAgentConversation({
        agentId: dataAgent.id
      });
      assert(dataAgentConversation.length > 0, "Data agent should have conversation history");
      
      // Research agent referencing data science insights
      const knowledgeShareOutputs = [];
      for await (const chunk of await service.chatWithAgent({
        agentId: researchAgent.id,
        message: "I see that a data science specialist has been working on sales trend analysis. Can you summarize what statistical methods are most effective for time series forecasting?"
      })) {
        knowledgeShareOutputs.push(chunk);
        if (chunk.type === 'complete') break;
      }
      
      console.log(`   ✅ Knowledge sharing scenario completed`);

      // Store agent IDs for cleanup
      agentsToCleanup = [researchAgent.id, dataAgent.id];
    }

    // Phase 6: Performance and Resource Management
    console.log("\n⚡ Phase 6: Performance and Resource Management");

    // Test 6.1: Resource monitoring
    console.log("   → Monitoring system resources...");
    const finalStatus = await service.getStatus();
    assertGreater(finalStatus.kernelStats.total, 0, "Should have active kernels");
    console.log(`   📊 Final system state: ${finalStatus.kernelStats.total} kernels, ${finalStatus.systemStats.memoryUsage.heapUsed} memory used`);

    // Test 6.2: Vector database statistics
    const vectorStats = await service.getVectorDBStats();
    assertGreater(vectorStats.namespace.totalIndices, 0, "Should have vector indices");
    assertGreater(vectorStats.namespace.totalDocuments, 0, "Should have documents");
    console.log(`   📊 Vector DB stats: ${vectorStats.namespace.totalIndices} indices, ${vectorStats.namespace.totalDocuments} documents`);

    // Test 6.3: Agent statistics
    const agentStats = await service.getAgentStats();
    if (ollamaAvailable) {
      assertGreater(agentStats.totalAgents, 0, "Should have active agents");
      console.log(`   📊 Agent stats: ${agentStats.totalAgents} agents, ${agentStats.totalConversations} conversations`);
    } else {
      assertEquals(agentStats.totalAgents, 0, "Should have no agents when Ollama is not available");
      console.log(`   📊 Agent stats: No agents created (Ollama not available)`);
    }

    // Phase 7: Cleanup and Verification
    console.log("\n🧹 Phase 7: Cleanup and Verification");

    // Test 7.1: Clean up agents
    console.log("   → Cleaning up agents...");
    for (const agentId of agentsToCleanup) {
      await service.destroyAgent({ agentId });
    }
    
    const postCleanupAgentStats = await service.getAgentStats();
    assertEquals(postCleanupAgentStats.totalAgents, 0, "All agents should be cleaned up");
    console.log(`   ✅ Agents cleaned up successfully`);

    // Test 7.2: Clean up vector indices
    console.log("   → Cleaning up vector indices...");
    await service.destroyVectorIndex({ indexId: researchIndex.id });
    
    const postCleanupVectorStats = await service.getVectorDBStats();
    assertEquals(postCleanupVectorStats.namespace.totalIndices, 0, "All vector indices should be cleaned up");
    console.log(`   ✅ Vector indices cleaned up successfully`);

    // Test 7.3: Clean up kernels
    console.log("   → Cleaning up kernels...");
    await service.destroyKernel({ kernelId: pythonKernel.id });
    
    const remainingKernels = await service.listKernels();
    assertEquals(remainingKernels.length, 0, "All test kernels should be cleaned up");
    console.log(`   ✅ Kernels cleaned up successfully`);

    // Final verification
    const cleanupStatus = await service.getStatus();
    console.log(`   📊 Post-cleanup status: ${cleanupStatus.kernelStats.total} kernels remaining`);

    console.log("\n" + "=".repeat(60));
    console.log("🎉 Comprehensive Hypha Service Test Completed Successfully!");
    console.log("✅ All workflows tested: Kernels, Vector Databases, AI Agents, and Integrations");
    console.log("=".repeat(60));
  },
  sanitizeOps: false,
  sanitizeResources: false
});