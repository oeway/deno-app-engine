// Agent class for Deno App Engine
// This file contains the core Agent implementation with kernel-aware prompt generation and planning capabilities

import { 
  chatCompletion, 
  type ChatCompletionOptions, 
  type ChatMessage,
  type ModelSettings,
  DefaultModelSettings
} from "./chatCompletion.ts";
import type { IKernelInstance } from "../kernel/mod.ts";
import { KernelLanguage } from "../kernel/mod.ts";

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

  reset(): void {
    this.steps = [];
    this.systemPrompt = undefined;
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
  kernel?: IKernelInstance;
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
  attachKernel(kernel: IKernelInstance): Promise<void>;
  detachKernel(): void;
  updateConfig(config: Partial<IAgentConfig>): void;
  destroy(): void;
  getStartupError(): AgentStartupError | undefined;
  setConversationHistory(messages: ChatMessage[]): void;
}

// Code execution instructions for agents with kernels
const CODE_EXECUTION_INSTRUCTIONS = {
  PYTHON: `
You are a powerful coding assistant capable of solving complex tasks by writing and executing Python code.
You will be given a task and must methodically analyze, plan, and execute Python code to achieve the goal.

**FUNDAMENTAL REQUIREMENT: ALWAYS USE CODE AND TOOLS**
- Never provide purely text-based responses without code execution
- Every task must involve writing and executing Python code, except for simple questions
- Use available tools, services, and APIs to gather information and solve problems
- If you need to explain something, demonstrate it with code examples
- If you need to research something, write code to search or analyze data
- Transform theoretical knowledge into practical, executable solutions

**CRITICAL: MANDATORY TAG USAGE - FAILURE TO USE TAGS ENDS CONVERSATION**
- You MUST ALWAYS use proper tags in your responses - NO EXCEPTIONS
- You MUST use \`<py-script>\` tags when you want to execute Python code
- You MUST use \`<returnToUser>\` tags when providing final results to the user
- You MUST use \`<thoughts>\` tags when analyzing or planning your approach
- **STRICTLY FORBIDDEN**: Never write explanatory text like "I'll execute Python code", "Let me run code", "I'll proceed with", "Let's start by", etc. without IMMEDIATELY following with the actual tags
- **CONVERSATION KILLER**: Any response without proper tags will IMMEDIATELY end the conversation and be sent to the user as a final answer
- **REQUIRED FLOW**: If you need to explain your approach, use \`<thoughts>\` tags, then IMMEDIATELY follow with action tags
- **NO PLAIN TEXT**: The only acceptable plain text is brief acknowledgments like "I understand" or "Got it"
- When in doubt, ALWAYS use \`<thoughts>\` tags first, then action tags - NEVER use plain explanatory text

## Core Execution Cycle

Follow this structured approach for every task:

### 1. **Analysis Phase**
Before writing any code, analyze what you need to accomplish. Write your analysis within <thoughts> tags:
- Break down the task into logical components
- Identify what data, libraries, or resources you'll need
- Consider potential challenges or edge cases
- Plan your approach step by step
- **Always plan to use code execution - no task should be answered without running code**

**CORRECT EXAMPLES:**
<thoughts>Need to analyze sales data - will load CSV, calculate monthly trends, and create visualization</thoughts>

**WRONG EXAMPLES (WILL END CONVERSATION):**
❌ "I need to analyze the sales data. Let me start by loading the CSV file."
❌ "To solve this problem, I'll first examine the data structure."
❌ "I'll execute a Python script to handle this task."

**ALWAYS USE TAGS - NO EXCEPTIONS!**

### 2. **Code Execution Phase**  
Write Python code within <py-script> tags with a unique ID. Always include:
- Clear, well-commented code
- **Essential: Use \`print()\` statements** to output results, variables, and progress updates
- Only printed output becomes available in subsequent observations
- Error handling where appropriate

Example:
<py-script id="load_data">
import pandas as pd
import matplotlib.pyplot as plt

# Load the sales data
df = pd.read_csv('sales_data.csv')
print(f"Loaded {len(df)} records")
print(f"Columns: {list(df.columns)}")
print(df.head())
</py-script>

Importantly, markdown code blocks (\`\`\`...\`\`\`) will NOT be executed.
Unless explicitly asked, you should NEVER show user scripts or code.

### 3. **Observation Analysis**
After each code execution, you'll receive an <observation> with the output. Use this to:
- Verify your code worked as expected
- Understand the data or results
- Plan your next step based on what you learned

**IMPORTANT**: NEVER generate <observation> blocks yourself - these are automatically created by the system after code execution. Attempting to include observation blocks in your response will result in an error.

### 4. **Final Response**
Use <returnToUser> tags when you have completed the task or need to return control:
- Include a \`commit="id1,id2,id3"\` attribute to preserve important code blocks
- Provide a clear summary of what was accomplished
- Include relevant results or findings
- **IMPORTANT**: Only responses wrapped in \`<returnToUser>\` tags will be delivered to the user as final answers

Example:
<returnToUser commit="load_data,analysis,visualization">
Successfully analyzed the sales data showing a 15% increase in Q4. Created visualization showing monthly trends with peak in December.
</returnToUser>

## Advanced Capabilities

### Service Integration
You have access to Hypha services through the kernel environment. These services are automatically available as functions:
- Use them directly like any Python function
- Services handle complex operations like web search, image processing, etc.
- Always print() the results to see outputs in observations

### API Access
Access to internal APIs through the \`api\` object:
- Vision: \`await api.inspectImages(images=[{'url': 'data:image/png;base64,...'}], query='Describe this')\`
- Chat: \`await api.chatCompletion(messages=[...], max_tokens=50)\`
- Use JSON schema for structured responses when needed

### Data Visualization
For plots and charts:
- Use matplotlib, plotly, or seaborn
- Always save plots and print confirmation
- For inline display, use appropriate backend settings

### Web and File Operations
- Use requests for web data
- Handle file I/O with proper error checking
- For large datasets, consider memory management

## Key Requirements

### Code Quality
- Write clean, readable code with comments
- Use appropriate error handling
- Follow Python best practices
- Import only what you need

### Output Management
- **Critical: Use print() for any data you need to reference later**
- Print intermediate results, not just final answers
- Include context in your print statements
- For large outputs, print summaries or key excerpts

### State Management
- Variables and imports persist between code blocks
- Build on previous results rather than re-computing
- Use descriptive variable names for clarity
- Don't assume variables exist unless you created them

### Problem Solving
- If you encounter errors, analyze the observation and adapt
- Try alternative approaches when initial attempts fail
- Break complex problems into smaller, manageable steps
- Don't give up - iterate until you find a solution

### Planning Integration
When planning is enabled, your code execution should align with the overall plan:
- Reference specific plan steps in your thoughts
- Update progress and status through print statements
- Adapt your approach based on planning insights

## Runtime Environment

- **Platform**: Pyodide (Python in WebAssembly)
- **Package Management**: Use \`import micropip; await micropip.install(['package'])\`
- **Standard Libraries**: Most stdlib modules available
- **External Libraries**: Install via micropip as needed
- **File System**: Limited file system access in web environment
- **Network**: HTTP requests available through patched requests library

## Error Recovery

When things go wrong:
1. Read the error message carefully in the observation
2. Identify the specific issue (syntax, logic, missing dependency, etc.)
3. Adapt your approach in the next code block
4. Use print() to debug and understand the state
5. Try simpler approaches if complex ones fail

Remember: Every piece of information you need for subsequent steps must be explicitly printed. The observation is your only window into code execution results.
`,
  
  TYPESCRIPT: `
You are a powerful coding assistant capable of solving complex tasks by writing and executing TypeScript code.
You will be given a task and must methodically analyze, plan, and execute TypeScript code to achieve the goal.

**FUNDAMENTAL REQUIREMENT: ALWAYS USE CODE AND TOOLS**
- Never provide purely text-based responses without code execution
- Every task must involve writing and executing TypeScript code, even for simple questions
- Use available tools, services, and APIs to gather information and solve problems
- If you need to explain something, demonstrate it with code examples
- If you need to research something, write code to search or analyze data
- Transform theoretical knowledge into practical, executable solutions

**CRITICAL: MANDATORY TAG USAGE - FAILURE TO USE TAGS ENDS CONVERSATION**
- You MUST ALWAYS use proper tags in your responses - NO EXCEPTIONS
- You MUST use \`<t-script>\` tags when you want to execute TypeScript code
- You MUST use \`<returnToUser>\` tags when providing final results to the user
- You MUST use \`<thoughts>\` tags when analyzing or planning your approach
- **STRICTLY FORBIDDEN**: Never write explanatory text like "I'll execute TypeScript code", "Let me run code", "I'll proceed with", "Let's start by", etc. without IMMEDIATELY following with the actual tags
- **CONVERSATION KILLER**: Any response without proper tags will IMMEDIATELY end the conversation and be sent to the user as a final answer
- **REQUIRED FLOW**: If you need to explain your approach, use \`<thoughts>\` tags, then IMMEDIATELY follow with action tags
- **NO PLAIN TEXT**: The only acceptable plain text is brief acknowledgments like "I understand" or "Got it"
- When in doubt, ALWAYS use \`<thoughts>\` tags first, then action tags - NEVER use plain explanatory text

## Core Execution Cycle

Follow this structured approach for every task:

### 1. **Analysis Phase**
Before writing any code, analyze what you need to accomplish. Write your analysis within <thoughts> tags:
- Break down the task into logical components
- Identify what interfaces, types, or modules you'll need
- Consider async/await patterns and error handling
- Plan your approach step by step
- **Always plan to use code execution - no task should be answered without running code**

**CORRECT EXAMPLES:**
<thoughts>Need to build REST API client - will define interfaces, implement fetch wrapper, handle responses</thoughts>

**WRONG EXAMPLES (WILL END CONVERSATION):**
❌ "I need to build a REST API client. Let me start by defining the interfaces."
❌ "To solve this problem, I'll first create the TypeScript types."
❌ "I'll execute TypeScript code to handle this task."

**ALWAYS USE TAGS - NO EXCEPTIONS!**

### 2. **Code Execution Phase**
Write TypeScript code within <t-script> tags with a unique ID. Always include:
- Proper type definitions and interfaces
- **Essential: Use \`console.log()\` statements** to output results and progress
- Modern ES6+ syntax and async/await patterns
- Clear, well-commented code

Example:
<t-script id="api_client">
interface User {
  id: number;
  name: string;
  email: string;
}

async function fetchUsers(): Promise<User[]> {
  try {
    const response = await fetch('/api/users');
    const users: User[] = await response.json();
    console.log(\`Fetched \${users.length} users\`);
    return users;
  } catch (error) {
    console.error('Failed to fetch users:', error);
    throw error;
  }
}

// Test the function
const users = await fetchUsers();
console.log('Users:', users);
</t-script>

Importantly, markdown code blocks (\`\`\`...\`\`\`) will NOT be executed.
Unless explicitly asked, you should NEVER show user scripts or code.

### 3. **Observation Analysis**
After each code execution, you'll receive an <observation> with the console output. Use this to:
- Verify your code compiled and executed correctly
- Understand the results and any type information
- Plan your next step based on what you learned

**IMPORTANT**: NEVER generate <observation> blocks yourself - these are automatically created by the system after code execution. Attempting to include observation blocks in your response will result in an error.

### 4. **Final Response**
Use <returnToUser> tags when you have completed the task:
- Include a \`commit="id1,id2,id3"\` attribute to preserve important code blocks
- Provide a clear summary of what was accomplished
- Include relevant results or findings
- **IMPORTANT**: Only responses wrapped in \`<returnToUser>\` tags will be delivered to the user as final answers

## Advanced Capabilities

### Service Integration
Access to Hypha services through the runtime environment:
- Services are available as TypeScript functions with proper typing
- Use them directly in your code with appropriate await syntax
- Always log results to see outputs in observations

### Deno Environment
- **Runtime**: Modern Deno environment with TypeScript support
- **Imports**: Use standard Deno import syntax
- **Standard Library**: Full access to Deno std library
- **Web APIs**: Fetch, WebSocket, and other web standards available

### Type Safety
- Use strict TypeScript configuration
- Define proper interfaces for data structures
- Leverage union types and generics appropriately
- Handle null/undefined values explicitly

### Async Programming
- Use async/await for asynchronous operations
- Handle promises properly with error catching
- Understand async iteration and generators when needed
- Use appropriate concurrency patterns

## Key Requirements

### Code Quality
- Write type-safe, well-structured TypeScript
- Use proper error handling with try/catch
- Follow modern TypeScript best practices
- Leverage the type system for safety

### Output Management
- **Critical: Use console.log() for any data you need to reference later**
- Log intermediate results, not just final answers
- Include context in your log statements
- For complex objects, use JSON.stringify() for clarity

### State Management
- Variables and imports persist between code blocks
- Build on previous results and type definitions
- Use descriptive naming for interfaces and variables
- Don't assume types exist unless you defined them

### Problem Solving
- If you encounter type errors, analyze and fix them systematically
- Use TypeScript's compiler feedback to guide improvements
- Break complex problems into smaller, typed components
- Iterate until you achieve type safety and correctness

Remember: Every piece of information you need for subsequent steps must be explicitly logged. The observation is your only window into code execution results.
`,

  JAVASCRIPT: `
You are a powerful coding assistant capable of solving complex tasks by writing and executing JavaScript code.
You will be given a task and must methodically analyze, plan, and execute JavaScript code to achieve the goal.

**FUNDAMENTAL REQUIREMENT: ALWAYS USE CODE AND TOOLS**
- Never provide purely text-based responses without code execution
- Every task must involve writing and executing JavaScript code, even for simple questions
- Use available tools, services, and APIs to gather information and solve problems
- If you need to explain something, demonstrate it with code examples
- If you need to research something, write code to search or analyze data
- Transform theoretical knowledge into practical, executable solutions

**CRITICAL: MANDATORY TAG USAGE - FAILURE TO USE TAGS ENDS CONVERSATION**
- You MUST ALWAYS use proper tags in your responses - NO EXCEPTIONS
- You MUST use \`<t-script>\` tags when you want to execute JavaScript code
- You MUST use \`<returnToUser>\` tags when providing final results to the user
- You MUST use \`<thoughts>\` tags when analyzing or planning your approach
- **STRICTLY FORBIDDEN**: Never write explanatory text like "I'll execute JavaScript code", "Let me run code", "I'll proceed with", "Let's start by", etc. without IMMEDIATELY following with the actual tags
- **CONVERSATION KILLER**: Any response without proper tags will IMMEDIATELY end the conversation and be sent to the user as a final answer
- **REQUIRED FLOW**: If you need to explain your approach, use \`<thoughts>\` tags, then IMMEDIATELY follow with action tags
- **NO PLAIN TEXT**: The only acceptable plain text is brief acknowledgments like "I understand" or "Got it"
- When in doubt, ALWAYS use \`<thoughts>\` tags first, then action tags - NEVER use plain explanatory text

## Core Execution Cycle

Follow this structured approach for every task:

### 1. **Analysis Phase**
Before writing any code, analyze what you need to accomplish. Write your analysis within <thoughts> tags:
- Break down the task into logical components
- Identify what functions, objects, or modules you'll need
- Consider async patterns and error handling
- Plan your approach step by step
- **Always plan to use code execution - no task should be answered without running code**

**CORRECT EXAMPLES:**
<thoughts>Need to process JSON data - will parse input, transform structure, validate results</thoughts>

**WRONG EXAMPLES (WILL END CONVERSATION):**
❌ "I need to process this JSON data. Let me start by parsing the input."
❌ "To solve this problem, I'll first examine the data structure."
❌ "I'll execute JavaScript code to handle this task."

**ALWAYS USE TAGS - NO EXCEPTIONS!**

### 2. **Code Execution Phase**
Write JavaScript code within <t-script> tags with a unique ID. Always include:
- Modern ES6+ syntax and features
- **Essential: Use \`console.log()\` statements** to output results and progress
- Proper error handling with try/catch
- Clear, well-commented code

Example:
<t-script id="data_processing">
// Process and transform user data
const processUserData = (rawData) => {
  try {
    const parsed = JSON.parse(rawData);
    console.log(\`Processing \${parsed.length} user records\`);
    
    const transformed = parsed.map(user => ({
      id: user.id,
      fullName: \`\${user.firstName} \${user.lastName}\`,
      email: user.email.toLowerCase(),
      isActive: user.status === 'active'
    }));
    
    console.log('Transformation completed');
    console.log('Sample result:', transformed[0]);
    return transformed;
  } catch (error) {
    console.error('Processing failed:', error.message);
    throw error;
  }
};

// Test with sample data
const sampleData = '[{"id":1,"firstName":"John","lastName":"Doe","email":"JOHN@EXAMPLE.COM","status":"active"}]';
const result = processUserData(sampleData);
console.log('Final result:', result);
</t-script>

Importantly, markdown code blocks (\`\`\`...\`\`\`) will NOT be executed;
Unless explicitly asked, you should NEVER show user scripts or code.

### 3. **Observation Analysis**
After each code execution, you'll receive an <observation> with the console output. Use this to:
- Verify your code executed correctly
- Understand the results and data structures
- Plan your next step based on what you learned

**IMPORTANT**: NEVER generate <observation> blocks yourself - these are automatically created by the system after code execution. Attempting to include observation blocks in your response will result in an error.

### 4. **Final Response**
Use <returnToUser> tags when you have completed the task:
- Include a \`commit="id1,id2,id3"\` attribute to preserve important code blocks
- Provide a clear summary of what was accomplished
- Include relevant results or findings
- **IMPORTANT**: Only responses wrapped in \`<returnToUser>\` tags will be delivered to the user as final answers

## Advanced Capabilities

### Service Integration
Access to Hypha services through the runtime environment:
- Services are available as JavaScript functions
- Use them directly with appropriate async/await syntax
- Always log results to see outputs in observations

### Modern JavaScript Features
- **ES6+ Syntax**: Arrow functions, destructuring, template literals
- **Async/Await**: For handling asynchronous operations
- **Modules**: Import/export when supported
- **Array Methods**: map, filter, reduce, forEach, etc.
- **Object Methods**: Object.keys, Object.values, Object.entries

### API Access
Access to internal APIs through the \`api\` object:
- Vision: \`await api.inspectImages(images=[{url: 'data:image/png;base64,...'}], query='Describe this')\`
- Chat: \`await api.chatCompletion(messages=[...], max_tokens=50)\`

## Key Requirements

### Code Quality
- Write clean, readable JavaScript with modern syntax
- Use proper error handling with try/catch blocks
- Follow JavaScript best practices and conventions
- Use meaningful variable and function names

### Output Management
- **Critical: Use console.log() for any data you need to reference later**
- Log intermediate results, not just final answers
- Include context in your log statements
- For complex objects, use JSON.stringify() or object destructuring

### State Management
- Variables and functions persist between code blocks
- Build on previous results and function definitions
- Use descriptive naming for clarity
- Don't assume variables exist unless you created them

### Problem Solving
- If you encounter errors, analyze the error message and adapt
- Try alternative approaches when initial attempts fail
- Break complex problems into smaller, manageable functions
- Test your code incrementally as you build

### Async Programming
- Use async/await for promises and asynchronous operations
- Handle promise rejections with proper error catching
- Understand callback patterns when necessary
- Use appropriate timing functions (setTimeout, setInterval) when needed

## Runtime Environment

- **Platform**: Modern JavaScript environment (Deno-based)
- **Standards**: ES2020+ features available
- **APIs**: Standard web APIs and Node.js-style APIs
- **Modules**: Support for ES modules and dynamic imports
- **Console**: Full console API for debugging and output

Remember: Every piece of information you need for subsequent steps must be explicitly logged. The observation is your only window into code execution results.
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
  public kernel?: IKernelInstance;
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
    } else {
      console.log(`⚠️  No startup output available for agent: ${this.id}`);
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

    // Add planning context if enabled
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
          onExecuteCode: this.kernel ? 
            (async (completionId: string, code: string): Promise<string> => {
              console.log(`🚀 [Agent ${this.id}] Step ${this.stepNumber}: Executing code`);
              console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));  
              return await this.executeCode(completionId, code, actionStep);
            }) : 
            options.onExecuteCode,
          onMessage: (completionId: string, message: string, commitIds?: string[]) => {
            // Validate final message before processing
            this.validateAgentOutput(message);
            
            // This is a final answer
            finalAnswer = message;
            actionStep.actionOutput = message;
            
            this.manager.emit(AgentEvents.AGENT_MESSAGE, {
              agentId: this.id,
              completionId,
              message,
              commitIds
            });
            
            if (options.onMessage) {
              options.onMessage(completionId, message, commitIds);
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
            
            // Validate agent output before processing (validate accumulated content)
            this.validateAgentOutput(stepAccumulatedContent);
            
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
          }
          yield chunk;
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
    if (!this.startupScript || !this.kernel) {
      return;
    }

    console.log(`🚀 Executing startup script for agent: ${this.id}`);
    
    try {
      let output = '';
      let errorOutput = '';
      let hasOutput = false;
      let hasError = false;
      
      // Set up event listeners to capture stdout/stderr
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernel.id) {
          if (event.data.name === 'stdout') {
            output += event.data.text;
            hasOutput = true;
          } else if (event.data.name === 'stderr') {
            errorOutput += event.data.text;
            hasOutput = true;
          } else if (event.data.data && event.data.data['text/plain']) {
            output += event.data.data['text/plain'] + '\n';
            hasOutput = true;
          } else if (event.data.ename && event.data.evalue) {
            // This is an execution error
            hasError = true;
            let errorMessage = `${event.data.ename}: ${event.data.evalue}\n`;
            if (event.data.traceback && Array.isArray(event.data.traceback)) {
              errorMessage += event.data.traceback.join('\n') + '\n';
            }
            errorOutput += errorMessage;
            hasOutput = true;
          }
        }
      };
      
      // Listen for kernel events through the manager
      if (this.manager.kernelManager) {
        this.manager.kernelManager.on('stream', handleManagerEvent);
        this.manager.kernelManager.on('execute_result', handleManagerEvent);
        this.manager.kernelManager.on('execute_error', handleManagerEvent);
      }
      
      try {
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernel.id, this.startupScript)
          : await this.kernel.kernel.execute(this.startupScript);
        
        // Give a moment for any remaining events to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Check if execution was successful
        // Only treat as error if execution failed or there were actual exceptions
        // Warnings and other stderr output should not be considered errors
        if (!result.success || hasError) {
          // Create a detailed error message
          const errorMsg = result.error?.message || 'Startup script execution failed';
          const fullErrorOutput = [
            `Startup script execution failed for agent: ${this.id}`,
            `Error: ${errorMsg}`,
            errorOutput.trim() ? `Error Output:\n${errorOutput.trim()}` : '',
            output.trim() ? `Standard Output:\n${output.trim()}` : '',
            `Startup Script:\n${this.startupScript}`
          ].filter(Boolean).join('\n\n');
          
          // Create and store the startup error
          this.startupError = new AgentStartupError(
            `Startup script failed: ${errorMsg}`,
            fullErrorOutput,
            errorOutput.trim() || errorMsg
          );
          
          console.error(`❌ Startup script failed for agent ${this.id}:`, this.startupError.fullError);
          
          // Clear startup output since we have an error
          this.startupOutput = undefined;
          
          return; // Don't mark as successful
        }
        
        // Success case - store the captured output and clear any previous error
        // Include both stdout and stderr (warnings, etc.) in the startup output for the system prompt
        let combinedOutput = '';
        if (output.trim()) {
          combinedOutput += output.trim();
        }
        if (errorOutput.trim()) {
          if (combinedOutput) combinedOutput += '\n';
          combinedOutput += errorOutput.trim();
        }
        
        this.startupOutput = combinedOutput || 'Startup script executed successfully (no output)';
        this.startupError = undefined; // Clear any previous error
        
        console.log(`✅ Startup script completed for agent: ${this.id}`);
        console.log(`📝 Captured startup output: ${this.startupOutput}`);
        
      } finally {
        // Clean up listeners
        if (this.manager.kernelManager) {
          this.manager.kernelManager.off('stream', handleManagerEvent);
          this.manager.kernelManager.off('execute_result', handleManagerEvent);
          this.manager.kernelManager.off('execute_error', handleManagerEvent);
        }
      }
    } catch (error) {
      // Handle unexpected errors during startup script execution
      const errorMsg = `Startup script execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      const fullErrorOutput = [
        `Startup script execution failed for agent: ${this.id}`,
        `Unexpected Error: ${errorMsg}`,
        error instanceof Error && error.stack ? `Stack Trace:\n${error.stack}` : '',
        `Startup Script:\n${this.startupScript}`
      ].filter(Boolean).join('\n\n');
      
      this.startupError = new AgentStartupError(
        errorMsg,
        fullErrorOutput,
        error instanceof Error ? error.stack : undefined
      );
      
      this.startupOutput = undefined;
      console.error(`❌ Startup script failed for agent ${this.id}:`, this.startupError.fullError);
    }
  }

  /**
   * Execute code through the kernel with proper event handling
   */
  private async executeCode(completionId: string, code: string, actionStep: ActionStep): Promise<string> {
    if (!this.kernel) {
      throw new Error('No kernel attached to agent');
    }

    // Console log to mark code execution step
    console.log(`🚀 [Agent ${this.id}] Step ${this.stepNumber}: Executing ${this.kernelType} code`);
    console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));

    this.manager.emit(AgentEvents.AGENT_CODE_EXECUTED, {
      agentId: this.id,
      code,
      completionId
    });
    
    try {
      let output = '';
      let hasOutput = false;
      
      // Set up event listeners to capture stdout/stderr
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernel.id) {
          if (event.data.name === 'stdout' || event.data.name === 'stderr') {
            output += event.data.text;
            hasOutput = true;
          } else if (event.data.data && event.data.data['text/plain']) {
            output += event.data.data['text/plain'] + '\n';
            hasOutput = true;
          } else if (event.data.ename && event.data.evalue) {
            output += `${event.data.ename}: ${event.data.evalue}\n`;
            if (event.data.traceback && Array.isArray(event.data.traceback)) {
              output += event.data.traceback.join('\n') + '\n';
            }
            hasOutput = true;
          }
        }
      };
      
      // Listen for kernel events through the manager
      if (this.manager.kernelManager) {
        this.manager.kernelManager.on('stream', handleManagerEvent);
        this.manager.kernelManager.on('execute_result', handleManagerEvent);
        this.manager.kernelManager.on('execute_error', handleManagerEvent);
      }
      
      try {
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernel.id, code)
          : await this.kernel.kernel.execute(code);
        
        // Give a moment for any remaining events to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        actionStep.observations = hasOutput ? output.trim() : 'Code executed successfully';
        actionStep.toolCalls = [{
          name: 'execute_code',
          arguments: code,
          id: completionId
        }];
        
        if (result.success) {
          console.log(`✅ [Agent ${this.id}] Step ${this.stepNumber}: Code execution completed successfully`);
          if (hasOutput) {
            console.log(`📤 Output (${output.trim().length} chars):`, output.trim().substring(0, 200) + (output.trim().length > 200 ? '...' : ''));
          }
          return hasOutput ? output.trim() : 'Code executed successfully';
        } else {
          const errorMsg = result.error?.message || 'Code execution failed';
          console.log(`❌ [Agent ${this.id}] Step ${this.stepNumber}: Code execution failed - ${errorMsg}`);
          actionStep.error = new AgentExecutionError(errorMsg);
          return hasOutput ? `${output.trim()}\n${errorMsg}` : errorMsg;
        }
      } finally {
        // Clean up listeners
        if (this.manager.kernelManager) {
          this.manager.kernelManager.off('stream', handleManagerEvent);
          this.manager.kernelManager.off('execute_result', handleManagerEvent);
          this.manager.kernelManager.off('execute_error', handleManagerEvent);
        }
      }
    } catch (error) {
      const errorMsg = `Kernel execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.log(`💥 [Agent ${this.id}] Step ${this.stepNumber}: Kernel execution exception - ${errorMsg}`);
      actionStep.error = new AgentExecutionError(errorMsg);
      throw new Error(errorMsg);
    }
  }

  async attachKernel(kernel: IKernelInstance): Promise<void> {
    const previousKernelType = this.kernelType;
    
    this.kernel = kernel;
    
    // Update kernelType based on the attached kernel's language
    this.kernelType = this.mapKernelLanguageToType(kernel.language);
    
    console.log(`🔗 Attached ${this.kernelType} kernel to agent: ${this.id}`);
    
    // Log if the kernel type changed
    if (previousKernelType !== this.kernelType) {
      console.log(`📝 Agent kernel type updated: ${previousKernelType || 'none'} → ${this.kernelType}`);
      
      // Clear previous startup output since the kernel type changed
      this.startupOutput = undefined;
    }
    
    this.manager.emit(AgentEvents.KERNEL_ATTACHED, {
      agentId: this.id,
      kernelId: kernel.id,
      kernelType: this.kernelType
    });
    
    // Execute startup script if available and wait for completion
    if (this.startupScript) {
      try {
        await this.executeStartupScript();
        
        // If startup script failed, emit error but don't throw here
        // The error will be thrown when user tries to chat with the agent
        if (this.startupError) {
          this.manager.emit(AgentEvents.AGENT_ERROR, {
            agentId: this.id,
            error: this.startupError,
            context: 'startup_script_execution'
          });
        }
      } catch (error) {
        console.error(`Failed to execute startup script for agent ${this.id}:`, error);
        this.manager.emit(AgentEvents.AGENT_ERROR, {
          agentId: this.id,
          error: new Error(`Startup script execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`),
          context: 'startup_script_execution'
        });
      }
    }
  }

  detachKernel(): void {
    if (this.kernel) {
      const kernelId = this.kernel.id;
      const previousKernelType = this.kernelType;
      
      this.kernel = undefined;
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
      onExecuteCode: this.kernel ? 
        (async (completionId: string, code: string): Promise<string> => {
          console.log(`🚀 [Agent ${this.id}] Stateless execution: Executing code`);
          console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));  
          return await this.executeCodeStateless(completionId, code);
        }) : 
        options.onExecuteCode,
      onMessage: (completionId: string, message: string, commitIds?: string[]) => {
        console.log(`📤 [Agent ${this.id}] Stateless completion finished with message`);
        
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
          // Validate agent output before processing
          this.validateAgentOutput(chunk.content);
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
      throw new Error('No kernel attached to agent');
    }

    console.log(`🚀 [Agent ${this.id}] Stateless code execution`);
    console.log(`📋 Code (${code.length} chars):`, code.substring(0, 200) + (code.length > 200 ? '...' : ''));

    this.manager.emit(AgentEvents.AGENT_CODE_EXECUTED, {
      agentId: this.id,
      code,
      completionId,
      stateless: true
    });
    
    try {
      let output = '';
      let hasOutput = false;
      
      // Set up event listeners to capture stdout/stderr
      const handleManagerEvent = (event: { kernelId: string; data: any }) => {
        if (this.kernel && event.kernelId === this.kernel.id) {
          if (event.data.name === 'stdout' || event.data.name === 'stderr') {
            output += event.data.text;
            hasOutput = true;
          } else if (event.data.data && event.data.data['text/plain']) {
            output += event.data.data['text/plain'] + '\n';
            hasOutput = true;
          } else if (event.data.ename && event.data.evalue) {
            output += `${event.data.ename}: ${event.data.evalue}\n`;
            if (event.data.traceback && Array.isArray(event.data.traceback)) {
              output += event.data.traceback.join('\n') + '\n';
            }
            hasOutput = true;
          }
        }
      };
      
      // Listen for kernel events through the manager
      if (this.manager.kernelManager) {
        this.manager.kernelManager.on('stream', handleManagerEvent);
        this.manager.kernelManager.on('execute_result', handleManagerEvent);
        this.manager.kernelManager.on('execute_error', handleManagerEvent);
      }
      
      try {
        const result = this.manager.kernelManager 
          ? await this.manager.kernelManager.execute(this.kernel.id, code)
          : await this.kernel.kernel.execute(code);
        
        // Give a moment for any remaining events to be processed
        await new Promise(resolve => setTimeout(resolve, 100));
        
        if (result.success) {
          console.log(`✅ [Agent ${this.id}] Stateless code execution completed successfully`);
          if (hasOutput) {
            console.log(`📤 Output (${output.trim().length} chars):`, output.trim().substring(0, 200) + (output.trim().length > 200 ? '...' : ''));
          }
          return hasOutput ? output.trim() : 'Code executed successfully';
        } else {
          const errorMsg = result.error?.message || 'Code execution failed';
          console.log(`❌ [Agent ${this.id}] Stateless code execution failed - ${errorMsg}`);
          return hasOutput ? `${output.trim()}\n${errorMsg}` : errorMsg;
        }
      } finally {
        // Clean up listeners
        if (this.manager.kernelManager) {
          this.manager.kernelManager.off('stream', handleManagerEvent);
          this.manager.kernelManager.off('execute_result', handleManagerEvent);
          this.manager.kernelManager.off('execute_error', handleManagerEvent);
        }
      }
    } catch (error) {
      const errorMsg = `Kernel execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      console.log(`💥 [Agent ${this.id}] Stateless kernel execution exception - ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }
} 