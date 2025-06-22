// Agent Service Manager for Deno App Engine
// This manages the Hypha services for agent-kernel communication

import { crypto } from "https://deno.land/std@0.208.0/crypto/mod.ts";
import { PlanningStep, StepType, CompletionData } from "./agent.ts";

export interface AgentServiceCall {
  completionId: string;
  timestamp: number;
  data: any;
}

// Remove AgentServiceStorage interface - no longer needed since we use agent memory

/**
 * Manages Hypha services for agent-kernel communication
 * Provides logThoughts, updatePlan, and returnToUser functionality
 * Now operates directly on agent memory instead of separate storage
 */
export class AgentServiceManager {
  private services: Map<string, string> = new Map(); // agentId -> serviceId
  private manager: any; // AgentManager reference

  constructor(manager: any) {
    this.manager = manager;
  }

  /**
   * Generate a random service ID
   */
  private generateServiceId(): string {
    // Use the same workspace as the HyphaCore configuration
    const workspace = this.manager.getHyphaCoreInfo().workspace || 'default';
    return `${workspace}/agent-service:${crypto.randomUUID()}`;
  }

  /**
   * Register a Hypha service for an agent-kernel pair
   */
  async registerService(agentId: string, kernelId: string): Promise<string> {
    if (!this.manager.getHyphaAPI()) {
      throw new Error("HyphaCore not enabled or not started");
    }

    const serviceId = `agent-${agentId}-service`;
    
    try {
      const service = {
        id: serviceId,
        config: {
          name: `agent-${agentId}-service`,
          description: `Service for agent ${agentId} with kernel ${kernelId}`
        },
        
        // Log thoughts for the current completion - now stores in agent memory
        logThoughts: async (completionId: string, thoughts: string) => {
          console.log(`💭 [Agent ${agentId}] Thoughts logged for completion ${completionId}`);
          
          try {
            const agent = this.manager.getAgent(agentId);
            if (!agent) {
              console.error(`❌ Agent ${agentId} not found for thoughts logging`);
              return { success: false, message: "Agent not found" };
            }

            // Get or create completion data
            let completionData = agent.memory.getCompletionData(completionId);
            if (!completionData) {
              completionData = { completionId };
            }

            // Update thoughts
            completionData.thoughts = {
              timestamp: Date.now(),
              data: thoughts
            };

            // Store back to agent memory
            agent.memory.setCompletionData(completionId, completionData);
            
            console.log(`✅ [Agent ${agentId}] Thoughts stored in agent memory`);
            return { success: true, message: "Thoughts logged in agent memory" };
          } catch (error) {
            console.error(`❌ Failed to log thoughts for agent ${agentId}:`, error);
            return { success: false, message: `Failed to log thoughts: ${error instanceof Error ? error.message : 'Unknown error'}` };
          }
        },

        // Update plan for the current completion - directly updates agent memory
        updatePlan: async (completionId: string, plan: string) => {
          console.log(`📋 [Agent ${agentId}] Plan updated for completion ${completionId}`);
          
          try {
            // Get the agent instance
            const agent = this.manager.getAgent(agentId);
            if (!agent) {
              console.error(`❌ Agent ${agentId} not found for plan update`);
              return { success: false, message: "Agent not found" };
            }

            // Create a PlanningStep and add it directly to agent memory
            const planningStep: PlanningStep = {
              type: StepType.PLANNING,
              stepNumber: agent.memory.steps.length + 1,
              startTime: Date.now(),
              endTime: Date.now(),
              modelInputMessages: [], // Service-based update, no model input
              modelOutputMessageFacts: { 
                role: 'assistant', 
                content: `Plan updated via service call (completion: ${completionId})` 
              },
              facts: `Plan updated via service call (completion: ${completionId})`,
              modelOutputMessagePlan: { 
                role: 'assistant', 
                content: plan 
              },
              plan: plan
            };

            // Add the planning step directly to agent memory
            agent.memory.addStep(planningStep);
            
            console.log(`✅ [Agent ${agentId}] Plan update added directly to agent memory`);
            
            return { success: true, message: "Plan updated in agent memory" };
          } catch (error) {
            console.error(`❌ Failed to update plan for agent ${agentId}:`, error);
            return { success: false, message: `Failed to update plan: ${error instanceof Error ? error.message : 'Unknown error'}` };
          }
        },

        // Return to user and stop the react loop - now stores in agent memory
        returnToUser: async (completionId: string, content: string, commitIds?: string[]) => {
          console.log(`📤 [Agent ${agentId}] Returning to user for completion ${completionId}`);
          
          try {
            const agent = this.manager.getAgent(agentId);
            if (!agent) {
              console.error(`❌ Agent ${agentId} not found for returnToUser`);
              return { success: false, message: "Agent not found" };
            }

            // Get or create completion data
            let completionData = agent.memory.getCompletionData(completionId);
            if (!completionData) {
              completionData = { completionId };
            }

            // Store the returnToUser data
            completionData.returnToUser = {
              timestamp: Date.now(),
              data: { content, commitIds }
            };

            agent.memory.setCompletionData(completionId, completionData);
            console.log(`✅ [Agent ${agentId}] returnToUser stored in agent memory`);

            return { success: true, content, commitIds };
          } catch (error) {
            console.error(`❌ returnToUser failed for agent ${agentId}:`, error);
            return { success: false, message: error instanceof Error ? error.message : String(error) };
          }
        }
      };

      const svc = await this.manager.getHyphaAPI().registerService(service);
      this.services.set(agentId, svc.id);
      
      console.log(`✅ Registered Hypha service ${svc.id} for agent ${agentId}`);
      return svc.id;
      
    } catch (error) {
      console.error(`❌ Failed to register service for agent ${agentId}:`, error);
      throw error;
    }
  }

