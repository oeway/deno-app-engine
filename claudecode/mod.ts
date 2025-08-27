/**
 * Claude Code Deno Agent
 *
 * A secure implementation for running Claude Code agents in Deno with proper sandboxing
 *
 * @module
 */

export { Agent } from "./agent.ts";
export { AgentManager } from "./manager.ts";
export { WorkerAgentProxy } from "./worker-agent.ts";
export type {
  AgentConfig,
  AgentInfo,
  CreateAgentOptions,
  ManagerConfig,
  ManagerInfo,
  MCPServerConfig,
  PermissionMode,
  PermissionRequest,
  PermissionResponse,
  PermissionCallback,
  StreamResponse,
} from "./types.ts";
