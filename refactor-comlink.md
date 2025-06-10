# Refactor: Use Comlink for Elegant Worker Communication

## Summary

This PR refactors the kernel and vector database managers to use Comlink (https://deno.land/x/comlink@4.4.1) for all worker communication, replacing the ad-hoc event listener system with a more elegant, robust, and scalable solution.

## Changes Made

### 1. Updated Imports
- Changed from npm Comlink to Deno's Comlink module (`https://deno.land/x/comlink@4.4.1/mod.ts`)
- Added proper TypeScript interfaces for worker APIs

### 2. Kernel System Refactoring

#### `kernel/worker.ts`
- Refactored to expose a clean `IKernelWorkerAPI` interface
- Replaced message passing with a class-based API (`KernelWorker`)
- Event forwarding now uses a callback function passed during initialization
- Simplified error handling and interrupt management

#### `kernel/tsWorker.ts`
- Refactored to expose `ITypeScriptKernelWorkerAPI` interface
- Implemented `TypeScriptKernelWorker` class with clean API
- Event forwarding uses callback pattern instead of MessagePort

#### `kernel/manager.ts`
- Updated `createWorkerKernel` to use `Comlink.wrap()` for creating worker proxies
- Replaced MessageChannel/MessagePort with Comlink proxy callbacks
- Simplified pool kernel setup using the same proxy approach
- Removed the complex `interruptWorkerKernelFallback` method (no longer needed)
- Interrupt handling now uses the proxy's `interrupt()` method directly

### 3. Vector Database System Refactoring

#### `vectordb/worker.ts`
- Refactored to expose `IVectorDBWorkerAPI` interface
- Implemented `VectorDBWorker` class with async methods returning result objects
- Removed all message passing in favor of direct method calls

#### `vectordb/manager.ts`
- Updated all worker communication to use Comlink proxies
- Removed `setupEventForwarding` method (no longer needed)
- Simplified all async operations:
  - `resumeFromOffload`: Direct proxy method calls
  - `createIndex`: Clean initialization with proxy
  - `addDocuments`: Simple proxy call with result handling
  - `queryIndex`: Direct query execution via proxy
  - `removeDocuments`: Straightforward document removal
  - `offloadInstance`: Simple document retrieval for offloading

## Benefits

1. **Type Safety**: Full TypeScript support with proper interfaces for all worker APIs
2. **Cleaner Code**: Removed complex event listener management and promise wrappers
3. **Better Error Handling**: Errors propagate naturally through async/await
4. **Scalability**: Easy to add new methods to worker APIs without boilerplate
5. **Maintainability**: Worker communication is now straightforward and debuggable
6. **Performance**: Reduced overhead from event listener management

## Migration Notes

- All functionality remains the same from the user's perspective
- The change is purely internal, improving code quality and maintainability
- Event emission for monitoring purposes is preserved where needed

## Testing

All existing tests should continue to pass as the external API remains unchanged. The refactoring only affects internal communication patterns.

## Future Improvements

With Comlink in place, we can now easily:
- Add streaming support for large data transfers
- Implement progress callbacks for long-running operations
- Add more sophisticated worker pooling strategies
- Implement worker-to-worker communication if needed