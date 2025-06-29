// Enhanced Agent Tests - Comprehensive coverage for advanced agent features
// Run with: deno test -A --no-check tests/agents_enhanced_test.ts

import { assertEquals, assertExists, assert, assertRejects, assertThrows } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { AgentManager, AgentEvents, KernelType, type IAgentInstance, type IAgentConfig } from "../agents/mod.ts";
import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";

// Configuration for testing
const TEST_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  model: "llama3.2:1b", // Small model suitable for CI testing
  temperature: 0.3
};

const TEST_DATA_DIR = "./test_agents_enhanced_data";

// Helper functions
async function cleanupTestData() {
  try {
    await Deno.remove(TEST_DATA_DIR, { recursive: true });
  } catch {
    // Ignore if directory doesn't exist
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper function to properly cleanup AgentManager instances
async function cleanupAgentManager(agentManager: AgentManager) {
  try {
    // Shutdown the agent manager properly to clean up all resources
    await agentManager.shutdown();
    
    // Remove all event listeners to prevent memory leaks
    agentManager.removeAllListeners();
    
    // Allow time for async cleanup to complete
    await wait(50);
  } catch (error) {
    console.warn('Warning during AgentManager cleanup:', error);
  }
}

// Helper function to properly cleanup KernelManager instances
async function cleanupKernelManager(kernelManager: KernelManager | undefined) {
  if (kernelManager && typeof kernelManager.destroyAll === 'function') {
    try {
      await kernelManager.destroyAll();
      await wait(50);
    } catch (error) {
      console.warn('Warning during KernelManager cleanup:', error);
    }
  }
}

// Enhanced Agent Tests
Deno.test("Enhanced Agents - Environment Variables Configuration", async () => {
  await cleanupTestData();

  const kernelManager = new KernelManager();
  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });
  agentManager.setKernelManager(kernelManager);

  try {
    // Test environment variables configuration with Python kernel
    const pythonAgentId = await agentManager.createAgent({
      id: "python-env-config-test",
      name: "Python Environment Configuration Test Agent",
      instructions: "You are a Python assistant with configured environment variables.",
      kernelType: KernelType.PYTHON,
      kernelEnvirons: {
        "TEST_API_KEY": "secret123",
        "DEBUG_MODE": "true",
        "DATABASE_URL": "postgresql://localhost:5432/test",
        "MAX_RETRIES": "3"
      },
      autoAttachKernel: true
    });

    const pythonAgent = agentManager.getAgent(pythonAgentId)!;
    assertExists(pythonAgent, "Python agent should be created");
    assertEquals(pythonAgent.kernelEnvirons?.TEST_API_KEY, "secret123", "Should store TEST_API_KEY");
    assertEquals(pythonAgent.kernelEnvirons?.DEBUG_MODE, "true", "Should store DEBUG_MODE");
    assertEquals(pythonAgent.kernelEnvirons?.DATABASE_URL, "postgresql://localhost:5432/test", "Should store DATABASE_URL");
    assertEquals(pythonAgent.kernelEnvirons?.MAX_RETRIES, "3", "Should store MAX_RETRIES");

    // Test environment variables with TypeScript kernel
    const tsAgentId = await agentManager.createAgent({
      id: "ts-env-config-test",
      name: "TypeScript Environment Configuration Test Agent",
      instructions: "You are a TypeScript assistant with configured environment variables.",
      kernelType: KernelType.TYPESCRIPT,
      kernelEnvirons: {
        "TS_API_KEY": "typescript_secret",
        "APP_NAME": "TestApp",
        "VERSION": "1.0.0"
      },
      autoAttachKernel: true
    });

    const tsAgent = agentManager.getAgent(tsAgentId)!;
    assertExists(tsAgent, "TypeScript agent should be created");
    assertEquals(tsAgent.kernelEnvirons?.TS_API_KEY, "typescript_secret", "Should store TS_API_KEY");
    assertEquals(tsAgent.kernelEnvirons?.APP_NAME, "TestApp", "Should store APP_NAME");
    assertEquals(tsAgent.kernelEnvirons?.VERSION, "1.0.0", "Should store VERSION");

    // Test updating environment variables
    agentManager.updateAgent(pythonAgentId, {
      kernelEnvirons: {
        "TEST_API_KEY": "updated_secret",
        "NEW_VAR": "new_value"
      }
    });

    const updatedAgent = agentManager.getAgent(pythonAgentId)!;
    assertEquals(updatedAgent.kernelEnvirons?.TEST_API_KEY, "updated_secret", "Should update TEST_API_KEY");
    assertEquals(updatedAgent.kernelEnvirons?.NEW_VAR, "new_value", "Should add NEW_VAR");
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupKernelManager(kernelManager);
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Startup Script Configuration", async () => {
  await cleanupTestData();

  const kernelManager = new KernelManager();
  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });
  agentManager.setKernelManager(kernelManager);

  try {
    // Create agent with startup script
    const agentId = await agentManager.createAgent({
      id: "startup-config-test-agent",
      name: "Startup Configuration Test Agent",
      instructions: "You are a Python assistant with pre-configured libraries.",
      kernelType: KernelType.PYTHON,
      startupScript: `
import math
import json
import datetime

# Set up some global variables
PI = math.pi
TODAY = datetime.date.today().isoformat()
READY = True

print("Startup script executed successfully!")
print(f"Pi value: {PI}")
print(f"Today's date: {TODAY}")
print("Environment initialized!")
`,
      autoAttachKernel: true
    });

    const agent = agentManager.getAgent(agentId)!;
    assertExists(agent, "Agent should be created");
    assertExists(agent.startupScript, "Agent should have startup script");
    assert(agent.startupScript.includes("import math"), "Startup script should include math import");
    assert(agent.startupScript.includes("PI = math.pi"), "Startup script should set PI variable");

    // Test updating startup script
    agentManager.updateAgent(agentId, {
      startupScript: `
import os
UPDATED = True
print("Updated startup script executed!")
`
    });

    const updatedAgent = agentManager.getAgent(agentId)!;
    assertExists(updatedAgent.startupScript, "Updated agent should have startup script");
    assert(updatedAgent.startupScript.includes("UPDATED = True"), "Updated startup script should set UPDATED variable");
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupKernelManager(kernelManager);
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Configuration and Memory Management", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  try {
    // Create agent with various configurations
    const agentId = await agentManager.createAgent({
      id: "config-test-agent",
      name: "Configuration Test Agent",
      instructions: "You are an assistant for testing configurations.",
      enablePlanning: true,
      planningInterval: 1, // Plan every step
      maxSteps: 5
    });

    const agent = agentManager.getAgent(agentId)!;
    assertExists(agent, "Agent should be created");
    assertExists(agent.memory, "Agent should have memory");
    assertEquals(agent.enablePlanning, true, "Agent should have planning enabled");
    assertEquals(agent.planningInterval, 1, "Agent should have correct planning interval");
    assertEquals(agent.maxSteps, 5, "Agent should have correct max steps");
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Error Handling and Edge Cases", async () => {
  await cleanupTestData();

  const kernelManager = new KernelManager();
  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });
  agentManager.setKernelManager(kernelManager);

  let noKernelManager: AgentManager | undefined;

  try {
    // Test creating agent with invalid kernel type - system handles this gracefully
    const invalidAgentId = await agentManager.createAgent({
      id: "invalid-kernel-agent",
      name: "Invalid Kernel Agent",
      kernelType: "INVALID" as any,
      autoAttachKernel: true
    });
    
    // The system should handle invalid kernel types gracefully by converting to a valid type
    assertExists(invalidAgentId, "Agent should be created even with invalid kernel type");
    const invalidAgent = agentManager.getAgent(invalidAgentId)!;
    assertExists(invalidAgent, "Agent should exist");
    // The kernel type should be converted to a valid one (likely python)
    assert(invalidAgent.kernelType === KernelType.PYTHON || invalidAgent.kernelType === KernelType.TYPESCRIPT, 
           "Invalid kernel type should be converted to a valid one");

    // Test creating agent with conflicting IDs
    const validConfig: IAgentConfig = {
      id: "duplicate-id-test",
      name: "First Agent"
    };

    await agentManager.createAgent(validConfig);

    await assertRejects(
      async () => {
        await agentManager.createAgent({
          id: "duplicate-id-test",
          name: "Second Agent"
        });
      },
      Error,
      "Agent with ID \"duplicate-id-test\" already exists"
    );

    // Test agent operations on non-existent agent
    assertEquals(agentManager.getAgent("non-existent"), undefined, "Should return undefined for non-existent agent");

    await assertRejects(
      async () => {
        await agentManager.attachKernelToAgent("non-existent", KernelType.PYTHON);
      },
      Error,
      "Agent with ID \"non-existent\" not found"
    );

    await assertRejects(
      async () => {
        await agentManager.updateAgent("non-existent", { name: "Updated" });
      },
      Error,
      "Agent with ID \"non-existent\" not found"
    );

    // Test configuration validation
    await assertRejects(
      async () => {
        await agentManager.createAgent({
          id: "", // Empty ID
          name: "Empty ID Agent"
        });
      },
      Error,
      "Agent ID and name are required"
    );

    await assertRejects(
      async () => {
        await agentManager.createAgent({
          id: "no-name-agent",
          name: "" // Empty name
        });
      },
      Error,
      "Agent ID and name are required"
    );

    // Test kernel operations without kernel manager
    noKernelManager = new AgentManager({
      defaultModelSettings: TEST_CONFIG,
      agentDataDirectory: TEST_DATA_DIR
    });

    const agentId = await noKernelManager.createAgent({
      id: "no-kernel-manager-agent",
      name: "No Kernel Manager Agent",
      kernelType: KernelType.PYTHON,
      autoAttachKernel: true
    });

    await assertRejects(
      async () => {
        await noKernelManager!.attachKernelToAgent(agentId, KernelType.PYTHON);
      },
      Error,
      "Kernel manager not set. Use setKernelManager() first."
    );
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupKernelManager(kernelManager);
    
    if (noKernelManager) {
      await cleanupAgentManager(noKernelManager);
    }
    
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Conversation Management", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true
  });

  try {
    const agentId = await agentManager.createAgent({
      id: "conversation-test",
      name: "Conversation Test Agent",
      instructions: "You are a helpful assistant for testing conversation management."
    });

    const agent = agentManager.getAgent(agentId)!;

    // Test conversation history management
    assertEquals(agent.conversationHistory.length, 0, "Should start with empty conversation");

    // Manually add conversation history for testing
    agent.conversationHistory.push({
      role: "user",
      content: "Hello, how are you?"
    });

    agent.conversationHistory.push({
      role: "assistant", 
      content: "I'm doing well, thank you! How can I help you today?"
    });

    assertEquals(agent.conversationHistory.length, 2, "Should have 2 messages");

    // Test clearing conversation
    await agentManager.clearConversation(agentId);
    assertEquals(agent.conversationHistory.length, 0, "Conversation should be cleared");
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Agent Lifecycle and Resource Management", async () => {
  await cleanupTestData();

  const kernelManager = new KernelManager();
  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    maxAgents: 3 // Test with limited agents
  });
  agentManager.setKernelManager(kernelManager);

  try {
    // Test agent creation limits
    const agent1Id = await agentManager.createAgent({
      id: "lifecycle-agent-1",
      name: "Lifecycle Agent 1"
    });

    const agent2Id = await agentManager.createAgent({
      id: "lifecycle-agent-2", 
      name: "Lifecycle Agent 2"
    });

    const agent3Id = await agentManager.createAgent({
      id: "lifecycle-agent-3",
      name: "Lifecycle Agent 3"
    });

    // This should fail due to maxAgents limit
    await assertRejects(
      async () => {
        await agentManager.createAgent({
          id: "lifecycle-agent-4",
          name: "Lifecycle Agent 4"
        });
      },
      Error,
      "Maximum number of agents"
    );

    // Test agent destruction and resource cleanup
    await agentManager.destroyAgent(agent1Id);
    assertEquals(agentManager.getAgent(agent1Id), undefined, "Agent should be destroyed");

    // Should be able to create new agent after destroying one
    const agent4Id = await agentManager.createAgent({
      id: "lifecycle-agent-4",
      name: "Lifecycle Agent 4"
    });
    assertExists(agentManager.getAgent(agent4Id), "Should create agent after destruction");

    // Test batch operations
    const stats = agentManager.getStats();
    assertEquals(stats.totalAgents, 3, "Should have 3 agents");

    // Test destroying all agents
    await agentManager.destroyAll();
    assertEquals(agentManager.getAgentIds().length, 0, "Should have no agents after destroyAll");

    const finalStats = agentManager.getStats();
    assertEquals(finalStats.totalAgents, 0, "Stats should reflect no agents");
  } finally {
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupKernelManager(kernelManager);
    await cleanupTestData();
  }
});

