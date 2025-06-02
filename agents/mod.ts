// Agents module for Deno App Engine
// This module provides AI agent management with optional kernel integration

// Export everything from manager (includes AgentManager and interfaces)
export * from "./manager.ts";

// Export everything from agent (includes Agent class and core interfaces)
export * from "./agent.ts";

// Re-export chat completion types for convenience
export {
  type ChatRole,
  type ChatMessage,
  type ModelSettings,
  type ChatCompletionOptions,
  DefaultModelSettings
} from "./chatCompletion.ts"; 