// @ts-ignore Import from Deno standard library
import { assert, assertEquals } from "https://deno.land/std@0.195.0/testing/asserts.ts";
import { kernel } from "./mod.ts";

// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "Kernel initialization and basic execution",
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

// We use a single test for all operations to avoid issues with test isolation
// @ts-ignore Deno is available in Deno runtime
Deno.test({
  name: "Execute Python code directly",
  async fn() {
    if (!kernel.isInitialized()) {
      await kernel.initialize();
    }
    
    // Test arithmetic expression
    const addResult = await kernel.execute(`
result = 2 + 3
print(f"Result: {result}")
    `);
    assert(addResult.success, "Addition should succeed");
    
    // Test Python functions
    const functionResult = await kernel.execute(`
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n-1)

result = factorial(5)
print(f"Factorial of 5: {result}")
    `);
    assert(functionResult.success, "Factorial function should succeed");
    
    // Test error handling
    let exceptionCaught = false;
    try {
      await kernel.execute("1/0");
    } catch (e) {
      exceptionCaught = true;
    }
    // The execute method should handle errors and not throw
    assert(!exceptionCaught, "Division by zero should not throw exception");
  },
  sanitizeResources: false,
  sanitizeOps: false,
  timeout: 15000
});
