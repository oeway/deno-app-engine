#!/usr/bin/env deno run --allow-read --allow-write --unstable

// Example script demonstrating filesystem mounting with the Deno Code Interpreter
// Run with: deno run --allow-read --allow-write --unstable examples/filesystem_example.ts

import { KernelManager, KernelMode } from "../kernel/manager.ts";
import { join } from "https://deno.land/std/path/mod.ts";

// Function to run the filesystem example
async function run() {
  console.log("Starting Deno Code Interpreter with filesystem mounting...");
  
  // Create a kernel manager
  const manager = new KernelManager();
  
  try {
    // Create a kernel with filesystem mounting enabled
    const kernelId = await manager.createKernel({
      mode: KernelMode.MAIN_THREAD, // Use main thread mode for simplicity
      filesystem: {
        enabled: true,
        root: ".", // Mount the current directory
        mountPoint: "/home/pyodide"
      }
    });
    
    console.log(`Created kernel with ID: ${kernelId}`);
    
    // Get the kernel instance
    const kernelInstance = manager.getKernel(kernelId);
    if (!kernelInstance) {
      throw new Error("Failed to get kernel instance");
    }
    
    // Wait for initialization to complete
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log("Kernel initialized. Running Python code to list files...");
    
    // List files in the mounted directory
    const listResult = await kernelInstance.kernel.execute(`
import os

# List files in the mounted directory
files = os.listdir('/home/pyodide')
print("Files in mounted directory:")
for file in sorted(files):
    # Check if it's a directory
    path = os.path.join('/home/pyodide', file)
    is_dir = os.path.isdir(path)
    print(f"  {'[DIR]' if is_dir else '[FILE]'} {file}")

# Remember current directory for later
current_dir = '/home/pyodide'
`);
    
    if (!listResult.success) {
      throw new Error("Failed to list files");
    }
    
    console.log("\nCreating a Python file in the mounted directory...");
    
    // Create a Python file
    const createFileResult = await kernelInstance.kernel.execute(`
# Create a simple Python script
script_content = '''
def hello(name):
    return f"Hello, {name} from Python!"

if __name__ == "__main__":
    print(hello("Deno"))
'''

with open('/home/pyodide/hello.py', 'w') as f:
    f.write(script_content)

print("Created hello.py in the mounted directory")
`);
    
    if (!createFileResult.success) {
      throw new Error("Failed to create Python file");
    }
    
    console.log("\nExecuting the Python file...");
    
    // Execute the Python file
    const executeFileResult = await kernelInstance.kernel.execute(`
# Import and run the Python module
import sys
sys.path.append('/home/pyodide')
import hello

# Call the function from the module
result = hello.hello("Filesystem")
print(result)
`);
    
    if (!executeFileResult.success) {
      throw new Error("Failed to execute Python file");
    }
    
    console.log("\nWriting execution results to a file...");
    
    // Write results to a file
    const writeResultsResult = await kernelInstance.kernel.execute(`
# Write results to a file
with open('/home/pyodide/results.txt', 'w') as f:
    f.write(f"Execution completed at {__import__('datetime').datetime.now()}")
    f.write("\\n")
    f.write(f"Result: {result}")

print("Results written to results.txt")
`);
    
    if (!writeResultsResult.success) {
      throw new Error("Failed to write results");
    }
    
    console.log("\nReading results file from Deno...");
    
    // Read the results file from Deno
    const resultsFilePath = join(Deno.cwd(), "results.txt");
    try {
      const resultsContent = await Deno.readTextFile(resultsFilePath);
      console.log("Results file content:", resultsContent);
    } catch (error) {
      console.error("Error reading results file:", error);
    }
    
    console.log("\nCleaning up...");
    
    // Delete the created files
    try {
      await Deno.remove(join(Deno.cwd(), "hello.py"));
      await Deno.remove(resultsFilePath);
      console.log("Files cleaned up successfully");
    } catch (error) {
      console.error("Error cleaning up files:", error);
    }
    
    // Destroy the kernel
    await manager.destroyKernel(kernelId);
    console.log("Kernel destroyed");
    
  } catch (error) {
    console.error("Error:", error);
  } finally {
    // Ensure all kernels are destroyed
    await manager.destroyAll();
    console.log("Example completed");
  }
}

// Run the example
run().catch(console.error); 