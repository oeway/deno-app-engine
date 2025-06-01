import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { AgentManager, AgentEvents, type ModelSettings } from "../agents/mod.ts";

// Test model configurations
const MOCK_MODEL_1: ModelSettings = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "test-key-1",
  model: "test-model-1",
  temperature: 0.5
};

const MOCK_MODEL_2: ModelSettings = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "test-key-2", 
  model: "test-model-2",
  temperature: 0.7
};

const CUSTOM_MODEL: ModelSettings = {
  baseURL: "http://custom.api.com/v1/",
  apiKey: "custom-key",
  model: "custom-model",
  temperature: 0.9
};

const TEST_DATA_DIR = "./test_agents_model_registry_data";

async function cleanupTestData() {
  try {
    await Deno.remove(TEST_DATA_DIR, { recursive: true });
  } catch {
    // Directory might not exist
  }
}

Deno.test("Model Registry - Basic Setup", async () => {
  await cleanupTestData();
  
  const agentManager = new AgentManager({
    maxAgents: 5,
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "model-1": MOCK_MODEL_1,
      "model-2": MOCK_MODEL_2
    },
    defaultModelId: "model-1",
    allowedModels: ["model-1", "model-2"],
    allowCustomModels: false
  });

  // Test initial state
  assertEquals(agentManager.listModels().length, 2);
  assert(agentManager.hasModel("model-1"));
  assert(agentManager.hasModel("model-2"));
  assert(!agentManager.hasModel("non-existent"));

  // Test model retrieval
  const model1 = agentManager.getModel("model-1");
  assertExists(model1);
  assertEquals(model1.modelSettings.model, "test-model-1");

  await cleanupTestData();
});

Deno.test("Model Registry - Agent Creation with Model ID", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "model-1": MOCK_MODEL_1,
      "model-2": MOCK_MODEL_2
    },
    defaultModelId: "model-1",
    allowCustomModels: false
  });

  // Create agent with specific model ID
  const agentId = await agentManager.createAgent({
    id: "test-agent",
    name: "Test Agent",
    modelId: "model-2"
  });

  const agent = agentManager.getAgent(agentId)!;
  assertExists(agent);
  assertEquals(agent.ModelSettings.model, "test-model-2");
  assertEquals(agent.ModelSettings.temperature, 0.7);

  await cleanupTestData();
});

Deno.test("Model Registry - Default Model Usage", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "default-model": MOCK_MODEL_1
    },
    defaultModelId: "default-model",
    allowCustomModels: false
  });

  // Create agent without specifying model (should use default)
  const agentId = await agentManager.createAgent({
    id: "test-agent",
    name: "Test Agent"
  });

  const agent = agentManager.getAgent(agentId)!;
  assertExists(agent);
  assertEquals(agent.ModelSettings.model, "test-model-1");

  await cleanupTestData();
});

Deno.test("Model Registry - Allowed Models Restriction", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "allowed-model": MOCK_MODEL_1,
      "restricted-model": MOCK_MODEL_2
    },
    allowedModels: ["allowed-model"], // Only allow one model
    allowCustomModels: false
  });

  // Should succeed with allowed model
  const agent1Id = await agentManager.createAgent({
    id: "test-agent-1",
    name: "Test Agent 1",
    modelId: "allowed-model"
  });

  assertExists(agentManager.getAgent(agent1Id));

  // Should fail with restricted model
  try {
    await agentManager.createAgent({
      id: "test-agent-2",
      name: "Test Agent 2",
      modelId: "restricted-model"
    });
    assert(false, "Should have thrown error for restricted model");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("not in the allowed models list"));
  }

  await cleanupTestData();
});

Deno.test("Model Registry - Custom Model Settings", async () => {
  await cleanupTestData();

  // Test with allowCustomModels = false
  const agentManager1 = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    allowCustomModels: false
  });

  try {
    await agentManager1.createAgent({
      id: "test-agent",
      name: "Test Agent",
      ModelSettings: CUSTOM_MODEL
    });
    assert(false, "Should have thrown error for custom model settings");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("Custom model settings are not allowed"));
  }

  // Test with allowCustomModels = true
  const agentManager2 = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    allowCustomModels: true
  });

  const agentId = await agentManager2.createAgent({
    id: "test-agent",
    name: "Test Agent",
    ModelSettings: CUSTOM_MODEL
  });

  const agent = agentManager2.getAgent(agentId)!;
  assertExists(agent);
  assertEquals(agent.ModelSettings.model, "custom-model");

  await cleanupTestData();
});

