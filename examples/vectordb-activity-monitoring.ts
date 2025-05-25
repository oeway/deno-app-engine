// VectorDB Activity Monitoring Example
// Demonstrates all activity monitoring features including automatic offloading,
// resuming from offload, manual management, and configuration options

import { VectorDBManager, VectorDBEvents, type IDocument } from "../vectordb/mod.ts";

console.log("🧪 VectorDB Activity Monitoring Example");
console.log("Demonstrating activity monitoring, offloading, and resuming...\n");

// Configuration
const EXAMPLE_OFFLOAD_DIR = "./example_vectordb_offload";
const SHORT_TIMEOUT = 2000; // 2 seconds for demo purposes
const MEDIUM_TIMEOUT = 5000; // 5 seconds

// Helper function to wait
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to clean up
async function cleanup(): Promise<void> {
  try {
    await Deno.remove(EXAMPLE_OFFLOAD_DIR, { recursive: true });
  } catch {
    // Directory might not exist
  }
}

async function demonstrateActivityMonitoring() {
  console.log("1. 🏗️  Creating VectorDBManager with activity monitoring...");
  
  // Clean up any previous runs
  await cleanup();
  
  const manager = new VectorDBManager({
    defaultEmbeddingModel: "mock-model", // Use mock for demo
    maxInstances: 10,
    offloadDirectory: EXAMPLE_OFFLOAD_DIR,
    defaultInactivityTimeout: SHORT_TIMEOUT,
    enableActivityMonitoring: true
  });

  // Set up event listeners
  manager.on(VectorDBEvents.INDEX_CREATED, (event) => {
    console.log(`📝 Event: Index created - ${event.instanceId}`);
  });

  manager.on(VectorDBEvents.INDEX_OFFLOADED, (event) => {
    console.log(`💾 Event: Index offloaded - ${event.instanceId} (${event.data.documentCount} documents)`);
  });

  manager.on(VectorDBEvents.INDEX_RESUMED, (event) => {
    console.log(`📂 Event: Index resumed - ${event.instanceId} from offload`);
  });

  const stats = manager.getStats();
  console.log(`✅ Manager created with activity monitoring enabled`);
  console.log(`   - Offload directory: ${stats.activityMonitoring.offloadDirectory}`);
  console.log(`   - Default timeout: ${stats.activityMonitoring.defaultTimeout}ms`);
  console.log(`   - Monitoring enabled: ${stats.activityMonitoring.enabled}\n`);

  console.log("2. 📚 Creating indices with different configurations...");
  
  // Create index with default timeout
  const index1 = await manager.createIndex({
    id: "documents",
    namespace: "workspace1",
    enableActivityMonitoring: true,
    inactivityTimeout: SHORT_TIMEOUT
  });
  console.log(`✅ Created index with short timeout: ${index1}`);

  // Create index with longer timeout
  const index2 = await manager.createIndex({
    id: "knowledge-base",
    namespace: "workspace1", 
    enableActivityMonitoring: true,
    inactivityTimeout: MEDIUM_TIMEOUT
  });
  console.log(`✅ Created index with medium timeout: ${index2}`);

  // Create index with monitoring disabled
  const index3 = await manager.createIndex({
    id: "persistent",
    namespace: "workspace2",
    enableActivityMonitoring: false
  });
  console.log(`✅ Created persistent index (no monitoring): ${index3}\n`);

  console.log("3. 📄 Adding documents to indices...");
  
  const documents1: IDocument[] = [
    { id: "doc1", text: "Machine learning fundamentals", metadata: { category: "AI" } },
    { id: "doc2", text: "Deep learning with neural networks", metadata: { category: "AI" } },
    { id: "doc3", text: "Natural language processing", metadata: { category: "NLP" } }
  ];

  const documents2: IDocument[] = [
    { id: "kb1", text: "Company policies and procedures", metadata: { type: "policy" } },
    { id: "kb2", text: "Employee handbook guidelines", metadata: { type: "handbook" } }
  ];

  await manager.addDocuments(index1, documents1);
  await manager.addDocuments(index2, documents2);
  await manager.addDocuments(index3, [{ id: "p1", text: "Persistent data" }]);

  console.log(`✅ Added ${documents1.length} documents to ${index1}`);
  console.log(`✅ Added ${documents2.length} documents to ${index2}`);
  console.log(`✅ Added 1 document to ${index3}\n`);

  console.log("4. 🔍 Testing queries and activity tracking...");
  
  // Query to update activity
  const results1 = await manager.queryIndex(index1, "machine learning", { k: 2 });
  console.log(`✅ Query on ${index1} returned ${results1.length} results`);

  // Check activity times
  const lastActivity1 = manager.getLastActivityTime(index1);
  const lastActivity2 = manager.getLastActivityTime(index2);
  const timeUntilOffload1 = manager.getTimeUntilOffload(index1);
  const timeUntilOffload2 = manager.getTimeUntilOffload(index2);

  console.log(`📊 Activity status:`);
  console.log(`   - ${index1}: last activity ${new Date(lastActivity1!).toLocaleTimeString()}, offload in ${timeUntilOffload1}ms`);
  console.log(`   - ${index2}: last activity ${new Date(lastActivity2!).toLocaleTimeString()}, offload in ${timeUntilOffload2}ms\n`);

  console.log("5. ⏰ Waiting for automatic offloading...");
  console.log(`   Waiting ${SHORT_TIMEOUT + 1000}ms for ${index1} to be offloaded...`);
  
  // Wait for the first index to be offloaded
  await wait(SHORT_TIMEOUT + 1000);

  // Check if index1 was offloaded
  const instance1After = manager.getInstance(index1);
  const instance2After = manager.getInstance(index2);
  const instance3After = manager.getInstance(index3);

  console.log(`📊 Status after timeout:`);
  console.log(`   - ${index1}: ${instance1After ? 'still in memory' : 'offloaded to disk'}`);
  console.log(`   - ${index2}: ${instance2After ? 'still in memory' : 'offloaded to disk'}`);
  console.log(`   - ${index3}: ${instance3After ? 'still in memory' : 'offloaded to disk'}\n`);

  console.log("6. 📋 Listing offloaded indices...");
  
  const offloadedIndices = await manager.listOffloadedIndices();
  console.log(`✅ Found ${offloadedIndices.length} offloaded indices:`);
  for (const idx of offloadedIndices) {
    console.log(`   - ${idx.id}: ${idx.documentCount} documents, offloaded at ${idx.offloadedAt.toLocaleTimeString()}`);
  }

  // List by namespace
  const ws1Offloaded = await manager.listOffloadedIndices("workspace1");
  console.log(`✅ Workspace1 has ${ws1Offloaded.length} offloaded indices\n`);

  console.log("7. 🔄 Testing resume from offload...");
  
  // Try to create the same index - should resume from offload
  console.log(`   Attempting to recreate ${index1}...`);
  const resumedIndex = await manager.createIndex({
    id: "documents",
    namespace: "workspace1"
  });

  console.log(`✅ Index recreated: ${resumedIndex}`);
  
  const resumedInstance = manager.getInstance(resumedIndex);
  if (resumedInstance) {
    console.log(`✅ Index resumed with ${resumedInstance.documentCount} documents`);
    console.log(`   - Is from offload: ${resumedInstance.isFromOffload}`);
    
    // Verify documents were restored
    const restoredResults = await manager.queryIndex(resumedIndex, "machine learning", { k: 5 });
    console.log(`✅ Query after resume returned ${restoredResults.length} results\n`);
  }

  console.log("8. 🎯 Testing manual management...");
  
  // Ping to reset activity timer
  console.log(`   Pinging ${index2} to reset activity timer...`);
  const pingSuccess = manager.pingInstance(index2);
  console.log(`✅ Ping ${pingSuccess ? 'successful' : 'failed'}`);

  // Set custom timeout
  console.log(`   Setting custom timeout for ${index2}...`);
  const timeoutSuccess = manager.setInactivityTimeout(index2, 10000); // 10 seconds
  console.log(`✅ Timeout update ${timeoutSuccess ? 'successful' : 'failed'}`);

  // Manual offload
  console.log(`   Manually offloading ${index2}...`);
  await manager.manualOffload(index2);
  console.log(`✅ Manual offload completed\n`);

  console.log("9. 🎛️  Testing global activity monitoring control...");
  
  // Disable monitoring globally
  console.log(`   Disabling activity monitoring globally...`);
  manager.setActivityMonitoring(false);
  
  let statsAfterDisable = manager.getStats();
  console.log(`✅ Activity monitoring disabled, active timers: ${statsAfterDisable.activityMonitoring.activeTimers}`);

  // Re-enable monitoring
  console.log(`   Re-enabling activity monitoring...`);
  manager.setActivityMonitoring(true);
  
  statsAfterDisable = manager.getStats();
  console.log(`✅ Activity monitoring re-enabled, active timers: ${statsAfterDisable.activityMonitoring.activeTimers}\n`);

  console.log("10. 🧹 Testing offloaded index cleanup...");
  
  // List all offloaded indices
  const allOffloaded = await manager.listOffloadedIndices();
  console.log(`📋 Found ${allOffloaded.length} offloaded indices to clean up`);

  // Delete one offloaded index
  if (allOffloaded.length > 0) {
    const toDelete = allOffloaded[0];
    console.log(`   Deleting offloaded index: ${toDelete.id}`);
    await manager.deleteOffloadedIndex(toDelete.id);
    
    const afterDelete = await manager.listOffloadedIndices();
    console.log(`✅ Deleted successfully, ${afterDelete.length} indices remaining\n`);
  }

  console.log("11. 📊 Final statistics...");
  
  const finalStats = manager.getStats();
  console.log(`📈 Final VectorDB Statistics:`);
  console.log(`   - Total instances in memory: ${finalStats.totalInstances}`);
  console.log(`   - Total documents: ${finalStats.totalDocuments}`);
  console.log(`   - Instances by namespace:`, finalStats.instancesByNamespace);
  console.log(`   - Activity monitoring:`);
  console.log(`     * Enabled: ${finalStats.activityMonitoring.enabled}`);
  console.log(`     * Active timers: ${finalStats.activityMonitoring.activeTimers}`);
  console.log(`     * Default timeout: ${finalStats.activityMonitoring.defaultTimeout}ms`);
  console.log(`     * Offload directory: ${finalStats.activityMonitoring.offloadDirectory}\n`);

  console.log("12. 🧹 Cleanup...");
  await manager.destroyAll();
  await cleanup();
  console.log(`✅ All resources cleaned up\n`);

  console.log("🎉 Activity Monitoring Demo Completed Successfully!");
  console.log("\n📋 Features Demonstrated:");
  console.log("✅ Activity monitoring configuration");
  console.log("✅ Automatic offloading after inactivity timeout");
  console.log("✅ Resume from offload when index is accessed again");
  console.log("✅ Manual offloading and management");
  console.log("✅ Ping functionality to reset activity timers");
  console.log("✅ Custom timeout configuration per index");
  console.log("✅ Global activity monitoring control");
  console.log("✅ Namespace-aware offloading and listing");
  console.log("✅ Offloaded index cleanup");
  console.log("✅ Comprehensive event system");
  console.log("✅ Activity statistics and monitoring");
}

// Run the demonstration
if (import.meta.main) {
  try {
    await demonstrateActivityMonitoring();
  } catch (error) {
    console.error("❌ Demo failed:", error);
    Deno.exit(1);
  }
} 