// Agent class for Deno App Engine
// This file contains the core Agent implementation with kernel-aware prompt generation and planning capabilities

import { 
  chatCompletion,
  type ChatCompletionOptions,
  type ChatMessage, 
  type ModelSettings, 
  DefaultModelSettings
} from "./chatCompletion.ts";
import type { IKernelInstance, IKernel } from "../kernel/mod.ts";
import { KernelLanguage } from "../kernel/mod.ts";
import { KernelMode } from "../kernel/mod.ts";

// Re-export enums and interfaces that the Agent needs
export enum AgentEvents {
  AGENT_CREATED = "agent_created",
  AGENT_DESTROYED = "agent_destroyed",
  AGENT_UPDATED = "agent_updated",
  AGENT_MESSAGE = "agent_message",
  AGENT_STREAMING = "agent_streaming",
  AGENT_CODE_EXECUTED = "agent_code_executed",
  AGENT_ERROR = "agent_error",
  KERNEL_ATTACHED = "kernel_attached",
  KERNEL_DETACHED = "kernel_detached",
  MODEL_ADDED = "model_added",
  MODEL_REMOVED = "model_removed",
  MODEL_UPDATED = "model_updated",
  PLANNING_STEP = "planning_step",
  ACTION_STEP = "action_step",
  TASK_STEP = "task_step"
}

export enum KernelType {
  PYTHON = "python",
  TYPESCRIPT = "typescript", 
  JAVASCRIPT = "javascript"
}

// Memory step types for tracking different kinds of interactions
export enum StepType {
  TASK = "task",
  ACTION = "action", 
  PLANNING = "planning",
  SYSTEM_PROMPT = "system_prompt"
}

// Interface for tracking code executions
export interface CodeExecution {
  completionId: string;
  code: string;
  language: string;
  outputs: string;
  timestamp: number;
  committed: boolean;
}

// Memory step interfaces
export interface BaseStep {
  type: StepType;
  stepNumber?: number;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

export interface TaskStep extends BaseStep {
  type: StepType.TASK;
  task: string;
  taskImages?: string[];
}

export interface ActionStep extends BaseStep {
  type: StepType.ACTION;
  modelInputMessages?: ChatMessage[];
  modelOutputMessage?: ChatMessage;
  modelOutput?: string;
  toolCalls?: ToolCall[];
  observations?: string;
  observationsImages?: string[];
  actionOutput?: any;
  error?: AgentError;
}

export interface PlanningStep extends BaseStep {
  type: StepType.PLANNING;
  modelInputMessages: ChatMessage[];
  modelOutputMessageFacts: ChatMessage;
  facts: string;
  modelOutputMessagePlan: ChatMessage;
  plan: string;
}

export interface SystemPromptStep extends BaseStep {
  type: StepType.SYSTEM_PROMPT;
  systemPrompt: string;
}

// Completion-specific data for service calls
export interface CompletionData {
  completionId: string;
  thoughts?: {
    timestamp: number;
    data: string;
  };
  returnToUser?: {
    timestamp: number;
    data: {
      content: string;
      commitIds?: string[];
    };
  };
}

export interface ToolCall {
  name: string;
  arguments: any;
  id: string;
}

export class AgentError extends Error {
  constructor(message: string, public context?: string) {
    super(message);
    this.name = 'AgentError';
  }
}

export class AgentExecutionError extends AgentError {
  constructor(message: string) {
    super(message, 'execution');
    this.name = 'AgentExecutionError';
  }
}

export class AgentPlanningError extends AgentError {
  constructor(message: string) {
    super(message, 'planning');
    this.name = 'AgentPlanningError';
  }
}

export class AgentMaxStepsError extends AgentError {
  constructor(message: string) {
    super(message, 'max_steps');
    this.name = 'AgentMaxStepsError';
  }
}

export class AgentObservationError extends AgentError {
  constructor(message: string) {
    super(message, 'invalid_observation');
    this.name = 'AgentObservationError';
  }
}

export class AgentStartupError extends AgentError {
  constructor(message: string, public fullError: string, public stackTrace?: string) {
    super(message, 'startup_script');
    this.name = 'AgentStartupError';
  }
}

// Memory management for agent interactions
export class AgentMemory {
  public steps: (TaskStep | ActionStep | PlanningStep | SystemPromptStep)[] = [];
  public systemPrompt?: SystemPromptStep;
  public completionMemory: Map<string, CompletionData> = new Map(); // Store completion-specific data
  public codeExecutions: Map<string, CodeExecution> = new Map(); // Store code executions by completion ID

  reset(): void {
    this.steps = [];
    this.systemPrompt = undefined;
    this.completionMemory.clear();
    this.codeExecutions.clear();
  }

  addStep(step: TaskStep | ActionStep | PlanningStep | SystemPromptStep): void {
    if (step.type === StepType.SYSTEM_PROMPT) {
      this.systemPrompt = step;
    }
    this.steps.push(step);
  }

  getStepsByType<T extends BaseStep>(type: StepType): T[] {
    return this.steps.filter(step => step.type === type) as T[];
  }

  // Code execution tracking
  addCodeExecution(execution: CodeExecution): void {
    this.codeExecutions.set(execution.completionId, execution);
  }

  getCodeExecution(completionId: string): CodeExecution | undefined {
    return this.codeExecutions.get(completionId);
  }

  commitExecutions(commitIds: string[]): void {
    for (const commitId of commitIds) {
      const execution = this.codeExecutions.get(commitId);
      if (execution) {
        execution.committed = true;
      }
    }
  }

  getCommittedExecutions(): CodeExecution[] {
    return Array.from(this.codeExecutions.values()).filter(exec => exec.committed);
  }

  // Completion memory management methods
  getCompletionData(completionId: string): CompletionData | undefined {
    return this.completionMemory.get(completionId);
  }

  setCompletionData(completionId: string, data: CompletionData): void {
    this.completionMemory.set(completionId, data);
  }

  clearCompletionData(completionId: string): void {
    this.completionMemory.delete(completionId);
  }

  // Cleanup old completion data
  cleanupOldCompletions(maxAgeMs: number = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;
    const toDelete: string[] = [];

    for (const [completionId, data] of this.completionMemory.entries()) {
      const timestamps = [
        data.thoughts?.timestamp,
        data.returnToUser?.timestamp
      ].filter(t => t !== undefined) as number[];

      if (timestamps.length === 0 || Math.max(...timestamps) < cutoff) {
        toDelete.push(completionId);
      }
    }

    for (const completionId of toDelete) {
      this.completionMemory.delete(completionId);
    }

    // Also cleanup old code executions
    const executionsToDelete: string[] = [];
    for (const [completionId, execution] of this.codeExecutions.entries()) {
      if (execution.timestamp < cutoff) {
        executionsToDelete.push(completionId);
      }
    }

    for (const completionId of executionsToDelete) {
      this.codeExecutions.delete(completionId);
    }

    if (toDelete.length > 0 || executionsToDelete.length > 0) {
      console.log(`🧹 Cleaned up ${toDelete.length} old completion entries and ${executionsToDelete.length} old executions from agent memory`);
    }
  }

