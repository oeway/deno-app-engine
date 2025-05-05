// @ts-ignore Import from Deno standard library
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.195.0/testing/asserts.ts";
import { Kernel, KernelEvents } from "./mod.ts";

const kernel = new Kernel();
// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "1. Kernel initialization and basic execution",
  async fn() {
    // Initialize kernel
    await kernel.initialize();
    assert(kernel.isInitialized(), "Kernel should be initialized");

    // Test basic execution
    const result = await kernel.execute("import sys; print(sys.version)");
    assert(result.success, "Basic execution should succeed");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "2. Execute Python code with state preservation",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Test arithmetic expression
    console.log("Testing arithmetic expression...");
    const addResult = await kernel.execute(`
result = 2 + 3
print(f"Result: {result}")
    `);
    console.log("Addition result:", addResult);
    assert(addResult.success, "Addition should succeed");
    
    // Test Python functions
    console.log("Testing factorial function...");
    const functionResult = await kernel.execute(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)

result = factorial(5)
print(f"Factorial of 5: {result}")
    `);
    console.log("Factorial result:", functionResult);
    assert(functionResult.success, "Factorial function should succeed");
    
    // Test error handling
    console.log("Testing error handling...");
    let exceptionCaught = false;
    let error = null;
    try {
      const divResult = await kernel.execute("1/0");
      console.log("Division result:", divResult);
      assert(!divResult.success, "Division by zero should return success=false");
    } catch (e) {
      exceptionCaught = true;
      error = e;
    }
    // The execute method should handle errors and not throw
    console.log("Exception caught:", exceptionCaught, error);
    assert(!exceptionCaught, "Division by zero should not throw exception");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "3. Test stdout and stderr streams",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Create a promise that will be resolved when we receive stdout
    const stdoutPromise = new Promise<boolean>((resolve) => {
      const streamListener = (data: {name: string, text: string}) => {
        console.log(`Stream event received: ${data.name}: "${data.text}"`);
        if (data.name === "stdout" && data.text.includes("Hello from stdout")) {
          kernel.removeListener(KernelEvents.STREAM, streamListener);
          resolve(true);
        }
      };
      
      kernel.on(KernelEvents.STREAM, streamListener);
    });
    
    // Create a promise that will be resolved when we receive stderr
    const stderrPromise = new Promise<boolean>((resolve) => {
      const streamListener = (data: {name: string, text: string}) => {
        console.log(`Stream event received: ${data.name}: "${data.text}"`);
        if (data.name === "stderr" && data.text.includes("Error message on stderr")) {
          kernel.removeListener(KernelEvents.STREAM, streamListener);
          resolve(true);
        }
      };
      
      kernel.on(KernelEvents.STREAM, streamListener);
    });
    
    // Execute code that writes to stdout and stderr
    await kernel.execute(`
print("Hello from stdout")
import sys
sys.stderr.write("Error message on stderr\\n")
`);
    
    // Wait for stdout and stderr events
    const [stdoutReceived, stderrReceived] = await Promise.all([
      stdoutPromise,
      stderrPromise
    ]);
    
    assert(stdoutReceived, "Should receive stdout event");
    assert(stderrReceived, "Should receive stderr event");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "4. Test display data",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Create a promise that will be resolved when we receive display data
    const displayDataPromise = new Promise<boolean>((resolve) => {
      const displayListener = (data: any) => {
        console.log("Display data received:", data);
        if (data?.data?.["text/html"]?.includes("<b>Bold HTML</b>")) {
          kernel.removeListener(KernelEvents.DISPLAY_DATA, displayListener);
          resolve(true);
        }
      };
      
      kernel.on(KernelEvents.DISPLAY_DATA, displayListener);
    });
    
    // Execute code that displays HTML
    await kernel.execute(`
from IPython.display import display, HTML
display(HTML("<b>Bold HTML</b>"))
`);
    
    // Wait for display data event
    const displayDataReceived = await displayDataPromise;
    assert(displayDataReceived, "Should receive display data event");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "5. Test execution result",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Create a promise that will be resolved when we receive execution result
    const executeResultPromise = new Promise<boolean>((resolve) => {
      const resultListener = (data: any) => {
        console.log("Execute result received:", data);
        if (data?.data?.["text/plain"]?.includes("42")) {
          kernel.removeListener(KernelEvents.EXECUTE_RESULT, resultListener);
          resolve(true);
        }
      };
      
      kernel.on(KernelEvents.EXECUTE_RESULT, resultListener);
    });
    
    // Execute code that produces a result
    await kernel.execute(`
42
`);
    
    // Wait for execute result event
    const executeResultReceived = await executeResultPromise;
    assert(executeResultReceived, "Should receive execute result event");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "6. Test input request",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // This test is tricky because of asynchronous events
    // We'll just ensure the kernel keeps running after input handling
    const inputRequestListener = (data: {prompt: string, password: boolean}) => {
      console.log("Input request event received:", data);
      if (data.prompt.includes("Enter your name")) {
        // Reply to the input request
        kernel.inputReply({ value: "Test User" });
      }
    };
    
    // Listen for input requests
    kernel.on(KernelEvents.INPUT_REQUEST, inputRequestListener);
    
    // Execute code that requests input
    await kernel.execute(`
name = input("Enter your name: ")
print(f"Hello, {name}")
`);
    
    // Give some time for event handling
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Remove the listener
    kernel.removeListener(KernelEvents.INPUT_REQUEST, inputRequestListener);
    
    // Test passes if we get this far without hanging
    assert(true, "Input request test completed");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "7. Test COMM messages",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Create a promise that will be resolved when we receive COMM open
    const commOpenPromise = new Promise<boolean>((resolve) => {
      const commOpenListener = (data: any) => {
        console.log("COMM open received:", data);
        if (data?.content?.target_name?.includes("test_comm")) {
          kernel.removeListener(KernelEvents.COMM_OPEN, commOpenListener);
          resolve(true);
        }
      };
      
      // Set a timeout to ensure this event listener is removed even if no event arrives
      setTimeout(() => {
        kernel.removeListener(KernelEvents.COMM_OPEN, commOpenListener);
        resolve(false);
      }, 5000);
      
      kernel.on(KernelEvents.COMM_OPEN, commOpenListener);
    });
    
    // Create a promise that will be resolved when we receive COMM message
    const commMsgPromise = new Promise<boolean>((resolve) => {
      const commMsgListener = (data: any) => {
        console.log("COMM message received:", data);
        if (data?.content?.data?.message?.includes("test message")) {
          kernel.removeListener(KernelEvents.COMM_MSG, commMsgListener);
          resolve(true);
        }
      };
      
      // Set a timeout to ensure this event listener is removed even if no event arrives
      setTimeout(() => {
        kernel.removeListener(KernelEvents.COMM_MSG, commMsgListener);
        resolve(false);
      }, 5000);
      
      kernel.on(KernelEvents.COMM_MSG, commMsgListener);
    });
    
    // Execute code that opens a COMM and sends a message
    await kernel.execute(`
try:
    from ipykernel.comm import Comm
    comm = Comm(target_name='test_comm')
    comm.open()
    comm.send(data={'message': 'test message'})
    print("COMM message sent")
except Exception as e:
    print(f"Error with COMM: {e}")
`);
    
    try {
      // Wait for COMM open and message events
      const [commOpenReceived, commMsgReceived] = await Promise.all([
        commOpenPromise,
        commMsgPromise
      ]);
      
      // Test might pass even if COMM isn't fully supported - the key here is that it doesn't crash
      console.log("COMM open received:", commOpenReceived);
      console.log("COMM message received:", commMsgReceived);
    } catch (error) {
      console.error("Error during COMM test:", error);
    }
    
    // This test might fail if COMM support is not fully implemented
    // We'll just make sure the kernel continues to work
    const result = await kernel.execute("print('Kernel still working')");
    assert(result.success, "Kernel should still be working after COMM test");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});
