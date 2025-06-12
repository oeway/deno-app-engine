import { assertEquals, assertThrows, assertRejects, assert } from "jsr:@std/assert";
import { VectorDBManager, VectorDBPermission, type IDocument } from "../vectordb/mod.ts";

const TEST_CONFIG = {
  embeddingModel: "mock-model",
  maxInstances: 20
};

Deno.test("VectorDB - Permission System", async (t) => {
  const manager = new VectorDBManager({
    defaultEmbeddingModel: TEST_CONFIG.embeddingModel,
    maxInstances: TEST_CONFIG.maxInstances
  });

  await t.step("should create indices with different permission levels", async () => {
    // Create indices with different permissions in different namespaces
    const privateIndex = await manager.createIndex({
      id: "private-test",
      namespace: "workspace1",
      permission: VectorDBPermission.PRIVATE
    });
    
    const publicReadIndex = await manager.createIndex({
      id: "public-read-test", 
      namespace: "workspace1",
      permission: VectorDBPermission.PUBLIC_READ
    });
    
    const publicReadAddIndex = await manager.createIndex({
      id: "public-read-add-test",
      namespace: "workspace1", 
      permission: VectorDBPermission.PUBLIC_READ_ADD
    });
    
    const publicReadWriteIndex = await manager.createIndex({
      id: "public-read-write-test",
      namespace: "workspace1",
      permission: VectorDBPermission.PUBLIC_READ_WRITE
    });
    
    // Verify indices were created
    assert(privateIndex.startsWith("workspace1:"));
    assert(publicReadIndex.startsWith("workspace1:"));
    assert(publicReadAddIndex.startsWith("workspace1:"));
    assert(publicReadWriteIndex.startsWith("workspace1:"));
  });

  await t.step("should enforce private permission correctly", async () => {
    const privateIndexId = "workspace1:private-test";
    
    // Add test documents as owner
    const testDocs: IDocument[] = [
      { id: "doc1", text: "Private document content" },
      { id: "doc2", text: "Another private document" }
    ];
    
    // Owner should be able to add documents
    await manager.addDocuments(privateIndexId, testDocs, "workspace1");
    
    // Owner should be able to query
    const results = await manager.queryIndex(privateIndexId, "private document", {}, "workspace1");
    assertEquals(results.length, 2);
    
    // Owner should be able to remove documents  
    await manager.removeDocuments(privateIndexId, ["doc1"], "workspace1");
    
    // Other workspace should not be able to access
    await assertRejects(
      async () => await manager.queryIndex(privateIndexId, "private", {}, "workspace2"),
      Error,
      "Access denied"
    );
    
    await assertRejects(
      async () => await manager.addDocuments(privateIndexId, [{ id: "doc3", text: "test" }], "workspace2"),
      Error,
      "Access denied"
    );
    
    await assertRejects(
      async () => await manager.removeDocuments(privateIndexId, ["doc2"], "workspace2"),
      Error,
      "Access denied"
    );
  });

  await t.step("should enforce public_read permission correctly", async () => {
    const publicReadIndexId = "workspace1:public-read-test";
    
    // Add test documents as owner
    const testDocs: IDocument[] = [
      { id: "doc1", text: "Public readable document" },
      { id: "doc2", text: "Another public readable document" }
    ];
    
    await manager.addDocuments(publicReadIndexId, testDocs, "workspace1");
    
    // Other workspace should be able to read
    const results = await manager.queryIndex(publicReadIndexId, "public readable", {}, "workspace2");
    assertEquals(results.length, 2);
    
    // Other workspace should NOT be able to add
    await assertRejects(
      async () => await manager.addDocuments(publicReadIndexId, [{ id: "doc3", text: "test" }], "workspace2"),
      Error,
      "Access denied"
    );
    
    // Other workspace should NOT be able to remove
    await assertRejects(
      async () => await manager.removeDocuments(publicReadIndexId, ["doc1"], "workspace2"),
      Error,
      "Access denied"
    );
  });

  await t.step("should enforce public_read_add permission correctly", async () => {
    const publicReadAddIndexId = "workspace1:public-read-add-test";
    
    // Add initial documents as owner
    const ownerDocs: IDocument[] = [
      { id: "owner-doc1", text: "Document added by owner" }
    ];
    
    await manager.addDocuments(publicReadAddIndexId, ownerDocs, "workspace1");
    
    // Other workspace should be able to read
    const readResults = await manager.queryIndex(publicReadAddIndexId, "document", {}, "workspace2");
    assertEquals(readResults.length, 1);
    
    // Other workspace should be able to add
    const addDocs: IDocument[] = [
      { id: "guest-doc1", text: "Document added by guest workspace" }
    ];
    
    await manager.addDocuments(publicReadAddIndexId, addDocs, "workspace2");
    
    // Verify document was added
    const verifyResults = await manager.queryIndex(publicReadAddIndexId, "document", {}, "workspace1");
    assertEquals(verifyResults.length, 2);
    
    // Other workspace should NOT be able to remove
    await assertRejects(
      async () => await manager.removeDocuments(publicReadAddIndexId, ["owner-doc1"], "workspace2"),
      Error,
      "Access denied"
    );
  });

  await t.step("should enforce public_read_write permission correctly", async () => {
    const publicReadWriteIndexId = "workspace1:public-read-write-test";
    
    // Add initial documents as owner
    const ownerDocs: IDocument[] = [
      { id: "owner-doc1", text: "Document added by owner" },
      { id: "owner-doc2", text: "Another owner document" }
    ];
    
    await manager.addDocuments(publicReadWriteIndexId, ownerDocs, "workspace1");
    
    // Other workspace should be able to read
    const readResults = await manager.queryIndex(publicReadWriteIndexId, "document", {}, "workspace2");
    assertEquals(readResults.length, 2);
    
    // Other workspace should be able to add
    const addDocs: IDocument[] = [
      { id: "guest-doc1", text: "Document added by guest workspace" }
    ];
    
    await manager.addDocuments(publicReadWriteIndexId, addDocs, "workspace2");
    
    // Other workspace should be able to remove
    await manager.removeDocuments(publicReadWriteIndexId, ["owner-doc1"], "workspace2");
    
    // Verify operations worked
    const finalResults = await manager.queryIndex(publicReadWriteIndexId, "document", {}, "workspace1");
    assertEquals(finalResults.length, 2); // 1 remaining owner doc + 1 guest doc
    
    // Check that the right document was removed
    const docIds = finalResults.map(r => r.id);
    assert(!docIds.includes("owner-doc1")); // Should be removed
    assert(docIds.includes("owner-doc2"));   // Should remain
    assert(docIds.includes("guest-doc1"));   // Should be present
  });

  await t.step("should handle permission checking utility methods", async () => {
    const privateIndexId = "workspace1:private-test";
    const publicReadIndexId = "workspace1:public-read-test";
    const publicReadAddIndexId = "workspace1:public-read-add-test";
    const publicReadWriteIndexId = "workspace1:public-read-write-test";
    
    // Test owner permissions (should always be true)
    assert(manager.checkPermission(privateIndexId, "workspace1", "read"));
    assert(manager.checkPermission(privateIndexId, "workspace1", "add"));
    assert(manager.checkPermission(privateIndexId, "workspace1", "remove"));
    
    // Test private index cross-workspace permissions (should all be false)
    assert(!manager.checkPermission(privateIndexId, "workspace2", "read"));
    assert(!manager.checkPermission(privateIndexId, "workspace2", "add"));
    assert(!manager.checkPermission(privateIndexId, "workspace2", "remove"));
    
    // Test public_read index cross-workspace permissions
    assert(manager.checkPermission(publicReadIndexId, "workspace2", "read"));
    assert(!manager.checkPermission(publicReadIndexId, "workspace2", "add"));
    assert(!manager.checkPermission(publicReadIndexId, "workspace2", "remove"));
    
    // Test public_read_add index cross-workspace permissions
    assert(manager.checkPermission(publicReadAddIndexId, "workspace2", "read"));
    assert(manager.checkPermission(publicReadAddIndexId, "workspace2", "add"));
    assert(!manager.checkPermission(publicReadAddIndexId, "workspace2", "remove"));
    
    // Test public_read_write index cross-workspace permissions
    assert(manager.checkPermission(publicReadWriteIndexId, "workspace2", "read"));
    assert(manager.checkPermission(publicReadWriteIndexId, "workspace2", "add"));
    assert(manager.checkPermission(publicReadWriteIndexId, "workspace2", "remove"));
  });

  await t.step("should handle non-existent index permission checks", async () => {
    // Should return false for non-existent indices
    assert(!manager.checkPermission("workspace1:non-existent", "workspace1", "read"));
    assert(!manager.checkPermission("workspace1:non-existent", "workspace2", "read"));
  });

  await t.step("should handle default permission (private)", async () => {
    // Create index without explicit permission (should default to private)
    const defaultIndex = await manager.createIndex({
      id: "default-permission-test",
      namespace: "workspace1"
      // No permission specified - should default to PRIVATE
    });
    
    // Add document as owner
    await manager.addDocuments(defaultIndex, [{ id: "doc1", text: "test" }], "workspace1");
    
    // Owner should have access
    const ownerResults = await manager.queryIndex(defaultIndex, "test", {}, "workspace1");
    assertEquals(ownerResults.length, 1);
    
    // Other workspace should NOT have access (private by default)
    await assertRejects(
      async () => await manager.queryIndex(defaultIndex, "test", {}, "workspace2"),
      Error,
      "Access denied"
    );
  });

  await manager.destroyAll();
}); 