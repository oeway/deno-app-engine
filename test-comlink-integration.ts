// Test script to verify Comlink integration
// This tests basic communication between managers and workers

// @ts-ignore Import Comlink from Deno
import * as Comlink from "https://deno.land/x/comlink@4.4.1/mod.ts";
import { IKernelWorkerAPI } from "./kernel/worker.ts";
import { ITypeScriptKernelWorkerAPI } from "./kernel/tsWorker.ts";
import { IVectorDBWorkerAPI } from "./vectordb/worker.ts";

console.log("Testing Comlink integration...");

// Test 1: Python Kernel Worker
console.log("\n1. Testing Python Kernel Worker:");
try {
  const pythonWorker = new Worker(
    new URL("./kernel/worker.ts", import.meta.url).href,
    { type: "module" }
  );
  
  const pythonProxy = Comlink.wrap<IKernelWorkerAPI>(pythonWorker);
  
  // Test event callback
  const eventCallback = Comlink.proxy((event: { type: string; data: any }) => {
    console.log(`  [Event] ${event.type}:`, event.data);
  });
  
  await pythonProxy.initialize({}, eventCallback);
  console.log("  ✓ Python kernel initialized");
  
  const isInit = pythonProxy.isInitialized();
  console.log(`  ✓ isInitialized: ${isInit}`);
  
  // Test execution
  const result = await pythonProxy.execute("print('Hello from Python!')");
  console.log("  ✓ Execute result:", result);
  
  // Clean up
  pythonProxy[Comlink.releaseProxy]();
  pythonWorker.terminate();
  
} catch (error) {
  console.error("  ✗ Python kernel test failed:", error);
}

// Test 2: TypeScript Kernel Worker
console.log("\n2. Testing TypeScript Kernel Worker:");
try {
  const tsWorker = new Worker(
    new URL("./kernel/tsWorker.ts", import.meta.url).href,
    { type: "module" }
  );
  
  const tsProxy = Comlink.wrap<ITypeScriptKernelWorkerAPI>(tsWorker);
  
  // Test event callback
  const eventCallback = Comlink.proxy((event: { type: string; data: any }) => {
    console.log(`  [Event] ${event.type}:`, event.data);
  });
  
  await tsProxy.initialize({}, eventCallback);
  console.log("  ✓ TypeScript kernel initialized");
  
  const isInit = tsProxy.isInitialized();
  console.log(`  ✓ isInitialized: ${isInit}`);
  
  // Test execution
  const result = await tsProxy.execute("console.log('Hello from TypeScript!'); 42");
  console.log("  ✓ Execute result:", result);
  
  // Clean up
  tsProxy[Comlink.releaseProxy]();
  tsWorker.terminate();
  
} catch (error) {
  console.error("  ✗ TypeScript kernel test failed:", error);
}

// Test 3: Vector DB Worker
console.log("\n3. Testing Vector DB Worker:");
try {
  const vdbWorker = new Worker(
    new URL("./vectordb/worker.ts", import.meta.url).href,
    { type: "module" }
  );
  
  const vdbProxy = Comlink.wrap<IVectorDBWorkerAPI>(vdbWorker);
  
  await vdbProxy.initialize({ id: "test-db" });
  console.log("  ✓ Vector DB initialized");
  
  // Test adding documents
  const addResult = await vdbProxy.addDocuments([
    {
      id: "doc1",
      text: "Hello world",
      vector: new Array(384).fill(0).map(() => Math.random())
    }
  ]);
  console.log("  ✓ Add documents result:", addResult);
  
  // Test query
  const queryVector = new Array(384).fill(0).map(() => Math.random());
  const queryResult = await vdbProxy.queryIndex(queryVector, { k: 5 });
  console.log("  ✓ Query result:", queryResult);
  
  // Clean up
  vdbProxy[Comlink.releaseProxy]();
  vdbWorker.terminate();
  
} catch (error) {
  console.error("  ✗ Vector DB test failed:", error);
}

console.log("\nComlink integration test completed.");