  /**
   * Unregister a Hypha service for an agent
   */
  async unregisterService(agentId: string): Promise<void> {
    const serviceId = this.services.get(agentId);
    
    if (!serviceId) {
      console.warn(`⚠️ No service registered for agent ${agentId}`);
      return;
    }

    if (!this.manager.getHyphaAPI()) {
      console.warn(`⚠️ HyphaCore not available for unregistering service ${serviceId}`);
      return;
    }

    try {
      await this.manager.getHyphaAPI().unregisterService(serviceId);
      this.services.delete(agentId);
      
      console.log(`✅ Unregistered Hypha service ${serviceId} for agent ${agentId}`);
    } catch (error) {
      console.error(`❌ Failed to unregister service for agent ${agentId}:`, error);
    }
  }

  /**
   * Get the service ID for an agent
   */
  getServiceId(agentId: string): string | undefined {
    return this.services.get(agentId);
  }

  /**
   * Check if an agent has a registered HyphaCore service
   */
  hasService(agentId: string): boolean {
    return this.services.has(agentId);
  }

  /**
   * Check if a completion has HyphaCore services available (by checking if the agent has services)
   */
  hasServiceForCompletion(agentId: string): boolean {
    // Check if the specific agent has a registered service
    return this.services.has(agentId);
  }

  /**
   * Get completion data for a completion from agent memory
   */
  getServiceCalls(completionId: string, agentId?: string): any {
    if (!agentId) {
      console.warn(`⚠️ getServiceCalls called without agentId for completion ${completionId}`);
      return undefined;
    }
    
    const agent = this.manager.getAgent(agentId);
    if (!agent) {
      console.warn(`⚠️ Agent ${agentId} not found for completion ${completionId}`);
      return undefined;
    }
    
    // Get data from agent memory (normal path only)
    const completionData = agent.memory.getCompletionData(completionId);
    return completionData;
  }

  /**
   * Clear completion data for a completion from agent memory
   */
  clearServiceCalls(completionId: string, agentId?: string): void {
    if (!agentId) {
      console.warn(`⚠️ clearServiceCalls called without agentId for completion ${completionId}`);
      return;
    }
    
    const agent = this.manager.getAgent(agentId);
    if (!agent) {
      console.warn(`⚠️ Agent ${agentId} not found for completion ${completionId}`);
      return;
    }
    
    agent.memory.clearCompletionData(completionId);
  }

