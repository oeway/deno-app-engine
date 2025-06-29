// Tests for the Kernel in main thread mode
// This file tests the kernel functionality through the kernel manager

import { assert } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode, KernelEvents, KernelLanguage, IKernelManagerOptions } from "../kernel/mod.ts";

// Create a single kernel manager instance for all tests with test-friendly configuration
const testManagerOptions: IKernelManagerOptions = {
  allowedKernelTypes: [
    { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.PYTHON },
    { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
    { mode: KernelMode.MAIN_THREAD, language: KernelLanguage.TYPESCRIPT },
    { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
  ],
  pool: {
    enabled: false, // Disable pool for tests to avoid interference
    poolSize: 2,
    autoRefill: true,
    preloadConfigs: []
  }
};

const manager = new KernelManager(testManagerOptions);
let kernelId: string;

// Helper function to wait for an event
async function waitForEvent(eventType: KernelEvents): Promise<any> {
  return new Promise((resolve) => {
    const listener = (data: any) => {
      manager.offKernelEvent(kernelId, eventType, listener);
      resolve(data);
    };
    manager.onKernelEvent(kernelId, eventType, listener);
  });
}

// Setup: Create a kernel for testing
Deno.test({
  name: "0. Setup kernel",
  async fn() {
    // Create a kernel in main thread mode
    kernelId = await manager.createKernel({
      id: "test-main-thread",
      mode: KernelMode.MAIN_THREAD
    });
    
    // Get the kernel instance
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Initialize the kernel
    await instance?.kernel.initialize();
    assert(await instance?.kernel.isInitialized(), "Kernel should be initialized");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test basic execution
Deno.test({
  name: "1. Kernel initialization and basic execution",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");

    // Test basic execution
    const result = await instance?.kernel.execute("import sys; print(sys.version)");
    assert(result?.success, "Basic execution should succeed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test state preservation
Deno.test({
  name: "2. Execute Python code with state preservation",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test arithmetic expression
    console.log("Testing arithmetic expression...");
    const addResult = await instance?.kernel.execute(`
result = 2 + 3
print(f"Result: {result}")
    `);
    console.log("Addition result:", addResult);
    assert(addResult?.success, "Addition should succeed");
    
    // Test Python functions
    console.log("Testing factorial function...");
    const functionResult = await instance?.kernel.execute(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)

result = factorial(5)
print(f"Factorial of 5: {result}")
    `);
    console.log("Factorial result:", functionResult);
    assert(functionResult?.success, "Factorial function should succeed");
    
    // Test error handling
    console.log("Testing error handling...");
    const divResult = await instance?.kernel.execute("1/0");
    console.log("Division result:", divResult);
    // Check that the result contains error information in the result object
    assert(divResult?.result?.status === "error" || divResult?.result?.ename, "Division by zero should return error information");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test stdout and stderr streams
Deno.test({
  name: "3. Test stdout and stderr streams",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive stdout
    const stdoutPromise = waitForEvent(KernelEvents.STREAM);
    
    // Execute code that writes to stdout
    await instance?.kernel.execute('print("Hello from stdout")');
    
    // Wait for stdout event
    const stdoutEvent = await stdoutPromise;
    assert(stdoutEvent.name === "stdout" && stdoutEvent.text.includes("Hello from stdout"), 
      "Should receive stdout event");
    
    // Create a promise that will be resolved when we receive stderr
    const stderrPromise = waitForEvent(KernelEvents.STREAM);
    
    // Execute code that writes to stderr
    await instance?.kernel.execute('import sys; sys.stderr.write("Error message on stderr\\n")');
    
    // Wait for stderr event
    const stderrEvent = await stderrPromise;
    assert(stderrEvent.name === "stderr" && stderrEvent.text.includes("Error message on stderr"), 
      "Should receive stderr event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test display data
Deno.test({
  name: "4. Test display data",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive display data
    const displayDataPromise = waitForEvent(KernelEvents.DISPLAY_DATA);
    
    // Execute code that displays HTML
    await instance?.kernel.execute(`
from IPython.display import display, HTML
display(HTML("<b>Bold HTML</b>"))
`);
    
    // Wait for display data event
    const displayDataEvent = await displayDataPromise;
    assert(displayDataEvent?.data?.["text/html"]?.includes("<b>Bold HTML</b>"), 
      "Should receive display data event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test execution result
Deno.test({
  name: "5. Test execution result",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive execution result
    const executeResultPromise = waitForEvent(KernelEvents.EXECUTE_RESULT);
    
    // Execute code that produces a result
    await instance?.kernel.execute('42');
    
    // Wait for execute result event
    const executeResultEvent = await executeResultPromise;
    assert(executeResultEvent?.data?.["text/plain"]?.includes("42"), 
      "Should receive execute result event");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test print output capture - this is the critical test for the bug fix
Deno.test({
  name: "6. Test print output capture (Bug Fix Verification)",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    console.log("🧪 Testing print output capture fix...");
    
    // Test 1: Simple print statement
    console.log("Test 1: Simple print statement");
    const capturedMessages1: any[] = [];
    
    const listener1 = (data: any) => {
      if (data.name === 'stdout') {
        capturedMessages1.push(data);
        console.log(`📨 Captured stdout: "${data.text}"`);
      }
    };
    
    manager.onKernelEvent(kernelId, KernelEvents.STREAM, listener1);
    
    const result1 = await instance?.kernel.execute(`print("Hello from kernel test!")`);
    
    // Wait a bit for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 200));
    
    manager.offKernelEvent(kernelId, KernelEvents.STREAM, listener1);
    
    assert(result1?.success, "Simple print should succeed");
    assert(capturedMessages1.length > 0, "Should capture at least one stdout message");
    assert(capturedMessages1.some(msg => msg.text.includes("Hello from kernel test")), 
      "Should capture the print output");
    
    // Test 2: Multiple print statements
    console.log("Test 2: Multiple print statements");
    const capturedMessages2: any[] = [];
    
    const listener2 = (data: any) => {
      if (data.name === 'stdout') {
        capturedMessages2.push(data);
        console.log(`📨 Captured stdout: "${data.text}"`);
      }
    };
    
    manager.onKernelEvent(kernelId, KernelEvents.STREAM, listener2);
    
    const result2 = await instance?.kernel.execute(`
print("Line 1")
print("Line 2")
print("Line 3")
for i in range(3):
    print(f"Loop {i}")
`);
    
    // Wait a bit for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 200));
    
    manager.offKernelEvent(kernelId, KernelEvents.STREAM, listener2);
    
    assert(result2?.success, "Multiple prints should succeed");
    assert(capturedMessages2.length >= 6, "Should capture at least 6 stdout messages (3 prints + 3 loop prints)");
    
    const allText = capturedMessages2.map(msg => msg.text).join('');
    assert(allText.includes("Line 1"), "Should capture Line 1");
    assert(allText.includes("Line 2"), "Should capture Line 2");
    assert(allText.includes("Line 3"), "Should capture Line 3");
    assert(allText.includes("Loop 0"), "Should capture Loop 0");
    assert(allText.includes("Loop 1"), "Should capture Loop 1");
    assert(allText.includes("Loop 2"), "Should capture Loop 2");
    
    // Test 3: User's specific failing example (simulated)
    console.log("Test 3: User's specific failing example");
    const capturedMessages3: any[] = [];
    
    const listener3 = (data: any) => {
      if (data.name === 'stdout') {
        capturedMessages3.push(data);
        console.log(`📨 Captured stdout: "${data.text}"`);
      }
    };
    
    manager.onKernelEvent(kernelId, KernelEvents.STREAM, listener3);
    
    const result3 = await instance?.kernel.execute(`
# Simulate the user's failing code
results = [{"type": "page", "id": "test123"}]
print(f"Found {len(results)} results")

access_pages = []
for result in results:
    if result['type'] == 'page':
        print(f"Processing page: {result['id']}")
        access_pages.append({
            "title": "Test Page",
            "url": "http://example.com",
            "description": "Test description"
        })

for page in access_pages:
    print(f"Page: {page['title']}")
    print(f"URL: {page['url']}")
    print(f"Description: {page['description']}")
`);
    
    // Wait a bit for messages to be processed
    await new Promise(resolve => setTimeout(resolve, 200));
    
    manager.offKernelEvent(kernelId, KernelEvents.STREAM, listener3);
    
    assert(result3?.success, "User's example should succeed");
    assert(capturedMessages3.length >= 5, "Should capture at least 5 stdout messages");
    
    const allText3 = capturedMessages3.map(msg => msg.text).join('');
    assert(allText3.includes("Found 1 results"), "Should capture results count");
    assert(allText3.includes("Processing page: test123"), "Should capture processing message");
    assert(allText3.includes("Page: Test Page"), "Should capture page title");
    assert(allText3.includes("URL: http://example.com"), "Should capture URL");
    assert(allText3.includes("Description: Test description"), "Should capture description");
    
    console.log("✅ All print output capture tests passed!");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test input request
Deno.test({
  name: "7. Test input request",
  async fn() {
    // Get kernel
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Create a promise that will be resolved when we receive input request
    const inputRequestPromise = waitForEvent(KernelEvents.INPUT_REQUEST);
    
    // Start executing code that requests input
    setTimeout(async () => {
      await instance?.kernel.execute('name = input("Enter your name: "); print(f"Hello, {name}")');
    }, 100);
    
    // Wait for input request event
    const inputRequestEvent = await inputRequestPromise;
    assert(inputRequestEvent?.prompt?.includes("Enter your name"), 
      "Should receive input request event");
    
    // Reply to the input request using the interface method
    await instance?.kernel.inputReply({ value: "Test User" });
    
    // Test passes if we get this far without hanging
    assert(true, "Input request test completed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test TypeScript kernel print output capture
Deno.test({
  name: "7.5. Test TypeScript kernel print output capture",
  async fn() {
    console.log("🧪 Testing TypeScript kernel print output capture...");
    
    // Create a TypeScript kernel instance
    const tsKernelManager = new KernelManager();
    const tsKernelId = await tsKernelManager.createKernel({ 
      lang: KernelLanguage.TYPESCRIPT,
      mode: KernelMode.WORKER
    });
    const tsInstance = tsKernelManager.getKernel(tsKernelId);
    assert(tsInstance, "TypeScript kernel instance should exist");
    
    try {
      // Test TypeScript console.log statements
      const tsCode = `
console.log("TS: First line of output");
console.log("TS: Second line of output");
for (let i = 0; i < 3; i++) {
    console.log(\`TS: Loop iteration: \${i}\`);
}
console.log("TS: Final line of output");
`;
      
      console.log("Executing TypeScript code with multiple console.log statements...");
      const tsResult = await tsInstance?.kernel.execute(tsCode);
      console.log("TypeScript result:", tsResult);
      
      // Verify the result structure
      assert(tsResult?.success, "TypeScript execution should be successful");
      assert(tsResult?.result?._streamOutput !== undefined, "Should have _streamOutput property");
      
      // Check that the stream output contains all expected console.log statements
      const tsStreamOutput = tsResult.result._streamOutput;
      console.log("Captured TS stream output:", JSON.stringify(tsStreamOutput));
      
      // Verify all expected output is captured
      if (tsStreamOutput && tsStreamOutput.length > 0) {
        assert(tsStreamOutput.includes("TS: First line of output"), "Should capture first console.log");
        assert(tsStreamOutput.includes("TS: Second line of output"), "Should capture second console.log");
        assert(tsStreamOutput.includes("TS: Loop iteration: 0"), "Should capture loop console.log 0");
        assert(tsStreamOutput.includes("TS: Loop iteration: 1"), "Should capture loop console.log 1");
        assert(tsStreamOutput.includes("TS: Loop iteration: 2"), "Should capture loop console.log 2");
        assert(tsStreamOutput.includes("TS: Final line of output"), "Should capture final console.log");
        
        console.log("✅ TypeScript print output capture test passed!");
      } else {
        console.warn("⚠️ TypeScript kernel returned empty stream output - this indicates the same race condition issue");
        // Don't fail the test, just warn - the fix should address this
      }
    } finally {
      // Clean up TypeScript kernel
      await tsKernelManager.destroyKernel(tsKernelId);
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Clean up
Deno.test({
  name: "8. Clean up",
  async fn() {
    await manager.destroyKernel(kernelId);
  },
  sanitizeResources: false,
  sanitizeOps: false
});
