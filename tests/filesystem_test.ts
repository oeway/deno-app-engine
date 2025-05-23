// Filesystem mounting test for Deno App Engine

import { assertEquals, assertExists } from "https://deno.land/std/testing/asserts.ts";
import { Kernel, IKernelOptions } from "../kernel/index.ts";
import { join } from "https://deno.land/std/path/mod.ts";

// Helper function to create a temp test file in the current directory
async function createTestFile(fileName: string, content: string): Promise<string> {
  const filePath = join(".", fileName);
  await Deno.writeTextFile(filePath, content);
  console.log(`Created test file: ${filePath}`);
  return filePath;
}

// Helper function to remove a file
async function removeFile(filePath: string): Promise<void> {
  try {
    await Deno.remove(filePath);
    console.log(`Removed file: ${filePath}`);
  } catch (error) {
    console.error(`Error removing file: ${filePath}`, error);
  }
}

// Test direct kernel filesystem mounting
Deno.test("Simple filesystem mounting test", async () => {
  // Create test file in the current directory
  const testFileName = "test_file.txt";
  const testContent = "Hello, Pyodide filesystem!";
  await createTestFile(testFileName, testContent);

  try {
    // Create kernel with filesystem mounting enabled
    const kernel = new Kernel();
    const options: IKernelOptions = {
      filesystem: {
        enabled: true,
        root: ".", // Use current directory
        mountPoint: "/home/pyodide"
      }
    };

    console.log(`Initializing kernel with options: ${JSON.stringify(options, null, 2)}`);
    await kernel.initialize(options);
    console.log("Kernel initialized successfully");

    // Run a basic Python test
    const basicTest = await kernel.execute('print("Hello from Python")');
    assertEquals(basicTest.success, true, "Basic Python code should execute");

    // List files in the mounted directory
    const listFiles = await kernel.execute(`
import os
files = os.listdir("/home/pyodide")
print(f"Files in mounted directory: {files}")
`);
    assertEquals(listFiles.success, true, "Directory listing should succeed");

    // Verify test file exists in Python's filesystem
    const checkFile = await kernel.execute(`
import os
exists = "${testFileName}" in os.listdir("/home/pyodide")
print(f"File exists: {exists}")
`);
    assertEquals(checkFile.success, true, "File check should succeed");

    // Read file content from Python
    const readFile = await kernel.execute(`
try:
    with open("/home/pyodide/${testFileName}", "r") as f:
        content = f.read()
    print(f"File content: {content}")
    assert content == "${testContent}", "Content doesn't match expected value"
    print("Content verified successfully")
except Exception as e:
    import traceback
    print(f"Error: {e}")
    print(traceback.format_exc())
`);
    assertEquals(readFile.success, true, "File reading should succeed");

  } finally {
    // Clean up
    await removeFile(testFileName);
  }
}); 