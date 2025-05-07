import { assertEquals } from "https://deno.land/std@0.201.0/assert/assert_equals.ts";
import { assertExists } from "https://deno.land/std@0.201.0/assert/assert_exists.ts";
import { assert } from "https://deno.land/std@0.201.0/assert/assert.ts";
import { handleRequest } from "../server.ts";

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
    assertEquals(kernels[0], kernelId);
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
    
    // Verify we got all three print outputs
    const outputs = events
      .filter((event: any) => event.type === "stream")
      .map((event: any) => event.data.text.trim())
      .filter(text => text.length > 0);
    
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

// Cleanup
Deno.test({
  name: "cleanup",
  async fn() {
    await server.close();
  },
  sanitizeResources: false,
  sanitizeOps: false,
}); 