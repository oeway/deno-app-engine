// Comprehensive Vector Database Tests
// Consolidates all VectorDB functionality including binary format, activity monitoring, and stress testing

import { assertEquals, assertExists, assertRejects, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { VectorDBManager, VectorDBEvents, type IDocument, type IQueryOptions } from "../vectordb/mod.ts";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Import fake-indexeddb polyfill for tests
import "npm:fake-indexeddb/auto";

// Test configuration
const TEST_CONFIG = {
  offloadDirectory: "./test_vectordb_offload",
  inactivityTimeout: 1000, // 1 second for quick tests
  embeddingModel: "mock-model"
};

// Helper function to generate test documents
function generateTestDocuments(count: number, prefix: string = "doc", embeddingDim: number = 384): IDocument[] {
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
    
    // Generate deterministic vector for testing
    const vector = Array.from({ length: embeddingDim }, (_, j) => 
      Math.sin((i + 1) * (j + 1) * 0.1) * 0.5 + Math.cos(i * 0.2) * 0.3
    );
    
    documents.push({
      id: `${prefix}-${i}`,
      text: `${topic} document number ${i} with content ${uniqueContent}`,
      vector,
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

// Helper function to get file size
async function getFileSize(filePath: string): Promise<number> {
  try {
    const stat = await Deno.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Clean up test directory
async function cleanupTestDirectory() {
  try {
    await Deno.remove(TEST_CONFIG.offloadDirectory, { recursive: true });
  } catch {
    // Directory might not exist
  }
}

Deno.test("VectorDB - Basic Functionality", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5
  });

  await t.step("should create a vector index", async () => {
    const indexId = await manager.createIndex({
      id: "test-index"
    });
    
    assertExists(indexId);
    assertEquals(indexId, "test-index");
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.id, indexId);
    assertEquals(instance.documentCount, 0);
  });

  await t.step("should list instances", () => {
    const instances = manager.listInstances();
    assertEquals(instances.length, 1);
    assertEquals(instances[0].id, "test-index");
    assertEquals(instances[0].documentCount, 0);
  });

  await t.step("should get stats", () => {
    const stats = manager.getStats();
    assertEquals(stats.totalInstances, 1);
    assertEquals(stats.totalDocuments, 0);
    assertEquals(stats.embeddingModel, TEST_CONFIG.embeddingModel);
  });

  await t.step("should destroy index", async () => {
    await manager.destroyIndex("test-index");
    
    const instance = manager.getInstance("test-index");
    assertEquals(instance, undefined);
    
    const instances = manager.listInstances();
    assertEquals(instances.length, 0);
  });

  await manager.destroyAll();
});

Deno.test("VectorDB - Document Operations", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5
  });

  let indexId: string;

  await t.step("should create index for document tests", async () => {
    indexId = await manager.createIndex({
      id: "doc-test-index"
    });
    assertExists(indexId);
  });

  await t.step("should add documents with text", async () => {
    const documents: IDocument[] = [
      {
        id: "doc1",
        text: "happy joy sunshine",
        metadata: { category: "positive" }
      },
      {
        id: "doc2", 
        text: "sad rain gloom",
        metadata: { category: "negative" }
      },
      {
        id: "doc3",
        text: "programming code development",
        metadata: { category: "technical" }
      }
    ];

    await manager.addDocuments(indexId, documents);
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 3);
    assertExists(instance.embeddingDimension);
    assertEquals(instance.embeddingDimension, 384);
  });

  await t.step("should query documents with text", async () => {
    const results = await manager.queryIndex(indexId, "happy joy", {
      k: 2,
      includeMetadata: true
    });
    
    assertExists(results);
    assertEquals(results.length, 2);
    
    assertExists(results[0].id);
    assertExists(results[0].score);
    assertExists(results[0].metadata);
  });

  await t.step("should handle documents with pre-computed vectors", async () => {
    const testVector = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
    
    const vectorDoc: IDocument = {
      id: "vector-doc",
      vector: testVector,
      metadata: { type: "vector-only" }
    };

    await manager.addDocuments(indexId, [vectorDoc]);
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 4);
    
    const results = await manager.queryIndex(indexId, testVector, {
      k: 1,
      includeMetadata: true
    });
    
    assertExists(results);
    assertEquals(results.length, 1);
    assertEquals(results[0].id, "vector-doc");
    assertEquals(results[0].metadata?.type, "vector-only");
  });

  await t.step("should remove documents", async () => {
    await manager.removeDocuments(indexId, ["doc2"]);
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 3);
  });

  await manager.destroyAll();
});

