// Simple example demonstrating the Deno Code Interpreter
import { createKernel, KernelEvents } from "../mod.ts";

async function main() {
  console.log("Creating kernel with automatic wheel checking...");
  
  // Create a new kernel instance with wheel checking
  const kernel = await createKernel(true);
  
  // Set up event listeners
  kernel.on(KernelEvents.STREAM, (data) => {
    console.log(`STREAM [${data.name}]: ${data.text}`);
  });
  
  kernel.on(KernelEvents.EXECUTE_RESULT, (data) => {
    console.log(`RESULT: ${JSON.stringify(data.data)}`);
  });
  
  kernel.on(KernelEvents.EXECUTE_ERROR, (data) => {
    console.error(`ERROR: ${data.ename}: ${data.evalue}`);
    console.error(data.traceback.join("\n"));
  });
  
  kernel.on(KernelEvents.DISPLAY_DATA, (data) => {
    console.log(`DISPLAY: ${JSON.stringify(data.data)}`);
  });
  
  // Initialize the kernel
  console.log("Initializing kernel...");
  await kernel.initialize();
  console.log("Kernel initialized successfully");
  
  // Execute some Python code
  console.log("\nRunning: print('Hello, world!')");
  await kernel.execute("print('Hello, world!')");
  
  console.log("\nRunning: 2 + 2");
  await kernel.execute("2 + 2");
  
  console.log("\nRunning: import matplotlib.pyplot as plt");
  await kernel.execute("import matplotlib.pyplot as plt");
  
  console.log("\nRunning: x = [1, 2, 3, 4, 5]; y = [i**2 for i in x]");
  await kernel.execute("x = [1, 2, 3, 4, 5]\ny = [i**2 for i in x]");
  
  console.log("\nRunning: print(f'x = {x}, y = {y}')");
  await kernel.execute("print(f'x = {x}, y = {y}')");
  
  console.log("\nRunning: from IPython.display import HTML");
  await kernel.execute("from IPython.display import HTML");
  
  console.log("\nRunning: HTML('<h1>Hello from HTML</h1>')");
  await kernel.execute("HTML('<h1>Hello from HTML</h1>')");
  
  // Test error handling
  console.log("\nTesting error handling with 1/0");
  try {
    await kernel.execute("1/0");
  } catch (error) {
    console.log("Caught error:", error);
  }
  
  console.log("\nExample completed!");
}

// Run the example
main().catch(console.error); 