// VectorDB Ollama Integration Tests
// Tests VectorDB functionality using Ollama as the embedding provider

import { assertEquals, assertExists, assertRejects, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { VectorDBManager, VectorDBEvents, type IDocument, type IQueryOptions, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";


// Import Ollama
import { Ollama } from "npm:ollama";

// Test configuration
// OLLAMA_ENDPOINT = "https://hypha-ollama.scilifelab-2-dev.sys.kth.se"
// OLLAMA_MODEL = "nomic-embed-text"  # For embeddings - lightweight model suitable for CI
// OLLAMA_LLM_MODEL = "llama3.2:1b"  # For generation - small model suitable for CI testing
const TEST_CONFIG = {
  offloadDirectory: "./test_vectordb_ollama_offload",
  inactivityTimeout: 5000, // 5 seconds for quick tests
  ollamaHost: "http://127.0.0.1:11434",
  embeddingModel: "nomic-embed-text", // A good embedding model for Ollama
  testTimeout: 60000 // 60 seconds for Ollama operations
};

// Helper function to create Ollama provider for testing
function createTestOllamaProvider(model: string = TEST_CONFIG.embeddingModel, host: string = TEST_CONFIG.ollamaHost) {
  // nomic-embed-text typically has 768 dimensions
  const dimension = model === "nomic-embed-text" ? 768 : 384;
  
  return createOllamaEmbeddingProvider(
    `Ollama-${model}`,
    host,
    model,
    dimension
  );
}

// Helper function to check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const ollama = new Ollama({ host: TEST_CONFIG.ollamaHost });
    await ollama.list();
    return true;
  } catch {
    return false;
  }
}

// Helper function to check if the embedding model is available
async function isModelAvailable(model: string): Promise<boolean> {
  try {
    const ollama = new Ollama({ host: TEST_CONFIG.ollamaHost });
    const models = await ollama.list();
    return models.models.some(m => m.name.includes(model));
  } catch {
    return false;
  }
}

// Helper function to pull model if not available
async function ensureModelAvailable(model: string): Promise<void> {
  const ollama = new Ollama({ host: TEST_CONFIG.ollamaHost });
  
  if (!(await isModelAvailable(model))) {
    console.log(`📥 Pulling Ollama model: ${model}...`);
    console.log("This may take a few minutes for the first time.");
    
    try {
      await ollama.pull({ model });
      console.log(`✅ Model ${model} pulled successfully`);
    } catch (error) {
      throw new Error(`Failed to pull model ${model}: ${error}`);
    }
  }
}

