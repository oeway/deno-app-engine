/**
 * Hypha Service for Claude Code Agent Manager
 * 
 * This service provides a comprehensive interface to the Agent Manager
 * through Hypha's distributed service protocol, enabling remote access
 * and streaming capabilities for Claude Code agents.
 * 
 * Environment Variables:
 * - HYPHA_SERVER_URL: Hypha server URL (default: https://hypha.aicell.io)
 * - HYPHA_WORKSPACE: Optional workspace name for service registration
 * - HYPHA_TOKEN: Optional authentication token for secured workspaces
 * - AGENT_BASE_DIRECTORY: Base directory for agent workspaces (default: ./agent-workspaces)
 * - AGENT_MAX_COUNT: Maximum number of concurrent agents (default: 10)
 * - SERVICE_ID: Service ID for registration (default: claude-agent-manager)
 * - SERVICE_VISIBILITY: Service visibility (default: public)
 */

import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { AgentManager } from "./manager.ts";
import type {
  CreateAgentOptions,
  PermissionRequest,
  PermissionResponse,
  StreamResponse,
  AgentInfo,
  ManagerInfo,
} from "./types.ts";

interface HyphaServiceConfig {
  serverUrl?: string;
  workspace?: string;
  token?: string;
  serviceId?: string;
  visibility?: "public" | "protected";
  baseDirectory?: string;
  maxAgents?: number;
}

interface ExecuteOptions {
  agentId: string;
  prompt: string;
  sessionId?: string;
  allowedTools?: string[];
  streamUpdates?: boolean;
}

interface StreamUpdate {
  type: "stream" | "permission" | "error" | "done" | "aborted";
  data?: unknown;
  error?: string;
  permissionRequest?: PermissionRequest;
  timestamp: number;
  display_message?: string;  // Human-readable formatted message
}

/**
 * Get emoji icon for different tools
 */
function getToolIcon(toolName: string): string {
  const icons: Record<string, string> = {
    'Task': '🎯',
    'Bash': '💻',
    'Read': '📖',
    'Write': '✍️',
    'Edit': '✏️',
    'MultiEdit': '📝',
    'Glob': '🔍',
    'Grep': '🔎',
    'LS': '📂',
    'WebFetch': '🌐',
    'WebSearch': '🔍',
    'TodoWrite': '📋',
    'NotebookEdit': '📓',
    'ExitPlanMode': '🚪',
    'BashOutput': '📊',
    'KillBash': '🛑',
  };
  
  if (toolName.includes('mcp__')) return '🔌';
  return icons[toolName] || '🔧';
}

/**
 * Format stream response into human-readable message
 */