  toMessages(summaryMode = false): ChatMessage[] {
    const messages: ChatMessage[] = [];
    
    // Add system prompt if not in summary mode
    if (!summaryMode && this.systemPrompt) {
      messages.push({
        role: 'system',
        content: this.systemPrompt.systemPrompt
      });
    }

    // Add all steps converted to messages
    for (const step of this.steps) {
      const stepMessages = this.stepToMessages(step, summaryMode);
      messages.push(...stepMessages);
    }

    return this.cleanMessageList(messages);
  }

  private stepToMessages(step: BaseStep, summaryMode: boolean): ChatMessage[] {
    const messages: ChatMessage[] = [];

    switch (step.type) {
      case StepType.TASK:
        const taskStep = step as TaskStep;
        messages.push({
          role: 'user',
          content: taskStep.task
        });
        break;

      case StepType.ACTION:
        const actionStep = step as ActionStep;
        if (actionStep.modelOutput && !summaryMode) {
          messages.push({
            role: 'assistant',
            content: actionStep.modelOutput.trim()
          });
        }

        if (actionStep.toolCalls && actionStep.toolCalls.length > 0) {
          messages.push({
            role: 'user',
            content: `Calling tools:\n${JSON.stringify(actionStep.toolCalls.map(tc => ({
              id: tc.id,
              type: "function",
              function: { name: tc.name, arguments: tc.arguments }
            })))}`
          });
        }

        if (actionStep.observations) {
          const callId = actionStep.toolCalls?.[0]?.id || '';
          messages.push({
            role: 'user',
            content: `${callId ? `Call id: ${callId}\n` : ''}Observation:\n${actionStep.observations}`
          });
        }

        if (actionStep.error) {
          messages.push({
            role: 'user',
            content: `Error: ${actionStep.error.message}\nPlease try a different approach.`
          });
        }
        break;

      case StepType.PLANNING:
        const planningStep = step as PlanningStep;
        if (!summaryMode) {
          messages.push({
            role: 'assistant',
            content: `### Planning Facts\n${planningStep.facts}`
          });
          messages.push({
            role: 'assistant', 
            content: `### Planning Strategy\n${planningStep.plan}`
          });
        }
        break;

      case StepType.SYSTEM_PROMPT:
        // System prompt is handled separately
        break;
    }

    return messages;
  }

  private cleanMessageList(messages: ChatMessage[]): ChatMessage[] {
    // Merge consecutive assistant messages, but keep user messages separate
    const cleaned: ChatMessage[] = [];
    
    for (const message of messages) {
      const lastMessage = cleaned[cleaned.length - 1];
      
      // Only merge consecutive assistant messages, not user messages
      if (lastMessage && lastMessage.role === message.role && message.role === 'assistant') {
        // Merge assistant messages
        lastMessage.content = `${lastMessage.content}\n${message.content}`;
      } else {
        cleaned.push({ ...message });
      }
    }
    
    return cleaned;
  }
}

// Interface for agent configuration
export interface IAgentConfig {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  startupScript?: string; // Script to execute when kernel is initialized (stdout/stderr added to system prompt)
  kernelType?: KernelType;
  kernelEnvirons?: Record<string, string>; // Environment variables to set in the kernel
  ModelSettings?: ModelSettings;
  modelId?: string; // Name of model from registry
  maxSteps?: number;
  autoAttachKernel?: boolean; // Automatically attach kernel on creation
  enablePlanning?: boolean; // Enable planning capabilities
  planningInterval?: number; // Run planning every N steps (1 = every step, undefined = disabled)
  hyphaServices?: Record<string, any>; // Available Hypha services
  namespace?: string; // Optional namespace prefix for the agent ID
}

// Interface for agent instance
export interface IAgentInstance {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  startupScript?: string;
  kernelType?: KernelType;
  kernelEnvirons?: Record<string, string>;
  kernel?: IKernel; // Direct kernel reference, not wrapped
  // Kernel metadata - moved from IKernelInstance to agent
  kernelId?: string;
  kernelMode?: KernelMode;
  kernelLanguage?: KernelLanguage;
  kernelCreated?: Date;
  kernelOptions?: any;
  ModelSettings: ModelSettings;
  maxSteps: number;
  enablePlanning: boolean;
  planningInterval?: number;
  memory: AgentMemory;
  created: Date;
  lastUsed?: Date;
  conversationHistory: ChatMessage[];
  chatCompletion(messages: ChatMessage[], options?: Partial<ChatCompletionOptions>): AsyncGenerator<any, void, unknown>;
  statelessChatCompletion(messages: ChatMessage[], options?: Partial<ChatCompletionOptions>): AsyncGenerator<any, void, unknown>;
  attachKernel(kernelInstance: IKernelInstance): Promise<void>; // Keep original signature for KernelManager compatibility
  detachKernel(): void;
  updateConfig(config: Partial<IAgentConfig>): void;
  destroy(): void;
  getStartupError(): AgentStartupError | undefined;
  setConversationHistory(messages: ChatMessage[]): void;
}

// Code execution instructions for agents with kernels
const CODE_EXECUTION_INSTRUCTIONS = {
  PYTHON: `
You are an AI assistant that executes PYTHON code to solve problems. Follow the conversation pattern exactly as shown in the examples above.

**CRITICAL: You MUST write Python code only. Do not write TypeScript, JavaScript, or any other language.**

**FORMAT RULES:**
- Always respond with: <script lang="python">your_python_code_here</script>
- Never include explanation outside script tags
- Use Python syntax: f-strings, def functions, print() for debug output
- Use Python variable assignment: result = value (not const result = value)

**AVAILABLE FUNCTIONS:**
- await returnToUser(f"final answer in markdown") - Send final response to user (REQUIRED when task is complete)
- await logThoughts("internal thinking") - Record your internal thoughts  
- print() - Debug output (use sparingly)

**PYTHON SYNTAX EXAMPLES:**
- Variables: result = 2 + 3
- Strings: f"The result is {result}"
- Functions: def greet(name): return f"Hello, {name}!"
`,
  
  TYPESCRIPT: `
You are an AI assistant that executes TYPESCRIPT code to solve problems. Follow the conversation pattern exactly as shown in the examples above.

**CRITICAL: You MUST write TypeScript code only. Do not write Python, JavaScript, or any other language.**

**FORMAT RULES:**
- Always respond with: <script lang="typescript">your_typescript_code_here</script>
- Never include explanation outside script tags
- Use TypeScript syntax: template literals, const/let, console.log() for debug output
- Use TypeScript variable assignment: const result = value (not result = value)
- Include type annotations where helpful: function greet(name: string): string

**AVAILABLE FUNCTIONS:**
- await returnToUser(\`final answer in markdown\`) - Send final response to user (REQUIRED when task is complete)
- await logThoughts("internal thinking") - Record your internal thoughts
- console.log() - Debug output (use sparingly)

**TYPESCRIPT SYNTAX EXAMPLES:**
- Variables: const result = 2 + 3;
- Strings: \`The result is \${result}\`
- Functions: function greet(name: string): string { return \`Hello, \${name}!\`; }
`,

  JAVASCRIPT: `
You are an AI assistant that executes JAVASCRIPT code to solve problems. Follow the conversation pattern exactly as shown in the examples above.

**CRITICAL: You MUST write JavaScript code only. Do not write Python, TypeScript, or any other language.**

**FORMAT RULES:**
- Always respond with: <script lang="javascript">your_javascript_code_here</script>
- Never include explanation outside script tags
- Use JavaScript syntax: template literals, const/let, console.log() for debug output
- Use JavaScript variable assignment: const result = value (not result = value)

**AVAILABLE FUNCTIONS:**
- await returnToUser(\`final answer in markdown\`) - Send final response to user (REQUIRED when task is complete)
- await logThoughts("internal thinking") - Record your internal thoughts
- console.log() - Debug output (use sparingly)

**JAVASCRIPT SYNTAX EXAMPLES:**
- Variables: const result = 2 + 3;
- Strings: \`The result is \${result}\`
- Functions: function greet(name) { return \`Hello, \${name}!\`; }
`
};

// Planning prompt templates
const PLANNING_PROMPTS = {
  INITIAL_FACTS: `Below I will present you a task.

You will now build a comprehensive preparatory survey of which facts we have at our disposal and which ones we still need.
To do so, you will have to read the task and identify things that must be discovered in order to successfully complete it.
Don't make any assumptions. For each item, provide a thorough reasoning. Here is how you will structure this survey:

---
### 1. Facts given in the task
List here the specific facts given in the task that could help you (there might be nothing here).

### 2. Facts to look up
List here any facts that we may need to look up.
Also list where to find each of these, for instance a website, a file... - maybe the task contains some sources that you should re-use here.

### 3. Facts to derive
List here anything that we want to derive from the above by logical reasoning, for instance computation or simulation.

Keep in mind that "facts" will typically be specific names, dates, values, etc. Your answer should use the below headings:
### 1. Facts given in the task
### 2. Facts to look up
### 3. Facts to derive
Do not add anything else.

Here is the task:
\`\`\`
{{task}}
\`\`\`
Now begin!`,

  INITIAL_PLAN: `You are a world expert at making efficient plans to solve any task using a set of carefully crafted tools and services.

Now for the given task, develop a step-by-step high-level plan taking into account the above inputs and list of facts.
This plan should involve individual tasks based on the available tools and services, that if executed correctly will yield the correct answer.
Do not skip steps, do not add any superfluous steps. Only write the high-level plan, DO NOT DETAIL INDIVIDUAL TOOL CALLS.
After writing the final step of the plan, write the '\\n<end_plan>' tag and stop there.

Here is your task:

Task:
\`\`\`
{{task}}
\`\`\`

Available services and capabilities:
{{services}}

List of facts that you know:
\`\`\`
{{facts}}
\`\`\`

Now begin! Write your plan below.`,

  UPDATE_PLAN: `You are currently executing a plan to solve a task. Based on your progress so far, update your plan for the remaining steps.

Original task:
\`\`\`
{{task}}
\`\`\`

Current step: {{currentStep}}

Progress so far:
{{progress}}

Available services and capabilities:
{{services}}

Update your plan for the remaining steps. Focus on what still needs to be accomplished.
After writing the updated plan, write the '\\n<end_plan>' tag and stop there.

Updated plan:`
};

/**
 * Agent class represents a single AI agent instance with kernel-aware capabilities and planning
 */
export class Agent implements IAgentInstance {
  public id: string;
  public name: string;
  public description?: string;
  public instructions?: string;
  public startupScript?: string;
  public kernelType?: KernelType;
  public kernelEnvirons?: Record<string, string>;
  public kernel?: IKernel; // Direct kernel reference, not wrapped
  // Kernel metadata - moved from IKernelInstance to agent
  public kernelId?: string;
  public kernelMode?: KernelMode;
  public kernelLanguage?: KernelLanguage;
  public kernelCreated?: Date;
  public kernelOptions?: any;
  public ModelSettings: ModelSettings;
  public maxSteps: number;
  public created: Date;
  public lastUsed?: Date;
  public conversationHistory: ChatMessage[] = [];
  public enablePlanning: boolean;
  public planningInterval?: number;
  public memory: AgentMemory;
  private stepNumber: number = 1;
  private hyphaServices: Record<string, any>;
  private startupOutput?: string; // Captured output from startup script
  private startupError?: AgentStartupError; // Captured error from startup script execution
  private manager: any; // AgentManager reference

