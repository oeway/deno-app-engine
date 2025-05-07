// Kernel Manager for Deno Code Interpreter
// This file manages kernel instances in either main thread or worker mode

import * as Comlink from "comlink";
import { EventEmitter } from 'node:events';
// import EventEmitter from "https://deno.land/x/events@v1.0.0/mod.ts";
import { Kernel, KernelEvents, IKernel, IKernelOptions, IFilesystemMountOptions } from "./index.ts";

// Execution mode enum
export enum KernelMode {
  MAIN_THREAD = "main_thread",
  WORKER = "worker"
}

// Extended WorkerOptions interface to include Deno permissions
interface WorkerOptions {
  type?: "classic" | "module";
  name?: string;
  deno?: {
    permissions?: IDenoPermissions;
  };
}

// Interface for kernel instance
export interface IKernelInstance {
  id: string;
  kernel: IKernel;
  mode: KernelMode;
  worker?: Worker;
  created: Date;
  options: IManagerKernelOptions;
  destroy(): Promise<void>;
}

// Interface for Deno worker permissions
export interface IDenoPermissions {
  read?: (string | URL)[];
  write?: (string | URL)[];
  net?: string[];
  env?: string[];
  run?: string[];
  ffi?: string[];
  hrtime?: boolean;
}

// Interface for kernel creation options
export interface IManagerKernelOptions {
  id?: string;
  mode?: KernelMode;
  deno?: {
    permissions?: IDenoPermissions;
  };
  filesystem?: IFilesystemMountOptions;
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
  private listenerWrappers: Map<string, Map<string, Map<Function, ListenerWrapper>>> = new Map();
  
  constructor() {
    super();
    super.setMaxListeners(100); // Allow many listeners for kernel events
  }
  
  
  /**
   * Create a new kernel instance
   * @param options Options for creating the kernel
   * @param options.id Optional custom ID for the kernel
   * @param options.mode Optional kernel mode (main_thread or worker)
   * @param options.deno.permissions Optional Deno permissions for worker mode
   * @param options.filesystem Optional filesystem mounting options
   * @returns Promise resolving to the kernel instance ID
   */
  public async createKernel(options: IManagerKernelOptions = {}): Promise<string> {
    const id = options.id || crypto.randomUUID();
    const mode = options.mode || KernelMode.WORKER;
    
    // Check if kernel with this ID already exists
    if (this.kernels.has(id)) {
      throw new Error(`Kernel with ID ${id} already exists`);
    }
    
    // Store options temporarily to be used in createWorkerKernel
    const tempInstance = {
      id,
      options,
      mode
    };
    this.kernels.set(id, tempInstance as unknown as IKernelInstance);
    
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
    // Get options from the temporary instance
    const options = this.kernels.get(id)?.options || {};
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel,
      mode: KernelMode.MAIN_THREAD,
      created: new Date(),
      options,
      destroy: async () => {
        // Nothing special to do for main thread kernel
        return Promise.resolve();
      }
    };
    
    // Initialize the kernel with filesystem options
    const kernelOptions: IKernelOptions = {};
    
    // Add filesystem options if provided
    if (options.filesystem) {
      kernelOptions.filesystem = options.filesystem;
    }
    
    // Initialize the kernel
    await kernel.initialize(kernelOptions);
    
