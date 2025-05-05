// Deno Code Interpreter - Main Entry Point
// This demonstrates a simple example of using the kernel to execute Python code

import { Kernel, KernelEvents } from "./mod.ts";

const kernel = new Kernel();
// Set up event listeners
kernel.on(KernelEvents.EXECUTE_RESULT, (result) => {
  console.log("\nResult:", result.data["text/plain"]);
  
  // Also display HTML if available
  if (result.data["text/html"]) {
    console.log("HTML result available");
  }
});

kernel.on(KernelEvents.STREAM, (stream) => {
  if (stream.name === "stdout") {
    Deno.stdout.writeSync(new TextEncoder().encode(stream.text));
  } else if (stream.name === "stderr") {
    Deno.stderr.writeSync(new TextEncoder().encode(stream.text));
  }
});

kernel.on(KernelEvents.EXECUTE_ERROR, (error) => {
  console.error(`\nError (${error.ename}): ${error.evalue}`);
});

async function main() {
  console.log("Deno Code Interpreter");
  console.log("--------------------");
  console.log("Initializing Python kernel...");
  
  try {
    // Initialize the kernel
    await kernel.initialize();
    console.log("Kernel initialized successfully!");
    
    // Run some basic Python examples
    console.log("\nExample 1: Basic calculation");
    await kernel.execute("2 + 3");
    
    console.log("\nExample 2: Variable assignment and reuse");
    await kernel.execute(`
x = 42
y = "hello"
print(f"{y}, the answer is {x}")
`);
    
    console.log("\nExample 3: Handling errors");
    await kernel.execute("1/0");
    
    console.log("\nDeno Code Interpreter ready to use!");
  } catch (error) {
    console.error("Failed to initialize the kernel:", error);
  }
}

// Run the main function when this file is run directly
main().catch(console.error);
