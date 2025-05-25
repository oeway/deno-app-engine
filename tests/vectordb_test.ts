// Simple Vector Database Tests
// Tests basic functionality without heavy dependencies

import { assertEquals, assertExists, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { VectorDBManager, VectorDBEvents, type IDocument, type IQueryOptions } from "../vectordb/mod.ts";

// Import fake-indexeddb polyfill for tests
import "npm:fake-indexeddb/auto";

// Mock embedding function to avoid Transformers.js issues
function createMockEmbedding(text: string): number[] {
  // Create a simple deterministic embedding based on text content
  const words = text.toLowerCase().split(/\s+/);
  const embedding = new Array(384).fill(0);
  
  // Simple hash-based embedding
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < word.length; j++) {
      const charCode = word.charCodeAt(j);
      const index = (charCode + i * 37 + j * 13) % 384;
      embedding[index] += 0.1;
    }
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

Deno.test("VectorDBManager - Basic Functionality (Mock Embeddings)", async (t) => {
  // Create manager with mock embedding model to avoid Transformers.js
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
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
    assertEquals(stats.embeddingModel, "mock-model");
  });

  await t.step("should destroy index", async () => {
    await manager.destroyIndex("test-index");
    
    const instance = manager.getInstance("test-index");
    assertEquals(instance, undefined);
    
    const instances = manager.listInstances();
    assertEquals(instances.length, 0);
  });

  // Clean up
  await manager.destroyAll();
});

Deno.test("VectorDBManager - Document Operations (Mock Embeddings)", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
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
    
    // Should return results (exact order may vary with mock embeddings)
    assertExists(results[0].id);
    assertExists(results[0].score);
    assertExists(results[0].metadata);
  });

  await t.step("should handle documents with pre-computed vectors", async () => {
    const testVector = createMockEmbedding("test vector document");
    
    const vectorDoc: IDocument = {
      id: "vector-doc",
      vector: testVector,
      metadata: { type: "vector-only" }
    };

    await manager.addDocuments(indexId, [vectorDoc]);
    
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 4);
    
    // Query with the same vector should return high similarity
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

  // Clean up
  await manager.destroyAll();
});

Deno.test("VectorDBManager - Namespace Support", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
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

  await t.step("should destroy instances by namespace", async () => {
    await manager.destroyAll("workspace1");
    
    const instances = manager.listInstances();
    assertEquals(instances.length, 0);
  });

  // Clean up
  await manager.destroyAll();
});

Deno.test("VectorDBManager - Error Handling", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 2
  });

  await t.step("should reject duplicate index IDs", async () => {
    await manager.createIndex({ id: "duplicate-test" });
    
    await assertRejects(
      () => manager.createIndex({ id: "duplicate-test" }),
      Error,
      "already exists"
    );
  });

  await t.step("should reject operations on non-existent index", async () => {
    await assertRejects(
      () => manager.addDocuments("non-existent", []),
      Error,
      "not found"
    );
    
    await assertRejects(
      () => manager.queryIndex("non-existent", "test"),
      Error,
      "not found"
    );
    
    await assertRejects(
      () => manager.removeDocuments("non-existent", []),
      Error,
      "not found"
    );
  });

  await t.step("should reject invalid documents", async () => {
    const indexId = await manager.createIndex({ id: "validation-test" });
    
    // Document without text or vector
    await assertRejects(
      () => manager.addDocuments(indexId, [{ id: "invalid" }]),
      Error,
      "must have either text or vector"
    );
  });

  await t.step("should enforce instance limits", async () => {
    // We already have 2 instances, should reject the 3rd
    await assertRejects(
      () => manager.createIndex({ id: "limit-test" }),
      Error,
      "Maximum number"
    );
  });

  // Clean up
  await manager.destroyAll();
});

Deno.test("VectorDBManager - Event System", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 5
  });

  const events: Array<{ type: string; data: any }> = [];

  // Set up event listeners
  manager.on(VectorDBEvents.INDEX_CREATED, (event) => {
    events.push({ type: "INDEX_CREATED", data: event });
  });

  manager.on(VectorDBEvents.DOCUMENT_ADDED, (event) => {
    events.push({ type: "DOCUMENT_ADDED", data: event });
  });

  manager.on(VectorDBEvents.QUERY_COMPLETED, (event) => {
    events.push({ type: "QUERY_COMPLETED", data: event });
  });

  manager.on(VectorDBEvents.DOCUMENT_REMOVED, (event) => {
    events.push({ type: "DOCUMENT_REMOVED", data: event });
  });

  manager.on(VectorDBEvents.INDEX_DESTROYED, (event) => {
    events.push({ type: "INDEX_DESTROYED", data: event });
  });

  await t.step("should emit events for operations", async () => {
    // Create index
    const indexId = await manager.createIndex({ id: "event-test" });
    
    // Add documents
    await manager.addDocuments(indexId, [
      { id: "event-doc1", text: "test document 1" },
      { id: "event-doc2", text: "test document 2" }
    ]);
    
    // Query
    await manager.queryIndex(indexId, "test", { k: 1 });
    
    // Remove documents
    await manager.removeDocuments(indexId, ["event-doc1"]);
    
    // Destroy index
    await manager.destroyIndex(indexId);
    
    // Check events were emitted
    assertEquals(events.length, 5);
    assertEquals(events[0].type, "INDEX_CREATED");
    assertEquals(events[1].type, "DOCUMENT_ADDED");
    assertEquals(events[2].type, "QUERY_COMPLETED");
    assertEquals(events[3].type, "DOCUMENT_REMOVED");
    assertEquals(events[4].type, "INDEX_DESTROYED");
    
    // Check event data
    assertEquals(events[0].data.instanceId, indexId);
    assertEquals(events[1].data.data.count, 2);
    assertEquals(events[2].data.data.resultCount, 1);
    assertEquals(events[3].data.data.count, 1);
    assertEquals(events[4].data.instanceId, indexId);
  });

  // Clean up
  await manager.destroyAll();
});

console.log("🧪 Vector Database Tests (Mock Embeddings)");
console.log("Run with: deno task test-vectordb"); 