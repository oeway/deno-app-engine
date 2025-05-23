// Deno App Engine - Main module exports
// This file exports the public API for the Deno App Engine

import { Kernel, KernelEvents } from './kernel/index.ts';
import type { 
  IKernel, 
  IKernelExecuteOptions, 
  IMessage, 
  IKernelOptions, 
  IFilesystemMountOptions 
} from './kernel/index.ts';
import { ensureWheelsExist } from './kernel/check-wheels.ts';
import { KernelManager, KernelMode } from './kernel/manager.ts';
import type { 
  IManagerKernelOptions, 
  IKernelInstance,
  IDenoPermissions
} from './kernel/manager.ts';

// Export the implementations
export { Kernel, KernelEvents, KernelManager, KernelMode };

// Export the types
export type { 
  IKernel, 
  IKernelExecuteOptions, 
  IMessage, 
  IKernelOptions,
  IFilesystemMountOptions,
  IManagerKernelOptions,
  IKernelInstance,
  IDenoPermissions
};

// Export the wheel checking functionality
export { ensureWheelsExist };

// Export a simple factory function for easier kernel instantiation
/**
 * Create a new kernel instance with optional configurations
 * 
 * @param options Options for kernel creation
 * @param options.checkWheels Whether to check and generate wheels before creating the kernel
 * @param options.filesystem Filesystem mounting options
 * @returns Promise resolving to a kernel instance
 * 
 * @example
 * ```ts
 * // Create a kernel with filesystem mounting
 * const kernel = await createKernel({
 *   filesystem: {
 *     enabled: true,
 *     root: ".", // Mount current directory
 *     mountPoint: "/home/pyodide" // Mount point in Pyodide
 *   }
 * });
 * 
 * // Execute Python code that interacts with the filesystem
 * const result = await kernel.execute(`
 * import os
 * files = os.listdir('/home/pyodide')
 * print(f"Files: {files}")
 * `);
 * ```
 */
export async function createKernel(options?: {
  checkWheels?: boolean;
  filesystem?: IFilesystemMountOptions;
}): Promise<IKernel> {
  const { checkWheels = true, filesystem } = options || {};
  
  // Optionally check and generate wheels before creating the kernel
  if (checkWheels) {
    await ensureWheelsExist();
  }
  
  // Create kernel
  const kernel = new Kernel();
  
  // Initialize with provided options
  await kernel.initialize({ filesystem });
  
  return kernel;
}

/**
 * Create a kernel manager with multiple kernel instances
 * 
 * @returns A new KernelManager instance
 * 
 * @example
 * ```ts
 * // Create a kernel manager
 * const manager = createKernelManager();
 * 
 * // Create a kernel with filesystem mounting
 * const kernelId = await manager.createKernel({
 *   mode: KernelMode.MAIN_THREAD,
 *   filesystem: {
 *     enabled: true,
 *     root: ".",
 *     mountPoint: "/home/pyodide"
 *   }
 * });
 * 
 * // Get the kernel instance
 * const kernelInstance = manager.getKernel(kernelId);
 * 
 * // Execute Python code
 * const result = await kernelInstance.kernel.execute(`
 * import os
 * files = os.listdir('/home/pyodide')
 * print(f"Files: {files}")
 * `);
 * 
 * // Destroy the kernel when done
 * await manager.destroyKernel(kernelId);
 * ```
 */
export function createKernelManager(): KernelManager {
  return new KernelManager();
} 