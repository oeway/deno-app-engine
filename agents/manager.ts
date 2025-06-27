// Agent Manager for Deno App Engine
// This file manages AI agent instances with optional kernel integration

import { EventEmitter } from "node:events";
import { ensureDir, exists } from "https://deno.land/std@0.208.0/fs/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";
import { 
  type ChatMessage,
  type ModelSettings,
  DefaultModelSettings
} from "./chatCompletion.ts";
import { 
  Agent, 
  AgentEvents, 
  KernelType, 
  type IAgentConfig, 
  type IAgentInstance 
} from "./agent.ts";
import { KernelLanguage } from "../kernel/manager.ts";
import { HyphaCore } from 'hypha-core';
import { DenoWebSocketServer, DenoWebSocketClient } from 'hypha-core/deno-websocket-server';
import type { InspectImagesOptions } from './vision.ts';

// Model registry events (additional to AgentEvents)
export enum ModelEvents {
  MODEL_ADDED = "model_added",
  MODEL_REMOVED = "model_removed",
  MODEL_UPDATED = "model_updated"
}

// All events (combining AgentEvents and ModelEvents)
export { AgentEvents, KernelType, type IAgentConfig, type IAgentInstance };

// Interface for model registry entry
export interface IModelRegistryEntry {
  id: string;
  modelSettings: ModelSettings;
  created: Date;
  lastUsed?: Date;
}

// Interface for model registry configuration
export interface IModelRegistryConfig {
  [modelId: string]: ModelSettings;
}

// Interface for agent manager options
export interface IAgentManagerOptions {
  maxAgents?: number;
  maxAgentsPerNamespace?: number; // Maximum agents per namespace/workspace
  defaultModelSettings?: ModelSettings;
  defaultModelId?: string; // Name of default model from registry
  defaultMaxSteps?: number;
  maxStepsCap?: number; // Maximum cap for individual completion steps within agents
  agentDataDirectory?: string;
  autoSaveConversations?: boolean;
  defaultKernelType?: KernelType;
  modelRegistry?: IModelRegistryConfig; // Initial model registry configuration
  allowedModels?: string[]; // Array of allowed model IDs from registry
  allowCustomModels?: boolean; // Whether to allow custom model settings
  // HyphaCore integration options
  enable_hypha_core?: boolean; // Enable HyphaCore server integration
  hypha_core_port?: number; // Port for HyphaCore server (default: 9527)
  hypha_core_host?: string; // Host for HyphaCore server (default: localhost)
  hypha_core_workspace?: string; // Default workspace for HyphaCore (default: default)
  hypha_core_jwt_secret?: string; // JWT secret for HyphaCore authentication (default: random)
}

// Interface for conversation save data
interface IConversationData {
  agentId: string;
  messages: ChatMessage[];
  savedAt: Date;
  metadata?: Record<string, any>;
}

/**
 * AgentManager class manages multiple AI agent instances
 */
export class AgentManager extends EventEmitter {
  private agents: Map<string, IAgentInstance> = new Map();
  private maxAgents: number;
  private maxAgentsPerNamespace: number;
  private defaultModelSettings: ModelSettings;
  private defaultModelId?: string;
  private defaultMaxSteps: number;
  private maxStepsCap: number;
  private agentDataDirectory: string;
  private autoSaveConversations: boolean;
  private defaultKernelType?: KernelType;
  private kernelManager_: any; // Will be set via setKernelManager
  
  // Model registry
  private modelRegistry: Map<string, IModelRegistryEntry> = new Map();
  private allowedModels?: string[];
  private allowCustomModels: boolean;
  
  // HyphaCore integration
  private hyphaCore: any = null;
  private hyphaAPI: any = null;
  private enableHyphaCore: boolean = false;
  private hyphaCorePort: number = 9590;
  private hyphaCoreHost: string = '127.0.0.1';
  private hyphaCoreWorkspace: string = 'default';
  private hyphaCoreJwtSecret: string;
  
  // Initialization tracking
  private _initialized: boolean = false;
  private _initializing: Promise<void> | null = null;

  constructor(options: IAgentManagerOptions = {}) {
    super();
    super.setMaxListeners(100);
    
    this.maxAgents = options.maxAgents || 50;
    this.maxAgentsPerNamespace = options.maxAgentsPerNamespace || 10;
    this.defaultModelSettings = options.defaultModelSettings || { ...DefaultModelSettings };
    this.defaultModelId = options.defaultModelId;
    this.defaultMaxSteps = options.defaultMaxSteps || 10;
    this.maxStepsCap = options.maxStepsCap || 10;
    this.agentDataDirectory = options.agentDataDirectory || "./agent_data";
    this.autoSaveConversations = options.autoSaveConversations || false;
    this.defaultKernelType = options.defaultKernelType;
    this.allowedModels = options.allowedModels;
    this.allowCustomModels = options.allowCustomModels !== false; // Default true

    // Initialize HyphaCore settings
    this.enableHyphaCore = options.enable_hypha_core || false;
    this.hyphaCorePort = options.hypha_core_port || 9527;
    this.hyphaCoreHost = options.hypha_core_host || 'localhost';
    this.hyphaCoreWorkspace = options.hypha_core_workspace || 'default';
    this.hyphaCoreJwtSecret = options.hypha_core_jwt_secret || this.generateRandomJwtSecret();

    // Initialize model registry from config
    this.initializeModelRegistry(options.modelRegistry);
  }

