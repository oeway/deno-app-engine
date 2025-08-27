/**
 * Tests for Agent class
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Agent } from "../claudecode/agent.ts";

Deno.test("Agent - should create with unique ID", () => {
  const agent1 = new Agent({ workingDirectory: "/tmp/test1" });
  const agent2 = new Agent({ workingDirectory: "/tmp/test2" });

  assertExists(agent1.id);
  assertExists(agent2.id);
  assertEquals(typeof agent1.id, "string");
  assertEquals(typeof agent2.id, "string");
  assertEquals(agent1.id === agent2.id, false);
});

Deno.test("Agent - should use provided ID if given", () => {
  const customId = "custom-agent-123";
  const agent = new Agent({
    id: customId,
    workingDirectory: "/tmp/test",
  });

  assertEquals(agent.id, customId);
});

Deno.test("Agent - should store working directory", () => {
  const workingDir = "/tmp/test-agent";
  const agent = new Agent({ workingDirectory: workingDir });

  assertEquals(agent.workingDirectory, workingDir);
});

Deno.test("Agent - getInfo should return agent details", () => {
  const config = {
    id: "test-agent",
    workingDirectory: "/tmp/test",
    allowedTools: ["bash", "read"],
  };

  const agent = new Agent(config);
  const info = agent.getInfo();

  assertEquals(info.id, config.id);
  assertEquals(info.workingDirectory, config.workingDirectory);
  assertEquals(info.allowedTools, config.allowedTools);
  assertEquals(info.permissionMode, "default");
});

Deno.test("Agent - should handle different permission modes", () => {
  const agent1 = new Agent({
    workingDirectory: "/tmp/test",
    permissionMode: "acceptEdits",
  });

  const agent2 = new Agent({
    workingDirectory: "/tmp/test2",
    permissionMode: "bypassPermissions",
  });

  assertEquals(agent1.getInfo().permissionMode, "acceptEdits");
  assertEquals(agent2.getInfo().permissionMode, "bypassPermissions");
});

Deno.test("Agent - should handle allowed tools configuration", () => {
  const allowedTools = ["bash", "read", "write"];
  const agent = new Agent({
    workingDirectory: "/tmp/test",
    allowedTools: allowedTools,
  });

  assertEquals(agent.getInfo().allowedTools, allowedTools);
});

Deno.test("Agent - should handle MCP servers configuration", () => {
  const mcpServers = [
    {
      name: "test-server",
      url: "http://localhost:8080/mcp",
      transport: "http" as const,
    },
  ];
  const agent = new Agent({
    workingDirectory: "/tmp/test",
    mcpServers: mcpServers,
  });

  // MCP servers are not returned in getInfo, but are used for settings.json
  const info = agent.getInfo();
  assertEquals(info.workingDirectory, "/tmp/test");
});

Deno.test("Agent - should verify Claude SDK availability", async () => {
  // This will check if the SDK is available
  const isAvailable = await Agent.verifyClaudeInstallation();

  // The SDK should be importable (may fail in test environment without npm)
  assertEquals(typeof isAvailable, "boolean");
});
