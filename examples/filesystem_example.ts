#!/usr/bin/env deno run --allow-read --allow-write --allow-env --unstable

// Example script demonstrating filesystem mounting with the Deno Code Interpreter
// Run with: deno run --allow-read --allow-write --allow-env --unstable examples/filesystem_example.ts

import { KernelManager, KernelMode, KernelEvents } from "../kernel/mod.ts";
import { join } from "https://deno.land/std/path/mod.ts";
import { assert } from "https://deno.land/std/assert/mod.ts";

// Helper function to create a temporary directory
async function createTempDir(): Promise<string> {
  const tempDirName = `deno-test-${crypto.randomUUID()}`;
  const tempDirPath = join(Deno.cwd(), tempDirName);
  await Deno.mkdir(tempDirPath);
  return tempDirPath;
}

// Helper function to write a test file
async function writeTestFile(dirPath: string, fileName: string, content: string): Promise<string> {
  const filePath = join(dirPath, fileName);
  await Deno.writeTextFile(filePath, content);
  return filePath;
}

// Helper function to clean up a temporary directory
async function cleanupTempDir(dirPath: string): Promise<void> {
  try {
    await Deno.remove(dirPath, { recursive: true });
    console.log(`Cleaned up directory: ${dirPath}`);
  } catch (error) {
    console.error(`Error cleaning up directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Function to get necessary Deno cache directories
function getDenoDirectories() {
  const denoDir = Deno.env.get("DENO_DIR");
  let denoCache = "";
  
  if (denoDir) {
    denoCache = denoDir;
  } else {
    const userHomeDir = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
    if (Deno.build.os === "darwin") {
      denoCache = `${userHomeDir}/Library/Caches/deno`;
    } else if (Deno.build.os === "windows") {
      const localAppData = Deno.env.get("LocalAppData") || "";
      denoCache = `${localAppData}\\deno`;
    } else {
      // Linux and others
      denoCache = `${userHomeDir}/.cache/deno`;
    }
  }
  
  return {
    denoDir,
    denoCache,
    kernelDir: join(Deno.cwd(), "kernel")
  };
}

// Function to run the filesystem example
async function run() {
  console.log("Starting Deno Code Interpreter with filesystem mounting...");
  
  // Create a kernel manager
  const manager = new KernelManager();
  
  // Create a temporary directory for our test files
  const tempDir = await createTempDir();
  const testFileName = "example_test.txt";
  const testContent = "Hello from filesystem example!";
  
  // Get necessary Deno directories
  const { denoCache, kernelDir } = getDenoDirectories();
  
  try {
    // Write test file
    await writeTestFile(tempDir, testFileName, testContent);
    console.log(`Created test file: ${testFileName} in ${tempDir}`);
    
    // Create a kernel with filesystem mounting and proper permissions
    const kernelId = await manager.createKernel({
      mode: KernelMode.WORKER,
      deno: {
        permissions: {
          env: ["DENO_DIR", "HOME", "USERPROFILE"],
          read: [tempDir, kernelDir, denoCache],
          write: [tempDir],
          net: ["pypi.org:443", "cdn.jsdelivr.net:443", "files.pythonhosted.org:443"]
        }
      },
      filesystem: {
        enabled: true,
        root: tempDir,
        mountPoint: "/home/pyodide"
      }
    });
    
    console.log(`Created kernel with ID: ${kernelId}`);
    
    // Store received events
    const receivedEvents: any[] = [];
    
    // Setup event listener for stream events
    const streamListener = (data: any) => {
      if (data.text) {
        console.log(`[Stream Event] ${data.text.trim()}`);
        receivedEvents.push(data);
      }
    };
    
    // Add listener for stream events
    manager.onKernelEvent(kernelId, KernelEvents.STREAM, streamListener);
    
    // Get the kernel instance
    const kernelInstance = manager.getKernel(kernelId);
    if (!kernelInstance) {
      throw new Error("Failed to get kernel instance");
    }
    
    // Wait for initialization to complete
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log("\nTesting file operations in mounted filesystem...");
    
    // Test reading the mounted file
    const readResult = await kernelInstance.kernel.execute(`
import os
import sys
from pathlib import Path

try:
    # List files in the mounted directory
    files = os.listdir('/home/pyodide')
    print(f"Files in mounted directory: {files}")
    
    # Read the test file
    if '${testFileName}' in files:
        with open(f'/home/pyodide/${testFileName}', 'r') as f:
            content = f.read()
        print(f"File content: {content}")
        assert content == "${testContent}", "Content verification failed"
        print("Content verified successfully")
    else:
        print("Test file not found")
except Exception as e:
    import traceback
    print(f"Error: {e}")
    print(traceback.format_exc())
`);
    
    assert(readResult?.success, "File reading should succeed");
    
    console.log("\nTesting file writing in mounted filesystem...");
    
    // Test writing a new file
    const writeResult = await kernelInstance.kernel.execute(`
try:
    # Create a new file in the mounted directory
    new_file = Path('/home/pyodide/written_file.txt')
    new_file.write_text('This is a new file written from Python')
    print(f"Successfully wrote to {new_file}")
    
    # Verify the content
    content = new_file.read_text()
    print(f"Content read back: {content}")
except Exception as e:
    import traceback
    print(f"Error writing file: {e}")
    print(traceback.format_exc())
`);
    
    assert(writeResult?.success, "File writing should succeed");
    
    console.log("\nTesting access to restricted locations...");
    
    // Test accessing a restricted location
    const restrictedResult = await kernelInstance.kernel.execute(`
from js import Deno

try:
    # Attempt to read a file from a restricted location
    Deno.readTextFile("/etc/hosts")
    print("WARNING: Successfully accessed restricted file (this should not happen)")
except Exception as e:
    print(f"Expected error accessing restricted file: {e}")
    # Verify it's a permission error
    is_permission_error = "permission" in str(e).lower() or "denied" in str(e).lower()
    print(f"Is permission error (expected: True): {is_permission_error}")
`);
    
    assert(restrictedResult?.success, "Restricted access test should complete");
    
    // Verify events were received
    console.log(`\nReceived ${receivedEvents.length} events`);
    assert(receivedEvents.length > 0, "Should have received stream events");
    assert(
      receivedEvents.some(e => e.text && e.text.includes(testContent)),
      "Should have received event with file content"
    );
    
    // Clean up event listener
    manager.offKernelEvent(kernelId, KernelEvents.STREAM, streamListener);
    
    // Destroy the kernel
    await manager.destroyKernel(kernelId);
    console.log("\nKernel destroyed");
    
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error("Stack trace:", error.stack);
    }
  } finally {
    // Clean up temporary directory
    await cleanupTempDir(tempDir);
    
    // Ensure all kernels are destroyed
    await manager.destroyAll();
    console.log("Example completed");
  }
}

// Run the example
if (import.meta.main) {
  run().catch(console.error);
} 