  /**
   * Initialize the AgentManager with async operations
   * This method should be called after creating the manager instance
   * @returns Promise that resolves when initialization is complete
   */
  public async init(): Promise<void> {
    if (this._initialized) {
      return;
    }

    if (this._initializing) {
      return this._initializing;
    }

    this._initializing = this._performInit();
    await this._initializing;
    this._initialized = true;
    this._initializing = null;
  }

  /**
   * Perform the actual initialization work
   * @private
   */
  private async _performInit(): Promise<void> {
    console.log('🚀 Initializing AgentManager...');
    
    // Ensure agent data directory exists
    try {
      await ensureDir(this.agentDataDirectory);
    } catch (error) {
      console.error(`Failed to create agent data directory: ${error}`);
    }

    // Start HyphaCore if enabled
    if (this.enableHyphaCore) {
      try {
        await this.startHyphaCore();
      } catch (error) {
        console.error('❌ Failed to start HyphaCore server:', error);
        throw error;
      }
    }

    console.log('✅ AgentManager initialization complete');
  }

  /**
   * Ensure the manager is initialized before performing operations
   * This method will automatically call init() if not already initialized
   * @private
   */
  private async ensureInitialized(): Promise<void> {
    if (!this._initialized && !this._initializing) {
      await this.init();
    } else if (this._initializing) {
      await this._initializing;
    }
  }

  /**
   * Check if the manager is initialized
   * @returns True if the manager has been initialized
   */
  public get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Check if the manager is currently initializing
   * @returns True if the manager is currently initializing
   */
  public get initializing(): boolean {
    return this._initializing !== null;
  }