  constructor(config: IAgentConfig, manager: any) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.instructions = config.instructions;
    this.startupScript = config.startupScript;
    this.kernelType = config.kernelType;
    this.kernelEnvirons = config.kernelEnvirons;
    this.ModelSettings = config.ModelSettings || { ...DefaultModelSettings };
    this.maxSteps = config.maxSteps || 10;
    this.created = new Date();
    this.manager = manager;
    this.enablePlanning = config.enablePlanning || false;
    this.planningInterval = config.planningInterval || undefined;
    this.memory = new AgentMemory();
    this.hyphaServices = config.hyphaServices || {};
  }

  /**
   * Validate agent output to ensure it doesn't contain observation blocks
   */
  private validateAgentOutput(content: string): void {
    // Check for observation blocks that should only be generated by the system
    const observationPattern = /<observation[^>]*>[\s\S]*?<\/observation>/gi;
    const matches = content.match(observationPattern);
    
    if (matches && matches.length > 0) {
      const errorMessage = `Agent attempted to generate observation blocks, which are reserved for system use only. Found: ${matches.length} observation block(s). Observation blocks should NEVER be included in agent responses - they are automatically generated by the system after code execution.`;
      
      console.error(`🚫 Agent ${this.id} attempted to generate observation blocks:`, matches);
      
      throw new AgentObservationError(errorMessage);
    }
  }

  /**
   * Format committed executions for display to user
   */
  private formatCommittedExecutions(): string {
    const committedExecutions = this.memory.getCommittedExecutions();
    
    if (committedExecutions.length === 0) {
      return '';
    }

    let formatted = '\n\n## Code Executions\n\n';
    
    for (const execution of committedExecutions) {
      formatted += `### Execution ${execution.completionId.slice(-8)}\n\n`;
      formatted += `**Language:** ${execution.language}\n\n`;
      formatted += `**Code:**\n\`\`\`${execution.language}\n${execution.code}\n\`\`\`\n\n`;
      
      if (execution.outputs) {
        formatted += `**Output:**\n\`\`\`\n${execution.outputs}\n\`\`\`\n\n`;
      } else {
        formatted += `**Output:** *(no output)*\n\n`;
      }
      
      formatted += '---\n\n';
    }

    return formatted;
  }

  /**
   * Generate kernel-aware system prompt with planning context
   */
  private generateSystemPrompt(basePrompt?: string): string {
    let systemPrompt = basePrompt || '';
    
    // Add agent's base instructions first
    if (this.instructions) {
      systemPrompt = this.instructions + (systemPrompt ? '\n\n' + systemPrompt : '');
    }
    
    // Add startup script output if available
    if (this.startupOutput) {
      console.log(`📋 Including startup output in system prompt for agent: ${this.id}`);
      systemPrompt += "\n" + this.startupOutput;
    }
    
    // Add kernel-specific instructions based on configured kernelType
    if (this.kernelType) {
      const kernelInstructions = this.getKernelSpecificInstructions(this.kernelType);
      systemPrompt += '\n\n' + kernelInstructions;
    }

    // Add service information
    if (Object.keys(this.hyphaServices).length > 0) {
      systemPrompt += '\n\n## Available Hypha Services\n';
      systemPrompt += 'The following services are available in your execution environment:\n';
      for (const [name, service] of Object.entries(this.hyphaServices)) {
        systemPrompt += `- **${name}**: ${service.description || 'Remote service'}\n`;
      }
      systemPrompt += '\nUse these services directly in your code as if they were local functions.\n';
    }

    // Add planning context if enabled - now only looks at agent memory
    if (this.enablePlanning) {
      const plans = this.memory.getStepsByType<PlanningStep>(StepType.PLANNING);
      if (plans.length > 0) {
        const latestPlan = plans[plans.length - 1];
        systemPrompt += '\n\n## Current Plan\n';
        systemPrompt += latestPlan.plan;
        systemPrompt += '\n\nRefer to this plan as you work through the task systematically.';
      }
    }
    
    return systemPrompt;
  }

