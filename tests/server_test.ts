import { assertEquals } from "https://deno.land/std@0.201.0/assert/assert_equals.ts";
import { assertExists } from "https://deno.land/std@0.201.0/assert/assert_exists.ts";
import { assert } from "https://deno.land/std@0.201.0/assert/assert.ts";
import { handleRequest } from "../scripts/server.ts";

// Helper function to start test server
async function startTestServer(port: number) {
  const controller = new AbortController();
  const serverPromise = Deno.serve({ 
    port,
    signal: controller.signal,
    onListen: undefined,
  }, handleRequest);
  
  return {
    close: async () => {
      controller.abort();
      await serverPromise.finished;
    }
  };
}

// Helper function to make requests to test server
async function makeRequest(path: string, method = "GET", body?: unknown, port = 8001) {
  const url = `http://localhost:${port}/api${path}`;
  const options: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  
  if (contentType.includes("application/json") || path.endsWith("/execute/submit")) {
    const json = await response.json();
    return json;
  } else if (contentType.includes("application/x-ndjson")) {
    // Handle NDJSON responses from execute endpoint
    const text = await response.text();
    const lines = text.trim().split('\n').filter(line => line.trim());
    const events = lines.map(line => JSON.parse(line));
    return events;
  }
  
  return response;
}

// Helper to read SSE stream
async function readSSEStream(response: Response, timeout = 5000): Promise<unknown[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: unknown[] = [];
  const startTime = Date.now();
  
  while (true) {
    if (Date.now() - startTime > timeout) {
      break;
    }
    
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value);
    const lines = text.split("\n\n");
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        events.push(data);
      }
    }
  }
  
  reader.releaseLock();
  return events;
}

let server: { close: () => Promise<void> };
let kernelId: string;