  /**
   * Generate wrapper code for agent service functions based on kernel type
   * Updated to include _rintf property for hypha-rpc compatibility
   */
  async generateWrapperCode(agentId: string, completionId: string, kernelType: string): Promise<string> {
    const serviceId = this.getServiceId(agentId);
    
    if (!serviceId) {
      console.warn(`⚠️ [Agent ${agentId}] No HyphaCore service registered - cannot generate wrapper functions`);
      return '';
    }

    // Get HyphaCore connection info from the manager
    const hyphaCoreInfo = this.manager.getHyphaCoreInfo();
    if (!hyphaCoreInfo.enabled) {
      console.warn(`⚠️ [Agent ${agentId}] HyphaCore not enabled - cannot generate wrapper functions`);
      return '';
    }

    // Get HyphaCore API to generate token
    const hyphaAPI = this.manager.getHyphaAPI();
    if (!hyphaAPI) {
      console.warn(`⚠️ [Agent ${agentId}] HyphaCore API not available - cannot generate wrapper functions`);
      return '';
    }

    // Generate token for this agent (same as startup script)
    let token: string;
    try {
      token = await hyphaAPI.generateToken({
        user_id: `agent-${agentId}`,
        workspace: hyphaCoreInfo.workspace,
        expires_in: 3600 // 1 hour
      });
    } catch (error) {
      console.error(`❌ [Agent ${agentId}] Failed to generate token for wrapper:`, error);
      return '';
    }

    if (kernelType === 'python') {
      return `
# Agent service wrapper functions with _rintf property for hypha-rpc compatibility
currentCompletionId = "${completionId}"

async def logThoughts(thoughts):
    """Log thoughts for the current completion"""
    api = await _hypha_server.get_service("${serviceId}")
    return await api.logThoughts(currentCompletionId, thoughts)

# Mark function as interface function for hypha-rpc
logThoughts._rintf = True

async def updatePlan(plan):
    """Update the plan for the current completion"""
    api = await _hypha_server.get_service("${serviceId}")
    return await api.updatePlan(currentCompletionId, plan)

# Mark function as interface function for hypha-rpc
updatePlan._rintf = True

async def returnToUser(content, commitIds=None):
    """Return content to user and stop the react loop"""
    api = await _hypha_server.get_service("${serviceId}")
    return await api.returnToUser(currentCompletionId, content, commitIds)

# Mark function as interface function for hypha-rpc
returnToUser._rintf = True

print("✅ Agent service functions ready: logThoughts(), updatePlan(), returnToUser()")
`;
    } else if (kernelType === 'javascript' || kernelType === 'typescript') {
      return `
// Agent service wrapper functions - Store globally to persist between executions
// Updated with _rintf property for hypha-rpc compatibility
globalThis.currentCompletionId = "${completionId}";

// Function to update the completion ID dynamically
globalThis.setCurrentCompletionId = function(completionId) {
    globalThis.currentCompletionId = completionId;
    console.log("📋 Updated current completion ID:", completionId);
};

// Function to get a working _hyphaServer connection - Store globally
globalThis.getWorkingHyphaServer = function() {
    console.log("🔍 getWorkingHyphaServer: Checking for HyphaServer connection...");
    
    // Try multiple ways to get the hypha server connection
    let hyphaServer = globalThis._hyphaServer || 
                     (typeof self !== 'undefined' ? self._hyphaServer : null) ||
                     (globalThis.getHyphaServer && globalThis.getHyphaServer()) ||
                     (typeof self !== 'undefined' && self.getHyphaServer ? self.getHyphaServer() : null);
    
    console.log("🔍 HyphaServer search results:", {
        globalThis_hyphaServer: !!globalThis._hyphaServer,
        self_hyphaServer: typeof self !== 'undefined' ? !!self._hyphaServer : 'self undefined',
        globalThis_getHyphaServer: !!globalThis.getHyphaServer,
        self_getHyphaServer: typeof self !== 'undefined' ? !!self.getHyphaServer : 'self undefined',
        finalHyphaServer: !!hyphaServer
    });
    
    if (!hyphaServer) {
        const error = new Error("HyphaServer connection not available - startup script may have failed");
        console.error("❌ getWorkingHyphaServer failed:", error.message);
        console.error("💡 Debugging info: Check if the HyphaCore startup script executed successfully");
        throw error;
    }
    
    // Additional validation to check if the connection is healthy
    try {
        if (hyphaServer && typeof hyphaServer.getService === 'function') {
            console.log("✅ HyphaServer connection appears healthy");
        } else {
            console.warn("⚠️ HyphaServer exists but getService method not available");
        }
    } catch (validationError) {
        console.error("❌ HyphaServer validation failed:", validationError);
        throw new Error("HyphaServer connection is corrupted: " + (validationError instanceof Error ? validationError.message : String(validationError)));
    }
    
    return hyphaServer;
};

// Store service functions globally so they persist between executions
globalThis.logThoughts = async function(thoughts) {
    try {
        const hyphaServer = globalThis.getWorkingHyphaServer();
        const api = await hyphaServer.getService("${serviceId}");
        return await api.logThoughts(globalThis.currentCompletionId, thoughts);
    } catch (error) {
        console.error("❌ logThoughts failed:", error);
        return { success: false, message: "logThoughts failed: " + (error instanceof Error ? error.message : String(error)) };
    }
};

// Mark function as interface function for hypha-rpc
globalThis.logThoughts._rintf = true;

globalThis.updatePlan = async function(plan) {
    try {
        const hyphaServer = globalThis.getWorkingHyphaServer();
        const api = await hyphaServer.getService("${serviceId}");
        return await api.updatePlan(globalThis.currentCompletionId, plan);
    } catch (error) {
        console.error("❌ updatePlan failed:", error);
        return { success: false, message: "updatePlan failed: " + (error instanceof Error ? error.message : String(error)) };
    }
};

// Mark function as interface function for hypha-rpc
globalThis.updatePlan._rintf = true;

globalThis.returnToUser = async function(content, commitIds = null) {
    try {
        const hyphaServer = globalThis.getWorkingHyphaServer();
        const api = await hyphaServer.getService("${serviceId}");
        
        // Direct service call without timeout or fallback - it must work!
        const result = await api.returnToUser(globalThis.currentCompletionId, content, commitIds);
        console.log("📤 returnToUser completed successfully");
        return result;
    } catch (error) {
        console.error("❌ returnToUser failed:", error);
        // Re-throw the error instead of using fallback - we need to fix the real issue
        throw error;
    }
};

// Mark function as interface function for hypha-rpc
globalThis.returnToUser._rintf = true;

// Make functions available in local scope as well
const logThoughts = globalThis.logThoughts;
const updatePlan = globalThis.updatePlan;
const returnToUser = globalThis.returnToUser;

console.log("✅ Agent service functions ready: logThoughts(), updatePlan(), returnToUser()");
console.log("🔧 Functions marked with _rintf=true for hypha-rpc persistence");
`;
    } else {
      console.warn(`⚠️ Unsupported kernel type for wrapper code: ${kernelType}`);
      return '';
    }
  }

