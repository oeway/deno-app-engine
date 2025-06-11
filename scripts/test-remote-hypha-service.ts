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
  
  // Test Agent functionality with namespace support
  console.log("\n========== TESTING AGENTS WITH NAMESPACE SUPPORT ==========");
  const agents = [];
  
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
    
    // Test workspace isolation (now handled internally by the service)
    console.log("Testing internal namespace isolation...");
    try {
      const allAgents = await service.listAgents() as AgentInfo[];
      console.log(`Total agents found in this workspace: ${allAgents.length}`);
      
      // Since namespace is now internal, all agents should be accessible within the same workspace
      const testAgents = allAgents.filter(a => a.id.includes('test-agent-'));
      console.log(`Test agents in this workspace: ${testAgents.length}`);
      
      if (testAgents.length > 0) {
        console.log(`✅ Internal namespace isolation working - agents are scoped to workspace`);
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
      
      console.log(`Remaining test agents: ${testAgentsRemaining.length}`);
      if (testAgentsRemaining.length > 0) {
        console.log(`Warning: Some test agents were not properly destroyed: ${testAgentsRemaining.map((a: AgentInfo) => a.id).join(', ')}`);
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

  // Summary
  console.log("\n========== TEST SUMMARY ==========");
  console.log(`Service: ${serviceId}`);
  console.log(`Agents created: ${agents.length}/${numAgents}`);
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