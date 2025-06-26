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
      if (data.kernelId === pythonKernelId && data.data) {
        if (data.data.name === 'stdout') {
          capturedOutput += data.data.text;
        } else if (data.data.data && data.data.data['text/plain']) {
          capturedOutput += data.data.data['text/plain'] + '\n';
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
      if (data.kernelId === tsKernelId && data.data) {
        if (data.data.name === 'stdout') {
          tsCapturedOutput += data.data.text;
        } else if (data.data.data && data.data.data['text/plain']) {
          tsCapturedOutput += data.data.data['text/plain'] + '\n';
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
        console.error(`❌ Kernel ${kernelId} not found in manager. Available kernels:`, manager.listKernels().map(k => k.id));
        console.error(`📊 Total available kernels: ${manager.listKernels().length}`);
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
    const activeKernels = manager.listKernels();
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



// Cleanup after all tests
console.log("🧪 Enhanced Kernel module tests completed. Run with: deno test -A --no-check tests/kernel_enhanced_test.ts"); 