Deno.test("Enhanced Agents - Event System", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: TEST_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  const events: any[] = [];

  // Set up event listeners
  const createdListener = (data: any) => {
    events.push({ type: 'created', data });
  };
  const updatedListener = (data: any) => {
    events.push({ type: 'updated', data });
  };
  const destroyedListener = (data: any) => {
    events.push({ type: 'destroyed', data });
  };
  const kernelAttachedListener = (data: any) => {
    events.push({ type: 'kernel_attached', data });
  };
  const kernelDetachedListener = (data: any) => {
    events.push({ type: 'kernel_detached', data });
  };

  agentManager.on(AgentEvents.AGENT_CREATED, createdListener);
  agentManager.on(AgentEvents.AGENT_UPDATED, updatedListener);
  agentManager.on(AgentEvents.AGENT_DESTROYED, destroyedListener);
  agentManager.on(AgentEvents.KERNEL_ATTACHED, kernelAttachedListener);
  agentManager.on(AgentEvents.KERNEL_DETACHED, kernelDetachedListener);

  try {
    // Test agent creation event
    const agentId = await agentManager.createAgent({
      id: "event-test-agent",
      name: "Event Test Agent"
    });

    assert(events.some(e => e.type === 'created' && e.data.agentId === agentId), "Should emit creation event");

    // Test agent update event
    agentManager.updateAgent(agentId, {
      name: "Updated Event Test Agent",
      description: "Updated description"
    });

    assert(events.some(e => e.type === 'updated' && e.data.agentId === agentId), "Should emit update event");

    // Test agent destruction event
    await agentManager.destroyAgent(agentId);

    assert(events.some(e => e.type === 'destroyed' && e.data.agentId === agentId), "Should emit destruction event");

    console.log(`📊 Total events captured: ${events.length}`);
  } finally {
    // Remove event listeners explicitly to prevent leaks
    agentManager.off(AgentEvents.AGENT_CREATED, createdListener);
    agentManager.off(AgentEvents.AGENT_UPDATED, updatedListener);
    agentManager.off(AgentEvents.AGENT_DESTROYED, destroyedListener);
    agentManager.off(AgentEvents.KERNEL_ATTACHED, kernelAttachedListener);
    agentManager.off(AgentEvents.KERNEL_DETACHED, kernelDetachedListener);
    
    // Clean up resources properly to prevent leaks
    await cleanupAgentManager(agentManager);
    await cleanupTestData();
  }
});

// Cleanup after all tests
console.log("🧪 Enhanced Agents module tests completed. Run with: deno test -A --no-check tests/agents_enhanced_test.ts"); 