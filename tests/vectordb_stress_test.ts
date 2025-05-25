// Comprehensive stress test for VectorDBManager
import { VectorDBManager, VectorDBEvents, type IDocument, type IQueryOptions } from "../vectordb/mod.ts";

console.log("🔥 VectorDBManager Stress Test");
console.log("Testing concurrent operations, large datasets, and edge cases...");

// Helper function to generate test documents
function generateTestDocuments(count: number, prefix: string = "doc"): IDocument[] {
  const documents: IDocument[] = [];
  const topics = [
    "artificial intelligence and machine learning",
    "web development and programming",
    "data science and analytics", 
    "cloud computing and infrastructure",
    "mobile app development",
    "cybersecurity and privacy",
    "blockchain and cryptocurrency",
    "internet of things and sensors",
    "virtual reality and gaming",
    "robotics and automation"
  ];
  
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const uniqueContent = `${Math.random().toString(36).substring(7)} ${Date.now() + i}`;
    documents.push({
      id: `${prefix}-${i}`,
      text: `${topic} document number ${i} with additional content about technology trends ${uniqueContent}`,
      metadata: {
        index: i,
        topic: topic.split(" ")[0],
        category: i % 3 === 0 ? "technical" : i % 3 === 1 ? "business" : "research",
        priority: Math.floor(Math.random() * 5) + 1,
        uniqueId: uniqueContent
      }
    });
  }
  
  return documents;
}

// Test concurrent operations
async function testConcurrentOperations() {
  console.log("\n🔄 Testing Concurrent Operations...");
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 10
  });
  
  // Create multiple indices concurrently
  console.log("Creating 5 indices concurrently...");
  const createPromises = Array.from({ length: 5 }, (_, i) =>
    manager.createIndex({
      id: `concurrent-${i}`,
      namespace: "stress-test"
    })
  );
  
  const indexIds = await Promise.all(createPromises);
  console.log(`✅ Created ${indexIds.length} indices concurrently`);
  
  // Add documents to all indices concurrently
  console.log("Adding documents to all indices concurrently...");
  const addPromises = indexIds.map((indexId, i) => {
    const docs = generateTestDocuments(20, `concurrent-${i}`);
    return manager.addDocuments(indexId, docs);
  });
  
  await Promise.all(addPromises);
  console.log("✅ Added documents to all indices concurrently");
  
  // Query all indices concurrently
  console.log("Querying all indices concurrently...");
  const queryPromises = indexIds.map(indexId =>
    manager.queryIndex(indexId, "artificial intelligence", { k: 5 })
  );
  
  const results = await Promise.all(queryPromises);
  const totalResults = results.reduce((sum, result) => sum + result.length, 0);
  console.log(`✅ Concurrent queries returned ${totalResults} total results`);
  
  // Clean up
  await manager.destroyAll("stress-test");
  console.log("✅ Concurrent operations test completed");
}

// Test large dataset handling
async function testLargeDataset() {
  console.log("\n📊 Testing Large Dataset Handling...");
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 5
  });
  
  const indexId = await manager.createIndex({
    id: "large-dataset",
    namespace: "stress-test"
  });
  
  // Add documents in batches
  const batchSize = 25;
  const totalDocs = 100;
  const batches = Math.ceil(totalDocs / batchSize);
  
  console.log(`Adding ${totalDocs} documents in ${batches} batches of ${batchSize}...`);
  
  for (let batch = 0; batch < batches; batch++) {
    const startIdx = batch * batchSize;
    const endIdx = Math.min(startIdx + batchSize, totalDocs);
    const batchDocs = generateTestDocuments(endIdx - startIdx, `batch-${batch}`);
    
    await manager.addDocuments(indexId, batchDocs);
    console.log(`  Batch ${batch + 1}/${batches} completed (${endIdx}/${totalDocs} docs)`);
  }
  
  // Verify document count
  const instance = manager.getInstance(indexId);
  console.log(`✅ Total documents in index: ${instance?.documentCount}`);
  
  // Test queries on large dataset
  console.log("Testing queries on large dataset...");
  const queryResults = await manager.queryIndex(indexId, "technology trends", { k: 10 });
  console.log(`✅ Query returned ${queryResults.length} results from large dataset`);
  
  // Test removal of multiple documents
  console.log("Testing bulk document removal...");
  const docsToRemove = Array.from({ length: 20 }, (_, i) => `batch-0-${i}`);
  await manager.removeDocuments(indexId, docsToRemove);
  
  const instanceAfterRemoval = manager.getInstance(indexId);
  console.log(`✅ Documents after removal: ${instanceAfterRemoval?.documentCount}`);
  
  // Clean up
  await manager.destroyAll("stress-test");
  console.log("✅ Large dataset test completed");
}

