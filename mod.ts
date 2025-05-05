// Deno Code Interpreter - Main module exports
// This file exports the public API for the Deno Code Interpreter

import { Kernel, KernelEvents } from './kernel/index.ts';
import type { IKernel, IKernelExecuteOptions, IMessage } from './kernel/index.ts';

// Export the implementations
export { Kernel, KernelEvents };

// Export the types
export type { IKernel, IKernelExecuteOptions, IMessage };

// Export a simple factory function for easier kernel instantiation
export function createKernel(): IKernel {
  return new Kernel();
} 