  /**
   * Get kernel-specific instructions based on kernel type
   */
  private getKernelSpecificInstructions(kernelType: KernelType): string {
    // Check if HyphaCore service is available for this agent
    const serviceManager = this.manager?.getAgentServiceManager?.();
    const hasHyphaService = serviceManager?.hasService?.(this.id);
    
    // If no HyphaCore service is available, throw an error
    if (!hasHyphaService) {
      throw new AgentError(`Agent ${this.id} has a kernel attached but no HyphaCore service available. Kernel-based agents require HyphaCore integration for returnToUser() and logThoughts() functions.`);
    }
    
    const instructionKey = kernelType.toUpperCase() as keyof typeof CODE_EXECUTION_INSTRUCTIONS;
    return CODE_EXECUTION_INSTRUCTIONS[instructionKey] || '';
  }

  

  /**
   * Map KernelLanguage to KernelType
   */
  private mapKernelLanguageToType(kernelLanguage: KernelLanguage): KernelType {
    switch (kernelLanguage) {
      case KernelLanguage.PYTHON:
        return KernelType.PYTHON;
      case KernelLanguage.TYPESCRIPT:
        return KernelType.TYPESCRIPT;
      case KernelLanguage.JAVASCRIPT:
        return KernelType.JAVASCRIPT;
      default:
        console.warn(`Unknown kernel language: ${kernelLanguage}, defaulting to PYTHON`);
        return KernelType.PYTHON;
    }
  }

