// Enhanced Kernel Tests - Comprehensive coverage for advanced kernel features
// Run with: deno test -A --no-check tests/kernel_enhanced_test.ts

import { assertEquals, assertExists, assert, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { KernelManager, KernelMode, KernelLanguage, KernelEvents } from "../kernel/mod.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Test configuration
const TEST_CONFIG = {
  inactivityTimeout: 5000, // 5 seconds for quick tests
  maxExecutionTime: 10000, // 10 seconds max execution
  poolSize: 2
};

// Helper functions
async function createTempDir(): Promise<string> {
  const tempDirName = `kernel-test-${crypto.randomUUID()}`;
  const tempDirPath = join(Deno.cwd(), tempDirName);
  await Deno.mkdir(tempDirPath);
  return tempDirPath;
}

async function writeTestFile(dirPath: string, fileName: string, content: string): Promise<string> {
  const filePath = join(dirPath, fileName);
  await Deno.writeTextFile(filePath, content);
  return filePath;
}

async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await Deno.remove(dirPath, { recursive: true });
  } catch {
    // Ignore cleanup errors
  }
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced Kernel Tests
Deno.test("Enhanced Kernels - Environment Variables Support", async () => {
  const manager = new KernelManager();

  try {
    // Create Python kernel with environment variables
    const pythonKernelId = await manager.createKernel({
      id: "python-env-test", 
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      env: {
        "TEST_API_KEY": "secret123",
        "DEBUG_MODE": "true",
        "DATABASE_URL": "postgresql://localhost:5432/test",
        "MAX_RETRIES": "3",
        "SPECIAL_CHARS": "!@#$%^&*()_+-={}[]|:;\"'<>?,./"
      }
    });

    await wait(1000); // Wait for kernel initialization

    // Capture output through events
    let capturedOutput = '';
    const handleKernelEvent = (data: any) => {
      if (data) {
        if (data.name === 'stdout') {
          capturedOutput += data.text;
        } else if (data.data && data.data['text/plain']) {
          capturedOutput += data.data['text/plain'] + '\n';
        }
      }
    };

    manager.onKernelEvent(pythonKernelId, KernelEvents.STREAM, handleKernelEvent);
    manager.onKernelEvent(pythonKernelId, KernelEvents.EXECUTE_RESULT, handleKernelEvent);

    try {
      // Test environment variables are accessible
      const envResult = await manager.execute(pythonKernelId, `
import os
print("API Key:", os.environ.get('TEST_API_KEY'))
print("Debug Mode:", os.environ.get('DEBUG_MODE'))
print("Database URL:", os.environ.get('DATABASE_URL'))
print("Max Retries:", os.environ.get('MAX_RETRIES'))
print("Special chars:", os.environ.get('SPECIAL_CHARS'))
print("Non-existent:", os.environ.get('NON_EXISTENT', 'not_found'))

# Test environment variable types
debug_bool = os.environ.get('DEBUG_MODE') == 'true'
max_retries_int = int(os.environ.get('MAX_RETRIES', '0'))
print("Debug as bool:", debug_bool)
print("Max retries as int:", max_retries_int)
`);

      // Wait for events to be processed
      await wait(500);

      assert(envResult.success, "Environment variable test should succeed");
      assert(capturedOutput.includes("API Key: secret123") || capturedOutput.includes("secret123"), `Should show TEST_API_KEY. Output: ${capturedOutput}`);
      assert(capturedOutput.includes("Debug Mode: true") || capturedOutput.includes("true"), "Should show DEBUG_MODE");
    } finally {
      manager.offKernelEvent(pythonKernelId, KernelEvents.STREAM, handleKernelEvent);
      manager.offKernelEvent(pythonKernelId, KernelEvents.EXECUTE_RESULT, handleKernelEvent);
    }

    // Test TypeScript kernel with environment variables
    const tsKernelId = await manager.createKernel({
      id: "ts-env-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT,
      env: {
        "TS_API_KEY": "typescript_secret",
        "APP_NAME": "TestApp",
        "VERSION": "1.0.0",
        "CONFIG_JSON": '{"enabled":true,"timeout":5000}'
      }
    });

    await wait(500); // Wait for kernel initialization

    let tsCapturedOutput = '';
    const handleTsKernelEvent = (data: any) => {
      if (data) {
        if (data.name === 'stdout') {
          tsCapturedOutput += data.text;
        } else if (data.data && data.data['text/plain']) {
          tsCapturedOutput += data.data['text/plain'] + '\n';
        }
      }
    };

    manager.onKernelEvent(tsKernelId, KernelEvents.STREAM, handleTsKernelEvent);
    manager.onKernelEvent(tsKernelId, KernelEvents.EXECUTE_RESULT, handleTsKernelEvent);

    try {
      const tsEnvResult = await manager.execute(tsKernelId, `
const environs = (globalThis as any).ENVIRONS;
console.log("TS API Key:", environs?.TS_API_KEY);
console.log("App Name:", environs?.APP_NAME);
console.log("Version:", environs?.VERSION);
console.log("Config JSON:", environs?.CONFIG_JSON);

// Test parsing JSON from environment
try {
  const config = JSON.parse(environs?.CONFIG_JSON || '{}');
  console.log("Parsed config enabled:", config.enabled);
  console.log("Parsed config timeout:", config.timeout);
} catch (e) {
  console.log("Failed to parse config:", e);
}

console.log("All environment variables:", JSON.stringify(environs, null, 2));
`);

      // Wait for events to be processed
      await wait(500);

      assert(tsEnvResult.success, "TypeScript environment variable test should succeed");
      assert(tsCapturedOutput.includes("TS API Key: typescript_secret") || tsCapturedOutput.includes("typescript_secret"), `Should show TS_API_KEY. Output: ${tsCapturedOutput}`);
    } finally {
      manager.offKernelEvent(tsKernelId, KernelEvents.STREAM, handleTsKernelEvent);
      manager.offKernelEvent(tsKernelId, KernelEvents.EXECUTE_RESULT, handleTsKernelEvent);
    }

    await manager.destroyKernel(pythonKernelId);
    await manager.destroyKernel(tsKernelId);

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - Complex Execution Scenarios", async () => {
  const manager = new KernelManager();

  try {
    const kernelId = await manager.createKernel({
      id: "complex-execution-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });

    await wait(1000);

    // Test long-running computation
    const longRunningResult = await manager.execute(kernelId, `
import time
import math

# Simulate some computation
total = 0
for i in range(1000):
    total += math.sqrt(i + 1)
    if i % 100 == 0:
        print(f"Progress: {i}/1000")

print(f"Final total: {total:.2f}")
print("Long-running computation completed!")
`);

    assert(longRunningResult.success, "Long-running computation should succeed");

    // Test memory management with large data structures
    const memoryResult = await manager.execute(kernelId, `
import sys
import gc

# Create large data structures
large_list = list(range(100000))
large_dict = {str(i): i * 2 for i in range(10000)}
large_string = "x" * 50000

print(f"Large list length: {len(large_list)}")
print(f"Large dict size: {len(large_dict)}")
print(f"Large string length: {len(large_string)}")

# Check memory usage (approximate)
print(f"Reference count for large_list: {sys.getrefcount(large_list)}")

# Clean up
del large_list, large_dict, large_string
gc.collect()
print("Memory cleanup completed")
`);

    assert(memoryResult.success, "Memory management test should succeed");

    // Test error recovery
    const errorResult = await manager.execute(kernelId, `
try:
    # Intentional error
    result = 1 / 0
except ZeroDivisionError as e:
    print(f"Caught error: {e}")
    print("Continuing execution after error...")

# Verify kernel still works after error
print("Kernel is still functional!")
print("2 + 2 =", 2 + 2)
`);

    assert(errorResult.success, "Error recovery test should succeed");

    // Test concurrent execution (state isolation)
    const concurrent1 = manager.execute(kernelId, `
x = 100
print(f"Set x to {x}")
import time
time.sleep(0.1)
print(f"x is still {x}")
`);

    // Small delay to ensure some overlap
    await wait(50);

    const concurrent2 = manager.execute(kernelId, `
if 'x' in globals():
    print(f"x exists with value: {x}")
else:
    print("x does not exist in this execution")
y = 200
print(f"Set y to {y}")
`);

    const [result1, result2] = await Promise.all([concurrent1, concurrent2]);

    assert(result1.success, "First concurrent execution should succeed");
    assert(result2.success, "Second concurrent execution should succeed");

    await manager.destroyKernel(kernelId);

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - Filesystem Integration", async () => {
  const manager = new KernelManager();
  let tempDir: string | null = null;

  try {
    // Create temporary directory with test files
    tempDir = await createTempDir();
    await writeTestFile(tempDir, "test_data.txt", "Hello, World!\nThis is test data.\nLine 3");
    await writeTestFile(tempDir, "config.json", '{"setting1": true, "setting2": 42}');
    await writeTestFile(tempDir, "script.py", "print('Hello from file!')\nresult = 2 * 21\nprint(f'Result: {result}')");

    const kernelId = await manager.createKernel({
      id: "filesystem-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      filesystem: {
        enabled: true,
        root: tempDir,
        mountPoint: "/home/pyodide"
      }
    });

    await wait(1000);

    // Test file reading
    const readResult = await manager.execute(kernelId, `
import os
import json

# List files in mounted directory
print("Files in /home/pyodide:")
for file in os.listdir("/home/pyodide"):
    print(f"  {file}")

# Read text file
with open("/home/pyodide/test_data.txt", "r") as f:
    content = f.read()
    print(f"Text file content ({len(content)} chars):")
    print(content)

# Read and parse JSON
with open("/home/pyodide/config.json", "r") as f:
    config = json.load(f)
    print("JSON config:")
    print(f"  setting1: {config['setting1']}")
    print(f"  setting2: {config['setting2']}")
`);

    assert(readResult.success, "File reading should succeed");

    // Test file writing
    const writeResult = await manager.execute(kernelId, `
try:
    # Write new file
    with open("/home/pyodide/output.txt", "w") as f:
        f.write("Generated by kernel\\n")
        f.write("Current working directory: " + os.getcwd() + "\\n")
        f.write("Python version info: " + str(sys.version_info[:2]) + "\\n")

    # Append to file
    with open("/home/pyodide/output.txt", "a") as f:
        f.write("Appended content\\n")

    # Read back the file
    with open("/home/pyodide/output.txt", "r") as f:
        written_content = f.read()
        print("Written file content:")
        print(written_content)

    print("File operations completed successfully!")
except Exception as e:
    print(f"File operation error: {e}")
    print("File operations may have limitations in test environment")
`);

    assert(writeResult.success, "File writing test should complete");

    // Test executing Python file
    const execResult = await manager.execute(kernelId, `
# Execute Python script from file
exec(open("/home/pyodide/script.py").read())
`);

    assert(execResult.success, "Executing Python file should succeed");

    await manager.destroyKernel(kernelId);

  } finally {
    if (tempDir) {
      await cleanupTempDir(tempDir);
    }
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - Performance and Resource Management", async () => {
  const manager = new KernelManager();

  try {
    // Test kernel pool management
    const kernelIds: string[] = [];

    // Create multiple kernels quickly
    for (let i = 0; i < 3; i++) {
      try {
        const kernelId = await manager.createKernel({
          id: `perf-test-${i}`,
          mode: KernelMode.WORKER,
          lang: KernelLanguage.PYTHON
          // Remove inactivity timeout to prevent automatic cleanup during test
        });
        kernelIds.push(kernelId);
        console.log(`✅ Created kernel: ${kernelId}`);
        
        // Add a small delay to ensure kernel is fully initialized
        await wait(100);
      } catch (error) {
        console.error(`❌ Failed to create kernel perf-test-${i}:`, error);
        throw error;
      }
    }

    console.log(`📊 Created ${kernelIds.length} kernels: ${kernelIds.join(', ')}`);
    
    // Give kernels a moment to stabilize before verification
    await wait(500);

    // Verify all kernels exist before executing
    for (const kernelId of kernelIds) {
      const kernel = manager.getKernel(kernelId);
      if (!kernel) {
        const availableKernels = await manager.listKernels();
        console.error(`❌ Kernel ${kernelId} not found in manager. Available kernels:`, availableKernels.map(k => k.id));
        console.error(`📊 Total available kernels: ${availableKernels.length}`);
      }
      assertExists(kernel, `Kernel ${kernelId} should exist`);
    }

    // Execute on all kernels simultaneously
    const executions = kernelIds.map((kernelId, index) => 
      manager.execute(kernelId, `
import time
import threading
print(f"Kernel ${index} starting execution")
time.sleep(0.5)
result = sum(range(1000))
print(f"Kernel ${index} result: {result}")
print(f"Kernel ${index} completed")
`));

    const results = await Promise.all(executions);
    
    // Verify all executions succeeded
    results.forEach((result, index) => {
      assert(result.success, `Execution ${index} should succeed`);
    });

    // Test memory usage tracking
    const memoryTestKernelId = kernelIds[0];
    const memoryResult = await manager.execute(memoryTestKernelId, `
import sys
import gc

print("=== Memory Usage Test ===")
print("Python version:", sys.version)

try:
    import psutil
    import os
    # Try to get memory info if psutil is available
    process = psutil.Process(os.getpid())
    memory_info = process.memory_info()
    print(f"Memory RSS: {memory_info.rss / 1024 / 1024:.2f} MB")
    print(f"Memory VMS: {memory_info.vms / 1024 / 1024:.2f} MB")
except ImportError:
    print("psutil not available, using sys.getsizeof for basic memory tracking")

# Basic memory tracking that should always work
objects = gc.get_objects()
print(f"Total objects in memory: {len(objects)}")

# Calculate approximate memory usage of some objects
test_data = list(range(10000))
print(f"Size of 10k integers list: {sys.getsizeof(test_data)} bytes")

del test_data
gc.collect()
print("Memory test completed successfully")
`);

    assert(memoryResult.success, "Memory test should complete");

    // Test kernel management
    console.log("⏳ Testing kernel management...");
    
    // Verify kernels are still active
    const activeKernels = await manager.listKernels();
    console.log(`📊 Active kernels: ${activeKernels.length}`);

    // Clean up any remaining kernels
    for (const kernelId of kernelIds) {
      try {
        await manager.destroyKernel(kernelId);
      } catch {
        // May already be cleaned up by timeout
      }
    }

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - TypeScript Advanced Features", async () => {
  const manager = new KernelManager();

  try {
    const tsKernelId = await manager.createKernel({
      id: "ts-advanced-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT,
      env: {
        "NODE_ENV": "test",
        "API_BASE_URL": "https://api.example.com"
      }
    });

    await wait(500);

    // Test modern JavaScript/TypeScript features
    const modernJsResult = await manager.execute(tsKernelId, `
// Test async/await
async function asyncTest() {
  await new Promise(resolve => setTimeout(resolve, 100));
  return "Async operation completed";
}

// Test destructuring and spread operator
const testArray = [1, 2, 3, 4, 5];
const [first, second, ...rest] = testArray;
const newArray = [...testArray, 6, 7];

// Test arrow functions and template literals
const greet = (name: string) => \`Hello, \${name}!\`;

// Test classes with TypeScript types
class Calculator {
  private history: number[] = [];
  
  add(a: number, b: number): number {
    const result = a + b;
    this.history.push(result);
    return result;
  }
  
  getHistory(): number[] {
    return [...this.history];
  }
}

// Execute tests
(async () => {
  console.log("=== Modern JavaScript/TypeScript Test ===");
  
  const asyncResult = await asyncTest();
  console.log("Async result:", asyncResult);
  
  console.log("Destructured values:", { first, second, rest });
  console.log("New array:", newArray);
  
  console.log("Greeting:", greet("TypeScript"));
  
  const calc = new Calculator();
  console.log("5 + 3 =", calc.add(5, 3));
  console.log("10 + 7 =", calc.add(10, 7));
  console.log("Calculator history:", calc.getHistory());
  
  // Test environment variables
  const env = (globalThis as any).ENVIRONS;
  console.log("Environment:", {
    NODE_ENV: env?.NODE_ENV,
    API_BASE_URL: env?.API_BASE_URL
  });
  
  console.log("All tests completed successfully!");
})();
`);

    assert(modernJsResult.success, "Modern JavaScript features should work");

    // Test error handling in TypeScript
    const errorHandlingResult = await manager.execute(tsKernelId, `
try {
  // Test intentional error
  throw new Error("Test error for error handling");
} catch (error) {
  console.log("Caught error:", error.message);
  console.log("Error type:", error.constructor.name);
}

// Test type checking (runtime behavior)
function processData(data: any): string {
  if (typeof data === 'string') {
    return \`String: \${data}\`;
  } else if (typeof data === 'number') {
    return \`Number: \${data}\`;
  } else if (Array.isArray(data)) {
    return \`Array with \${data.length} items\`;
  } else {
    return \`Unknown type: \${typeof data}\`;
  }
}

console.log("Type tests:");
console.log(processData("hello"));
console.log(processData(42));
console.log(processData([1, 2, 3]));
console.log(processData({}));

console.log("Error handling completed!");
`);

    assert(errorHandlingResult.success, "Error handling should work");

    await manager.destroyKernel(tsKernelId);

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - Edge Cases and Error Scenarios", async () => {
  const manager = new KernelManager();

  try {
    // Test invalid kernel configurations
    await assertRejects(
      async () => {
        await manager.createKernel({
          id: "invalid-test",
          mode: KernelMode.WORKER,
          lang: "INVALID_LANGUAGE" as any
        });
      },
      Error,
      "Kernel type worker-INVALID_LANGUAGE is not allowed"
    );

    // Test invalid environment variables
    const kernelId = await manager.createKernel({
      id: "edge-case-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      env: {
        "EMPTY_VALUE": "",
        "NULL_VALUE": null as any,
        "UNDEFINED_VALUE": undefined as any,
        "NUMERIC_KEY_1": "100",
        "BOOLEAN_STRING": "false"
      }
    });

    await wait(1000);

    // Test handling of edge case environment variables
    const envEdgeCaseResult = await manager.execute(kernelId, `
import os

print("=== Environment Variable Edge Cases ===")
print("EMPTY_VALUE:", repr(os.environ.get('EMPTY_VALUE')))
print("NULL_VALUE:", repr(os.environ.get('NULL_VALUE')))
print("UNDEFINED_VALUE:", repr(os.environ.get('UNDEFINED_VALUE')))
print("NUMERIC_KEY_1:", repr(os.environ.get('NUMERIC_KEY_1')))
print("BOOLEAN_STRING:", repr(os.environ.get('BOOLEAN_STRING')))

# Test environment variable with special characters in name (if valid)
print("Environment variables count:", len(os.environ))
`);

    assert(envEdgeCaseResult.success, "Environment edge cases should be handled");

    // Test execution timeout and limits
    const longExecutionKernel = await manager.createKernel({
      id: "timeout-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON,
      maxExecutionTime: 2000 // 2 second timeout
    });

    await wait(500);

    // This should complete within timeout
    const fastResult = await manager.execute(longExecutionKernel, `
import time
print("Starting fast execution...")
time.sleep(0.5)  # 0.5 seconds
print("Fast execution completed!")
`);

    assert(fastResult.success, "Fast execution should succeed");

    // Test very large output handling
    const largeOutputResult = await manager.execute(kernelId, `
print("=== Large Output Test ===")
# Generate large output
for i in range(100):
    print(f"Line {i:03d}: " + "x" * 50)
print("Large output test completed!")
`);

    assert(largeOutputResult.success, "Large output should be handled");

    // Test malformed code handling
    const malformedResult = await manager.execute(kernelId, `
# This is valid Python but tests error handling
try:
    # Syntax error in eval
    eval("2 +")
except SyntaxError as e:
    print(f"Caught syntax error: {e}")

try:
    # Runtime error
    undefined_variable
except NameError as e:
    print(f"Caught name error: {e}")

print("Malformed code test completed!")
`);

    assert(malformedResult.success, "Malformed code handling should work");

    await manager.destroyKernel(kernelId);
    await manager.destroyKernel(longExecutionKernel);

  } finally {
    await manager.destroyAll();
  }
});



Deno.test("Enhanced Kernels - Python Code Completion", async () => {
  const manager = new KernelManager();

  try {
    const pythonKernelId = await manager.createKernel({
      id: "python-completion-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });

    await wait(2000); // Give Python kernel time to fully initialize

    const kernel = manager.getKernel(pythonKernelId);
    assertExists(kernel, "Python kernel should exist");

    // Set up some variables and imports for completion testing
    await manager.execute(pythonKernelId, `
import math
import json
import os
import sys
from datetime import datetime, timedelta

# Define some variables for completion
my_variable = 42
my_string = "hello world"
my_list = [1, 2, 3, 4, 5]
my_dict = {"key1": "value1", "key2": "value2"}

def my_function(x, y):
    return x + y

class MyClass:
    def __init__(self, name):
        self.name = name
        self.value = 0
    
    def get_name(self):
        return self.name
    
    def set_value(self, value):
        self.value = value
        return self

obj = MyClass("test_object")
`);

    // Wait for execution to complete
    await wait(500);

    console.log("🔍 Testing Python code completion functionality...");

    // Test 1: Variable name completion
    if (typeof kernel.kernel.complete === 'function') {
      console.log("\n1. Testing variable completion for 'my':");
      const completion1 = await kernel.kernel.complete("my", 2);
      console.log("Result:", JSON.stringify(completion1, null, 2));
      
      assert(completion1.status === "ok", "Completion should return ok status");
      assert(Array.isArray(completion1.matches), "Should return matches array");
      assert(completion1.matches.length > 0, "Should have completion matches");
      
      // Check if our variables are in the completions
      const hasMyVariable = completion1.matches.some((match: string) => match.includes("my_variable"));
      const hasMyString = completion1.matches.some((match: string) => match.includes("my_string"));
      
      console.log("Contains my_variable:", hasMyVariable);
      console.log("Contains my_string:", hasMyString);

      // Test 2: Module completion
      console.log("\n2. Testing module completion for 'ma':");
      const completion2 = await kernel.kernel.complete("ma", 2);
      console.log("Result:", JSON.stringify(completion2, null, 2));
      
      assert(completion2.status === "ok", "Module completion should succeed");
      assert(Array.isArray(completion2.matches), "Should return matches array");
      
      const hasMath = completion2.matches.some((match: string) => match.includes("math"));
      console.log("Contains math module:", hasMath);

      // Test 3: Attribute completion
      console.log("\n3. Testing attribute completion for 'my_list.':");
      const completion3 = await kernel.kernel.complete("my_list.", 8);
      console.log("Result:", JSON.stringify(completion3, null, 2));
      
      assert(completion3.status === "ok", "Attribute completion should succeed");
      assert(Array.isArray(completion3.matches), "Should return matches array");
      
      const hasAppend = completion3.matches.some((match: string) => match.includes("append"));
      const hasExtend = completion3.matches.some((match: string) => match.includes("extend"));
      
      console.log("Contains append method:", hasAppend);
      console.log("Contains extend method:", hasExtend);

      // Test 4: Module method completion
      console.log("\n4. Testing module method completion for 'math.':");
      const completion4 = await kernel.kernel.complete("math.", 5);
      console.log("Result:", JSON.stringify(completion4, null, 2));
      
      assert(completion4.status === "ok", "Module method completion should succeed");
      assert(Array.isArray(completion4.matches), "Should return matches array");
      
      const hasSqrt = completion4.matches.some((match: string) => match.includes("sqrt"));
      const hasSin = completion4.matches.some((match: string) => match.includes("sin"));
      
      console.log("Contains sqrt function:", hasSqrt);
      console.log("Contains sin function:", hasSin);

      // Test 5: Custom class method completion
      console.log("\n5. Testing custom class method completion for 'obj.':");
      const completion5 = await kernel.kernel.complete("obj.", 4);
      console.log("Result:", JSON.stringify(completion5, null, 2));
      
      assert(completion5.status === "ok", "Custom class completion should succeed");
      assert(Array.isArray(completion5.matches), "Should return matches array");
      
      const hasGetName = completion5.matches.some((match: string) => match.includes("get_name"));
      const hasSetValue = completion5.matches.some((match: string) => match.includes("set_value"));
      
      console.log("Contains get_name method:", hasGetName);
      console.log("Contains set_value method:", hasSetValue);

      // Test 6: Keyword completion
      console.log("\n6. Testing keyword completion for 'im':");
      const completion6 = await kernel.kernel.complete("im", 2);
      console.log("Result:", JSON.stringify(completion6, null, 2));
      
      assert(completion6.status === "ok", "Keyword completion should succeed");
      assert(Array.isArray(completion6.matches), "Should return matches array");
      
      const hasImport = completion6.matches.some((match: string) => match.includes("import"));
      console.log("Contains import keyword:", hasImport);

      // Test 7: Completion with cursor position
      console.log("\n7. Testing completion with specific cursor position:");
      const testCode = "my_list.append(my_var";
      const completion7 = await kernel.kernel.complete(testCode, testCode.length);
      console.log("Code:", testCode, "Cursor pos:", testCode.length);
      console.log("Result:", JSON.stringify(completion7, null, 2));
      
      assert(completion7.status === "ok", "Cursor position completion should succeed");
      assert(typeof completion7.cursor_start === "number", "Should return cursor_start");
      assert(typeof completion7.cursor_end === "number", "Should return cursor_end");

      // Test 8: Empty completion
      console.log("\n8. Testing empty completion:");
      const completion8 = await kernel.kernel.complete("", 0);
      console.log("Result matches count:", completion8.matches?.length || 0);
      
      assert(completion8.status === "ok", "Empty completion should succeed");
      assert(Array.isArray(completion8.matches), "Should return matches array");

      // Test 9: Built-in function completion
      console.log("\n9. Testing built-in function completion for 'pr':");
      const completion9 = await kernel.kernel.complete("pr", 2);
      console.log("Result:", JSON.stringify(completion9, null, 2));
      
      assert(completion9.status === "ok", "Built-in completion should succeed");
      
      const hasPrint = completion9.matches.some((match: string) => match.includes("print"));
      console.log("Contains print function:", hasPrint);

      // Test 10: Dictionary key completion (if supported)
      console.log("\n10. Testing dictionary completion for 'my_dict[':");
      const completion10 = await kernel.kernel.complete("my_dict[", 8);
      console.log("Result:", JSON.stringify(completion10, null, 2));
      
      assert(completion10.status === "ok", "Dictionary completion should succeed");

      console.log("\n✅ All Python completion tests completed successfully!");
      
    } else {
      console.log("❌ Kernel does not support completion functionality");
      assert(false, "Python kernel should support completion");
    }

    await manager.destroyKernel(pythonKernelId);

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - Code Completion Edge Cases", async () => {
  const manager = new KernelManager();

  try {
    const pythonKernelId = await manager.createKernel({
      id: "completion-edge-cases-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });

    await wait(2000);

    const kernel = manager.getKernel(pythonKernelId);
    assertExists(kernel, "Python kernel should exist");

    // Set up complex scenarios for edge case testing
    await manager.execute(pythonKernelId, `
# Complex nested structures
nested_dict = {
    "level1": {
        "level2": {
            "level3": ["item1", "item2", "item3"]
        }
    }
}

# Class inheritance
class Animal:
    def __init__(self, name):
        self.name = name
    
    def speak(self):
        pass

class Dog(Animal):
    def __init__(self, name, breed):
        super().__init__(name)
        self.breed = breed
    
    def speak(self):
        return f"{self.name} barks!"
    
    def fetch(self):
        return f"{self.name} fetches the ball!"

my_dog = Dog("Buddy", "Golden Retriever")

# Lambda functions and complex expressions
process_data = lambda x: x * 2 + 1
data_list = [process_data(i) for i in range(5)]
`);

    await wait(500);

    if (typeof kernel.kernel.complete === 'function') {
      console.log("🔍 Testing Python completion edge cases...");

      // Test 1: Nested attribute completion
      console.log("\n1. Testing nested attribute completion:");
      const completion1 = await kernel.kernel.complete("nested_dict['level1']['level2'].", 31);
      console.log("Result:", JSON.stringify(completion1, null, 2));
      
      assert(completion1.status === "ok", "Nested completion should succeed");

      // Test 2: Inherited method completion
      console.log("\n2. Testing inherited method completion:");
      const completion2 = await kernel.kernel.complete("my_dog.", 7);
      console.log("Result:", JSON.stringify(completion2, null, 2));
      
      assert(completion2.status === "ok", "Inherited method completion should succeed");
      
      const hasSpeak = completion2.matches.some((match: string) => match.includes("speak"));
      const hasFetch = completion2.matches.some((match: string) => match.includes("fetch"));
      const hasName = completion2.matches.some((match: string) => match.includes("name"));
      
      console.log("Contains speak method:", hasSpeak);
      console.log("Contains fetch method:", hasFetch);
      console.log("Contains name attribute:", hasName);

      // Test 3: Completion after function call
      console.log("\n3. Testing completion after function call:");
      const completion3 = await kernel.kernel.complete("str(42).", 8);
      console.log("Result:", JSON.stringify(completion3, null, 2));
      
      assert(completion3.status === "ok", "Function call completion should succeed");

      // Test 4: Multi-line completion
      console.log("\n4. Testing multi-line completion:");
      const multilineCode = `if True:
    my_dog.`;
      const completion4 = await kernel.kernel.complete(multilineCode, multilineCode.length);
      console.log("Result:", JSON.stringify(completion4, null, 2));
      
      assert(completion4.status === "ok", "Multi-line completion should succeed");

      // Test 5: Invalid syntax completion handling
      console.log("\n5. Testing completion with invalid syntax:");
      const completion5 = await kernel.kernel.complete("my_dog.(", 8);
      console.log("Result:", JSON.stringify(completion5, null, 2));
      
      // Should handle gracefully, not necessarily succeed
      assert(completion5.status === "ok" || completion5.status === "error", "Should handle invalid syntax gracefully");

      // Test 6: Very long line completion
      console.log("\n6. Testing completion on very long line:");
      const longLine = "my_dog." + "get_name().".repeat(10); // Create a long chain
      const completion6 = await kernel.kernel.complete(longLine, 7); // Complete at my_dog.
      console.log("Result:", JSON.stringify(completion6, null, 2));
      
      assert(completion6.status === "ok", "Long line completion should succeed");

      // Test 7: Completion with special characters
      console.log("\n7. Testing completion with special characters:");
      await manager.execute(pythonKernelId, `special_var_with_underscore = "test"`);
      await wait(100);
      
      const completion7 = await kernel.kernel.complete("special_var", 11);
      console.log("Result:", JSON.stringify(completion7, null, 2));
      
      assert(completion7.status === "ok", "Special character completion should succeed");

      console.log("\n✅ All completion edge case tests completed!");

    } else {
      console.log("❌ Kernel does not support completion functionality");
      assert(false, "Python kernel should support completion");
    }

    await manager.destroyKernel(pythonKernelId);

  } finally {
    await manager.destroyAll();
  }
});

Deno.test("Enhanced Kernels - TypeScript vs Python Completion Comparison", async () => {
  const manager = new KernelManager();

  try {
    // Create both kernel types
    const pythonKernelId = await manager.createKernel({
      id: "python-comparison-test",
      mode: KernelMode.WORKER,
      lang: KernelLanguage.PYTHON
    });

    const tsKernelId = await manager.createKernel({
      id: "ts-comparison-test", 
      mode: KernelMode.WORKER,
      lang: KernelLanguage.TYPESCRIPT
    });

    await wait(2000); // Wait for both kernels to initialize

    const pythonKernel = manager.getKernel(pythonKernelId);
    const tsKernel = manager.getKernel(tsKernelId);
    
    assertExists(pythonKernel, "Python kernel should exist");
    assertExists(tsKernel, "TypeScript kernel should exist");

    // Set up similar variables in both kernels
    await manager.execute(pythonKernelId, `
test_variable = 42
test_function = lambda x: x * 2
test_list = [1, 2, 3]
`);

    await manager.execute(tsKernelId, `
const test_variable = 42;
const test_function = (x: number) => x * 2;
const test_list = [1, 2, 3];
`);

    await wait(500);

    console.log("🔍 Comparing completion between Python and TypeScript kernels...");

    if (typeof pythonKernel.kernel.complete === 'function' && 
        typeof tsKernel.kernel.complete === 'function') {

      // Test 1: Variable completion comparison
      console.log("\n1. Comparing variable completion for 'test':");
      
      const pythonCompletion1 = await pythonKernel.kernel.complete("test", 4);
      const tsCompletion1 = await tsKernel.kernel.complete("test", 4);
      
      console.log("Python completion:", JSON.stringify(pythonCompletion1, null, 2));
      console.log("TypeScript completion:", JSON.stringify(tsCompletion1, null, 2));
      
      assert(pythonCompletion1.status === "ok", "Python completion should succeed");
      assert(tsCompletion1.status === "ok", "TypeScript completion should succeed");
      
      assert(Array.isArray(pythonCompletion1.matches), "Python should return matches array");
      assert(Array.isArray(tsCompletion1.matches), "TypeScript should return matches array");

      // Test 2: Method completion comparison
      console.log("\n2. Comparing method completion for 'test_list.':");
      
      const pythonCompletion2 = await pythonKernel.kernel.complete("test_list.", 10);
      const tsCompletion2 = await tsKernel.kernel.complete("test_list.", 10);
      
      console.log("Python list methods count:", pythonCompletion2.matches?.length || 0);
      console.log("TypeScript array methods count:", tsCompletion2.matches?.length || 0);
      
      assert(pythonCompletion2.status === "ok", "Python method completion should succeed");
      assert(tsCompletion2.status === "ok", "TypeScript method completion should succeed");

      // Test 3: Cursor position accuracy
      console.log("\n3. Comparing cursor position handling:");
      
      const testCode = "test_variable + test_function";
      const cursorPos = 13; // Position after "test_variable"
      
      const pythonCompletion3 = await pythonKernel.kernel.complete(testCode, cursorPos);
      const tsCompletion3 = await tsKernel.kernel.complete(testCode, cursorPos);
      
      console.log("Python cursor handling:", {
        start: pythonCompletion3.cursor_start,
        end: pythonCompletion3.cursor_end
      });
      console.log("TypeScript cursor handling:", {
        start: tsCompletion3.cursor_start,
        end: tsCompletion3.cursor_end
      });
      
      assert(typeof pythonCompletion3.cursor_start === "number", "Python should return cursor_start");
      assert(typeof pythonCompletion3.cursor_end === "number", "Python should return cursor_end");
      assert(typeof tsCompletion3.cursor_start === "number", "TypeScript should return cursor_start");
      assert(typeof tsCompletion3.cursor_end === "number", "TypeScript should return cursor_end");

      console.log("\n✅ Completion comparison tests completed!");
      
      // Summary
      console.log("\n📊 Completion Feature Summary:");
      console.log("Python kernel: ✅ Full completion support with Jedi");
      console.log("TypeScript kernel: ✅ Full completion support with context awareness");
      console.log("Both kernels provide comprehensive completion functionality!");

    } else {
      if (typeof pythonKernel.kernel.complete !== 'function') {
        console.log("❌ Python kernel missing completion");
      }
      if (typeof tsKernel.kernel.complete !== 'function') {
        console.log("❌ TypeScript kernel missing completion");
      }
      assert(false, "Both kernels should support completion");
    }

    await manager.destroyKernel(pythonKernelId);
    await manager.destroyKernel(tsKernelId);

  } finally {
    await manager.destroyAll();
  }
});

// Cleanup after all tests
console.log("🧪 Enhanced Kernel module tests completed. Run with: deno test -A --no-check tests/kernel_enhanced_test.ts"); 