// Worker test for Deno Code Interpreter
// This demonstrates using the kernel in a web worker via Comlink

import * as Comlink from "comlink";
import { KernelEvents } from "./kernel/index.ts";
import type { Kernel } from "./kernel/index.ts";
import { assertEquals, assertExists } from "https://deno.land/std/assert/mod.ts";

// Print header for the test
console.log("Deno Code Interpreter (Worker Test)");
console.log("-----------------------------------");
console.log("Initializing Python kernel in worker...");

// Function to create the worker proxy
async function createKernelWorker() {
  // Create a new worker with the worker.ts file
  const worker = new Worker(new URL("./kernel/worker.ts", import.meta.url).href, {
    type: "module",
  });

  // Create a proxy to the worker using Comlink
  const kernel = Comlink.wrap<Kernel>(worker);
  return { kernel, worker };
}

// Function to cleanly terminate worker
function terminateWorker(worker: Worker) {
  worker.terminate();
}

// Enhanced test suite that thoroughly tests the worker-based kernel
// We focus on direct execution rather than event listeners due to Comlink serialization issues
Deno.test("Worker: Enhanced functionality test", async () => {
  let worker: Worker | null = null;
  
  try {
    // Create the kernel worker
    const result = await createKernelWorker();
    const kernel = result.kernel;
    worker = result.worker;
    
    // Initialize the kernel
    await kernel.initialize();
    
    // Verify initialization
    const initialized = await kernel.isInitialized();
    assertEquals(initialized, true, "Kernel should be initialized");
    
    // 1. Test basic code execution
    console.log("Testing basic execution...");
    const basicExecResult = await kernel.execute("2 + 2");
    assertEquals(basicExecResult.success, true, "Basic execution should succeed");
    assertEquals(
      basicExecResult.result?.payload?.length === 0 && 
      basicExecResult.result?.status === "ok",
      true,
      "Result should have correct structure"
    );
    
    // 2. Test state preservation
    console.log("Testing state preservation...");
    await kernel.execute("x = 42");
    const stateResult = await kernel.execute("x + 8");
    assertEquals(stateResult.success, true, "State preservation should work");
    
    // 3. Test factorial function to verify more complex state preservation
    console.log("Testing more complex state preservation (factorial)...");
    await kernel.execute(`
      def factorial(n):
          if n <= 1:
              return 1
          return n * factorial(n-1)
    `);
    const factorialResult = await kernel.execute("factorial(5)");
    assertEquals(factorialResult.success, true, "Factorial function should execute");
    
    // 4. Test stdout and stderr
    console.log("Testing stdout and stderr...");
    const stdoutResult = await kernel.execute('print("Hello from worker stdout")');
    assertEquals(stdoutResult.success, true, "stdout should execute successfully");
    
    const stderrResult = await kernel.execute('import sys; print("Error message on stderr", file=sys.stderr)');
    assertEquals(stderrResult.success, true, "stderr should execute successfully");
    
    // 5. Test display data (HTML)
    console.log("Testing display data...");
    const displayResult = await kernel.execute('from IPython.display import HTML; HTML("<b>Bold HTML from worker</b>")');
    assertEquals(displayResult.success, true, "Display data should execute successfully");
    
    // 6. Test execution results
    console.log("Testing execution results...");
    const execResult = await kernel.execute('123');
    assertEquals(execResult.success, true, "Execution result should be successful");
    
    // 7. Test error handling
    console.log("Testing error handling...");
    const divByZeroResult = await kernel.execute("1/0");
    assertEquals(divByZeroResult.success, false, "Division by zero should fail");
    assertEquals(
      divByZeroResult.error?.message.includes("ZeroDivisionError"), 
      true, 
      "Error should be ZeroDivisionError"
    );
    
    // 8. Test more complex Python execution
    console.log("Testing complex Python code...");
    
    // Numpy computation
    const numpyResult = await kernel.execute(`
      import numpy as np
      
      # Create a matrix
      matrix = np.array([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
      
      # Calculate eigenvalues
      eigenvalues = np.linalg.eigvals(matrix)
      
      eigenvalues
    `);
    assertEquals(numpyResult.success, true, "Numpy computation should be successful");
    
    // 9. Test matplotlib plotting (just creation, no display checking)
    console.log("Testing matplotlib...");
    const matplotlibResult = await kernel.execute(`
      import matplotlib.pyplot as plt
      import numpy as np
      
      # Create data
      x = np.linspace(0, 10, 100)
      y = np.sin(x)
      
      # Create a figure
      plt.figure(figsize=(8, 6))
      plt.plot(x, y)
      plt.title('Sine Wave')
      plt.xlabel('x')
      plt.ylabel('sin(x)')
      
      # This would normally display in a notebook
      plt.close()
    `);
    assertEquals(matplotlibResult.success, true, "Matplotlib plotting should be successful");
    
    // 10. Test pandas DataFrame
    console.log("Testing pandas...");
    const pandasResult = await kernel.execute(`
      import pandas as pd
      
      # Create a simple DataFrame
      df = pd.DataFrame({
          'A': [1, 2, 3, 4, 5],
          'B': [10, 20, 30, 40, 50],
          'C': [100, 200, 300, 400, 500]
      })
      
      # Calculate some statistics
      df.describe()
    `);
    assertEquals(pandasResult.success, true, "Pandas DataFrame should be successful");
    
    // 11. Test a more complex computation (Monte Carlo Pi estimation)
    console.log("Testing Monte Carlo Pi estimation...");
    const monteCarloResult = await kernel.execute(`
      import numpy as np
      
      # Monte Carlo Pi Estimation
      def estimate_pi(n_samples=10000):
          # Generate random points in a 2x2 square centered at origin
          x = np.random.uniform(-1, 1, n_samples)
          y = np.random.uniform(-1, 1, n_samples)
          
          # Count points inside the unit circle
          inside_circle = (x**2 + y**2) <= 1
          
          # Pi estimation: (points inside circle / total points) * 4
          pi_estimate = 4 * np.sum(inside_circle) / n_samples
          return pi_estimate
      
      # Run estimation with fewer samples for speed
      pi_approx = estimate_pi(1000)
      abs(pi_approx - np.pi) < 0.5  # Should be reasonably close to Pi
    `);
    assertEquals(monteCarloResult.success, true, "Monte Carlo Pi estimation should be successful");
    
    console.log("Worker tests completed successfully");
  } finally {
    // Clean up
    if (worker) {
      terminateWorker(worker);
    }
  }
}); 