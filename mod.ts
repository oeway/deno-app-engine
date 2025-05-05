// Deno Code Interpreter - Main module exports
// This file exports the public API for the Deno Code Interpreter

import { Kernel, KernelEvents } from './kernel/index.ts';
import type { IKernel, IKernelExecuteOptions, IMessage } from './kernel/index.ts';
import { ensureWheelsExist } from './kernel/check-wheels.ts';

// Export the implementations
export { Kernel, KernelEvents };

// Export the types
export type { IKernel, IKernelExecuteOptions, IMessage };

// Export the wheel checking functionality
export { ensureWheelsExist };

// Export a simple factory function for easier kernel instantiation
export async function createKernel(checkWheels = true): Promise<IKernel> {
  // Optionally check and generate wheels before creating the kernel
  if (checkWheels) {
    await ensureWheelsExist();
  }
  return new Kernel();
} 