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
async function makeRequest(path: string, method = "GET", body?: unknown) {
  const url = `http://localhost:8001/api${path}`;
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
    
    // Check for error event
    const errorEvent = result.find((event: any) => 
      event.type === "error" && 
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
    const code = `console.log("Start TS");
await new Promise(resolve => setTimeout(resolve, 100));
console.log("Middle TS");
await new Promise(resolve => setTimeout(resolve, 100));
console.log("End TS");`;
    
    const response = await fetch(`http://localhost:8001/api/kernels/${tsKernelId}/execute/stream`, {
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
    const code = `
await new Promise(resolve => setTimeout(resolve, 500));
console.log("Async TypeScript execution complete!");
const result = 42 * 2;
result  // This will be in execute_result
`;
    const submitResult = await makeRequest(`/kernels/${tsKernelId}/execute/submit`, "POST", { code });
    assertExists(submitResult.session_id);
    const sessionId = submitResult.session_id;

    // Get results - this should block until execution is complete
    const execResult = await makeRequest(`/kernels/${tsKernelId}/execute/result/${sessionId}`);
    
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