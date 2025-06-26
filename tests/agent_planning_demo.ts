// Comprehensive test to demonstrate agent planning and reactive capabilities
// Run with: deno test -A --no-check tests/agent_planning_demo.ts

import { assertEquals, assertExists, assert } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { AgentManager, AgentEvents, KernelType } from "../agents/mod.ts";
import { KernelManager, KernelMode, KernelLanguage } from "../kernel/mod.ts";

// Configuration for Ollama
const OLLAMA_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama", 
  model: "llama3.2:1b", // Small model suitable for CI testing
  temperature: 0.7
};

const TEST_DATA_DIR = "./test_agent_planning_demo";

async function cleanupTestData() {
  try {
    await Deno.remove(TEST_DATA_DIR, { recursive: true });
  } catch {
    // Ignore if directory doesn't exist
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to log conversation steps with better formatting
function logStep(step: string, content: string, type: string = "INFO") {
  const timestamp = new Date().toISOString().slice(11, 23);
  const emoji = type === "ERROR" ? "❌" : type === "PLANNING" ? "🧠" : type === "CODE" ? "🔧" : type === "RESULT" ? "📊" : "💬";
  console.log(`${emoji} [${timestamp}] ${step}:`);
  console.log(`   ${content.slice(0, 200)}${content.length > 200 ? "..." : ""}`);
  console.log("");
}

Deno.test("Agent Planning Demo - Complex Multi-Step Problem Solving", async () => {
  await cleanupTestData();
  
  console.log("🚀 Starting Agent Planning and React Demo");
  console.log("=" .repeat(60));
  
  const kernelManager = new KernelManager();
  const agentManager = new AgentManager({
    defaultModelSettings: OLLAMA_CONFIG,
    agentDataDirectory: TEST_DATA_DIR,
    autoSaveConversations: true,
    defaultMaxSteps: 10 // Allow more steps for complex planning
  });

  agentManager.setKernelManager(kernelManager);

  try {
    // Create a sophisticated agent with planning capabilities
    const agentId = await agentManager.createAgent({
      id: "planning-demo-agent",
      name: "Advanced Planning Agent",
      description: "An AI agent with sophisticated planning and reactive capabilities",
      instructions: `You are an advanced AI assistant with strong analytical and coding capabilities. 

When solving complex problems:
1. Break down the problem into clear steps
2. Plan your approach methodically  
3. Execute code when needed to gather data or perform calculations
4. Analyze results and adapt your approach
5. Provide clear explanations of your reasoning

You have access to Python for data analysis, calculations, and visualizations.
Always show your work and explain your thought process.`,
      kernelType: KernelType.PYTHON,
      autoAttachKernel: true,
      maxSteps: 10,
      enablePlanning: true,
      planningInterval: 2
    });

    const agent = agentManager.getAgent(agentId)!;
    await wait(2000); // Wait for kernel attachment

    // Verify kernel attachment
    console.log(`🔧 Kernel attached: ${agent.kernel ? 'YES' : 'NO'}`);

    console.log("✅ Agent created with planning capabilities");
    console.log(`📊 Planning enabled: ${agent.enablePlanning}`);
    console.log(`📊 Planning interval: ${agent.planningInterval}`);
    console.log(`📊 Max steps: ${agent.maxSteps}`);
    console.log("");

    // Test 1: Mathematical Analysis Problem
    console.log("🧮 TEST 1: Complex Mathematical Analysis");
    console.log("-" .repeat(40));
    
    const mathProblem = `I need you to analyze the performance of three different investment strategies over time:

Strategy A: Start with $10,000, grows at 7% annually
Strategy B: Start with $12,000, grows at 5.5% annually  
Strategy C: Start with $8,000, grows at 9% annually

Please:
1. Calculate the value of each strategy after 10, 20, and 30 years
2. Determine which strategy performs best at each time period
3. Create a visualization showing the growth over time
4. Provide investment recommendations based on your analysis

Show all calculations and explain your reasoning step by step.`;

    const messages1 = [{
      role: "user" as const,
      content: mathProblem
    }];

    let stepCount = 0;
    let planningSteps = 0;
    let codeExecutions = 0;
    let hasVisualization = false;

    console.log("📝 User Question:", mathProblem.slice(0, 100) + "...");
    console.log("");

    try {
      for await (const chunk of agent.chatCompletion(messages1)) {
        stepCount++;
        
        if (chunk.type === 'planning') {
          planningSteps++;
          logStep(`Planning Step ${planningSteps}`, chunk.content || "Planning in progress...", "PLANNING");
        } else if (chunk.type === 'function_call') {
          codeExecutions++;
          const code = chunk.arguments?.code || "";
          logStep(`Code Execution ${codeExecutions}`, code, "CODE");
        } else if (chunk.type === 'function_call_output') {
          logStep(`Execution Result ${codeExecutions}`, chunk.content || "", "RESULT");
          if (chunk.content?.includes("matplotlib") || chunk.content?.includes("plot")) {
            hasVisualization = true;
          }
        } else if (chunk.type === 'text_chunk') {
          // Accumulate streaming chunks - don't log each one individually to avoid spam
        } else if (chunk.type === 'text') {
          logStep("Agent Response", chunk.content || "", "INFO");
        } else if (chunk.type === 'error') {
          logStep("Error", chunk.error?.message || "Unknown error", "ERROR");
        }
      }

      console.log("📊 Math Problem Results:");
      console.log(`   • Total steps: ${stepCount}`);
      console.log(`   • Planning steps: ${planningSteps}`);
      console.log(`   • Code executions: ${codeExecutions}`);
      console.log(`   • Has visualization: ${hasVisualization}`);
      console.log("");

    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
        console.log("⚠️  Ollama not available, skipping test");
        return;
      }
      throw error;
    }

    // Wait between tests
    await wait(1000);

    // Test 2: Data Analysis Problem
    console.log("📈 TEST 2: Data Analysis and Pattern Recognition");
    console.log("-" .repeat(40));

    const dataAnalysisProblem = `I have sales data for the past 2 years and need comprehensive analysis:

The data shows monthly sales figures, but I suspect there are seasonal patterns and trends that I'm missing. 

Please:
1. Generate realistic sample sales data for 24 months
2. Analyze the data for trends, seasonality, and anomalies
3. Create multiple visualizations to illustrate your findings
4. Predict sales for the next 6 months using appropriate methods
5. Provide actionable business insights

Use statistical methods and explain any patterns you discover.`;

    const messages2 = [{
      role: "user" as const,
      content: dataAnalysisProblem
    }];

    stepCount = 0;
    planningSteps = 0;
    codeExecutions = 0;
    let hasStatisticalAnalysis = false;

    console.log("📝 User Question:", dataAnalysisProblem.slice(0, 100) + "...");
    console.log("");

    try {
      for await (const chunk of agent.chatCompletion(messages2)) {
        stepCount++;
        
        if (chunk.type === 'planning') {
          planningSteps++;
          logStep(`Planning Step ${planningSteps}`, chunk.content || "Planning in progress...", "PLANNING");
        } else if (chunk.type === 'function_call') {
          codeExecutions++;
          const code = chunk.arguments?.code || "";
          logStep(`Code Execution ${codeExecutions}`, code, "CODE");
          if (code.includes("statistics") || code.includes("scipy") || code.includes("trend")) {
            hasStatisticalAnalysis = true;
          }
        } else if (chunk.type === 'function_call_output') {
          logStep(`Execution Result ${codeExecutions}`, chunk.content || "", "RESULT");
        } else if (chunk.type === 'text_chunk') {
          // Accumulate streaming chunks - don't log each one individually to avoid spam
        } else if (chunk.type === 'text') {
          logStep("Agent Response", chunk.content || "", "INFO");
        } else if (chunk.type === 'error') {
          logStep("Error", chunk.error?.message || "Unknown error", "ERROR");
        }
      }

      console.log("📊 Data Analysis Results:");
      console.log(`   • Total steps: ${stepCount}`);
      console.log(`   • Planning steps: ${planningSteps}`);
      console.log(`   • Code executions: ${codeExecutions}`);
      console.log(`   • Has statistical analysis: ${hasStatisticalAnalysis}`);
      console.log("");

    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
        console.log("⚠️  Ollama not available, skipping test");
        return;
      }
      throw error;
    }

    // Test 3: Problem-Solving with Constraints
    console.log("🎯 TEST 3: Optimization Problem with Constraints");
    console.log("-" .repeat(40));

    const optimizationProblem = `I'm planning a dinner party for 20 people with the following constraints:

Budget: $300 maximum
Dietary restrictions: 4 vegetarians, 2 gluten-free guests
Time constraint: Must prepare everything in 4 hours
Kitchen equipment: Standard home kitchen (no industrial equipment)

Please:
1. Plan a complete menu that satisfies all constraints
2. Calculate exact costs for all ingredients
3. Create a detailed timeline for preparation
4. Suggest alternatives if the initial plan exceeds constraints
5. Optimize for both cost and preparation efficiency

Show your decision-making process and explain how you handle trade-offs.`;

    const messages3 = [{
      role: "user" as const,
      content: optimizationProblem
    }];

    stepCount = 0;
    planningSteps = 0;
    codeExecutions = 0;
    let hasOptimization = false;

    console.log("📝 User Question:", optimizationProblem.slice(0, 100) + "...");
    console.log("");

    try {
      for await (const chunk of agent.chatCompletion(messages3)) {
        stepCount++;
        
        if (chunk.type === 'planning') {
          planningSteps++;
          logStep(`Planning Step ${planningSteps}`, chunk.content || "Planning in progress...", "PLANNING");
        } else if (chunk.type === 'function_call') {
          codeExecutions++;
          const code = chunk.arguments?.code || "";
          logStep(`Code Execution ${codeExecutions}`, code, "CODE");
          if (code.includes("optimize") || code.includes("constraint") || code.includes("budget")) {
            hasOptimization = true;
          }
        } else if (chunk.type === 'function_call_output') {
          logStep(`Execution Result ${codeExecutions}`, chunk.content || "", "RESULT");
        } else if (chunk.type === 'text_chunk') {
          // Accumulate streaming chunks - don't log each one individually to avoid spam
        } else if (chunk.type === 'text') {
          logStep("Agent Response", chunk.content || "", "INFO");
        } else if (chunk.type === 'error') {
          logStep("Error", chunk.error?.message || "Unknown error", "ERROR");
        }
      }

      console.log("📊 Optimization Results:");
      console.log(`   • Total steps: ${stepCount}`);
      console.log(`   • Planning steps: ${planningSteps}`);
      console.log(`   • Code executions: ${codeExecutions}`);
      console.log(`   • Has optimization logic: ${hasOptimization}`);
      console.log("");

    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
        console.log("⚠️  Ollama not available, skipping test");
        return;
      }
      throw error;
    }

    // Show final conversation analysis
    console.log("🎯 FINAL ANALYSIS");
    console.log("=" .repeat(60));
    console.log(`📊 Total conversation length: ${agent.conversationHistory.length} messages`);
    
    // Count different types of interactions
    let userMessages = 0;
    let assistantMessages = 0;
    let systemMessages = 0;
    
    agent.conversationHistory.forEach(msg => {
      if (msg.role === 'user') userMessages++;
      else if (msg.role === 'assistant') assistantMessages++;
      else if (msg.role === 'system') systemMessages++;
    });
    
    console.log(`📝 User messages: ${userMessages}`);
    console.log(`🤖 Assistant messages: ${assistantMessages}`);  
    console.log(`⚙️  System messages: ${systemMessages}`);
    
    // Show agent memory and planning state
    console.log("");
    console.log("🧠 Agent Memory State:");
    if (agent.memory) {
      console.log(`   • Memory steps: ${agent.memory.steps.length}`);
      
      // Count different step types
      const taskSteps = agent.memory.getStepsByType('task' as any).length;
      const actionSteps = agent.memory.getStepsByType('action' as any).length;
      const planningSteps = agent.memory.getStepsByType('planning' as any).length;
      
      console.log(`   • Task steps: ${taskSteps}`);
      console.log(`   • Action steps: ${actionSteps}`);
      console.log(`   • Planning steps: ${planningSteps}`);
    }

    console.log("");
    console.log("✅ Agent Planning Demo Complete!");
    console.log("=" .repeat(60));

  } finally {
    try {
      await agentManager.destroyAll();
      await wait(200);
      if (kernelManager) {
        await kernelManager.destroyAll();
        await wait(200);
      }
    } catch (cleanupError) {
      console.error("❌ Cleanup error:", cleanupError);
    }
    await cleanupTestData();
  }
});

console.log("🧪 Run this demo with: deno test -A --no-check tests/agent_planning_demo.ts"); 