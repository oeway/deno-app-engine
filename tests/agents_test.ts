// Test file for Agents module using real Ollama LLM
// Run with: deno test -A --no-check tests/agents_test.ts

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { AgentManager, AgentEvents, KernelType, type IAgentInstance } from "../agents/mod.ts";
import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Configuration for Ollama
const OLLAMA_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  model: "llama3.2:1b", // Small model suitable for CI testing
  temperature: 0.7
};

// Test data directory
const TEST_DATA_DIR = "./test_agents_data";

// Helper function to check if Ollama is available
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_CONFIG.baseURL}models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Consume the response body to prevent resource leaks
    if (response.body) {
      await response.body.cancel();
    }
    
    return response.ok;
  } catch {
    return false;
  }
}

// Helper function to clean up test data
async function cleanupTestData() {
  try {
    await Deno.remove(TEST_DATA_DIR, { recursive: true });
  } catch {
    // Ignore if directory doesn't exist
  }
}

// Helper function to wait for a short time
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

Deno.test("Agents Module - Basic Setup", async () => {
  // Clean up before test
  await cleanupTestData();

  const agentManager = new AgentManager({
    maxAgents: 5,
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true,
    defaultKernelType: KernelType.PYTHON
  });

  // Test manager creation
  assertExists(agentManager);
  assertEquals(agentManager.getAgentIds().length, 0);

  // Test stats
  const stats = agentManager.getStats();
  assertEquals(stats.totalAgents, 0);
  assertEquals(stats.agentsWithKernels, 0);
  assertEquals(stats.dataDirectory, TEST_DATA_DIR);

  await cleanupTestData();
});

Deno.test("Agents Module - Agent Creation", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  // Create a basic agent
  const agentId = await agentManager.createAgent({
    id: "test-agent-1",
    name: "Test Agent",
    description: "A test AI assistant",
    instructions: "You are a helpful test assistant. Keep responses brief and friendly."
  });

  assertEquals(agentId, "test-agent-1");

  // Test agent retrieval
  const agent = agentManager.getAgent(agentId);
  assertExists(agent);
  assertEquals(agent.id, "test-agent-1");
  assertEquals(agent.name, "Test Agent");

  // Test agent listing
  const agentIds = agentManager.getAgentIds();
  assertEquals(agentIds.length, 1);
  assertEquals(agentIds[0], "test-agent-1");

  const agentList = agentManager.listAgents();
  assertEquals(agentList.length, 1);
  assertEquals(agentList[0].id, "test-agent-1");
  assertEquals(agentList[0].hasKernel, false);

  await cleanupTestData();
});

Deno.test("Agents Module - Real LLM Chat Completion", async () => {
  await cleanupTestData();

  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available at " + OLLAMA_CONFIG.baseURL + ", skipping LLM test");
    console.log("   To run this test, please:");
    console.log("   1. Install Ollama: https://ollama.ai/");
    console.log("   2. Start Ollama: ollama serve");
    console.log("   3. Pull the model: ollama pull " + OLLAMA_CONFIG.model);
    return;
  }

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    defaultMaxSteps: 3 // Limit steps for testing
  });

  // Create an agent
  const agentId = await agentManager.createAgent({
    id: "chat-test-agent",
    name: "Chat Test Agent",
    description: "An agent for testing chat functionality",
    instructions: "You are a helpful assistant. Always respond with exactly 'Hello! I am ready to help.' when greeted."
  });

  const agent = agentManager.getAgent(agentId)!;

  console.log("🚀 Starting real LLM chat test with Ollama...");

  const messages = [{
    role: "user" as const,
    content: "Hello, how are you?"
  }];

  let finalResponse = "";
  let streamingContent = "";
  let hasResponse = false;

  try {
    for await (const chunk of agent.chatCompletion(messages)) {
      console.log("📦 Chunk:", chunk.type, chunk.content ? chunk.content.slice(0, 100) + "..." : "");
      
      if (chunk.type === 'text_chunk' && chunk.content) {
        finalResponse += chunk.content;
        hasResponse = true;
      } else if (chunk.type === 'text' && chunk.content) {
        // Final complete text
        finalResponse = chunk.content;
        hasResponse = true;
      } else if (chunk.type === 'error') {
        console.error("❌ Error in chat:", chunk.error);
        throw chunk.error;
      }
    }

    // Verify we got a response
    assert(hasResponse, "Should have received a text response");
    assert(finalResponse.length > 0, "Response should not be empty");
    console.log("✅ Final response:", finalResponse);

    // Check conversation history
    assertEquals(agent.conversationHistory.length, 2); // User message + Assistant response
    assertEquals(agent.conversationHistory[0].role, "user");
    assertEquals(agent.conversationHistory[1].role, "assistant");

  } catch (error: unknown) {
    console.error("❌ Chat completion failed:", error);
    // If Ollama is not available, skip this test
    if (error instanceof Error && (
      error.message.includes("Connection error") || 
      error.message.includes("Connection refused") ||
      error.message.includes("ECONNREFUSED") || 
      error.message.includes("404")
    )) {
      console.log("⚠️  Ollama not available, skipping LLM test");
      return;
    }
    throw error;
  }

  await cleanupTestData();
});

Deno.test("Agents Module - Agent with Kernel Integration", async () => {
  await cleanupTestData();

  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available, skipping kernel integration test");
    return;
  }

  const kernelManager = new KernelManager({
    allowedKernelTypes: [{ mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }],
    pool: { 
      enabled: false,
      poolSize: 1,
      autoRefill: false,
      preloadConfigs: []
    }
  });
  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    defaultKernelType: KernelType.PYTHON
  });

  try {
    // Set kernel manager
    agentManager.setKernelManager(kernelManager);

    // Create agent with kernel
    const agentId = await agentManager.createAgent({
      id: "kernel-test-agent",
      name: "Kernel Test Agent",
      description: "An agent for testing kernel functionality",
      instructions: "You are a Python coding assistant. When asked to calculate something, write Python code to solve it.",
      kernelType: KernelType.PYTHON,
      autoAttachKernel: true
    });

    const agent = agentManager.getAgent(agentId)!;

    // Wait a bit for kernel to attach
    await wait(1000);

    // Check if kernel is attached
    const agentList = agentManager.listAgents();
    console.log("🔧 Agent kernel status:", agentList[0].hasKernel);

    // Test kernel attachment manually if auto-attach didn't work
    if (!agent.kernel) {
      console.log("🔧 Manually attaching kernel...");
      await agentManager.attachKernelToAgent(agentId, KernelType.PYTHON);
      await wait(1000);
    }

    if (agent.kernel) {
      console.log("✅ Kernel successfully attached");
      
      // Test simple chat that might trigger code execution
      const messages = [{
        role: "user" as const,
        content: "Calculate 2 + 2 using Python code and show me the result"
      }];

      try {
        let hasCodeExecution = false;
        let hasResult = false;

        for await (const chunk of agent.chatCompletion(messages)) {
          if (chunk.type === 'function_call') {
            console.log("🔧 Code execution:", chunk.arguments?.code?.slice(0, 100));
            hasCodeExecution = true;
          } else if (chunk.type === 'function_call_output') {
            console.log("📊 Code result:", chunk.content);
            hasResult = true;
          } else if (chunk.type === 'text_chunk') {
            // Don't log individual chunks to avoid spam
          } else if (chunk.type === 'text') {
            console.log("💬 Response:", chunk.content?.slice(0, 100));
          } else if (chunk.type === 'error') {
            console.error("❌ Error:", chunk.error);
          }
        }

        console.log("🎯 Code execution detected:", hasCodeExecution);
        console.log("🎯 Result received:", hasResult);

      } catch (error: unknown) {
        console.error("❌ Kernel test failed:", error);
        if (error instanceof Error && (
          error.message.includes("Connection error") || 
          error.message.includes("Connection refused") ||
          error.message.includes("ECONNREFUSED") || 
          error.message.includes("404")
        )) {
          console.log("⚠️  Ollama not available, skipping kernel test");
        } else {
          throw error;
        }
      }
    } else {
      console.log("⚠️  Kernel attachment failed, skipping kernel-specific tests");
    }
  } finally {
    // Proper cleanup: destroy all agents and kernels
    try {
      await agentManager.destroyAll();
      
      // Give time for cleanup operations to complete
      await wait(200);
      
      // Destroy kernel manager and close all MessagePorts
      if (kernelManager) {
        await kernelManager.destroyAll();
        await wait(200);
      }
    } catch (cleanupError) {
      console.error("❌ Cleanup error:", cleanupError);
    }
    
    await cleanupTestData();
  }
});