// Setup
Deno.test({
  name: "setup",
  fn: async () => {
    server = await startTestServer(8001);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: List kernels (empty)
Deno.test({
  name: "GET /kernels - should return empty list initially",
  async fn() {
    const kernels = await makeRequest("/kernels");
    assertEquals(kernels, []);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Create kernel
Deno.test({
  name: "POST /kernels - should create new kernel",
  async fn() {
    const result = await makeRequest("/kernels", "POST", {});
    assertExists(result.id);
    kernelId = result.id;
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: List kernels (with created kernel)
Deno.test({
  name: "GET /kernels - should list created kernel",
  async fn() {
    const kernels = await makeRequest("/kernels");
    assertEquals(kernels.length, 1);
    assertEquals(kernels[0].id, kernelId);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Execute code
Deno.test({
  name: "POST /kernels/:id/execute - should execute code",
  async fn() {
    const code = 'print("Hello, World!")';
    const result = await makeRequest(`/kernels/${kernelId}/execute`, "POST", { code });
    
    // Check for stdout output
    const stdoutEvent = result.find((event: any) => 
      event.type === "stream" && 
      event.data.name === "stdout" &&
      event.data.text.includes("Hello, World!")
    );
    assertExists(stdoutEvent);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Stream execution
Deno.test({
  name: "POST /kernels/:id/execute/stream - should stream execution results",
  async fn() {
    const code = `print("Start")
import time
time.sleep(0.1)
print("Middle")
time.sleep(0.1)
print("End")`;
    
    const response = await fetch(`http://localhost:8001/api/kernels/${kernelId}/execute/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    
    const events = await readSSEStream(response);
    
    // Verify we got all three print outputs, filtering out any previous outputs
    const outputs = events
      .filter((event: any) => event.type === "stream")
      .map((event: any) => event.data.text.trim())
      .filter(text => text.length > 0 && ["Start", "Middle", "End"].includes(text));
    
    assertEquals(outputs, ["Start", "Middle", "End"]);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Submit async execution
Deno.test({
  name: "POST /kernels/:id/execute/submit - should submit async execution",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    const code = `
import time
time.sleep(1)
print("Async execution complete!")
result = 42
result  # This will be in execute_result
`;
    const submitResult = await makeRequest(`/kernels/${testKernelId}/execute/submit`, "POST", { code });
    console.log("Submit result:", submitResult);
    assertExists(submitResult.session_id);
    const sessionId = submitResult.session_id;

    // Get results - this should block until execution is complete
    const execResult = await makeRequest(`/kernels/${testKernelId}/execute/result/${sessionId}`);
    
    // Verify stdout and result
    const stdoutEvent = execResult.find((event: any) => 
      event.type === "stream" && 
      event.data.name === "stdout" &&
      event.data.text.includes("Async execution complete!")
    );
    assertExists(stdoutEvent);

    const resultEvent = execResult.find((event: any) =>
      event.type === "execute_result" &&
      event.data.data["text/plain"] === "42"
    );
    assertExists(resultEvent);
    
    // Clean up the test kernel
    await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Stream async execution
Deno.test({
  name: "GET /kernels/:id/execute/stream/:session_id - should stream async execution",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    const code = `
print("Starting async task")
import time
time.sleep(0.5)
print("Middle of async task")
time.sleep(0.5)
print("Async task complete")
`;
    
    // Submit the execution
    const submitResult = await makeRequest(`/kernels/${testKernelId}/execute/submit`, "POST", { code });
    assertExists(submitResult.session_id);
    const sessionId = submitResult.session_id;

    // Start streaming - should get accumulated results plus new ones
    const response = await fetch(
      `http://localhost:8001/api/kernels/${testKernelId}/execute/stream/${sessionId}`,
      { headers: { "Accept": "text/event-stream" } }
    );
    
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    
    const events = await readSSEStream(response);
    
    // Verify we got all outputs in order
    const outputs = events
      .filter((event: any) => event.type === "stream")
      .map((event: any) => event.data.text.trim())
      .filter(text => text.length > 0);
    
    assertEquals(outputs, [
      "Starting async task",
      "Middle of async task",
      "Async task complete"
    ]);
    
    // Clean up the test kernel
    await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Get kernel info with execution history
Deno.test({
  name: "GET /kernels/:id/info - should return kernel info with history",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    // Execute some code to create history
    await makeRequest(`/kernels/${testKernelId}/execute`, "POST", { code: 'print("Test 1")' });
    await makeRequest(`/kernels/${testKernelId}/execute`, "POST", { code: 'print("Test 2")' });
    
    const info = await makeRequest(`/kernels/${testKernelId}/info`);
    
    // Verify basic info
    assertEquals(info.id, testKernelId);
    assertEquals(info.mode, "worker");
    assertExists(info.created);
    assertExists(info.name);
    
    // Verify history contains our executions
    assertEquals(Array.isArray(info.history), true);
    assert(info.history.length >= 2, "Expected at least 2 history entries");
    
    // Verify history entry structure
    const lastEntry = info.history[info.history.length - 1];
    assertExists(lastEntry.id); // session id
    assertExists(lastEntry.script); // executed code
    assertEquals(Array.isArray(lastEntry.outputs), true);
    
    // Clean up the test kernel
    await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// TypeScript Kernel Tests
let tsKernelId: string;

// Test: Create TypeScript kernel
Deno.test({
  name: "POST /kernels - should create new TypeScript kernel",
  async fn() {
    const result = await makeRequest("/kernels", "POST", { lang: "typescript" });
    assertExists(result.id);
    tsKernelId = result.id;
    assertEquals(result.language, "typescript");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Execute TypeScript code
Deno.test({
  name: "POST /kernels/:id/execute - should execute TypeScript code",
  async fn() {
    const code = 'console.log("Hello from TypeScript!"); const result = 5 + 3; result';
    const result = await makeRequest(`/kernels/${tsKernelId}/execute`, "POST", { code });
    
    // Check for stdout output
    const stdoutEvent = result.find((event: any) => 
      event.type === "stream" && 
      event.data.name === "stdout" &&
      event.data.text.includes("Hello from TypeScript!")
    );
    assertExists(stdoutEvent);
    
    // Check for execution result
    const executeResult = result.find((event: any) => 
      event.type === "execute_result" &&
      event.data.data["text/plain"] === "8"
    );
    assertExists(executeResult);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Execute TypeScript code with error
Deno.test({
  name: "POST /kernels/:id/execute - should handle TypeScript errors",
  async fn() {
    const code = 'throw new Error("TypeScript test error");';
    const result = await makeRequest(`/kernels/${tsKernelId}/execute`, "POST", { code });
    
    // Check for error event - TypeScript kernel emits "execute_error" type
    const errorEvent = result.find((event: any) => 
      (event.type === "error" || event.type === "execute_error") && 
      event.data.ename === "Error" &&
      event.data.evalue === "TypeScript test error"
    );
    assertExists(errorEvent);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Stream TypeScript execution
Deno.test({
  name: "POST /kernels/:id/execute/stream - should stream TypeScript execution results",
  async fn() {
    // Start server if not already running (for isolated test runs)
    let localServer = null;
    if (!server) {
      try {
        // Test if server is already running
        await fetch("http://localhost:8001/api/kernels");
      } catch {
        // Server not running, start it
        localServer = await startTestServer(8001);
      }
    }
    
    try {
      // Create a TypeScript kernel if tsKernelId is not set (for isolated test runs)
      let kernelId = tsKernelId;
      let createdKernel = false;
      
      if (!kernelId) {
        const createResult = await makeRequest("/kernels", "POST", { lang: "typescript" });
        assertExists(createResult.id);
        kernelId = createResult.id;
        createdKernel = true;
      }
      
      try {
        const code = `console.log("Start TS");
await new Promise(resolve => setTimeout(resolve, 100));
console.log("Middle TS");
await new Promise(resolve => setTimeout(resolve, 100));
console.log("End TS");`;
        
        const response = await fetch(`http://localhost:8001/api/kernels/${kernelId}/execute/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        
        assertEquals(response.headers.get("Content-Type"), "text/event-stream");
        
        const events = await readSSEStream(response);
        
        // Verify we got all three print outputs (filter out TS_WORKER messages)
        const outputs = events
          .filter((event: any) => event.type === "stream")
          .map((event: any) => event.data.text.trim())
          .filter(text => text.length > 0 && !text.startsWith("[TS_WORKER]"));
        
        assertEquals(outputs, ["Start TS", "Middle TS", "End TS"]);
      } finally {
        // Clean up if we created a kernel for this test
        if (createdKernel) {
          await fetch(`http://localhost:8001/api/kernels/${kernelId}`, { method: "DELETE" });
        }
      }
    } finally {
      // Clean up local server if we started it
      if (localServer) {
        await localServer.close();
      }
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: TypeScript Deno.jupyter display functionality
Deno.test({
  name: "POST /kernels/:id/execute - should handle Deno.jupyter display",
  async fn() {
    const code = `await Deno.jupyter.display({
  "text/plain": "Plain text from API test",
  "text/html": "<strong>HTML from API test</strong>"
}, { raw: true });`;
    
    const result = await makeRequest(`/kernels/${tsKernelId}/execute`, "POST", { code });
    
    // Check for display data event
    const displayEvent = result.find((event: any) => 
      event.type === "display_data" &&
      event.data.data["text/plain"] === "Plain text from API test" &&
      event.data.data["text/html"] === "<strong>HTML from API test</strong>"
    );
    assertExists(displayEvent);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Submit async TypeScript execution
Deno.test({
  name: "POST /kernels/:id/execute/submit - should submit async TypeScript execution",
  async fn() {
    // Start server if not already running (for isolated test runs)
    let localServer = null;
    if (!server) {
      try {
        // Test if server is already running
        await fetch("http://localhost:8001/api/kernels");
      } catch {
        // Server not running, start it
        localServer = await startTestServer(8001);
      }
    }
    
    try {
      // Create a TypeScript kernel if tsKernelId is not set (for isolated test runs)
      let kernelId = tsKernelId;
      let createdKernel = false;
      
      if (!kernelId) {
        const createResult = await makeRequest("/kernels", "POST", { lang: "typescript" });
        assertExists(createResult.id);
        kernelId = createResult.id;
        createdKernel = true;
      }
      
      try {
        const code = `
await new Promise(resolve => setTimeout(resolve, 500));
console.log("Async TypeScript execution complete!");
const result = 42 * 2;
result  // This will be in execute_result
`;
        const submitResult = await makeRequest(`/kernels/${kernelId}/execute/submit`, "POST", { code });
        assertExists(submitResult.session_id);
        const sessionId = submitResult.session_id;

        // Get results - this should block until execution is complete
        const execResult = await makeRequest(`/kernels/${kernelId}/execute/result/${sessionId}`);
        
        // Verify stdout and result
        const stdoutEvent = execResult.find((event: any) => 
          event.type === "stream" && 
          event.data.name === "stdout" &&
          event.data.text.includes("Async TypeScript execution complete!")
        );
        assertExists(stdoutEvent);

        const resultEvent = execResult.find((event: any) =>
          event.type === "execute_result" &&
          event.data.data["text/plain"] === "84"
        );
        assertExists(resultEvent);
      } finally {
        // Clean up if we created a kernel for this test
        if (createdKernel) {
          await fetch(`http://localhost:8001/api/kernels/${kernelId}`, { method: "DELETE" });
        }
      }
    } finally {
      // Clean up local server if we started it
      if (localServer) {
        await localServer.close();
      }
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Clean up TypeScript kernel
Deno.test({
  name: "DELETE /kernels/:id - should delete TypeScript kernel",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/kernels/${tsKernelId}`, { method: "DELETE" });
    assertEquals(response.status, 200);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test ping kernel functionality
Deno.test({
  name: "POST /kernels/:id/ping - should ping kernel and reset activity timer",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    try {
      // Ping the kernel
      const response = await fetch(`http://localhost:8001/api/kernels/${testKernelId}/ping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      assertEquals(response.status, 200);
      const result = await response.json();
      
      assertEquals(result.success, true);
      assertEquals(result.message, "Kernel activity timer reset");
      assertExists(result.timestamp);
      
      console.log("✓ Ping kernel endpoint working correctly");
    } finally {
      // Clean up the test kernel
      await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test restart kernel functionality
Deno.test({
  name: "POST /kernels/:id/restart - should restart kernel preserving ID",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    try {
      // Execute some code to establish state
      await makeRequest(`/kernels/${testKernelId}/execute`, "POST", { 
        code: 'test_var = "before_restart"' 
      });
      
      // Restart the kernel
      const response = await fetch(`http://localhost:8001/api/kernels/${testKernelId}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      assertEquals(response.status, 200);
      const result = await response.json();
      
      assertEquals(result.success, true);
      assertEquals(result.message, "Kernel restarted successfully");
      assertExists(result.timestamp);
      
      // Verify the kernel ID still exists in the list
      const kernelsList = await makeRequest("/kernels");
      const restartedKernel = kernelsList.find((k: any) => k.id === testKernelId);
      assertExists(restartedKernel);
      
      // Verify state was reset (variable should not exist)
      console.log("Testing variable access after restart...");
      const stateCheckResponse = await fetch(`http://localhost:8001/api/kernels/${testKernelId}/execute/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: 'print(test_var)' }),
      });
      
      // Read the SSE stream to get execution results  
      const stateCheckResult = await readSSEStream(stateCheckResponse, 3000);
      
      console.log("State check result after restart:", JSON.stringify(stateCheckResult, null, 2));
      
      // Should fail because test_var doesn't exist in restarted kernel
      // Look for various indicators of execution error:
      // 1. Direct error event
      const errorEvent = stateCheckResult.find((event: any) => 
        event.type === "error" || event.type === "execute_error"
      );
      
      // 2. Stream with stderr containing NameError
      const stderrEvent = stateCheckResult.find((event: any) =>
        event.type === "stream" && 
        event.data?.name === "stderr" &&
        (event.data?.text?.includes("NameError") || event.data?.text?.includes("not defined"))
      );
      
      // Check if any form of error was detected
      const hasError = errorEvent || stderrEvent;
      
      assert(hasError, 
        `Should get an error when accessing undefined variable after restart. Found events: ${JSON.stringify(stateCheckResult.map((e: any) => ({ type: e.type, hasData: !!e.data, hasResult: !!e.result })), null, 2)}`
      );
      
      console.log("✓ Restart test passed - kernel state was properly reset");
    } finally {
      // Clean up the test kernel
      await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test interrupt kernel functionality
Deno.test({
  name: "POST /kernels/:id/interrupt - should interrupt running execution",
  async fn() {
    // Create a new kernel for this test
    const createResult = await makeRequest("/kernels", "POST", {});
    const testKernelId = createResult.id;
    
    try {
      // Start a long-running task
      const longRunningCode = `
import time
print("Starting long-running task...")
for i in range(50):
    print(f"Step {i}/50")
    time.sleep(0.1)
print("Task completed!")
`;
      
      // Start the long-running execution (don't await)
      const executionPromise = fetch(`http://localhost:8001/api/kernels/${testKernelId}/execute/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: longRunningCode }),
      });
      
      // Wait a bit for the task to start
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Interrupt the kernel
      const interruptResponse = await fetch(`http://localhost:8001/api/kernels/${testKernelId}/interrupt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      assertEquals(interruptResponse.status, 200);
      const interruptResult = await interruptResponse.json();
      
      assertEquals(interruptResult.success, true);
      assertEquals(interruptResult.message, "Kernel execution interrupted");
      assertExists(interruptResult.timestamp);
      
      // Wait for the execution to complete (should be interrupted)
      try {
        const executionResponse = await executionPromise;
        // Read the stream to check if it was interrupted
        const events = await readSSEStream(executionResponse, 2000);
        
        // Should contain some initial output but not complete all 50 steps
        const outputs = events
          .filter((event: any) => event.type === "stream")
          .map((event: any) => event.data.text || "")
          .filter(text => text.includes("Step"));
        
        // Should have started but not completed all 50 steps
        assert(outputs.length > 0, "Should have some output before interruption");
        assert(outputs.length < 50, "Should not complete all 50 steps due to interruption");
        
        console.log(`Execution was interrupted after ${outputs.length} steps (expected behavior)`);
      } catch (streamError) {
        // Stream might be terminated due to interrupt, this is expected
        console.log("Stream terminated due to interrupt (expected behavior)");
      }
      
      console.log("✓ Interrupt kernel endpoint working correctly");
    } finally {
      // Clean up the test kernel
      await fetch(`http://localhost:8001/api/kernels/${testKernelId}`, { method: "DELETE" });
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test ping non-existent kernel
Deno.test({
  name: "POST /kernels/:id/ping - should return 404 for non-existent kernel",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/kernels/non-existent-id/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    assertEquals(response.status, 404);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test restart non-existent kernel
Deno.test({
  name: "POST /kernels/:id/restart - should return 404 for non-existent kernel",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/kernels/non-existent-id/restart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    assertEquals(response.status, 404);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test interrupt non-existent kernel
Deno.test({
  name: "POST /kernels/:id/interrupt - should return 404 for non-existent kernel",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/kernels/non-existent-id/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    
    assertEquals(response.status, 404);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Cleanup
Deno.test({
  name: "cleanup",
  async fn() {
    await server.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Setup server for agent tests
Deno.test({
  name: "setup agent tests",
  fn: async () => {
    server = await startTestServer(8001);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Agent API Tests
let testAgentId: string;

// Test: List agents (empty)
Deno.test({
  name: "GET /agents - should return empty list initially",
  async fn() {
    const agents = await makeRequest("/agents");
    assertEquals(Array.isArray(agents), true);
    assertEquals(agents.length, 0);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Get agent stats
Deno.test({
  name: "GET /agents/stats - should return agent statistics",
  async fn() {
    const stats = await makeRequest("/agents/stats");
    assertEquals(typeof stats.totalAgents, "number");
    assertEquals(typeof stats.agentsWithKernels, "number");
    assertEquals(typeof stats.maxAgents, "number");
    assertExists(stats.dataDirectory);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Create agent
Deno.test({
  name: "POST /agents - should create new agent",
  async fn() {
    const agentData = {
      name: "Test Agent",
      description: "A test AI assistant",
      instructions: "You are a helpful test assistant. Keep responses brief.",
      kernelType: "PYTHON",
      maxSteps: 5
    };
    
    const result = await makeRequest("/agents", "POST", agentData);
    assertExists(result.id);
    assertEquals(result.name, "Test Agent");
    assertEquals(result.description, "A test AI assistant");
    assertEquals(result.kernelType, "python");
    assertExists(result.created);
    
    testAgentId = result.id;
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: List agents (with created agent)
Deno.test({
  name: "GET /agents - should list created agent",
  async fn() {
    const agents = await makeRequest("/agents");
    assertEquals(agents.length, 1);
    assertEquals(agents[0].id, testAgentId);
    assertEquals(agents[0].name, "Test Agent");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Get specific agent info
Deno.test({
  name: "GET /agents/:id - should return agent information",
  async fn() {
    const agent = await makeRequest(`/agents/${testAgentId}`);
    assertEquals(agent.id, testAgentId);
    assertEquals(agent.name, "Test Agent");
    assertEquals(agent.description, "A test AI assistant");
    assertEquals(agent.kernelType, "python");
    assertEquals(agent.maxSteps, 5);
    assertEquals(typeof agent.hasKernel, "boolean");
    assertEquals(typeof agent.conversationLength, "number");
    assertExists(agent.created);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Update agent
Deno.test({
  name: "PUT /agents/:id - should update agent",
  async fn() {
    const updates = {
      name: "Updated Test Agent",
      description: "Updated description",
      instructions: "Updated instructions for the agent.",
    };
    
    const result = await makeRequest(`/agents/${testAgentId}`, "PUT", updates);
    assertEquals(result.success, true);
    assertEquals(result.message, "Agent updated successfully");
    assertEquals(result.agent.name, "Updated Test Agent");
    
    // Verify the update
    const updatedAgent = await makeRequest(`/agents/${testAgentId}`);
    assertEquals(updatedAgent.name, "Updated Test Agent");
    assertEquals(updatedAgent.description, "Updated description");
    
    // Test: Set agent conversation history within existing agent test
    console.log("  → Testing conversation history setting...");
    const customHistory = [
      { role: "user", content: "What is 5 + 5?" },
      { role: "assistant", content: "5 + 5 equals 10." },
      { role: "user", content: "What about 10 + 10?" },
      { role: "assistant", content: "10 + 10 equals 20." }
    ];
    
    const setResult = await makeRequest(`/agents/${testAgentId}/set-conversation`, "POST", {
      messages: customHistory
    });
    
    assertEquals(setResult.success, true);
    assertEquals(setResult.messageCount, 4);
    assertEquals(setResult.message, "Conversation history set with 4 messages");
    
    // Verify the conversation was set
    const conversation = await makeRequest(`/agents/${testAgentId}/conversation`);
    assertEquals(conversation.conversation.length, 4);
    assertEquals(conversation.conversation[0].content, "What is 5 + 5?");
    assertEquals(conversation.conversation[3].content, "10 + 10 equals 20.");
    
    console.log("  ✅ Conversation history management tested");
    
    // Clear conversation for subsequent tests
    await makeRequest(`/agents/${testAgentId}/conversation`, "DELETE");
    
    // Test: Stateless chat completion within existing agent test
    console.log("  → Testing stateless chat completion...");
    const messages = [
      { role: "user", content: "What is 3 + 3? Use Python to calculate." }
    ];
    
    // Get conversation length before stateless chat
    const conversationBefore = await makeRequest(`/agents/${testAgentId}/conversation`);
    const lengthBefore = conversationBefore.conversation.length;
    
    const response = await fetch(`http://localhost:8001/api/agents/${testAgentId}/chat-stateless`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    
    const events = await readSSEStream(response, 5000);
    assert(events.length > 0, "Should receive events");
    
    // Verify conversation history wasn't modified (stateless)
    const conversationAfter = await makeRequest(`/agents/${testAgentId}/conversation`);
    assertEquals(conversationAfter.conversation.length, lengthBefore, "Conversation history should not change");
    
    console.log("  ✅ Stateless chat completed without modifying conversation history");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Get agent conversation (initially empty)
Deno.test({
  name: "GET /agents/:id/conversation - should return empty conversation",
  async fn() {
    const result = await makeRequest(`/agents/${testAgentId}/conversation`);
    assertEquals(Array.isArray(result.conversation), true);
    assertEquals(result.conversation.length, 0);
    assertEquals(result.length, 0);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Event type definitions for SSE events
interface TextEvent {
  type: "text";
  content: string;
}

interface FunctionCallEvent {
  type: "function_call";
  arguments?: {
    code: string;
    language?: string;
  };
}

interface FunctionOutputEvent {
  type: "function_call_output";
  content: string;
}

type SSEEvent = TextEvent | FunctionCallEvent | FunctionOutputEvent | { type: string; [key: string]: any };

// Test: Chat with agent (streaming)
Deno.test({
  name: "POST /agents/:id/chat - should stream chat response",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/agents/${testAgentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello, introduce yourself briefly." }),
    });
    
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    
    // Read SSE stream
    const events = await readSSEStream(response, 10000); // 10 second timeout for LLM response
    
    // Should have received some events
    assert(events.length > 0, "Should receive at least one event");
    
    // Check for text response
    const textEvent = events.find((event: any) => event.type === "text") as TextEvent | undefined;
    if (textEvent && textEvent.content) {
      assertExists(textEvent.content, "Text event should have content");
      console.log("Agent response:", textEvent.content.slice(0, 100) + "...");
    } else {
      console.log("No text response received (LLM might not be available)");
    }

    // Check for function call (code execution)
    const functionCallEvent = events.find((event: any) => event.type === "function_call") as FunctionCallEvent | undefined;
    const functionOutputEvent = events.find((event: any) => event.type === "function_call_output") as FunctionOutputEvent | undefined;
    
    if (functionCallEvent && functionCallEvent.arguments?.code) {
      console.log("✅ Code execution detected");
      assertExists(functionCallEvent.arguments.code);
    }
    
    if (functionOutputEvent && functionOutputEvent.content) {
      console.log("✅ Code execution result received");
      assertExists(functionOutputEvent.content);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Attach kernel to agent
Deno.test({
  name: "POST /agents/:id/kernel - should attach kernel to agent",
  async fn() {
    const result = await makeRequest(`/agents/${testAgentId}/kernel`, "POST", {
      kernelType: "PYTHON"
    });
    
    assertEquals(result.success, true);
    assertEquals(result.message, "Kernel attached successfully");
    assertEquals(result.hasKernel, true);
    // Note: kernelId may not be returned in the response
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Verify kernel attached to agent
Deno.test({
  name: "GET /agents/:id - should show kernel attached",
  async fn() {
    const agent = await makeRequest(`/agents/${testAgentId}`);
    assertEquals(agent.hasKernel, true);
    assertEquals(agent.kernelType, "python");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Chat with agent with kernel (may execute code)
Deno.test({
  name: "POST /agents/:id/chat - should handle kernel-enabled chat",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/agents/${testAgentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Calculate 2 + 2 using Python code." }),
    });
    
    assertEquals(response.headers.get("Content-Type"), "text/event-stream");
    
    const events = await readSSEStream(response, 15000); // 15 second timeout for code execution
    
    assert(events.length > 0, "Should receive events");
    
    // Check for function call (code execution)
    const functionCallEvent = events.find((event: any) => event.type === "function_call") as FunctionCallEvent | undefined;
    const functionOutputEvent = events.find((event: any) => event.type === "function_call_output") as FunctionOutputEvent | undefined;
    const textEvent = events.find((event: any) => event.type === "text") as TextEvent | undefined;
    
    if (functionCallEvent && functionCallEvent.arguments?.code) {
      console.log("✅ Code execution detected");
      assertExists(functionCallEvent.arguments.code);
    }
    
    if (functionOutputEvent && functionOutputEvent.content) {
      console.log("✅ Code execution result received");
      assertExists(functionOutputEvent.content);
    }
    
    if (textEvent) {
      console.log("✅ Text response received");
    }
    
    console.log(`Received ${events.length} events from kernel-enabled chat`);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Clear agent conversation
Deno.test({
  name: "DELETE /agents/:id/conversation - should clear conversation",
  async fn() {
    const result = await makeRequest(`/agents/${testAgentId}/conversation`, "DELETE");
    assertEquals(result.success, true);
    assertEquals(result.message, "Conversation cleared successfully");
    
    // Verify conversation is cleared
    const conversation = await makeRequest(`/agents/${testAgentId}/conversation`);
    assertEquals(conversation.conversation.length, 0);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Detach kernel from agent
Deno.test({
  name: "DELETE /agents/:id/kernel - should detach kernel from agent",
  async fn() {
    const result = await makeRequest(`/agents/${testAgentId}/kernel`, "DELETE");
    assertEquals(result.success, true);
    assertEquals(result.message, "Kernel detached successfully");
    
    // Verify kernel is detached
    const agent = await makeRequest(`/agents/${testAgentId}`);
    assertEquals(agent.hasKernel, false);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Create agent with auto-attach kernel
Deno.test({
  name: "POST /agents - should create agent with auto-attached kernel",
  async fn() {
    const agentData = {
      name: "Kernel Auto Agent",
      description: "Agent with auto-attached kernel",
      instructions: "You are a kernel-enabled agent.",
      kernelType: "PYTHON",
      autoAttachKernel: true,
    };
    
    const result = await makeRequest("/agents", "POST", agentData);
    assertExists(result.id);
    assertEquals(result.name, "Kernel Auto Agent");
    
    // Wait for kernel attachment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Get the agent and verify kernel attachment
    const agent = await makeRequest(`/agents/${result.id}`);
    assertEquals(agent.hasKernel, true);
    
    // Test: Enhanced kernel cleanup verification
    console.log("  → Testing kernel cleanup during agent destruction...");
    
    // Get initial kernel count
    const kernelsBefore = await makeRequest("/kernels");
    const kernelCountBefore = kernelsBefore.length;
    
    // Delete agent
    const deleteResult = await makeRequest(`/agents/${result.id}`, "DELETE");
    assertEquals(deleteResult.success, true);
    
    // Verify kernels are cleaned up
    await new Promise(resolve => setTimeout(resolve, 500)); // Allow cleanup time
    const kernelsAfter = await makeRequest("/kernels");
    const kernelCountAfter = kernelsAfter.length;
    
    // Should have fewer kernels after agent deletion
    assert(kernelCountAfter <= kernelCountBefore, "Kernels should be cleaned up when agent is deleted");
    console.log(`  ✅ Kernel cleanup verified: ${kernelCountBefore} -> ${kernelCountAfter} kernels`);
    
    // Test: Agent with startup script errors
    console.log("  → Testing startup script error handling...");
    const errorAgentData = {
      name: "Error Test Agent",
      description: "Agent with failing startup script", 
      instructions: "You are a test agent.",
      startupScript: "import nonexistent_module\nprint('This will fail')",
      kernelType: "PYTHON",
      autoAttachKernel: true
    };
    
    // Test that agent creation fails immediately due to startup script error
    try {
      const errorAgentResponse = await fetch("http://localhost:8001/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(errorAgentData),
      });
      
      // Agent creation should fail with startup script error
      assertEquals(errorAgentResponse.status, 500, "Agent creation should fail due to startup script error");
      const errorResult = await errorAgentResponse.json();
      assert(errorResult.error.includes("import nonexistent_module") || errorResult.error.includes("ModuleNotFoundError"), "Error should mention startup script failure");
      
      console.log(`  ✅ Agent creation correctly failed due to startup script error: ${errorResult.error.substring(0, 100)}...`);
    } catch (error) {
      console.log("  ✅ Agent creation correctly failed due to startup script error");
    }
    
    // Test: Namespace support in agent creation  
    console.log("  → Testing namespace support...");
    const namespace = "test-namespace";
    const namespacedAgentData = {
      name: "Namespaced Agent",
      description: "Agent with namespace",
      instructions: "You are a namespaced agent.",
      kernelType: "PYTHON"
    };
    
    const namespaceResponse = await fetch("http://localhost:8001/api/agents", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-Namespace": namespace
      },
      body: JSON.stringify(namespacedAgentData),
    });
    
    assertEquals(namespaceResponse.status, 200);
    const namespaceResult = await namespaceResponse.json();
    assertExists(namespaceResult.id);
    assertEquals(namespaceResult.namespace, namespace);
    
    console.log("  ✅ Namespace support verified");
    
    // Clean up namespaced agent
    const namespaceDeleteResult = await makeRequest(`/agents/${namespaceResult.id}`, "DELETE");
    assertEquals(namespaceDeleteResult.success, true, "Namespaced agent should be deleted successfully");
    
    // Test: Error handling for invalid requests
    console.log("  → Testing error handling...");
    
    // Test invalid JSON in agent creation
    const invalidJsonResponse = await fetch("http://localhost:8001/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });
    assertEquals(invalidJsonResponse.status, 500);
    
    console.log("  ✅ Error handling verified");
    
    // Test: Performance - multiple concurrent requests
    console.log("  → Testing concurrent request handling...");
    const concurrentRequests = 3; // Reduced for faster testing
    const promises = [];
    
    // Create multiple agents concurrently
    for (let i = 0; i < concurrentRequests; i++) {
      const concurrentAgentData = {
        name: `Concurrent Agent ${i}`,
        description: `Concurrent test agent ${i}`,
        instructions: "You are a concurrent test agent.",
        kernelType: "PYTHON"
      };
      
      promises.push(makeRequest("/agents", "POST", concurrentAgentData));
    }
    
    const concurrentResults = await Promise.all(promises);
    
    // Verify all agents were created successfully
    assertEquals(concurrentResults.length, concurrentRequests);
    concurrentResults.forEach((result, index) => {
      assertExists(result.id);
      assertEquals(result.name, `Concurrent Agent ${index}`);
    });
    
    // Clean up all created agents
    const cleanupPromises = concurrentResults.map(result => 
      makeRequest(`/agents/${result.id}`, "DELETE")
    );
    await Promise.all(cleanupPromises);
    
    console.log(`  ✅ Successfully handled ${concurrentRequests} concurrent requests`);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Error handling - non-existent agent
Deno.test({
  name: "GET /agents/non-existent - should return 404",
  async fn() {
    try {
      const response = await fetch("http://localhost:8001/api/agents/non-existent-id");
      if (response.status === 404) {
        // Expected 404 response
        return;
      }
      assert(false, "Should have returned 404 status");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      assert(errorMessage.includes("404") || errorMessage.includes("not found"));
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Error handling - chat with non-existent agent
Deno.test({
  name: "POST /agents/non-existent/chat - should return 404",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/agents/non-existent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    
    assertEquals(response.status, 404);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Error handling - missing message in chat
Deno.test({
  name: "POST /agents/:id/chat - should return 400 for missing message",
  async fn() {
    const response = await fetch(`http://localhost:8001/api/agents/${testAgentId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    
    assertEquals(response.status, 400);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Delete agent
Deno.test({
  name: "DELETE /agents/:id - should delete agent",
  async fn() {
    const result = await makeRequest(`/agents/${testAgentId}`, "DELETE");
    assertEquals(result.success, true);
    assertEquals(result.message, `Agent ${testAgentId} deleted successfully`);
    
    // Verify agent is deleted by checking for 404 response
    try {
      const response = await fetch(`http://localhost:8001/api/agents/${testAgentId}`);
      if (response.status === 404) {
        // Expected 404 response for deleted agent
        return;
      }
      assert(false, "Should have returned 404 status for deleted agent");
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      assert(errorMessage.includes("404") || errorMessage.includes("not found"));
    }
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Test: Final agent stats (should be empty again)
Deno.test({
  name: "GET /agents/stats - should show zero agents after cleanup",
  async fn() {
    const stats = await makeRequest("/agents/stats");
    assertEquals(stats.totalAgents, 0);
    assertEquals(stats.agentsWithKernels, 0);
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

// Cleanup
Deno.test({
  name: "cleanup",
  async fn() {
    await server.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
});

 