export function formatStreamMessage(response: StreamResponse): string | null {
  if (response.type === "agent" && response.data) {
    const agentData = response.data as Record<string, unknown>;
    const msgType = agentData.type;
    
    if (msgType === "system") {
      const subtype = agentData.subtype || "";
      if (subtype === "init") {
        const cwd = agentData.cwd || "N/A";
        const tools = agentData.tools || [];
        const sessionId = agentData.session_id || "N/A";
        const permissionMode = agentData.permissionMode || "unknown";
        return `⚙️  System initialized\n    📁 Working directory: ${cwd}\n    🔧 Tools available: ${tools.length}\n    🆔 Session: ${sessionId.substring(0, 8)}...\n    🔐 Permission mode: ${permissionMode}`;
      }
      return `ℹ️  System: ${subtype}`;
    }
    
    else if (msgType === "assistant") {
      const message = agentData.message || {};
      const content = message.content || [];
      const results: string[] = [];
      
      for (const item of content) {
        if (item.type === "text") {
          const text = item.text || "";
          results.push(`💬 Assistant: ${text}`);
        } else if (item.type === "tool_use") {
          const toolName = item.name || "unknown";
          const toolInput = item.input || {};
          const toolIcon = getToolIcon(toolName);
          
          let inputStr = "";
          if (toolName === "Write") {
            if (toolInput.file_path) {
              const _fileName = String(toolInput.file_path).split('/').pop() || toolInput.file_path;
              inputStr = `\n    📄 File: ${toolInput.file_path}`;
              const content = toolInput.content || "";
              const lines = String(content).split('\n');
              if (lines.length > 0) {
                inputStr += `\n    📝 Content: ${lines.length} line${lines.length === 1 ? '' : 's'}`;
                if (content.length < 200) {
                  // Show short content directly
                  const preview = lines.slice(0, 3).map(l => 
                    l.length > 50 ? l.substring(0, 50) + "..." : l
                  ).join('\n        ');
                  if (preview) {
                    inputStr += `\n        ${preview}`;
                  }
                }
              }
            }
          } else if (toolName === "Edit" || toolName === "MultiEdit") {
            if (toolInput.file_path) {
              inputStr = `\n    📄 File: ${toolInput.file_path}`;
              if (toolName === "MultiEdit" && toolInput.edits) {
                const edits = toolInput.edits as unknown[];
                inputStr += `\n    ✏️  Edits: ${edits.length} change${edits.length === 1 ? '' : 's'}`;
              } else if (toolInput.old_string) {
                const oldStr = String(toolInput.old_string);
                const newStr = String(toolInput.new_string || "");
                inputStr += `\n    ✏️  Replacing: ${oldStr.length} chars → ${newStr.length} chars`;
              }
            }
          } else if (toolName === "Bash") {
            if (toolInput.command) {
              inputStr = `\n    $ ${toolInput.command}`;
            }
          } else if (toolName === "Read") {
            if (toolInput.file_path) {
              inputStr = `\n    📖 Reading: ${toolInput.file_path}`;
            }
          } else if (toolName === "LS") {
            if (toolInput.path) {
              inputStr = `\n    📂 Listing: ${toolInput.path}`;
            }
          } else if (toolName === "TodoWrite" && toolInput.todos) {
            // Special formatting for TodoWrite
            const todos = toolInput.todos as Array<{
              status: string;
              activeForm?: string;
              content: string;
            }>;
            inputStr = "\n    📝 Todo List Update:";
            for (const todo of todos) {
              const statusIcon = todo.status === "completed" ? "✅" : 
                               todo.status === "in_progress" ? "⏳" : "⭕";
              const displayText = todo.status === "in_progress" && todo.activeForm 
                ? todo.activeForm 
                : todo.content;
              inputStr += `\n        ${statusIcon} ${displayText}`;
            }
          } else if (toolName === "Grep" && toolInput.pattern) {
            inputStr = `\n    🔎 Pattern: "${toolInput.pattern}"`;
            if (toolInput.path) inputStr += `\n    📁 Path: ${toolInput.path}`;
            if (toolInput.glob) inputStr += `\n    🎯 Filter: ${toolInput.glob}`;
          } else if (toolName === "WebSearch" && toolInput.query) {
            inputStr = `\n    🔍 Query: "${toolInput.query}"`;
          } else if (toolName === "WebFetch" && toolInput.url) {
            inputStr = `\n    🌐 URL: ${toolInput.url}`;
            if (toolInput.prompt) {
              const promptPreview = String(toolInput.prompt).substring(0, 100);
              inputStr += `\n    📝 Prompt: ${promptPreview}${toolInput.prompt.length > 100 ? '...' : ''}`;
            }
          } else if (Object.keys(toolInput).length > 0) {
            // For other tools, show formatted parameters
            const params: string[] = [];
            for (const [key, value] of Object.entries(toolInput)) {
              // Format value based on type
              let formattedValue: string;
              if (value === null || value === undefined) {
                formattedValue = String(value);
              } else if (typeof value === 'boolean' || typeof value === 'number') {
                formattedValue = String(value);
              } else if (typeof value === 'string') {
                formattedValue = value.length > 50 ? value.substring(0, 50) + "..." : value;
              } else if (Array.isArray(value)) {
                if (value.length === 0) {
                  formattedValue = "[]";
                } else if (value.length <= 3) {
                  formattedValue = `[${value.map(v => 
                    typeof v === 'object' ? '{...}' : String(v)
                  ).join(", ")}]`;
                } else {
                  formattedValue = `[${value.length} items]`;
                }
              } else if (typeof value === 'object') {
                const keys = Object.keys(value);
                formattedValue = keys.length === 0 ? "{}" : `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? "..." : ""}}`;
              } else {
                formattedValue = String(value);
              }
              
              params.push(`${key}=${formattedValue}`);
              if (params.length >= 3 && Object.keys(toolInput).length > 3) {
                params.push("...");
                break;
              }
            }
            if (params.length > 0) {
              inputStr = `\n    ⚙️  Parameters: ${params.join(", ")}`;
            }
          }
          
          results.push(`${toolIcon} Using tool: ${toolName}${inputStr}`);
        }
      }
      return results.length > 0 ? results.join("\n") : null;
    }
    
    else if (msgType === "result") {
      const subtype = agentData.subtype || "";
      if (subtype === "success") {
        const result = agentData.result || "Completed";
        const usage = agentData.usage || {};
        const cost = agentData.total_cost_usd || 0;
        const duration = agentData.duration_ms || 0;
        
        const inputTokens = usage.input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        
        return `✅ Success: ${result}\n    📊 Tokens: ${inputTokens} input, ${outputTokens} output\n    💰 Cost: $${cost.toFixed(6)}\n    ⏱️  Duration: ${duration}ms`;
      } else if (subtype === "error") {
        const errorMsg = agentData.error || "Unknown error";
        return `❌ Error: ${errorMsg}`;
      }
    }
    
    else if (msgType === "user") {
      const message = agentData.message || {};
      const content = message.content || [];
      const results: string[] = [];
      
      for (const item of content) {
        if (item.type === "tool_result") {
          const isError = item.is_error || false;
          let resultContent = item.content || "";
          
          // Handle TodoWrite and other special results
          const toolUseId = item.tool_use_id || "";
          
          // For TodoWrite results, keep them simple
          if (toolUseId && resultContent.includes("Todos have been modified")) {
            results.push(`✅ Todo list updated successfully`);
            continue;
          }
          
          // For Bash commands, check for common patterns
          if (resultContent.includes("<status>running</status>")) {
            // It's a process status message
            results.push(`🔄 Process running...`);
            continue;
          } else if (resultContent.includes("<status>completed</status>")) {
            results.push(`✅ Process completed`);
            continue;
          }
          
          // Truncate long results but be more generous
          if (resultContent.length > 1000) {
            const lines = resultContent.split('\n');
            if (lines.length > 20) {
              resultContent = lines.slice(0, 20).join('\n') + `\n    ... (${lines.length - 20} more lines)`;
            } else {
              resultContent = resultContent.substring(0, 1000) + "...";
            }
          }
          
          if (isError) {
            // Handle permission errors specially
            if (resultContent.includes("permission") || resultContent.includes("denied")) {
              results.push(`🔒 Permission denied:\n    ${resultContent}`);
            } else {
              results.push(`⚠️  Tool error:\n    ${resultContent}`);
            }
          } else {
            if (resultContent.trim()) {
              // Check if it's a file listing result
              if (resultContent.includes("NOTE: do any of the files")) {
                // It's an LS result with security check
                const lines = resultContent.split('\n');
                const fileLines = lines.filter(l => !l.includes("NOTE:"));
                const noteLines = lines.filter(l => l.includes("NOTE:"));
                
                if (fileLines.length > 0) {
                  const indented = fileLines.join('\n    ');
                  results.push(`📊 Tool result:\n    ${indented}`);
                }
                if (noteLines.length > 0) {
                  results.push(`ℹ️  ${noteLines[0]}`);
                }
              } else if (resultContent.includes("<status>") || resultContent.includes("<timestamp>")) {
                // Handle XML/HTML-like status messages
                const statusMatch = resultContent.match(/<status>(.*?)<\/status>/);
                const timestampMatch = resultContent.match(/<timestamp>(.*?)<\/timestamp>/);
                const messageMatch = resultContent.match(/<message>(.*?)<\/message>/s);
                
                if (statusMatch || timestampMatch) {
                  let formatted = "📊 Tool result:";
                  if (statusMatch) {
                    const status = statusMatch[1];
                    const statusIcon = status === "running" ? "🔄" : 
                                     status === "completed" ? "✅" :
                                     status === "failed" ? "❌" : "ℹ️";
                    formatted += `\n    ${statusIcon} Status: ${status}`;
                  }
                  if (timestampMatch) {
                    const timestamp = new Date(timestampMatch[1]).toLocaleString();
                    formatted += `\n    ⏰ Time: ${timestamp}`;
                  }
                  if (messageMatch) {
                    formatted += `\n    📝 Message: ${messageMatch[1].trim()}`;
                  }
                  results.push(formatted);
                } else {
                  // Fallback for other XML/HTML content
                  const cleaned = resultContent
                    .replace(/<[^>]+>/g, '') // Remove all tags
                    .replace(/\s+/g, ' ')     // Normalize whitespace
                    .trim();
                  if (cleaned) {
                    results.push(`📊 Tool result: ${cleaned}`);
                  } else {
                    results.push(`📊 Tool completed`);
                  }
                }
              } else if (resultContent.includes("```") || resultContent.includes("```python")) {
                // Handle code blocks
                const codeBlockMatch = resultContent.match(/```(?:\w+)?\n?([\s\S]*?)```/);
                if (codeBlockMatch) {
                  const code = codeBlockMatch[1].trim();
                  const beforeCode = resultContent.substring(0, resultContent.indexOf("```")).trim();
                  const afterCode = resultContent.substring(resultContent.lastIndexOf("```") + 3).trim();
                  
                  let formatted = "📊 Tool result:";
                  if (beforeCode) {
                    formatted += `\n    ${beforeCode}`;
                  }
                  formatted += "\n    💻 Code:";
                  const codeLines = code.split('\n').slice(0, 10);
                  for (const line of codeLines) {
                    formatted += `\n        ${line}`;
                  }
                  if (code.split('\n').length > 10) {
                    formatted += `\n        ... (${code.split('\n').length - 10} more lines)`;
                  }
                  if (afterCode) {
                    formatted += `\n    ${afterCode}`;
                  }
                  results.push(formatted);
                } else {
                  // Regular result with code markers but no proper blocks
                  const indented = resultContent.split('\n').join('\n    ');
                  results.push(`📊 Tool result:\n    ${indented}`);
                }
              } else if (resultContent.startsWith("File ") && resultContent.includes("successfully")) {
                // Handle file operation results
                results.push(`✅ ${resultContent.trim()}`);
              } else if (resultContent.includes("Error:") || resultContent.includes("error")) {
                // Handle error-like messages that aren't marked as errors
                results.push(`⚠️  Warning:\n    ${resultContent.trim()}`);
              } else {
                // Regular result - check if it's JSON-like
                if (resultContent.trim().startsWith("{") || resultContent.trim().startsWith("[")) {
                  try {
                    const parsed = JSON.parse(resultContent);
                    // Format JSON nicely
                    const formatted = JSON.stringify(parsed, null, 2);
                    const lines = formatted.split('\n').slice(0, 10);
                    let display = "📊 Tool result (JSON):\n    " + lines.join('\n    ');
                    if (formatted.split('\n').length > 10) {
                      display += `\n    ... (${formatted.split('\n').length - 10} more lines)`;
                    }
                    results.push(display);
                  } catch {
                    // Not valid JSON, treat as regular text
                    const indented = resultContent.split('\n').join('\n    ');
                    results.push(`📊 Tool result:\n    ${indented}`);
                  }
                } else {
                  // Regular text result
                  const indented = resultContent.split('\n').join('\n    ');
                  results.push(`📊 Tool result:\n    ${indented}`);
                }
              }
            } else {
              results.push(`📊 Tool completed successfully`);
            }
          }
        }
      }
      return results.length > 0 ? results.join("\n") : null;
    }
  }
  
  else if (response.type === "permission_request" && response.permissionRequest) {
    const req = response.permissionRequest;
    const tool = req.toolName || "unknown";
    const patterns = req.patterns || [];
    const desc = req.description || "";
    let result = `🔐 Permission requested\n    Tool: ${tool}`;
    if (patterns.length > 0) {
      result += `\n    Patterns: ${patterns.join(", ")}`;
    }
    if (desc) {
      result += `\n    Purpose: ${desc}`;
    }
    return result;
  }
  
  else if (response.type === "error") {
    return `❌ Error: ${response.error || "Unknown error"}`;
  }
  
  else if (response.type === "done") {
    return "✅ Execution completed successfully";
  }
  
  else if (response.type === "aborted") {
    return "⚠️  Execution aborted";
  }
  
  return null;
}

