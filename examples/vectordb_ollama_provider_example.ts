#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * VectorDB Ollama Provider Example
 * 
 * This example demonstrates how to use the simplified Ollama embedding provider
 * with the VectorDB manager. The embed function is now automatically handled
 * internally, so you only need to provide the configuration.
 */

import { 
  VectorDBManager, 
  createOllamaEmbeddingProvider,
  createGenericEmbeddingProvider,
  type IDocument 
} from "../vectordb/mod.ts";

// Configuration
const OLLAMA_HOST = "http://127.0.0.1:11434";
const EMBEDDING_MODEL = "nomic-embed-text"; // Popular embedding model for Ollama
const EMBEDDING_DIMENSION = 768; // Dimension for nomic-embed-text

async function main() {
  console.log("🚀 VectorDB Ollama Provider Example");
  console.log("=====================================\n");

  // Create VectorDB manager
  const manager = new VectorDBManager({
    maxInstances: 10,
    offloadDirectory: "./example_vectordb_offload"
  });

  try {
    // 1. Create Ollama embedding provider (simplified - no embed function needed!)
    console.log("📦 Creating Ollama embedding provider...");
    const ollamaProvider = createOllamaEmbeddingProvider(
      "Ollama Nomic Embeddings",  // name
      OLLAMA_HOST,                // ollamaHost
      EMBEDDING_MODEL,            // embeddingModel
      EMBEDDING_DIMENSION         // dimension
    );

    // Add provider to registry
    const success = manager.addEmbeddingProvider("ollama-nomic", ollamaProvider);
    if (!success) {
      throw new Error("Failed to add Ollama provider to registry");
    }
    console.log("✅ Ollama provider added to registry");

    // 2. For comparison, create a generic provider (still needs embed function)
    console.log("\n📦 Creating generic embedding provider for comparison...");
    const genericProvider = createGenericEmbeddingProvider(
      "Mock Generic Embeddings",
      384,
      async (text: string) => {
        // Simple mock embedding function
        const embedding = new Array(384).fill(0);
        const hash = text.split('').reduce((a, b) => {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        
        for (let i = 0; i < 384; i++) {
          embedding[i] = Math.sin((hash + i) * 0.1);
        }
        
        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
          for (let i = 0; i < embedding.length; i++) {
            embedding[i] /= magnitude;
          }
        }
        
        return embedding;
      }
    );

    manager.addEmbeddingProvider("generic-mock", genericProvider);
    console.log("✅ Generic provider added to registry");

    // 3. List all providers
    console.log("\n📋 Provider Registry:");
    const providers = manager.listEmbeddingProviders();
    providers.forEach(entry => {
      console.log(`  - ${entry.id}: ${entry.provider.name} (${entry.provider.type}, ${entry.provider.dimension}D)`);
      if (entry.provider.type === "ollama") {
        console.log(`    Host: ${entry.provider.ollamaHost}, Model: ${entry.provider.embeddingModel}`);
      }
    });

    // 4. Create index using Ollama provider
    console.log("\n🗂️  Creating index with Ollama provider...");
    const indexId = await manager.createIndex({
      id: "ollama-example",
      namespace: "example",
      embeddingProviderName: "ollama-nomic"
    });
    console.log(`✅ Index created: ${indexId}`);

    // 5. Add some test documents
    console.log("\n📄 Adding test documents...");
    const documents: IDocument[] = [
      {
        id: "doc1",
        text: "Artificial intelligence and machine learning are transforming technology",
        metadata: { category: "AI", importance: 5 }
      },
      {
        id: "doc2", 
        text: "Web development with modern JavaScript frameworks like React and Vue",
        metadata: { category: "WebDev", importance: 4 }
      },
      {
        id: "doc3",
        text: "Data science involves statistical analysis and predictive modeling",
        metadata: { category: "DataScience", importance: 4 }
      },
      {
        id: "doc4",
        text: "Cloud computing enables scalable and distributed system architectures",
        metadata: { category: "Cloud", importance: 3 }
      }
    ];

    await manager.addDocuments(indexId, documents);
    console.log(`✅ Added ${documents.length} documents`);

    // 6. Query the index
    console.log("\n🔍 Querying the index...");
    const results = await manager.queryIndex(indexId, "machine learning AI", {
      k: 3,
      includeMetadata: true
    });

    console.log(`📊 Query results (${results.length} found):`);
    results.forEach((result, i) => {
      console.log(`  ${i + 1}. ${result.id} (score: ${result.score.toFixed(3)})`);
      console.log(`     Category: ${result.metadata?.category}`);
      console.log(`     Text: ${result.text?.substring(0, 60)}...`);
    });

    // 7. Show provider statistics
    console.log("\n📈 Provider Statistics:");
    const stats = manager.getEmbeddingProviderStats();
    console.log(`  Total providers: ${stats.totalProviders}`);
    console.log(`  Providers in use: ${stats.providersInUse}`);
    console.log(`  By type: ${JSON.stringify(stats.providersByType)}`);

    stats.providerUsage.forEach(usage => {
      console.log(`  - ${usage.id}: ${usage.instancesUsing} instances using`);
    });

    // 8. Demonstrate provider switching (same dimension)
    console.log("\n🔄 Demonstrating provider switching...");
    
    // Create another generic provider with same dimension as Ollama
    const compatibleProvider = createGenericEmbeddingProvider(
      "Compatible Mock Provider",
      EMBEDDING_DIMENSION, // Same dimension as Ollama
      async (text: string) => {
        // Different mock implementation
        const embedding = new Array(EMBEDDING_DIMENSION).fill(0);
        const hash = text.length + text.charCodeAt(0);
        
        for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
          embedding[i] = Math.cos((hash + i) * 0.05);
        }
        
        // Normalize
        const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
        if (magnitude > 0) {
          for (let i = 0; i < embedding.length; i++) {
            embedding[i] /= magnitude;
          }
        }
        
        return embedding;
      }
    );

    manager.addEmbeddingProvider("compatible-mock", compatibleProvider);
    
    // Switch the index to use the new provider
    await manager.changeIndexEmbeddingProvider(indexId, "compatible-mock");
    console.log("✅ Successfully switched index to compatible provider");

    // Query again to show it still works
    const newResults = await manager.queryIndex(indexId, "web development", { k: 2 });
    console.log(`📊 Query with new provider returned ${newResults.length} results`);

    // 9. Clean up
    console.log("\n🧹 Cleaning up...");
    await manager.destroyAll();
    console.log("✅ All indices destroyed");

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Failed to generate embedding with Ollama")) {
      console.error("\n❌ Ollama Error:");
      console.error("   Make sure Ollama is running and the model is available:");
      console.error(`   1. Start Ollama: ollama serve`);
      console.error(`   2. Pull model: ollama pull ${EMBEDDING_MODEL}`);
      console.error(`   3. Verify host: ${OLLAMA_HOST}`);
    } else {
      console.error("\n❌ Error:", errorMessage);
    }
  }

  console.log("\n🎉 Example completed!");
}

if (import.meta.main) {
  await main();
} 