// Helper function to generate test documents
function generateTestDocuments(count: number, prefix: string = "doc"): IDocument[] {
  const documents: IDocument[] = [];
  const topics = [
    "artificial intelligence and machine learning algorithms",
    "web development with modern JavaScript frameworks", 
    "data science and statistical analysis techniques",
    "cloud computing and distributed systems architecture",
    "mobile application development for iOS and Android"
  ];
  
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const uniqueContent = `${Math.random().toString(36).substring(7)} ${Date.now() + i}`;
    
    documents.push({
      id: `${prefix}-${i}`,
      text: `${topic} - Document ${i} with detailed content: ${uniqueContent}. This document explores various aspects of technology and innovation in the modern world.`,
      metadata: {
        index: i,
        topic: topic.split(" ")[0],
        category: i % 3 === 0 ? "technical" : i % 3 === 1 ? "business" : "research",
        priority: Math.floor(Math.random() * 5) + 1,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  return documents;
}

// Clean up test directory
async function cleanupTestDirectory() {
  try {
    await Deno.remove(TEST_CONFIG.offloadDirectory, { recursive: true });
  } catch {
    // Directory might not exist
  }
}

Deno.test({
  name: "VectorDB - Ollama Integration - Basic Functionality",
  async fn(t) {
    // Check if Ollama is available
    const ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.log("⚠️  Ollama not available at " + TEST_CONFIG.ollamaHost + ", skipping Ollama tests");
      console.log("   To run these tests, please:");
      console.log("   1. Install Ollama: https://ollama.ai/");
      console.log("   2. Start Ollama: ollama serve");
      console.log("   3. Pull the embedding model: ollama pull " + TEST_CONFIG.embeddingModel);
      return;
    }

    // Ensure the embedding model is available
    try {
      await ensureModelAvailable(TEST_CONFIG.embeddingModel);
    } catch (error) {
      console.log(`⚠️  Failed to ensure model ${TEST_CONFIG.embeddingModel} is available: ${error}`);
      console.log("   Skipping Ollama tests");
      return;
    }

    const embeddingProvider = createTestOllamaProvider();
    const manager = new VectorDBManager({
      maxInstances: 5,
      offloadDirectory: TEST_CONFIG.offloadDirectory,
      defaultInactivityTimeout: 300000, // 5 minutes to prevent auto-offload during test
      enableActivityMonitoring: false // Disable for testing
    });

    // Add the Ollama provider to the registry
    manager.addEmbeddingProvider("ollama-test", embeddingProvider);

    let indexId: string;

    await t.step("should create index with Ollama provider", async () => {
      indexId = await manager.createIndex({
        id: "ollama-test-index",
        namespace: "ollama-test",
        embeddingProviderName: "ollama-test"
      });
      
      assertExists(indexId);
      assertEquals(indexId, "ollama-test:ollama-test-index");
      
      const instance = manager.getInstance(indexId);
      assertExists(instance);
      assertEquals(instance.id, indexId);
      assertEquals(instance.documentCount, 0);
    });

    await t.step("should add documents using Ollama embeddings", async () => {
      const documents = generateTestDocuments(3, "ollama");
      
      console.log("🤖 Generating embeddings with Ollama...");
      await manager.addDocuments(indexId, documents);
      
      const instance = manager.getInstance(indexId);
      assertExists(instance);
      assertEquals(instance.documentCount, 3);
      assertEquals(instance.embeddingDimension, embeddingProvider.dimension);
      
      console.log(`✅ Added ${documents.length} documents with ${instance.embeddingDimension}-dimensional embeddings`);
    });

    await t.step("should query documents using Ollama embeddings", async () => {
      console.log("🔍 Querying with Ollama embeddings...");
      
      const results = await manager.queryIndex(indexId, "artificial intelligence machine learning", {
        k: 2,
        includeMetadata: true
      });
      
      assertExists(results);
      assert(results.length > 0);
      assert(results.length <= 2);
      
      console.log(`✅ Query returned ${results.length} results:`);
      results.forEach((result, i) => {
        console.log(`   ${i + 1}. ${result.id} (score: ${result.score.toFixed(3)})`);
        assertExists(result.id);
        assertExists(result.score);
        assertExists(result.metadata);
      });
    });

    await t.step("should handle mixed content queries", async () => {
      const webDevResults = await manager.queryIndex(indexId, "web development JavaScript", {
        k: 1,
        includeMetadata: true
      });
      
      assertExists(webDevResults);
      assert(webDevResults.length > 0);
      
      const dataResults = await manager.queryIndex(indexId, "data science statistics", {
        k: 1,
        includeMetadata: true
      });
      
      assertExists(dataResults);
      assert(dataResults.length > 0);
      
      console.log("✅ Successfully handled different topic queries");
    });

    await manager.destroyAll();
    await cleanupTestDirectory();
  },
  sanitizeOps: false,
  sanitizeResources: false
});

Deno.test({
  name: "VectorDB - Ollama Integration - Instance-Specific Provider",
  async fn(t) {
    // Check if Ollama is available
    const ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.log("⚠️  Ollama not available, skipping instance-specific provider test");
      return;
    }

    try {
      await ensureModelAvailable(TEST_CONFIG.embeddingModel);
    } catch (error) {
      console.log(`⚠️  Failed to ensure model availability: ${error}`);
      return;
    }

    // Create manager without default provider
    const manager = new VectorDBManager({
      defaultEmbeddingModel: "mock-model", // Fallback to mock
      maxInstances: 5
    });

    let indexId: string;

    await t.step("should create index with instance-specific Ollama provider", async () => {
      const embeddingProvider = createTestOllamaProvider();
      
      indexId = await manager.createIndex({
        id: "instance-ollama-test",
        namespace: "test",
        embeddingProvider: embeddingProvider,
        enableActivityMonitoring: false // Disable for testing
      });
      
      assertExists(indexId);
      
      const instance = manager.getInstance(indexId);
      assertExists(instance);
      assertExists(instance.options.embeddingProvider);
      const provider = instance.options.embeddingProvider;
      assertEquals(provider.name, embeddingProvider.name);
    });

    await t.step("should use instance-specific provider for operations", async () => {
      const documents = generateTestDocuments(2, "instance");
      
      await manager.addDocuments(indexId, documents);
      
      const instance = manager.getInstance(indexId);
      assertExists(instance);
      assertEquals(instance.documentCount, 2);
      assertEquals(instance.embeddingDimension, 768); // nomic-embed-text dimension
      
      // Query should also use the instance-specific provider
      const results = await manager.queryIndex(indexId, "technology innovation", { k: 1 });
      assertExists(results);
      assert(results.length > 0);
    });

    await manager.destroyAll();
  },
  sanitizeOps: false,
  sanitizeResources: false
});

Deno.test({
  name: "VectorDB - Ollama Integration - Error Handling",
  async fn(t) {
    await t.step("should handle invalid Ollama host gracefully", async () => {
      const invalidProvider = createOllamaEmbeddingProvider(
        "Invalid Ollama",
        "http://invalid-host:11434",
        TEST_CONFIG.embeddingModel,
        768
      );
      
      const manager = new VectorDBManager({
        maxInstances: 5
      });

      manager.addEmbeddingProvider("invalid-ollama", invalidProvider);

      const indexId = await manager.createIndex({
        id: "error-test",
        embeddingProviderName: "invalid-ollama"
      });

      const documents = [{ id: "test-doc", text: "test content" }];
      
      // Should fail gracefully
      await assertRejects(
        () => manager.addDocuments(indexId, documents),
        Error
      );

      await manager.destroyAll();
    });

    await t.step("should handle invalid model gracefully", async () => {
      const ollamaAvailable = await isOllamaAvailable();
      if (!ollamaAvailable) {
        console.log("⚠️  Ollama not available, skipping invalid model test");
        return;
      }

      const invalidProvider = createOllamaEmbeddingProvider(
        "Invalid Model",
        TEST_CONFIG.ollamaHost,
        "non-existent-model",
        768
      );
      
      const manager = new VectorDBManager({
        maxInstances: 5
      });

      manager.addEmbeddingProvider("invalid-model", invalidProvider);

      const indexId = await manager.createIndex({
        id: "invalid-model-test",
        embeddingProviderName: "invalid-model"
      });

      const documents = [{ id: "test-doc", text: "test content" }];
      
      // Should fail gracefully
      await assertRejects(
        () => manager.addDocuments(indexId, documents),
        Error
      );

      await manager.destroyAll();
    });
  },
  sanitizeOps: false,
  sanitizeResources: false
});

Deno.test({
  name: "VectorDB - Ollama Integration - Performance Test",
  async fn(t) {
    const ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      console.log("⚠️  Ollama not available, skipping performance test");
      return;
    }

    try {
      await ensureModelAvailable(TEST_CONFIG.embeddingModel);
    } catch (error) {
      console.log(`⚠️  Failed to ensure model availability: ${error}`);
      return;
    }

    const embeddingProvider = createTestOllamaProvider();
    const manager = new VectorDBManager({
      maxInstances: 5
    });

    manager.addEmbeddingProvider("ollama-perf", embeddingProvider);

    await t.step("should handle batch document processing efficiently", async () => {
      const indexId = await manager.createIndex({
        id: "performance-test",
        namespace: "perf",
        embeddingProviderName: "ollama-perf"
      });

      const documents = generateTestDocuments(10, "perf");
      
      console.log("⏱️  Testing batch processing performance...");
      const startTime = Date.now();
      
      await manager.addDocuments(indexId, documents);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      console.log(`✅ Processed ${documents.length} documents in ${duration}ms (${(duration / documents.length).toFixed(1)}ms per document)`);
      
      const instance = manager.getInstance(indexId);
      assertExists(instance);
      assertEquals(instance.documentCount, documents.length);
      
      // Test query performance
      const queryStartTime = Date.now();
      const results = await manager.queryIndex(indexId, "artificial intelligence", { k: 5 });
      const queryEndTime = Date.now();
      const queryDuration = queryEndTime - queryStartTime;
      
      console.log(`✅ Query completed in ${queryDuration}ms, returned ${results.length} results`);
      
      assertExists(results);
      assert(results.length > 0);
    });

    await manager.destroyAll();
  },
  sanitizeOps: false,
  sanitizeResources: false
}); 