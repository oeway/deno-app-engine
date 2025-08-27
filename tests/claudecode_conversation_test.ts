import { Agent } from "../claudecode/agent.ts";
import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("Agent conversation storage", () => {
  // Create agent with test directory
  const agent = new Agent({
    workingDirectory: "/tmp/test-agent-" + Date.now(),
    permissionMode: "bypassPermissions",
  });

  // Initially conversation should be empty
  assertEquals(agent.getConversation().length, 0);
  
  // Simulate adding messages (we can't execute real queries in test)
  // Instead, we'll use the public methods to manipulate conversation
  agent.setConversation([
    { type: "user", data: "Hello", timestamp: Date.now() },
    { 
      type: "agent", 
      data: {
        type: "assistant",
        message: {
          content: "Hi there!"
        }
      }, 
      timestamp: Date.now() 
    },
  ]);
  
  // Verify conversation is stored
  const conversation = agent.getConversation();
  assertEquals(conversation.length, 2);
  assertEquals(conversation[0].type, "user");
  assertEquals(conversation[0].data, "Hello");
  assertEquals(conversation[1].type, "agent");
  assertEquals((conversation[1].data as Record<string, unknown>).type, "assistant");
  
  // Test clearing conversation
  agent.clearConversation();
  assertEquals(agent.getConversation().length, 0);
  
  console.log("✅ Agent conversation storage tests passed");
});

Deno.test("Agent conversation API with Manager", async () => {
  const { AgentManager } = await import("../claudecode/manager.ts");
  
  // Create manager
  const manager = new AgentManager({
    baseDirectory: "/tmp/test-manager-" + Date.now(),
  });
  
  // Create an agent
  const agentInfo = await manager.createAgent({
    permissionMode: "bypassPermissions",
  });
  
  assertExists(agentInfo.id);
  
  // Get the agent
  const agent = manager.getAgent(agentInfo.id);
  assertExists(agent);
  
  // Set some conversation history
  await agent.setConversation([
    { type: "user", data: "Test message", timestamp: Date.now() },
    { 
      type: "agent", 
      data: {
        type: "assistant",
        message: {
          content: "Test response"
        }
      }, 
      timestamp: Date.now() 
    },
  ]);
  
  // Verify we can retrieve it
  const conversation = await agent.getConversation();
  assertEquals(conversation.length, 2);
  assertEquals(conversation[0].data, "Test message");
  assertEquals(((conversation[1].data as Record<string, unknown>).message as Record<string, unknown>).content, "Test response");
  
  // Clean up
  await manager.removeAgent(agentInfo.id);
  
  console.log("✅ Agent conversation API tests passed");
});