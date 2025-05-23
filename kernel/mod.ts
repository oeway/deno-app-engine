// Main entry point for the Deno App Engine kernel module
// This file exports the public API

// Export the kernel core components
export { Kernel, KernelEvents, type IEventData, type IKernelOptions } from "./index.ts";

// Export the kernel manager and related types
export { 
  KernelManager, 
  KernelMode,
  KernelLanguage,
  type IKernelInstance,
  type IKernelManagerOptions
} from "./manager.ts";

// Export other interfaces
export { 
  type IKernel, 
  type IKernelExecuteOptions,
  type IMessage
} from "./index.ts";

// Create and export a default manager instance
import { KernelManager } from "./manager.ts";
export const defaultManager = new KernelManager(); 