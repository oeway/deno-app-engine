// Example of using the streaming functionality of the Deno Code Interpreter kernel

import { KernelManager, KernelMode } from "../kernel/mod.ts";

async function runStreamingExample() {
  console.log("\nDeno Code Interpreter - Streaming Example\n");
  console.log("This example demonstrates streaming output from a Python kernel\n");
  
  // Create a kernel manager
  const manager = new KernelManager();
  
  // Create a kernel
  console.log("Creating kernel...");
  const kernelId = await manager.createKernel({
    id: "streaming-example",
    mode: KernelMode.WORKER
  });
  
  // Get the kernel instance
  const instance = manager.getKernel(kernelId);
  if (!instance) {
    console.error("Failed to create kernel");
    return;
  }
  
  // Initialize the kernel
  console.log("Initializing kernel...");
  await instance.kernel.initialize();
  console.log("Kernel initialized!");
  
  // Define a Python program with multiple outputs
  const pythonCode = `
import time

# Print some messages with delays
print("Starting execution...")
time.sleep(1.5)

print("Processing data...")
time.sleep(1.5)

# Generate some data
for i in range(5):
    print(f"Generated data point {i+1}: value = {i * 10}")
    time.sleep(1.3)
    
print("Data generation complete!")
time.sleep(1.5)

# Display a summary
print("Summary: 5 data points generated with values 0, 10, 20, 30, 40")

# Return a result
"Execution complete with 5 data points"
`;

  // Execute the code with streaming output
  console.log("\nExecuting Python code with streaming output:\n");
  console.log("---------------------------------------------");

  // Use the manager's executeStream method instead of the kernel's
  const execGen = manager.executeStream(kernelId, pythonCode);
  
  // Process the streaming output
  for await (const output of execGen) {
    // Format and display the output based on event type
    switch (output.type) {
      case 'stream': {
        // Stream output (stdout/stderr)
        const text = output.data.text.trim();
        if (text) {
          console.log(`[${output.data.name}] ${text}`);
        }
        break;
      }
      case 'execute_result': {
        // Execution result
        console.log(`\n[Result] ${output.data.data["text/plain"]}`);
        break;
      }
      case 'execute_error': {
        // Error
        console.log(`\n[Error] ${output.data.ename}: ${output.data.evalue}`);
        break;
      }
      case 'display_data': {
        // Display data
        console.log(`\n[Display] ${JSON.stringify(output.data.data)}`);
        break;
      }
      default: {
        // Other event types
        console.log(`\n[${output.type}] ${JSON.stringify(output.data)}`);
      }
    }
  }
  
  console.log("---------------------------------------------");
  console.log("\nExecution complete!");
  
  // Clean up
  await manager.destroyKernel(kernelId);
  console.log("Kernel destroyed, example complete");
}

// Run the example
runStreamingExample().catch(err => {
  console.error("Error in streaming example:", err);
}); 