  /**
   * Generate a random JWT secret for HyphaCore
   * @returns Random JWT secret string
   * @private
   */
  private generateRandomJwtSecret(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Initialize the model registry from configuration
   * @param config Model registry configuration
   * @private
   */
  private initializeModelRegistry(config?: IModelRegistryConfig): void {
    if (!config) {
      return;
    }
    
    const now = new Date();
    
    for (const [modelId, modelSettings] of Object.entries(config)) {
      const entry: IModelRegistryEntry = {
        id: modelId,
        modelSettings,
        created: now
      };
      
      this.modelRegistry.set(modelId, entry);
      
      console.log(`📝 Initialized model: ${modelId} (${modelSettings.model})`);
      
      // Emit model added event
      this.emit(ModelEvents.MODEL_ADDED, {
        modelId,
        data: { 
          id: modelId, 
          model: modelSettings.model,
          baseURL: modelSettings.baseURL,
          temperature: modelSettings.temperature,
          created: now
        }
      });
    }
    
    if (Object.keys(config).length > 0) {
      console.log(`✅ Initialized ${Object.keys(config).length} model(s) from configuration`);
    }
  }

  /**
   * Resolve model settings from registry or use provided settings
   * @param modelId Optional model ID from registry
   * @param modelSettings Optional direct model settings
   * @returns Resolved model settings
   * @private
   */
  private resolveModelSettings(modelId?: string, modelSettings?: ModelSettings): ModelSettings {
    // Priority: specific settings > model ID from registry > default model ID > default settings
    if (modelSettings) {
      if (!this.allowCustomModels) {
        throw new Error("Custom model settings are not allowed. Use a model ID from the registry.");
      }
      return { ...modelSettings };
    }
    
    // Try to get from registry using provided model ID
    if (modelId) {
      const registryEntry = this.modelRegistry.get(modelId);
      if (registryEntry) {
        // Check if model is allowed
        if (this.allowedModels && !this.allowedModels.includes(modelId)) {
          throw new Error(`Model ${modelId} is not in the allowed models list`);
        }
        // Update last used time
        registryEntry.lastUsed = new Date();
        return { ...registryEntry.modelSettings };
      } else {
        throw new Error(`Model ${modelId} not found in registry`);
      }
    }
    
    // Try to use default model ID from registry
    if (this.defaultModelId) {
      const registryEntry = this.modelRegistry.get(this.defaultModelId);
      if (registryEntry) {
        registryEntry.lastUsed = new Date();
        return { ...registryEntry.modelSettings };
      } else {
        throw new Error(`Default model ${this.defaultModelId} not found in registry`);
      }
    }
    
    // Fall back to default model settings
    return { ...this.defaultModelSettings };
  }

  // Getter for kernelManager to allow agent access for event listening
  get kernelManager() {
    return this.kernelManager_;
  }

  // Set kernel manager for kernel integration
  setKernelManager(kernelManager: any): void {
    this.kernelManager_ = kernelManager;
  }

  // Getter for maxStepsCap to allow agent access
  getMaxStepsCap(): number {
    return this.maxStepsCap;
  }

  // Helper method to count agents in a specific namespace
  private getAgentCountInNamespace(namespace: string): number {
    let count = 0;
    for (const id of this.agents.keys()) {
      if (id.startsWith(`${namespace}:`)) {
        count++;
      }
    }
    return count;
  }

  // Create a new agent
  async createAgent(config: IAgentConfig): Promise<string> {
    // Ensure manager is initialized
    await this.ensureInitialized();
    
    // Validate input
    if (!config.id || !config.name) {
      throw new Error("Agent ID and name are required");
    }

    // make sure the config.id does not contain colons because it will be used as a namespace prefix
    if (config.id.includes(':')) {
      throw new Error('Agent ID cannot contain colons');
    }

    const baseId = config.id;
    // Apply namespace prefix if provided
    const id = config.namespace ? `${config.namespace}:${baseId}` : baseId;

    if (this.agents.has(id)) {
      throw new Error(`Agent with ID "${id}" already exists`);
    }

    if (this.agents.size >= this.maxAgents) {
      throw new Error(`Maximum number of agents (${this.maxAgents}) reached`);
    }

    // Check per-namespace limit if namespace is provided
    if (config.namespace) {
      const namespaceAgentCount = this.getAgentCountInNamespace(config.namespace);
      if (namespaceAgentCount >= this.maxAgentsPerNamespace) {
        throw new Error(`Maximum number of agents per namespace (${this.maxAgentsPerNamespace}) reached for namespace "${config.namespace}"`);
      }
    }

    // Resolve model settings
    const resolvedModelSettings = this.resolveModelSettings(config.modelId, config.ModelSettings);

    // Log which model settings are being used
    console.log(`🤖 Agent ${id} model configuration:`, {
      model: resolvedModelSettings.model,
      baseURL: resolvedModelSettings.baseURL,
      temperature: resolvedModelSettings.temperature,
      apiKey: resolvedModelSettings.apiKey.substring(0, 8) + '...',
      source: config.ModelSettings ? 'CUSTOM' : config.modelId ? 'REGISTRY' : 'DEFAULT'
    });

    // Create agent with defaults
    const agentConfig: IAgentConfig = {
      ...config,
      id: id, // Use full namespaced ID for agent config so agent.id matches the map key
      ModelSettings: resolvedModelSettings,
      maxSteps: config.maxSteps || this.defaultMaxSteps,
      kernelType: config.kernelType || this.defaultKernelType
    };

    const agent = new Agent(agentConfig, this);
    this.agents.set(id, agent);

    this.emit(AgentEvents.AGENT_CREATED, {
      agentId: id,
      config: agentConfig
    });

    console.log(`✅ Created agent: ${id} (${config.name}) with kernelType: ${config.kernelType}`);

    // Auto-attach kernel if requested and conditions are met
    if (config.autoAttachKernel && config.kernelType && this.kernelManager_) {
      try {
        console.log(`🔧 Auto-attaching ${config.kernelType} kernel to agent: ${id}`);
        await this.attachKernelToAgent(id, config.kernelType);
        console.log(`✅ Successfully auto-attached kernel to agent: ${id}`);
      } catch (error) {
        console.error(`❌ Failed to auto-attach kernel to agent ${id}:`, error);
        
        // If it's a startup script error, remove the agent and throw the error to fail creation
        if (error instanceof Error && error.name === 'AgentStartupError') {
          this.agents.delete(id); // Clean up the created agent
          this.emit(AgentEvents.AGENT_ERROR, {
            agentId: id,
            error: error
          });
          throw error; // Propagate startup script errors to fail agent creation
        }
        
        // For other kernel attachment errors, emit event but don't fail agent creation
        this.emit(AgentEvents.AGENT_ERROR, {
          agentId: id,
          error: new Error(`Failed to auto-attach kernel: ${error instanceof Error ? error.message : String(error)}`)
        });
      }
    } else if (config.autoAttachKernel && !this.kernelManager_) {
      console.warn(`⚠️ Auto-attach kernel requested for agent ${id} but no kernel manager is set`);
    }

    return id;
  }

  // Get an agent by ID
  getAgent(id: string): IAgentInstance | undefined {
    return this.agents.get(id);
  }

  // Get list of agent IDs
  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  // Check if an agent exists
  agentExists(id: string): boolean {
    return this.agents.has(id);
  }

  // List all agents with their info
  listAgents(namespace?: string): Array<{
    id: string;
    name: string;
    description?: string;
    kernel_type?: KernelType;
    hasKernel: boolean;
    hasStartupScript: boolean;
    hasStartupError: boolean;
    created: Date;
    lastUsed?: Date;
    conversationLength: number;
    namespace?: string;
  }> {
    return Array.from(this.agents.entries())
      .filter(([id]) => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      })
      .map(([id, agent]) => {
        // Extract namespace from id if present
        const namespaceMatch = id.match(/^([^:]+):/);
        const extractedNamespace = namespaceMatch ? namespaceMatch[1] : undefined;
        
        // Extract base ID without namespace prefix
        const baseId = extractedNamespace ? id.substring(extractedNamespace.length + 1) : id;
        
        return {
          id: baseId, // Return base ID without namespace prefix
          name: agent.name,
          description: agent.description,
          kernel_type: agent.kernelType,
          hasKernel: !!agent.kernel,
          hasStartupScript: !!agent.startupScript,
          hasStartupError: !!agent.getStartupError(),
          created: agent.created,
          lastUsed: agent.lastUsed,
          conversationLength: agent.conversationHistory.length,
          namespace: extractedNamespace
        };
      });
  }