/**
 * Hypha Service wrapper for Agent Manager
 */
export class HyphaAgentService {
  private manager: AgentManager;
  private server: unknown;
  private service: unknown;
  private config: Required<HyphaServiceConfig>;
  private activeStreams: Map<string, AsyncGenerator<StreamResponse>>;
  private permissionCallbacks: Map<string, (response: PermissionResponse) => void>;

  constructor(config?: HyphaServiceConfig) {
    this.config = {
      serverUrl: config?.serverUrl || Deno.env.get("HYPHA_SERVER_URL") || "https://hypha.aicell.io",
      workspace: config?.workspace || Deno.env.get("HYPHA_WORKSPACE") || undefined,
      token: config?.token || Deno.env.get("HYPHA_TOKEN") || undefined,
      serviceId: config?.serviceId || Deno.env.get("SERVICE_ID") || "claude-agent-manager",
      visibility: config?.visibility || (Deno.env.get("SERVICE_VISIBILITY") as "public" | "protected") || "public",
      baseDirectory: config?.baseDirectory || Deno.env.get("AGENT_BASE_DIRECTORY") || "./agent-workspaces",
      maxAgents: config?.maxAgents || parseInt(Deno.env.get("AGENT_MAX_COUNT") || "10"),
    };

    this.manager = new AgentManager({
      baseDirectory: this.config.baseDirectory,
    });

    this.activeStreams = new Map();
    this.permissionCallbacks = new Map();
  }

