#!/usr/bin/env deno run --allow-all

// Test script to verify environment variable configuration
import { VectorDBManager, createOllamaEmbeddingProvider } from "../vectordb/mod.ts";
import { AgentManager, KernelType } from "../agents/mod.ts";

console.log("🧪 Testing Environment Variable Configuration");
console.log("=" .repeat(50));

// Test Vector Database Configuration
console.log("\n📊 Vector Database Configuration:");
const defaultEmbeddingProviderName = Deno.env.get("DEFAULT_EMBEDDING_PROVIDER_NAME") || undefined;
console.log(`- DEFAULT_EMBEDDING_PROVIDER_NAME: ${defaultEmbeddingProviderName || "not set"}`);
console.log(`- EMBEDDING_MODEL: ${Deno.env.get("EMBEDDING_MODEL") || "mock-model (default)"}`);
console.log(`- OLLAMA_HOST: ${Deno.env.get("OLLAMA_HOST") || "http://localhost:11434 (default)"}`);
console.log(`- MAX_VECTOR_DB_INSTANCES: ${Deno.env.get("MAX_VECTOR_DB_INSTANCES") || "20 (default)"}`);

// Test Agent Model Settings Configuration
console.log("\n🤖 Agent Model Settings Configuration:");
const DEFAULT_AGENT_MODEL_SETTINGS = {
  baseURL: Deno.env.get("AGENT_MODEL_BASE_URL") || "http://localhost:11434/v1/",
  apiKey: Deno.env.get("AGENT_MODEL_API_KEY") || "ollama",
  model: Deno.env.get("AGENT_MODEL_NAME") || "qwen2.5-coder:7b",
  temperature: parseFloat(Deno.env.get("AGENT_MODEL_TEMPERATURE") || "0.7")
};

console.log(`- AGENT_MODEL_BASE_URL: ${DEFAULT_AGENT_MODEL_SETTINGS.baseURL}`);
console.log(`- AGENT_MODEL_API_KEY: ${DEFAULT_AGENT_MODEL_SETTINGS.apiKey}`);
console.log(`- AGENT_MODEL_NAME: ${DEFAULT_AGENT_MODEL_SETTINGS.model}`);
console.log(`- AGENT_MODEL_TEMPERATURE: ${DEFAULT_AGENT_MODEL_SETTINGS.temperature}`);

// Test Agent Manager Configuration
console.log("\n👥 Agent Manager Configuration:");
const maxAgents = parseInt(Deno.env.get("MAX_AGENTS") || "10");
const agentDataDirectory = Deno.env.get("AGENT_DATA_DIRECTORY") || "./agent_data";
const autoSaveConversations = Deno.env.get("AUTO_SAVE_CONVERSATIONS") !== "false";
const maxStepsCap = parseInt(Deno.env.get("AGENT_MAX_STEPS_CAP") || "10");

console.log(`- MAX_AGENTS: ${maxAgents}`);
console.log(`- AGENT_DATA_DIRECTORY: ${agentDataDirectory}`);
console.log(`- AUTO_SAVE_CONVERSATIONS: ${autoSaveConversations}`);
console.log(`- AGENT_MAX_STEPS_CAP: ${maxStepsCap}`);

// Test creating VectorDBManager with configuration
console.log("\n🔧 Testing VectorDBManager Creation:");
try {
  const vectorDBManager = new VectorDBManager({
    defaultEmbeddingModel: Deno.env.get("EMBEDDING_MODEL") || "mock-model",
    defaultEmbeddingProviderName: defaultEmbeddingProviderName,
    maxInstances: parseInt(Deno.env.get("MAX_VECTOR_DB_INSTANCES") || "20"),
    offloadDirectory: Deno.env.get("VECTORDB_OFFLOAD_DIRECTORY") || "./vectordb_offload",
    defaultInactivityTimeout: parseInt(Deno.env.get("VECTORDB_DEFAULT_INACTIVITY_TIMEOUT") || "1800000"),
    enableActivityMonitoring: Deno.env.get("VECTORDB_ACTIVITY_MONITORING") !== "false"
  });
  console.log("✅ VectorDBManager created successfully");
  
  // Try to add some Ollama providers
  console.log("\n🚀 Testing Ollama Provider Setup:");
  const ollamaHost = Deno.env.get("OLLAMA_HOST") || "http://localhost:11434";
  
  const defaultProviders = [
    { name: "ollama-nomic-embed-text", model: "nomic-embed-text", dimension: 768 },
    { name: "ollama-all-minilm", model: "all-minilm", dimension: 384 },
    { name: "ollama-mxbai-embed-large", model: "mxbai-embed-large", dimension: 1024 }
  ];
  
  let providersAdded = 0;
  for (const providerConfig of defaultProviders) {
    try {
      const provider = createOllamaEmbeddingProvider(
        providerConfig.name,
        ollamaHost,
        providerConfig.model,
        providerConfig.dimension
      );
      
      const success = vectorDBManager.addEmbeddingProvider(providerConfig.name, provider);
      if (success) {
        console.log(`✅ Added provider: ${providerConfig.name}`);
        providersAdded++;
      } else {
        console.log(`⚠️ Provider ${providerConfig.name} already exists`);
      }
    } catch (error) {
      console.log(`❌ Failed to add provider ${providerConfig.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  console.log(`\n📋 Summary: ${providersAdded} providers added successfully`);
  
  // Check if default provider exists
  if (defaultEmbeddingProviderName) {
    const hasProvider = vectorDBManager.getEmbeddingProvider(defaultEmbeddingProviderName);
    if (hasProvider) {
      console.log(`✅ Default embedding provider "${defaultEmbeddingProviderName}" is available`);
    } else {
      console.log(`❌ Default embedding provider "${defaultEmbeddingProviderName}" was not found`);
    }
  }
  
} catch (error) {
  console.error("❌ Error creating VectorDBManager:", error);
}

// Test creating AgentManager with configuration
console.log("\n🤖 Testing AgentManager Creation:");
try {
  const agentManager = new AgentManager({
    defaultModelSettings: DEFAULT_AGENT_MODEL_SETTINGS,
    agentDataDirectory,
    maxAgents,
    autoSaveConversations,
    defaultKernelType: KernelType.PYTHON,
    maxStepsCap
  });
  console.log("✅ AgentManager created successfully");
  
  const stats = agentManager.getStats();
  console.log(`📊 Agent Manager Stats:`, stats);
  
} catch (error) {
  console.error("❌ Error creating AgentManager:", error);
}

console.log("\n🎉 Configuration test completed!"); 