Deno.test("VectorDB - Namespace Support", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 10
  });

  await t.step("should create index with namespace", async () => {
    const indexId = await manager.createIndex({
      id: "test-index",
      namespace: "workspace1"
    });
    
    assertEquals(indexId, "workspace1:test-index");
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
  });

  await t.step("should filter instances by namespace", () => {
    const allInstances = manager.listInstances();
    assertEquals(allInstances.length, 1);
    
    const workspace1Instances = manager.listInstances("workspace1");
    assertEquals(workspace1Instances.length, 1);
    assertEquals(workspace1Instances[0].namespace, "workspace1");
    
    const workspace2Instances = manager.listInstances("workspace2");
    assertEquals(workspace2Instances.length, 0);
  });

  await t.step("should destroy by namespace", async () => {
    await manager.destroyAll("workspace1");
    
    const instances = manager.listInstances();
    assertEquals(instances.length, 0);
  });

  await manager.destroyAll();
});

Deno.test("VectorDB - Activity Monitoring", async (t) => {
  await cleanupTestDirectory();
  await ensureDir(TEST_CONFIG.offloadDirectory);
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory,
    defaultInactivityTimeout: TEST_CONFIG.inactivityTimeout,
    enableActivityMonitoring: true
  });

  let indexId: string;

  await t.step("should create index with activity monitoring", async () => {
    indexId = await manager.createIndex({
      id: "activity-test",
      namespace: "test",
      enableActivityMonitoring: true,
      inactivityTimeout: TEST_CONFIG.inactivityTimeout
    });
    
    assertExists(indexId);
    
    // Should have initial activity time
    const lastActivity = manager.getLastActivityTime(indexId);
    assertExists(lastActivity);
    assert(lastActivity > 0);
  });

  await t.step("should track activity on operations", async () => {
    const documents = generateTestDocuments(5, "activity", 384);
    
    const beforeActivity = manager.getLastActivityTime(indexId);
    
    // Small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));
    
    await manager.addDocuments(indexId, documents);
    
    const afterActivity = manager.getLastActivityTime(indexId);
    assertExists(afterActivity);
    assert(afterActivity! > beforeActivity!);
  });

  await t.step("should ping instance to reset activity", () => {
    const beforePing = manager.getLastActivityTime(indexId);
    
    const success = manager.pingInstance(indexId);
    assertEquals(success, true);
    
    const afterPing = manager.getLastActivityTime(indexId);
    assertExists(afterPing);
    assert(afterPing! >= beforePing!);
  });

  await t.step("should auto-offload inactive instance", async () => {
    // Wait for auto-offload
    await new Promise(resolve => setTimeout(resolve, TEST_CONFIG.inactivityTimeout + 100));
    
    // Instance should be offloaded
    const instance = manager.getInstance(indexId);
    assertEquals(instance, undefined);
    
    // Should have offloaded files
    const metadataPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.metadata.json`);
    const metadataExists = await exists(metadataPath);
    assertEquals(metadataExists, true);
  });

  await t.step("should resume from offload", async () => {
    // Create index with same ID should resume from offload
    const resumedId = await manager.createIndex({
      id: "activity-test",
      namespace: "test",
      resume: true
    });
    
    assertEquals(resumedId, indexId);
    
    const instance = manager.getInstance(resumedId);
    assertExists(instance);
    assertEquals(instance.isFromOffload, true);
    assertEquals(instance.documentCount, 5);
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
});

Deno.test("VectorDB - Binary Format Storage", async (t) => {
  await cleanupTestDirectory();
  await ensureDir(TEST_CONFIG.offloadDirectory);
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory,
    defaultInactivityTimeout: 10000, // Long timeout to prevent auto-offload
    enableActivityMonitoring: true
  });

  let indexId: string;

  await t.step("should create index for binary format test", async () => {
    indexId = await manager.createIndex({
      id: "binary-test",
      namespace: "test"
    });
    assertExists(indexId);
  });

  await t.step("should add documents with vectors", async () => {
    const documents = generateTestDocuments(10, "binary", 128);
    await manager.addDocuments(indexId, documents);
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 10);
    assertEquals(instance.embeddingDimension, 128);
  });

  await t.step("should offload to binary format", async () => {
    await manager.manualOffload(indexId);
    
    // Instance should be offloaded
    const instance = manager.getInstance(indexId);
    assertEquals(instance, undefined);
    
    // Check binary format files exist
    const metadataPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.metadata.json`);
    const documentsPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.documents.json`);
    const vectorsPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.vectors.bin`);
    
    assertEquals(await exists(metadataPath), true);
    assertEquals(await exists(documentsPath), true);
    assertEquals(await exists(vectorsPath), true);
    
    // Check metadata format
    const metadataContent = await Deno.readTextFile(metadataPath);
    const metadata = JSON.parse(metadataContent);
    assertEquals(metadata.format, "binary_v1");
    assertEquals(metadata.documentCount, 10);
    assertEquals(metadata.embeddingDimension, 128);
  });

  await t.step("should verify binary format efficiency", async () => {
    const metadataPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.metadata.json`);
    const documentsPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.documents.json`);
    const vectorsPath = join(TEST_CONFIG.offloadDirectory, `${indexId}.vectors.bin`);
    
    const metadataSize = await getFileSize(metadataPath);
    const documentsSize = await getFileSize(documentsPath);
    const vectorsSize = await getFileSize(vectorsPath);
    const totalBinarySize = metadataSize + documentsSize + vectorsSize;
    
    // Create equivalent JSON format for comparison
    const documents = generateTestDocuments(10, "binary", 128);
    const jsonPath = join(TEST_CONFIG.offloadDirectory, "legacy.json");
    await Deno.writeTextFile(jsonPath, JSON.stringify(documents, null, 2));
    const jsonSize = await getFileSize(jsonPath);
    
    console.log(`Binary format: ${formatBytes(totalBinarySize)} (metadata: ${formatBytes(metadataSize)}, docs: ${formatBytes(documentsSize)}, vectors: ${formatBytes(vectorsSize)})`);
    console.log(`JSON format: ${formatBytes(jsonSize)}`);
    console.log(`Compression ratio: ${(jsonSize / totalBinarySize).toFixed(2)}x`);
    console.log(`Space savings: ${((jsonSize - totalBinarySize) / jsonSize * 100).toFixed(1)}%`);
    
    // Binary format should be more efficient
    assert(totalBinarySize < jsonSize);
    
    // Vector storage should be near-optimal (128 dims * 10 docs * 4 bytes + overhead)
    const theoreticalVectorSize = 128 * 10 * 4; // 5120 bytes
    const vectorEfficiency = vectorsSize / (theoreticalVectorSize + 8 + 10 * 4); // Add header and ID overhead
    console.log(`Vector storage efficiency: ${(vectorEfficiency * 100).toFixed(1)}%`);
    
    // Clean up comparison file
    await Deno.remove(jsonPath);
  });

  await t.step("should resume from binary format", async () => {
    const resumedId = await manager.createIndex({
      id: "binary-test",
      namespace: "test",
      resume: true
    });
    
    assertEquals(resumedId, indexId);
    
    const instance = manager.getInstance(resumedId);
    assertExists(instance);
    assertEquals(instance.isFromOffload, true);
    assertEquals(instance.documentCount, 10);
    assertEquals(instance.embeddingDimension, 128);
  });

  await t.step("should verify data integrity after resume", async () => {
    // Query to verify vectors were restored correctly
    const results = await manager.queryIndex(indexId, "artificial intelligence", {
      k: 5,
      includeMetadata: true
    });
    
    assertExists(results);
    assert(results.length > 0);
    
    // Verify metadata is preserved
    for (const result of results) {
      assertExists(result.metadata);
      assertExists(result.metadata.index);
      assertExists(result.metadata.topic);
    }
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
});

