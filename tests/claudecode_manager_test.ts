/**
 * Tests for AgentManager class
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { exists } from "https://deno.land/std@0.224.0/fs/mod.ts";
import { AgentManager } from "../claudecode/manager.ts";

Deno.test("AgentManager - should create agent with auto-generated directory", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const agent = await manager.createAgent();

  assertExists(agent);
  assertExists(agent.id);
  assertEquals(
    agent.workingDirectory.startsWith("/tmp/test-agents/agent-"),
    true,
  );

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should create agent with custom directory", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const customDir = "/tmp/custom-agent-dir";

  const agent = await manager.createAgent({
    workingDirectory: customDir,
  });

  assertEquals(agent.workingDirectory, customDir);
  assertEquals(await exists(customDir), true);

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should track created agents", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const agent1 = await manager.createAgent();
  const agent2 = await manager.createAgent();

  assertEquals(manager.getAllAgents().length, 2);
  assertEquals(manager.getAgent(agent1.id), agent1);
  assertEquals(manager.getAgent(agent2.id), agent2);

  // Clean up
  await manager.removeAgent(agent1.id);
  await manager.removeAgent(agent2.id);
});

Deno.test("AgentManager - should remove agent", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const agent = await manager.createAgent();
  const agentId = agent.id;

  assertEquals(manager.getAllAgents().length, 1);

  const removed = await manager.removeAgent(agentId);
  assertEquals(removed, true);
  assertEquals(manager.getAllAgents().length, 0);
  assertEquals(manager.getAgent(agentId), undefined);
});

Deno.test("AgentManager - should return false when removing non-existent agent", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const removed = await manager.removeAgent("non-existent-id");
  assertEquals(removed, false);
});

Deno.test("AgentManager - should stop agent", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const agent = await manager.createAgent();

  const stopped = manager.stopAgent(agent.id);
  assertEquals(stopped, true);

  // Agent should still exist after stopping
  assertEquals(manager.getAgent(agent.id), agent);

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should return false when stopping non-existent agent", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const stopped = manager.stopAgent("non-existent-id");
  assertEquals(stopped, false);
});

Deno.test("AgentManager - getInfo should return manager details", async () => {
  const baseDir = "/tmp/test-agents";
  const manager = new AgentManager(baseDir);
  await manager.initialize();

  const agent1 = await manager.createAgent();
  const agent2 = await manager.createAgent();

  const info = await manager.getInfo();

  assertEquals(info.baseDirectory, baseDir);
  assertEquals(info.agentCount, 2);
  assertEquals(info.agents.length, 2);
  assertEquals(info.verified, true);

  // Clean up
  await manager.removeAgent(agent1.id);
  await manager.removeAgent(agent2.id);
});

Deno.test("AgentManager - removeAllAgents should remove all agents", async () => {
  const manager = new AgentManager("/tmp/test-agents-bulk");
  await manager.initialize();

  await manager.createAgent();
  await manager.createAgent();
  await manager.createAgent();

  assertEquals(manager.getAllAgents().length, 3);

  const removedCount = await manager.removeAllAgents();

  assertEquals(removedCount, 3);
  assertEquals(manager.getAllAgents().length, 0);
});

Deno.test("AgentManager - cleanup should remove all agents and base directory", async () => {
  const manager = new AgentManager("/tmp/test-agents-cleanup");
  await manager.initialize();

  await manager.createAgent();
  await manager.createAgent();

  assertEquals(manager.getAllAgents().length, 2);

  await manager.cleanup();

  assertEquals(manager.getAllAgents().length, 0);
  assertEquals(await exists("/tmp/test-agents-cleanup"), false);
});

Deno.test("AgentManager - should handle permission modes", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const agent = await manager.createAgent({
    permissionMode: "acceptEdits",
  });

  assertEquals(agent.getInfo().permissionMode, "acceptEdits");

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should handle allowed tools", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const allowedTools = ["bash", "read"];
  const agent = await manager.createAgent({
    allowedTools: allowedTools,
  });

  const agentInfo = await agent.getInfo();
  assertEquals(agentInfo.allowedTools, allowedTools);

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should create .mcp.json with MCP servers", async () => {
  const manager = new AgentManager("/tmp/test-agents");
  await manager.initialize();

  const mcpServers = [
    {
      name: "test-server",
      url: "http://localhost:8080/mcp",
      transport: "http" as const,
    },
  ];

  const agent = await manager.createAgent({
    mcpServers: mcpServers,
  });

  // Check if .mcp.json was created
  const mcpPath = `${agent.workingDirectory}/.mcp.json`;
  const mcpExists = await exists(mcpPath);
  assertEquals(mcpExists, true);

  // Verify MCP config content
  const mcpConfig = JSON.parse(await Deno.readTextFile(mcpPath));
  assertExists(mcpConfig.mcpServers);
  assertExists(mcpConfig.mcpServers["test-server"]);
  assertEquals(
    mcpConfig.mcpServers["test-server"].url,
    "http://localhost:8080/mcp",
  );
  // Verify it uses "type": "http" format
  assertEquals(
    mcpConfig.mcpServers["test-server"].type,
    "http",
  );

  // Clean up
  await manager.removeAgent(agent.id);
});

Deno.test("AgentManager - should support default MCP servers", async () => {
  const defaultServers = [
    {
      name: "default-server",
      url: "http://localhost:7070/default",
      transport: "http" as const,
    },
  ];

  const manager = new AgentManager({
    baseDirectory: "./agent-workspaces",
    defaultMcpServers: defaultServers,
  });
  await manager.initialize();

  // Create agent without additional servers
  const agent1 = await manager.createAgent();

  // Check .mcp.json has default server
  const mcpConfig1 = JSON.parse(
    await Deno.readTextFile(`${agent1.workingDirectory}/.mcp.json`),
  );
  assertExists(mcpConfig1.mcpServers["default-server"]);
  assertEquals(
    mcpConfig1.mcpServers["default-server"].url,
    "http://localhost:7070/default",
  );

  // Create agent with additional server
  const agent2 = await manager.createAgent({
    mcpServers: [
      {
        name: "agent-server",
        url: "http://localhost:8080/agent",
        transport: "http" as const,
      },
    ],
  });

  // Check .mcp.json has both servers
  const mcpConfig2 = JSON.parse(
    await Deno.readTextFile(`${agent2.workingDirectory}/.mcp.json`),
  );
  assertExists(mcpConfig2.mcpServers["default-server"]);
  assertExists(mcpConfig2.mcpServers["agent-server"]);
  assertEquals(
    mcpConfig2.mcpServers["agent-server"].url,
    "http://localhost:8080/agent",
  );

  // Clean up
  await manager.removeAgent(agent1.id);
  await manager.removeAgent(agent2.id);
});
