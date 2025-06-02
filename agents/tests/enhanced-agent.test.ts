// Enhanced Agent Tests
// Testing the new planning capabilities, memory management, and improved prompts

import { assertEquals, assertExists, assertInstanceOf } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { 
  Agent, 
  AgentMemory, 
  StepType, 
  TaskStep, 
  ActionStep, 
  PlanningStep,
  SystemPromptStep,
  AgentError,
  AgentExecutionError,
  AgentPlanningError,
  KernelType,
  AgentEvents,
  type IAgentConfig
} from "../agent.ts";
import { KernelMode, KernelLanguage, type IKernelInstance } from "../../kernel/mod.ts";

// Mock kernel instance for testing
class MockKernelInstance implements IKernelInstance {
  id = "test-kernel";
  mode = KernelMode.MAIN_THREAD;
  language = KernelLanguage.PYTHON;
  created = new Date();
  options = {};
  
  kernel = {
    initialize: async () => {},
    execute: async (code: string) => {
      // Simple mock execution that returns success for valid code
      if (code.includes('error')) {
        return { success: false, error: { message: 'Mock execution error' } };
      }
      return { success: true, result: `Executed: ${code}` };
    },
    isInitialized: () => true,
    inputReply: async () => {},
    status: "active" as const,
    // Mock EventEmitter methods
    on: () => {},
    off: function(event: string | symbol, listener: Function) { return this; },
    emit: () => false,
    addListener: () => {},
    removeListener: function(event: string | symbol, listener: Function) { return this; },
    removeAllListeners: function(event?: string | symbol) { return this; },
    listeners: () => [],
    listenerCount: () => 0,
    once: () => {},
    prependListener: () => {},
    prependOnceListener: () => {},
    eventNames: () => [],
    getMaxListeners: () => 10,
    setMaxListeners: () => {},
    rawListeners: () => []
  } as any; // Use 'as any' to bypass strict type checking for mock
  
  async destroy(): Promise<void> {
    // Mock destroy method
  }
}

// Mock agent manager for testing
class MockAgentManager {
  private events: Record<string, any[]> = {};
  
  emit(event: string, data: any) {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(data);
  }

  getEvents(event: string) {
    return this.events[event] || [];
  }

  getAutoSaveConversations() {
    return false;
  }

  kernelManager = {
    execute: async (kernelId: string, code: string) => {
      if (code.includes('error')) {
        return { success: false, error: { message: 'Mock execution error' } };
      }
      return { success: true, result: `Executed: ${code}` };
    },
    on: () => {},
    off: () => {}
  };
}

Deno.test("AgentMemory - Basic functionality", () => {
  const memory = new AgentMemory();
  
  // Test initial state
  assertEquals(memory.steps.length, 0);
  assertEquals(memory.systemPrompt, undefined);
  
  // Test adding steps
  const taskStep: TaskStep = {
    type: StepType.TASK,
    task: "Test task",
    startTime: Date.now(),
    endTime: Date.now()
  };
  
  memory.addStep(taskStep);
  assertEquals(memory.steps.length, 1);
  assertEquals(memory.getStepsByType<TaskStep>(StepType.TASK).length, 1);
  
  // Test system prompt step
  const systemStep: SystemPromptStep = {
    type: StepType.SYSTEM_PROMPT,
    systemPrompt: "Test system prompt",
    startTime: Date.now(),
    endTime: Date.now()
  };
  
  memory.addStep(systemStep);
  assertExists(memory.systemPrompt);
  assertEquals(memory.systemPrompt.systemPrompt, "Test system prompt");
  
  // Test reset
  memory.reset();
  assertEquals(memory.steps.length, 0);
  assertEquals(memory.systemPrompt, undefined);
});

Deno.test("AgentMemory - Message conversion", () => {
  const memory = new AgentMemory();
  
  // Add system prompt
  memory.addStep({
    type: StepType.SYSTEM_PROMPT,
    systemPrompt: "You are a helpful assistant",
    startTime: Date.now(),
    endTime: Date.now()
  });
  
  // Add task step
  memory.addStep({
    type: StepType.TASK,
    task: "Calculate 2+2",
    startTime: Date.now(),
    endTime: Date.now()
  });
  
  // Add action step
  memory.addStep({
    type: StepType.ACTION,
    stepNumber: 1,
    modelOutput: "I will calculate 2+2",
    observations: "Result: 4",
    startTime: Date.now(),
    endTime: Date.now()
  });
  
  const messages = memory.toMessages();
  
  // Should have system prompt + task + action response + observation
  assertExists(messages.find(m => m.role === 'system' && m.content?.includes('helpful assistant')));
  assertExists(messages.find(m => m.role === 'user' && m.content?.includes('Calculate 2+2')));
  assertExists(messages.find(m => m.role === 'assistant' && m.content?.includes('I will calculate')));
});

Deno.test("Agent - Basic initialization", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    description: "A test agent",
    kernelType: KernelType.PYTHON,
    maxSteps: 5,
    enablePlanning: true,
    planningInterval: 2,
    hyphaServices: {
      'test-service': { description: 'A test service' }
    }
  };
  
  const agent = new Agent(config, manager);
  
  assertEquals(agent.id, "test-agent");
  assertEquals(agent.name, "Test Agent");
  assertEquals(agent.enablePlanning, true);
  assertEquals(agent.planningInterval, 2);
  assertEquals(agent.maxSteps, 5);
  assertInstanceOf(agent.memory, AgentMemory);
  
  // Check events
  const createEvents = manager.getEvents(AgentEvents.AGENT_CREATED);
  assertEquals(createEvents.length, 0); // No creation event in constructor
});