Deno.test("VectorDB - Stress Testing", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 10
  });

  await t.step("should handle concurrent operations", async () => {
    // Create multiple indices concurrently
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      manager.createIndex({
        id: `concurrent-${i}`,
        namespace: "stress-test"
      })
    );
    
    const indexIds = await Promise.all(createPromises);
    assertEquals(indexIds.length, 5);
    
    // Add documents to all indices concurrently
    const addPromises = indexIds.map((indexId, i) => {
      const docs = generateTestDocuments(10, `concurrent-${i}`, 384);
      return manager.addDocuments(indexId, docs);
    });
    
    await Promise.all(addPromises);
    
    // Query all indices concurrently
    const queryPromises = indexIds.map(indexId =>
      manager.queryIndex(indexId, "artificial intelligence", { k: 3 })
    );
    
    const results = await Promise.all(queryPromises);
    const totalResults = results.reduce((sum, result) => sum + result.length, 0);
    assert(totalResults > 0);
  });

  await t.step("should handle large datasets", async () => {
    const indexId = await manager.createIndex({
      id: "large-dataset",
      namespace: "stress-test"
    });
    
    // Add documents in batches
    const batchSize = 25;
    const totalDocs = 100;
    const batches = Math.ceil(totalDocs / batchSize);
    
    for (let batch = 0; batch < batches; batch++) {
      const startIdx = batch * batchSize;
      const endIdx = Math.min(startIdx + batchSize, totalDocs);
      const batchDocs = generateTestDocuments(endIdx - startIdx, `batch-${batch}`, 384);
      
      await manager.addDocuments(indexId, batchDocs);
    }
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, totalDocs);
    
    // Test queries on large dataset
    const queryResults = await manager.queryIndex(indexId, "technology trends", { k: 10 });
    assert(queryResults.length > 0);
  });

  await t.step("should handle edge cases", async () => {
    // Test instance limit
    const maxInstances = 10;
    const indexIds: string[] = [];
    
    // Create up to the limit (we already have some from previous tests)
    const currentCount = manager.listInstances("stress-test").length;
    const remaining = maxInstances - currentCount;
    
    for (let i = 0; i < remaining; i++) {
      const id = await manager.createIndex({ 
        id: `limit-${i}`, 
        namespace: "stress-test" 
      });
      indexIds.push(id);
    }
    
    // Try to exceed limit
    await assertRejects(
      () => manager.createIndex({ id: "limit-exceed", namespace: "stress-test" }),
      Error,
      "Maximum number of vector database instances"
    );
    
    // Test operations on non-existent index
    await assertRejects(
      () => manager.addDocuments("non-existent", [{ id: "test", text: "test" }]),
      Error,
      "not found"
    );
    
    // Test invalid documents
    const validIndexId = indexIds[0];
    await assertRejects(
      () => manager.addDocuments(validIndexId, [{ id: "invalid" }] as any),
      Error
    );
  });

  await manager.destroyAll();
});