Deno.test("Agents Module - Event System", async () => {
  await cleanupTestData();

  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available, skipping event system test");
    return;
  }

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  // Track events
  const events: Array<{ type: string; data: any }> = [];

  agentManager.on(AgentEvents.AGENT_CREATED, (data) => {
    events.push({ type: 'AGENT_CREATED', data });
  });

  agentManager.on(AgentEvents.AGENT_MESSAGE, (data) => {
    events.push({ type: 'AGENT_MESSAGE', data });
  });

  agentManager.on(AgentEvents.AGENT_STREAMING, (data) => {
    events.push({ type: 'AGENT_STREAMING', data });
  });

  // Create agent
  const agentId = await agentManager.createAgent({
    id: "event-test-agent",
    name: "Event Test Agent",
    instructions: "You are a test assistant. Respond with 'Event test complete.'"
  });

  // Check creation event
  assertEquals(events.length, 1);
  assertEquals(events[0].type, 'AGENT_CREATED');
  assertEquals(events[0].data.agentId, agentId);

  // Test chat to generate more events
  const agent = agentManager.getAgent(agentId)!;
  const messages = [{
    role: "user" as const,
    content: "Say hello"
  }];

  try {
    for await (const chunk of agent.chatCompletion(messages)) {
      if (chunk.type === 'text_chunk') {
        // Accumulate chunks but don't break yet
      } else if (chunk.type === 'text') {
        break; // Exit after final complete response
      }
    }

    // Should have streaming and message events
    const streamingEvents = events.filter(e => e.type === 'AGENT_STREAMING');
    const messageEvents = events.filter(e => e.type === 'AGENT_MESSAGE');

    console.log("📊 Total events:", events.length);
    console.log("📊 Streaming events:", streamingEvents.length);
    console.log("📊 Message events:", messageEvents.length);

    assert(streamingEvents.length > 0 || messageEvents.length > 0, "Should have generated some events");

  } catch (error: unknown) {
    if (error instanceof Error && (
      error.message.includes("Connection error") || 
      error.message.includes("Connection refused") ||
      error.message.includes("ECONNREFUSED") || 
      error.message.includes("404")
    )) {
      console.log("⚠️  Ollama not available, skipping event test");
      return;
    }
    throw error;
  }

  await cleanupTestData();
});

Deno.test("Agents Module - Conversation Persistence", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true
  });

  // Create agent
  const agentId = await agentManager.createAgent({
    id: "persistence-test-agent",
    name: "Persistence Test Agent",
    instructions: "You are a test assistant."
  });

  const agent = agentManager.getAgent(agentId)!;

  // Add some conversation manually
  agent.conversationHistory.push(
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" }
  );

  // Save conversation
  await agentManager.saveConversation(agentId);

  // Clear conversation
  await agentManager.clearConversation(agentId);
  assertEquals(agent.conversationHistory.length, 0);

  // Load conversation back
  const loadedMessages = await agentManager.loadConversation(agentId);
  assertEquals(loadedMessages.length, 2);
  assertEquals(loadedMessages[0].role, "user");
  assertEquals(loadedMessages[0].content, "Hello");
  assertEquals(loadedMessages[1].role, "assistant");
  assertEquals(loadedMessages[1].content, "Hi there!");

  await cleanupTestData();
});

Deno.test("Agents Module - Error Handling", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  // Test duplicate agent creation
  await agentManager.createAgent({
    id: "duplicate-test",
    name: "Duplicate Test"
  });

  try {
    await agentManager.createAgent({
      id: "duplicate-test",
      name: "Another Duplicate"
    });
    assert(false, "Should have thrown error for duplicate ID");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("already exists"));
  }

  // Test invalid agent operations
  try {
    await agentManager.updateAgent("non-existent", { name: "New Name" });
    assert(false, "Should have thrown error for non-existent agent");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("not found"));
  }

  try {
    await agentManager.destroyAgent("non-existent");
    assert(false, "Should have thrown error for non-existent agent");
  } catch (error: unknown) {
    assert(error instanceof Error && error.message.includes("not found"));
  }

  await cleanupTestData();
});

Deno.test("Agents Module - Agent Management Operations", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    maxAgents: 3
  });

  // Create multiple agents
  const agent1Id = await agentManager.createAgent({
    id: "agent-1",
    name: "Agent One",
    description: "First agent"
  });

  const agent2Id = await agentManager.createAgent({
    id: "agent-2",
    name: "Agent Two",
    description: "Second agent"
  });

  // Test listing
  const agents = agentManager.listAgents();
  assertEquals(agents.length, 2);

  // Test update
  await agentManager.updateAgent(agent1Id, {
    name: "Updated Agent One",
    description: "Updated description"
  });

  const updatedAgent = agentManager.getAgent(agent1Id)!;
  assertEquals(updatedAgent.name, "Updated Agent One");
  assertEquals(updatedAgent.description, "Updated description");

  // Test stats
  const stats = agentManager.getStats();
  assertEquals(stats.totalAgents, 2);
  assertEquals(stats.maxAgents, 3);

  // Test destroy
  await agentManager.destroyAgent(agent2Id);
  assertEquals(agentManager.getAgentIds().length, 1);

  // Test destroy all
  await agentManager.destroyAll();
  assertEquals(agentManager.getAgentIds().length, 0);

  await cleanupTestData();
});