  /**
   * Connect to Hypha server and register the service
   */
  async connect(): Promise<void> {
    // Initialize the manager
    await this.manager.initialize();

    // Connect to Hypha server
    const connectConfig: Record<string, unknown> = {
      server_url: this.config.serverUrl,
    };

    if (this.config.workspace) {
      connectConfig.workspace = this.config.workspace;
    }

    if (this.config.token) {
      connectConfig.token = this.config.token;
    }
    else{
      connectConfig.token = await hyphaWebsocketClient.login({ server_url: this.config.serverUrl });
    }
    console.log(`🔌 [CONNECT] Connecting to Hypha server...`);
    this.server = await hyphaWebsocketClient.connectToServer(connectConfig);
    console.log(`✅ [CONNECT] Connected to Hypha server at ${this.config.serverUrl}`);
    console.log(`📁 [CONNECT] Workspace: ${this.server.config.workspace}`);
    console.log(`🆔 [CONNECT] Client ID: ${this.server.config.client_id || 'N/A'}`);

    // Register the service with all available methods
    this.service = await this.server.registerService({
      name: "Claude Agent Manager Service",
      id: this.config.serviceId,
      config: {
        visibility: this.config.visibility,
        require_context: false,
      },
      description: "Comprehensive agent management service for Claude Code",
      
      // Agent lifecycle management
      createAgent: this.createAgent.bind(this),
      getAgent: this.getAgent.bind(this),
      getAllAgents: this.getAllAgents.bind(this),
      removeAgent: this.removeAgent.bind(this),
      removeAllAgents: this.removeAllAgents.bind(this),
      
      // Agent execution
      execute: this.execute.bind(this),
      executeStreaming: this.executeStreaming.bind(this),
      stopAgent: this.stopAgent.bind(this),
      
      // Permission handling
      respondToPermission: this.respondToPermission.bind(this),
      
      // Manager information
      getInfo: this.getInfo.bind(this),
      
      // Utility methods
      ping: this.ping.bind(this),
      help: this.help.bind(this),
    });

    console.log(`✅ [REGISTER] Service registered with ID: ${this.service.id}`);
    console.log(`🔗 [REGISTER] Full service path: ${this.server.config.workspace}/${this.config.serviceId}`);
    console.log(`🌍 [REGISTER] Service visibility: ${this.config.visibility}`);
    console.log(`📊 [REGISTER] Max agents allowed: ${this.config.maxAgents}`);
  }

