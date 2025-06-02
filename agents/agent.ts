// Agent class for Deno App Engine
// This file contains the core Agent implementation with kernel-aware prompt generation

import { 
  chatCompletion, 
  type ChatCompletionOptions, 
  type ChatMessage,
  type ModelSettings,
  DefaultModelSettings
} from "./chatCompletion.ts";
import type { IKernelInstance } from "../kernel/mod.ts";

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
  MODEL_UPDATED = "model_updated"
}

export enum KernelType {
  PYTHON = "python",
  TYPESCRIPT = "typescript", 
  JAVASCRIPT = "javascript"
}

// Interface for agent configuration
export interface IAgentConfig {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  kernelType?: KernelType;
  ModelSettings?: ModelSettings;
  modelId?: string; // Name of model from registry
  maxSteps?: number;
  autoAttachKernel?: boolean; // Automatically attach kernel on creation
}

// Interface for agent instance
export interface IAgentInstance {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  kernelType?: KernelType;
  kernel?: IKernelInstance;
  ModelSettings: ModelSettings;
  maxSteps: number;
  created: Date;
  lastUsed?: Date;
  conversationHistory: ChatMessage[];
  chatCompletion(messages: ChatMessage[], options?: Partial<ChatCompletionOptions>): AsyncGenerator<any, void, unknown>;
  attachKernel(kernel: IKernelInstance): void;
  detachKernel(): void;
  updateConfig(config: Partial<IAgentConfig>): void;
  destroy(): void;
}

