// Agent Module for Deno App Engine
// Main module file that exports all agent components

export {
  AgentManager,
  AgentEvents,
  KernelType,
  type IAgentConfig,
  type IAgentInstance,
  type IAgentManagerOptions,
  type IModelRegistryEntry,
  type IModelRegistryConfig
} from "./manager.ts";

// Re-export chat completion types for convenience
export {
  type ChatRole,
  type ChatMessage,
  type ModelSettings,
  type ChatCompletionOptions,
  DefaultModelSettings
} from "../resources/chatCompletion.ts"; 