  /**
   * Create a new agent
   */
  async createAgent(options?: CreateAgentOptions): Promise<AgentInfo> {
    // Set default permission mode to bypassPermissions for easier usage
    const agentOptions = {
      permissionMode: "bypassPermissions",  // Default to no permission prompts
      ...options,  // Allow override if explicitly provided
    };
    
    console.log(`📥 [CREATE_AGENT] Request received:`, JSON.stringify(agentOptions, null, 2));
    
    // Check agent limit
    const currentCount = this.manager.getAllAgents().length;
    if (currentCount >= this.config.maxAgents) {
      console.log(`❌ [CREATE_AGENT] Maximum agent limit (${this.config.maxAgents}) reached`);
      throw new Error(`Maximum agent limit (${this.config.maxAgents}) reached`);
    }

    const agent = await this.manager.createAgent(agentOptions);
    const info = await agent.getInfo();
    
    console.log(`✅ [CREATE_AGENT] Agent created:`, {
      id: info.id,
      name: info.name,
      workingDirectory: info.workingDirectory,
    });
    
    return info;
  }

  /**
   * Get agent information by ID
   */
  async getAgent(agentId: string): Promise<AgentInfo | null> {
    console.log(`📥 [GET_AGENT] Request for agent: ${agentId}`);
    
    const agent = this.manager.getAgent(agentId);
    if (!agent) {
      console.log(`⚠️  [GET_AGENT] Agent not found: ${agentId}`);
      return null;
    }
    
    const info = await agent.getInfo();
    console.log(`✅ [GET_AGENT] Agent found: ${info.name || info.id}`);
    return info;
  }

  /**
   * Get all agents
   */
  async getAllAgents(): Promise<AgentInfo[]> {
    console.log(`📥 [GET_ALL_AGENTS] Request received`);
    
    const agents = this.manager.getAllAgents();
    const infos = await Promise.all(agents.map(agent => agent.getInfo()));
    
    console.log(`✅ [GET_ALL_AGENTS] Found ${infos.length} agents`);
    return infos;
  }

  /**
   * Remove an agent
   */
  async removeAgent(agentId: string, keepDirectory?: boolean): Promise<boolean> {
    console.log(`📥 [REMOVE_AGENT] Request to remove: ${agentId}, keepDirectory: ${keepDirectory}`);
    
    // Clean up any active streams for this agent
    const streamKey = `${agentId}-stream`;
    if (this.activeStreams.has(streamKey)) {
      this.activeStreams.delete(streamKey);
      console.log(`🧹 [REMOVE_AGENT] Cleaned up active stream for agent: ${agentId}`);
    }

    const result = await this.manager.removeAgent(agentId, keepDirectory);
    console.log(`${result ? '✅' : '❌'} [REMOVE_AGENT] ${result ? 'Successfully removed' : 'Failed to remove'} agent: ${agentId}`);
    return result;
  }

  /**
   * Remove all agents
   */
  async removeAllAgents(keepDirectories?: boolean): Promise<number> {
    // Clean up all active streams
    this.activeStreams.clear();
    this.permissionCallbacks.clear();

    return await this.manager.removeAllAgents(keepDirectories);
  }

  /**
   * Execute a command on an agent (non-streaming)
   */
  async execute(options: ExecuteOptions): Promise<unknown[]> {
    const { agentId, prompt, sessionId, allowedTools } = options;
    
    console.log(`📥 [EXECUTE] Request received:`, {
      agentId,
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      sessionId,
      allowedTools,
    });
    
    const agent = this.manager.getAgent(agentId);
    if (!agent) {
      console.log(`❌ [EXECUTE] Agent not found: ${agentId}`);
      throw new Error(`Agent ${agentId} not found`);
    }

    const results: unknown[] = [];
    
    // Simple permission callback that auto-denies (for non-interactive mode)
    const permissionCallback = (request: PermissionRequest): Promise<PermissionResponse> => {
      return Promise.resolve({
        requestId: request.id,
        action: "deny",
      });
    };

    for await (const response of agent.execute(prompt, sessionId, permissionCallback, { allowedTools })) {
      if (response.type === "agent" && response.data) {
        // Add formatted display message to the result
        const displayMessage = formatStreamMessage(response);
        const dataWithDisplay = {
          ...response.data,
          display_message: displayMessage
        };
        results.push(dataWithDisplay);
      } else if (response.type === "error") {
        console.log(`❌ [EXECUTE] Error: ${response.error}`);
        throw new Error(response.error);
      }
    }

    console.log(`✅ [EXECUTE] Completed with ${results.length} responses`);
    return results;
  }

