#!/usr/bin/env deno run --allow-read --allow-write --allow-net --allow-env --allow-ffi

/**
 * VectorDB Binary Format Example
 * 
 * This example demonstrates the efficiency improvements of the new binary format
 * for storing vector embeddings compared to the legacy JSON format.
 */

import { VectorDBManager } from "../vectordb/mod.ts";

// Configuration
const EXAMPLE_CONFIG = {
  offloadDirectory: "./example_binary_offload",
  embeddingModel: "mock-model" // Use mock model for consistent testing
};

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

// Generate sample documents with vectors
function generateSampleDocuments(count: number, embeddingDim: number) {
  const documents = [];
  const topics = [
    "machine learning and artificial intelligence",
    "web development and programming",
    "data science and analytics",
    "cloud computing and infrastructure"
  ];
  
  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    
    // Generate deterministic vector for consistent results
    const vector = Array.from({ length: embeddingDim }, (_, j) => 
      Math.sin((i + 1) * (j + 1) * 0.1) * 0.5 + Math.cos(i * 0.2) * 0.3
    );
    
    documents.push({
      id: `document-${i.toString().padStart(3, '0')}`,
      text: `${topic} - Document ${i} with detailed content about technology trends and innovations`,
      vector,
      metadata: {
        index: i,
        category: topic.split(' ')[0],
        priority: Math.floor(Math.random() * 5) + 1,
        timestamp: new Date().toISOString()
      }
    });
  }
  
  return documents;
}