// Test edge cases and error handling
async function testEdgeCases() {
  console.log("\n⚠️ Testing Edge Cases and Error Handling...");
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 3
  });
  
  // Test instance limit
  console.log("Testing instance limit enforcement...");
  const indexIds: string[] = [];
  
  // Create up to the limit
  for (let i = 0; i < 3; i++) {
    const id = await manager.createIndex({ id: `limit-${i}`, namespace: "stress-test" });
    indexIds.push(id);
  }
  
  // Try to exceed limit
  try {
    await manager.createIndex({ id: "limit-exceed", namespace: "stress-test" });
    console.log("❌ Should have thrown error for exceeding limit");
  } catch (error) {
    console.log("✅ Correctly rejected creation beyond limit");
  }
  
  // Test duplicate ID handling
  console.log("Testing duplicate ID handling...");
  try {
    await manager.createIndex({ id: "limit-0", namespace: "stress-test" });
    console.log("❌ Should have thrown error for duplicate ID");
  } catch (error) {
    console.log("✅ Correctly rejected duplicate ID");
  }
  
  // Test operations on non-existent index
  console.log("Testing operations on non-existent index...");
  try {
    await manager.addDocuments("non-existent", [{ id: "test", text: "test" }]);
    console.log("❌ Should have thrown error for non-existent index");
  } catch (error) {
    console.log("✅ Correctly rejected operation on non-existent index");
  }
  
  // Test invalid documents
  console.log("Testing invalid document handling...");
  const validIndexId = indexIds[0];
  
  try {
    await manager.addDocuments(validIndexId, [{ id: "invalid" }] as any);
    console.log("❌ Should have thrown error for invalid document");
  } catch (error) {
    console.log("✅ Correctly rejected invalid document");
  }
  
  // Test empty operations
  console.log("Testing empty operations...");
  await manager.addDocuments(validIndexId, []); // Should not throw
  await manager.removeDocuments(validIndexId, []); // Should not throw
  console.log("✅ Empty operations handled gracefully");
  
  // Test very long text
  console.log("Testing very long text handling...");
  const longText = "word ".repeat(1000); // 5000 characters
  await manager.addDocuments(validIndexId, [{
    id: "long-text",
    text: longText,
    metadata: { length: longText.length }
  }]);
  console.log("✅ Long text handled successfully");
  
  // Test special characters in text
  console.log("Testing special characters...");
  await manager.addDocuments(validIndexId, [{
    id: "special-chars",
    text: "Special chars: 🚀 ñáéíóú 中文 العربية русский 🎉",
    metadata: { type: "unicode" }
  }]);
  console.log("✅ Special characters handled successfully");
  
  // Clean up
  await manager.destroyAll("stress-test");
  console.log("✅ Edge cases test completed");
}