  /**
   * Execute a planning step to generate facts and plan
   */
  private async executePlanningStep(task: string, isFirstStep: boolean): Promise<void> {
    try {
      this.manager.emit(AgentEvents.PLANNING_STEP, {
        agentId: this.id,
        stepNumber: this.stepNumber,
        isFirstStep
      });

      // Generate facts
      const factsPrompt = this.populateTemplate(PLANNING_PROMPTS.INITIAL_FACTS, { task });
      const factsMessages: ChatMessage[] = [{ role: 'user', content: factsPrompt }];
      
      const factsResponse = await this.callModel(factsMessages);
      const facts = factsResponse.content || '';

      // Generate plan
      const services = this.formatServicesForPlanning();
      const planPrompt = this.populateTemplate(PLANNING_PROMPTS.INITIAL_PLAN, { 
        task, 
        facts, 
        services 
      });
      const planMessages: ChatMessage[] = [{ role: 'user', content: planPrompt }];
      
      const planResponse = await this.callModel(planMessages);
      const plan = planResponse.content?.split('<end_plan>')[0] || '';

      // Create planning step
      const planningStep: PlanningStep = {
        type: StepType.PLANNING,
        stepNumber: this.stepNumber,
        startTime: Date.now(),
        modelInputMessages: [...factsMessages, ...planMessages],
        modelOutputMessageFacts: factsResponse,
        facts,
        modelOutputMessagePlan: planResponse,
        plan,
        endTime: Date.now()
      };

      this.memory.addStep(planningStep);
      
    } catch (error) {
      console.error('Planning step failed:', error);
      throw new AgentPlanningError(`Planning failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Format available services for planning context
   */
  private formatServicesForPlanning(): string {
    const services = ['Code execution (Python/TypeScript/JavaScript)'];
    
    if (Object.keys(this.hyphaServices).length > 0) {
      for (const [name, service] of Object.entries(this.hyphaServices)) {
        services.push(`${name}: ${service.description || 'Remote service'}`);
      }
    }

    return services.map(s => `- ${s}`).join('\n');
  }

  /**
   * Populate template with variables
   */
  private populateTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  /**
   * Call the model with messages and return response
   */
  private async callModel(messages: ChatMessage[]): Promise<ChatMessage> {
    const generator = chatCompletion({
      messages,
      model: this.ModelSettings.model,
      temperature: this.ModelSettings.temperature,
      baseURL: this.ModelSettings.baseURL,
      apiKey: this.ModelSettings.apiKey,
      maxSteps: 3, // Allow limited steps for planning
      stream: false
    });

    let lastResult: any = null;
    for await (const result of generator) {
      lastResult = result;
    }

    return {
      role: 'assistant',
      content: lastResult?.content || ''
    };
  }

  /**
   * Main chat completion method with planning and step management
   */
  async *chatCompletion(
    messages: ChatMessage[], 
    options: Partial<ChatCompletionOptions> = {}
  ): AsyncGenerator<any, void, unknown> {
    this.lastUsed = new Date();
    
    // Check if startup script failed - if so, always throw that error instead of proceeding
    if (this.startupError) {
      console.error(`🚫 [Agent ${this.id}] Cannot proceed with chat - startup script failed`);
      throw this.startupError;
    }
    
    // Initialize memory for this completion session
    this.memory.reset();
    this.stepNumber = 1;
    
    // Initialize system prompt
    const systemPrompt = this.generateSystemPrompt(options.systemPrompt);
    this.memory.addStep({
      type: StepType.SYSTEM_PROMPT,
      systemPrompt,
      startTime: Date.now(),
      endTime: Date.now()
    });

    console.log(`🚀 [Agent ${this.id}] Step ${this.stepNumber}: System prompt generated`);
    console.log(`📋 System prompt:`, systemPrompt);

    // Add the user message to conversation history if not already present
    const userMessages = messages.filter(msg => msg.role === 'user');
    if (userMessages.length > 0) {
      const lastUserMessage = userMessages[userMessages.length - 1];
      
      // Add user message to conversation history if it's not already there
      if (this.conversationHistory.length === 0 || 
          this.conversationHistory[this.conversationHistory.length - 1].content !== lastUserMessage.content) {
        this.conversationHistory.push(lastUserMessage);
      }
      
      // Use only the last user message as the current task
      this.memory.addStep({
        type: StepType.TASK,
        task: lastUserMessage.content || '',
        startTime: Date.now(),
        endTime: Date.now()
      });

      // Execute planning step if enabled
      if (this.enablePlanning && this.planningInterval === 1) {
        await this.executePlanningStep(lastUserMessage.content || '', true);
      }
    }

    // Execute main agent loop
    let finalAnswer: any = null;
    let loopCount = 0;

    while (finalAnswer === null && loopCount < (options.maxSteps || this.maxSteps)) {
      const stepStartTime = Date.now();
      
      // Execute planning step if scheduled
      if (this.enablePlanning && this.planningInterval && 
          this.stepNumber % this.planningInterval === 1 && this.stepNumber > 1) {
        const currentTask = this.memory.getStepsByType<TaskStep>(StepType.TASK)[0]?.task || '';
        await this.executePlanningStep(currentTask, false);
      }

      // Create action step
      const actionStep: ActionStep = {
        type: StepType.ACTION,
        stepNumber: this.stepNumber,
        startTime: stepStartTime,
        modelInputMessages: this.memory.toMessages()
      };

      try {
        // Execute main completion step
        const systemPrompt = this.generateSystemPrompt(options.systemPrompt);
        
        // Update system prompt in memory if it has changed (e.g., due to kernel attach/detach)
        const currentSystemPrompt = this.memory.systemPrompt?.systemPrompt;
        if (currentSystemPrompt !== systemPrompt) {
          console.log(`🔄 [Agent ${this.id}] Step ${this.stepNumber}: System prompt updated (kernel state changed)`);
          this.memory.systemPrompt = {
            type: StepType.SYSTEM_PROMPT,
            systemPrompt,
            startTime: Date.now(),
            endTime: Date.now()
          };
        }
        
        const completionOptions: ChatCompletionOptions = {
          messages: messages, // Use the full conversation context from the server
          systemPrompt,
          model: options.model || this.ModelSettings.model,
          temperature: options.temperature || this.ModelSettings.temperature,
          baseURL: options.baseURL || this.ModelSettings.baseURL,
          apiKey: options.apiKey || this.ModelSettings.apiKey,
          maxSteps: Math.min(this.maxSteps, this.manager.getMaxStepsCap()), // Use agent's maxSteps config, capped at manager-configured limit
          stream: options.stream !== undefined ? options.stream : true,
          abortController: options.abortController,
          serviceManager: this.manager.getAgentServiceManager(), // Pass service manager for completion result checking
          agentId: this.id, // Pass agent ID for service checking
          agentKernelType: this.kernelType, // Pass agent's kernel type for syntax conversion decisions
          onExecuteCode: this.kernel ? 
            (async (completionId: string, code: string, language?: string): Promise<string> => {
              console.log(`🚀 [Agent ${this.id}] Step ${this.stepNumber}: Executing code`);
              console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));  
              return await this.executeCode(completionId, code, actionStep, language);
            }) : 
            options.onExecuteCode,
          onMessage: (completionId: string, message: string, commitIds?: string[]) => {
            // Validate final message before processing
            this.validateAgentOutput(message);
            
            // Include committed executions in the final answer if any exist
            const committedExecutions = this.formatCommittedExecutions();
            const finalMessage = message + committedExecutions;
            
            // This is a final answer
            finalAnswer = finalMessage;
            actionStep.actionOutput = finalMessage;
            
            this.manager.emit(AgentEvents.AGENT_MESSAGE, {
              agentId: this.id,
              completionId,
              message: finalMessage,
              originalMessage: message,
              commitIds,
              committedExecutions: this.memory.getCommittedExecutions()
            });
            
            if (options.onMessage) {
              options.onMessage(completionId, finalMessage, commitIds);
            }
          },
          onStreaming: (completionId: string, chunk: string) => {
            this.manager.emit(AgentEvents.AGENT_STREAMING, {
              agentId: this.id,
              completionId,
              chunk
            });
            
            if (options.onStreaming) {
              options.onStreaming(completionId, chunk);
            }
          }
        };

        // Track accumulated content for this step
        let stepAccumulatedContent = '';
        
        // Execute the step
        for await (const chunk of chatCompletion(completionOptions)) {
          if (chunk.type === 'text_chunk' && chunk.content) {
            // Accumulate the content for this step
            stepAccumulatedContent += chunk.content;
            
            // Don't validate during streaming - only validate final content
            // Validation during streaming can interrupt the flow if partial content triggers false positives
            
            actionStep.modelOutput = stepAccumulatedContent;
            actionStep.modelOutputMessage = {
              role: 'assistant',
              content: stepAccumulatedContent
            };
            
            // Check if this completion was concluded naturally by chatCompletion
            // (the finalAnswer is now set by the onMessage callback in chatCompletion.ts)
          } else if (chunk.type === 'text' && chunk.content) {
            // Final accumulated text - validate and store
            this.validateAgentOutput(chunk.content);
            
            actionStep.modelOutput = chunk.content;
            actionStep.modelOutputMessage = {
              role: 'assistant',
              content: chunk.content
            };
            
            // For non-kernel agents, treat the first text response as final
            if (!this.kernel && finalAnswer === null) {
              console.log(`✅ [Agent ${this.id}] Non-kernel agent completing with first response`);
              finalAnswer = chunk.content;
              actionStep.actionOutput = chunk.content;
              
              this.manager.emit(AgentEvents.AGENT_MESSAGE, {
                agentId: this.id,
                completionId: '', // No specific completion ID for non-kernel agents
                message: chunk.content,
                originalMessage: chunk.content,
                commitIds: [],
                committedExecutions: []
              });
              
              if (options.onMessage) {
                options.onMessage('', chunk.content, []);
              }
            } else if (this.kernel) {
              // For kernel agents, don't treat text chunks as final here
              // Let the reactive loop in chatCompletion.ts handle script extraction and execution
              console.log(`🔄 [Agent ${this.id}] Kernel agent received text chunk - letting reactive loop handle script extraction`);
              console.log(`📋 [Agent ${this.id}] Text chunk content:`, chunk.content.substring(0, 200));
              console.log(`📋 [Agent ${this.id}] finalAnswer is currently:`, finalAnswer === null ? 'null' : 'set');
            }
          }
          
          yield chunk;
          
          // CRITICAL FIX: Break immediately if finalAnswer has been set by returnToUser callback
          if (finalAnswer !== null) {
            console.log(`✅ [Agent ${this.id}] Step ${this.stepNumber}: Code executed successfully`);
            console.log(`📤 [Agent ${this.id}] finalAnswer set, breaking from chunk iteration`);
            break;
          }
        }

      } catch (error) {
        actionStep.error = error instanceof AgentError ? error : 
          new AgentExecutionError(`Step execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        
        this.manager.emit(AgentEvents.AGENT_ERROR, {
          agentId: this.id,
          error: actionStep.error,
          context: 'step_execution'
        });
      } finally {
        // Finalize action step
        actionStep.endTime = Date.now();
        actionStep.duration = actionStep.endTime - stepStartTime;
        this.memory.addStep(actionStep);
        
        this.stepNumber++;
        loopCount++;
      }

      // Check for max steps
      if (loopCount >= (options.maxSteps || this.maxSteps) && finalAnswer === null) {
        const errorMessage = `Reached maximum number of steps (${options.maxSteps || this.maxSteps}). Task may not be complete.`;
        this.manager.emit(AgentEvents.AGENT_ERROR, {
          agentId: this.id,
          error: new AgentMaxStepsError(errorMessage),
          context: 'max_steps_reached'
        });
        break;
      }
    }

    // Add assistant response to conversation history if we have a final answer
    if (finalAnswer !== null) {
      this.conversationHistory.push({
        role: 'assistant',
        content: finalAnswer
      });
    } else {
      // If we exit the loop without a final answer, this is an error condition
      let errorMessage = '';
      let errorType = 'execution_failed';
      
      // Check if any steps had errors
      const actionSteps = this.memory.getStepsByType<ActionStep>(StepType.ACTION);
      const errorsInSteps = actionSteps.filter(step => step.error);
      
      if (errorsInSteps.length > 0) {
        // There were execution errors
        const lastError = errorsInSteps[errorsInSteps.length - 1].error;
        errorMessage = `Agent execution failed with error: ${lastError?.message || 'Unknown error'}`;
        errorType = lastError?.context || 'execution_error';
      } else if (loopCount >= (options.maxSteps || this.maxSteps)) {
        // Reached max steps without completion
        errorMessage = `Agent reached maximum number of steps (${options.maxSteps || this.maxSteps}) without providing a final response`;
        errorType = 'max_steps_reached';
      } else {
        // Unknown reason for failure
        errorMessage = `Agent failed to generate a response after ${loopCount} step(s)`;
        errorType = 'no_response_generated';
      }
      
      console.error(`❌ [Agent ${this.id}] ${errorMessage}`);
      
      // Create and throw appropriate error
      const agentError = errorType === 'max_steps_reached' 
        ? new AgentMaxStepsError(errorMessage)
        : new AgentExecutionError(errorMessage);
      
      // Emit error event
      this.manager.emit(AgentEvents.AGENT_ERROR, {
        agentId: this.id,
        error: agentError,
        context: errorType
      });
      
      // Throw the error to propagate it to the caller
      throw agentError;
    }

    // Save conversation if auto-save is enabled
    if (this.manager.getAutoSaveConversations?.()) {
      await this.manager.saveConversation?.(this.id);
    }
  }