// Code execution instructions for agents with kernels
const CODE_EXECUTION_INSTRUCTIONS = {
  PYTHON: `
You are capable of solving tasks by writing and executing Python code.
You will be given a task and must plan and execute Python code snippets to achieve the goal.

Follow this iterative cycle meticulously:

1.  **Thought:** Analyze the task and the current state. Explain your reasoning for the next step, including what you need to achieve or calculate. Keep thoughts concise (max ~15 words) within <thoughts> tags.
    Example: <thoughts>Need to calculate the area, will use length * width</thoughts>

2.  **Action (Code):** Write Python code within <py-script> tags to perform the necessary actions (calculations, data manipulation, imports, package installs). Remember:
    - The code runs in a Pyodide (WebAssembly) environment.
    - Use \`import micropip\` and \`await micropip.install([...])\` for needed packages.
    - **Crucially, use \`print()\` statements** to output any results, variables, or confirmations that you will need for subsequent steps. Only printed output becomes available in the Observation.
    - Each code block gets a unique ID: <py-script id="abc123">
    Example:
    <thoughts>Calculate area and print it</thoughts>
    <py-script id="area_calc">
    length = 10
    width = 5
    area = length * width
    print(f"Calculated area: {area}")
    import micropip
    await micropip.install('numpy')
    print("Numpy installed successfully")
    </py-script>

3.  **Observation:** After your <py-script> executes, the user will provide its printed output within an <observation> tag. Carefully review this observation to inform your next thought and action.
    Example User Response:
    <observation>I have executed the code. Here are the outputs:
    \`\`\`
    Calculated area: 50
    Numpy installed successfully
    \`\`\`
    Now continue with the next step.</observation>

4.  **Final Response:** Use <returnToUser> tags to conclude the current round of conversation and return control to the user. This should be used when:
    - The task is fully completed based on your reasoning and observations
    - You need more input from the user to proceed further
    - You've reached a logical stopping point in the conversation
    - You want to provide an interim result or update to the user

    - **Code and output Preservation:** If specific code cells (<py-script>) are vital context for the final answer, preserve them using the \`commit="id1,id2,..."\` attribute.
    Example:
    <thoughts>Task complete, area calculated</thoughts>
    <returnToUser commit="area_calc">
    The calculated area is 50. Numpy was also installed as requested.
    </returnToUser>
    - **Always commit key code and outputs (images, plots etc.):**: Importantly, all the uncommitted code and output are discarded, and the user and subsequent steps will not be able to see them.

KEY RULES TO FOLLOW:
- Always start your response with <thoughts>.
- Follow <thoughts> with EITHER <py-script> OR <returnToUser>.
- State Persistence: Variables and imports persist between code executions within this session.
- Variable Scope: Only use variables defined in previous code steps within the current session or provided in the initial request.
- Define Before Use: Ensure variables are assigned/defined before you use them.
- Observation is Key: Base your next 'Thought' on the actual output in the 'Observation', not just what you intended to happen.
- Print for State: Explicitly \`print()\` anything you need to remember or use later.
- No Assumptions: Don't assume packages are installed; install them if needed.
- Clean Code: Write clear, simple Python code.
- Be Precise: Execute the user's request exactly. Don't add unasked-for functionality.
- Return to User: Use <returnToUser commit="id1,id2,..."> when you need to conclude the current round of conversation, commit code and outputs, and return control to the user. This includes when the task is complete, when you need more information, or when you've reached a logical stopping point.
- Don't Give Up: If you encounter an error, analyze the observation and try a different approach in your next thought/code cycle.

RUNTIME ENVIRONMENT:
- Pyodide (Python in WebAssembly)
- Use \`micropip\` for package installation.
- Patched \`requests\` for HTTP calls.
- Standard libraries (math, json, etc.) are generally available.
- Use \`print()\` statements to output any results, variables, or confirmations that you will need for subsequent steps. Only printed output becomes available in the Observation.
- Use \`matplotlib\` or \`plotly\` for plotting.
- To search the web, use something like:
\`\`\`
import requests
from html_to_markdown import convert_to_markdown
response = requests.get('https://www.google.com')
markdown = convert_to_markdown(response.text)
print(markdown)
\`\`\`

INTERNAL API ACCESS:
- You have access to an \`api\` object to call pre-defined internal functions.
- Example (Vision): Use \`await api.inspectImages(images=[{'url': 'data:image/png;base64,...'}], query='Describe this image')\` to visually inspect images under certain context using vision-capable models.
- Example (Chat): Use \`await api.chatCompletion(messages=[{'role': 'system', 'content': 'You are a helpful assistant.'}, {'role': 'user', 'content': 'Hello! How are you?'}], max_tokens=50)\` to perform a direct chat completion using the agent's configured model and settings. It takes a list of messages (including optional system messages) and optional max_tokens.
- Example (Chat with JSON Schema): Use \`await api.chatCompletion(messages=[{'role': 'user', 'content': 'Extract the name and age from this text: John Doe is 30 years old.'}], response_format={type: 'json_schema', json_schema: {name: 'user_info', schema: {type: 'object', properties: {name: {type: 'string'}, age: {type: 'integer'}}, required: ['name', 'age']}}})\` to force the chat response into a specific JSON structure.

IMAGE ENCODING EXAMPLE (NumPy to Base64 for API):
\`\`\`python
<thoughts>Need to encode a NumPy array image to base64 and inspect it.</thoughts>
<py-script id="img_encode_inspect">
import numpy as np
import base64
from io import BytesIO
from PIL import Image # Assuming PIL is available or installed

# Create a dummy numpy array (replace with your actual image data)
img_array = np.random.randint(0, 256, (100, 100, 3), dtype=np.uint8)

# Convert numpy array to PIL Image
pil_img = Image.fromarray(img_array)

# Save PIL image to a bytes buffer
buffer = BytesIO()
pil_img.save(buffer, format="PNG") # Or JPEG, etc.

# Encode bytes buffer to base64
base64_encoded = base64.b64encode(buffer.getvalue()).decode('utf-8')

# Create the data URL
data_url = f"data:image/png;base64,{base64_encoded}"

# --- Now you can use data_url with api.inspectImages ---
# Example (will be executed by the system if api is available):
# await api.inspectImages(images=[{'url': data_url}], query='Describe this generated image.')
# Optionally, pass a JSON schema to force the output to follow a specific schema:
# await api.inspectImages(images=[{'url': data_url}], query='find the bounding box of the image', outputSchema={...})

# Print the data URL (or parts of it) if needed for observation
print(f"Generated data URL (truncated): {data_url[:50]}...")
print("Image encoded successfully.")

</py-script>
\`\`\`

`,
  
  TYPESCRIPT: `
You are capable of solving tasks by writing and executing TypeScript code.
You will be given a task and must plan and execute TypeScript code snippets to achieve the goal.

Follow this iterative cycle meticulously:

1.  **Thought:** Analyze the task and the current state. Explain your reasoning for the next step, including what you need to achieve or calculate. Keep thoughts concise (max ~15 words) within <thoughts> tags.
    Example: <thoughts>Need to calculate the area, will use length * width</thoughts>

2.  **Action (Code):** Write TypeScript code within <t-script> tags to perform the necessary actions (calculations, data manipulation, imports). Remember:
    - The code runs in a Deno TypeScript environment.
    - Use standard Deno imports and modules.
    - **Crucially, use \`console.log()\` statements** to output any results, variables, or confirmations that you will need for subsequent steps. Only logged output becomes available in the Observation.
    - Each code block gets a unique ID: <t-script id="abc123">
    Example:
    <thoughts>Calculate area and log it</thoughts>
    <t-script id="area_calc">
    const length: number = 10;
    const width: number = 5;
    const area: number = length * width;
    console.log(\`Calculated area: \${area}\`);
    console.log("Calculation completed successfully");
    </t-script>

3.  **Observation:** After your <t-script> executes, the user will provide its logged output within an <observation> tag. Carefully review this observation to inform your next thought and action.

4.  **Final Response:** Use <returnToUser> tags to conclude the current round of conversation and return control to the user. This should be used when:
    - The task is fully completed based on your reasoning and observations
    - You need more input from the user to proceed further
    - You've reached a logical stopping point in the conversation
    - You want to provide an interim result or update to the user

KEY RULES TO FOLLOW:
- Always start your response with <thoughts>.
- Follow <thoughts> with EITHER <t-script> OR <returnToUser>.
- State Persistence: Variables and imports persist between code executions within this session.
- Use proper TypeScript types and interfaces for clarity.
- Use \`console.log()\` to output any results you need to remember or use later.
- Clean Code: Write clear, well-typed TypeScript code.
- Use modern ES6+ features and async/await when appropriate.

RUNTIME ENVIRONMENT:
- Deno TypeScript environment
- Standard Deno libraries available
- Use \`console.log()\` for output that becomes available in observations
- Modern TypeScript features supported

`,

  JAVASCRIPT: `
You are capable of solving tasks by writing and executing JavaScript code.
You will be given a task and must plan and execute JavaScript code snippets to achieve the goal.

Follow this iterative cycle meticulously:

1.  **Thought:** Analyze the task and the current state. Explain your reasoning for the next step, including what you need to achieve or calculate. Keep thoughts concise (max ~15 words) within <thoughts> tags.
    Example: <thoughts>Need to calculate the area, will use length * width</thoughts>

2.  **Action (Code):** Write JavaScript code within <t-script> tags to perform the necessary actions (calculations, data manipulation). Remember:
    - The code runs in a modern JavaScript environment with Deno
    - Use standard JavaScript/ES6+ syntax
    - **Crucially, use \`console.log()\` statements** to output any results, variables, or confirmations that you will need for subsequent steps. Only logged output becomes available in the Observation.
    - Each code block gets a unique ID: <t-script id="abc123">
    Example:
    <thoughts>Calculate area and print it</thoughts>
    <t-script id="area_calc">
    const length = 10;
    const width = 5;
    const area = length * width;
    console.log(\`Calculated area: \${area}\`);
    </t-script>

3.  **Observation:** After your <t-script> executes, the user will provide its printed output within an <observation> tag. Carefully review this observation to inform your next thought and action.
    Example User Response:
    <observation>I have executed the code. Here are the outputs:
    \`\`\`
    Calculated area: 50
    \`\`\`
    Now continue with the next step.</observation>

4.  **Final Response:** Use <returnToUser> tags to conclude the current round of conversation and return control to the user. This should be used when:
    - The task is fully completed based on your reasoning and observations
    - You need more input from the user to proceed further
    - You've reached a logical stopping point in the conversation
    - You want to provide an interim result or update to the user

    - **Code and output Preservation:** If specific code cells (<t-script>) are vital context for the final answer, preserve them using the \`commit="id1,id2,..."\` attribute.
    Example:
    <thoughts>Task complete, area calculated</thoughts>
    <returnToUser commit="area_calc">
    The calculated area is 50. The calculation was performed using JavaScript.
    </returnToUser>
    - **Always commit key code and outputs:** Importantly, all the uncommitted code and output are discarded, and the user and subsequent steps will not be able to see them.

KEY RULES TO FOLLOW:
- Always start your response with <thoughts>.
- Follow <thoughts> with EITHER <t-script> OR <returnToUser>.
- State Persistence: Variables and functions persist between code executions within this session.
- Variable Scope: Only use variables defined in previous code steps within the current session or provided in the initial request.
- Define Before Use: Ensure variables are assigned/defined before you use them.
- Observation is Key: Base your next 'Thought' on the actual output in the 'Observation', not just what you intended to happen.
- Print for State: Explicitly \`console.log()\` anything you need to remember or use later.
- Clean Code: Write clear, simple JavaScript code.
- Be Precise: Execute the user's request exactly. Don't add unasked-for functionality.
- Return to User: Use <returnToUser commit="id1,id2,..."> when you need to conclude the current round of conversation, commit code and outputs, and return control to the user. This includes when the task is complete, when you need more information, or when you've reached a logical stopping point.
- Don't Give Up: If you encounter an error, analyze the observation and try a different approach in your next thought/code cycle.

RUNTIME ENVIRONMENT:
- Modern JavaScript (ES6+) running in Deno
- Standard JavaScript APIs available
- Use \`console.log()\` statements to output any results, variables, or confirmations that you will need for subsequent steps. Only logged output becomes available in the Observation.
- For async operations, use async/await syntax
- TypeScript features can be used but are optional since this is JavaScript mode

INTERNAL API ACCESS:
- You have access to an \`api\` object to call pre-defined internal functions.
- Example (Vision): Use \`await api.inspectImages(images=[{url: 'data:image/png;base64,...'}], query='Describe this image')\` to visually inspect images under certain context using vision-capable models.
- Example (Chat): Use \`await api.chatCompletion(messages=[{role: 'system', content: 'You are a helpful assistant.'}, {role: 'user', content: 'Hello! How are you?'}], max_tokens=50)\` to perform a direct chat completion using the agent's configured model and settings. It takes a list of messages (including optional system messages) and optional max_tokens.
- Example (Chat with JSON Schema): Use \`await api.chatCompletion(messages=[{role: 'user', content: 'Extract the name and age from this text: John Doe is 30 years old.'}], response_format={type: 'json_schema', json_schema: {name: 'user_info', schema: {type: 'object', properties: {name: {type: 'string'}, age: {type: 'integer'}}, required: ['name', 'age']}}})\` to force the chat response into a specific JSON structure.

`
};

