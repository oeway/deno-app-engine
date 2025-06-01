// Agents Module Example
// Demonstrates how to create and use AI agents with the Deno App Engine
// Run with: deno run -A --no-check examples/agents_example.ts

import { AgentManager, AgentEvents, KernelType } from "../agents/mod.ts";
import { KernelManager } from "../kernel/mod.ts";

console.log("🤖 Agents Module Example - Deno App Engine");
console.log("=========================================");

// Configuration for Ollama
const OLLAMA_CONFIG = {
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  model: "qwen2.5-coder:7b",
  temperature: 0.7
};

async function main() {
  try {
    // Create the managers
    console.log("\n📋 Setting up managers...");
    const kernelManager = new KernelManager();
    const agentManager = new AgentManager({
      maxAgents: 10,
      defaultModelSettings: OLLAMA_CONFIG,
      agentDataDirectory: "./example_agents_data",
      autoSaveConversations: true
    });

    // Set kernel manager for auto-kernel attachment
    agentManager.setKernelManager(kernelManager);

    // Set up event listeners
    console.log("\n📡 Setting up event listeners...");
    agentManager.on(AgentEvents.AGENT_CREATED, (data) => {
      console.log(`✅ Agent created: ${data.agentId}`);
    });

    agentManager.on(AgentEvents.AGENT_MESSAGE, (data) => {
      console.log(`💬 Agent ${data.agentId} sent message: ${data.message.substring(0, 50)}...`);
    });

    agentManager.on(AgentEvents.AGENT_CODE_EXECUTED, (data) => {
      console.log(`🔧 Agent ${data.agentId} executed code: ${data.code.substring(0, 50)}...`);
    });

    // Create different types of agents
    console.log("\n🎭 Creating different types of agents...");
    
    // 1. Simple chat assistant
    const chatAgentId = await agentManager.createAgent({
      id: "chat-assistant",
      name: "Chat Assistant",
      description: "A friendly AI assistant for general conversations",
      instructions: "You are a helpful and friendly AI assistant. Keep your responses concise and helpful. Always be polite and professional."
    });

    // 2. Python coding assistant with kernel
    const codeAgentId = await agentManager.createAgent({
      id: "python-coder", 
      name: "Python Coding Assistant",
      description: "A specialized Python coding assistant with code execution capabilities",
      instructions: "You are a Python programming expert. Help users write, debug, and execute Python code. Always explain your solutions clearly.",
      kernelType: KernelType.PYTHON,
      autoAttachKernel: false // We'll attach manually for demonstration
    });

    // 3. Data scientist assistant
    const dataAgentId = await agentManager.createAgent({
      id: "data-scientist",
      name: "Data Science Helper", 
      description: "AI assistant specialized in data analysis and visualization",
      instructions: "You are a data science expert. Help with data analysis, visualization, and statistical computations. Use Python libraries like pandas, numpy, and matplotlib when appropriate.",
      kernelType: KernelType.PYTHON
    });

    // Display agent stats
    console.log("\n📊 Agent Statistics:");
    const stats = agentManager.getStats();
    console.log(`Total agents: ${stats.totalAgents}`);
    console.log(`Max agents: ${stats.maxAgents}`);
    console.log(`Auto-save enabled: ${stats.autoSaveConversations}`);

    // List all agents
    console.log("\n📝 Agent List:");
    const agents = agentManager.listAgents();
    agents.forEach(agent => {
      console.log(`  • ${agent.name} (${agent.id})`);
      console.log(`    Kernel: ${agent.hasKernel ? "✅" : "❌"} | Type: ${agent.kernel_type || "None"}`);
      console.log(`    Created: ${agent.created.toISOString()}`);
    });

    // Test simple conversation
    console.log("\n💬 Testing simple conversation...");
    const chatAgent = agentManager.getAgent(chatAgentId)!;
    const messages = [{
      role: "user" as const,
      content: "Hello! Can you briefly explain what you can help me with?"
    }];

    console.log("User: Hello! Can you briefly explain what you can help me with?");
    console.log("Assistant:");

    try {
      for await (const chunk of chatAgent.chatCompletion(messages)) {
        if (chunk.type === 'text') {
          console.log(chunk.content);
          break; // Exit after first complete response
        } else if (chunk.type === 'error') {
          console.log(`❌ Error: ${chunk.error}`);
          break;
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && (error.message.includes("ECONNREFUSED") || error.message.includes("404"))) {
        console.log("⚠️  Ollama not available. Please make sure Ollama is running with qwen2.5-coder model.");
      } else {
        console.log(`❌ Chat error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // Test kernel attachment (if you want to test with code execution)
    console.log("\n🔧 Testing kernel attachment...");
    try {
      await agentManager.attachKernelToAgent(codeAgentId, KernelType.PYTHON);
      console.log("✅ Kernel attached successfully");
      
      // Wait a bit for kernel to initialize
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const updatedAgents = agentManager.listAgents();
      const codeAgent = updatedAgents.find(a => a.id === codeAgentId);
      console.log(`Code agent kernel status: ${codeAgent?.hasKernel ? "✅" : "❌"}`);
      
    } catch (error: unknown) {
      console.log(`⚠️  Kernel attachment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Demonstrate conversation persistence
    console.log("\n💾 Testing conversation persistence...");
    try {
      // Add some conversation history manually for testing
      chatAgent.conversationHistory.push(
        { role: "user", content: "What's 2+2?" },
        { role: "assistant", content: "2 + 2 equals 4." }
      );

      await agentManager.saveConversation(chatAgentId);
      console.log("✅ Conversation saved");

      const loadedHistory = await agentManager.loadConversation(chatAgentId);
      console.log(`📚 Loaded ${loadedHistory.length} messages from history`);
      
    } catch (error: unknown) {
      console.log(`⚠️  Conversation persistence failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Clean up example
    console.log("\n🧹 Cleaning up...");
    await agentManager.destroyAll();
    console.log("✅ All agents destroyed");

    // Final stats
    const finalStats = agentManager.getStats();
    console.log(`Final agent count: ${finalStats.totalAgents}`);

  } catch (error: unknown) {
    console.error("❌ Example failed:", error instanceof Error ? error.message : error);
  }
}

// Helper function to print without newline (for simulating typing effect)
function print(text: string, end: string = "\n") {
  if (end === "") {
    Deno.stdout.writeSync(new TextEncoder().encode(text));
  } else {
    console.log(text);
  }
}

// Run the example
if (import.meta.main) {
  await main();
}

console.log("\n🎉 Agents example completed!");
console.log("\nTo run this example:");
console.log("  deno run -A --no-check examples/agents_example.ts");
console.log("\nTo run agents tests:");
console.log("  deno task test-agents"); 