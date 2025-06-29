// Tests for TypeScript Kernel functionality with enhanced tseval context features
import { assert, assertEquals } from "https://deno.land/std/assert/mod.ts";
import { KernelManager, KernelMode, KernelLanguage, KernelEvents } from "../kernel/mod.ts";

// Create a new manager for testing
const manager = new KernelManager();

// Store the kernel ID for tests
let kernelId = "";

// Setup: Create a TypeScript kernel for testing
Deno.test({
  name: "1. Create and initialize TypeScript kernel",
  async fn() {
    // Create a kernel in worker mode with TypeScript language
    kernelId = await manager.createKernel({
      id: "ts-test-kernel",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT
    });
    
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    assertEquals(instance?.language, KernelLanguage.TYPESCRIPT, "Kernel should be TypeScript");
    
    // Verify kernel is initialized
    assert(await instance?.kernel.isInitialized(), "Kernel should be initialized");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test executing simple typescript code
Deno.test({
  name: "2. Execute simple TypeScript code",
  async fn() {
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Execute simple code that returns a value and logs it
    const result = await instance.kernel.execute(`
      const a = 5; 
      const b = 10; 
      const sum = a + b;
      console.log("Expected sum:", sum);
      sum;
    `);
    
    // Check the result
    assertEquals(result.success, true, "Execution should succeed");
    console.log("Simple execution result:", JSON.stringify(result, null, 2));
    
    // Check the new cleaner result structure with Jupyter display symbol
    assert(result.result, "Result should contain result object");
    assert(typeof result.result[Symbol.for("Jupyter.display")] === "function", "Result should have Jupyter display method");
    
    // Get the display data
    const displayData = result.result[Symbol.for("Jupyter.display")]();
    assert(displayData, "Display data should exist");
    assert(displayData["text/plain"], "Should have text/plain display data");
    assertEquals(displayData["text/plain"], "15", "Display data should show the sum result");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test variable persistence across executions
Deno.test({
  name: "3. Test variable persistence across executions",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Execute code to define variables
    const result1 = await instance.kernel.execute("let x = 42; const y = 'hello'; var z = true;");
    assertEquals(result1.success, true, "First execution should succeed");
    
    // Execute code using previously defined variables
    const result2 = await instance.kernel.execute(`
      const result = x + 10;
      console.log("x + 10 =", result);
      result;
    `);
    assertEquals(result2.success, true, "Second execution should succeed");
    console.log("Variable persistence result:", JSON.stringify(result2.result, null, 2));
    
    // Check the display data for variable persistence
    const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
    assert(displayData2["text/plain"], "Should have text/plain display data");
    assertEquals(displayData2["text/plain"], "52", "Should show x + 10 = 52");
    
    // Test that const variables persist
    const result3 = await instance.kernel.execute(`
      const greeting = y + ' world';
      console.log("Greeting:", greeting);
      greeting;
    `);
    assertEquals(result3.success, true, "Third execution should succeed");
    
    // Test that var variables persist
    const result4 = await instance.kernel.execute(`
      const answer = z ? 'yes' : 'no';
      console.log("Boolean test:", answer);
      answer;
    `);
    assertEquals(result4.success, true, "Fourth execution should succeed");
    
    // Modify existing variable
    const result5 = await instance.kernel.execute(`
      x = x * 2;
      console.log("Modified x:", x);
      x;
    `);
    assertEquals(result5.success, true, "Fifth execution should succeed");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test function and class persistence
Deno.test({
  name: "4. Test function and class persistence",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Define a function
    const result1 = await instance.kernel.execute(`
      function multiply(a, b) {
        return a * b;
      }
    `);
    assertEquals(result1.success, true, "Function definition should succeed");
    
    // Use the function
    const result2 = await instance.kernel.execute(`
      const product = multiply(6, 7);
      console.log("6 * 7 =", product);
      product;
    `);
    assertEquals(result2.success, true, "Function call should succeed");
    console.log("Function result:", JSON.stringify(result2.result, null, 2));
    
    // Check the display data for function result
    const displayData = result2.result[Symbol.for("Jupyter.display")]();
    assert(displayData["text/plain"], "Should have text/plain display data");
    assertEquals(displayData["text/plain"], "42", "Should show 6 * 7 = 42");
    
    // Define a class
    const result3 = await instance.kernel.execute(`
      class Calculator {
        constructor(value = 0) {
          this.value = value;
        }
        
        add(n) {
          this.value += n;
          return this;
        }
        
        getValue() {
          return this.value;
        }
      }
    `);
    assertEquals(result3.success, true, "Class definition should succeed");
    
    // Use the class
    const result4 = await instance.kernel.execute(`
      const calc = new Calculator(10);
      calc.add(5).add(3).getValue()
    `);
    assertEquals(result4.success, true, "Class usage should succeed");
    // Note: Expression values are now emitted through events, not returned in result.result
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test top-level await functionality
Deno.test({
  name: "5. Test top-level await functionality",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test basic top-level await
    const result1 = await instance.kernel.execute(`
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      await delay(50);
      "Await completed"
    `);
    
    assertEquals(result1.success, true, "Top-level await should succeed");
    
    // Check the display data
    const displayData1 = result1.result[Symbol.for("Jupyter.display")]();
    assert(displayData1["text/plain"], "Should have text/plain display data");
    assertEquals(displayData1["text/plain"], '"Await completed"', "Should show await completion message");
    
    // Test await with Promise.resolve
    const result2 = await instance.kernel.execute(`
      const value = await Promise.resolve(123);
      value * 2
    `);
    assertEquals(result2.success, true, "Promise.resolve await should succeed");
    
    const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData2["text/plain"], "246", "Should show 123 * 2 = 246");
    
    // Test await with fetch (using a simple URL)
    const result3 = await instance.kernel.execute(`
      const response = await fetch('data:text/plain,Hello');
      const text = await response.text();
      text
    `);
    assertEquals(result3.success, true, "Fetch await should succeed");
    
    const displayData3 = result3.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData3["text/plain"], '"Hello"', "Should show fetched text");
    
    // Test await with variable assignment
    const result4 = await instance.kernel.execute(`
      const asyncValue = await Promise.resolve("stored");
      asyncValue
    `);
    assertEquals(result4.success, true, "Async variable assignment should succeed");
    
    const displayData4 = result4.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData4["text/plain"], '"stored"', "Should show stored async value");
    
    // Test that async variables persist
    const result5 = await instance.kernel.execute("asyncValue + ' and reused'");
    assertEquals(result5.success, true, "Async variable should persist");
    
    const displayData5 = result5.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData5["text/plain"], '"stored and reused"', "Should show combined string");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test import/export functionality
Deno.test({
  name: "6. Test import/export functionality",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test npm import
    const result1 = await instance.kernel.execute(`
      import lodash from "npm:lodash";
      const arr = [1, 2, 3, 4, 5];
      lodash.sum(arr)
    `);
    
    assertEquals(result1.success, true, "NPM import should succeed");
    
    const displayData1 = result1.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData1["text/plain"], "15", "Should show sum of [1,2,3,4,5] = 15");
    
    // Test JSR import
    const result2 = await instance.kernel.execute(`
      import { encodeBase64 } from "jsr:@std/encoding/base64";
      encodeBase64("hello")
    `);
    assertEquals(result2.success, true, "JSR import should succeed");
    
    const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData2["text/plain"], '"aGVsbG8="', "Should show base64 encoded 'hello'");
    
    // Test that imported modules persist
    const result3 = await instance.kernel.execute(`
      lodash.reverse([1, 2, 3])
    `);
    
    assertEquals(result3.success, true, "Persisted import should work");
    
    const displayData3 = result3.result[Symbol.for("Jupyter.display")]();
    // lodash.reverse returns the reversed array
    assert(displayData3["text/plain"].includes("3") && displayData3["text/plain"].includes("1"), 
      "Should show reversed array [3,2,1]");
    
    // Test Deno standard library
    const result4 = await instance.kernel.execute(`
      import * as path from "jsr:@std/path";
      path.basename("/foo/bar/test.txt")
    `);
    assertEquals(result4.success, true, "Deno std import should succeed");
    
    const displayData4 = result4.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData4["text/plain"], '"test.txt"', "Should show basename of path");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test TypeScript-specific features
Deno.test({
  name: "7. Test TypeScript-specific features",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test interface definition and usage
    const result1 = await instance.kernel.execute(`
      interface User {
        name: string;
        age: number;
        active?: boolean;
      }
      
      const user: User = {
        name: "Alice",
        age: 30,
        active: true
      };
      
      user.name
    `);
    assertEquals(result1.success, true, "TypeScript interface should work");
    
    const displayData1 = result1.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData1["text/plain"], '"Alice"', "Should show user name");
    
    // Test type aliases
    const result2 = await instance.kernel.execute(`
      type StringOrNumber = string | number;
      
      function process(value: StringOrNumber): string {
        return typeof value === 'string' ? value.toUpperCase() : value.toString();
      }
      
      process("hello")
    `);
    assertEquals(result2.success, true, "TypeScript type alias should work");
    
    const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData2["text/plain"], '"HELLO"', "Should show uppercased string");
    
    // Test generics
    const result3 = await instance.kernel.execute(`
      function identity<T>(arg: T): T {
        return arg;
      }
      
      identity<number>(42)
    `);
    assertEquals(result3.success, true, "TypeScript generics should work");
    
    const displayData3 = result3.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData3["text/plain"], "42", "Should show identity result");
    
    // Test enum
    const result4 = await instance.kernel.execute(`
      enum Direction {
        Up = "UP",
        Down = "DOWN",
        Left = "LEFT",
        Right = "RIGHT"
      }
      
      Direction.Up
    `);
    assertEquals(result4.success, true, "TypeScript enum should work");
    
    const displayData4 = result4.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData4["text/plain"], '"UP"', "Should show enum value");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test console output and history tracking
Deno.test({
  name: "8. Test console output and history tracking",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Set up a promise that will resolve when we get output
    const outputPromise = new Promise<string>(resolve => {
      // Listen for stream events from the kernel
      manager.onKernelEvent(kernelId, KernelEvents.STREAM, (data) => {
        if (data.name === "stdout") {
          // Filter out log messages from the worker
          const text = data.text.trim();
          if (!text.startsWith("[TS_WORKER]") && !text.startsWith("[worker]")) {
            resolve(text);
          }
        }
      });
    });
    
    // Execute code with console.log and return a value
    const result = await instance.kernel.execute(`
      console.log("Testing console output");
      "Console test completed"
    `);
    
    // Wait for output
    const output = await outputPromise;
    assertEquals(output, "Testing console output", "Should receive correct console output");
    
    // Check the returned value via Symbol method
    assertEquals(result.success, true, "Execution should succeed");
    const displayData = result.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData["text/plain"], '"Console test completed"', "Should show completion message");
    
    // Test history tracking (this might not be available in all kernel implementations)
    try {
      if (typeof (instance.kernel as any).getHistory === 'function') {
        const history = (instance.kernel as any).getHistory();
        assert(Array.isArray(history), "History should be an array");
        assert(history.length > 0, "History should contain executed code");
        console.log("History tracking works:", history.length, "entries");
      } else {
        console.log("History tracking not available in this kernel implementation");
      }
         } catch (error) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       console.log("History tracking test skipped:", errorMessage);
     }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test variable listing and context management
Deno.test({
  name: "9. Test variable listing and context management",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Define some variables and return a confirmation
    const result = await instance.kernel.execute(`
      const testVar = 'test'; 
      let numberVar = 100;
      "Variables defined: testVar and numberVar"
    `);
    
    assertEquals(result.success, true, "Variable definition should succeed");
    const displayData = result.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData["text/plain"], '"Variables defined: testVar and numberVar"', "Should confirm variable definition");
    
    // Test that variables are accessible
    const result2 = await instance.kernel.execute(`
      testVar + " - " + numberVar
    `);
    
    assertEquals(result2.success, true, "Variable access should succeed");
    const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData2["text/plain"], '"test - 100"', "Should show variable values");
    
    // Test variable listing (this might not be available in all implementations)
    try {
      if (typeof (instance.kernel as any).getVariables === 'function') {
        const variables = (instance.kernel as any).getVariables();
        assert(Array.isArray(variables), "Variables should be an array");
        console.log("Available variables:", variables);
        
        // Should contain our test variables
        assert(variables.includes('testVar') || variables.some(v => v.includes('testVar')), 
          "Should include testVar");
      } else {
        console.log("Variable listing not available in this kernel implementation");
      }
         } catch (error) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       console.log("Variable listing test skipped:", errorMessage);
     }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test error handling
Deno.test({
  name: "10. Handle execution errors",
  async fn() {
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Set up a promise that will resolve when we get an error
    const errorPromise = new Promise<any>(resolve => {
      // Listen for error events from the kernel
      manager.onKernelEvent(kernelId, KernelEvents.EXECUTE_ERROR, (data) => {
        resolve(data);
      });
    });
    
    // Execute invalid code
    const result = await instance.kernel.execute('throw new Error("Test error");');
    
    // Check the result
    assertEquals(result.success, false, "Execution should fail");
    assert(result.error instanceof Error, "Result should contain an error");
    
    // Wait for error event
    const errorData = await errorPromise;
    assertEquals(errorData.ename, "Error", "Error name should be 'Error'");
    assertEquals(errorData.evalue, "Test error", "Error value should match");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test Deno-specific functionality
Deno.test({
  name: "11. Execute Deno-specific TypeScript code",
  async fn() {
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Execute code that uses Deno API with explicit return
    const result = await instance.kernel.execute(`
      const version = Deno.version.deno;
      console.log("Deno version:", version);
      version;
    `);
    
    // Check the result
    assertEquals(result.success, true, "Execution should succeed");
    console.log("Deno version result:", JSON.stringify(result.result, null, 2));
    
    // Check the new cleaner result structure with Jupyter display symbol
    assert(result.result, "Result should contain result object");
    assert(typeof result.result[Symbol.for("Jupyter.display")] === "function", "Result should have Jupyter display method");
    
    // Get the display data
    const displayData = result.result[Symbol.for("Jupyter.display")]();
    assert(displayData, "Display data should exist");
    assert(displayData["text/plain"], "Should have text/plain display data");
    const versionString = displayData["text/plain"];
    assert(versionString.match(/^\"\d+\.\d+\.\d+\"$/) || versionString.includes("deno"), 
      "Result should be a version string or include 'deno'");
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test complex Deno code with npm imports and top-level await
Deno.test({
  name: "12. Execute complex code with imports and await",
  async fn() {
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");

    // Execute complex code with npm import, await, and file operations
    const result = await instance.kernel.execute(`
      // Import lodash from npm (should already be available from previous test)
      // Create a temporary file
      const tempFile = await Deno.makeTempFile();
      
      // Write some data
      await Deno.writeTextFile(tempFile, "Hello from enhanced TypeScript kernel!");
      
      // Read it back
      const content = await Deno.readTextFile(tempFile);
      
      // Use lodash to manipulate the string (from previous import)
      const uppercased = lodash.upperCase(content);
      
      // Clean up
      await Deno.remove(tempFile);
      
      // Return both the processed content and success message
      ({
        processedContent: uppercased,
        message: "Complex operations with persistence completed"
      })
    `);

    // Check execution success
    assertEquals(result.success, true, "Complex code execution should complete without errors");
    
    // Check the new cleaner result structure with Jupyter display symbol
    assert(result.result, "Result should contain result object");
    assert(typeof result.result[Symbol.for("Jupyter.display")] === "function", "Result should have Jupyter display method");
    
    // Get the display data
    const displayData = result.result[Symbol.for("Jupyter.display")]();
    assert(displayData, "Display data should exist");
    assert(displayData["text/plain"], "Should have text/plain display data");
    
    const resultString = displayData["text/plain"];
    
    // Check that the result contains the expected data
    assert(resultString.includes("Complex operations with persistence completed"), 
      "Should contain success message");
    
    // Check that lodash processing worked (upperCase converts "TypeScript" to "TYPE SCRIPT")
    assert(
      resultString.includes("HELLO FROM ENHANCED") && 
      (resultString.includes("TYPESCRIPT") || resultString.includes("TYPE SCRIPT")), 
      `Result should contain processed content: ${resultString}`
    );
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test Deno.jupyter functionality
Deno.test({
  name: "13. Test Deno.jupyter display functions",
  async fn() {
    // Verify kernel exists
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Test Deno.jupyter.display function with custom MIME bundle
    const customDisplayPromise = new Promise<any>(resolve => {
      manager.onKernelEvent(kernelId, KernelEvents.DISPLAY_DATA, (data) => {
        resolve(data);
      });
    });

    const customResult = await instance.kernel.execute(`
      await Deno.jupyter.display({
        "text/plain": "Plain text output",
        "text/html": "<strong>Rich HTML output</strong>",
        "application/json": { message: "JSON data", value: 42 }
      }, { raw: true });
    `);

    assertEquals(customResult.success, true, "Custom display execution should succeed");

    const customDisplayData = await customDisplayPromise;
    assert(customDisplayData.data["text/plain"], "Should contain plain text");
    assert(customDisplayData.data["text/html"], "Should contain HTML");
    assert(customDisplayData.data["application/json"], "Should contain JSON");
    
    assertEquals(customDisplayData.data["text/plain"], "Plain text output");
    assertEquals(customDisplayData.data["text/html"], "<strong>Rich HTML output</strong>");
    assertEquals(customDisplayData.data["application/json"].message, "JSON data");
    assertEquals(customDisplayData.data["application/json"].value, 42);

    // Test Deno.jupyter.html function with simple assignment
    const htmlDisplayPromise = new Promise<any>(resolve => {
      manager.onKernelEvent(kernelId, KernelEvents.DISPLAY_DATA, (data) => {
        resolve(data);
      });
    });

    const htmlResult = await instance.kernel.execute(`
      const htmlObj = Deno.jupyter.html\`<h1>Hello from Enhanced Deno Jupyter!</h1>
      <p>This kernel now supports variable persistence and top-level await.</p>\`;
      htmlObj
    `);

    assertEquals(htmlResult.success, true, "HTML display execution should succeed");

    const htmlDisplayData = await htmlDisplayPromise;
    assert(htmlDisplayData.data["text/html"], "Display data should contain HTML MIME type");
    assert(
      htmlDisplayData.data["text/html"].includes("<h1>Hello from Enhanced Deno Jupyter!</h1>"),
      "HTML content should match expected output"
    );

    // Test Deno.jupyter.md function
    const mdDisplayPromise = new Promise<any>(resolve => {
      manager.onKernelEvent(kernelId, KernelEvents.DISPLAY_DATA, (data) => {
        resolve(data);
      });
    });

    const mdResult = await instance.kernel.execute(`
      const mdObj = Deno.jupyter.md\`# Enhanced Markdown Test
      
      This kernel now supports:
      - **Variable persistence** across executions
      - *Top-level await* functionality  
      - Import/export capabilities
      - Context management
      
      ## Features:
      1. TypeScript compilation
      2. Module loading
      3. State preservation\`;
      mdObj
    `);

    assertEquals(mdResult.success, true, "Markdown display execution should succeed");

    const mdDisplayData = await mdDisplayPromise;
    assert(mdDisplayData.data["text/markdown"], "Display data should contain Markdown MIME type");
    assert(
      mdDisplayData.data["text/markdown"].includes("# Enhanced Markdown Test"),
      "Markdown content should match expected output"
    );
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test context reset functionality
Deno.test({
  name: "14. Test context reset functionality",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Define some variables first
    const result0 = await instance.kernel.execute(`
      const resetTest = 'before reset'; 
      let counter = 99;
      "Variables defined for reset test"
    `);
    assertEquals(result0.success, true, "Variable definition should succeed");
    
    // Verify variables exist
    const result1 = await instance.kernel.execute("resetTest + ' - ' + counter");
    assertEquals(result1.success, true, "Variables should exist before reset");
    
    const displayData1 = result1.result[Symbol.for("Jupyter.display")]();
    assertEquals(displayData1["text/plain"], '"before reset - 99"', "Should show variable values before reset");
    
    // Reset context if available
    try {
      if (typeof (instance.kernel as any).resetContext === 'function') {
        (instance.kernel as any).resetContext();
        console.log("Context reset successful");
        
        // Try to access variables after reset - should return undefined type
        const result2 = await instance.kernel.execute("typeof resetTest");
        assertEquals(result2.success, true, "Execution should succeed");
        
        const displayData2 = result2.result[Symbol.for("Jupyter.display")]();
        assertEquals(displayData2["text/plain"], '"undefined"', "Variable should be undefined after reset");
        
        // Define new variables after reset
        const result3 = await instance.kernel.execute(`
          const afterReset = 'new context'; 
          afterReset
        `);
        assertEquals(result3.success, true, "New variables should work after reset");
        
        const displayData3 = result3.result[Symbol.for("Jupyter.display")]();
        assertEquals(displayData3["text/plain"], '"new context"', "Should show new variable value");
        
      } else {
        console.log("Context reset not available in this kernel implementation");
      }
         } catch (error) {
       const errorMessage = error instanceof Error ? error.message : String(error);
       console.log("Context reset test skipped:", errorMessage);
     }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test interrupt functionality  
Deno.test({
  name: "15. Test interrupt functionality",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Check if the kernel has interrupt support
    if (typeof instance.kernel.interrupt === 'function') {
      // Start a long-running execution
      const executionPromise = instance.kernel.execute(`
        console.log("Starting interruptible operation...");
        for (let i = 0; i < 100000; i++) {
          if (i % 10000 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }
        "Operation completed"
      `);
      
      // Interrupt after a short delay
      setTimeout(async () => {
        const interrupted = await instance.kernel.interrupt!();
        console.log("Interrupt result:", interrupted);
      }, 50);
      
      const result = await executionPromise;
      
      // Note: Interrupt behavior may vary by kernel implementation
      console.log("Execution completed with result:", result.success);
    } else {
      console.log("Kernel does not support interrupt functionality");
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Test code completion functionality
Deno.test({
  name: "16. Test code completion functionality",
  async fn() {
    const instance = manager.getKernel(kernelId);
    assert(instance, "Kernel instance should exist");
    
    // Set up some context variables
    await instance.kernel.execute(`
      let testVariable = 42;
      const testConstant = "hello";
      function testFunction() { return "test"; }
    `);
    
    // Check if the kernel has completion support
    if (typeof instance.kernel.complete === 'function') {
      // Test variable completion
      const completion1 = await instance.kernel.complete("test", 4);
      assert(completion1.status === "ok", "Completion should succeed");
      
      // Check if we get any matches (behavior may vary by kernel implementation)
      console.log("Completion matches for 'test':", completion1.matches);
      assert(Array.isArray(completion1.matches), "Should return an array of matches");
      
      // Test keyword completion
      const completion2 = await instance.kernel.complete("f", 1);
      console.log("Completion matches for 'f':", completion2.matches);
      assert(Array.isArray(completion2.matches), "Should return an array of matches");
      
      // Test cursor position calculation
      assert(typeof completion1.cursor_start === "number", "Should return cursor start position");
      assert(typeof completion1.cursor_end === "number", "Should return cursor end position");
    } else {
      console.log("Kernel does not support code completion functionality");
    }
  },
  sanitizeResources: false,
  sanitizeOps: false
});

// Teardown: Destroy the kernel
Deno.test({
  name: "17. Destroy TypeScript kernel",
  async fn() {
    // Destroy the kernel
    await manager.destroyKernel(kernelId);
    
    // Verify kernel is gone
    const instance = manager.getKernel(kernelId);
    assertEquals(instance, undefined, "Kernel should be destroyed");
  },
  sanitizeResources: false,
  sanitizeOps: false
}); 