/**
 * Agent class represents a single AI agent instance with kernel-aware capabilities
 */
export class Agent implements IAgentInstance {
  public id: string;
  public name: string;
  public description?: string;
  public instructions?: string;
  public kernelType?: KernelType;
  public kernel?: IKernelInstance;
  public ModelSettings: ModelSettings;
  public maxSteps: number;
  public created: Date;
  public lastUsed?: Date;
  public conversationHistory: ChatMessage[] = [];

  private manager: any; // AgentManager reference

  constructor(config: IAgentConfig, manager: any) {
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.instructions = config.instructions;
    this.kernelType = config.kernelType;
    this.ModelSettings = config.ModelSettings || { ...DefaultModelSettings };
    this.maxSteps = config.maxSteps || 10;
    this.created = new Date();
    this.manager = manager;
  }

  /**
   * Generate kernel-aware system prompt based on agent configuration and kernel type
   * @param basePrompt Optional base prompt to append to
   * @returns Enhanced system prompt with kernel-specific instructions
   */
  private generateSystemPrompt(basePrompt?: string): string {
    let systemPrompt = basePrompt || '';
    
    // Add agent's base instructions first
    if (this.instructions) {
      systemPrompt = this.instructions + (systemPrompt ? '\n\n' + systemPrompt : '');
    }
    
    // Add kernel-specific instructions if a kernel is attached
    if (this.kernel && this.kernelType) {
      const kernelInstructions = this.getKernelSpecificInstructions(this.kernelType);
      systemPrompt += '\n\n' + kernelInstructions;
    }
    
    return systemPrompt;
  }