Deno.test("Model Registry - Add/Remove/Update Models", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "initial-model": MOCK_MODEL_1
    }
  });

  // Test adding model
  const added = agentManager.addModel("new-model", MOCK_MODEL_2);
  assertEquals(added, true);
  assert(agentManager.hasModel("new-model"));

  // Test adding duplicate model (should fail)
  const addedDuplicate = agentManager.addModel("new-model", MOCK_MODEL_2);
  assertEquals(addedDuplicate, false);

  // Test updating model
  const updatedSettings: ModelSettings = {
    ...MOCK_MODEL_2,
    temperature: 0.8
  };
  const updated = agentManager.updateModel("new-model", updatedSettings);
  assertEquals(updated, true);

  const retrievedModel = agentManager.getModel("new-model")!;
  assertEquals(retrievedModel.modelSettings.temperature, 0.8);

  // Test removing unused model
  const removed = agentManager.removeModel("new-model");
  assertEquals(removed, true);
  assert(!agentManager.hasModel("new-model"));

  // Test removing non-existent model
  const removedNonExistent = agentManager.removeModel("non-existent");
  assertEquals(removedNonExistent, false);

  await cleanupTestData();
});

Deno.test("Model Registry - Remove Model In Use", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "used-model": MOCK_MODEL_1
    }
  });

  // Create agent using the model
  await agentManager.createAgent({
    id: "test-agent",
    name: "Test Agent",
    modelId: "used-model"
  });

  // Try to remove model that's in use (should fail)
  try {
    agentManager.removeModel("used-model");
    assert(false, "Should have thrown error for removing model in use");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("it is being used"));
  }

  await cleanupTestData();
});

Deno.test("Model Registry - Change Agent Model", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "model-1": MOCK_MODEL_1,
      "model-2": MOCK_MODEL_2
    }
  });

  // Create agent with first model
  const agentId = await agentManager.createAgent({
    id: "test-agent",
    name: "Test Agent",
    modelId: "model-1"
  });

  const agent = agentManager.getAgent(agentId)!;
  assertEquals(agent.ModelSettings.model, "test-model-1");

  // Change to second model
  await agentManager.changeAgentModel(agentId, "model-2");
  assertEquals(agent.ModelSettings.model, "test-model-2");

  await cleanupTestData();
});

Deno.test("Model Registry - Statistics", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "model-1": MOCK_MODEL_1,
      "model-2": MOCK_MODEL_2
    },
    allowedModels: ["model-1"],
    allowCustomModels: false
  });

  // Initial stats
  let stats = agentManager.getModelStats();
  assertEquals(stats.totalModels, 2);
  assertEquals(stats.modelsInUse, 0);
  assertEquals(stats.allowCustomModels, false);
  assertEquals(stats.allowedModels?.length, 1);

  // Create agents
  await agentManager.createAgent({
    id: "agent-1",
    name: "Agent 1",
    modelId: "model-1"
  });

  // Updated stats
  stats = agentManager.getModelStats();
  assertEquals(stats.modelsInUse, 1);

  const model1Usage = stats.modelUsage.find(u => u.id === "model-1")!;
  assertEquals(model1Usage.agentsUsing, 1);

  await cleanupTestData();
});

Deno.test("Model Registry - Events", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR
  });

  const events: Array<{ type: string; data: any }> = [];

  agentManager.on(AgentEvents.MODEL_ADDED, (data) => {
    events.push({ type: 'MODEL_ADDED', data });
  });

  agentManager.on(AgentEvents.MODEL_REMOVED, (data) => {
    events.push({ type: 'MODEL_REMOVED', data });
  });

  agentManager.on(AgentEvents.MODEL_UPDATED, (data) => {
    events.push({ type: 'MODEL_UPDATED', data });
  });

  // Add model
  agentManager.addModel("test-model", MOCK_MODEL_1);
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'MODEL_ADDED');
  assertEquals(events[0].data.modelId, 'test-model');

  // Update model
  agentManager.updateModel("test-model", MOCK_MODEL_2);
  assertEquals(events.length, 2);
  assertEquals(events[1].type, 'MODEL_UPDATED');

  // Remove model
  agentManager.removeModel("test-model");
  assertEquals(events.length, 3);
  assertEquals(events[2].type, 'MODEL_REMOVED');

  await cleanupTestData();
});

Deno.test("Model Registry - Set Allowed Models and Custom Models", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    agentDataDirectory: TEST_DATA_DIR,
    modelRegistry: {
      "model-1": MOCK_MODEL_1,
      "model-2": MOCK_MODEL_2
    },
    allowCustomModels: true
  });

  // Initially no restrictions
  await agentManager.createAgent({
    id: "agent-1",
    name: "Agent 1",
    modelId: "model-1"
  });

  // Set allowed models restriction
  agentManager.setAllowedModels(["model-1"]);

  try {
    await agentManager.createAgent({
      id: "agent-2",
      name: "Agent 2",
      modelId: "model-2" // Now restricted
    });
    assert(false, "Should have thrown error for restricted model");
  } catch (error: unknown) {
    assert(error instanceof Error);
  }

  // Disable custom models
  agentManager.setAllowCustomModels(false);

  try {
    await agentManager.createAgent({
      id: "agent-3",
      name: "Agent 3",
      ModelSettings: CUSTOM_MODEL
    });
    assert(false, "Should have thrown error for custom model settings");
  } catch (error: unknown) {
    assert(error instanceof Error);
  }

  await cleanupTestData();
}); 