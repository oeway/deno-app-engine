// Example: Using VectorDBManager with Provider Registry Configuration

import { 
  VectorDBManager, 
  createGenericEmbeddingProvider, 
  createOllamaEmbeddingProvider,
  IProviderRegistryConfig 
} from "../vectordb/manager.ts";

// Example 1: Create providers using helper functions
const mockProvider1 = createGenericEmbeddingProvider(
  "Mock Provider 1",
  384,
  async (text: string) => {
    // Simple mock embedding
    return new Array(384).fill(0).map(() => Math.random());
  }
);

const mockProvider2 = createGenericEmbeddingProvider(
  "Mock Provider 2", 
  512,
  async (text: string) => {
    // Another mock embedding with different dimension
    return new Array(512).fill(0).map(() => Math.random());
  }
);

// Example 2: Create Ollama provider (if you have Ollama running)
const ollamaProvider = createOllamaEmbeddingProvider(
  "Ollama Embeddings",
  "http://localhost:11434", // Ollama host
  "nomic-embed-text",       // Embedding model
  768                       // Dimension
);

// Example 3: Configure provider registry
const providerRegistry: IProviderRegistryConfig = {
  "mock-1": mockProvider1,
  "mock-2": mockProvider2,
  "ollama-nomic": ollamaProvider
};

// Example 4: Create VectorDBManager with provider registry
const manager = new VectorDBManager({
  defaultEmbeddingModel: "mock-model",
  defaultEmbeddingProviderName: "mock-1", // Use mock-1 as default
  maxInstances: 10,
  providerRegistry: providerRegistry // Pass the provider registry config
});

// Example 5: Usage examples
async function examples() {
  try {
    // List all available providers
    console.log("Available providers:", manager.listEmbeddingProviders());
    
    // Create an index using the default provider (mock-1)
    const indexId1 = await manager.createIndex({
      namespace: "test"
    });
    
    // Create an index using a specific provider
    const indexId2 = await manager.createIndex({
      namespace: "test",
      embeddingProviderName: "mock-2" // Use mock-2 provider
    });
    
    // Create an index using Ollama provider
    const indexId3 = await manager.createIndex({
      namespace: "test", 
      embeddingProviderName: "ollama-nomic" // Use Ollama provider
    });
    
    // Add documents (embeddings will be generated using the specified providers)
    await manager.addDocuments(indexId1, [
      { id: "doc1", text: "This is a test document" },
      { id: "doc2", text: "Another test document" }
    ]);
    
    await manager.addDocuments(indexId2, [
      { id: "doc3", text: "Document with different embedding provider" }
    ]);
    
    // Query the indices
    const results1 = await manager.queryIndex(indexId1, "test query", { k: 5 });
    const results2 = await manager.queryIndex(indexId2, "test query", { k: 5 });
    
    console.log("Results from index 1:", results1);
    console.log("Results from index 2:", results2);
    
    // Get provider statistics
    console.log("Provider stats:", manager.getEmbeddingProviderStats());
    
    // Clean up
    await manager.destroyAll();
    
  } catch (error) {
    console.error("Error:", error);
  }
}

// Run examples
if (import.meta.main) {
  examples();
}

export { examples }; 