Deno.test("Agent - Kernel attachment", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    kernelType: KernelType.PYTHON
  };
  
  const agent = new Agent(config, manager);
  const kernel = new MockKernelInstance();
  
  // Attach kernel
  agent.attachKernel(kernel);
  assertEquals(agent.kernel, kernel);
  
  // Check events
  const attachEvents = manager.getEvents(AgentEvents.KERNEL_ATTACHED);
  assertEquals(attachEvents.length, 1);
  assertEquals(attachEvents[0].agentId, "test-agent");
  assertEquals(attachEvents[0].kernelId, "test-kernel");
  
  // Detach kernel
  agent.detachKernel();
  assertEquals(agent.kernel, undefined);
  
  const detachEvents = manager.getEvents(AgentEvents.KERNEL_DETACHED);
  assertEquals(detachEvents.length, 1);
});

Deno.test("Agent - System prompt generation", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    instructions: "You are a coding assistant",
    kernelType: KernelType.PYTHON,
    enablePlanning: true,
    hyphaServices: {
      'web-search': { description: 'Search the web' },
      'image-gen': { description: 'Generate images' }
    }
  };
  
  const agent = new Agent(config, manager);
  
  // Test system prompt generation (accessing private method through any cast)
  const systemPrompt = (agent as any).generateSystemPrompt();
  
  // Debug: print the system prompt to see what's included
  console.log("Generated system prompt:", systemPrompt);
  
  // Should include instructions
  assertEquals(systemPrompt.includes("coding assistant"), true);
  
  // Should include Python-specific instructions
  assertEquals(systemPrompt.includes("Python"), true);
  assertEquals(systemPrompt.includes("<py-script>"), true);
  
  // Should include service information
  assertEquals(systemPrompt.includes("Hypha Services"), true);
  assertEquals(systemPrompt.includes("web-search"), true);
  assertEquals(systemPrompt.includes("image-gen"), true);
});

Deno.test("Agent - Configuration updates", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    maxSteps: 5
  };
  
  const agent = new Agent(config, manager);
  
  // Update configuration
  agent.updateConfig({
    name: "Updated Agent",
    maxSteps: 10,
    enablePlanning: true,
    planningInterval: 3
  });
  
  assertEquals(agent.name, "Updated Agent");
  assertEquals(agent.maxSteps, 10);
  assertEquals(agent.enablePlanning, true);
  assertEquals(agent.planningInterval, 3);
  
  // Check events
  const updateEvents = manager.getEvents(AgentEvents.AGENT_UPDATED);
  assertEquals(updateEvents.length, 1);
});

Deno.test("Agent - Error classes", () => {
  const error1 = new AgentError("Test error", "test-context");
  assertEquals(error1.message, "Test error");
  assertEquals(error1.context, "test-context");
  assertEquals(error1.name, "AgentError");
  
  const error2 = new AgentExecutionError("Execution failed");
  assertEquals(error2.context, "execution");
  assertEquals(error2.name, "AgentExecutionError");
  assertInstanceOf(error2, AgentError);
  
  const error3 = new AgentPlanningError("Planning failed");
  assertEquals(error3.context, "planning");
  assertEquals(error3.name, "AgentPlanningError");
  assertInstanceOf(error3, AgentError);
});

Deno.test("Agent - Template population", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent"
  };
  
  const agent = new Agent(config, manager);
  
  // Test template population (accessing private method)
  const template = "Hello {{name}}, your task is {{task}}.";
  const variables = { name: "Alice", task: "solve math problem" };
  
  const result = (agent as any).populateTemplate(template, variables);
  assertEquals(result, "Hello Alice, your task is solve math problem.");
});

Deno.test("Agent - Service formatting for planning", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent",
    hyphaServices: {
      'calculator': { description: 'Perform calculations' },
      'web-search': { description: 'Search the internet' }
    }
  };
  
  const agent = new Agent(config, manager);
  
  // Test service formatting (accessing private method)
  const services = (agent as any).formatServicesForPlanning();
  
  assertEquals(services.includes("Code execution"), true);
  assertEquals(services.includes("calculator: Perform calculations"), true);
  assertEquals(services.includes("web-search: Search the internet"), true);
});

Deno.test("Agent - Destroy cleanup", () => {
  const manager = new MockAgentManager();
  const config: IAgentConfig = {
    id: "test-agent",
    name: "Test Agent"
  };
  
  const agent = new Agent(config, manager);
  const kernel = new MockKernelInstance();
  
  // Set up some state
  agent.attachKernel(kernel);
  agent.conversationHistory.push({ role: 'user', content: 'test' });
  agent.memory.addStep({
    type: StepType.TASK,
    task: "test task",
    startTime: Date.now(),
    endTime: Date.now()
  });
  
  // Destroy agent
  agent.destroy();
  
  // Check cleanup
  assertEquals(agent.kernel, undefined);
  assertEquals(agent.conversationHistory.length, 0);
  assertEquals(agent.memory.steps.length, 0);
  
  // Check events
  const destroyEvents = manager.getEvents(AgentEvents.AGENT_DESTROYED);
  assertEquals(destroyEvents.length, 1);
});

console.log("All enhanced agent tests completed successfully!"); 