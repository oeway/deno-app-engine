// Demo script showing kernel-aware prompt generation
// This demonstrates how agents adjust their prompts based on kernel type

import { AgentManager, KernelType } from "../agents/mod.ts";

// Configuration for demo (using mock settings since we're just showing prompts)
const DEMO_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "demo",
  model: "demo-model",
  temperature: 0.7
};

async function demonstrateKernelAwarePrompts() {
  console.log("🎭 Kernel-Aware Prompt Generation Demo");
  console.log("=====================================\n");

  // Create agent manager
  const agentManager = new AgentManager({
    maxAgents: 10,
    defaultModelSettings: DEMO_CONFIG,
    agentDataDirectory: "./demo_agent_data",
    autoSaveConversations: false
  });

  try {
    // 1. Agent without kernel
    console.log("1️⃣ Agent WITHOUT Kernel:");
    console.log("========================");
    const noKernelAgentId = await agentManager.createAgent({
      id: "demo-no-kernel",
      name: "Basic Assistant",
      description: "A basic AI assistant without code execution",
      instructions: "You are a helpful AI assistant. Provide clear and concise answers to user questions."
    });
    
    const noKernelAgent = agentManager.getAgent(noKernelAgentId)!;
    console.log("Agent Instructions Only (no kernel-specific content added):");
    console.log("✅ No code execution instructions will be added\n");

    // 2. Agent with Python kernel
    console.log("2️⃣ Agent WITH Python Kernel:");
    console.log("=============================");
    const pythonAgentId = await agentManager.createAgent({
      id: "demo-python",
      name: "Python Assistant", 
      description: "AI assistant with Python code execution",
      instructions: "You are a helpful AI assistant specialized in data analysis and Python programming.",
      kernelType: KernelType.PYTHON
    });
    
    console.log("Instructions will include:");
    console.log("✅ Base agent instructions");
    console.log("✅ General code execution guidelines");
    console.log("✅ Python-specific instructions:");
    console.log("   - Pyodide environment details");
    console.log("   - Available libraries (numpy, pandas, matplotlib)");
    console.log("   - Python-specific examples and best practices");
    console.log("   - print() for output, plt.show() for plots\n");

    // 3. Agent with TypeScript kernel
    console.log("3️⃣ Agent WITH TypeScript Kernel:");
    console.log("=================================");
    const typescriptAgentId = await agentManager.createAgent({
      id: "demo-typescript",
      name: "TypeScript Assistant",
      description: "AI assistant with TypeScript code execution", 
      instructions: "You are a helpful AI assistant specialized in TypeScript development and modern web technologies.",
      kernelType: KernelType.TYPESCRIPT
    });
    
    console.log("Instructions will include:");
    console.log("✅ Base agent instructions");
    console.log("✅ General code execution guidelines");
    console.log("✅ TypeScript-specific instructions:");
    console.log("   - Type safety and modern ES6+ features");
    console.log("   - Deno standard library access");
    console.log("   - Interface and type definitions");
    console.log("   - console.log() for output, async/await support\n");

    // 4. Agent with JavaScript kernel
    console.log("4️⃣ Agent WITH JavaScript Kernel:");
    console.log("=================================");
    const javascriptAgentId = await agentManager.createAgent({
      id: "demo-javascript",
      name: "JavaScript Assistant",
      description: "AI assistant with JavaScript code execution",
      instructions: "You are a helpful AI assistant specialized in JavaScript development and web programming.",
      kernelType: KernelType.JAVASCRIPT
    });
    
    console.log("Instructions will include:");
    console.log("✅ Base agent instructions");
    console.log("✅ General code execution guidelines");
    console.log("✅ JavaScript-specific instructions:");
    console.log("   - Modern ES6+ features");
    console.log("   - JSON, arrays, objects manipulation");
    console.log("   - console.log() for output");
    console.log("   - Modern JavaScript patterns\n");

    // 5. Show kernel type switching
    console.log("5️⃣ Dynamic Kernel Type Changes:");
    console.log("==============================");
    console.log("When an agent's kernel type changes, the prompt automatically updates:");
    console.log("🔄 Python → TypeScript: Switches from Pyodide to Deno/TypeScript instructions");
    console.log("🔄 TypeScript → JavaScript: Removes type safety, keeps modern JS features");
    console.log("🔄 Any Kernel → None: Removes all code execution instructions\n");

    console.log("🎯 Key Benefits:");
    console.log("================");
    console.log("✅ Agents automatically know what environment they're working in");
    console.log("✅ Language-specific best practices are provided");
    console.log("✅ Appropriate output methods are suggested (print vs console.log)");
    console.log("✅ Relevant libraries and features are mentioned");
    console.log("✅ Code examples match the execution environment");
    console.log("✅ No code execution prompts when no kernel is attached\n");

    console.log("🧠 This ensures agents provide accurate, environment-appropriate guidance!");

  } finally {
    // Cleanup
    await agentManager.destroyAll();
    console.log("\n🧹 Demo cleanup completed.");
  }
}

if (import.meta.main) {
  await demonstrateKernelAwarePrompts();
} 