  /**
   * Execute startup script and capture output for system prompt
   */
  private async executeStartupScript(): Promise<void> {
    if (!this.kernel || !this.startupScript) {
      return;
    }

    console.log(`🚀 [Agent ${this.id}] Executing startup script...`);

    try {
      let startupOutput = '';
      let startupError: string | undefined;

      // Set up output capture
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernelId) {
          if (event.data.type === 'stream' && (event.data.name === 'stdout' || event.data.name === 'stderr')) {
            startupOutput += event.data.text || '';
          }
        }
      };

      // Listen for output
      this.manager.kernelManager.on('output', handleManagerEvent);

      try {
        // Execute the startup script
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernelId!, this.startupScript)
          : await this.kernel.execute(this.startupScript);

        // Store the captured output for use in system prompt
        this.startupOutput = startupOutput.trim();

        if (!result.success && result.error) {
          const errorMessage = result.error.message || 'Unknown error';
          const fullError = result.result?.traceback ? result.result.traceback.join('\n') : errorMessage;
          
          console.error(`❌ [Agent ${this.id}] Startup script failed:`, errorMessage);
          console.error(`Full error details:`, fullError);
          
          this.startupError = new AgentStartupError(
            `Startup script failed: ${errorMessage}`,
            fullError,
            result.result?.traceback?.join('\n')
          );
          
          // Don't return here - let the error propagate to attachKernel
          return;
        }

