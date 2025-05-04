// Main entry point for the Deno Code Interpreter
// Exports the public API for the kernel

import { kernel, Kernel, KernelEvents } from "./kernel/index.ts";

export {
  kernel,
  Kernel,
  KernelEvents
};

// Re-export the singleton kernel as default
export default kernel; 