Deno.test("VectorDB - Event System", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5
  });

  await t.step("should emit events for operations", async () => {
    const events: string[] = [];
    
    manager.on(VectorDBEvents.INDEX_CREATED, () => events.push("created"));
    manager.on(VectorDBEvents.DOCUMENT_ADDED, () => events.push("added"));
    manager.on(VectorDBEvents.QUERY_COMPLETED, () => events.push("queried"));
    manager.on(VectorDBEvents.INDEX_DESTROYED, () => events.push("destroyed"));
    
    const indexId = await manager.createIndex({ id: "event-test" });
    
    await manager.addDocuments(indexId, [{
      id: "doc1",
      text: "test document",
      metadata: { test: true }
    }]);
    
    await manager.queryIndex(indexId, "test", { k: 1 });
    
    await manager.destroyIndex(indexId);
    
    assertEquals(events.length, 4);
    assertEquals(events, ["created", "added", "queried", "destroyed"]);
  });

  await manager.destroyAll();
});

Deno.test("VectorDB - Offload Management", async (t) => {
  await cleanupTestDirectory();
  await ensureDir(TEST_CONFIG.offloadDirectory);
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: TEST_CONFIG.offloadDirectory,
    defaultInactivityTimeout: 10000,
    enableActivityMonitoring: true
  });

  let indexId: string;

  await t.step("should create and offload index", async () => {
    indexId = await manager.createIndex({
      id: "offload-test",
      namespace: "test"
    });
    
    const documents = generateTestDocuments(5, "offload", 256);
    await manager.addDocuments(indexId, documents);
    
    await manager.manualOffload(indexId);
    
    // Verify offloaded
    const instance = manager.getInstance(indexId);
    assertEquals(instance, undefined);
  });

  await t.step("should list offloaded indices", async () => {
    const offloaded = await manager.listOffloadedIndices("test");
    assertEquals(offloaded.length, 1);
    assertEquals(offloaded[0].id, indexId);
    assertEquals(offloaded[0].documentCount, 5);
  });

  await t.step("should set custom timeout", async () => {
    // Resume first
    const resumedId = await manager.createIndex({
      id: "offload-test",
      namespace: "test",
      resume: true
    });
    
    const success = manager.setInactivityTimeout(resumedId, 5000);
    assertEquals(success, true);
    
    const timeout = manager.getInactivityTimeout(resumedId);
    assertEquals(timeout, 5000);
  });

  await t.step("should delete offloaded index", async () => {
    // Offload again (use the resumed ID)
    const currentInstance = manager.getInstance(indexId);
    if (currentInstance) {
      await manager.manualOffload(indexId);
    }
    
    await manager.deleteOffloadedIndex(indexId);
    
    const offloaded = await manager.listOffloadedIndices("test");
    assertEquals(offloaded.length, 0);
  });

  await manager.destroyAll();
  await cleanupTestDirectory();
}); 