  /**
   * Clean up old completion data from all agents
   */
  cleanupOldEntries(maxAgeMs: number = 3600000): void {
    let totalCleaned = 0;
    
    // Iterate through all agents and clean their completion memory
    for (const agentId of this.services.keys()) {
      const agent = this.manager.getAgent(agentId);
      if (agent) {
        const sizeBefore = agent.memory.completionMemory.size;
        agent.memory.cleanupOldCompletions(maxAgeMs);
        const sizeAfter = agent.memory.completionMemory.size;
        totalCleaned += (sizeBefore - sizeAfter);
      }
    }

    if (totalCleaned > 0) {
      console.log(`🧹 Cleaned up ${totalCleaned} old completion entries across all agents`);
    }
  }

  /**
   * Get statistics about service usage across all agents
   */
  getStats(): {
    registeredServices: number;
    activeCompletions: number;
    totalThoughts: number;
    totalReturns: number;
  } {
    let totalThoughts = 0;
    let totalReturns = 0;
    let activeCompletions = 0;

    // Iterate through all agents and count their completion data
    for (const agentId of this.services.keys()) {
      const agent = this.manager.getAgent(agentId);
      if (agent) {
        activeCompletions += agent.memory.completionMemory.size;
        
        for (const completionData of agent.memory.completionMemory.values()) {
          if (completionData.thoughts) totalThoughts++;
          if (completionData.returnToUser) totalReturns++;
        }
      }
    }

    return {
      registeredServices: this.services.size,
      activeCompletions,
      totalThoughts,
      totalReturns
    };
  }
}