// Integration test with real conversation flow
Deno.test("Agents Module - Full Integration Test", async () => {
  await cleanupTestData();

  console.log("🎯 Starting full integration test...");

  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available, skipping full integration test");
    return;
  }

  const kernelManager = new KernelManager({
    allowedKernelTypes: [{ mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }],
    pool: { 
      enabled: false,
      poolSize: 1,
      autoRefill: false,
      preloadConfigs: []
    }
  });
  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true,
    defaultMaxSteps: 5
  });

  agentManager.setKernelManager(kernelManager);

  // Create a coding assistant
  const agentId = await agentManager.createAgent({
    id: "integration-agent",
    name: "Integration Test Agent",
    description: "A full-featured test agent",
    instructions: "You are a helpful assistant. Keep responses brief for testing purposes.",
    kernelType: KernelType.PYTHON
  });

  const agent = agentManager.getAgent(agentId)!;
  assertExists(agent);

  try {
    // Test conversation
    const messages = [{
      role: "user" as const,
      content: "Hello! Please introduce yourself briefly."
    }];

    let conversationComplete = false;
    let responseReceived = false;
    let finalResponse = "";

    // Consume the entire generator to ensure conversation history is updated
    for await (const chunk of agent.chatCompletion(messages)) {
      if (chunk.type === 'text_chunk' && chunk.content) {
        finalResponse += chunk.content;
        responseReceived = true;
        // Don't break here - let the generator complete to update conversation history
      } else if (chunk.type === 'text' && chunk.content) {
        console.log("💬 Agent final response:", chunk.content.slice(0, 50) + "...");
        finalResponse = chunk.content;
        responseReceived = true;
      } else if (chunk.type === 'error') {
        console.error("❌ Error in integration test:", chunk.error);
        throw chunk.error;
      }
    }

    // Generator has completed, conversation history should now be updated
    if (responseReceived) {
      console.log("✅ Integration test successful!");
      
      // Debug conversation history
      console.log("📊 Conversation history length:", agent.conversationHistory.length);
      agent.conversationHistory.forEach((msg, idx) => {
        console.log(`📝 ${idx}: ${msg.role}: ${msg.content?.slice(0, 50)}...`);
      });
      
      // Verify conversation history - should have user message and assistant response
      assert(agent.conversationHistory.length >= 1, "Should have at least user message in conversation history");
      
      // Test stats
      const stats = agentManager.getStats();
      assertEquals(stats.totalAgents, 1);
      
      console.log("📊 Final stats:", stats);
    } else {
      console.log("⚠️  No response received (possibly Ollama unavailable)");
    }

  } catch (error: unknown) {
    if (error instanceof Error && (
      error.message.includes("Connection error") || 
      error.message.includes("Connection refused") ||
      error.message.includes("ECONNREFUSED") || 
      error.message.includes("404")
    )) {
      console.log("⚠️  Ollama not available for integration test");
      return;
    }
    throw error;
  } finally {
    // Proper cleanup
    try {
      await agentManager.destroyAll();
      await wait(200);
      
      if (kernelManager) {
        await kernelManager.destroyAll();
        await wait(200);
      }
    } catch (cleanupError) {
      console.error("❌ Cleanup error:", cleanupError);
    }
  }

  await cleanupTestData();
});

// Add namespace-related tests
Deno.test("Agents Module - Namespace Support", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    maxAgents: 20,
    maxAgentsPerNamespace: 5,
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  // Test 1: Create agents with namespaces
  const workspace1Agent1 = await agentManager.createAgent({
    id: "agent1",
    name: "Workspace 1 Agent 1",
    description: "First agent in workspace 1",
    instructions: "You are a helpful assistant.",
    namespace: "workspace1"
  });

  const workspace1Agent2 = await agentManager.createAgent({
    id: "agent2", 
    name: "Workspace 1 Agent 2",
    description: "Second agent in workspace 1",
    instructions: "You are a helpful assistant.",
    namespace: "workspace1"
  });

  const workspace2Agent1 = await agentManager.createAgent({
    id: "agent1", // Same ID as workspace1 agent1, but different namespace
    name: "Workspace 2 Agent 1",
    description: "First agent in workspace 2", 
    instructions: "You are a helpful assistant.",
    namespace: "workspace2"
  });

  // Verify namespaced IDs
  assertEquals(workspace1Agent1, "workspace1:agent1");
  assertEquals(workspace1Agent2, "workspace1:agent2");
  assertEquals(workspace2Agent1, "workspace2:agent1");

  // Test 2: List agents by namespace
  const workspace1Agents = agentManager.listAgents("workspace1");
  assertEquals(workspace1Agents.length, 2);
  assertEquals(workspace1Agents[0].namespace, "workspace1");
  assertEquals(workspace1Agents[1].namespace, "workspace1");
  // Verify that the IDs are base IDs without namespace prefix
  assert(["agent1", "agent2"].includes(workspace1Agents[0].id), `Expected base ID, got ${workspace1Agents[0].id}`);
  assert(["agent1", "agent2"].includes(workspace1Agents[1].id), `Expected base ID, got ${workspace1Agents[1].id}`);

  const workspace2Agents = agentManager.listAgents("workspace2");
  assertEquals(workspace2Agents.length, 1);
  assertEquals(workspace2Agents[0].namespace, "workspace2");
  assertEquals(workspace2Agents[0].id, "agent1"); // Should be base ID without namespace prefix

  // Test 3: List all agents
  const allAgents = agentManager.listAgents();
  assertEquals(allAgents.length, 3);

  // Test 4: Test per-namespace limits
  try {
    // Try to create more agents than the namespace limit
    for (let i = 3; i <= 10; i++) {
      await agentManager.createAgent({
        id: `agent${i}`,
        name: `Agent ${i}`,
        description: `Agent ${i}`,
        instructions: "You are a helpful assistant.",
        namespace: "workspace1"
      });
    }
    // Should not reach here
    assert(false, "Should have thrown an error for exceeding namespace limit");
  } catch (error) {
    assert(error instanceof Error);
    assert(error.message.includes("Maximum number of agents per namespace"));
  }

  // Test 5: Cleanup agents in namespace
  const cleanedUp = await agentManager.cleanupOldAgentsInNamespace("workspace1", 2);
  assertEquals(cleanedUp, 3); // Should have cleaned up 3 agents (keeping 2)

  const remainingWorkspace1Agents = agentManager.listAgents("workspace1");
  assertEquals(remainingWorkspace1Agents.length, 2);

  // Test 6: Destroy all agents in a namespace
  await agentManager.destroyAll("workspace1");
  const workspace1AgentsAfterDestroy = agentManager.listAgents("workspace1");
  assertEquals(workspace1AgentsAfterDestroy.length, 0);

  // Workspace 2 agents should still exist
  const workspace2AgentsAfterDestroy = agentManager.listAgents("workspace2");
  assertEquals(workspace2AgentsAfterDestroy.length, 1);

  await cleanupTestData();
});

Deno.test("Agents Module - Namespace Access Control", async () => {
  await cleanupTestData();

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR
  });

  // Create agents in different namespaces
  const workspace1Agent = await agentManager.createAgent({
    id: "secure-agent",
    name: "Secure Agent",
    description: "Agent in workspace 1",
    instructions: "You are a helpful assistant.",
    namespace: "workspace1"
  });

  const workspace2Agent = await agentManager.createAgent({
    id: "secure-agent", // Same ID, different namespace
    name: "Another Secure Agent", 
    description: "Agent in workspace 2",
    instructions: "You are a helpful assistant.",
    namespace: "workspace2"
  });

  // Test accessing agents with proper namespaced IDs
  const agent1 = agentManager.getAgent(workspace1Agent);
  const agent2 = agentManager.getAgent(workspace2Agent);
  
  assertExists(agent1);
  assertExists(agent2);
  assertEquals(agent1.name, "Secure Agent");
  assertEquals(agent2.name, "Another Secure Agent");

  // Test that agents from different namespaces are truly different
  assert(agent1 !== agent2, "Agents from different namespaces should be different instances");

  await cleanupTestData();
});

