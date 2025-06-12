import { assertEquals, assertExists, assert } from "jsr:@std/assert";
import { VectorDBManager, type IDocument } from "../vectordb/mod.ts";

const TEST_CONFIG = {
  embeddingModel: "mock-model",
  maxInstances: 20,
  offloadDirectory: "./test_vectordb_save_autoload"
};

Deno.test("VectorDB - Save Index and Auto-Loading", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: TEST_CONFIG.maxInstances,
    offloadDirectory: TEST_CONFIG.offloadDirectory
  });

  // Clean up any existing test data
  try {
    await Deno.remove(TEST_CONFIG.offloadDirectory, { recursive: true });
  } catch {
    // Directory doesn't exist, which is fine
  }

  await t.step("should save an index to disk while keeping it in memory", async () => {
    // Create an index
    const indexId = await manager.createIndex({
      id: "save-test-index",
      namespace: "test-workspace"
    });
    
    // Add test documents
    const testDocs: IDocument[] = [
      { id: "doc1", text: "This is a test document for save functionality" },
      { id: "doc2", text: "Another test document about machine learning" },
      { id: "doc3", text: "Vector databases are powerful tools for similarity search" }
    ];
    
    await manager.addDocuments(indexId, testDocs);
    
    // Verify documents are in memory
    const results = await manager.queryIndex(indexId, "test document", { k: 3 });
    assertExists(results);
    assertEquals(results.length, 3);
    
    // Save the index
    await manager.saveIndex(indexId);
    
    // Verify index is still in memory and functional
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 3);
    
    // Query should still work
    const postSaveResults = await manager.queryIndex(indexId, "machine learning", { k: 2 });
    assertExists(postSaveResults);
    assert(postSaveResults.length > 0);
    
    console.log(`✅ Index saved successfully with ${instance.documentCount} documents (kept in memory)`);
  });

  await t.step("should auto-load index when querying an offloaded index", async () => {
    const indexId = "test-workspace:save-test-index";
    
    // Manually offload the index (this removes it from memory but saves to disk)
    await manager.manualOffload(indexId);
    
    // Verify index is no longer in memory
    const instanceBeforeQuery = manager.getInstance(indexId);
    assertEquals(instanceBeforeQuery, undefined);
    
    // Query the index - it should auto-load
    const autoLoadResults = await manager.queryIndex(indexId, "vector databases", { k: 2 });
    assertExists(autoLoadResults);
    assert(autoLoadResults.length > 0);
    
    // Verify index is now back in memory
    const instanceAfterQuery = manager.getInstance(indexId);
    assertExists(instanceAfterQuery);
    assertEquals(instanceAfterQuery.documentCount, 3);
    assertEquals(instanceAfterQuery.isFromOffload, true);
    
    console.log(`✅ Index auto-loaded successfully from disk with ${instanceAfterQuery.documentCount} documents`);
  });

  await t.step("should auto-load index when adding documents to an offloaded index", async () => {
    const indexId = "test-workspace:save-test-index";
    
    // Offload the index again
    await manager.manualOffload(indexId);
    
    // Verify index is not in memory
    assertEquals(manager.getInstance(indexId), undefined);
    
    // Add documents - should auto-load first
    const newDocs: IDocument[] = [
      { id: "doc4", text: "New document added after auto-loading" }
    ];
    
    await manager.addDocuments(indexId, newDocs);
    
    // Verify index is back in memory with updated document count
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 4); // 3 original + 1 new
    
    // Verify the new document was added
    const results = await manager.queryIndex(indexId, "auto-loading", { k: 2 });
    assertExists(results);
    assert(results.length > 0);
    
    console.log(`✅ Index auto-loaded for document addition, now has ${instance.documentCount} documents`);
  });

  await t.step("should auto-load index when removing documents from an offloaded index", async () => {
    const indexId = "test-workspace:save-test-index";
    
    // Offload the index again
    await manager.manualOffload(indexId);
    
    // Verify index is not in memory
    assertEquals(manager.getInstance(indexId), undefined);
    
    // Remove a document - should auto-load first
    await manager.removeDocuments(indexId, ["doc1"]);
    
    // Verify index is back in memory with updated document count
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    assertEquals(instance.documentCount, 3); // 4 - 1 removed
    
    // Verify the document was removed
    const results = await manager.queryIndex(indexId, "test document", { k: 5 });
    const removedDocResult = results.find(r => r.id === "doc1");
    assertEquals(removedDocResult, undefined); // Should not find the removed document
    
    console.log(`✅ Index auto-loaded for document removal, now has ${instance.documentCount} documents`);
  });

  await t.step("should handle auto-loading when instance limit is reached", async () => {
    // Create a manager with low instance limit
    const limitedManager = new VectorDBManager({
      defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
      maxInstances: 1, // Very low limit
      offloadDirectory: TEST_CONFIG.offloadDirectory
    });
    
    // Create and fill the single slot
    const blockingIndexId = await limitedManager.createIndex({
      id: "blocking-index",
      namespace: "test-workspace"
    });
    
    await limitedManager.addDocuments(blockingIndexId, [
      { id: "blocking-doc", text: "This blocks the instance slot" }
    ]);
    
    // Try to auto-load our saved index - should fail due to instance limit
    const savedIndexId = "test-workspace:save-test-index";
    
    try {
      await limitedManager.queryIndex(savedIndexId, "test", {});
      assert(false, "Expected error due to instance limit");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("Maximum number of vector database instances"));
      console.log(`✅ Auto-loading correctly failed when instance limit reached: ${error.message}`);
    }
    
    // Clean up
    await limitedManager.destroyAll();
  });

  await t.step("should handle queries to non-existent indices gracefully", async () => {
    const nonExistentId = "test-workspace:non-existent-index";
    
    try {
      await manager.queryIndex(nonExistentId, "test query", {});
      assert(false, "Expected error for non-existent index");
    } catch (error) {
      assert(error instanceof Error);
      assert(error.message.includes("not found"));
      console.log(`✅ Non-existent index query correctly failed: ${error.message}`);
    }
  });

  await t.step("should preserve index configuration after save and auto-load", async () => {
    // Create a new index with specific configuration
    const configTestId = await manager.createIndex({
      id: "config-preservation-test",
      namespace: "test-workspace",
      maxDocuments: 100,
      inactivityTimeout: 60000,
      enableActivityMonitoring: true
    });
    
    // Add a document
    await manager.addDocuments(configTestId, [
      { id: "config-doc", text: "Testing configuration preservation" }
    ]);
    
    // Get original configuration
    const originalInstance = manager.getInstance(configTestId);
    assertExists(originalInstance);
    const originalOptions = originalInstance.options;
    
    // Save the index
    await manager.saveIndex(configTestId);
    
    // Offload and auto-load
    await manager.manualOffload(configTestId);
    await manager.queryIndex(configTestId, "configuration", {});
    
    // Verify configuration is preserved
    const restoredInstance = manager.getInstance(configTestId);
    assertExists(restoredInstance);
    
    assertEquals(restoredInstance.options.maxDocuments, originalOptions.maxDocuments);
    assertEquals(restoredInstance.options.inactivityTimeout, originalOptions.inactivityTimeout);
    assertEquals(restoredInstance.options.enableActivityMonitoring, originalOptions.enableActivityMonitoring);
    assertEquals(restoredInstance.documentCount, 1);
    assertEquals(restoredInstance.isFromOffload, true);
    
    console.log(`✅ Index configuration preserved after save and auto-load`);
  });

  await t.step("should handle multiple save operations correctly", async () => {
    const indexId = "test-workspace:config-preservation-test";
    
    // Ensure index is in memory
    const instance = manager.getInstance(indexId);
    assertExists(instance);
    
    // Add more documents
    await manager.addDocuments(indexId, [
      { id: "multi-save-1", text: "First additional document" },
      { id: "multi-save-2", text: "Second additional document" }
    ]);
    
    // Save multiple times
    await manager.saveIndex(indexId);
    await manager.saveIndex(indexId);
    await manager.saveIndex(indexId);
    
    // Verify index is still functional
    const updatedInstance = manager.getInstance(indexId);
    assertExists(updatedInstance);
    assertEquals(updatedInstance.documentCount, 3);
    
    // Verify all documents are still there
    const allResults = await manager.queryIndex(indexId, "document", { k: 10 });
    assertEquals(allResults.length, 3);
    
    // Test auto-load after multiple saves
    await manager.manualOffload(indexId);
    const autoLoadResults = await manager.queryIndex(indexId, "additional", { k: 5 });
    assert(autoLoadResults.length >= 2); // Should find the additional documents
    
    console.log(`✅ Multiple saves handled correctly, auto-load works after multiple saves`);
  });

  // Clean up
  await manager.destroyAll();
  
  // Clean up test directory
  try {
    await Deno.remove(TEST_CONFIG.offloadDirectory, { recursive: true });
  } catch {
    // Ignore if already cleaned up
  }
}); 