        console.log(`✅ [Agent ${this.id}] Startup script executed successfully`);
        if (this.startupOutput) {
          console.log(`📋 [Agent ${this.id}] Startup output (${this.startupOutput.length} chars):`, 
            this.startupOutput.substring(0, 200) + (this.startupOutput.length > 200 ? '...' : ''));
        }

      } finally {
        // Clean up listener
        this.manager.kernelManager.off('output', handleManagerEvent);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`💥 [Agent ${this.id}] Startup script execution exception:`, errorMessage);
      
      this.startupError = new AgentStartupError(
        `Startup script execution failed: ${errorMessage}`,
        errorMessage,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Execute code through the kernel with proper event handling
   */
  private async executeCode(completionId: string, code: string, actionStep: ActionStep, language?: string): Promise<string> {
    if (!this.kernel) {
      throw new Error("No kernel attached to agent");
    }

    console.log(`🚀 [Agent ${this.id}] Step ${this.stepNumber}: Executing code`);
    console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));

    try {
      let observations = '';
      let observationImages: string[] = [];

      // Set up output capture
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernelId) {
          if (event.data.type === 'stream' && (event.data.name === 'stdout' || event.data.name === 'stderr')) {
            observations += event.data.text || '';
          } else if (event.data.type === 'display_data' && event.data.data && event.data.data['image/png']) {
            observationImages.push(event.data.data['image/png']);
          }
        }
      };

      // Listen for output
      this.manager.kernelManager.on('output', handleManagerEvent);

      try {
        // Update completion ID for persistent wrapper functions
        const serviceManager = this.manager.getAgentServiceManager();
        let finalCode = code;
        
        if (serviceManager.hasService(this.id)) {
          // Instead of re-injecting wrapper code, just update the completion ID
          const updateCompletionIdCode = `
// Update the current completion ID for persistent wrapper functions
if (typeof globalThis.setCurrentCompletionId === 'function') {
    globalThis.setCurrentCompletionId("${completionId}");
} else {
    console.warn("⚠️ setCurrentCompletionId function not available - wrapper functions may not be injected");
}
`;
          
          // Inject completion ID update before user code
          finalCode = updateCompletionIdCode + '\n\n' + code;
          console.log(`📋 [Agent ${this.id}] Updated completion ID for persistent wrapper functions: ${completionId}`);
        } else {
          console.warn(`⚠️ [Agent ${this.id}] No HyphaCore service available - agent functions will not work`);
        }

        // Execute the code
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernelId!, finalCode)
          : await this.kernel.execute(finalCode);

        if (result.success) {
          console.log(`✅ [Agent ${this.id}] Step ${this.stepNumber}: Code executed successfully`);
        } else {
          console.log(`❌ [Agent ${this.id}] Step ${this.stepNumber}: Code execution failed -`, result.error?.message || 'Unknown error');
        }

        // For TypeScript/JavaScript kernels, also check for captured output in the result
        let capturedOutput = '';
        if (result.result && typeof result.result === 'object' && result.result.captured_output) {
          capturedOutput = result.result.captured_output;
          console.log(`📋 [Agent ${this.id}] Found captured output from TypeScript kernel: ${capturedOutput.length} chars`);
        }
        
        // Combine event-based observations with captured output from result
        const combinedObservations = (observations.trim() + (capturedOutput ? '\n' + capturedOutput : '')).trim();

        // Store observations in the action step
        actionStep.observations = combinedObservations;
        if (observationImages.length > 0) {
          actionStep.observationsImages = observationImages;
        }

        // Store code execution in memory for potential commit
        const codeExecution: CodeExecution = {
          completionId,
          code: finalCode,
          language: language || this.kernelType || 'python',
          outputs: combinedObservations,
          timestamp: Date.now(),
          committed: false
        };
        this.memory.addCodeExecution(codeExecution);

        // Log service calls if they exist (for debugging)
        const serviceCalls = serviceManager.getServiceCalls(completionId, this.id);
        let returnToUserMessage = '';
        
        if (serviceCalls) {
          if (serviceCalls.thoughts) {
            console.log(`💭 [Agent ${this.id}] Thoughts logged: ${serviceCalls.thoughts.data}`);
          }
          if (serviceCalls.returnToUser) {
            console.log(`📤 [Agent ${this.id}] returnToUser called with: ${JSON.stringify(serviceCalls.returnToUser.data)}`);
            returnToUserMessage = serviceCalls.returnToUser.data.content;
            
            // If commit IDs are provided, mark those executions as committed
            const { commitIds } = serviceCalls.returnToUser.data;
            if (commitIds && Array.isArray(commitIds)) {
              this.memory.commitExecutions(commitIds);
              console.log(`📋 [Agent ${this.id}] Committed ${commitIds.length} executions: ${commitIds.join(', ')}`);
            }
          }
        }

        // Emit code execution event
        this.manager.emit(AgentEvents.AGENT_CODE_EXECUTED, {
          agentId: this.id,
          completionId,
          stepNumber: this.stepNumber,
          code: finalCode, // Include the injected code
          result,
          observations: actionStep.observations,
          observationImages: actionStep.observationsImages
        });

        // Combine stdout/stderr observations with returnToUser message
        let executionOutput = actionStep.observations || '';
        if (returnToUserMessage) {
          if (executionOutput) {
            executionOutput += `\n\n📤 returnToUser: ${returnToUserMessage}`;
          } else {
            executionOutput = `📤 returnToUser: ${returnToUserMessage}`;
          }
        }

        // Always return observation, let chatCompletion.ts handle completion detection
        return executionOutput || 'Code executed (no output)';
      } finally {
        // Clean up listener
        this.manager.kernelManager.off('output', handleManagerEvent);
      }
    } catch (error) {
      const errorMsg = `Kernel execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.log(`💥 [Agent ${this.id}] Step ${this.stepNumber}: Kernel execution exception - ${errorMsg}`);
      actionStep.error = new AgentExecutionError(errorMsg);
      throw new Error(errorMsg);
    }
  }

  async attachKernel(kernelInstance: IKernelInstance): Promise<void> {
    const previousKernelType = this.kernelType;
    
    // Extract kernel and metadata from IKernelInstance
    this.kernel = kernelInstance.kernel;
    this.kernelId = kernelInstance.id;
    this.kernelMode = kernelInstance.mode;
    this.kernelLanguage = kernelInstance.language;
    this.kernelCreated = kernelInstance.created;
    this.kernelOptions = kernelInstance.options;
    
    // Update kernelType based on the attached kernel's language
    this.kernelType = this.mapKernelLanguageToType(kernelInstance.language);
    
    console.log(`🔗 Attached ${this.kernelType} kernel to agent: ${this.id}`);
    
    // Log if the kernel type changed
    if (previousKernelType !== this.kernelType) {
      console.log(`📝 Agent kernel type updated: ${previousKernelType || 'none'} → ${this.kernelType}`);
      
      // Clear previous startup output since the kernel type changed
      this.startupOutput = undefined;
    }
    
    this.manager.emit(AgentEvents.KERNEL_ATTACHED, {
      agentId: this.id,
      kernelId: this.kernelId,
      kernelType: this.kernelType
    });
    
    // Execute startup script if available and wait for completion
    if (this.startupScript) {
      try {
        await this.executeStartupScript();
        
        // If startup script failed, throw the error immediately so it propagates to createAgent
        if (this.startupError) {
          this.manager.emit(AgentEvents.AGENT_ERROR, {
            agentId: this.id,
            error: this.startupError,
            context: 'startup_script_execution'
          });
          throw this.startupError;
        }
      } catch (error) {
        console.error(`Failed to execute startup script for agent ${this.id}:`, error);
        const startupError = error instanceof AgentStartupError ? error : new Error(`Startup script execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        this.manager.emit(AgentEvents.AGENT_ERROR, {
          agentId: this.id,
          error: startupError,
          context: 'startup_script_execution'
        });
        throw startupError;
      }
    }
  }

  detachKernel(): void {
    if (this.kernel) {
      const kernelId = this.kernelId;
      const previousKernelType = this.kernelType;
      
      this.kernel = undefined;
      this.kernelId = undefined;
      this.kernelMode = undefined;
      this.kernelLanguage = undefined;
      this.kernelCreated = undefined;
      this.kernelOptions = undefined;
      // Clear kernelType when no kernel is attached
      this.kernelType = undefined;
      // Clear startup output since kernel is detached
      this.startupOutput = undefined;
      
      console.log(`🔗 Detached ${previousKernelType || 'unknown'} kernel from agent: ${this.id}`);
      
      this.manager.emit(AgentEvents.KERNEL_DETACHED, {
        agentId: this.id,
        kernelId,
        previousKernelType
      });
    }
  }

  updateConfig(config: Partial<IAgentConfig>): void {
    if (config.name !== undefined) this.name = config.name;
    if (config.description !== undefined) this.description = config.description;
    if (config.instructions !== undefined) this.instructions = config.instructions;
    if (config.startupScript !== undefined) {
      this.startupScript = config.startupScript;
      // Clear previous startup output when script changes
      this.startupOutput = undefined;
      // Re-execute startup script if kernel is available
      if (this.kernel && this.startupScript) {
        this.executeStartupScript().catch(error => {
          console.error(`Failed to re-execute startup script for agent ${this.id}:`, error);
        });
      }
    }
    if (config.kernelType !== undefined) this.kernelType = config.kernelType;
    if (config.kernelEnvirons !== undefined) this.kernelEnvirons = config.kernelEnvirons;
    if (config.ModelSettings !== undefined) this.ModelSettings = { ...this.ModelSettings, ...config.ModelSettings };
    if (config.maxSteps !== undefined) this.maxSteps = config.maxSteps;
    if (config.enablePlanning !== undefined) this.enablePlanning = config.enablePlanning;
    if (config.planningInterval !== undefined) this.planningInterval = config.planningInterval;
    if (config.hyphaServices !== undefined) this.hyphaServices = { ...this.hyphaServices, ...config.hyphaServices };

    this.manager.emit(AgentEvents.AGENT_UPDATED, {
      agentId: this.id,
      config
    });
  }

  destroy(): void {
    this.detachKernel();
    this.conversationHistory = [];
    this.memory.reset();
    this.manager.emit(AgentEvents.AGENT_DESTROYED, {
      agentId: this.id
    });
  }

  getStartupError(): AgentStartupError | undefined {
    return this.startupError;
  }

  /**
   * Set/overwrite the conversation history for this agent
   * @param messages Array of messages to set as the conversation history
   */
  setConversationHistory(messages: ChatMessage[]): void {
    this.conversationHistory = [...messages]; // Create a copy to avoid reference issues
    this.lastUsed = new Date();
    
    console.log(`📝 [Agent ${this.id}] Conversation history set to ${messages.length} messages`);
    
    // Emit event for conversation update
    this.manager.emit(AgentEvents.AGENT_UPDATED, {
      agentId: this.id,
      context: 'conversation_history_set',
      messageCount: messages.length
    });
  }

  /**
   * Stateless chat completion method that doesn't modify conversation history or memory
   * Acts like a pure function - takes messages, processes them, returns response without side effects
   */
  async *statelessChatCompletion(
    messages: ChatMessage[], 
    options: Partial<ChatCompletionOptions> = {}
  ): AsyncGenerator<any, void, unknown> {
    // Check if startup script failed - if so, always throw that error instead of proceeding
    if (this.startupError) {
      console.error(`🚫 [Agent ${this.id}] Cannot proceed with stateless chat - startup script failed`);
      throw this.startupError;
    }
    
    console.log(`🚀 [Agent ${this.id}] Starting stateless chat completion (no history/memory modification)`);
    
    // Generate system prompt without modifying agent state
    const systemPrompt = this.generateSystemPrompt(options.systemPrompt);
    
    console.log(`📋 [Agent ${this.id}] System prompt for stateless chat:`, systemPrompt);

    // Create completion options for stateless execution
    const completionOptions: ChatCompletionOptions = {
      messages: messages, // Use provided messages as-is
      systemPrompt,
      model: options.model || this.ModelSettings.model,
      temperature: options.temperature || this.ModelSettings.temperature,
      baseURL: options.baseURL || this.ModelSettings.baseURL,
      apiKey: options.apiKey || this.ModelSettings.apiKey,
      maxSteps: Math.min(options.maxSteps || this.maxSteps, this.manager.getMaxStepsCap()),
      stream: options.stream !== undefined ? options.stream : true,
      abortController: options.abortController,
      serviceManager: this.manager.getAgentServiceManager(), // Pass service manager for completion result checking
      agentId: this.id, // Pass agent ID for service checking
      agentKernelType: this.kernelType, // Pass agent's kernel type for syntax conversion decisions
      onExecuteCode: this.kernel ? 
        (async (completionId: string, code: string): Promise<string> => {
          console.log(`🚀 [Agent ${this.id}] Stateless execution: Executing code`);
          console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));  
          return await this.executeCodeStateless(completionId, code);
        }) : 
        options.onExecuteCode,
      onMessage: (completionId: string, message: string, commitIds?: string[]) => {
        console.log(`📤 [Agent ${this.id}] Stateless completion finished with message`);
        
        // For stateless execution, we don't format committed executions since they're not persisted
        // The message is returned as-is for stateless mode
        
        this.manager.emit(AgentEvents.AGENT_MESSAGE, {
          agentId: this.id,
          completionId,
          message,
          commitIds,
          stateless: true
        });
        
        if (options.onMessage) {
          options.onMessage(completionId, message, commitIds);
        }
      },
      onStreaming: (completionId: string, chunk: string) => {
        this.manager.emit(AgentEvents.AGENT_STREAMING, {
          agentId: this.id,
          completionId,
          chunk,
          stateless: true
        });
        
        if (options.onStreaming) {
          options.onStreaming(completionId, chunk);
        }
      }
    };

    try {
      // Execute the stateless completion
      for await (const chunk of chatCompletion(completionOptions)) {
        if (chunk.type === 'text_chunk' && chunk.content) {
          // Don't validate during streaming - only validate final content
          // Validation during streaming can interrupt the flow if partial content triggers false positives
        } else if (chunk.type === 'text' && chunk.content) {
          // Final accumulated text - validate
          this.validateAgentOutput(chunk.content);
        }
        
        yield chunk;
      }
      
      console.log(`✅ [Agent ${this.id}] Stateless chat completion finished successfully`);
      
    } catch (error) {
      console.error(`❌ [Agent ${this.id}] Stateless chat completion failed:`, error);
      
      this.manager.emit(AgentEvents.AGENT_ERROR, {
        agentId: this.id,
        error: error instanceof AgentError ? error : 
          new AgentExecutionError(`Stateless completion failed: ${error instanceof Error ? error.message : 'Unknown error'}`),
        context: 'stateless_execution',
        stateless: true
      });
      
      throw error;
    }
  }

  /**
   * Execute code for stateless completion without modifying agent state
   */
  private async executeCodeStateless(completionId: string, code: string): Promise<string> {
    if (!this.kernel) {
      throw new Error("No kernel attached to agent");
    }

    console.log(`🚀 [Agent ${this.id}] Stateless execution: Executing code`);
    console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));

    try {
      let observations = '';
      let observationImages: string[] = [];

      // Set up output capture
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernelId) {
          if (event.data.type === 'stream' && (event.data.name === 'stdout' || event.data.name === 'stderr')) {
            observations += event.data.text || '';
          } else if (event.data.type === 'display_data' && event.data.data && event.data.data['image/png']) {
            observationImages.push(event.data.data['image/png']);
          }
        }
      };

      // Listen for output
      this.manager.kernelManager.on('output', handleManagerEvent);

      try {
        // Update completion ID for persistent wrapper functions
        const serviceManager = this.manager.getAgentServiceManager();
        let finalCode = code;
        
        if (serviceManager.hasService(this.id)) {
          // Instead of re-injecting wrapper code, just update the completion ID
          const updateCompletionIdCode = `
// Update the current completion ID for persistent wrapper functions
if (typeof globalThis.setCurrentCompletionId === 'function') {
    globalThis.setCurrentCompletionId("${completionId}");
} else {
    console.warn("⚠️ setCurrentCompletionId function not available - wrapper functions may not be injected");
}
`;
          
          // Inject completion ID update before user code
          finalCode = updateCompletionIdCode + '\n\n' + code;
          console.log(`📋 [Agent ${this.id}] Updated completion ID for persistent wrapper functions (stateless): ${completionId}`);
        } else {
          console.warn(`⚠️ [Agent ${this.id}] No HyphaCore service available for stateless execution`);
        }
        
        // Execute the code
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernelId!, finalCode)
          : await this.kernel.execute(finalCode);

        if (result.success) {
          console.log(`✅ [Agent ${this.id}] Stateless execution: Code executed successfully`);
        } else {
          console.log(`❌ [Agent ${this.id}] Stateless execution: Code execution failed -`, result.error?.message || 'Unknown error');
        }

        // For TypeScript/JavaScript kernels, also check for captured output in the result
        let capturedOutput = '';
        if (result.result && typeof result.result === 'object' && result.result.captured_output) {
          capturedOutput = result.result.captured_output;
          console.log(`📋 [Agent ${this.id}] Found captured output from TypeScript kernel (stateless): ${capturedOutput.length} chars`);
        }
        
        // Combine event-based observations with captured output from result
        const combinedObservations = (observations.trim() + (capturedOutput ? '\n' + capturedOutput : '')).trim();

        // Note: For stateless execution, we don't persist code executions to agent memory
        // but we still track them temporarily for potential commit display

        // Log service calls if they exist (for debugging)
        const serviceCalls = serviceManager.getServiceCalls(completionId, this.id);
        let returnToUserMessage = '';
        
        if (serviceCalls) {
          if (serviceCalls.thoughts) {
            console.log(`💭 [Agent ${this.id}] Thoughts logged in stateless mode: ${serviceCalls.thoughts.data}`);
          }
          if (serviceCalls.returnToUser) {
            console.log(`📤 [Agent ${this.id}] returnToUser called in stateless mode: ${JSON.stringify(serviceCalls.returnToUser.data)}`);
            returnToUserMessage = serviceCalls.returnToUser.data.content;
          }
        }

        // Emit code execution event (stateless) - include execution data for display
        this.manager.emit(AgentEvents.AGENT_CODE_EXECUTED, {
          agentId: this.id,
          completionId,
          code: finalCode, // Include the injected code
          result,
          observations: combinedObservations,
          observationImages,
          stateless: true
        });

        // Combine stdout/stderr observations with returnToUser message
        let executionOutput = combinedObservations;
        if (returnToUserMessage) {
          if (executionOutput) {
            executionOutput += `\n\n📤 returnToUser: ${returnToUserMessage}`;
          } else {
            executionOutput = `📤 returnToUser: ${returnToUserMessage}`;
          }
        }

        // Always return observation, let chatCompletion.ts handle completion detection
        return executionOutput || 'Code executed (no output)';
      } finally {
        // Clean up listener
        this.manager.kernelManager.off('output', handleManagerEvent);
      }
    } catch (error) {
      const errorMsg = `Kernel execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.log(`💥 [Agent ${this.id}] Stateless execution: Kernel execution exception - ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
} 