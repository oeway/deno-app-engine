/**
 * Worker-based Agent implementation with Comlink RPC
 * This file serves both as the worker script and the proxy interface
 */

import * as Comlink from "https://unpkg.com/comlink@4.4.1/dist/esm/comlink.mjs";
import { Agent } from "./agent.ts";
import type {
  AgentConfig,
  AgentInfo,
  PermissionCallback,
  StreamResponse,
} from "./types.ts";
import type { ConversationMessage } from "./agent.ts";

// ============================================================================
// Worker-side implementation (runs inside the worker)
// ============================================================================

/**
 * Worker API exposed via Comlink
 */
class WorkerAgent {
  private agent: Agent | null = null;
  private currentAbortController: AbortController | null = null;
  private executions = new Map<string, {
    responses: StreamResponse[];
    done: boolean;
    error: string | null;
  }>();

  /**
   * Initialize the agent with configuration
   */
  async initialize(config: AgentConfig): Promise<void> {
    // Verify Claude installation
    const verified = await Agent.verifyClaudeInstallation();
    if (!verified) {
      throw new Error("Claude Code SDK not available in worker");
    }
    
    this.agent = new Agent(config);
  }

  /**
   * Start executing a command on the agent
   * Returns a unique execution ID
   */
  startExecution(
    prompt: string,
    sessionId?: string,
    allowedTools?: string[],
    permissionHandler?: (request: unknown) => Promise<unknown>,
  ): Promise<string> {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }

    const executionId = globalThis.crypto.randomUUID();
    
    // Store the execution for later retrieval
    this.executions.set(executionId, {
      responses: [],
      done: false,
      error: null,
    });

    // Start execution in the background
    this.executeInBackground(
      executionId,
      prompt,
      sessionId,
      allowedTools,
      permissionHandler
    );

    return executionId;
  }

  /**
   * Execute command in background and store responses
   */
  private async executeInBackground(
    executionId: string,
    prompt: string,
    sessionId?: string,
    allowedTools?: string[],
    permissionHandler?: (request: unknown) => Promise<unknown>,
  ): Promise<void> {
    const execution = this.executions.get(executionId);
    if (!execution || !this.agent) return;

    // Create permission callback if handler provided
    const permissionCallback: PermissionCallback | undefined = permissionHandler
      ? async (request) => {
          // Store the permission request for the client to handle
          execution.responses.push({
            type: "permission_request",
            permissionRequest: request,
          });
          
          // Wait for and return the permission response
          const response = await permissionHandler(request);
          return response;
        }
      : undefined;

    try {
      for await (const response of this.agent.execute(
        prompt,
        sessionId,
        permissionCallback,
        { allowedTools }
      )) {
        execution.responses.push(response);
      }
      execution.done = true;
    } catch (error) {
      execution.error = error instanceof Error ? error.message : String(error);
      execution.done = true;
    }
  }

  /**
   * Get responses for an execution
   */
  getResponses(executionId: string): {
    responses: StreamResponse[];
    done: boolean;
    error: string | null;
  } {
    const execution = this.executions.get(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    // Return current responses and clear them
    const responses = [...execution.responses];
    execution.responses = [];

    return {
      responses,
      done: execution.done,
      error: execution.error,
    };
  }

  /**
   * Abort the current execution
   */
  abort(): void {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    this.agent.abort();
    
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * Get agent information
   */
  getInfo(): AgentInfo {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    return this.agent.getInfo();
  }

  /**
   * Get conversation history
   */
  getConversation(): ConversationMessage[] {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    return this.agent.getConversation();
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    this.agent.clearConversation();
  }

  /**
   * Get session ID
   */
  getSessionId(): string | undefined {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    return this.agent.getSessionId();
  }

  /**
   * Set conversation history
   */
  setConversation(messages: ConversationMessage[]): void {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    
    this.agent.setConversation(messages);
  }
}

// Check if we're running in a worker context
if (typeof self !== "undefined" && self.constructor.name === "DedicatedWorkerGlobalScope") {
  // We're in a worker - expose the API
  Comlink.expose(new WorkerAgent());
}

// ============================================================================
// Main thread proxy implementation
// ============================================================================

/**
 * Proxy class that manages an agent running in a Web Worker
 */
export class WorkerAgentProxy {
  private worker: Worker;
  private workerAPI: Comlink.Remote<WorkerAgent>;
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly workingDirectory: string;
  readonly permissionMode: string;
  readonly allowedTools?: string[];

  constructor(
    config: AgentConfig,
    permissions: Deno.PermissionOptions,
  ) {
    // Ensure config has an ID before creating the proxy
    if (!config.id) {
      config.id = globalThis.crypto.randomUUID();
    }
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.workingDirectory = config.workingDirectory;
    this.permissionMode = config.permissionMode || "default";
    this.allowedTools = config.allowedTools;

    // Create worker with specific permissions
    const workerUrl = new URL(import.meta.url);
    this.worker = new Worker(workerUrl, {
      type: "module",
      deno: {
        permissions,
      },
    });

    // Wrap the worker with Comlink
    this.workerAPI = Comlink.wrap<WorkerAgent>(this.worker);
  }

  /**
   * Initialize the agent in the worker
   */
  async initialize(config: AgentConfig): Promise<void> {
    await this.workerAPI.initialize(config);
  }

  /**
   * Execute a command on the agent
   */
  async *execute(
    prompt: string,
    sessionId?: string,
    permissionCallback?: PermissionCallback,
    options?: { allowedTools?: string[] },
  ): AsyncGenerator<StreamResponse> {
    // Create permission handler if callback provided
    const permissionHandler = permissionCallback
      ? Comlink.proxy(async (request: unknown) => {
          return await permissionCallback(request);
        })
      : undefined;

    // Start the execution and get an ID
    const executionId = await this.workerAPI.startExecution(
      prompt,
      sessionId,
      options?.allowedTools,
      permissionHandler
    );

    // Poll for responses
    while (true) {
      const { responses, done, error } = await this.workerAPI.getResponses(executionId);
      
      // Yield all responses
      for (const response of responses) {
        yield response;
      }
      
      // Check if we're done
      if (done) {
        if (error) {
          yield { type: "error", error };
        }
        break;
      }
      
      // Small delay before next poll
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  /**
   * Abort the current execution
   */
  async abort(): Promise<void> {
    await this.workerAPI.abort();
  }

  /**
   * Get agent information
   */
  getInfo(): AgentInfo {
    // Return the proxy's info to ensure consistent ID
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      workingDirectory: this.workingDirectory,
      permissionMode: this.permissionMode,
      allowedTools: this.allowedTools
    };
  }

  /**
   * Get conversation history
   */
  async getConversation(): Promise<ConversationMessage[]> {
    return await this.workerAPI.getConversation();
  }

  /**
   * Clear conversation history
   */
  async clearConversation(): Promise<void> {
    await this.workerAPI.clearConversation();
  }

  /**
   * Get session ID
   */
  async getSessionId(): Promise<string | undefined> {
    return await this.workerAPI.getSessionId();
  }

  /**
   * Set conversation history
   */
  async setConversation(messages: ConversationMessage[]): Promise<void> {
    await this.workerAPI.setConversation(messages);
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    // Terminate the worker
    this.worker.terminate();
  }
}