  /**
   * Get kernel-specific instructions based on kernel type
   * @param kernelType The type of kernel attached
   * @returns Kernel-specific instruction text
   */
  private getKernelSpecificInstructions(kernelType: KernelType): string {
    // Map KernelType enum values to instruction keys
    const instructionKey = kernelType.toUpperCase() as keyof typeof CODE_EXECUTION_INSTRUCTIONS;
    return CODE_EXECUTION_INSTRUCTIONS[instructionKey] || '';
  }

  async *chatCompletion(
    messages: ChatMessage[], 
    options: Partial<ChatCompletionOptions> = {}
  ): AsyncGenerator<any, void, unknown> {
    this.lastUsed = new Date();
    
    // Merge agent's conversation history with new messages
    const fullMessages = [...this.conversationHistory, ...messages];
    
    // Build kernel-aware system prompt
    const systemPrompt = this.generateSystemPrompt(options.systemPrompt);

    const completionOptions: ChatCompletionOptions = {
      messages: fullMessages,
      systemPrompt,
      model: options.model || this.ModelSettings.model,
      temperature: options.temperature || this.ModelSettings.temperature,
      baseURL: options.baseURL || this.ModelSettings.baseURL,
      apiKey: options.apiKey || this.ModelSettings.apiKey,
      maxSteps: options.maxSteps || this.maxSteps,
      stream: options.stream !== undefined ? options.stream : true,
      abortController: options.abortController,
      onExecuteCode: this.kernel ? 
        (async (completionId: string, code: string): Promise<string> => {
          if (!this.kernel) {
            throw new Error('No kernel attached to agent');
          }

          this.manager.emit(AgentEvents.AGENT_CODE_EXECUTED, {
            agentId: this.id,
            code,
            completionId
          });
          
          try {
            // Set up event listeners to capture stdout/stderr via the kernel manager
            let output = '';
            let hasOutput = false;
            
            // Listen to manager events for this specific kernel
            const handleManagerEvent = (event: { kernelId: string; data: any }) => {
              if (event.kernelId === this.kernel!.id) {
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
              // Execute the code through the kernel manager instead of directly
              const result = this.manager.kernelManager 
                ? await this.manager.kernelManager.execute(this.kernel.id, code)
                : await this.kernel.kernel.execute(code);
              
              // Give a moment for any remaining events to be processed
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // Clean up listeners
              if (this.manager.kernelManager) {
                this.manager.kernelManager.off('stream', handleManagerEvent);
                this.manager.kernelManager.off('execute_result', handleManagerEvent);
                this.manager.kernelManager.off('execute_error', handleManagerEvent);
              }
              
              if (result.success) {
                // Return captured output if available, otherwise success message
                return hasOutput ? output.trim() : 'Code executed successfully';
              } else {
                // Include any captured output plus the error
                const errorMsg = result.error?.message || 'Code execution failed';
                return hasOutput ? `${output.trim()}\n${errorMsg}` : errorMsg;
              }
            } catch (cleanupError) {
              // Ensure listeners are cleaned up even if execution fails
              if (this.manager.kernelManager) {
                this.manager.kernelManager.off('stream', handleManagerEvent);
                this.manager.kernelManager.off('execute_result', handleManagerEvent);
                this.manager.kernelManager.off('execute_error', handleManagerEvent);
              }
              throw cleanupError;
            }
          } catch (error) {
            throw new Error(`Kernel execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }) : 
        options.onExecuteCode,
      onMessage: (completionId: string, message: string, commitIds?: string[]) => {
        this.manager.emit(AgentEvents.AGENT_MESSAGE, {
          agentId: this.id,
          completionId,
          message,
          commitIds
        });
        
        // Update conversation history
        this.conversationHistory.push({
          role: 'assistant',
          content: message
        });
        
        if (options.onMessage) {
          options.onMessage(completionId, message, commitIds);
        }
      },
      onStreaming: (completionId: string, message: string) => {
        this.manager.emit(AgentEvents.AGENT_STREAMING, {
          agentId: this.id,
          completionId,
          message
        });
        
        if (options.onStreaming) {
          options.onStreaming(completionId, message);
        }
      }
    };

    try {
      // Add user messages to conversation history
      this.conversationHistory.push(...messages);
      
      let hasAssistantResponse = false;
      let assistantContent = '';
      
      // Start chat completion
      for await (const chunk of chatCompletion(completionOptions)) {
        if (chunk.type === 'text') {
          assistantContent = chunk.content || '';
          hasAssistantResponse = true;
        }
        yield chunk;
      }
      
      // Ensure assistant response is added to conversation history if not already added by onMessage
      if (hasAssistantResponse && assistantContent && 
          (!this.conversationHistory.length || 
           this.conversationHistory[this.conversationHistory.length - 1].role !== 'assistant' ||
           this.conversationHistory[this.conversationHistory.length - 1].content !== assistantContent)) {
        this.conversationHistory.push({
          role: 'assistant',
          content: assistantContent
        });
      }
      
      // Save conversation if auto-save is enabled
      if (this.manager.getAutoSaveConversations()) {
        await this.manager.saveConversation(this.id);
      }
    } catch (error) {
      this.manager.emit(AgentEvents.AGENT_ERROR, {
        agentId: this.id,
        error: error instanceof Error ? error : new Error('Unknown chat completion error'),
        context: 'chat_completion'
      });
      throw error;
    }
  }

  attachKernel(kernel: IKernelInstance): void {
    this.kernel = kernel;
    this.manager.emit(AgentEvents.KERNEL_ATTACHED, {
      agentId: this.id,
      kernelId: kernel.id
    });
  }

  detachKernel(): void {
    if (this.kernel) {
      const kernelId = this.kernel.id;
      this.kernel = undefined;
      this.manager.emit(AgentEvents.KERNEL_DETACHED, {
        agentId: this.id,
        kernelId
      });
    }
  }

  updateConfig(config: Partial<IAgentConfig>): void {
    if (config.name !== undefined) this.name = config.name;
    if (config.description !== undefined) this.description = config.description;
    if (config.instructions !== undefined) this.instructions = config.instructions;
    if (config.kernelType !== undefined) this.kernelType = config.kernelType;
    if (config.ModelSettings !== undefined) this.ModelSettings = { ...this.ModelSettings, ...config.ModelSettings };
    if (config.maxSteps !== undefined) this.maxSteps = config.maxSteps;

    this.manager.emit(AgentEvents.AGENT_UPDATED, {
      agentId: this.id,
      config
    });
  }

  destroy(): void {
    this.detachKernel();
    this.conversationHistory = [];
    this.manager.emit(AgentEvents.AGENT_DESTROYED, {
      agentId: this.id
    });
  }
} 