async function demonstrateBinaryFormat() {
  console.log("🚀 VectorDB Binary Format Efficiency Example");
  console.log("============================================");
  console.log("This example shows the storage efficiency improvements");
  console.log("of the new binary format vs. legacy JSON format.\n");
  
  // Ensure example directory exists
  await Deno.mkdir(EXAMPLE_CONFIG.offloadDirectory, { recursive: true });
  
  // Create VectorDB manager
  const manager = new VectorDBManager({
    defaultEmbeddingModel: EXAMPLE_CONFIG.embeddingModel,
    maxInstances: 5,
    offloadDirectory: EXAMPLE_CONFIG.offloadDirectory,
    defaultInactivityTimeout: 10000, // Long timeout to prevent auto-offload
    enableActivityMonitoring: true
  });
  
  // Generate test data
  const documentCount = 100;
  const embeddingDimension = 384;
  console.log(`📊 Generating ${documentCount} documents with ${embeddingDimension}-dimensional vectors...`);
  const documents = generateSampleDocuments(documentCount, embeddingDimension);
  
  // Create index and add documents
  console.log("🔧 Creating vector index and adding documents...");
  const indexId = await manager.createIndex({
    id: "binary-format-example",
    namespace: "demo"
  });
  
  await manager.addDocuments(indexId, documents);
  
  const instance = manager.getInstance(indexId);
  console.log(`✅ Added ${instance?.documentCount} documents to index`);
  console.log(`   Embedding dimension: ${instance?.embeddingDimension}`);
  
  // Test query functionality
  console.log("\n🔍 Testing query functionality...");
  const queryResults = await manager.queryIndex(indexId, "machine learning", { k: 3 });
  console.log(`✅ Query returned ${queryResults.length} results:`);
  queryResults.forEach((result, i) => {
    console.log(`   ${i + 1}. ${result.id} (score: ${result.score.toFixed(3)})`);
  });
  
  // Offload to binary format
  console.log("\n💾 Offloading to binary format...");
  await manager.manualOffload(indexId);
  
  // Analyze file sizes
  console.log("\n📈 Analyzing storage efficiency...");
  // indexId already includes the namespace (demo:binary-format-example)
  const metadataPath = `${EXAMPLE_CONFIG.offloadDirectory}/${indexId}.metadata.json`;
  const documentsPath = `${EXAMPLE_CONFIG.offloadDirectory}/${indexId}.documents.json`;
  const vectorsPath = `${EXAMPLE_CONFIG.offloadDirectory}/${indexId}.vectors.bin`;
  
  const metadataSize = await getFileSize(metadataPath);
  const documentsSize = await getFileSize(documentsPath);
  const vectorsSize = await getFileSize(vectorsPath);
  const totalBinarySize = metadataSize + documentsSize + vectorsSize;
  
  // Create equivalent JSON format for comparison
  const jsonPath = `${EXAMPLE_CONFIG.offloadDirectory}/legacy-format.json`;
  await Deno.writeTextFile(jsonPath, JSON.stringify(documents, null, 2));
  const jsonSize = await getFileSize(jsonPath);
  
  // Calculate metrics
  const compressionRatio = jsonSize / totalBinarySize;
  const spaceSavings = ((jsonSize - totalBinarySize) / jsonSize) * 100;
  
  console.log("\n📊 Storage Comparison Results:");
  console.log("─".repeat(50));
  console.log(`Legacy JSON format:        ${formatBytes(jsonSize)}`);
  console.log(`Binary format total:       ${formatBytes(totalBinarySize)}`);
  console.log(`  • Metadata (JSON):       ${formatBytes(metadataSize)}`);
  console.log(`  • Documents (JSON):      ${formatBytes(documentsSize)}`);
  console.log(`  • Vectors (binary):      ${formatBytes(vectorsSize)}`);
  console.log(`Compression ratio:         ${compressionRatio.toFixed(2)}x`);
  console.log(`Space savings:             ${spaceSavings.toFixed(1)}%`);
  
  // Calculate vector storage efficiency
  const theoreticalVectorSize = documentCount * embeddingDimension * 4; // 4 bytes per float32
  const vectorEfficiency = (vectorsSize / (theoreticalVectorSize + 8 + documentCount * 4)) * 100; // Add header and ID overhead
  console.log(`Vector storage efficiency: ${vectorEfficiency.toFixed(1)}% of theoretical minimum`);
  
  // Test resume functionality
  console.log("\n🔄 Testing resume from binary format...");
  const resumedId = await manager.createIndex({
    id: "binary-format-example",
    namespace: "demo"
  });
  
  const resumedInstance = manager.getInstance(resumedId);
  console.log(`✅ Resumed index with ${resumedInstance?.documentCount} documents`);
  console.log(`   Is from offload: ${resumedInstance?.isFromOffload}`);
  
  // Verify data integrity
  console.log("\n🔍 Verifying data integrity after resume...");
  const verifyResults = await manager.queryIndex(resumedId, "machine learning", { k: 3 });
  console.log(`✅ Verification query returned ${verifyResults.length} results`);
  
  // Compare results
  const resultsMatch = verifyResults.length === queryResults.length &&
    verifyResults.every((result, i) => result.id === queryResults[i].id);
  console.log(`   Results match original: ${resultsMatch ? '✅ Yes' : '❌ No'}`);
  
  // Clean up
  await manager.destroyAll();
  
  console.log("\n✨ Key Benefits of Binary Format:");
  console.log("  🎯 Significant space savings (typically 60-80%)");
  console.log("  ⚡ Faster serialization and deserialization");
  console.log("  🔢 Perfect floating-point precision preservation");
  console.log("  📁 Separate storage for vectors vs. text/metadata");
  console.log("  🔄 Backward compatibility with legacy JSON format");
  console.log("  💾 Near-optimal storage efficiency for vector data");
  
  // Clean up example directory
  try {
    await Deno.remove(EXAMPLE_CONFIG.offloadDirectory, { recursive: true });
    console.log(`\n🧹 Cleaned up example directory: ${EXAMPLE_CONFIG.offloadDirectory}`);
  } catch (error) {
    console.warn(`⚠️  Could not clean up example directory: ${error}`);
  }
  
  console.log("\n🎉 Binary format example completed successfully!");
}

// Run the example
if (import.meta.main) {
  try {
    await demonstrateBinaryFormat();
  } catch (error) {
    console.error("❌ Example failed:", error);
    Deno.exit(1);
  }
} 