// Example of using the ALL event handler in the Deno Code Interpreter kernel

import { KernelManager, KernelMode, KernelEvents, IEventData } from "../kernel/mod.ts";

async function runAllEventsExample() {
  console.log("\nDeno Code Interpreter - ALL Events Example\n");
  console.log("This example demonstrates using the ALL event handler\n");
  
  // Create a kernel manager
  const manager = new KernelManager();
  
  // Create a kernel
  console.log("Creating kernel...");
  const kernelId = await manager.createKernel({
    id: "all-events-example",
    mode: KernelMode.MAIN_THREAD
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
  
  // Setup the ALL event handler
  const events: IEventData[] = [];
  instance.kernel.on(KernelEvents.ALL, (eventData: IEventData) => {
    events.push(eventData);
    console.log(`[Event] Type: ${eventData.type}, Data:`, eventData.data);
  });
  
  // Define a Python program
  const pythonCode = `
import time
import matplotlib.pyplot as plt
import numpy as np

# Print some messages
print("Starting execution...")
time.sleep(0.5)

# Generate some data
x = np.linspace(0, 10, 100)
y = np.sin(x)

# Create a plot
plt.figure(figsize=(8, 6))
plt.plot(x, y)
plt.title('Sine Wave')
plt.xlabel('x')
plt.ylabel('sin(x)')
plt.grid(True)
plt.show()

# Return a result
"Execution complete"
`;

  // Execute the code
  console.log("\nExecuting Python code:\n");
  console.log("---------------------------------------------");
  
  const result = await instance.kernel.execute(pythonCode);
  
  console.log("---------------------------------------------");
  console.log(`\nExecution complete with ${events.length} events emitted!`);
  
  // Print event statistics
  const eventCounts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});
  
  console.log("\nEvent statistics:");
  Object.entries(eventCounts).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count} event${count > 1 ? 's' : ''}`);
  });
  
  // Clean up
  await manager.destroyKernel(kernelId);
  console.log("\nKernel destroyed, example complete");
}

// Run the example
runAllEventsExample().catch(err => {
  console.error("Error in ALL events example:", err);
}); 