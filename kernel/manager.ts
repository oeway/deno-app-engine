// Kernel Manager for Deno Code Interpreter
// This file manages kernel instances in either main thread or worker mode

import * as Comlink from "comlink";
import { EventEmitter } from 'node:events';
import { Kernel, KernelEvents, IKernel } from "./index.ts";

// Execution mode enum
export enum KernelMode {
  MAIN_THREAD = "main_thread",
  WORKER = "worker"
}

// Interface for kernel instance
export interface IKernelInstance {
  id: string;
  kernel: IKernel;
  mode: KernelMode;
  worker?: Worker;
  destroy(): Promise<void>;
}

// Interface for kernel creation options
export interface IKernelOptions {
  id?: string;
  mode?: KernelMode;
}

// Helper type for listener management
type ListenerWrapper = {
  original: (data: any) => void;
  wrapped: (event: { kernelId: string, data: any }) => void;
};

/**
 * KernelManager class manages multiple kernel instances 
 * in either main thread or worker mode
 */
export class KernelManager extends EventEmitter {
  private kernels: Map<string, IKernelInstance> = new Map();
  // Track listeners for each kernel to enable individual removal
  private listeners: Map<string, Map<string, Map<Function, ListenerWrapper>>> = new Map();
  
  constructor() {
    super();
    super.setMaxListeners(100); // Allow many listeners for kernel events
  }
  
  
  /**
   * Create a new kernel instance
   * @param options Options for creating the kernel
   * @returns Promise resolving to the kernel instance ID
   */
  public async createKernel(options: IKernelOptions = {}): Promise<string> {
    const id = options.id || crypto.randomUUID();
    const mode = options.mode || KernelMode.WORKER;
    
    // Check if kernel with this ID already exists
    if (this.kernels.has(id)) {
      throw new Error(`Kernel with ID ${id} already exists`);
    }
    
    // Create the appropriate kernel instance
    let instance: IKernelInstance;
    
    if (mode === KernelMode.MAIN_THREAD) {
      instance = await this.createMainThreadKernel(id);
    } else {
      instance = await this.createWorkerKernel(id);
    }
    
    // Store the kernel instance
    this.kernels.set(id, instance);
    
    // Forward kernel events to manager
    this.setupEventForwarding(instance);
    
    return id;
  }
  
  /**
   * Create a kernel instance running in the main thread
   * @param id Kernel ID
   * @returns Kernel instance
   */
  private async createMainThreadKernel(id: string): Promise<IKernelInstance> {
    const kernel = new Kernel();
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel,
      mode: KernelMode.MAIN_THREAD,
      destroy: async () => {
        // Nothing special to do for main thread kernel
        return Promise.resolve();
      }
    };
    
