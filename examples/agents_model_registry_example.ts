#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-ffi --unstable

import { AgentManager, AgentEvents, KernelType, type ModelSettings } from "../agents/mod.ts";

// Define different model configurations
const OLLAMA_QWEN_CONFIG: ModelSettings = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  model: "qwen2.5-coder:7b",
  temperature: 0.7
};

const OLLAMA_LLAMA_CONFIG: ModelSettings = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama", 
  model: "llama3.1:8b",
  temperature: 0.5
};

const OPENAI_GPT4_CONFIG: ModelSettings = {
  baseURL: "https://api.openai.com/v1/",
  apiKey: "sk-your-openai-api-key-here",
  model: "gpt-4o-mini",
  temperature: 0.8
};

async function main() {
  try {
    console.log("\n🤖 Agent Model Registry Example");
    console.log("==================================");

    // Create agent manager with model registry and restrictions
    console.log("\n📋 Setting up AgentManager with model registry...");
    const agentManager = new AgentManager({
      maxAgents: 10,
      agentDataDirectory: "./example_agents_model_data",
      autoSaveConversations: true,
      
      // Model registry configuration
      modelRegistry: {
        "qwen-coder": OLLAMA_QWEN_CONFIG,
        "llama-chat": OLLAMA_LLAMA_CONFIG,
        "gpt4-mini": OPENAI_GPT4_CONFIG
      },
      
      // Allowed models (restrict what agents can use)
      allowedModels: ["qwen-coder", "llama-chat"], // Only allow Ollama models
      
      // Default model from registry
      defaultModelId: "qwen-coder",
      
      // Allow custom models (set to false to force registry usage)
      allowCustomModels: false
    });

    // Set up event listeners for model events
    console.log("\n📡 Setting up model registry event listeners...");
    agentManager.on(AgentEvents.MODEL_ADDED, (data) => {
      console.log(`✅ Model added: ${data.modelId} (${data.data.model})`);
    });

    agentManager.on(AgentEvents.MODEL_REMOVED, (data) => {
      console.log(`❌ Model removed: ${data.modelId} (${data.data.model})`);
    });

    agentManager.on(AgentEvents.MODEL_UPDATED, (data) => {
      console.log(`🔄 Model updated: ${data.modelId}`);
    });

    agentManager.on(AgentEvents.AGENT_CREATED, (data) => {
      console.log(`🎭 Agent created: ${data.agentId}`);
    });

    // Display initial model registry
    console.log("\n📚 Initial Model Registry:");
    const models = agentManager.listModels();
    models.forEach(model => {
      console.log(`  - ${model.id}: ${model.modelSettings.model} (${model.modelSettings.baseURL})`);
    });

    // Get model statistics
    console.log("\n📊 Model Registry Statistics:");
    const modelStats = agentManager.getModelStats();
    console.log(`  Total models: ${modelStats.totalModels}`);
    console.log(`  Models in use: ${modelStats.modelsInUse}`);
    console.log(`  Allow custom models: ${modelStats.allowCustomModels}`);
    console.log(`  Allowed models: ${modelStats.allowedModels?.join(", ") || "All"}`);

    // Test 1: Create agent using model ID from registry
    console.log("\n🧪 Test 1: Create agent using model ID from registry");
    const agent1Id = await agentManager.createAgent({
      id: "test-agent-1",
      name: "Test Agent 1",
      description: "Agent using qwen-coder model",
      instructions: "You are a helpful coding assistant.",
      modelId: "qwen-coder" // Use model from registry
    });

    const agent1 = agentManager.getAgent(agent1Id)!;
    console.log(`✅ Agent 1 created with model: ${agent1.ModelSettings.model}`);

    // Test 2: Create agent using different model ID
    console.log("\n🧪 Test 2: Create agent using different model from registry");
    const agent2Id = await agentManager.createAgent({
      id: "test-agent-2", 
      name: "Test Agent 2",
      description: "Agent using llama-chat model",
      instructions: "You are a friendly chat assistant.",
      modelId: "llama-chat"
    });

    const agent2 = agentManager.getAgent(agent2Id)!;
    console.log(`✅ Agent 2 created with model: ${agent2.ModelSettings.model}`);

    // Test 3: Try to create agent with disallowed model (should fail)
    console.log("\n🧪 Test 3: Try to create agent with disallowed model");
    try {
      await agentManager.createAgent({
        id: "test-agent-3",
        name: "Test Agent 3", 
        modelId: "gpt4-mini" // This is not in allowedModels
      });
    } catch (error) {
      console.log(`❌ Expected error: ${error}`);
    }

    // Test 4: Try to create agent with custom model settings (should fail)
    console.log("\n🧪 Test 4: Try to create agent with custom model settings");
    try {
      await agentManager.createAgent({
        id: "test-agent-4",
        name: "Test Agent 4",
        ModelSettings: {
          baseURL: "http://custom.api.com/v1/",
          apiKey: "custom-key",
          model: "custom-model",
          temperature: 0.9
        }
      });
    } catch (error) {
      console.log(`❌ Expected error: ${error}`);
    }

    // Test 5: Add a new model to registry at runtime
    console.log("\n🧪 Test 5: Add new model to registry at runtime");
    const newModelSettings: ModelSettings = {
      baseURL: "http://localhost:11434/v1/",
      apiKey: "ollama",
      model: "codestral:22b",
      temperature: 0.3
    };

    const added = agentManager.addModel("codestral-large", newModelSettings);
    console.log(`Model added: ${added}`);

    // Update allowed models to include the new one
    agentManager.setAllowedModels(["qwen-coder", "llama-chat", "codestral-large"]);
    console.log("✅ Updated allowed models list");

    // Test 6: Create agent with newly added model
    console.log("\n🧪 Test 6: Create agent with newly added model");
    const agent3Id = await agentManager.createAgent({
      id: "test-agent-5",
      name: "Test Agent 5",
      description: "Agent using newly added model",
      modelId: "codestral-large"
    });

    const agent3 = agentManager.getAgent(agent3Id)!;
    console.log(`✅ Agent 3 created with new model: ${agent3.ModelSettings.model}`);

    // Test 7: Change an existing agent's model
    console.log("\n🧪 Test 7: Change existing agent's model");
    console.log(`Agent 1 current model: ${agent1.ModelSettings.model}`);
    await agentManager.changeAgentModel(agent1Id, "llama-chat");
    console.log(`Agent 1 new model: ${agent1.ModelSettings.model}`);

    // Test 8: Get updated model statistics
    console.log("\n📊 Updated Model Registry Statistics:");
    const updatedStats = agentManager.getModelStats();
    console.log(`  Total models: ${updatedStats.totalModels}`);
    console.log(`  Models in use: ${updatedStats.modelsInUse}`);
    
    console.log("\n📈 Model Usage Details:");
    updatedStats.modelUsage.forEach(usage => {
      console.log(`  - ${usage.id}: ${usage.agentsUsing} agent(s) using ${usage.model}`);
    });

    // Test 9: Update model settings
    console.log("\n🧪 Test 9: Update model settings in registry");
    const updatedModelSettings: ModelSettings = {
      ...newModelSettings,
      temperature: 0.1 // Change temperature
    };
    
    const updated = agentManager.updateModel("codestral-large", updatedModelSettings);
    console.log(`Model updated: ${updated}`);

    // Test 10: Try to remove a model that's in use (should fail)
    console.log("\n🧪 Test 10: Try to remove model that's in use");
    try {
      agentManager.removeModel("llama-chat"); // This model is used by agents
    } catch (error) {
      console.log(`❌ Expected error: ${error}`);
    }

    // Test 11: Remove an unused model
    console.log("\n🧪 Test 11: Remove unused model");
    try {
      const removed = agentManager.removeModel("gpt4-mini"); // This model is not used
      console.log(`Model removed: ${removed}`);
    } catch (error) {
      console.log(`❌ Error removing model: ${error}`);
    }

    // Test 12: Allow custom models and create agent with custom settings
    console.log("\n🧪 Test 12: Enable custom models and create agent");
    agentManager.setAllowCustomModels(true);
    
    const agent4Id = await agentManager.createAgent({
      id: "test-agent-custom",
      name: "Custom Model Agent",
      description: "Agent with custom model settings",
      ModelSettings: {
        baseURL: "http://localhost:11434/v1/",
        apiKey: "ollama",
        model: "phi3:mini",
        temperature: 0.6
      }
    });

    const agent4 = agentManager.getAgent(agent4Id)!;
    console.log(`✅ Custom agent created with model: ${agent4.ModelSettings.model}`);

    // Final statistics
    console.log("\n📊 Final Manager Statistics:");
    const finalStats = agentManager.getStats();
    console.log(`  Total agents: ${finalStats.totalAgents}`);
    console.log(`  Total models in registry: ${finalStats.modelRegistry.totalModels}`);
    console.log(`  Models currently in use: ${finalStats.modelRegistry.modelsInUse}`);
    console.log(`  Allow custom models: ${finalStats.modelRegistry.allowCustomModels}`);

    console.log("\n📚 Final Model Registry:");
    const finalModels = agentManager.listModels();
    finalModels.forEach(model => {
      const usage = updatedStats.modelUsage.find(u => u.id === model.id);
      console.log(`  - ${model.id}: ${model.modelSettings.model} (used by ${usage?.agentsUsing || 0} agent(s))`);
    });

    // Cleanup
    console.log("\n🧹 Cleaning up...");
    await agentManager.destroyAll();
    console.log("✅ All agents destroyed");

  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Helper function to wait
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

if (import.meta.main) {
  main();
} 