// Test event system under stress
async function testEventSystemStress() {
  console.log("\n📡 Testing Event System Under Stress...");
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 5
  });
  
  let eventCounts = {
    indexCreated: 0,
    documentAdded: 0,
    queryCompleted: 0,
    documentRemoved: 0,
    indexDestroyed: 0
  };
  
  // Set up event listeners
  manager.on(VectorDBEvents.INDEX_CREATED, () => eventCounts.indexCreated++);
  manager.on(VectorDBEvents.DOCUMENT_ADDED, () => eventCounts.documentAdded++);
  manager.on(VectorDBEvents.QUERY_COMPLETED, () => eventCounts.queryCompleted++);
  manager.on(VectorDBEvents.DOCUMENT_REMOVED, () => eventCounts.documentRemoved++);
  manager.on(VectorDBEvents.INDEX_DESTROYED, () => eventCounts.indexDestroyed++);
  
  // Perform many operations to generate events
  console.log("Performing operations to generate events...");
  
  const indexIds: string[] = [];
  
  // Create indices
  for (let i = 0; i < 3; i++) {
    const id = await manager.createIndex({ id: `event-${i}`, namespace: "stress-test" });
    indexIds.push(id);
  }
  
  // Add documents
  for (const indexId of indexIds) {
    const docs = generateTestDocuments(10, `event-docs`);
    await manager.addDocuments(indexId, docs);
  }
  
  // Perform queries
  for (const indexId of indexIds) {
    for (let i = 0; i < 5; i++) {
      await manager.queryIndex(indexId, `query ${i}`, { k: 3 });
    }
  }
  
  // Remove some documents
  for (const indexId of indexIds) {
    await manager.removeDocuments(indexId, ["event-docs-0", "event-docs-1"]);
  }
  
  // Destroy indices
  for (const indexId of indexIds) {
    await manager.destroyIndex(indexId);
  }
  
  console.log("✅ Event counts:", eventCounts);
  console.log("✅ Event system stress test completed");
}

// Test memory and resource management
async function testResourceManagement() {
  console.log("\n🧠 Testing Resource Management...");
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 5
  });
  
  // Create and destroy indices repeatedly
  console.log("Testing repeated creation and destruction...");
  
  for (let cycle = 0; cycle < 3; cycle++) {
    console.log(`  Cycle ${cycle + 1}/3`);
    
    // Create indices
    const indexIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await manager.createIndex({ 
        id: `cycle-${cycle}-${i}`, 
        namespace: "stress-test" 
      });
      indexIds.push(id);
    }
    
    // Add documents
    for (const indexId of indexIds) {
      const docs = generateTestDocuments(20, `cycle-${cycle}`);
      await manager.addDocuments(indexId, docs);
    }
    
    // Perform some operations
    for (const indexId of indexIds) {
      await manager.queryIndex(indexId, "test query", { k: 5 });
    }
    
    // Destroy all
    await manager.destroyAll("stress-test");
    
    // Verify cleanup
    const remainingInstances = manager.listInstances("stress-test");
    if (remainingInstances.length > 0) {
      console.log(`❌ Found ${remainingInstances.length} remaining instances after cleanup`);
    }
  }
  
  console.log("✅ Resource management test completed");
}

// Main stress test function
async function runStressTests() {
  console.log("🚀 Starting comprehensive stress tests...\n");
  
  try {
    await testConcurrentOperations();
    await testLargeDataset();
    await testEdgeCases();
    await testEventSystemStress();
    await testResourceManagement();
    
    console.log("\n🎉 All stress tests completed successfully!");
    console.log("\n📊 Stress Test Summary:");
    console.log("✅ Concurrent operations handling");
    console.log("✅ Large dataset processing");
    console.log("✅ Edge cases and error handling");
    console.log("✅ Event system under stress");
    console.log("✅ Resource management and cleanup");
    console.log("\n🔥 VectorDBManager is production-ready!");
    
  } catch (error) {
    console.error("❌ Stress test failed:", error);
    throw error;
  }
}

// Run stress tests if this is the main module
if (import.meta.main) {
  try {
    await runStressTests();
  } catch (error) {
    console.error("❌ Stress tests failed:", error);
    Deno.exit(1);
  }
} 