    return instance;
  }
  
  /**
   * Create a kernel instance running in a worker
   * @param id Kernel ID
   * @returns Kernel instance
   */
  private async createWorkerKernel(id: string): Promise<IKernelInstance> {
    // Get permissions from options when creating the kernel
    const options = this.kernels.get(id)?.options || {};
    
    // Create a new worker with optional permissions
    const workerOptions: WorkerOptions = {
      type: "module",
    };
    
    // If Deno permissions are provided, use them.
    // Otherwise don't specify Deno permissions at all to inherit from host script
    if (options.deno?.permissions) {
      workerOptions.deno = {
        permissions: options.deno.permissions
      };
      
      console.log(`Creating worker with custom permissions: ${JSON.stringify(options.deno.permissions)}`);
    } else {
      // Don't set any deno options to inherit host permissions
      console.log("Creating worker with inherited host permissions");
    }
    
    // Create worker with permissions
    const worker = new Worker(
      new URL("./worker.ts", import.meta.url).href,
      workerOptions
    );
    
    // Create a message channel for events
    const { port1, port2 } = new MessageChannel();
    
    // Create a promise that will resolve when the kernel is initialized
    const initPromise = new Promise<void>((resolve, reject) => {
      const initHandler = (event: MessageEvent) => {
        if (event.data?.type === "KERNEL_INITIALIZED") {
          if (event.data.data.success) {
            port1.removeEventListener('message', initHandler);
            resolve();
          } else {
            port1.removeEventListener('message', initHandler);
            reject(new Error("Kernel initialization failed"));
          }
        }
      };
      port1.addEventListener('message', initHandler);
    });
    
    // Send the port to the worker
    worker.postMessage({ type: "SET_EVENT_PORT", port: port2 }, [port2]);
    
    // Create a proxy to the worker using Comlink
    const kernelProxy = Comlink.wrap(worker);
    
    // Add a local event handler to bridge the worker events
    // This works around the limitation that Comlink doesn't proxy event emitters
    const eventHandler = (event: MessageEvent) => {
      if (event.data && event.data.type) {
        // Emit the event from the manager with kernel ID
        // This structure matches the setupEventForwarding method for main thread kernels
        super.emit(event.data.type, {
          kernelId: id,
          data: event.data.data
        });
      }
    };
    
    // Listen for events from the worker
    port1.addEventListener('message', eventHandler);
    port1.start();
    
    // Initialize the kernel with filesystem options
    // We need to pass these options to the worker
    worker.postMessage({
      type: "INITIALIZE_KERNEL",
      options: {
        filesystem: options.filesystem
      }
    });
    
    // Wait for kernel initialization
    await initPromise;
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel: kernelProxy as unknown as IKernel, // Cast to IKernel
      mode: KernelMode.WORKER,
      worker,
      created: new Date(),
      options, // Store the options for reference
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
        // Access the kernel as a Kernel instance which extends EventEmitter
        const kernelEmitter = instance.kernel as unknown as EventEmitter;
        
        // Add event listener to forward events
        kernelEmitter.on(eventType, (data: any) => {
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
   * Get a list of all kernels with their details
   * @returns Array of kernel information objects
   */
  public listKernels(): Array<{
    id: string;
    mode: KernelMode;
    status: "active" | "busy" | "unknown";
    created: Date;
    deno?: {
      permissions?: IDenoPermissions;
    };
  }> {
    return Array.from(this.kernels.entries()).map(([id, instance]) => {
      return {
        id,
        mode: instance.mode,
        status: instance.kernel.status || "unknown",
        created: instance.created || new Date(),
        deno: instance.options?.deno
      };
    });
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
          // Pass just the data to the listener
          // The data structure is consistent across main thread and worker modes
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
    if (!this.listenerWrappers.has(kernelId)) {
      this.listenerWrappers.set(kernelId, new Map());
    }
    const kernelMap = this.listenerWrappers.get(kernelId)!;
    
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
    const kernelMap = this.listenerWrappers.get(kernelId);
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
    const kernelMap = this.listenerWrappers.get(kernelId);
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
      this.listenerWrappers.delete(kernelId);
    }
  }
  
  /**
   * Remove all listeners for a specific kernel
   */
  private removeAllKernelListeners(kernelId: string): void {
    const kernelMap = this.listenerWrappers.get(kernelId);
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
    this.listenerWrappers.delete(kernelId);
  }
  
  /**
   * Get all listeners for a specific kernel and event type
   * @param kernelId Kernel ID
   * @param eventType Event type
   * @returns Array of listeners
   */
  public getListeners(kernelId: string, eventType: KernelEvents): ((data: any) => void)[] {
    const kernelListeners = this.listenerWrappers.get(kernelId);
    if (!kernelListeners) {
      return [];
    }
    
    const eventListeners = kernelListeners.get(eventType);
    if (!eventListeners) {
      return [];
    }
    
    return Array.from(eventListeners.keys()) as ((data: any) => void)[];
  }

  /**
   * Execute Python code with streaming output
   * This method works in both main thread and worker modes
   * @param kernelId ID of the kernel to use
   * @param code The Python code to execute
   * @param parent Optional parent message header
   * @returns AsyncGenerator yielding intermediate outputs
   */
  public async* executeStream(
    kernelId: string, 
    code: string, 
    parent: any = {}
  ): AsyncGenerator<any, { success: boolean, result?: any, error?: Error }, void> {
    const instance = this.getKernel(kernelId);
    
    if (!instance) {
      throw new Error(`Kernel with ID ${kernelId} not found`);
    }
    
    // For main thread kernels, we can use the executeStream method directly
    if (instance.mode === KernelMode.MAIN_THREAD) {
      const kernel = instance.kernel as unknown as { 
        executeStream: (code: string, parent: any) => AsyncGenerator<any, any, void> 
      };
      
      // Forward to the kernel's executeStream method
      if (typeof kernel.executeStream === 'function') {
        yield* kernel.executeStream(code, parent);
        return { success: true };
      }
    }
    
    // For worker mode, we need to implement streaming via events
    try {
      // Setup queue for storing events
      const streamQueue: any[] = [];
      let executionComplete = false;
      let executionResult: { success: boolean, result?: any, error?: Error } | null = null;
      
      // Set up a promise that will resolve when execution completes
      const executionPromise = new Promise<{ success: boolean, result?: any, error?: Error }>((resolve) => {
        // Create event handlers
        const handleStreamEvent = (event: { kernelId: string, data: any }) => {
          if (event.kernelId === kernelId) {
            streamQueue.push({
              type: 'stream',
              data: event.data
            });
          }
        };
        
        const handleDisplayEvent = (event: { kernelId: string, data: any }) => {
          if (event.kernelId === kernelId) {
            streamQueue.push({
              type: 'display_data',
              data: event.data
            });
          }
        };
        
        const handleResultEvent = (event: { kernelId: string, data: any }) => {
          if (event.kernelId === kernelId) {
            streamQueue.push({
              type: 'execute_result',
              data: {
                execution_count: event.data.execution_count,
                data: event.data.data,
                metadata: event.data.metadata
              }
            });
          }
        };
        
        const handleErrorEvent = (event: { kernelId: string, data: any }) => {
          if (event.kernelId === kernelId) {
            streamQueue.push({
              type: 'execute_error',
              data: event.data
            });
            
            // Store the error for the final result
            executionResult = {
              success: false,
              error: new Error(`${event.data.ename}: ${event.data.evalue}`),
              result: event.data
            };
          }
        };
        
        // Register all the event handlers
        super.on(KernelEvents.STREAM, handleStreamEvent);
        super.on(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
        super.on(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
        super.on(KernelEvents.EXECUTE_RESULT, handleResultEvent);
        super.on(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
        
        // Execute the code
        // We need to wait for the execution to complete before returning the result
        instance.kernel.execute(code, parent).then((result) => {
          executionComplete = true;
          executionResult = result;
          
          // Cleanup event handlers
          super.off(KernelEvents.STREAM, handleStreamEvent);
          super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
          super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
          super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
          super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
          
          resolve(result);
        }).catch((error) => {
          executionComplete = true;
          const errorResult = {
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          };
          executionResult = errorResult;
          
          // Cleanup event handlers
          super.off(KernelEvents.STREAM, handleStreamEvent);
          super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
          super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
          super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
          super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
          
          resolve(errorResult);
        });
      });
      
      // Setup timeout
      const startTime = Date.now();
      const timeout = 60000; // 60 second timeout
      
      // Monitor the stream queue and yield results
      while ((!executionComplete || streamQueue.length > 0) && 
             (Date.now() - startTime < timeout)) {
        // If there are items in the queue, yield them
        if (streamQueue.length > 0) {
          const event = streamQueue.shift();
          yield event;
          continue;
        }
        
        // If no more events but execution is not complete, wait a little
        if (!executionComplete) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      
      // Handle timeout
      if (!executionComplete && Date.now() - startTime >= timeout) {
        console.log("Execution timed out");
        return {
          success: false,
          error: new Error("Execution timed out")
        };
      }
      
      // Wait for the final result
      const result = await executionPromise;
      return result;
    } catch (error) {
      console.error("Error in executeStream:", error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
} 