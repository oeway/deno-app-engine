// VectorDB Ollama Integration Example
// Demonstrates how to use VectorDB with Ollama as the embedding provider

import { VectorDBManager, type IDocument, type IQueryOptions, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";
import { Ollama } from "npm:ollama";

// Example configuration
const EXAMPLE_CONFIG = {
  ollamaHost: Deno.env.get("OLLAMA_HOST") || "http://localhost:11434",
  embeddingModel: "nomic-embed-text", // A popular embedding model
  offloadDirectory: "./ollama_vectordb_offload",
  testDocumentCount: 20,
};

console.log("Ollama VectorDB Example with Activity Monitoring");
console.log("==============================================");

async function checkOllamaAvailability(): Promise<boolean> {
  try {
    const ollama = new Ollama({ host: EXAMPLE_CONFIG.ollamaHost });
    await ollama.list();
    return true;
  } catch (error) {
    console.error("❌ Ollama is not available:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function ensureModelAvailable(model: string): Promise<boolean> {
  try {
    const ollama = new Ollama({ host: EXAMPLE_CONFIG.ollamaHost });
    const models = await ollama.list();
    
    const modelExists = models.models.some(m => m.name.includes(model));
    
    if (!modelExists) {
      console.log(`📥 Model ${model} not found, pulling...`);
      await ollama.pull({ model });
      console.log(`✅ Model ${model} pulled successfully`);
    } else {
      console.log(`✅ Model ${model} is available`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Failed to ensure model ${model} is available:`, error);
    return false;
  }
}

async function runOllamaExample() {
  console.log("🚀 VectorDB Ollama Integration Example");
  console.log("=====================================");
  console.log("This example demonstrates using Ollama as an embedding provider");
  console.log("for the VectorDB system.\n");

  // Check Ollama availability
  const ollamaAvailable = await checkOllamaAvailability();
  if (!ollamaAvailable) {
    console.log("\n📋 To run this example:");
    console.log("1. Install Ollama: https://ollama.ai/");
    console.log("2. Start Ollama: ollama serve");
    console.log("3. Run this example again");
    return;
  }

  // Ensure embedding model is available
  const modelAvailable = await ensureModelAvailable(EXAMPLE_CONFIG.embeddingModel);
  if (!modelAvailable) {
    console.log(`\n❌ Cannot proceed without embedding model: ${EXAMPLE_CONFIG.embeddingModel}`);
    return;
  }

  try {
    // Create Ollama embedding provider
    console.log("\n🤖 Creating Ollama embedding provider...");
    const embeddingProvider = createOllamaEmbeddingProvider(
      "ollama-nomic-embed-text", // name
      EXAMPLE_CONFIG.ollamaHost, // ollamaHost 
      EXAMPLE_CONFIG.embeddingModel, // embeddingModel
      768 // dimension for nomic-embed-text
    );
    console.log(`   Provider: ${embeddingProvider.name}`);
    console.log(`   Dimension: ${embeddingProvider.dimension}`);

    // Create VectorDB manager with Ollama provider
    console.log("\n🔧 Creating VectorDB manager...");
    const manager = new VectorDBManager({
      defaultEmbeddingProvider: embeddingProvider,
      maxInstances: 5,
      offloadDirectory: EXAMPLE_CONFIG.offloadDirectory,
      defaultInactivityTimeout: 30000, // 30 seconds
      enableActivityMonitoring: true
    });

    // Create a vector index
    console.log("\n📊 Creating vector index...");
    const indexId = await manager.createIndex({
      id: "ollama-example",
      namespace: "demo"
    });
    console.log(`   Index ID: ${indexId}`);

    // Sample documents
    const documents = [
      {
        id: "doc1",
        text: "Artificial intelligence and machine learning are transforming the technology landscape with innovative algorithms and neural networks.",
        metadata: { category: "AI", priority: 1 }
      },
      {
        id: "doc2", 
        text: "Web development frameworks like React, Vue, and Angular enable developers to build modern, responsive user interfaces.",
        metadata: { category: "WebDev", priority: 2 }
      },
      {
        id: "doc3",
        text: "Data science involves statistical analysis, data visualization, and predictive modeling to extract insights from large datasets.",
        metadata: { category: "DataScience", priority: 1 }
      },
      {
        id: "doc4",
        text: "Cloud computing platforms provide scalable infrastructure, serverless functions, and distributed storage solutions.",
        metadata: { category: "Cloud", priority: 3 }
      },
      {
        id: "doc5",
        text: "Mobile app development for iOS and Android requires understanding of platform-specific APIs and user experience design.",
        metadata: { category: "Mobile", priority: 2 }
      }
    ];

    // Add documents
    console.log("\n📝 Adding documents with Ollama embeddings...");
    console.log("   This may take a moment as embeddings are generated...");
    const startTime = Date.now();
    
    await manager.addDocuments(indexId, documents);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ Added ${documents.length} documents in ${duration}ms`);
    console.log(`   Average: ${(duration / documents.length).toFixed(1)}ms per document`);

    // Verify index state
    const instance = manager.getInstance(indexId);
    console.log(`   Document count: ${instance?.documentCount}`);
    console.log(`   Embedding dimension: ${instance?.embeddingDimension}`);

    // Perform queries
    console.log("\n🔍 Performing semantic queries...");
    
    const queries = [
      "machine learning algorithms",
      "web development frameworks", 
      "data analysis and statistics",
      "cloud infrastructure",
      "mobile applications"
    ];

    for (const query of queries) {
      console.log(`\n   Query: "${query}"`);
      const queryStart = Date.now();
      
      const results = await manager.queryIndex(indexId, query, {
        k: 2,
        includeMetadata: true
      });
      
      const queryDuration = Date.now() - queryStart;
      console.log(`   Results (${queryDuration}ms):`);
      
      results.forEach((result, i) => {
        console.log(`     ${i + 1}. ${result.id} (score: ${result.score.toFixed(3)}) - ${result.metadata?.category}`);
      });
    }

    // Test activity monitoring
    console.log("\n⏰ Testing activity monitoring...");
    console.log("   Waiting for auto-offload (this may take 30+ seconds)...");
    console.log("   You can interrupt with Ctrl+C");
    
    // Wait for potential auto-offload
    await new Promise(resolve => setTimeout(resolve, 35000));
    
    // Check if instance was offloaded
    const instanceAfterWait = manager.getInstance(indexId);
    if (!instanceAfterWait) {
      console.log("✅ Instance was automatically offloaded due to inactivity");
      
      // List offloaded indices
      const offloaded = await manager.listOffloadedIndices("demo");
      console.log(`   Offloaded indices: ${offloaded.length}`);
      
      // Resume from offload
      console.log("\n📂 Resuming from offload...");
      const resumedId = await manager.createIndex({
        id: "ollama-example",
        namespace: "demo",
        resume: true
      });
      
      const resumedInstance = manager.getInstance(resumedId);
      console.log(`✅ Resumed with ${resumedInstance?.documentCount} documents`);
      
      // Test query after resume
      const resumeResults = await manager.queryIndex(resumedId, "artificial intelligence", { k: 1 });
      console.log(`   Query after resume: ${resumeResults.length} results`);
    } else {
      console.log("ℹ️  Instance remained active (activity monitoring may be disabled or timeout not reached)");
    }

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await manager.destroyAll();
    
    // Clean up offload directory
    try {
      await Deno.remove(EXAMPLE_CONFIG.offloadDirectory, { recursive: true });
    } catch {
      // Directory might not exist
    }
    
    console.log("✅ Example completed successfully!");

  } catch (error) {
    console.error("\n❌ Example failed:", error);
    throw error;
  }
}

// Run the example
if (import.meta.main) {
  await runOllamaExample();
} 