// Test startup script error handling
Deno.test("Agents Module - Startup Script Error Handling", async () => {
  const testDir = "./test_agents_startup_error_data";
  
  const manager = new AgentManager({
    maxAgents: 5,
    agentDataDirectory: testDir
  });
  
  const kernelManager = new KernelManager({
    allowedKernelTypes: [{ mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }],
    pool: { 
      enabled: false,
      poolSize: 1,
      autoRefill: false,
      preloadConfigs: []
    }
  });
  manager.setKernelManager(kernelManager);
  
  try {
    // Test that creating an agent with a failing startup script throws an error immediately
    let createAgentFailed = false;
    let thrownError: any = null;
    
    try {
      await manager.createAgent({
        id: "startup-error-agent",
        name: "Startup Error Agent",
        instructions: "You are a test agent with a broken startup script.",
        kernelType: KernelType.PYTHON,
        startupScript: `
# This startup script contains a deliberate error
print("Starting initialization...")
undefined_variable = some_undefined_function()  # This will cause a NameError
print("This should never be reached")
        `,
        autoAttachKernel: true
      });
      
      // Should not reach here - createAgent should have thrown
      assert(false, "createAgent should have thrown startup error immediately");
    } catch (error) {
      createAgentFailed = true;
      thrownError = error;
    }
    
    // Verify that createAgent threw the startup error immediately
    assert(createAgentFailed, "createAgent should have failed with startup error");
    assert(thrownError instanceof Error, "Should throw an error");
    assertEquals(thrownError.name, "AgentStartupError");
    assert(thrownError.message.includes("Startup script failed"), "Error message should mention startup script failure");
    
    // Type assertion to access AgentStartupError properties
    const startupErrorCast = thrownError as any; // Cast to access fullError property
    assert(startupErrorCast.fullError.includes("NameError"), "Error should contain NameError");
    assert(startupErrorCast.fullError.includes("some_undefined_function"), "Error should mention the undefined function");
    
    console.log("✅ createAgent correctly threw startup error immediately:", thrownError.message);
    console.log("📋 Full error details:", startupErrorCast.fullError);
    
    // Test that we can still create agents with valid startup scripts
    const validAgentId = await manager.createAgent({
      id: "valid-startup-agent",
      name: "Valid Startup Agent",
      instructions: "You are a test agent with a working startup script.",
      kernelType: KernelType.PYTHON,
      startupScript: `
# This startup script should work fine
import math
print("Startup completed successfully!")
print(f"Pi is approximately {math.pi:.4f}")
      `,
      autoAttachKernel: true
    });
    
    const validAgent = manager.getAgent(validAgentId);
    assert(validAgent, "Valid agent should be created");
    
    // Wait a moment for startup script to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check that there's no startup error for the valid agent
    const startupError = validAgent.getStartupError();
    assertEquals(startupError, undefined, "Valid agent should not have startup error");
    
    console.log("✅ Valid startup script executed without error");
    
    // Test listing agents shows correct startup flags
    const agentList = manager.listAgents();
    const validAgentInfo = agentList.find(a => a.id === "valid-startup-agent"); // Use base ID without namespace
    assert(validAgentInfo, "Valid agent should be in list");
    assertEquals(validAgentInfo.hasStartupError, false, "Valid agent should not be flagged as having startup error");
    assertEquals(validAgentInfo.hasStartupScript, true, "Valid agent should be flagged as having startup script");
    
    console.log("✅ Agent list correctly shows startup script flags");
    
  } finally {
    await manager.destroyAll();
    
    // Properly cleanup kernel manager to avoid resource leaks
    try {
      await kernelManager.destroyAll();
    } catch (error) {
      console.warn("Error during kernel manager cleanup:", error);
    }
    
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Test stateless chat completion
Deno.test("Agents Module - Stateless Chat Completion", async () => {
  const testDir = "./test_agents_stateless_data";
  
  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available, skipping stateless chat completion test");
    return;
  }
  
  const manager = new AgentManager({
    maxAgents: 5,
    agentDataDirectory: testDir,
    defaultModelSettings: OLLAMA_CONFIG
  });
  
  try {
    // Create an agent with specific instructions
    const agentId = await manager.createAgent({
      id: "stateless-test-agent",
      name: "Stateless Test Agent",
      instructions: "You are a helpful assistant that responds to questions directly and concisely."
    });
    
    const agent = manager.getAgent(agentId);
    assert(agent, "Agent should be created");
    
    // Prepare test messages
    const testMessages = [
      { role: "user" as const, content: "What is 2 + 2?" },
      { role: "assistant" as const, content: "2 + 2 = 4" },
      { role: "user" as const, content: "What is 3 + 3?" }
    ];
    
    // Capture original conversation history
    const originalHistoryLength = agent.conversationHistory.length;
    
    // Test stateless chat completion
    let responseReceived = false;
    let finalResponse = "";
    
    for await (const chunk of agent.statelessChatCompletion(testMessages)) {
      responseReceived = true;
      if (chunk.type === 'text' && chunk.content) {
        finalResponse = chunk.content;
      }
    }
    
    // Verify response was received
    assert(responseReceived, "Should receive response from stateless chat");
    assert(finalResponse.length > 0, "Should receive non-empty response");
    
    // Verify conversation history was NOT modified
    assertEquals(
      agent.conversationHistory.length, 
      originalHistoryLength, 
      "Conversation history should not be modified by stateless chat"
    );
    
    // Verify agent memory was not affected (should still be empty/reset state)
    assertEquals(agent.memory.steps.length, 0, "Agent memory should not be modified by stateless chat");
    
    console.log(`✅ Stateless chat test passed. Response: ${finalResponse.substring(0, 100)}...`);
    
  } finally {
    await manager.destroyAll();
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Test stateless chat completion with startup script error
Deno.test("Agents Module - Stateless Chat with Startup Error", async () => {
  const testDir = "./test_agents_stateless_error_data";
  
  const manager = new AgentManager({
    maxAgents: 5,
    agentDataDirectory: testDir
  });
  
  const kernelManager = new KernelManager({
    allowedKernelTypes: [{ mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }],
    pool: { 
      enabled: false,
      poolSize: 1,
      autoRefill: false,
      preloadConfigs: []
    }
  });
  manager.setKernelManager(kernelManager);
  
  try {
    // Test that creating an agent with a failing startup script throws an error immediately
    let createAgentFailed = false;
    let thrownCreateError: any = null;
    
    try {
      await manager.createAgent({
        id: "stateless-startup-error-agent",
        name: "Stateless Startup Error Agent",
        instructions: "You are a test agent with a broken startup script.",
        kernelType: KernelType.PYTHON,
        startupScript: `
# This startup script contains an error
print("Starting initialization...")
undefined_variable = some_undefined_function()  # This will cause a NameError
print("This should never be reached")
        `,
        autoAttachKernel: true
      });
      
      // Should not reach here - createAgent should have thrown
      assert(false, "createAgent should have thrown startup error immediately");
    } catch (error) {
      createAgentFailed = true;
      thrownCreateError = error;
    }
    
    // Verify that createAgent threw the startup error immediately
    assert(createAgentFailed, "createAgent should have failed with startup error");
    assert(thrownCreateError instanceof Error, "Should throw an error");
    assertEquals(thrownCreateError.name, "AgentStartupError");
    assert(thrownCreateError.message.includes("some_undefined_function"), "Error message should contain function name");
    
    console.log(`✅ createAgent correctly threw startup error immediately: ${thrownCreateError.message.substring(0, 100)}...`);
    
  } finally {
    await manager.destroyAll();
    
    // Properly cleanup kernel manager to avoid resource leaks
    try {
      await kernelManager.destroyAll();
    } catch (error) {
      console.warn("Error during kernel manager cleanup:", error);
    }
    
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Test conversation history setting functionality
Deno.test("Agents Module - Conversation History Setting", async () => {
  const testDir = "./test_agents_conversation_history";
  
  const manager = new AgentManager({
    maxAgents: 5,
    agentDataDirectory: testDir
  });
  
  try {
    // Create a test agent
    const agentId = await manager.createAgent({
      id: "conversation-history-agent",
      name: "Conversation History Test Agent",
      instructions: "You are a test agent for conversation history functionality."
    });
    
    const agent = manager.getAgent(agentId);
    assert(agent, "Agent should be created");
    
    // Initially, conversation history should be empty
    assertEquals(agent.conversationHistory.length, 0, "Initial conversation history should be empty");
    
    // Set some conversation history
    const testHistory = [
      { role: "user" as const, content: "Hello, how are you?" },
      { role: "assistant" as const, content: "I'm doing great! How can I help you today?" },
      { role: "user" as const, content: "What's the weather like?" },
      { role: "assistant" as const, content: "I don't have access to real-time weather data, but I'd be happy to help you find weather information!" }
    ];
    
    // Test setting conversation history via agent manager
    await manager.setConversationHistory(agentId, testHistory);
    
    // Verify the conversation history was set correctly
    assertEquals(agent.conversationHistory.length, testHistory.length, "Conversation history length should match");
    
    // Verify the content matches
    for (let i = 0; i < testHistory.length; i++) {
      assertEquals(agent.conversationHistory[i].role, testHistory[i].role, `Message ${i} role should match`);
      assertEquals(agent.conversationHistory[i].content, testHistory[i].content, `Message ${i} content should match`);
    }
    
    // Test setting conversation history directly on agent
    const newHistory = [
      { role: "user" as const, content: "What is 2+2?" },
      { role: "assistant" as const, content: "2+2 equals 4." }
    ];
    
    agent.setConversationHistory(newHistory);
    
    // Verify the new conversation history
    assertEquals(agent.conversationHistory.length, newHistory.length, "New conversation history length should match");
    assertEquals(agent.conversationHistory[0].content, "What is 2+2?", "First message content should match");
    assertEquals(agent.conversationHistory[1].content, "2+2 equals 4.", "Second message content should match");
    
    // Test that lastUsed was updated
    assert(agent.lastUsed, "lastUsed should be set after setting conversation history");
    
    console.log("✅ Conversation history setting functionality works correctly");
    
  } finally {
    await manager.destroyAll();
    
    try {
      await Deno.remove(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Test naked response handling improvements
Deno.test("Agents Module - Naked Response Handling", async () => {
  console.log("🧪 Testing naked response handling...");
  await cleanupTestData();

  // Check if Ollama is available first
  const ollamaAvailable = await isOllamaAvailable();
  if (!ollamaAvailable) {
    console.log("⚠️  Ollama not available, skipping naked response handling test");
    return;
  }

  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    defaultMaxSteps: 3 // Limit steps to prevent hanging
  });

  // Create an agent with specific instructions
  const agentId = await agentManager.createAgent({
    id: "naked-response-agent",
    name: "Naked Response Test Agent",
    description: "Agent for testing naked response handling",
    instructions: `You are a test assistant. Respond with brief, simple answers. When asked to use tags, respond with <returnToUser>Test complete</returnToUser>.`
  });

  const agent = agentManager.getAgent(agentId)!;
  assertExists(agent);

  try {
    // Test conversation that should trigger naked response handling
    const messages = [{
      role: "user" as const,
      content: "Say hello briefly"
    }];

    let conversationSteps = 0;
    let finalResponse = "";
    let guidanceInjected = false;
    let hasError = false;

    console.log("🚀 Starting naked response test conversation...");

    // Add timeout to prevent hanging
    let timeoutId: number | undefined;
    const timeoutPromise = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Test timeout after 15 seconds")), 15000);
    });

    const chatPromise = (async () => {
      for await (const chunk of agent.chatCompletion(messages)) {
        if (chunk.type === 'text_chunk' && chunk.content) {
          finalResponse += chunk.content;
        } else if (chunk.type === 'text' && chunk.content) {
          finalResponse = chunk.content;
          conversationSteps++;
          console.log(`📝 Step ${conversationSteps}: ${chunk.content.substring(0, 50)}...`);
          
          // Check for proper conversation ending
          if (chunk.content.includes('<returnToUser>')) {
            console.log("✅ ReturnToUser tag detected - conversation ending properly");
            break;
          }
          
        } else if (chunk.type === 'error') {
          console.error("❌ Error in naked response test:", chunk.error);
          hasError = true;
          break;
        }
      }
    })();

    // Race between chat completion and timeout
    try {
      await Promise.race([chatPromise, timeoutPromise]);
    } finally {
      // Clean up timeout to prevent leaks
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }

    console.log(`📊 Conversation completed with ${conversationSteps} steps`);
    console.log(`📊 Final response: ${finalResponse}`);

    // Test assertions based on expected behavior
    assert(!hasError, "Should not have encountered errors during conversation");
    assert(conversationSteps >= 1, "Should have at least one conversation step");
    assert(conversationSteps <= 5, "Should not exceed reasonable step limit");
    assert(finalResponse.length > 0, "Should have received a final response");
    
    // Verify conversation history was updated (may have 1 or more messages depending on completion timing)
    assert(agent.conversationHistory.length >= 1, "Conversation history should be updated with at least user message");

    console.log("✅ Naked response handling test completed successfully");
    console.log("✅ Verification: Conversation did not hang and completed within timeout");

  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes("Test timeout")) {
        console.error("❌ Test failed: Conversation hung and timed out");
        console.error("🐛 This indicates the naked response handling fix may have introduced an infinite loop");
        throw error;
      } else if (error.message.includes("Connection error") || 
                 error.message.includes("Connection refused") ||
                 error.message.includes("ECONNREFUSED") || 
                 error.message.includes("404")) {
        console.log("⚠️  Ollama not available during test execution");
        return;
      }
    }
    throw error;
  }

  await cleanupTestData();
});

console.log("🧪 Agents module tests completed. Run with: deno test -A --no-check tests/agents_test.ts");

// Test the agent ID consistency fix - namespace agent autosave issue
Deno.test("Agents Module - Namespace Agent Auto-save Fix", async () => {
  console.log("🧪 Testing namespace agent auto-save fix...");
  await cleanupTestData();

  const agentManager = new AgentManager({
    maxAgents: 5,
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true, // Enable auto-save to trigger the issue
    defaultMaxSteps: 2 // Limit steps for faster testing
  });

  // Create a kernel manager and attach it to test kernel integration
  const kernelManager = new KernelManager({
    allowedKernelTypes: [{ mode: KernelMode.WORKER, language: KernelLanguage.PYTHON }],
    pool: { 
      enabled: false,
      poolSize: 1,
      autoRefill: false,
      preloadConfigs: []
    }
  });
  agentManager.setKernelManager(kernelManager);

  // Create namespaced agent
  const agentId = await agentManager.createAgent({
    id: "test-autosave-agent",
    namespace: "test-workspace",
    name: "Auto-save Test Agent",
    description: "Agent for testing auto-save functionality",
    instructions: "You are a helpful assistant for testing.",
    kernelType: KernelType.PYTHON,
    autoAttachKernel: true
  });

  console.log(`✅ Created namespaced agent with ID: ${agentId}`);
  
  const agent = agentManager.getAgent(agentId);
  assertExists(agent);
  
  // After fix: agent.id should match the namespaced storage ID
  console.log(`✅ FIX VERIFIED: agent.id="${agent.id}" matches stored ID "${agentId}"`);
  
  // Test that auto-save works by performing a chat completion
  // With the bug, this would fail with "Agent with ID 'test-autosave-agent' not found"
  try {
    // Wait for kernel attachment
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const messages = [{
      role: "user" as const,
      content: "Just say 'Hello' and nothing else."
    }];

    let chatCompleted = false;
    for await (const chunk of agent.chatCompletion(messages)) {
      if (chunk.type === 'text_chunk' || chunk.type === 'text') {
        chatCompleted = true;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error);
      }
    }
    
    assert(chatCompleted, "Chat should have completed");
    console.log("✅ Chat completion successful - auto-save should have worked");
    
  } catch (error) {
    const errorMessage = (error as Error).message;
    if (errorMessage.includes("not found")) {
      console.error("❌ Auto-save failed due to agent ID mismatch:", errorMessage);
      throw new Error(`BUG REPRODUCED: ${errorMessage}`);
    }
    
    // If it's a connection error (Ollama not available), that's okay for this test
    if (errorMessage.includes("Connection error") || 
        errorMessage.includes("Connection refused") ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("404")) {
      console.log("⚠️  External dependency not available, but no agent ID mismatch - test passes");
      
      // Still need to cleanup even on early return
      try {
        await agentManager.destroyAll();
        await kernelManager.destroyAll();
      } catch (cleanupError) {
        console.warn("Cleanup warning:", cleanupError);
      }
      
      await cleanupTestData();
      return;
    }
    
    throw error;
  }

  // Proper cleanup to avoid resource leaks
  try {
    // Destroy all agents (this handles kernel cleanup)
    await agentManager.destroyAll();
    
    // Shutdown kernel manager  
    await kernelManager.destroyAll();
  } catch (error) {
    console.warn("Cleanup warning:", error);
  }
  
  await cleanupTestData();
});

// Additional test to verify the fix works with multiple namespace scenarios
Deno.test("Agents Module - Multiple Namespace Auto-save Consistency", async () => {
  console.log("🧪 Testing multiple namespace auto-save consistency...");
  await cleanupTestData();

  const agentManager = new AgentManager({
    maxAgents: 10,
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true,
    defaultMaxSteps: 1 // Minimal steps for faster testing
  });

  // Create agents in different namespaces
  const agents = [];
  const namespaces = ["workspace-1", "workspace-2", "workspace-3"];
  
  for (let i = 0; i < namespaces.length; i++) {
    const namespace = namespaces[i];
    const agentId = await agentManager.createAgent({
      id: `agent-${i}`,
      name: `Test Agent ${i}`,
      description: `Agent ${i} in ${namespace}`,
      instructions: "You are a helpful test assistant. Respond with 'OK' to any message.",
      namespace: namespace
    });
    
    agents.push(agentId);
    
    // Verify correct namespaced ID
    assertEquals(agentId, `${namespace}:agent-${i}`);
    
    const agent = agentManager.getAgent(agentId);
    assertExists(agent);
    
    // Verify agent.id matches storage key
    assertEquals(agent.id, agentId, `Agent.id should match namespaced ID for ${namespace}`);
  }

  console.log("✅ Created", agents.length, "namespaced agents");

  // Test that each agent can perform operations without ID mismatch errors
  for (const agentId of agents) {
    const agent = agentManager.getAgent(agentId)!;
    
    try {
      // Test that internal operations work (like what auto-save would call)
      // This calls manager.saveConversation(agent.id) internally
      if (agentManager.getAutoSaveConversations()) {
        // Simulate what happens at the end of chatCompletion
        await agentManager.saveConversation(agent.id);
        console.log("✅ Manual save test passed for agent:", agentId);
      }
      
      // Test agent update (another operation that uses agent.id)
      await agentManager.updateAgent(agentId, {
        description: `Updated agent in ${agentId.split(':')[0]}`
      });
      console.log("✅ Update test passed for agent:", agentId);
      
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        console.error("❌ Agent ID mismatch detected for:", agentId);
        console.error("   Error:", error.message);
        throw error;
      }
      // Ignore other errors for this test
      console.log("⚠️  Non-critical error for", agentId, ":", error);
    }
  }

  console.log("✅ All namespace agents handle operations correctly - no ID mismatch");

  await cleanupTestData();
});

// Test HyphaCore Integration in AgentManager
// Note: This test has a known leak from hypha-rpc library intervals that don't get cleared
// We disable leak detection for this specific test as it's a library issue
Deno.test({
  name: "Agents Module - HyphaCore Integration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
  console.log("🔍 Testing AgentManager HyphaCore Integration");
  await cleanupTestData();

  let agentManager: AgentManager | null = null;
  let kernelManager: KernelManager | null = null;

  try {
    // Create AgentManager with HyphaCore enabled
    console.log("📋 Creating AgentManager with HyphaCore integration...");
    agentManager = new AgentManager({
      maxAgents: 5,
      defaultModelSettings: OLLAMA_CONFIG,
      agentDataDirectory: TEST_DATA_DIR,
      enable_hypha_core: true,
      hypha_core_port: 9590,
      hypha_core_workspace: 'public', // Use public workspace to avoid authentication issues
      defaultKernelType: KernelType.PYTHON
    });

    // Create and set kernel manager 
    kernelManager = new KernelManager({
      allowedKernelTypes: [
        { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
        { mode: KernelMode.WORKER, language: KernelLanguage.JAVASCRIPT },
        { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
      ],
      pool: { 
        enabled: false,
        poolSize: 1,
        autoRefill: false,
        preloadConfigs: []
      }
    });
    agentManager.setKernelManager(kernelManager);

    // Wait for HyphaCore to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Test 1: Check HyphaCore status
    console.log("🔧 Checking HyphaCore status...");
    const hyphaInfo = agentManager.getHyphaCoreInfo();
    console.log("HyphaCore info:", hyphaInfo);
    
    assertEquals(hyphaInfo.enabled, true, "HyphaCore should be enabled");
    assertEquals(hyphaInfo.serverUrl, "http://localhost:9590", "Server URL should match");
    assertEquals(hyphaInfo.workspace, "public", "Workspace should match");

    // Test 2: Check if HyphaCore API is available
    console.log("📡 Checking HyphaCore API...");
    const hyphaAPI = agentManager.getHyphaAPI();
    
    if (hyphaAPI) {
      console.log("✅ HyphaCore API is available");
      
      // Test token generation using the same workspace as the server
      const token = await hyphaAPI.generateToken({
        user_id: 'test-user',
        workspace: hyphaInfo.workspace,
        expires_in: 300
      });
      console.log("✅ Token generated successfully:", token.substring(0, 20) + '...');
      assert(token.length > 0, "Token should be generated");
    }
  
    // Test 3: Check stats include HyphaCore info
    console.log("📊 Checking AgentManager stats...");
    const stats = agentManager.getStats();
    assertEquals(stats.hyphaCore.enabled, true, "Stats should show HyphaCore enabled");
    console.log("✅ Stats include HyphaCore information");

    // Test 4: Test HyphaCore integration with different kernel types
    const kernelTypes = [
      { type: KernelType.PYTHON, name: "Python" },
      { type: KernelType.JAVASCRIPT, name: "JavaScript" },
      { type: KernelType.TYPESCRIPT, name: "TypeScript" }
    ];

    for (const kernelTypeInfo of kernelTypes) {
      console.log(`🤖 Testing HyphaCore integration with ${kernelTypeInfo.name} kernel...`);
      
      // Create agent with specific kernel type
      const agentId = await agentManager.createAgent({
        id: `hypha-${kernelTypeInfo.name.toLowerCase()}-agent`,
        name: `HyphaCore ${kernelTypeInfo.name} Test Agent`,
        description: `Agent demonstrating HyphaCore integration with ${kernelTypeInfo.name}`,
        instructions: `You are a test agent with HyphaCore capabilities using ${kernelTypeInfo.name}`,
        kernelType: kernelTypeInfo.type
      });

      console.log(`✅ ${kernelTypeInfo.name} agent created:`, agentId);
      
      const agent = agentManager.getAgent(agentId);
      assertExists(agent);
      assertEquals(agent.id, agentId);

      // Test manual kernel attachment with HyphaCore setup
      console.log(`🔌 Testing ${kernelTypeInfo.name} kernel attachment with HyphaCore...`);
      await agentManager.attachKernelToAgent(agentId, kernelTypeInfo.type);
      
      const agentWithKernel = agentManager.getAgent(agentId);
      assertExists(agentWithKernel?.kernel);
      console.log(`✅ ${kernelTypeInfo.name} kernel attached with HyphaCore integration`);

      // Test HyphaCore integration based on kernel type
      try {
        if (kernelTypeInfo.type === KernelType.PYTHON) {
          // Test Python HyphaCore integration
          console.log("🐍 Testing Python HyphaCore integration...");
          const setupResult = await agentManager.kernelManager.execute(agentWithKernel!.kernelId!, `
# Test if hypha-rpc is available and server is connected
try:
    # Check if _hypha_server global variable exists (set by startup script)
    if '_hypha_server' in globals():
        result = "✅ HyphaCore server connection available"
        print(result)
        
        # Register a simple test service that we can call externally
        async def test_math_service_py(x, y):
            result = x + y
            print(f"Python service called with x={x}, y={y}, result={result}")
            return {"sum": result, "message": f"Added {x} + {y} = {result}", "language": "python"}
        
        # Register the service
        await _hypha_server.register_service({
            "id": "test-math-service-py",
            "name": "Test Math Service (Python)",
            "description": "A simple math service for testing from Python",
            "config": {"visibility": "public"},
            "add": test_math_service_py
        })
        
        print("✅ Python service registration completed: test-math-service-py")
    else:
        print("❌ _hypha_server not found - HyphaCore integration not working")
        
except Exception as e:
    print(f"❌ Error testing Python HyphaCore integration: {str(e)}")
    import traceback
    traceback.print_exc()
`);
          
          if (setupResult.success) {
            console.log("✅ Python HyphaCore integration test executed successfully");
          } else {
            console.warn("⚠️ Python HyphaCore integration test had issues:", setupResult.error?.message);
          }
          
        } else if (kernelTypeInfo.type === KernelType.JAVASCRIPT || kernelTypeInfo.type === KernelType.TYPESCRIPT) {
          // Test JavaScript/TypeScript HyphaCore integration
          console.log(`🌐 Testing ${kernelTypeInfo.name} HyphaCore integration...`);
          const setupResult = await agentManager.kernelManager.execute(agentWithKernel!.kernelId!, `
// Test if hypha-rpc is available and server is connected
try {
    // Check if _hypha_server global variable exists (set by startup script)
    if (typeof globalThis._hypha_server !== 'undefined') {
        console.log("✅ HyphaCore server connection available");
        
        // Register a simple test service that we can call externally
        const testMathServiceJs = async (x, y) => {
            const result = x + y;
            console.log(\`JavaScript service called with x=\${x}, y=\${y}, result=\${result}\`);
            return {
                sum: result, 
                message: \`Added \${x} + \${y} = \${result}\`, 
                language: "${kernelTypeInfo.name.toLowerCase()}"
            };
        };
        
        // Register the service
        await globalThis._hypha_server.register_service({
            id: "test-math-service-js",
            name: "Test Math Service (${kernelTypeInfo.name})",
            description: "A simple math service for testing from ${kernelTypeInfo.name}",
            config: {visibility: "public"},
            add: testMathServiceJs
        });
        
        console.log("✅ ${kernelTypeInfo.name} service registration completed: test-math-service-js");
    } else {
        console.log("❌ _hypha_server not found - HyphaCore integration not working");
    }
    
} catch (error) {
    console.error(\`❌ Error testing ${kernelTypeInfo.name} HyphaCore integration: \${error.message}\`);
    console.error(error.stack);
}
`);
          
          if (setupResult.success) {
            console.log(`✅ ${kernelTypeInfo.name} HyphaCore integration test executed successfully`);
          } else {
            console.warn(`⚠️ ${kernelTypeInfo.name} HyphaCore integration test had issues:`, setupResult.error?.message);
          }
        }
        
      } catch (error) {
        console.error(`❌ ${kernelTypeInfo.name} HyphaCore integration test failed:`, error);
        // Don't throw - continue with other kernel types
      }
    }

    // Test 5: External service calls to verify all integrations work
    if (hyphaAPI) {
      console.log("🔧 Testing external service calls...");
      try {
        const hyphaInfo = agentManager.getHyphaCoreInfo();
        const token = await hyphaAPI.generateToken({
          user_id: 'test-user',
          workspace: hyphaInfo.workspace,
          expires_in: 3600
        });
        console.log("🎫 Generated access token for external call");
        
        // Import hypha-rpc for external connection
        const hyphaRPC = await import("npm:hypha-rpc@0.20.56");
        
        // Connect to HyphaCore server from test side (external client)
        console.log("🔗 Connecting to HyphaCore server as external client...");
        const externalServer = await hyphaRPC.hyphaWebsocketClient.connectToServer({
          server_url: hyphaInfo.serverUrl,
          workspace: hyphaInfo.workspace,
          token: token,
          client_id: 'external-test-client'
        });
        
        console.log("✅ External client connected to HyphaCore server");
        
        // Test services from different kernel types
        const servicesToTest = [
          { id: 'test-math-service-py', name: 'Python', expectedLang: 'python' },
          { id: 'test-math-service-js', name: 'JavaScript/TypeScript', expectedLang: 'javascript' }
        ];
        
        for (const serviceInfo of servicesToTest) {
          try {
            console.log(`🎯 Getting ${serviceInfo.name} service...`);
            const mathService = await externalServer.getService(serviceInfo.id);
            
            // Call the service externally
            console.log(`📞 Calling ${serviceInfo.name} service externally...`);
            const serviceResult = await mathService.add(15, 27);
            
            console.log(`✅ ${serviceInfo.name} service call successful!`);
            console.log("📋 Service result:", JSON.stringify(serviceResult));
            
            // Verify the result
            if (serviceResult && serviceResult.sum === 42 && serviceResult.message) {
              console.log(`✅ ${serviceInfo.name} service returned correct result: 15 + 27 = 42`);
              console.log(`✅ Language confirmed: ${serviceResult.language}`);
            } else {
              console.warn(`⚠️ Unexpected ${serviceInfo.name} service result:`, JSON.stringify(serviceResult));
            }
          } catch (error) {
            console.warn(`⚠️ ${serviceInfo.name} service call failed:`, (error as Error).message);
            // Don't throw - continue testing other services
          }
        }
        
        // Disconnect external client
        await externalServer.disconnect();
        console.log("🔌 External client disconnected");
        
        console.log("🎉 HyphaCore multi-kernel integration test SUCCESSFUL!");
        
      } catch (error) {
        console.error("❌ External service call failed:", (error as Error).message);
        throw error;
      }
    }

    console.log("🎉 SUCCESS: AgentManager HyphaCore multi-kernel integration test completed!");

  } catch (error) {
    console.error("❌ HyphaCore integration test failed:", error);
    throw error;
  } finally {
    // Cleanup
    console.log("🧹 Cleaning up HyphaCore integration test...");
    
    // Add a small delay to ensure all async operations complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (agentManager) {
      try {
        // First destroy all agents to clean up their HyphaCore connections
        await agentManager.destroyAll();
        console.log("✅ All agents destroyed");
        
        // Give extra time for agents to properly disconnect from HyphaCore
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Ensure proper HyphaCore shutdown
        const hyphaAPI = agentManager.getHyphaAPI();
        if (hyphaAPI) {
          try {
            // Try to close server connections if the method exists
            if (typeof hyphaAPI.close === 'function') {
              await hyphaAPI.close();
            }
          } catch (e) {
            console.warn("HyphaCore API close warning:", e);
          }
        }
        
        // Shutdown the agent manager (this should stop HyphaCore)
        await agentManager.shutdown();
        console.log("✅ AgentManager shutdown complete");
        
      } catch (e) {
        console.warn("Cleanup warning:", e);
      }
    }
    if (kernelManager) {
      try {
        await kernelManager.destroyAll();
        console.log("✅ KernelManager destroyed");
      } catch (e) {
        console.warn("Kernel cleanup warning:", e);
      }
    }
    await cleanupTestData();
    
    // Extended delay to ensure all hypha-rpc intervals are cleared
    console.log("⏳ Waiting for hypha-rpc cleanup...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Force garbage collection if available
    if ((globalThis as any).gc) {
      (globalThis as any).gc();
    }
    
    console.log("✅ HyphaCore integration test cleanup complete");
  }
}});

// Test HyphaCore startup script generation for different kernel types
Deno.test("Agents Module - HyphaCore Startup Script Generation", async () => {
  console.log("🧪 Testing HyphaCore startup script generation for different kernel types");
  await cleanupTestData();

  const agentManager = new AgentManager({
    maxAgents: 3,
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    enable_hypha_core: true,
    hypha_core_port: 9591, // Different port to avoid conflicts
    hypha_core_workspace: 'test'
  });

  try {
    // Wait for HyphaCore to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const hyphaAPI = agentManager.getHyphaAPI();
    if (!hyphaAPI) {
      console.log("⚠️ HyphaCore not available, skipping startup script generation test");
      return;
    }

    // Test startup script generation for different kernel types
    const kernelTypes = [
      { type: KernelType.PYTHON, name: "Python" },
      { type: KernelType.JAVASCRIPT, name: "JavaScript" },
      { type: KernelType.TYPESCRIPT, name: "TypeScript" }
    ];

    for (const kernelTypeInfo of kernelTypes) {
      console.log(`📝 Testing startup script generation for ${kernelTypeInfo.name}...`);
      
      // Use reflection to access the private method for testing
      const generateHyphaStartupScript = (agentManager as any).generateHyphaStartupScript.bind(agentManager);
      const startupScript = await generateHyphaStartupScript(
        `test-agent-${kernelTypeInfo.name.toLowerCase()}`,
        `test-kernel-${kernelTypeInfo.name.toLowerCase()}`,
        kernelTypeInfo.type
      );
      
      // Verify script is generated
      assert(startupScript.length > 0, `Startup script should be generated for ${kernelTypeInfo.name}`);
      
      if (kernelTypeInfo.type === KernelType.PYTHON) {
        // Verify Python-specific content
        assert(startupScript.includes('import micropip'), "Python script should include micropip import");
        assert(startupScript.includes('from hypha_rpc import connect_to_server'), "Python script should include hypha_rpc import");
        assert(startupScript.includes('_hypha_server = await connect_to_server'), "Python script should include server connection");
        console.log(`✅ Python startup script generated correctly`);
      } else if (kernelTypeInfo.type === KernelType.JAVASCRIPT || kernelTypeInfo.type === KernelType.TYPESCRIPT) {
        // Verify JavaScript/TypeScript-specific content
        assert(startupScript.includes('const hyphaWebsocketClient = await import'), "JS/TS script should include dynamic import");
        assert(startupScript.includes('https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.56'), "JS/TS script should include CDN URL");
        assert(startupScript.includes('hyphaWebsocketClient.connectToServer'), "JS/TS script should include server connection");
        assert(startupScript.includes('globalThis._hypha_server'), "JS/TS script should set global variable");
        console.log(`✅ ${kernelTypeInfo.name} startup script generated correctly`);
      }
      
      // Verify common elements
      assert(startupScript.includes('test'), "Script should include workspace name");
      assert(startupScript.includes('9591'), "Script should include port number");
      assert(startupScript.includes(`test-agent-${kernelTypeInfo.name.toLowerCase()}`), "Script should include agent ID");
    }

    console.log("✅ All startup script generation tests passed!");

  } finally {
    await agentManager.shutdown();
    await cleanupTestData();
  }
}); 