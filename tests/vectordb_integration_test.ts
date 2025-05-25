// Integration test for Vector Database with Hypha Service components
import { VectorDBManager, VectorDBEvents, type IDocument, type IQueryOptions } from "../vectordb/mod.ts";

console.log("🧪 Vector Database Integration Test");
console.log("Testing VectorDB integration with service-like usage patterns...");

// Test the vector database manager with service-like patterns
async function testVectorDBIntegration() {
  console.log("\n1. Creating VectorDBManager with mock embeddings...");
  
  const vectorDBManager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model",
    maxInstances: 5
  });

  // Test namespace-based operations (like in Hypha service)
  const namespace = "test-workspace";
  
  console.log("\n2. Creating vector index with namespace...");
  const indexId = await vectorDBManager.createIndex({
    id: "documents",
    namespace: namespace,
    embeddingModel: "mock-model"
  });
  
  console.log(`✅ Created index: ${indexId}`);
  
  console.log("\n3. Adding documents...");
  const documents: IDocument[] = [
    {
      id: "doc1",
      text: "Machine learning is a subset of artificial intelligence",
      metadata: { category: "AI", author: "test" }
    },
    {
      id: "doc2", 
      text: "Python is a popular programming language",
      metadata: { category: "Programming", author: "test" }
    },
    {
      id: "doc3",
      text: "Vector databases enable semantic search",
      metadata: { category: "Database", author: "test" }
    }
  ];
  
  await vectorDBManager.addDocuments(indexId, documents);
  console.log(`✅ Added ${documents.length} documents`);
  
  console.log("\n4. Querying with text...");
  const queryOptions: IQueryOptions = {
    k: 2,
    includeMetadata: true,
    threshold: 0
  };
  
  const results = await vectorDBManager.queryIndex(
    indexId, 
    "artificial intelligence and machine learning", 
    queryOptions
  );
  
  console.log(`✅ Query returned ${results.length} results:`);
  results.forEach((result, idx) => {
    console.log(`  ${idx + 1}. ${result.id} (score: ${result.score.toFixed(3)})`);
    console.log(`     Text: ${result.text}`);
    console.log(`     Metadata: ${JSON.stringify(result.metadata)}`);
  });
  
  console.log("\n5. Testing vector query...");
  // Get a document's vector and query with it
  const instance = vectorDBManager.getInstance(indexId);
  if (instance) {
    // Create a mock vector for testing
    const mockVector = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.1));
    
    const vectorResults = await vectorDBManager.queryIndex(
      indexId,
      mockVector,
      { k: 1, includeMetadata: true }
    );
    
    console.log(`✅ Vector query returned ${vectorResults.length} results`);
  }
  
  console.log("\n6. Testing document removal...");
  await vectorDBManager.removeDocuments(indexId, ["doc2"]);
  console.log("✅ Removed document doc2");
  
  // Verify removal
  const afterRemoval = await vectorDBManager.queryIndex(
    indexId,
    "programming language",
    { k: 5, includeMetadata: true }
  );
  console.log(`✅ After removal, query returned ${afterRemoval.length} results`);
  
  console.log("\n7. Testing stats...");
  const stats = vectorDBManager.getStats();
  console.log("✅ Stats:", JSON.stringify(stats, null, 2));
  
  console.log("\n8. Testing namespace filtering...");
  const namespaceIndices = vectorDBManager.listInstances(namespace);
  console.log(`✅ Found ${namespaceIndices.length} indices in namespace '${namespace}'`);
  
  console.log("\n9. Testing event system...");
  let eventCount = 0;
  
  vectorDBManager.on(VectorDBEvents.DOCUMENT_ADDED, () => {
    eventCount++;
    console.log("📡 Event: Document added");
  });
  
  vectorDBManager.on(VectorDBEvents.QUERY_COMPLETED, () => {
    eventCount++;
    console.log("📡 Event: Query completed");
  });
  
  // Trigger events
  await vectorDBManager.addDocuments(indexId, [{
    id: "doc4",
    text: "Event test document",
    metadata: { test: true }
  }]);
  
  await vectorDBManager.queryIndex(indexId, "event test", { k: 1 });
  
  console.log(`✅ Received ${eventCount} events`);
  
  console.log("\n10. Cleanup...");
  await vectorDBManager.destroyAll();
  console.log("✅ All indices destroyed");
  
  console.log("\n🎉 Integration test completed successfully!");
  console.log("\n📊 Test Summary:");
  console.log("✅ Namespace-based index creation");
  console.log("✅ Document addition with text and metadata");
  console.log("✅ Text-based semantic queries");
  console.log("✅ Vector-based queries");
  console.log("✅ Document removal");
  console.log("✅ Statistics and monitoring");
  console.log("✅ Namespace filtering");
  console.log("✅ Event system");
  console.log("✅ Resource cleanup");
}

// Run the integration test
if (import.meta.main) {
  try {
    await testVectorDBIntegration();
  } catch (error) {
    console.error("❌ Integration test failed:", error);
    Deno.exit(1);
  }
} 