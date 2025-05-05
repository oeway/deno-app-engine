// Deno Code Interpreter - Main Module
// Exports the Kernel API for use in other projects

import { Kernel, KernelEvents, IKernel, IKernelExecuteOptions, IMessage } from "./kernel/index.ts";

// Re-export the implementations
export { Kernel, KernelEvents };

// Re-export the types
export type { IKernel, IKernelExecuteOptions, IMessage };

// Export a simple factory function for easier kernel instantiation
export function createKernel(): IKernel {
  return new Kernel();
} 