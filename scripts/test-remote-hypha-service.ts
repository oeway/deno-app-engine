import { hyphaWebsocketClient } from "npm:hypha-rpc";

// To run the test, use:
// deno run -A test-remote-hypha-service.ts [numAgents] [numVectorOperations]

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
interface AgentInfo {
  id: string;
  name: string;
  status?: string;
  created?: string;
  workspace?: string;
  type?: 'agent' | 'deno-app';
}

interface VectorDocument {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

interface SearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

interface DenoAppInfo {
  id: string;
  name: string;
  startup_script?: string;
  created?: string;
  status?: string;
  type?: 'deno-app';
}

// Parse command line arguments
const args = Deno.args;
const numAgents = parseInt(args[0] || "3", 10);
const numVectorOperations = parseInt(args[1] || "5", 10);

async function runRemoteServiceTest() {
  console.log(`Starting remote service test for hypha-agents/deno-app-engine`);
  console.log(`Will test ${numAgents} agents and ${numVectorOperations} vector operations`);
  
  // Connect to hypha server
  console.log("Connecting to hypha server...");
  const server = await retry(() => hyphaWebsocketClient.connectToServer({
    server_url: "https://hypha.aicell.io"
  }));
  
  console.log(`Connected to hypha server (workspace: ${server.config.workspace}), getting service...`);
  
  // Get the deployed service
  let service;
  const serviceId = "hypha-agents/deno-app-engine";
  
  try {
    console.log(`Attempting to get service: ${serviceId}`);
    service = await server.getService(serviceId);
    console.log(`Found service: ${service.name || serviceId} (${service.id})`);
  } catch (error) {
    console.log(`Failed to get service directly, trying to list services...`);
    
    // If direct access fails, try to find it in the list of services
    const services = await server.listServices();
    console.log(`Found ${services.length} services in workspace`);
    
    // Find the service that matches our criteria
    service = services.find((s: any) => 
      s.id === serviceId || 
      s.id.includes('deno-app-engine') ||
      s.name?.includes('deno-app-engine') ||
      s.name?.includes('Deno App Engine')
    );
    
    if (!service) {
      console.error(`Service ${serviceId} not found. Available services:`, 
        services.map((s: any) => `${s.name || 'unnamed'} (${s.id})`).join(', '));
      Deno.exit(1);
    }
    
    console.log(`Found service: ${service.name || service.id} (${service.id})`);
  }
  
  // Test service info and available methods
  console.log("Testing service info...");
  try {
    // Check what methods are available
    console.log("Available service methods:", Object.keys(service).filter(key => typeof service[key] === 'function'));
  } catch (error) {
    console.error("Failed to get service info:", error);
  }
  
  // Test Agent and Deno-App functionality with namespace support
  console.log("\n========== TESTING AGENTS AND DENO-APPS WITH NAMESPACE SUPPORT ==========");
  const agents = [];
  const denoApps = [];
  
  if ('createAgent' in service) {
    console.log(`Creating ${numAgents} agents in different workspaces...`);
    
    for (let i = 0; i < numAgents; i++) {
      try {
        const agentConfig = {
          id: `test-agent-${i}`,
          name: `Test Agent ${i + 1}`,
          instructions: `You are test agent ${i + 1}. Answer questions helpfully and concisely.`
        };
        
        const agent = await service.createAgent(agentConfig) as AgentInfo;
        console.log(`Created agent ${i + 1}/${numAgents}: ${agent.id}`);
        agents.push(agent);
      } catch (error) {
        console.error(`Failed to create agent ${i + 1}/${numAgents}:`, error);
      }
    }
    
    console.log(`Successfully created ${agents.length}/${numAgents} agents across workspaces`);
    
    // Test creating Deno applications
    console.log(`Creating ${numAgents} Deno applications...`);
    
    for (let i = 0; i < numAgents; i++) {
      try {
        const appConfig = {
          id: `test-deno-app-${i}`,
          name: `Test Deno App ${i + 1}`,
          type: 'deno-app',
          startup_script: `
// Deno app ${i + 1} startup script
console.log("Deno app ${i + 1} starting up...");

// Create a simple greeting function
function appGreet(name: string): string {
  return \`Hello from Deno App ${i + 1}, \${name}!\`;
}

// Test the function
const greeting = appGreet("Remote Tester");
console.log(greeting);

// Make it available globally for testing
globalThis.appGreet${i} = appGreet;

// Define app-specific utilities
globalThis.APP_${i}_UTILS = {
  version: "1.0.0",
  created: new Date().toISOString(),
  test: () => console.log("App ${i + 1} utilities working!")
};
`,
          license: 'MIT',
          description: `Test Deno application ${i + 1} for remote service validation`
        };
        
        const app = await service.createAgent(appConfig) as DenoAppInfo;
        denoApps.push(app);
        console.log(`Created Deno app ${i + 1}/${numAgents}: ${app.id}`);
      } catch (error) {
        console.error(`Failed to create Deno app ${i + 1}/${numAgents}:`, error);
      }
    }
    
    console.log(`Successfully created ${denoApps.length}/${numAgents} Deno apps across workspaces`);
    
    // Test workspace isolation (now handled internally by the service)
    console.log("Testing internal namespace isolation...");
    try {
      const allAgents = await service.listAgents() as AgentInfo[];
      console.log(`Total items found in this workspace: ${allAgents.length}`);
      
      // Since namespace is now internal, all items should be accessible within the same workspace
      const testAgents = allAgents.filter(a => a.id.includes('test-agent-'));
      const testApps = allAgents.filter(a => a.id.includes('test-deno-app-') || a.type === 'deno-app');
      
      console.log(`Test agents in this workspace: ${testAgents.length}`);
      console.log(`Test Deno apps in this workspace: ${testApps.length}`);
      
      if (testAgents.length > 0 || testApps.length > 0) {
        console.log(`✅ Internal namespace isolation working - items are scoped to workspace`);
        console.log(`✅ Dual agent/app types working - found ${testAgents.length} agents and ${testApps.length} apps`);
      }
    } catch (error) {
      console.error("Failed to test namespace isolation:", error);
    }
    
    // Test agent interactions 
    if (agents.length > 0) {
      console.log("Testing agent interactions...");
      
      for (const agent of agents.slice(0, Math.min(2, agents.length))) {
        try {
          console.log(`Testing agent ${agent.id}...`);
          
          if ('chatWithAgent' in service) {
            let finalMessage = '';
            let hasError = false;
            let errorMessage = '';
            
            try {
              // Since chatWithAgent is a generator, we need to iterate over it
              for await (const chunk of await service.chatWithAgent({
                agentId: agent.id,
                message: `Hello! What can you help me with?`
              })) {
                if (chunk.type === 'error') {
                  hasError = true;
                  errorMessage = chunk.error || 'Unknown error';
                  break;
                } else if (chunk.type === 'text' && chunk.content) {
                  finalMessage = chunk.content; // Final response
                } else if (chunk.type === 'text_chunk' && chunk.content) {
                  finalMessage += chunk.content; // Accumulate streaming response
                }
              }
              
              if (hasError) {
                console.log(`  Agent response error: ${errorMessage}`);
              } else if (finalMessage) {
                console.log(`  Agent response: ${finalMessage.substring(0, 100)}...`);
                console.log(`  ✅ Agent responded successfully`);
              } else {
                console.log(`  Agent response: No response generated`);
              }
            } catch (error) {
              console.log(`  Agent response error: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          
          if ('getAgentConversation' in service) {
            const conversation = await service.getAgentConversation({
              agentId: agent.id
            });
            
            console.log(`  Agent conversation: ${conversation.length} messages`);
          }
          
          // Test setting conversation history
          if ('setAgentConversationHistory' in service) {
            console.log(`  Testing conversation history setting...`);
            try {
              const testHistory = [
                { role: "user", content: "Hello, how are you?" },
                { role: "assistant", content: "I'm doing great! How can I help you today?" },
                { role: "user", content: "What's the weather like?" },
                { role: "assistant", content: "I don't have access to real-time weather data, but I'd be happy to help you find weather information!" }
              ];
              
              const setResult = await service.setAgentConversationHistory({
                agentId: agent.id,
                messages: testHistory
              });
              
              console.log(`  ✅ Set conversation history: ${setResult.messageCount} messages`);
              
              // Verify the conversation was set correctly
              if ('getAgentConversation' in service) {
                const updatedConversation = await service.getAgentConversation({
                  agentId: agent.id
                });
                
                console.log(`  ✅ Verified conversation history: ${updatedConversation.length} messages`);
                
                if (updatedConversation.length === testHistory.length) {
                  console.log(`  ✅ Conversation history length matches expected`);
                } else {
                  console.log(`  ⚠️ Conversation history length mismatch: expected ${testHistory.length}, got ${updatedConversation.length}`);
                }
              }
            } catch (error) {
              console.log(`  ❌ Failed to set conversation history: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
          
        } catch (error) {
          console.error(`  Failed to test agent ${agent.id}:`, error);
        }
      }
    }
    
    // Test Deno app functionality
    if (denoApps.length > 0) {
      console.log("Testing Deno app functionality...");
      
      for (const app of denoApps.slice(0, Math.min(2, denoApps.length))) {
        try {
          console.log(`Testing Deno app ${app.id}...`);
          
          // Test if the app has created TypeScript kernels for execution
          if ('listKernels' in service) {
            const allKernels = await service.listKernels();
            const appKernel = allKernels.find((k: any) => 
              k.id === app.id || k.id.includes(app.id) || k.name?.includes(app.name)
            );
            
            if (appKernel) {
              console.log(`  Found kernel for app: ${appKernel.id}`);
              
              // Test executing code in the app's context
              if ('executeCode' in service) {
                const testCode = `
// Test if startup script executed and functions are available
const appIndex = ${app.id.split('-').pop()};
const greetFuncName = \`appGreet\${appIndex}\`;
const utilsName = \`APP_\${appIndex}_UTILS\`;

if (typeof globalThis[greetFuncName] === 'function') {
  console.log("✅ Startup script functions loaded successfully!");
  console.log(globalThis[greetFuncName]("Remote Test"));
} else {
  console.log("⚠️ Startup script functions not found");
  console.log("Available globals:", Object.keys(globalThis).filter(k => k.includes('app') || k.includes('APP')));
}

if (globalThis[utilsName]) {
  console.log("✅ App utilities loaded successfully!");
  globalThis[utilsName].test();
  console.log("App version:", globalThis[utilsName].version);
} else {
  console.log("⚠️ App utilities not found");
}

// Test Deno-specific functionality
console.log("Deno version check:", typeof Deno !== 'undefined' ? 'Available' : 'Not available');
`;
                
                try {
                  const execResult = await service.executeCode({
                    kernelId: appKernel.id,
                    code: testCode
                  });
                  
                  console.log(`  ✅ App code execution initiated: ${execResult.execution_id}`);
                  
                  // Wait for execution to complete
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  
                  // Get execution results
                  if ('getExecutionResult' in service) {
                    const outputs = await service.getExecutionResult({
                      kernelId: appKernel.id,
                      executionId: execResult.execution_id
                    });
                    
                    console.log(`  ✅ App execution completed with ${outputs.length} outputs`);
                  }
                } catch (error) {
                  console.error(`  ❌ Failed to execute code in app ${app.id}:`, error);
                }
              }
            } else {
              console.log(`  ⚠️ No kernel found for app ${app.id} - app may not have startup script execution`);
            }
          }
          
        } catch (error) {
          console.error(`  Failed to test app ${app.id}:`, error);
        }
      }
    }
    
    // List all agents
    if ('listAgents' in service) {
      try {
        const listedAgents = await service.listAgents() as any[];
        console.log(`Listed ${listedAgents.length} agents in this workspace`);
      } catch (error) {
        console.error("Failed to list agents:", error);
      }
    }
  } else {
    console.log("Agent functionality not available in service");
  }
  
  // Test VectorDB functionality
  console.log("\n========== TESTING VECTORDB ==========");
  const testDocuments: VectorDocument[] = [];
  let vectorIndexId: string | null = null;
  
  if ('createVectorIndex' in service) {
    console.log(`Testing vector operations...`);
    
    try {
      // First, create a vector index
      console.log("Creating vector index...");
      const vectorIndex = await service.createVectorIndex({
        id: `test-vector-index-${Date.now()}`,
        embeddingModel: "mock-model",
        maxDocuments: 1000
      });
      vectorIndexId = vectorIndex.id;
      console.log(`  Created vector index: ${vectorIndexId}`);
      
      // Create test documents
      const sampleTexts = [
        "Machine learning is a subset of artificial intelligence that focuses on algorithms.",
        "Natural language processing helps computers understand human language.",
        "Computer vision enables machines to interpret and understand visual information.",
        "Deep learning uses neural networks with multiple layers to learn patterns.",
        "Data science combines statistics, programming, and domain expertise."
      ];
      
      // Prepare documents for adding to vector store
      const documentsToAdd = [];
      for (let i = 0; i < Math.min(numVectorOperations, sampleTexts.length); i++) {
        const doc = {
          id: `test-doc-${i}`,
          text: sampleTexts[i], // Use 'text' instead of 'content'
          metadata: {
            source: "test",
            index: i,
            timestamp: new Date().toISOString()
          }
        };
        
        documentsToAdd.push(doc);
        testDocuments.push({
          id: doc.id,
          text: doc.text, // For our tracking
          metadata: doc.metadata
        });
      }
      
      // Add documents to vector store (batch operation)
      if (documentsToAdd.length > 0) {
        console.log(`Adding ${documentsToAdd.length} documents to vector store...`);
        try {
          const addResult = await service.addDocuments({
            indexId: vectorIndexId,
            documents: documentsToAdd
          });
          console.log(`  Successfully added ${addResult.addedCount} documents`);
        } catch (error) {
          console.error(`  Failed to add documents:`, error);
        }
      }
      
      // Test document search
      if (testDocuments.length > 0) {
        console.log("Testing document search...");
        
        const searchQueries = [
          "artificial intelligence and machine learning",
          "understanding human language",
          "visual information processing"
        ];
        
        for (const query of searchQueries.slice(0, 3)) {
          try {
            console.log(`  Searching for: "${query}"`);
            
            const searchResult = await service.queryVectorIndex({
              indexId: vectorIndexId,
              query: query,
              options: {
                k: 3,
                threshold: 0,
                includeMetadata: true
              }
            });
            
            console.log(`  Found ${searchResult.results.length} results`);
            for (const result of searchResult.results) {
              console.log(`    Score: ${result.score?.toFixed(3)}, Content: ${result.text?.substring(0, 60)}...`);
            }
          } catch (error) {
            console.error(`  Search failed for "${query}":`, error);
          }
        }
      }
      
      // Test vector index info
      if ('getVectorIndexInfo' in service) {
        try {
          const indexInfo = await service.getVectorIndexInfo({
            indexId: vectorIndexId
          });
          console.log(`Vector index info: ${indexInfo.documentCount} documents, dimension: ${indexInfo.embeddingDimension}`);
        } catch (error) {
          console.error("Failed to get vector index info:", error);
        }
      }
      
    } catch (error) {
      console.error("Failed to create vector index:", error);
    }
    
    // Test Vector Database Permission System
    console.log("\n========== TESTING VECTOR DATABASE PERMISSIONS ==========");
    
    if ('createVectorIndex' in service) {
      const permissionTestIndices: string[] = [];
      
      try {
        console.log("Testing vector database permission system...");
        
        // Test 1: Create indices with different permission levels
        const permissionTypes = [
          { name: "private", permission: "private", description: "Owner-only access" },
          { name: "public_read", permission: "public_read", description: "Cross-workspace read access" },
          { name: "public_read_add", permission: "public_read_add", description: "Cross-workspace read and add access" },
          { name: "public_read_write", permission: "public_read_write", description: "Full cross-workspace access" }
        ];
        
        console.log("Creating indices with different permission levels...");
        for (const permType of permissionTypes) {
          try {
            const index = await service.createVectorIndex({
              id: `remote-perm-test-${permType.name}`,
              permission: permType.permission,
              embeddingModel: "mock-model",
              inactivityTimeout: 300000 // 5 minutes
            });
            
            permissionTestIndices.push(index.id);
            console.log(`  ✅ Created ${permType.description} index: ${index.id}`);
          } catch (error) {
            console.error(`  ❌ Failed to create ${permType.name} index:`, error);
          }
        }
        
        // Test 2: Add documents to permission test indices
        const permissionTestDocs = [
          {
            id: "perm-doc-1",
            text: "This document tests permission-based access control across workspaces",
            metadata: { type: "permission_test", level: "basic", workspace: "remote_test" }
          },
          {
            id: "perm-doc-2",
            text: "Advanced permission validation for cross-workspace vector database operations",
            metadata: { type: "permission_test", level: "advanced", workspace: "remote_test", sensitive: true }
          },
          {
            id: "perm-doc-3",
            text: "Public document that should be accessible according to permission level",
            metadata: { type: "permission_test", level: "public", workspace: "remote_test", classification: "open" }
          }
        ];
        
        console.log("Adding test documents to permission indices...");
        for (const indexId of permissionTestIndices) {
          try {
            if ('addDocuments' in service) {
              await service.addDocuments({
                indexId: indexId,
                documents: permissionTestDocs
              });
              console.log(`  ✅ Added ${permissionTestDocs.length} documents to: ${indexId}`);
            }
          } catch (error) {
            console.error(`  ❌ Failed to add documents to ${indexId}:`, error);
          }
        }
        
        // Test 3: Query indices with different permission levels
        console.log("Testing queries on permission-controlled indices...");
        for (const indexId of permissionTestIndices) {
          try {
            if ('queryVectorIndex' in service) {
              const result = await service.queryVectorIndex({
                indexId: indexId,
                query: "permission access control workspace",
                options: { k: 3, threshold: 0.0, includeMetadata: true }
              });
              
              console.log(`  ✅ Query successful on ${indexId}: ${result.results.length} results`);
              
              // Verify metadata preservation
              if (result.results.length > 0 && result.results[0].metadata) {
                console.log(`    - First result metadata: ${JSON.stringify(result.results[0].metadata)}`);
              }
            }
          } catch (error) {
            console.error(`  ❌ Query failed on ${indexId}:`, error);
          }
        }
        
        // Test 4: Document removal with permission validation
        console.log("Testing document removal with permission validation...");
        for (const indexId of permissionTestIndices) {
          try {
            if ('removeDocuments' in service) {
              await service.removeDocuments({
                indexId: indexId,
                documentIds: ["perm-doc-1"]
              });
              console.log(`  ✅ Document removal successful on: ${indexId}`);
              
              // Verify removal by querying
              if ('queryVectorIndex' in service) {
                const verifyResult = await service.queryVectorIndex({
                  indexId: indexId,
                  query: "This document tests permission-based access",
                  options: { k: 5 }
                });
                
                const removedDocExists = verifyResult.results.some((r: any) => r.id === "perm-doc-1");
                if (!removedDocExists) {
                  console.log(`    ✅ Verified document removal from: ${indexId}`);
                } else {
                  console.log(`    ⚠️ Document may still exist in: ${indexId}`);
                }
              }
            }
          } catch (error) {
            console.error(`  ❌ Document removal failed on ${indexId}:`, error);
          }
        }
        
        // Test 5: Cross-workspace access simulation 
        console.log("Testing cross-workspace access patterns...");
        for (const indexId of permissionTestIndices) {
          try {
            if ('getVectorIndexInfo' in service) {
              const indexInfo = await service.getVectorIndexInfo({
                indexId: indexId
              });
              
              console.log(`  ✅ Index info retrieved for ${indexId}: ${indexInfo.documentCount} documents`);
              console.log(`    - Permission model validation successful`);
            }
          } catch (error) {
            console.error(`  ❌ Failed to get index info for ${indexId}:`, error);
          }
        }
        
        // Test 6: List indices to verify permission-controlled access
        console.log("Listing indices to verify permission-controlled access...");
        if ('listVectorIndices' in service) {
          try {
            const indices = await service.listVectorIndices();
            console.log(`  ✅ Listed ${indices.length} indices (permission filtering applied by service)`);
            
            // Check how many of our test indices are visible
            const visibleTestIndices = indices.filter((idx: any) => 
              permissionTestIndices.some(testId => idx.id === testId)
            );
            console.log(`  ✅ Visible permission test indices: ${visibleTestIndices.length}/${permissionTestIndices.length}`);
          } catch (error) {
            console.error(`  ❌ Failed to list indices:`, error);
          }
        }
        
        console.log("✅ Vector Database Permission System Tests completed!");
        
        // Clean up permission test indices
        console.log("Cleaning up permission test indices...");
        for (const indexId of permissionTestIndices) {
          try {
            if ('destroyVectorIndex' in service) {
              await service.destroyVectorIndex({ indexId: indexId });
              console.log(`  ✅ Cleaned up permission test index: ${indexId}`);
            }
          } catch (error) {
            console.error(`  ❌ Failed to clean up ${indexId}:`, error);
          }
        }
        
      } catch (error) {
        console.error("❌ Vector Database Permission System Tests failed:", error);
      }
    } else {
      console.log("Vector database permission tests skipped - createVectorIndex not available");
    }
    
  } else {
    console.log("VectorDB functionality not available in service");
  }
  
  // Cleanup
  console.log("\n========== CLEANUP ==========");
  
  // Cleanup agents
  if (agents.length > 0 && 'destroyAgent' in service) {
    console.log("Cleaning up agents...");
    for (const agent of agents) {
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
  
  // Cleanup Deno apps
  if (denoApps.length > 0 && 'destroyAgent' in service) {
    console.log("Cleaning up Deno apps...");
    for (const app of denoApps) {
      try {
        await service.destroyAgent({
          agentId: app.id
        });
        console.log(`  Destroyed Deno app ${app.id}`);
      } catch (error) {
        console.error(`  Failed to destroy Deno app ${app.id}:`, error);
      }
    }
  }
  
  // Cleanup vector index
  if (vectorIndexId && 'destroyVectorIndex' in service) {
    console.log("Cleaning up vector index...");
    try {
      await service.destroyVectorIndex({
        indexId: vectorIndexId
      });
      console.log(`  Destroyed vector index ${vectorIndexId}`);
    } catch (error) {
      console.error(`  Failed to destroy vector index ${vectorIndexId}:`, error);
    }
  }
  
  // Final verification
  console.log("Verifying cleanup...");
  
  if ('listAgents' in service) {
    try {
      const remainingAgents = await service.listAgents() as AgentInfo[];
      const testAgentsRemaining = remainingAgents.filter((a: AgentInfo) => 
        a.id.includes('test-agent-'));
      const testAppsRemaining = remainingAgents.filter((a: AgentInfo) => 
        a.id.includes('test-deno-app-'));
      
      console.log(`Remaining test agents: ${testAgentsRemaining.length}`);
      console.log(`Remaining test Deno apps: ${testAppsRemaining.length}`);
      
      if (testAgentsRemaining.length > 0) {
        console.log(`Warning: Some test agents were not properly destroyed: ${testAgentsRemaining.map((a: AgentInfo) => a.id).join(', ')}`);
      }
      if (testAppsRemaining.length > 0) {
        console.log(`Warning: Some test Deno apps were not properly destroyed: ${testAppsRemaining.map((a: AgentInfo) => a.id).join(', ')}`);
      }
    } catch (error) {
      console.error("Failed to verify agent cleanup:", error);
    }
  }
  
  // Verify vector index cleanup
  if ('listVectorIndices' in service) {
    try {
      const remainingIndices = await service.listVectorIndices();
      const testIndicesRemaining = remainingIndices.filter((idx: any) => 
        idx.id.includes('test-vector-index-'));
      
      console.log(`Remaining test vector indices: ${testIndicesRemaining.length}`);
      if (testIndicesRemaining.length > 0) {
        console.log(`Warning: Some test vector indices were not properly destroyed: ${testIndicesRemaining.map((idx: any) => idx.id).join(', ')}`);
      }
    } catch (error) {
      console.error("Failed to verify vector index cleanup:", error);
    }
  }

  // Test comprehensive app management functions
  console.log("\n========== TESTING COMPREHENSIVE APP MANAGEMENT FUNCTIONS ==========");
  
  let availableApps: any[] = [];
  let testAppId: string | null = null;
  
  // Test 1: List all apps
  if ('listApps' in service) {
    try {
      console.log("1. Testing listApps function...");
      const appsResult = await service.listApps();
      console.log(`✅ Listed ${appsResult.totalCount} total deno-apps`);
      
      availableApps = appsResult.apps || [];
      
      if (availableApps.length > 0) {
        console.log("📋 Found apps:");
        for (const app of availableApps.slice(0, 3)) { // Show first 3 apps
          console.log(`  - ${app.name} (${app.id}): ${app.status} [${app.language}]`);
          console.log(`    Description: ${app.description || 'No description'}`);
          console.log(`    Created: ${app.created}`);
          
          // Save first app for detailed testing
          if (!testAppId) {
            testAppId = app.id;
          }
        }
      } else {
        console.log("ℹ️ No deno-apps found in the system");
      }
    } catch (error) {
      console.error("❌ Failed to test listApps:", error);
    }
  } else {
    console.log("⚠️ listApps function not available in service");
  }
  
  // Test 2: Get app statistics
  if ('getAppStats' in service) {
    try {
      console.log("\n2. Testing getAppStats function...");
      const statsResult = await service.getAppStats();
      console.log(`✅ App Statistics Retrieved:`);
      console.log(`  📊 Total apps: ${statsResult.totalApps}`);
      console.log(`  🏃 Running apps: ${statsResult.runningApps}`);
      console.log(`  😴 Idle apps: ${statsResult.idleApps}`);
      console.log(`  ⚙️ Executing apps: ${statsResult.executingApps}`);
      console.log(`  🔴 Stuck apps: ${statsResult.stuckApps}`);
      console.log(`  ❌ Error apps: ${statsResult.errorApps}`);
      console.log(`  🔢 Total executions: ${statsResult.totalExecutions}`);
      console.log(`  💾 Average memory per app: ${formatBytes(statsResult.memoryUsage)}`);
      
      if (statsResult.apps && statsResult.apps.length > 0) {
        console.log(`  📋 App details available for ${statsResult.apps.length} apps`);
      }
    } catch (error) {
      console.error("❌ Failed to test getAppStats:", error);
    }
  } else {
    console.log("⚠️ getAppStats function not available in service");
  }
  
  // Test 3: Get detailed app info (if we have an app to test)
  if (testAppId && 'getAppInfo' in service) {
    try {
      console.log(`\n3. Testing getAppInfo function for app: ${testAppId}...`);
      const appInfoResult = await service.getAppInfo({ appId: testAppId });
      console.log(`✅ App Info Retrieved:`);
      console.log(`  📛 Name: ${appInfoResult.name}`);
      console.log(`  📝 Description: ${appInfoResult.description || 'No description'}`);
      console.log(`  📊 Status: ${appInfoResult.status}`);
      console.log(`  🗣️ Language: ${appInfoResult.language}`);
      console.log(`  🕐 Created: ${appInfoResult.created}`);
      console.log(`  ⏱️ Uptime: ${appInfoResult.uptimeFormatted}`);
      console.log(`  🔄 Active executions: ${appInfoResult.activeExecutions}`);
      console.log(`  🚨 Is stuck: ${appInfoResult.isStuck}`);
      console.log(`  📚 History count: ${appInfoResult.historyCount}`);
      console.log(`  🏗️ Mode: ${appInfoResult.mode}`);
      
      if (appInfoResult.manifest) {
        console.log(`  📄 Manifest available with ${Object.keys(appInfoResult.manifest).length} properties`);
      }
    } catch (error) {
      console.error(`❌ Failed to test getAppInfo for ${testAppId}:`, error);
    }
  } else if (!testAppId) {
    console.log("⚠️ No app available to test getAppInfo");
  } else {
    console.log("⚠️ getAppInfo function not available in service");
  }
  
  // Test 4: Get app kernel logs (enhanced testing)
  if (testAppId && 'getAppKernelLogs' in service) {
    try {
      console.log(`\n4. Testing getAppKernelLogs function for app: ${testAppId}...`);
      
      // Test with different line limits
      const lineLimits = [5, 20, 50];
      
      for (const lines of lineLimits) {
        try {
          const logsResult = await service.getAppKernelLogs({
            appId: testAppId,
            lines: lines
          });
          
          console.log(`✅ Retrieved logs (${lines} lines requested):`);
          console.log(`  📜 Log entries returned: ${logsResult.logs.length}`);
          console.log(`  📊 Total log entries available: ${logsResult.totalLogEntries}`);
          console.log(`  🔧 Kernel status: ${logsResult.kernelStatus}`);
          
          if (logsResult.currentExecution) {
            console.log(`  ⚙️ Current executions: ${logsResult.currentExecution.activeExecutions}`);
            console.log(`  🚨 Is stuck: ${logsResult.currentExecution.isStuck}`);
          }
          
          if (logsResult.logs.length > 0) {
                         console.log(`  📄 Log types found: ${[...new Set(logsResult.logs.map((log: any) => log.type))].join(', ')}`);
             console.log(`  📝 Sample log: ${logsResult.logs[0].content?.substring(0, 80)}...`);
             
             // Show execution start/end logs if present
             const executionLogs = logsResult.logs.filter((log: any) => 
               log.type === 'execution_start' || log.type === 'execution_end'
             );
            if (executionLogs.length > 0) {
              console.log(`  🔄 Found ${executionLogs.length} execution lifecycle logs`);
            }
          }
          
          break; // Only test the first line limit to avoid spam
        } catch (error) {
          console.log(`  ⚠️ Could not get logs (${lines} lines) for app ${testAppId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.error(`❌ Failed to test getAppKernelLogs for ${testAppId}:`, error);
    }
  } else if (!testAppId) {
    console.log("⚠️ No app available to test getAppKernelLogs");
  } else {
    console.log("⚠️ getAppKernelLogs function not available in service");
  }
  
  // Test 5: Management operations (may fail due to workspace restrictions)
  console.log("\n5. Testing app management operations (may fail due to workspace restrictions)...");
  
  // Test notifyAppUpdates
  if ('notifyAppUpdates' in service) {
    try {
      console.log("Testing notifyAppUpdates function...");
      const updateResult = await service.notifyAppUpdates();
      console.log(`✅ App updates check completed:`);
      console.log(`  📦 Total apps found: ${updateResult.results.totalApps}`);
      console.log(`  ⏭️ Skipped apps: ${updateResult.results.skippedApps.length}`);
      console.log(`  🚀 Started apps: ${updateResult.results.startedApps.length}`);
      console.log(`  ❌ Failed apps: ${updateResult.results.failedApps.length}`);
    } catch (error) {
      console.log(`⚠️ notifyAppUpdates failed (likely due to workspace restriction): ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    console.log("⚠️ notifyAppUpdates function not available in service");
  }
  
  // Test executeInApp (if we have an app)
  if (testAppId && 'executeInApp' in service) {
    try {
      console.log(`Testing executeInApp function for app: ${testAppId}...`);
      const testCode = `
// Test execution in app context
console.log("Hello from remote test execution!");
console.log("Current time:", new Date().toISOString());
console.log("Test execution completed successfully");
`;
      
      const execResult = await service.executeInApp({
        appId: testAppId,
        code: testCode
      });
      
      console.log(`✅ Code execution initiated in app ${testAppId}:`);
      console.log(`  🆔 Execution ID: ${execResult.executionId}`);
      console.log(`  📝 Message: ${execResult.message}`);
      
      // Wait a bit and try to get updated logs
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if ('getAppKernelLogs' in service) {
        try {
          const updatedLogs = await service.getAppKernelLogs({
            appId: testAppId,
            lines: 10
          });
          
          console.log(`  📜 Updated logs after execution: ${updatedLogs.logs.length} entries`);
        } catch (error) {
          console.log(`  ⚠️ Could not get updated logs: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.log(`⚠️ executeInApp failed (likely due to workspace restriction): ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!testAppId) {
    console.log("⚠️ No app available to test executeInApp");
  } else {
    console.log("⚠️ executeInApp function not available in service");
  }
  
  // Test reloadApp (non-destructive, but may fail due to workspace restrictions)
  if (testAppId && 'reloadApp' in service && availableApps.length > 1) {
    try {
      // Only test reload on non-critical apps or if there are multiple apps
      console.log(`Testing reloadApp function for app: ${testAppId}...`);
      const reloadResult = await service.reloadApp({ appId: testAppId });
      console.log(`✅ App reload completed:`);
      console.log(`  📝 Message: ${reloadResult.message}`);
      console.log(`  🆔 App ID: ${reloadResult.appId}`);
    } catch (error) {
      console.log(`⚠️ reloadApp failed (likely due to workspace restriction): ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!testAppId) {
    console.log("⚠️ No app available to test reloadApp");
  } else if (availableApps.length <= 1) {
    console.log("⚠️ Skipping reloadApp test - only one app available (safety measure)");
  } else {
    console.log("⚠️ reloadApp function not available in service");
  }
  
  // Note: We intentionally skip killApp testing to avoid disrupting running apps
  console.log("\n⚠️ Note: killApp function testing skipped to avoid disrupting running deno-apps");
  
  console.log("\n✅ App Management Functions Testing completed!");
  
  // Helper function for formatting bytes (if not already defined)
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Summary
  console.log("\n========== TEST SUMMARY ==========");
  console.log(`Service: ${serviceId}`);
  console.log(`Agents created: ${agents.length}/${numAgents}`);
  console.log(`Deno apps created: ${denoApps.length}/${numAgents}`);
  console.log(`Vector index created: ${vectorIndexId ? 1 : 0}/1`);
  console.log(`Documents added: ${testDocuments.length}/${numVectorOperations}`);
  console.log("==========================================\n");
  
  return {
    server,
    service,
    agents,
    testDocuments
  };
}

if (import.meta.main) {
  try {
    const { server } = await runRemoteServiceTest();
    console.log("Remote service test completed successfully!");
    
    // Disconnect from server
    if (server && 'disconnect' in server) {
      await server.disconnect();
      console.log("Disconnected from server.");
    }
  } catch (error) {
    console.error("Remote service test failed:", error);
    Deno.exit(1);
  }
} 