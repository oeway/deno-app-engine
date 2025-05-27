#!/usr/bin/env -S deno run --allow-all

/**
 * VectorDB Provider Management Example
 * 
 * This example demonstrates the comprehensive embedding provider management
 * capabilities of the Deno App Engine VectorDB system.
 * 
 * Features demonstrated:
 * - Adding Ollama embedding providers
 * - Testing provider availability
 * - Creating indices with specific providers
 * - Changing providers for existing indices
 * - Provider statistics and monitoring
 * - Error handling and validation
 */

import { 
  VectorDBManager, 
  createOllamaEmbeddingProvider,
  type IDocument,
  VectorDBEvents
} from "../vectordb/mod.ts";

// Configuration
const OLLAMA_HOST = Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
const TEST_OFFLOAD_DIR = "./test_provider_management";

async function demonstrateProviderManagement() {
  console.log("🚀 VectorDB Provider Management Example");
  console.log("=" .repeat(50));

  // Create VectorDB manager
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 10,
    offloadDirectory: TEST_OFFLOAD_DIR,
    enableActivityMonitoring: true
  });

  // Set up event listeners
  manager.on(VectorDBEvents.PROVIDER_ADDED, (event) => {
    console.log(`📦 Provider added: ${event.data.name} (${event.data.type})`);
  });

  manager.on(VectorDBEvents.PROVIDER_REMOVED, (event) => {
    console.log(`🗑️ Provider removed: ${event.data.name}`);
  });

  manager.on(VectorDBEvents.PROVIDER_UPDATED, (event) => {
    console.log(`🔄 Provider updated: ${event.data.id}`);
  });

  try {
    // 1. Add multiple Ollama providers
    console.log("\n1️⃣ Adding Ollama Embedding Providers");
    console.log("-".repeat(40));

    const providers = [
      {
        name: "ollama-nomic-embed-text",
        model: "nomic-embed-text",
        dimension: 768,
        description: "Nomic Embed Text model"
      },
      {
        name: "ollama-all-minilm",
        model: "all-minilm",
        dimension: 384,
        description: "All MiniLM model"
      },
      {
        name: "ollama-mxbai-embed-large",
        model: "mxbai-embed-large",
        dimension: 1024,
        description: "MixedBread AI Large model"
      }
    ];

    for (const providerConfig of providers) {
      try {
        const provider = createOllamaEmbeddingProvider(
          providerConfig.name,
          OLLAMA_HOST,
          providerConfig.model,
          providerConfig.dimension
        );

        const success = manager.addEmbeddingProvider(providerConfig.name, provider);
        if (success) {
          console.log(`✅ Added: ${providerConfig.name} (${providerConfig.dimension}D)`);
        } else {
          console.log(`⚠️ Already exists: ${providerConfig.name}`);
        }
      } catch (error) {
        console.log(`❌ Failed to add ${providerConfig.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2. List and inspect providers
    console.log("\n2️⃣ Provider Registry Status");
    console.log("-".repeat(40));

    const allProviders = manager.listEmbeddingProviders();
    console.log(`Total providers in registry: ${allProviders.length}`);

    for (const entry of allProviders) {
      console.log(`📋 ${entry.id}:`);
      console.log(`   Type: ${entry.provider.type}`);
      console.log(`   Dimension: ${entry.provider.dimension}`);
      console.log(`   Created: ${entry.created.toISOString()}`);
      console.log(`   Last used: ${entry.lastUsed?.toISOString() || "Never"}`);
    }

    // 3. Test provider availability
    console.log("\n3️⃣ Testing Provider Availability");
    console.log("-".repeat(40));

    for (const entry of allProviders) {
      try {
        console.log(`🧪 Testing ${entry.id}...`);
        const testEmbedding = await entry.provider.embed("test embedding");
        console.log(`✅ ${entry.id}: Working (${testEmbedding.length}D vector)`);
      } catch (error) {
        console.log(`❌ ${entry.id}: Failed - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 4. Create indices with different providers
    console.log("\n4️⃣ Creating Indices with Different Providers");
    console.log("-".repeat(40));

    const indices: string[] = [];

    // Create index with first available provider
    if (allProviders.length > 0) {
      const firstProvider = allProviders[0];
      const indexId1 = await manager.createIndex({
        id: "test-index-1",
        embeddingProviderName: firstProvider.id,
        enableActivityMonitoring: true,
        inactivityTimeout: 60000 // 1 minute for demo
      });
      indices.push(indexId1);
      console.log(`✅ Created index with ${firstProvider.id}: ${indexId1}`);
    }

    // Create index with mock model (fallback)
    const indexId2 = await manager.createIndex({
      id: "test-index-mock",
      enableActivityMonitoring: true,
      inactivityTimeout: 60000
    });
    indices.push(indexId2);
    console.log(`✅ Created index with mock model: ${indexId2}`);

    // 5. Add documents to indices
    console.log("\n5️⃣ Adding Documents to Indices");
    console.log("-".repeat(40));

    const sampleDocuments: IDocument[] = [
      {
        id: "doc1",
        text: "Artificial intelligence is transforming the world",
        metadata: { category: "AI", importance: "high" }
      },
      {
        id: "doc2", 
        text: "Machine learning algorithms process vast amounts of data",
        metadata: { category: "ML", importance: "medium" }
      },
      {
        id: "doc3",
        text: "Deep learning neural networks mimic human brain function",
        metadata: { category: "DL", importance: "high" }
      }
    ];

    for (const indexId of indices) {
      try {
        await manager.addDocuments(indexId, sampleDocuments);
        console.log(`✅ Added ${sampleDocuments.length} documents to ${indexId}`);
      } catch (error) {
        console.log(`❌ Failed to add documents to ${indexId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 6. Query indices
    console.log("\n6️⃣ Querying Indices");
    console.log("-".repeat(40));

    const queryText = "artificial intelligence and machine learning";

    for (const indexId of indices) {
      try {
        const results = await manager.queryIndex(indexId, queryText, { k: 2 });
        console.log(`🔍 Query results for ${indexId}:`);
        for (const result of results) {
          console.log(`   📄 ${result.id}: ${result.score.toFixed(4)} - ${result.metadata?.category}`);
        }
      } catch (error) {
        console.log(`❌ Query failed for ${indexId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 7. Change provider for an index (if multiple providers available)
    if (allProviders.length > 1 && indices.length > 0) {
      console.log("\n7️⃣ Changing Index Provider");
      console.log("-".repeat(40));

      const targetIndex = indices[0];
      const newProvider = allProviders[1];

      try {
        // Check current provider
        const instance = manager.getInstance(targetIndex);
        const currentProvider = instance?.options.embeddingProviderName || "default";
        console.log(`Current provider for ${targetIndex}: ${currentProvider}`);

        // Note: This would fail if dimensions don't match or if there are existing embeddings
        // For demo purposes, we'll show the error handling
        try {
          await manager.changeIndexEmbeddingProvider(targetIndex, newProvider.id);
          console.log(`✅ Changed provider to ${newProvider.id}`);
        } catch (error) {
          console.log(`⚠️ Cannot change provider: ${error instanceof Error ? error.message : String(error)}`);
          console.log(`   This is expected if dimensions don't match or index has existing embeddings`);
        }
      } catch (error) {
        console.log(`❌ Provider change failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 8. Provider statistics
    console.log("\n8️⃣ Provider Usage Statistics");
    console.log("-".repeat(40));

    const stats = manager.getEmbeddingProviderStats();
    console.log(`📊 Provider Statistics:`);
    console.log(`   Total providers: ${stats.totalProviders}`);
    console.log(`   Providers in use: ${stats.providersInUse}`);
    console.log(`   By type: ${JSON.stringify(stats.providersByType)}`);

    console.log(`\n📈 Provider Usage Details:`);
    for (const usage of stats.providerUsage) {
      console.log(`   ${usage.name} (${usage.type}):`);
      console.log(`     Instances using: ${usage.instancesUsing}`);
      console.log(`     Dimension: ${usage.dimension}`);
      console.log(`     Last used: ${usage.lastUsed?.toISOString() || "Never"}`);
    }

    // 9. Update a provider (demonstrate validation)
    if (allProviders.length > 0) {
      console.log("\n9️⃣ Provider Update Operations");
      console.log("-".repeat(40));

      const providerToUpdate = allProviders[0];
      console.log(`Attempting to update provider: ${providerToUpdate.id}`);

      try {
        // Try to update with same configuration (should work)
        const updatedProvider = createOllamaEmbeddingProvider(
          providerToUpdate.id,
          OLLAMA_HOST,
          "nomic-embed-text", // Same model
          768 // Same dimension
        );

        const success = manager.updateEmbeddingProvider(providerToUpdate.id, updatedProvider);
        if (success) {
          console.log(`✅ Provider ${providerToUpdate.id} updated successfully`);
        }
      } catch (error) {
        console.log(`❌ Update failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 10. Remove unused providers
    console.log("\n🔟 Provider Cleanup");
    console.log("-".repeat(40));

    // Find providers not in use
    const currentStats = manager.getEmbeddingProviderStats();
    const unusedProviders = currentStats.providerUsage.filter(p => p.instancesUsing === 0);

    console.log(`Found ${unusedProviders.length} unused providers`);

    for (const unused of unusedProviders.slice(0, 1)) { // Remove only first unused for demo
      try {
        const success = manager.removeEmbeddingProvider(unused.id);
        if (success) {
          console.log(`✅ Removed unused provider: ${unused.id}`);
        }
      } catch (error) {
        console.log(`❌ Failed to remove ${unused.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 11. Final status
    console.log("\n📋 Final Status");
    console.log("-".repeat(40));

    const finalStats = manager.getStats();
    console.log(`Active indices: ${finalStats.totalInstances}`);
    console.log(`Total documents: ${finalStats.totalDocuments}`);

    const finalProviderStats = manager.getEmbeddingProviderStats();
    console.log(`Remaining providers: ${finalProviderStats.totalProviders}`);

    // Cleanup
    console.log("\n🧹 Cleanup");
    console.log("-".repeat(40));

    for (const indexId of indices) {
      try {
        await manager.destroyIndex(indexId);
        console.log(`✅ Destroyed index: ${indexId}`);
      } catch (error) {
        console.log(`⚠️ Failed to destroy ${indexId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log("\n✨ Provider Management Example Complete!");

  } catch (error) {
    console.error("❌ Example failed:", error);
    throw error;
  }
}

// API Usage Examples for Server and Hypha Service
function printAPIExamples() {
  console.log("\n" + "=".repeat(60));
  console.log("📚 API Usage Examples");
  console.log("=".repeat(60));

  console.log("\n🌐 Server.ts REST API Examples:");
  console.log("-".repeat(40));

  console.log(`
// List all providers
GET /api/vectordb/providers

// Add new Ollama provider
POST /api/vectordb/providers
{
  "name": "my-ollama-provider",
  "type": "ollama",
  "config": {
    "host": "http://localhost:11434",
    "model": "nomic-embed-text",
    "dimension": 768
  }
}

// Test provider availability
POST /api/vectordb/providers/test
{
  "provider": "my-ollama-provider"
}

// Get specific provider details
GET /api/vectordb/providers/my-ollama-provider

// Update provider
PUT /api/vectordb/providers/my-ollama-provider
{
  "type": "ollama",
  "config": {
    "host": "http://localhost:11434",
    "model": "nomic-embed-text",
    "dimension": 768
  }
}

// Remove provider
DELETE /api/vectordb/providers/my-ollama-provider

// Create index with specific provider
POST /api/vectordb/indices
{
  "id": "my-index",
  "namespace": "default",
  "embeddingProvider": "my-ollama-provider"
}
`);

  console.log("\n🔗 Hypha Service API Examples:");
  console.log("-".repeat(40));

  console.log(`
// List embedding providers
await hyphaService.listEmbeddingProviders()

// Add new provider
await hyphaService.addEmbeddingProvider({
  name: "my-ollama-provider",
  type: "ollama",
  config: {
    host: "http://localhost:11434",
    model: "nomic-embed-text",
    dimension: 768
  }
})

// Test provider
await hyphaService.testEmbeddingProvider({
  providerId: "my-ollama-provider"
})

// Create index with provider
await hyphaService.createVectorIndex({
  id: "my-index",
  embeddingProviderName: "my-ollama-provider"
})

// Change index provider
await hyphaService.changeIndexEmbeddingProvider({
  indexId: "my-index",
  providerId: "different-provider"
})

// Get provider statistics
await hyphaService.getEmbeddingProviderStats()

// Remove provider
await hyphaService.removeEmbeddingProvider({
  providerId: "my-ollama-provider"
})
`);

  console.log("\n💡 Environment Variables:");
  console.log("-".repeat(40));

  console.log(`
# Ollama configuration
OLLAMA_HOST=http://localhost:11434

# VectorDB configuration
EMBEDDING_MODEL=mock-model
VECTORDB_OFFLOAD_DIRECTORY=./vectordb_offload
VECTORDB_DEFAULT_INACTIVITY_TIMEOUT=1800000
VECTORDB_ACTIVITY_MONITORING=true
MAX_VECTOR_DB_INSTANCES=20
`);
}

// Run the example
if (import.meta.main) {
  try {
    await demonstrateProviderManagement();
    printAPIExamples();
  } catch (error) {
    console.error("Example failed:", error);
    Deno.exit(1);
  }
} 