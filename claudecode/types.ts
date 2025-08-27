/**
 * Type definitions for Claude Code Agent
 */

/**
 * Permission modes matching Claude CLI
 */
export type PermissionMode =
  | "default"         // Standard mode with shell access (security risk)
  | "strict"          // No shell access, true file system isolation
  | "acceptEdits"     // Auto-accept file edits
  | "bypassPermissions" // Full system access, no sandbox
  | "plan";           // Planning mode

/**
 * MCP Server configuration
 */
export interface MCPServerConfig {
  /** Name identifier for the server */
  name: string;
  /** URL of the MCP server (for HTTP/SSE servers) */
  url?: string;
  /** Command to execute (for stdio servers) */
  command?: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Transport protocol */
  transport?: "http" | "ws" | "stdio";
}

/**
 * Agent configuration
 */
export interface AgentConfig {
  /** Unique identifier for the agent */
  id?: string;
  /** Human-readable name for the agent */
  name?: string;
  /** Description of the agent's purpose */
  description?: string;
  /** Working directory for the agent */
  workingDirectory: string;
  /** Permission mode for tool usage */
  permissionMode?: PermissionMode;
  /** List of allowed tools */
  allowedTools?: string[];
  /** MCP servers configuration */
  mcpServers?: MCPServerConfig[];
  /** Settings template for claude.json */
  settingsTemplate?: Record<string, unknown>;
}

/**
 * Stream response from agent execution
 */
export interface StreamResponse {
  /** Type of response */
  type: "agent" | "error" | "done" | "aborted" | "permission_request";
  /** Data payload for agent type */
  data?: unknown;
  /** Error message for error type */
  error?: string;
  /** Permission request data */
  permissionRequest?: PermissionRequest;
}

/**
 * Permission request from Claude
 */
export interface PermissionRequest {
  /** Unique ID for this permission request */
  id: string;
  /** Tool name requesting permission */
  toolName: string;
  /** Patterns or commands being requested */
  patterns: string[];
  /** Tool use ID from Claude */
  toolUseId?: string;
  /** Additional context about what the tool wants to do */
  description?: string;
}

/**
 * User's response to a permission request
 */
export interface PermissionResponse {
  /** ID of the permission request being responded to */
  requestId: string;
  /** User's decision */
  action: "allow" | "allow_permanent" | "deny";
  /** Updated list of allowed tools if permanent */
  allowedTools?: string[];
}

/**
 * Callback for handling permission requests
 */
export type PermissionCallback = (
  request: PermissionRequest
) => Promise<PermissionResponse>;

/**
 * Options for creating a new agent
 */
export interface CreateAgentOptions {
  /** Human-readable name for the agent */
  name?: string;
  /** Description of the agent's purpose */
  description?: string;
  /** Working directory for the agent */
  workingDirectory?: string;
  /** Permission mode for tool usage */
  permissionMode?: PermissionMode;
  /** List of allowed tools */
  allowedTools?: string[];
  /** MCP servers configuration */
  mcpServers?: MCPServerConfig[];
  /** Settings template for claude.json */
  settingsTemplate?: Record<string, unknown>;
}

/**
 * Agent information
 */
export interface AgentInfo {
  /** Unique agent ID */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Description */
  description?: string;
  /** Agent's working directory */
  workingDirectory: string;
  /** Permission mode */
  permissionMode: PermissionMode;
  /** Allowed tools */
  allowedTools?: string[];
}

/**
 * Manager configuration
 */
export interface ManagerConfig {
  /** Base directory for all agents */
  baseDirectory?: string;
  /** Default MCP servers for all agents */
  defaultMcpServers?: MCPServerConfig[];
  /** Path to settings template */
  settingsTemplatePath?: string;
}

/**
 * Manager information
 */
export interface ManagerInfo {
  /** Base directory for all agents */
  baseDirectory: string;
  /** Number of active agents */
  agentCount: number;
  /** List of all agents */
  agents: AgentInfo[];
  /** Whether Claude Code SDK is verified */
  verified: boolean;
  /** Default MCP servers */
  defaultMcpServers?: MCPServerConfig[];
}