  /**
   * Execute a command with streaming (returns async generator)
   * This is the main method for interactive streaming with permission handling
   */
  async *executeStreaming(options: ExecuteOptions): AsyncGenerator<StreamUpdate> {
    const { agentId, prompt, sessionId, allowedTools } = options;
    
    console.log(`📡 [EXECUTE_STREAMING] Request received:`, {
      agentId,
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      sessionId,
      allowedTools,
      timestamp: new Date().toISOString(),
    });
    
    const agent = this.manager.getAgent(agentId);
    if (!agent) {
      console.log(`❌ [EXECUTE_STREAMING] Agent not found: ${agentId}`);
      yield {
        type: "error",
        error: `Agent ${agentId} not found`,
        timestamp: Date.now(),
      };
      return;
    }
    
    console.log(`🎯 [EXECUTE_STREAMING] Starting stream for agent: ${agentId}`);

    const streamKey = `${agentId}-${Date.now()}`;
    let pendingPermissionUpdate: StreamUpdate | null = null;
    let pendingPermissionResolve: ((response: PermissionResponse) => void) | null = null;
    
    try {
      // Permission callback that stores the request for later yielding
      const permissionCallback = async (request: PermissionRequest): Promise<PermissionResponse> => {
        // Create permission update
        pendingPermissionUpdate = {
          type: "permission",
          permissionRequest: request,
          timestamp: Date.now(),
        };
        
        // Create promise for the response
        const responsePromise = new Promise<PermissionResponse>((resolve) => {
          pendingPermissionResolve = resolve;
          this.permissionCallbacks.set(request.id, resolve);
        });

        // Wait for and return the response
        return await responsePromise;
      };

      // Start execution and store the generator
      const generator = agent.execute(prompt, sessionId, permissionCallback, { allowedTools });
      this.activeStreams.set(streamKey, generator);

      // Stream responses
      for await (const response of generator) {
        // Check if we have a pending permission update to yield first
        if (pendingPermissionUpdate) {
          // Add display_message to permission update
          if (!pendingPermissionUpdate.display_message && pendingPermissionUpdate.permissionRequest) {
            const req = pendingPermissionUpdate.permissionRequest;
            let msg = `🔐 Permission requested\n    Tool: ${req.toolName}`;
            if (req.patterns && req.patterns.length > 0) {
              msg += `\n    Patterns: ${req.patterns.join(", ")}`;
            }
            if (req.description) {
              msg += `\n    Purpose: ${req.description}`;
            }
            pendingPermissionUpdate.display_message = msg;
          }
          
          // Log the formatted permission message
          if (pendingPermissionUpdate.display_message) {
            const lines = pendingPermissionUpdate.display_message.split('\n');
            if (lines.length > 1) {
              console.log(`[EXECUTE_STREAMING] ${lines[0]}`);
              for (let i = 1; i < lines.length; i++) {
                console.log(`                    ${lines[i]}`);
              }
            } else {
              console.log(`[EXECUTE_STREAMING] ${pendingPermissionUpdate.display_message}`);
            }
          }
          yield pendingPermissionUpdate;
          pendingPermissionUpdate = null;
          
          // Wait for permission response before continuing
          if (pendingPermissionResolve) {
            await new Promise<void>((resolve) => {
              // Set up a check interval to see if permission was resolved
              const checkInterval = setInterval(() => {
                if (!this.permissionCallbacks.has(response.permissionRequest?.id || "")) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 100);
            });
          }
        }

        // Format the message for display
        const displayMessage = formatStreamMessage(response);
        
        const update: StreamUpdate = {
          type: "stream",
          data: response,
          timestamp: Date.now(),
          display_message: displayMessage || undefined,
        };

        if (response.type === "error") {
          update.type = "error";
          update.error = response.error;
          update.display_message = `❌ Error: ${response.error}`;
          console.log(`[EXECUTE_STREAMING] ${update.display_message}`);
        } else if (response.type === "done") {
          update.type = "done";
          update.display_message = "✅ Execution completed successfully";
          console.log(`[EXECUTE_STREAMING] ${update.display_message}`);
        } else if (response.type === "aborted") {
          update.type = "aborted";
          update.display_message = "⚠️  Execution aborted";
          console.log(`[EXECUTE_STREAMING] ${update.display_message}`);
        } else if (response.type === "permission_request") {
          // Handle permission requests that come through the stream
          update.type = "permission";
          const permReq = (response as Record<string, unknown>).permissionRequest;
          update.permissionRequest = permReq;
          update.display_message = formatStreamMessage(response) || undefined;
          if (update.display_message) {
            const lines = update.display_message.split('\n');
            if (lines.length > 1) {
              console.log(`[EXECUTE_STREAMING] ${lines[0]}`);
              for (let i = 1; i < lines.length; i++) {
                console.log(`                    ${lines[i]}`);
              }
            } else {
              console.log(`[EXECUTE_STREAMING] ${update.display_message}`);
            }
          }
        } else if (response.type === "agent" && response.data) {
          // Log the actual formatted message content
          if (update.display_message) {
            // Split multiline messages and indent continuation lines
            const lines = update.display_message.split('\n');
            if (lines.length > 1) {
              console.log(`[EXECUTE_STREAMING] ${lines[0]}`);
              for (let i = 1; i < lines.length; i++) {
                console.log(`                    ${lines[i]}`);
              }
            } else {
              console.log(`[EXECUTE_STREAMING] ${update.display_message}`);
            }
          }
        }

        // Only yield if there's content to show
        if (update.display_message || update.type === "permission") {
          yield update;
        }

        // Exit on terminal states
        if (response.type === "done" || response.type === "aborted" || response.type === "error") {
          break;
        }
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`❌ [EXECUTE_STREAMING] Exception: ${errorMsg}`);
      yield {
        type: "error",
        error: errorMsg,
        timestamp: Date.now(),
      };
    } finally {
      console.log(`🎬 [EXECUTE_STREAMING] Stream ended for agent: ${agentId}`);
      // Clean up
      this.activeStreams.delete(streamKey);
      // Clean up any pending permission callbacks for this stream
      for (const [id, _] of this.permissionCallbacks.entries()) {
        if (id.startsWith(agentId)) {
          this.permissionCallbacks.delete(id);
        }
      }
    }
  }

  /**
   * Respond to a permission request
   */
  respondToPermission(response: PermissionResponse): boolean {
    console.log(`📥 [RESPOND_PERMISSION] Response received:`, {
      requestId: response.requestId,
      action: response.action,
      allowedTools: response.allowedTools,
    });
    
    const callback = this.permissionCallbacks.get(response.requestId);
    if (callback) {
      callback(response);
      this.permissionCallbacks.delete(response.requestId);
      console.log(`✅ [RESPOND_PERMISSION] Permission response processed: ${response.action}`);
      return true;
    }
    
    console.log(`⚠️  [RESPOND_PERMISSION] No callback found for request: ${response.requestId}`);
    return false;
  }

  /**
   * Stop an agent's current execution
   */
  stopAgent(agentId: string): boolean {
    console.log(`📥 [STOP_AGENT] Request to stop agent: ${agentId}`);
    
    const result = this.manager.stopAgent(agentId);
    console.log(`${result ? '✅' : '❌'} [STOP_AGENT] ${result ? 'Stopped' : 'Failed to stop'} agent: ${agentId}`);
    return result;
  }

  /**
   * Get manager information
   */
  async getInfo(): Promise<ManagerInfo> {
    console.log(`📥 [GET_INFO] Request received`);
    
    const info = await this.manager.getInfo();
    console.log(`✅ [GET_INFO] Manager info:`, {
      baseDirectory: info.baseDirectory,
      agentCount: info.agentCount,
      verified: info.verified,
    });
    return info;
  }

  /**
   * Simple ping method for health check
   */
  ping(): string {
    console.log(`🏓 [PING] Health check received`);
    return "pong";
  }

  /**
   * Help method providing service documentation
   */
  help(): Record<string, unknown> {
    console.log(`📦 [HELP] Documentation requested`);
    return {
      description: "Claude Agent Manager Service - Manage and interact with Claude Code agents",
      methods: {
        // Lifecycle
        createAgent: {
          description: "Create a new agent with optional configuration",
          params: {
            options: {
              type: "object",
              optional: true,
              properties: {
                name: "string - Agent name",
                description: "string - Agent description",
                workingDirectory: "string - Working directory path",
                permissionMode: "string - Permission mode (default, strict, bypassPermissions)",
                allowedTools: "string[] - List of allowed tools",
              },
            },
          },
          returns: "AgentInfo - Created agent information",
        },
        getAgent: {
          description: "Get agent information by ID",
          params: {
            agentId: "string - Agent ID",
          },
          returns: "AgentInfo | null - Agent information or null if not found",
        },
        getAllAgents: {
          description: "Get all active agents",
          returns: "AgentInfo[] - List of all agents",
        },
        removeAgent: {
          description: "Remove an agent",
          params: {
            agentId: "string - Agent ID",
            keepDirectory: "boolean - Keep working directory (optional, default: false)",
          },
          returns: "boolean - Success status",
        },
        
        // Execution
        execute: {
          description: "Execute a command (non-streaming, auto-denies permissions)",
          params: {
            options: {
              agentId: "string - Agent ID",
              prompt: "string - Command prompt",
              sessionId: "string - Session ID (optional)",
              allowedTools: "string[] - Allowed tools (optional)",
            },
          },
          returns: "any[] - Execution results",
        },
        executeStreaming: {
          description: "Execute with streaming and interactive permission handling (async generator)",
          params: {
            options: {
              agentId: "string - Agent ID",
              prompt: "string - Command prompt",
              sessionId: "string - Session ID (optional)",
              allowedTools: "string[] - Allowed tools (optional)",
            },
          },
          returns: "AsyncGenerator<StreamUpdate> - Stream of updates",
          note: "Use this for interactive sessions with permission handling",
        },
        
        // Control
        stopAgent: {
          description: "Stop an agent's current execution",
          params: {
            agentId: "string - Agent ID",
          },
          returns: "boolean - Success status",
        },
        respondToPermission: {
          description: "Respond to a permission request",
          params: {
            response: {
              requestId: "string - Permission request ID",
              action: "string - 'allow', 'allow_permanent', or 'deny'",
              allowedTools: "string[] - Updated allowed tools (optional)",
            },
          },
          returns: "boolean - Success status",
        },
        
        // Info
        getInfo: {
          description: "Get manager information and statistics",
          returns: "ManagerInfo - Manager status and configuration",
        },
        ping: {
          description: "Health check",
          returns: "string - 'pong'",
        },
        help: {
          description: "Get service documentation",
          returns: "object - This help information",
        },
      },
      streaming: {
        description: "The executeStreaming method returns an async generator for real-time updates",
        updateTypes: {
          stream: "Regular streaming update with agent response",
          permission: "Permission request requiring user response",
          error: "Error occurred during execution",
          done: "Execution completed successfully",
          aborted: "Execution was aborted",
        },
        example: `
// JavaScript client example:
const service = await server.getService("claude-agent-manager");
const agent = await service.createAgent({ name: "MyAgent" });

// Streaming execution with permission handling
async function* executeWithPermissions() {
  const generator = await service.executeStreaming({
    agentId: agent.id,
    prompt: "Create a hello.txt file",
    sessionId: "session-123"
  });
  
  for await (const update of generator) {
    if (update.type === "permission") {
      // Handle permission request
      const response = await getUserDecision(update.permissionRequest);
      await service.respondToPermission(response);
    } else if (update.type === "stream") {
      // Handle streaming data
      console.log(update.data);
    }
  }
}
        `,
      },
      configuration: {
        environmentVariables: {
          HYPHA_SERVER_URL: "Hypha server URL (default: https://hypha.aicell.io)",
          HYPHA_WORKSPACE: "Workspace name (optional)",
          HYPHA_TOKEN: "Authentication token (optional)",
          AGENT_BASE_DIRECTORY: "Base directory for agents (default: ./agent-workspaces)",
          AGENT_MAX_COUNT: "Maximum concurrent agents (default: 10)",
          SERVICE_ID: "Service registration ID (default: claude-agent-manager)",
          SERVICE_VISIBILITY: "Service visibility: public/protected (default: public)",
        },
      },
    };
  }

  /**
   * Start the service and keep it running
   */
  async serve(): Promise<void> {
    await this.connect();
    console.log("=".repeat(60));
    console.log("🚀 Claude Agent Manager Service is running");
    console.log(`📍 Service endpoint: ${this.server.config.workspace}/${this.config.serviceId}`);
    console.log("=".repeat(60));
    console.log("📊 Monitoring remote interactions...");
    console.log("");
    
    // Keep the service running - Hypha connections stay alive as long as the process runs
    // We'll use a promise that never resolves to keep the service running
    await new Promise(() => {});
  }

  /**
   * Disconnect from Hypha server
   */
  async disconnect(): Promise<void> {
    console.log("🔌 [DISCONNECT] Starting graceful shutdown...");
    
    // Clean up all agents
    const agentCount = this.manager.getAllAgents().length;
    if (agentCount > 0) {
      console.log(`🧹 [DISCONNECT] Cleaning up ${agentCount} agents...`);
      await this.manager.cleanup();
    }
    
    // Disconnect from server
    if (this.server) {
      console.log(`🔌 [DISCONNECT] Disconnecting from Hypha server...`);
      await this.server.disconnect();
    }
    
    console.log("👋 [DISCONNECT] Successfully disconnected from Hypha server");
  }
}

// Main entry point when run directly
if (import.meta.main) {
  const service = new HyphaAgentService();
  
  // Handle graceful shutdown
  const shutdown = async () => {
    console.log("\n");
    console.log("=".repeat(60));
    console.log("🛑 SHUTDOWN SIGNAL RECEIVED");
    console.log("=".repeat(60));
    await service.disconnect();
    console.log("💤 Service stopped");
    Deno.exit(0);
  };

  // Register signal handlers
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);

  // Start the service
  try {
    console.log("=".repeat(60));
    console.log("🎯 CLAUDE AGENT MANAGER - HYPHA SERVICE");
    console.log("=".repeat(60));
    console.log(`📅 Started at: ${new Date().toISOString()}`);
    console.log(`🔧 Configuration:`);
    console.log(`   - Base Directory: ${Deno.env.get("AGENT_BASE_DIRECTORY") || "./agent-workspaces"}`);
    console.log(`   - Max Agents: ${Deno.env.get("AGENT_MAX_COUNT") || "10"}`);
    console.log(`   - Service ID: ${Deno.env.get("SERVICE_ID") || "claude-agent-manager"}`);
    console.log(`   - Visibility: ${Deno.env.get("SERVICE_VISIBILITY") || "public"}`);
    console.log("=".repeat(60));
    console.log("");
    
    await service.serve();
  } catch (error) {
    console.error("\n❌ Failed to start service:", error);
    console.error("\n💡 Troubleshooting tips:");
    console.error("   1. Check your internet connection");
    console.error("   2. Verify Hypha server URL is correct");
    console.error("   3. Check if Claude Code SDK is installed");
    console.error("   4. Review environment variables");
    Deno.exit(1);
  }
}