    return instance;
  }
  
  /**
   * Create a kernel instance running in a worker
   * @param id Kernel ID
   * @returns Kernel instance
   */
  private async createWorkerKernel(id: string): Promise<IKernelInstance> {
    // Create a new worker
    const worker = new Worker(new URL("./worker.ts", import.meta.url).href, {
      type: "module",
    });
    
    // Create a message channel for events
    const { port1, port2 } = new MessageChannel();
    
    // Send the port to the worker
    worker.postMessage({ type: "SET_EVENT_PORT", port: port2 }, [port2]);
    
    // Create a proxy to the worker using Comlink
    const kernelProxy = Comlink.wrap(worker);
    
    // Add a local event handler to bridge the worker events
    // This works around the limitation that Comlink doesn't proxy event emitters
    const eventHandler = (event: MessageEvent) => {
      if (event.data && event.data.type) {
        // Emit the event from the manager with kernel ID
        super.emit(event.data.type, {
          kernelId: id,
          data: event.data.data
        });
      }
    };
    
    // Listen for events from the worker
    port1.addEventListener('message', eventHandler);
    port1.start();
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel: kernelProxy as unknown as IKernel, // Cast to IKernel
      mode: KernelMode.WORKER,
      worker,
      destroy: async () => {
        // Clean up the worker and event listeners
        port1.removeEventListener('message', eventHandler);
        port1.close();
        worker.terminate();
        return Promise.resolve();
      }
    };
    
    return instance;
  }
  
  /**
   * Setup event forwarding from kernel to manager
   * @param instance Kernel instance
   */
  private setupEventForwarding(instance: IKernelInstance): void {
    // Only needed for main thread kernels as worker events are handled directly
    if (instance.mode === KernelMode.MAIN_THREAD) {
      // Forward all kernel events to the manager with kernel ID
      Object.values(KernelEvents).forEach((eventType) => {
        (instance.kernel as EventEmitter).on(eventType, (data: any) => {
          super.emit(eventType, {
            kernelId: instance.id,
            data
          });
        });
      });
    }
  }
  
  /**
   * Get a kernel instance by ID
   * @param id Kernel ID
   * @returns Kernel instance or undefined if not found
   */
  public getKernel(id: string): IKernelInstance | undefined {
    return this.kernels.get(id);
  }
  
  /**
   * Get a list of all kernel IDs
   * @returns Array of kernel IDs
   */
  public getKernelIds(): string[] {
    return Array.from(this.kernels.keys());
  }
  
  /**
   * Destroy a kernel instance
   * @param id Kernel ID
   * @returns Promise resolving when kernel is destroyed
   */
  public async destroyKernel(id: string): Promise<void> {
    const instance = this.kernels.get(id);
    
    if (!instance) {
      throw new Error(`Kernel with ID ${id} not found`);
    }
    
    // Remove all event listeners for this kernel
    this.removeAllKernelListeners(id);
    
    // Destroy the kernel instance
    await instance.destroy();
    
    // Remove the kernel from the map
    this.kernels.delete(id);
  }
  
  /**
   * Destroy all kernel instances
   * @returns Promise resolving when all kernels are destroyed
   */
  public async destroyAll(): Promise<void> {
    const ids = this.getKernelIds();
    
    // Destroy all kernels
    await Promise.all(ids.map(id => this.destroyKernel(id)));
  }
  
  /**
   * Register an event listener for a specific kernel's events
   * @param kernelId Kernel ID
   * @param eventType Event type
   * @param listener Event listener
   */
  public onKernelEvent(kernelId: string, eventType: KernelEvents, listener: (data: any) => void): void {
    // Check if kernel exists
    if (!this.kernels.has(kernelId)) {
      throw new Error(`Kernel with ID ${kernelId} not found`);
    }
    
    // Create wrapper that filters events for this specific kernel
    const wrapper: ListenerWrapper = {
      original: listener,
      wrapped: (event: { kernelId: string, data: any }) => {
        if (event.kernelId === kernelId) {
          listener(event.data);
        }
      }
    };
    
    // Store the wrapper for later removal
    this.storeListener(kernelId, eventType, listener, wrapper);
    
    // Add the wrapped listener to the manager
    super.on(eventType, wrapper.wrapped);
  }
  
  /**
   * Remove an event listener for a specific kernel
   * @param kernelId Kernel ID
   * @param eventType Event type
   * @param listener Event listener
   */
  public offKernelEvent(kernelId: string, eventType: KernelEvents, listener: (data: any) => void): void {
    const wrapper = this.getListener(kernelId, eventType, listener);
    
    if (wrapper) {
      // Remove the wrapped listener from the manager
      super.removeListener(eventType, wrapper.wrapped);
      
      // Remove the wrapper from our tracking map
      this.removeStoredListener(kernelId, eventType, listener);
    }
  }
  
  /**
   * Store a listener wrapper for later removal
   */
  private storeListener(
    kernelId: string, 
    eventType: string, 
    original: Function, 
    wrapper: ListenerWrapper
  ): void {
    // Get or create kernel map
    if (!this.listeners.has(kernelId)) {
      this.listeners.set(kernelId, new Map());
    }
    const kernelMap = this.listeners.get(kernelId)!;
    
    // Get or create event type map
    if (!kernelMap.has(eventType)) {
      kernelMap.set(eventType, new Map());
    }
    const eventMap = kernelMap.get(eventType)!;
    
    // Store the wrapper
    eventMap.set(original, wrapper);
  }
  
  /**
   * Get a stored listener wrapper
   */
  private getListener(
    kernelId: string, 
    eventType: string, 
    original: Function
  ): ListenerWrapper | undefined {
    const kernelMap = this.listeners.get(kernelId);
    if (!kernelMap) return undefined;
    
    const eventMap = kernelMap.get(eventType);
    if (!eventMap) return undefined;
    
    return eventMap.get(original);
  }
  
  /**
   * Remove a stored listener wrapper
   */
  private removeStoredListener(
    kernelId: string, 
    eventType: string, 
    original: Function
  ): void {
    const kernelMap = this.listeners.get(kernelId);
    if (!kernelMap) return;
    
    const eventMap = kernelMap.get(eventType);
    if (!eventMap) return;
    
    // Remove the listener
    eventMap.delete(original);
    
    // Clean up empty maps
    if (eventMap.size === 0) {
      kernelMap.delete(eventType);
    }
    
    if (kernelMap.size === 0) {
      this.listeners.delete(kernelId);
    }
  }
  
  /**
   * Remove all listeners for a specific kernel
   */
  private removeAllKernelListeners(kernelId: string): void {
    const kernelMap = this.listeners.get(kernelId);
    if (!kernelMap) return;
    
    // For each event type
    for (const [eventType, eventMap] of kernelMap.entries()) {
      // For each original listener
      for (const wrapper of eventMap.values()) {
        // Remove the wrapped listener from the manager
        super.removeListener(eventType, wrapper.wrapped);
      }
    }
    
    // Clear the kernel's listener map
    this.listeners.delete(kernelId);
  }
  
  /**
   * Get all listeners for a specific kernel and event type
   * @param kernelId Kernel ID
   * @param eventType Event type
   * @returns Array of listeners
   */
  public getListeners(kernelId: string, eventType: KernelEvents): ((data: any) => void)[] {
    const kernelMap = this.listeners.get(kernelId);
    if (!kernelMap) return [];
    
    const eventMap = kernelMap.get(eventType);
    if (!eventMap) return [];
    
    // Return all original listeners (not wrapped)
    return Array.from(eventMap.values()).map(wrapper => wrapper.original);
  }
} 