import { hyphaWebsocketClient } from "npm:hypha-rpc";
import { KernelMode } from "../kernel/mod.ts";

// To run the test, use:
// deno run -A test-hypha-service.ts <serviceId> [numKernels] [numExecutions]

// Utility function for retrying operations
async function retry<T>(
  operation: () => Promise<T>, 
  maxRetries = 3, 
  delay = 1000, 
  retryMsg = "Operation failed, retrying..."
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.log(`${retryMsg} (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Define interfaces for better type safety
interface KernelInfo {
  id: string;
  name: string;
  mode: KernelMode;
  created: string;
  status?: string;
}

interface ExecutionResult {
  execution_id: string;
}

interface ExecutionOutput {
  type: string;
  [key: string]: unknown;
}

// Parse command line arguments
const args = Deno.args;
if (args.length < 1) {
  console.error("Usage: deno run -A test-hypha-service.ts <serviceId> [numKernels=5] [numExecutions=3]");
  Deno.exit(1);
}

const serviceId = args[0];
const numKernels = parseInt(args[1] || "5", 10);
const numExecutions = parseInt(args[2] || "3", 10);

async function runStressTest() {
  console.log(`Starting stress test for service ${serviceId}`);
  console.log(`Will create ${numKernels} kernels and run ${numExecutions} executions per kernel`);
  
  // Connect to hypha server
  console.log("Connecting to hypha server...");
  const server = await hyphaWebsocketClient.connectToServer({
    server_url: "https://hypha.aicell.io"
  });
  
  console.log(`Connected to hypha server (workspace: ${server.config.workspace}), getting service...`);
  
  // Get the service - first try direct method
  let service;
  try {
    console.log(`Attempting to get service with ID: ${serviceId}`);
    service = await server.getService(serviceId);
  } catch (error) {
    console.log(`Failed to get service directly with ID ${serviceId}, trying to list services...`);
    
    // If direct access fails, try to find it in the list of services
    const services = await server.listServices();
    console.log(`Found ${services.length} services in workspace`);
    
    // Find the service that matches our criteria
    service = services.find((s: any) => 
      s.id === serviceId || 
      s.id.includes(serviceId) || 
      s.id.includes('deno-app-engine') ||
      s.name === 'Deno App Engine'
    );
    
    if (!service) {
      console.error(`Service ${serviceId} not found. Available services:`, 
        services.map((s: any) => `${s.name} (${s.id})`).join(', '));
      Deno.exit(1);
    }
  }
  
  console.log(`Found service: ${service.name} (${service.id})`);
  
  // Create kernels
  const kernels = [];
  console.log(`Creating ${numKernels} kernels...`);
  
  for (let i = 0; i < numKernels; i++) {
    try {
      const kernel = await service.createKernel({
        id: `test-kernel-${i}`,
        mode: KernelMode.WORKER
      }) as KernelInfo;
      
      console.log(`Created kernel ${i+1}/${numKernels}: ${kernel.id}`);
      kernels.push(kernel);
    } catch (error) {
      console.error(`Failed to create kernel ${i+1}/${numKernels}:`, error);
    }
  }
  
  console.log(`Successfully created ${kernels.length}/${numKernels} kernels`);
  
  // List all kernels to verify
  console.log("Listing all kernels...");
  try {
    const listedKernels = await service.listKernels() as KernelInfo[];
    console.log(`Found ${listedKernels.length} kernels in service`);
  } catch (error) {
    console.error("Failed to list kernels:", error);
  }
  
  // Run executions on each kernel
  console.log(`Running ${numExecutions} executions on each kernel...`);
  
  const results = [];
  for (const kernel of kernels) {
    console.log(`Testing kernel ${kernel.id}...`);
    
    for (let i = 0; i < numExecutions; i++) {
      try {
        console.log(`  Execution ${i+1}/${numExecutions}...`);
        
        // Simple test code that generates some output
        const testCode = `
import sys
import time
import numpy as np

print(f"Hello from execution ${i+1} on kernel {sys.version}")
time.sleep(0.5)  # Add some delay
arr = np.random.rand(3, 3)
print(f"Random array:\\n{arr}")
arr.sum()
`;
        
        console.log("  Executing code...");
        // Option 1: Use executeCode and wait for result
        const execResult = await service.executeCode({
          kernelId: kernel.id,
          code: testCode
        }) as ExecutionResult;
        
        // Wait a bit for execution to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Get execution result
        const outputs = await service.getExecutionResult({
          kernelId: kernel.id,
          executionId: execResult.execution_id
        }) as ExecutionOutput[];
        
        console.log(`  Execution ${i+1} complete, received ${outputs.length} outputs`);
        results.push({
          kernelId: kernel.id,
          executionId: execResult.execution_id,
          success: true,
          outputCount: outputs.length
        });
        
        // Test streaming execution
        console.log("  Testing streaming execution...");
        try {
          const outputs2 = [];
          const streamCode = `print("Streaming test ${i+1}")\n2 + 2`;
          
          for await (const output of await service.streamExecution({
            kernelId: kernel.id,
            code: streamCode
          })) {
            outputs2.push(output);
          }
          
          console.log(`  Streaming execution complete, received ${outputs2.length} outputs`);
        } catch (error) {
          console.error(`  Streaming execution failed:`, error);
        }
      } catch (error) {
        console.error(`  Execution ${i+1} failed:`, error);
        results.push({
          kernelId: kernel.id,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    
    // Get kernel info
    try {
      const info = await service.getKernelInfo({
        kernelId: kernel.id
      });
      console.log(`  Kernel info: ${info.id} ${info.name}`)
    } catch (error) {
      console.error(`  Failed to get kernel info:`, error);
    }
  }
  
  // Cleanup - destroy all kernels
  console.log("Cleaning up - destroying all kernels...");
  for (const kernel of kernels) {
    try {
      await service.destroyKernel({
        kernelId: kernel.id
      });
      console.log(`  Destroyed kernel ${kernel.id}`);
    } catch (error) {
      console.error(`  Failed to destroy kernel ${kernel.id}:`, error);
    }
  }
  
  // Test Agent functionality
  console.log("\n========== TESTING AGENTS ==========");
  const testAgents = [];
  
  console.log("Testing agent functionality...");
  
  try {
    // Create a test agent
    const agentConfig = {
      id: `test-agent-${Date.now()}`,
      name: "Test Agent",
      instructions: "You are a helpful test agent. Answer questions concisely."
    };
    
    const agent = await service.createAgent(agentConfig);
    console.log(`Created test agent: ${agent.id}`);
    testAgents.push(agent);
      
      // Test conversation history functionality
      console.log("Testing conversation history setting...");
      
      const testHistory = [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "2+2 equals 4." },
        { role: "user", content: "What about 3+3?" },
        { role: "assistant", content: "3+3 equals 6." }
      ];
      
      const setResult = await service.setAgentConversationHistory({
        agentId: agent.id,
        messages: testHistory
      });
      
      console.log(`✅ Set conversation history: ${setResult.messageCount} messages`);
      
      // Verify the conversation was set
      const conversation = await service.getAgentConversation({
        agentId: agent.id
      });
      
      console.log(`✅ Retrieved conversation: ${conversation.length} messages`);
      
      if (conversation.length === testHistory.length) {
        console.log(`✅ Conversation history length correct`);
      } else {
        console.log(`⚠️ Conversation length mismatch: expected ${testHistory.length}, got ${conversation.length}`);
      }
      
      // Test chat functionality
      console.log("Testing agent chat...");
      
      try {
        let responseText = '';
        for await (const chunk of await service.chatWithAgent({
          agentId: agent.id,
          message: "Hello! Can you help me with math?"
        })) {
          if (chunk.type === 'text' && chunk.content) {
            responseText = chunk.content;
          } else if (chunk.type === 'text_chunk' && chunk.content) {
            responseText += chunk.content;
          }
        }
        
        if (responseText) {
          console.log(`✅ Agent responded: ${responseText.substring(0, 60)}...`);
        } else {
          console.log(`⚠️ Agent did not respond`);
        }
      } catch (error) {
        console.error(`❌ Agent chat failed:`, error);
      }
      
    } catch (error) {
      console.error("Failed to test agent functionality:", error);
    }
  
  // Cleanup - destroy test agents
  if (testAgents.length > 0) {
    console.log("Cleaning up - destroying test agents...");
    for (const agent of testAgents) {
      try {
        await service.destroyAgent({
          agentId: agent.id
        });
        console.log(`  Destroyed agent ${agent.id}`);
      } catch (error) {
        console.error(`  Failed to destroy agent ${agent.id}:`, error);
      }
    }
  }
  
  // Final verification
  console.log("Verifying all kernels were destroyed...");
  try {
    const remainingKernels = await service.listKernels() as KernelInfo[];
    const testKernelsRemaining = remainingKernels.filter((k: KernelInfo) => 
      k.id.includes('test-kernel-'));
    
    console.log(`Remaining test kernels: ${testKernelsRemaining.length}`);
    if (testKernelsRemaining.length > 0) {
      console.log(`Warning: Some test kernels were not properly destroyed: ${testKernelsRemaining.map((k: KernelInfo) => k.id).join(', ')}`);
    }
  } catch (error) {
    console.error("Failed to list remaining kernels:", error);
  }
  
  // Summary
  console.log("\n========== STRESS TEST SUMMARY ==========");
  console.log(`Total kernels created: ${kernels.length}/${numKernels}`);
  console.log(`Total agents created: ${testAgents.length}`);
  console.log(`Total executions attempted: ${numKernels * numExecutions}`);
  
  const successfulExecutions = results.filter(r => r.success).length;
  console.log(`Successful executions: ${successfulExecutions}/${results.length}`);
  
  console.log("=========================================\n");
  
  return {
    server,
    kernels,
    testAgents,
    results
  };
}

if (import.meta.main) {
  try {
    const { server } = await runStressTest();
    console.log("Stress test completed. Press Ctrl+C to exit.");
    // Keep connection alive
    await new Promise(() => {});
  } catch (error) {
    console.error("Stress test failed:", error);
    Deno.exit(1);
  }
}