// VectorDB Provider Registry Tests
// Tests the new embedding provider registry functionality

import { assertEquals, assertExists, assertRejects, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { 
  VectorDBManager, 
  VectorDBEvents, 
  type IDocument, 
  type IQueryOptions,
  type IGenericEmbeddingProvider,
  type IOllamaEmbeddingProvider,
  createGenericEmbeddingProvider,
  createOllamaEmbeddingProvider
} from "../vectordb/mod.ts";


// Test configuration
const TEST_CONFIG = {
  offloadDirectory: "./test_vectordb_provider_registry",
  embeddingModel: "mock-model"
};

// Helper function to create a mock embedding function
function createMockEmbedFunction(dimension: number, seed: number = 0): (text: string) => Promise<number[]> {
  return async (text: string): Promise<number[]> => {
    // Create deterministic embeddings based on text and seed
    const embedding = new Array(dimension).fill(0);
    const textHash = text.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, seed);
    
    for (let i = 0; i < dimension; i++) {
      embedding[i] = Math.sin((textHash + i) * 0.1) * 0.5 + Math.cos((textHash + i) * 0.2) * 0.3;
    }
    
    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  };
}

// Helper function to generate test documents
function generateTestDocuments(count: number, prefix: string = "doc"): IDocument[] {
  const documents: IDocument[] = [];
  const topics = [
    "artificial intelligence and machine learning",
    "web development and programming", 
    "data science and analytics",
    "cloud computing and infrastructure",
    "mobile app development"
  ];
  
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const uniqueContent = `${Math.random().toString(36).substring(7)} ${Date.now() + i}`;
    
    documents.push({
      id: `${prefix}-${i}`,
      text: `${topic} document number ${i} with content ${uniqueContent}`,
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

Deno.test("VectorDB - Provider Registry - Basic Operations", async (t) => {
  await cleanupTestDirectory();
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory
  });

  let eventCount = 0;
  manager.on(VectorDBEvents.PROVIDER_ADDED, () => eventCount++);
  manager.on(VectorDBEvents.PROVIDER_REMOVED, () => eventCount++);
  manager.on(VectorDBEvents.PROVIDER_UPDATED, () => eventCount++);

  await t.step("should start with empty provider registry", () => {
    const providers = manager.listEmbeddingProviders();
    assertEquals(providers.length, 0);
    
    const stats = manager.getEmbeddingProviderStats();
    assertEquals(stats.totalProviders, 0);
    assertEquals(stats.providersInUse, 0);
  });

  await t.step("should add generic embedding provider", () => {
    const embedFunction = createMockEmbedFunction(384, 1);
    const provider = createGenericEmbeddingProvider("test-generic", 384, embedFunction);
    
    const success = manager.addEmbeddingProvider("generic-384", provider);
    assert(success);
    
    // Try to add same ID again
    const duplicate = manager.addEmbeddingProvider("generic-384", provider);
    assert(!duplicate);
    
    const providers = manager.listEmbeddingProviders();
    assertEquals(providers.length, 1);
    assertEquals(providers[0].id, "generic-384");
    assertEquals(providers[0].provider.type, "generic");
    assertEquals(providers[0].provider.dimension, 384);
    assertEquals(providers[0].provider.name, "test-generic");
  });

  await t.step("should add Ollama embedding provider", () => {
    const provider = createOllamaEmbeddingProvider(
      "test-ollama", 
      "http://localhost:11434", 
      "nomic-embed-text", 
      768
    );
    
    const success = manager.addEmbeddingProvider("ollama-768", provider);
    assert(success);
    
    const providers = manager.listEmbeddingProviders();
    assertEquals(providers.length, 2);
    
    const ollamaProvider = providers.find(p => p.id === "ollama-768");
    assertExists(ollamaProvider);
    assertEquals(ollamaProvider.provider.type, "ollama");
    assertEquals(ollamaProvider.provider.dimension, 768);
    assertEquals(ollamaProvider.provider.name, "test-ollama");
    
    if (ollamaProvider.provider.type === "ollama") {
      assertEquals(ollamaProvider.provider.ollamaHost, "http://localhost:11434");
      assertEquals(ollamaProvider.provider.embeddingModel, "nomic-embed-text");
    }
  });

  await t.step("should get provider by ID", () => {
    const provider = manager.getEmbeddingProvider("generic-384");
    assertExists(provider);
    assertEquals(provider.id, "generic-384");
    assertEquals(provider.provider.type, "generic");
    
    const nonExistent = manager.getEmbeddingProvider("non-existent");
    assertEquals(nonExistent, undefined);
  });

  await t.step("should check provider existence", () => {
    assert(manager.hasEmbeddingProvider("generic-384"));
    assert(manager.hasEmbeddingProvider("ollama-768"));
    assert(!manager.hasEmbeddingProvider("non-existent"));
  });

  await t.step("should get provider statistics", () => {
    const stats = manager.getEmbeddingProviderStats();
    assertEquals(stats.totalProviders, 2);
    assertEquals(stats.providersByType.generic, 1);
    assertEquals(stats.providersByType.ollama, 1);
    assertEquals(stats.providersInUse, 0);
    assertEquals(stats.providerUsage.length, 2);
  });

  await t.step("should update embedding provider", () => {
    const embedFunction = createMockEmbedFunction(384, 3);
    const updatedProvider = createGenericEmbeddingProvider("updated-generic", 384, embedFunction);
    
    const success = manager.updateEmbeddingProvider("generic-384", updatedProvider);
    assert(success);
    
    const provider = manager.getEmbeddingProvider("generic-384");
    assertExists(provider);
    assertEquals(provider.provider.name, "updated-generic");
    
    // Try to update non-existent provider
    const failed = manager.updateEmbeddingProvider("non-existent", updatedProvider);
    assert(!failed);
  });

  await t.step("should remove embedding provider", () => {
    const success = manager.removeEmbeddingProvider("generic-384");
    assert(success);
    
    const providers = manager.listEmbeddingProviders();
    assertEquals(providers.length, 1);
    
    // Try to remove non-existent provider
    const failed = manager.removeEmbeddingProvider("non-existent");
    assert(!failed);
  });

  await t.step("should have emitted events", () => {
    // Added 2, updated 1, removed 1 = 4 events
    assertEquals(eventCount, 4);
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
});

Deno.test("VectorDB - Provider Registry - Index Integration", async (t) => {
  await cleanupTestDirectory();
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory
  });

  // Add providers
  const embedFunction384 = createMockEmbedFunction(384, 1);
  const embedFunction768 = createMockEmbedFunction(768, 2);
  
  const provider384 = createGenericEmbeddingProvider("test-384", 384, embedFunction384);
  const provider768 = createGenericEmbeddingProvider("test-768", 768, embedFunction768);
  
  manager.addEmbeddingProvider("provider-384", provider384);
  manager.addEmbeddingProvider("provider-768", provider768);

  let indexId384: string;
  let indexId768: string;

  await t.step("should create index with provider from registry", async () => {
    indexId384 = await manager.createIndex({
      id: "test-384",
      namespace: "test",
      embeddingProviderName: "provider-384"
    });
    
    assertExists(indexId384);
    assertEquals(indexId384, "test:test-384");
    
    const instance = manager.getInstance(indexId384);
    assertExists(instance);
    assertEquals(instance.options.embeddingProviderName, "provider-384");
    assertExists(instance.options.embeddingProvider);
    const provider = instance.options.embeddingProvider;
    if (provider && 'name' in provider) {
      assertEquals(provider.name, "test-384");
    }
  });

  await t.step("should create index with different provider", async () => {
    indexId768 = await manager.createIndex({
      id: "test-768",
      namespace: "test",
      embeddingProviderName: "provider-768"
    });
    
    assertExists(indexId768);
    
    const instance = manager.getInstance(indexId768);
    assertExists(instance);
    assertEquals(instance.options.embeddingProviderName, "provider-768");
    assertExists(instance.options.embeddingProvider);
    const provider768 = instance.options.embeddingProvider;
    if (provider768 && 'name' in provider768) {
      assertEquals(provider768.name, "test-768");
    }
  });

  await t.step("should add documents using registry provider", async () => {
    const documents = generateTestDocuments(3, "test384");
    await manager.addDocuments(indexId384, documents);
    
    const instance = manager.getInstance(indexId384);
    assertExists(instance);
    assertEquals(instance.documentCount, 3);
    assertEquals(instance.embeddingDimension, 384);
  });

  await t.step("should add documents using different provider", async () => {
    const documents = generateTestDocuments(3, "test768");
    await manager.addDocuments(indexId768, documents);
    
    const instance = manager.getInstance(indexId768);
    assertExists(instance);
    assertEquals(instance.documentCount, 3);
    assertEquals(instance.embeddingDimension, 768);
  });

  await t.step("should query using registry provider", async () => {
    const results = await manager.queryIndex(indexId384, "artificial intelligence", {
      k: 2,
      includeMetadata: true
    });
    
    assertExists(results);
    assert(results.length > 0);
    assert(results.length <= 2);
  });

  await t.step("should change index provider", async () => {
    // Create a new provider with same dimension
    const newEmbedFunction = createMockEmbedFunction(384, 4);
    const newProvider = createGenericEmbeddingProvider("new-384", 384, newEmbedFunction);
    manager.addEmbeddingProvider("new-provider-384", newProvider);
    
    await manager.changeIndexEmbeddingProvider(indexId384, "new-provider-384");
    
    const instance = manager.getInstance(indexId384);
    assertExists(instance);
    assertEquals(instance.options.embeddingProviderName, "new-provider-384");
    assertExists(instance.options.embeddingProvider);
    const changedProvider = instance.options.embeddingProvider;
    if (changedProvider && 'name' in changedProvider) {
      assertEquals(changedProvider.name, "new-384");
    }
  });

  await t.step("should reject provider change with dimension mismatch", async () => {
    await assertRejects(
      () => manager.changeIndexEmbeddingProvider(indexId384, "provider-768"),
      Error,
      "dimension mismatch"
    );
  });

  await t.step("should prevent removing provider in use", () => {
    try {
      manager.removeEmbeddingProvider("new-provider-384");
      assert(false, "Expected error to be thrown");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("being used by"));
    }
  });

  await t.step("should prevent updating provider dimension when in use", () => {
    const differentDimProvider = createGenericEmbeddingProvider("different-dim", 512, createMockEmbedFunction(512, 5));
    
    try {
      manager.updateEmbeddingProvider("new-provider-384", differentDimProvider);
      assert(false, "Expected error to be thrown");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("dimension change would affect"));
    }
  });

  await t.step("should show provider usage in stats", () => {
    const stats = manager.getEmbeddingProviderStats();
    assertEquals(stats.totalProviders, 3);
    assertEquals(stats.providersInUse, 2);
    
    // Find the providers in use
    const usedProviders = stats.providerUsage.filter(p => p.instancesUsing > 0);
    assertEquals(usedProviders.length, 2);
    
    const provider384 = usedProviders.find(p => p.id === "new-provider-384");
    const provider768 = usedProviders.find(p => p.id === "provider-768");
    
    assertExists(provider384);
    assertExists(provider768);
    assertEquals(provider384.instancesUsing, 1);
    assertEquals(provider768.instancesUsing, 1);
    assertExists(provider384.lastUsed);
    assertExists(provider768.lastUsed);
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
});

Deno.test("VectorDB - Provider Registry - Default Provider", async (t) => {
  await cleanupTestDirectory();
  
  // Create manager with default provider from registry
  const embedFunction = createMockEmbedFunction(512, 1);
  const defaultProvider = createGenericEmbeddingProvider("default-test", 512, embedFunction);
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory
  });
  
  // Add default provider to registry
  manager.addEmbeddingProvider("default-provider", defaultProvider);

  await t.step("should use default provider from registry", async () => {
    // Set default provider name
    const manager2 = new VectorDBManager({
      defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
      defaultEmbeddingProviderName: "default-provider",
      maxInstances: 5,
      offloadDirectory: TEST_CONFIG.offloadDirectory
    });
    
    // Add the provider to the new manager too
    manager2.addEmbeddingProvider("default-provider", defaultProvider);
    
    const indexId = await manager2.createIndex({
      id: "default-test"
    });
    
    const documents = generateTestDocuments(2, "default");
    await manager2.addDocuments(indexId, documents);
    
    const instance = manager2.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.embeddingDimension, 512);
    
    await manager2.destroyAll();
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
});

Deno.test("VectorDB - Provider Registry - Error Handling", async (t) => {
  await cleanupTestDirectory();
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory
  });

  await t.step("should handle non-existent provider in index creation", async () => {
    await assertRejects(
      () => manager.createIndex({
        id: "test",
        embeddingProviderName: "non-existent"
      }),
      Error
    );
  });

  await t.step("should handle non-existent provider in change operation", async () => {
    const indexId = await manager.createIndex({ id: "test" });
    
    await assertRejects(
      () => manager.changeIndexEmbeddingProvider(indexId, "non-existent"),
      Error,
      "not found in registry"
    );
  });

  await t.step("should handle non-existent instance in change operation", async () => {
    const embedFunction = createMockEmbedFunction(384, 1);
    const provider = createGenericEmbeddingProvider("test", 384, embedFunction);
    manager.addEmbeddingProvider("test-provider", provider);
    
    await assertRejects(
      () => manager.changeIndexEmbeddingProvider("non-existent", "test-provider"),
      Error,
      "not found"
    );
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
}); 