  // Update an agent's configuration
  async updateAgent(id: string, config: Partial<IAgentConfig>): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent with ID "${id}" not found`);
    }

    // If updating model settings, resolve them
    if (config.modelId || config.ModelSettings) {
      const resolvedModelSettings = this.resolveModelSettings(config.modelId, config.ModelSettings);
      config.ModelSettings = resolvedModelSettings;
    }

    agent.updateConfig(config);
  }

  // Destroy an agent
  async destroyAgent(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agent with ID "${id}" not found`);
    }
    // destroy the agent's kernel if it has one
    const kernelId = agent.kernelId; // Use the stored kernel ID
    agent.destroy();
    if (kernelId && this.kernelManager) {
      await this.kernelManager.destroyKernel(kernelId);
    }
    this.agents.delete(id);
  }

  // Destroy all agents
  async destroyAll(namespace?: string): Promise<void> {
    const agentIds = Array.from(this.agents.keys())
      .filter(id => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      });
    await Promise.all(agentIds.map(id => this.destroyAgent(id)));
  }

  // Attach a kernel to an agent
  async attachKernelToAgent(agentId: string, kernelType: KernelType): Promise<void> {
    // Ensure manager is initialized
    await this.ensureInitialized();
    
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    if (!this.kernelManager) {
      throw new Error("Kernel manager not set. Use setKernelManager() first.");
    }

    // Create or get a kernel instance
    const kernelLanguageMap: Record<KernelType, KernelLanguage> = {
      [KernelType.PYTHON]: KernelLanguage.PYTHON,
      [KernelType.TYPESCRIPT]: KernelLanguage.TYPESCRIPT, 
      [KernelType.JAVASCRIPT]: KernelLanguage.JAVASCRIPT
    };

    const kernelLanguage = kernelLanguageMap[kernelType];
    
    // Prepare kernel creation options with environment variables
    const kernelOptions: any = {
      lang: kernelLanguage,
    };
    
    // Add environment variables if the agent has them
    if (agent.kernelEnvirons) {
      kernelOptions.env = agent.kernelEnvirons;
    }
    
    // createKernel returns a kernel ID, not the instance
    const kernelId = await this.kernelManager.createKernel(kernelOptions);

    // Get the actual kernel instance using the ID
    const kernelInstance = this.kernelManager.getKernel(kernelId);
    
    if (!kernelInstance) {
      throw new Error(`Failed to retrieve kernel instance with ID: ${kernelId}`);
    }

    await agent.attachKernel(kernelInstance);

    // Auto-setup HyphaCore integration if enabled and kernel supports it
    if (this.enableHyphaCore && (kernelType === KernelType.PYTHON || kernelType === KernelType.JAVASCRIPT || kernelType === KernelType.TYPESCRIPT)) {
      try {
        console.log(`🔧 Setting up HyphaCore integration for ${kernelType} agent ${agentId}...`);
        
        const hyphaStartupScript = await this.generateHyphaStartupScript(agentId, kernelId, kernelType);
        
        if (hyphaStartupScript) {
          const result = await kernelInstance.kernel.execute(hyphaStartupScript);
          
          if (result.success) {
            console.log(`✅ HyphaCore integration setup complete for agent ${agentId}`);
          } else {
            console.error(`❌ HyphaCore integration setup failed for agent ${agentId}:`, result.error);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to setup HyphaCore integration for agent ${agentId}:`, error);
        // Don't throw - let the kernel attachment succeed even if HyphaCore setup fails
      }
    }
  }

  // Detach kernel from an agent
  async detachKernelFromAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    if (agent.kernelId && this.kernelManager) {
      // Destroy the kernel through the manager using the stored kernel ID
      await this.kernelManager.destroyKernel(agent.kernelId);
    }

    agent.detachKernel();
  }

  // Save conversation to file
  async saveConversation(agentId: string, filename?: string): Promise<void> {
    // Ensure manager is initialized
    await this.ensureInitialized();
    
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    const saveData: IConversationData = {
      agentId,
      messages: agent.conversationHistory,
      savedAt: new Date(),
      metadata: {
        agentName: agent.name,
        agentDescription: agent.description
      }
    };

    // Sanitize agent ID for safe filename by replacing problematic characters
    const safeAgentId = agentId.replace(/[:|@/\\<>*?"]/g, '_');
    const fileName = filename || `conversation_${safeAgentId}_${Date.now()}.json`;
    const filePath = join(this.agentDataDirectory, fileName);

    await Deno.writeTextFile(filePath, JSON.stringify(saveData, null, 2));
  }

  // Load conversation from file
  async loadConversation(agentId: string, filename?: string): Promise<ChatMessage[]> {
    // Ensure manager is initialized
    await this.ensureInitialized();
    
    if (!filename) {
      // If no filename provided, try to find the most recent conversation file for this agent
      const files = [];
      try {
        // Sanitize agent ID to match saved filenames
        const safeAgentId = agentId.replace(/[:|@/\\<>*?"]/g, '_');
        for await (const entry of Deno.readDir(this.agentDataDirectory)) {
          if (entry.isFile && entry.name.includes(`conversation_${safeAgentId}_`)) {
            files.push(entry.name);
          }
        }
      } catch {
        return [];
      }

      if (files.length === 0) {
        return [];
      }

      // Sort by timestamp (newest first)
      files.sort().reverse();
      filename = files[0];
    }

    const filePath = join(this.agentDataDirectory, filename);
    
    try {
      const content = await Deno.readTextFile(filePath);
      const saveData: IConversationData = JSON.parse(content);
      return saveData.messages;
    } catch {
      return [];
    }
  }

  // Clear agent's conversation history
  async clearConversation(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    agent.conversationHistory = [];
  }

  // Set agent's conversation history
  async setConversationHistory(agentId: string, messages: ChatMessage[]): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent with ID "${agentId}" not found`);
    }

    agent.setConversationHistory(messages);
  }

  // Get agent statistics
  getStats(): {
    totalAgents: number;
    agentsWithKernels: number;
    maxAgents: number;
    agentsByKernelType: Record<string, number>;
    autoSaveConversations: boolean;
    dataDirectory: string;
    modelRegistry: {
      totalModels: number;
      modelsInUse: number;
      allowCustomModels: boolean;
      allowedModels?: string[];
    };
    hyphaCore: {
      enabled: boolean;
      serverUrl?: string;
      workspace?: string;
      websocketUrl?: string;
    };
  } {
    const agentsByKernelType: Record<string, number> = {};
    let agentsWithKernels = 0;

    for (const agent of this.agents.values()) {
      if (agent.kernel) {
        agentsWithKernels++;
      }
      
      if (agent.kernelType) {
        agentsByKernelType[agent.kernelType] = (agentsByKernelType[agent.kernelType] || 0) + 1;
      }
    }

    // Count models in use
    const modelsInUse = new Set<string>();
    for (const agent of this.agents.values()) {
      // Try to find which model from registry this agent is using
      for (const [modelId, entry] of this.modelRegistry.entries()) {
        if (agent.ModelSettings.model === entry.modelSettings.model &&
            agent.ModelSettings.baseURL === entry.modelSettings.baseURL) {
          modelsInUse.add(modelId);
          break;
        }
      }
    }

    return {
      totalAgents: this.agents.size,
      agentsWithKernels,
      maxAgents: this.maxAgents,
      agentsByKernelType,
      autoSaveConversations: this.autoSaveConversations,
      dataDirectory: this.agentDataDirectory,
      modelRegistry: {
        totalModels: this.modelRegistry.size,
        modelsInUse: modelsInUse.size,
        allowCustomModels: this.allowCustomModels,
        allowedModels: this.allowedModels
      },
      hyphaCore: this.getHyphaCoreInfo()
    };
  }

  // Get auto-save setting
  getAutoSaveConversations(): boolean {
    return this.autoSaveConversations;
  }

  // Set auto-save conversations
  setAutoSaveConversations(enabled: boolean): void {
    this.autoSaveConversations = enabled;
  }

  // Clean up old agents in a namespace to make room for new ones
  async cleanupOldAgentsInNamespace(namespace: string, keepCount: number = 5): Promise<number> {
    const namespaceAgents = Array.from(this.agents.entries())
      .filter(([id]) => id.startsWith(`${namespace}:`))
      .map(([id, agent]) => ({ id, agent }));

    if (namespaceAgents.length <= keepCount) {
      return 0; // No cleanup needed
    }

    // Sort by last used time (oldest first), then by creation time
    namespaceAgents.sort((a, b) => {
      const aTime = a.agent.lastUsed?.getTime() || a.agent.created.getTime();
      const bTime = b.agent.lastUsed?.getTime() || b.agent.created.getTime();
      return aTime - bTime;
    });

    // Remove oldest agents to get down to keepCount
    const agentsToRemove = namespaceAgents.slice(0, namespaceAgents.length - keepCount);
    
    for (const { id } of agentsToRemove) {
      try {
        await this.destroyAgent(id);
        console.log(`🧹 Cleaned up old agent: ${id}`);
      } catch (error) {
        console.error(`❌ Failed to cleanup agent ${id}:`, error);
      }
    }

    return agentsToRemove.length;
  }

  // ===== MODEL REGISTRY METHODS =====

  /**
   * Add a model to the registry
   * @param id Unique identifier for the model
   * @param modelSettings The model settings
   * @returns True if added successfully, false if ID already exists
   */
  public addModel(id: string, modelSettings: ModelSettings): boolean {
    if (this.modelRegistry.has(id)) {
      return false;
    }

    const entry: IModelRegistryEntry = {
      id,
      modelSettings: { ...modelSettings },
      created: new Date()
    };

    this.modelRegistry.set(id, entry);

    this.emit(ModelEvents.MODEL_ADDED, {
      modelId: id,
      data: { 
        id, 
        model: modelSettings.model,
        baseURL: modelSettings.baseURL,
        temperature: modelSettings.temperature,
        created: entry.created
      }
    });

    return true;
  }

  /**
   * Remove a model from the registry
   * @param id Model ID to remove
   * @returns True if removed successfully, false if not found
   */
  public removeModel(id: string): boolean {
    const entry = this.modelRegistry.get(id);
    if (!entry) {
      return false;
    }

    // Check if any agents are using this model
    const agentsUsingModel = Array.from(this.agents.values())
      .filter(agent => {
        // Check if this agent's model settings match the registry entry
        return agent.ModelSettings.model === entry.modelSettings.model &&
               agent.ModelSettings.baseURL === entry.modelSettings.baseURL;
      });

    if (agentsUsingModel.length > 0) {
      throw new Error(`Cannot remove model ${id}: it is being used by ${agentsUsingModel.length} agent(s)`);
    }

    this.modelRegistry.delete(id);

    this.emit(ModelEvents.MODEL_REMOVED, {
      modelId: id,
      data: { id, model: entry.modelSettings.model }
    });

    return true;
  }

  /**
   * Update a model in the registry
   * @param id Model ID to update
   * @param modelSettings New model settings
   * @returns True if updated successfully, false if not found
   */
  public updateModel(id: string, modelSettings: ModelSettings): boolean {
    const entry = this.modelRegistry.get(id);
    if (!entry) {
      return false;
    }

    const oldSettings = { ...entry.modelSettings };
    entry.modelSettings = { ...modelSettings };

    this.emit(ModelEvents.MODEL_UPDATED, {
      modelId: id,
      data: { 
        id, 
        oldSettings,
        newSettings: modelSettings
      }
    });

    return true;
  }

  /**
   * Get a model from the registry
   * @param id Model ID
   * @returns Model entry or undefined if not found
   */
  public getModel(id: string): IModelRegistryEntry | undefined {
    return this.modelRegistry.get(id);
  }

  /**
   * List all models in the registry
   * @returns Array of model entries
   */
  public listModels(): IModelRegistryEntry[] {
    return Array.from(this.modelRegistry.values());
  }

  /**
   * Check if a model exists in the registry
   * @param id Model ID
   * @returns True if model exists
   */
  public hasModel(id: string): boolean {
    return this.modelRegistry.has(id);
  }

  /**
   * Change the model for an existing agent
   * @param agentId Agent ID
   * @param modelId Name of the model from registry
   * @returns Promise resolving when model is changed
   */
  public async changeAgentModel(agentId: string, modelId: string): Promise<void> {
    const agent = this.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const modelEntry = this.modelRegistry.get(modelId);
    if (!modelEntry) {
      throw new Error(`Model ${modelId} not found in registry`);
    }

    // Check if model is allowed
    if (this.allowedModels && !this.allowedModels.includes(modelId)) {
      throw new Error(`Model ${modelId} is not in the allowed models list`);
    }

    // Update the agent's model settings
    agent.ModelSettings = { ...modelEntry.modelSettings };

    // Update last used time for the model
    modelEntry.lastUsed = new Date();

    console.log(`✅ Changed model for agent ${agentId} to ${modelId}`);
  }

  /**
   * Get model usage statistics
   * @returns Model usage statistics
   */
  public getModelStats(): {
    totalModels: number;
    modelsInUse: number;
    allowCustomModels: boolean;
    allowedModels?: string[];
    modelUsage: Array<{
      id: string;
      model: string;
      baseURL: string;
      temperature: number;
      agentsUsing: number;
      lastUsed?: Date;
      created: Date;
    }>;
  } {
    const modelUsage: Array<{
      id: string;
      model: string;
      baseURL: string;
      temperature: number;
      agentsUsing: number;
      lastUsed?: Date;
      created: Date;
    }> = [];

    let modelsInUse = 0;

    for (const [id, entry] of this.modelRegistry.entries()) {
      // Count agents using this model
      const agentsUsing = Array.from(this.agents.values())
        .filter(agent => {
          return agent.ModelSettings.model === entry.modelSettings.model &&
                 agent.ModelSettings.baseURL === entry.modelSettings.baseURL;
        }).length;

      if (agentsUsing > 0) {
        modelsInUse++;
      }

      modelUsage.push({
        id,
        model: entry.modelSettings.model,
        baseURL: entry.modelSettings.baseURL,
        temperature: entry.modelSettings.temperature,
        agentsUsing,
        lastUsed: entry.lastUsed,
        created: entry.created
      });
    }

    // Sort by usage (most used first), then by last used
    modelUsage.sort((a, b) => {
      if (a.agentsUsing !== b.agentsUsing) {
        return b.agentsUsing - a.agentsUsing;
      }
      if (a.lastUsed && b.lastUsed) {
        return b.lastUsed.getTime() - a.lastUsed.getTime();
      }
      if (a.lastUsed && !b.lastUsed) return -1;
      if (!a.lastUsed && b.lastUsed) return 1;
      return b.created.getTime() - a.created.getTime();
    });

    return {
      totalModels: this.modelRegistry.size,
      modelsInUse,
      allowCustomModels: this.allowCustomModels,
      allowedModels: this.allowedModels,
      modelUsage
    };
  }

  /**
   * Set allowed models list
   * @param allowedModels Array of allowed model IDs, or undefined to allow all
   */
  public setAllowedModels(allowedModels?: string[]): void {
    this.allowedModels = allowedModels;
  }

  /**
   * Set whether custom models are allowed
   * @param allow Whether to allow custom model settings
   */
  public setAllowCustomModels(allow: boolean): void {
    this.allowCustomModels = allow;
  }

  // ===== HYPHA CORE INTEGRATION METHODS =====

  /**
   * Start the HyphaCore server
   * @private
   */
  private async startHyphaCore(): Promise<void> {
    if (!this.enableHyphaCore) {
      throw new Error("HyphaCore is not enabled");
    }

    try {
      console.log('🚀 Starting HyphaCore server...');
      
      // Create HyphaCore instance
      const agentManager = this; // Capture the AgentManager instance
      this.hyphaCore = new HyphaCore({
        url: `http://${this.hyphaCoreHost}:${this.hyphaCorePort}`,
        ServerClass: DenoWebSocketServer,
        WebSocketClass: DenoWebSocketClient,
        jwtSecret: this.hyphaCoreJwtSecret,
        defaultService: {
          async *chatCompletion(messages: ChatMessage[], context: any) {
            const agentId = context.from.split("/")[1];
            console.log(`🔄 Agent ID: ${agentId}`);
            console.log(`🔍 Available agents: ${Array.from(agentManager.agents.keys()).join(', ')}`);
            console.log(`🔍 Context from: ${context.from}, to: ${context.to}`);
            // get the agent then call the chatCompletion method
            const agent = agentManager.getAgent(agentId);
            if (!agent) {
              throw new Error(`Agent with ID "${agentId}" not found`);
            }
            
            // Stream the response from the generator
            const generator = agent.chatCompletion(messages, {
              stream: true, // Enable streaming for API calls
              maxSteps: context.max_steps || 5 // Use max_steps from context or default
            });
            
            try {
              for await (const chunk of generator) {
                yield chunk;
              }
            } catch (error) {
              console.error(`❌ Chat completion failed for agent ${agentId}:`, error);
              throw error;
            }
          },
          async *inspectImages(options: InspectImagesOptions, context: any) {
            const agentId = context.from.split("/")[1];
            console.log(`🔄 Agent ID for image inspection: ${agentId}`);
            
            // Get the agent to access its model settings for the API call
            const agent = agentManager.getAgent(agentId);
            if (!agent) {
              throw new Error(`Agent with ID "${agentId}" not found`);
            }
            
            // Import the vision utilities
            const { inspectImages } = await import('./vision.ts');
            
            // Use the agent's model settings for the vision API call
            const inspectionOptions = {
              images: options.images || [],
              query: options.query || '',
              contextDescription: options.contextDescription || '',
              model: agent.ModelSettings.model,
              maxTokens: options.max_tokens || options.maxTokens || 1024,
              baseURL: agent.ModelSettings.baseURL,
              apiKey: agent.ModelSettings.apiKey,
              outputSchema: options.outputSchema
            };
            
            try {
              for await (const chunk of inspectImages(inspectionOptions)) {
                yield chunk;
              }
            } catch (error) {
              console.error(`❌ Image inspection failed for agent ${agentId}:`, error);
              throw error;
            }
          }
        }
      });

      // Start the hypha core server
      this.hyphaAPI = await this.hyphaCore.start();
      console.log(`✅ Hypha Core Server started on http://${this.hyphaCoreHost}:${this.hyphaCorePort}`);
      
    } catch (error) {
      console.error('❌ Failed to start HyphaCore server:', error);
      throw error;
    }
  }

  /**
   * Stop the HyphaCore server
   * @private
   */
  private async stopHyphaCore(): Promise<void> {
    if (!this.enableHyphaCore) {
      return;
    }

    try {
      console.log('🛑 Shutting down HyphaCore server...');
      
      if (this.hyphaCore) {
        await this.hyphaCore.close();
        this.hyphaCore = null;
      }
      
      this.hyphaAPI = null;
      
      console.log('✅ HyphaCore server stopped');
    } catch (error) {
      console.error('❌ Error stopping HyphaCore server:', error);
    }
  }
  /**
   * Get HyphaCore connection info
   * @returns Connection information or null if not enabled
   */
  public getHyphaCoreInfo(): {
    enabled: boolean;
    serverUrl?: string;
    workspace?: string;
    websocketUrl?: string;
  } {
    return {
      enabled: this.enableHyphaCore,
      serverUrl: this.enableHyphaCore ? `http://${this.hyphaCoreHost}:${this.hyphaCorePort}` : undefined,
      workspace: this.enableHyphaCore ? this.hyphaCoreWorkspace : undefined,
      websocketUrl: this.enableHyphaCore ? `ws://${this.hyphaCoreHost}:${this.hyphaCorePort}/ws` : undefined,
    };
  }

  /**
   * Get the HyphaCore API instance
   * @returns HyphaCore API or null if not enabled
   */
  public getHyphaAPI(): any {
    return this.hyphaAPI;
  }

  /**
   * Generate hypha-rpc startup script for a kernel
   * @param agentId Agent ID for token generation
   * @param kernelId Kernel ID for client identification
   * @param kernelType Kernel type to generate appropriate script
   * @returns Startup script or empty string if HyphaCore not enabled
   * @private
   */
  private async generateHyphaStartupScript(agentId: string, kernelId: string, kernelType: KernelType): Promise<string> {
    if (!this.enableHyphaCore || !this.hyphaAPI) {
      return '';
    }

    try {
      // Generate token for this agent/kernel
      const token = await this.hyphaAPI.generateToken({
        user_id: `agent-${agentId}`,
        workspace: this.hyphaCoreWorkspace,
        expires_in: 3600 // 1 hour
      });

      // Generate different startup scripts based on kernel type
      if (kernelType === KernelType.PYTHON) {
        return `
import micropip
await micropip.install("hypha-rpc")

from hypha_rpc import connect_to_server

# Connect to HyphaCore server with authentication token
_hypha_server = await connect_to_server({
    "server_url": "http://${this.hyphaCoreHost}:${this.hyphaCorePort}",
    "workspace": "${this.hyphaCoreWorkspace}",
    "client_id": "${agentId}",
    "token": "${token}"
})

print(f"✅ Connected to HyphaCore server: {_hypha_server.config.public_base_url}")
`;
      } else if (kernelType === KernelType.JAVASCRIPT || kernelType === KernelType.TYPESCRIPT) {
        return `
// Import hypha-rpc from CDN
const hyphaWebsocketClient = await import("https://cdn.jsdelivr.net/npm/hypha-rpc@0.20.58/dist/hypha-rpc-websocket.mjs");

// Connect to HyphaCore server with authentication token
const _hypha_server = await hyphaWebsocketClient.connectToServer({
    server_url: "http://${this.hyphaCoreHost}:${this.hyphaCorePort}",
    workspace: "${this.hyphaCoreWorkspace}",
    client_id: "${agentId}",
    token: "${token}"
});

console.log("✅ Connected to HyphaCore server:", _hypha_server.config.public_base_url);

// Make _hypha_server globally available for use in subsequent code executions
globalThis._hypha_server = _hypha_server;
`;
      } else {
        console.warn(`❌ Unsupported kernel type for HyphaCore integration: ${kernelType}`);
        return '';
      }
    } catch (error) {
      console.error('❌ Failed to generate HyphaCore startup script:', error);
      return '';
    }
  }

  /**
   * Shutdown the AgentManager and clean up HyphaCore
   */
  public async shutdown(): Promise<void> {
    console.log('🛑 Shutting down AgentManager...');
    
    // Wait for any ongoing initialization to complete
    if (this._initializing) {
      await this._initializing;
    }
    
    // Destroy all agents
    await this.destroyAll();
    
    // Stop HyphaCore if running
    if (this.enableHyphaCore && this._initialized) {
      await this.stopHyphaCore();
    }
    
    // Reset initialization state
    this._initialized = false;
    this._initializing = null;
    
    console.log('✅ AgentManager shutdown complete');
  }
} 