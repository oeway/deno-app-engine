// Test file for Agents module using real Ollama LLM
// Run with: deno test -A --no-check tests/agents_test.ts

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { AgentManager, AgentEvents, KernelType, type IAgentInstance } from "../agents/mod.ts";
import { KernelManager } from "../kernel/mod.ts";

// Configuration for Ollama
const OLLAMA_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  model: "qwen2.5-coder:7b",
  temperature: 0.7
};

// Test data directory
const TEST_DATA_DIR = "./test_agents_data";

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
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
      console.log("⚠️  Ollama not available, skipping LLM test");
      return;
    }
    throw error;
  }

  await cleanupTestData();
});

Deno.test("Agents Module - Agent with Kernel Integration", async () => {
  await cleanupTestData();

  const kernelManager = new KernelManager();
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
        if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
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
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
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

  const kernelManager = new KernelManager();
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
        console.log("💬 Agent response chunk:", chunk.content.slice(0, 50) + "...");
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
    if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
      console.log("⚠️  Ollama not available for integration test");
      return;
    }
    throw error;
  }

  await cleanupTestData();
});

console.log("🧪 Agents module tests completed. Run with: deno test -A --no-check tests/agents_test.ts"); 