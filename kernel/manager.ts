// Kernel Manager for Deno Code Interpreter
// This file manages kernel instances in either main thread or worker mode

import * as Comlink from "comlink";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
// import EventEmitter from "https://deno.land/x/events@v1.0.0/mod.ts";
import { Kernel, KernelEvents, IKernel, IKernelOptions, IFilesystemMountOptions, TypeScriptKernel } from "./index.ts";

// Execution mode enum
export enum KernelMode {
  MAIN_THREAD = "main_thread",
  WORKER = "worker"
}

// Kernel language enum
export enum KernelLanguage {
  PYTHON = "python",
  TYPESCRIPT = "typescript"
}

// Extended WorkerOptions interface to include Deno permissions
interface WorkerOptions {
  type?: "classic" | "module";
  name?: string;
  deno?: {
    permissions?: IDenoPermissions;
  };
}

// Interface for kernel pool configuration
export interface IKernelPoolConfig {
  enabled: boolean;
  poolSize: number; // Number of kernels to keep ready per configuration
  autoRefill: boolean; // Whether to automatically refill the pool when kernels are taken
  preloadConfigs: Array<{
    mode: KernelMode;
    language: KernelLanguage;
  }>; // Configurations to preload in the pool
}

// Interface for kernel manager options
export interface IKernelManagerOptions {
  pool?: IKernelPoolConfig;
  allowedKernelTypes?: Array<{
    mode: KernelMode;
    language: KernelLanguage;
  }>; // Restrict which kernel types can be created
}

// Interface for kernel instance
export interface IKernelInstance {
  id: string;
  kernel: IKernel;
  mode: KernelMode;
  language: KernelLanguage;
  worker?: Worker;
  created: Date;
  options: IManagerKernelOptions;
  isFromPool?: boolean; // Track if this kernel came from the pool
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
  lang?: KernelLanguage;
  namespace?: string;
  deno?: {
    permissions?: IDenoPermissions;
  };
  filesystem?: IFilesystemMountOptions;
  inactivityTimeout?: number; // Time in milliseconds after which an inactive kernel will be shut down
  maxExecutionTime?: number; // Maximum time in milliseconds a single execution can run before considered stuck/dead
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
  // Track last activity time for each kernel
  private lastActivityTime: Map<string, number> = new Map();
  // Store inactivity timers for each kernel
  private inactivityTimers: Map<string, number> = new Map();
  // Track ongoing executions for each kernel
  private ongoingExecutions: Map<string, Set<string>> = new Map();
  // Track execution timeouts for detecting stuck/dead kernels
  private executionTimeouts: Map<string, Map<string, number>> = new Map();
  
  // Pool management
  private pool: Map<string, IKernelInstance[]> = new Map();
  private poolConfig: IKernelPoolConfig;
  private isPreloading: boolean = false;
  
  // Allowed kernel types configuration
  private allowedKernelTypes: Array<{
    mode: KernelMode;
    language: KernelLanguage;
  }>;
  
  constructor(options: IKernelManagerOptions = {}) {
    super();
    super.setMaxListeners(100); // Allow many listeners for kernel events
    
    // Set default allowed kernel types (worker mode only for security)
    this.allowedKernelTypes = options.allowedKernelTypes || [
      { mode: KernelMode.WORKER, language: KernelLanguage.PYTHON },
      { mode: KernelMode.WORKER, language: KernelLanguage.TYPESCRIPT }
    ];
    
    // Initialize pool configuration with defaults based on allowed types
    const defaultPreloadConfigs = this.allowedKernelTypes.filter(type => 
      type.language === KernelLanguage.PYTHON // Only preload Python kernels by default
    );
    
    this.poolConfig = {
      enabled: false,
      poolSize: 2,
      autoRefill: true,
      preloadConfigs: defaultPreloadConfigs,
      ...options.pool
    };
    
    // Validate that pool preload configs are within allowed types
    if (this.poolConfig.preloadConfigs) {
      this.poolConfig.preloadConfigs = this.poolConfig.preloadConfigs.filter(config => {
        const isAllowed = this.isKernelTypeAllowed(config.mode, config.language);
        if (!isAllowed) {
          console.warn(`Pool preload config ${config.mode}-${config.language} is not in allowedKernelTypes, skipping`);
        }
        return isAllowed;
      });
    }
    
    // Start preloading if pool is enabled
    if (this.poolConfig.enabled) {
      this.preloadPool().catch(error => {
        console.error("Error preloading kernel pool:", error);
      });
    }
  }
  
  
  /**
   * Generate a pool key for a given mode and language combination
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns Pool key string
   * @private
   */
  private getPoolKey(mode: KernelMode, language: KernelLanguage): string {
    return `${mode}-${language}`;
  }
  
  /**
   * Get a kernel from the pool if available
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns Kernel instance or null if none available
   * @private
   */
  private getFromPool(mode: KernelMode, language: KernelLanguage): IKernelInstance | null {
    if (!this.poolConfig.enabled) {
      return null;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    const poolKernels = this.pool.get(poolKey);
    
    if (!poolKernels || poolKernels.length === 0) {
      return null;
    }
    
    // Remove and return the first kernel from the pool
    const kernel = poolKernels.shift()!;
    
    // Mark as taken from pool
    kernel.isFromPool = true;
    
    // Trigger background refill if auto-refill is enabled
    if (this.poolConfig.autoRefill) {
      setTimeout(() => {
        this.refillPool(mode, language).catch(error => {
          console.error(`Error refilling pool for ${poolKey}:`, error);
        });
      }, 0);
    }
    
    return kernel;
  }
  
  /**
   * Add a kernel to the pool
   * @param mode Kernel mode
   * @param language Kernel language
   * @param kernel Kernel instance
   * @private
   */
  private addToPool(mode: KernelMode, language: KernelLanguage, kernel: IKernelInstance): void {
    if (!this.poolConfig.enabled) {
      return;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    
    if (!this.pool.has(poolKey)) {
      this.pool.set(poolKey, []);
    }
    
    const poolKernels = this.pool.get(poolKey)!;
    
    // Only add if we haven't reached the pool size limit
    if (poolKernels.length < this.poolConfig.poolSize) {
      poolKernels.push(kernel);
    } else {
      // Pool is full, destroy the excess kernel
      kernel.destroy().catch(error => {
        console.error("Error destroying excess pool kernel:", error);
      });
    }
  }
  
  /**
   * Refill the pool for a specific configuration
   * @param mode Kernel mode
   * @param language Kernel language
   * @private
   */
  private async refillPool(mode: KernelMode, language: KernelLanguage): Promise<void> {
    if (!this.poolConfig.enabled) {
      return;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    const poolKernels = this.pool.get(poolKey) || [];
    const needed = this.poolConfig.poolSize - poolKernels.length;
    
    if (needed <= 0) {
      return;
    }
    
    console.log(`Refilling pool for ${poolKey}, creating ${needed} kernel(s)`);
    
    // Create kernels one by one to avoid overwhelming the system
    for (let i = 0; i < needed; i++) {
      try {
        const poolKernel = await this.createPoolKernel(mode, language);
        this.addToPool(mode, language, poolKernel);
      } catch (error) {
        console.error(`Error creating pool kernel for ${poolKey}:`, error);
        // Continue trying to create other kernels
      }
    }
  }
  
  /**
   * Create a kernel specifically for the pool
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns Kernel instance
   * @private
   */
  private async createPoolKernel(mode: KernelMode, language: KernelLanguage): Promise<IKernelInstance> {
    // Generate a temporary ID for the pool kernel
    const tempId = `pool-${crypto.randomUUID()}`;
    
    // Create kernel with minimal configuration
    const options: IManagerKernelOptions = {
      mode,
      lang: language
    };
    
    // Store options temporarily - but don't store incomplete instance in kernels map
    // Instead, we'll pass the options directly to the creation methods
    let instance: IKernelInstance;
    
    try {
      if (mode === KernelMode.MAIN_THREAD) {
        // For main thread, we need to temporarily store the instance for createMainThreadKernel
        const tempInstance = {
          id: tempId,
          options,
          mode,
          language
        };
        this.kernels.set(tempId, tempInstance as unknown as IKernelInstance);
        
        try {
          instance = await this.createMainThreadKernel(tempId);
        } finally {
          // Always clean up the temporary instance
          this.kernels.delete(tempId);
        }
      } else {
        // For worker mode, we need to temporarily store the instance for createWorkerKernel
        const tempInstance = {
          id: tempId,
          options,
          mode,
          language
        };
        this.kernels.set(tempId, tempInstance as unknown as IKernelInstance);
        
        try {
          instance = await this.createWorkerKernel(tempId);
        } finally {
          // Always clean up the temporary instance
          this.kernels.delete(tempId);
        }
      }
    } catch (error) {
      // Ensure cleanup on any error
      this.kernels.delete(tempId);
      throw error;
    }
    
    return instance;
  }
  
  /**
   * Preload the kernel pool with configured kernel types
   * @private
   */
  private async preloadPool(): Promise<void> {
    if (!this.poolConfig.enabled || this.isPreloading) {
      return;
    }
    
    this.isPreloading = true;
    console.log("Preloading kernel pool...");
    
    try {
      // Preload kernels for each configured type
      for (const config of this.poolConfig.preloadConfigs) {
        try {
          console.log(`Preloading ${config.mode}-${config.language} kernels...`);
          await this.refillPool(config.mode, config.language);
        } catch (error) {
          console.error(`Error preloading ${config.mode}-${config.language}:`, error);
          // Continue with other configurations
        }
      }
      
      console.log("Kernel pool preloading completed");
    } catch (error) {
      console.error("Error during kernel pool preloading:", error);
    } finally {
      this.isPreloading = false;
    }
  }
  
  /**
   * Check if a kernel request can use the pool
   * @param options Kernel creation options
   * @returns True if the request can use pool
   * @private
   */
  private canUsePool(options: IManagerKernelOptions): boolean {
    // Don't use pool if it's disabled
    if (!this.poolConfig.enabled) {
      return false;
    }
    
    // Don't use pool if custom filesystem or permissions are specified
    if (options.filesystem || options.deno?.permissions) {
      return false;
    }
    
    // Don't use pool if custom timeouts are specified
    if (options.inactivityTimeout !== undefined || options.maxExecutionTime !== undefined) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Reassign a pool kernel with new ID and options
   * @param poolKernel Kernel from pool
   * @param newId New kernel ID
   * @param options Kernel options
   * @returns Updated kernel instance
   * @private
   */
  private reassignPoolKernel(
    poolKernel: IKernelInstance, 
    newId: string, 
    options: IManagerKernelOptions
  ): IKernelInstance {
    // Create a new instance object explicitly to avoid spread operator issues
    const updatedInstance: IKernelInstance = {
      id: newId,
      kernel: poolKernel.kernel,
      mode: poolKernel.mode,
      language: poolKernel.language,
      worker: poolKernel.worker,
      created: new Date(), // Update creation time
      options: { ...poolKernel.options, ...options },
      isFromPool: true,
      destroy: poolKernel.destroy // Preserve the original destroy function
    };
    
    // Verify the destroy function is properly set
    if (typeof updatedInstance.destroy !== 'function') {
      console.error('Failed to preserve destroy function during pool kernel reassignment');
      console.error('poolKernel.destroy type:', typeof poolKernel.destroy);
      console.error('updatedInstance.destroy type:', typeof updatedInstance.destroy);
      throw new Error(`Failed to preserve destroy function during pool kernel reassignment`);
    }
    
    return updatedInstance;
  }
  
  /**
   * Get pool statistics for debugging/monitoring
   * @returns Pool statistics
   */
  public getPoolStats(): Record<string, { available: number; total: number }> {
    const stats: Record<string, { available: number; total: number }> = {};
    
    for (const [poolKey, kernels] of this.pool.entries()) {
      stats[poolKey] = {
        available: kernels.length,
        total: this.poolConfig.poolSize
      };
    }
    
    return stats;
  }
  
  /**
   * Create a new kernel instance
   * @param options Options for creating the kernel
   * @param options.id Optional custom ID for the kernel
   * @param options.mode Optional kernel mode (main_thread or worker)
   * @param options.lang Optional kernel language (python or typescript)
   * @param options.namespace Optional namespace prefix for the kernel ID
   * @param options.deno.permissions Optional Deno permissions for worker mode
   * @param options.filesystem Optional filesystem mounting options
   * @param options.inactivityTimeout Optional timeout in ms after which an inactive kernel will be shut down
   * @param options.maxExecutionTime Optional maximum time in ms an execution can run before considered stuck
   * @returns Promise resolving to the kernel instance ID
   */
  public async createKernel(options: IManagerKernelOptions = {}): Promise<string> {
    // make sure the options.id does not contain colons because it will be used as a namespace prefix
    if (options.id && options.id.includes(':')) {
      throw new Error('Kernel ID cannot contain colons');
    }
    const baseId = options.id || crypto.randomUUID();
    const mode = options.mode || KernelMode.WORKER;
    const language = options.lang || KernelLanguage.PYTHON;
    
    // Check if the requested kernel type is allowed
    if (!this.isKernelTypeAllowed(mode, language)) {
      throw new Error(`Kernel type ${mode}-${language} is not allowed. Allowed types: ${
        this.allowedKernelTypes.map(t => `${t.mode}-${t.language}`).join(', ')
      }`);
    }
    
    // Apply namespace prefix if provided
    const id = options.namespace ? `${options.namespace}:${baseId}` : baseId;
    
    // Check if kernel with this ID already exists
    if (this.kernels.has(id)) {
      throw new Error(`Kernel with ID ${id} already exists`);
    }
    
    // Try to get from pool if possible
    if (this.canUsePool(options)) {
      const poolKernel = this.getFromPool(mode, language);
      
      if (poolKernel) {
        console.log(`Using kernel from pool for ${id} (${mode}-${language})`);
        
        // Reassign the pool kernel with the new ID and options
        const instance = this.reassignPoolKernel(poolKernel, id, options);
        
        // Store the kernel instance
        this.kernels.set(id, instance);
        
        // Forward kernel events to manager (for main thread kernels)
        this.setupEventForwarding(instance);
        
        // Initialize activity tracking
        this.updateKernelActivity(id);
        
        // Set up inactivity timeout if specified and greater than 0
        if (options.inactivityTimeout && options.inactivityTimeout > 0) {
          console.log(`Setting up initial inactivity timeout for kernel ${id}: ${options.inactivityTimeout}ms`);
          this.setupInactivityTimeout(id, options.inactivityTimeout);
        } else if (options.inactivityTimeout === 0) {
          console.log(`Inactivity timeout explicitly disabled for kernel ${id}`);
        }
        
        // Setup handlers for stalled executions if maxExecutionTime is specified
        if (options.maxExecutionTime && options.maxExecutionTime > 0) {
          console.log(`Setting up execution monitoring for kernel ${id} with max execution time: ${options.maxExecutionTime}ms`);
          this.setupStalledExecutionHandler(id);
        }
        
        return id;
      }
    }
    
    // Fall back to creating a new kernel on-demand
    console.log(`Creating new kernel on-demand for ${id} (${mode}-${language})`);
    
    // Store options temporarily to be used in createWorkerKernel
    const tempInstance = {
      id,
      options: { ...options, lang: language },
      mode,
      language
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
    
    // Initialize activity tracking
    this.updateKernelActivity(id);
    
    // Set up inactivity timeout if specified and greater than 0
    if (options.inactivityTimeout && options.inactivityTimeout > 0) {
      console.log(`Setting up initial inactivity timeout for kernel ${id}: ${options.inactivityTimeout}ms`);
      this.setupInactivityTimeout(id, options.inactivityTimeout);
    } else if (options.inactivityTimeout === 0) {
      console.log(`Inactivity timeout explicitly disabled for kernel ${id}`);
    }
    
    // Setup handlers for stalled executions if maxExecutionTime is specified
    if (options.maxExecutionTime && options.maxExecutionTime > 0) {
      console.log(`Setting up execution monitoring for kernel ${id} with max execution time: ${options.maxExecutionTime}ms`);
      this.setupStalledExecutionHandler(id);
    }
    
    return id;
  }
  
  /**
   * Create a kernel instance running in the main thread
   * @param id Kernel ID
   * @returns Kernel instance
   */
  private async createMainThreadKernel(id: string): Promise<IKernelInstance> {
    // Get options from the temporary instance
    const options = this.kernels.get(id)?.options || {};
    const language = options.lang || KernelLanguage.PYTHON;
    
    // Create the appropriate kernel based on language
    let kernel: IKernel;
    if (language === KernelLanguage.TYPESCRIPT) {
      kernel = new TypeScriptKernel();
    } else {
      kernel = new Kernel();
    }
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel,
      mode: KernelMode.MAIN_THREAD,
      language,
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
    const language = options.lang || KernelLanguage.PYTHON;
    
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
    }
    
    // Select the worker file based on the language
    const workerFile = language === KernelLanguage.TYPESCRIPT ? 
      "./tsWorker.ts" : 
      "./worker.ts";
    
    // Create worker with permissions
    const worker = new Worker(
      new URL(workerFile, import.meta.url).href,
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
    const kernelProxy = Comlink.wrap<IKernel>(worker);
    
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
        filesystem: options.filesystem,
        lang: language
      }
    });
    
    // Wait for kernel initialization
    await initPromise;
    
    // Create the kernel instance
    const instance: IKernelInstance = {
      id,
      kernel: {
        // Map methods from the Comlink proxy to the IKernel interface
        initialize: async (options?: IKernelOptions) => {
          return kernelProxy.initialize(options);
        },
        execute: async (code: string, parent?: any) => {
          return kernelProxy.execute(code, parent);
        },
        isInitialized: () => {
          return kernelProxy.isInitialized();
        },
        inputReply: async (content: { value: string }) => {
          return kernelProxy.inputReply(content);
        },
        // Map getStatus method to status getter for compatibility with IKernel interface
        get status() {
          try {
            if (typeof kernelProxy.getStatus === 'function') {
              return kernelProxy.getStatus();
            } else {
              return "unknown";
            }
          } catch (error) {
            return "unknown";
          }
        }
      } as unknown as IKernel,
      mode: KernelMode.WORKER,
      language,
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
   * @param namespace Optional namespace to filter kernels by
   * @returns Array of kernel information objects
   */
  public listKernels(namespace?: string): Array<{
    id: string;
    mode: KernelMode;
    language: KernelLanguage;
    status: "active" | "busy" | "unknown";
    created: Date;
    namespace?: string;
    deno?: {
      permissions?: IDenoPermissions;
    };
  }> {
    return Array.from(this.kernels.entries())
      .filter(([id]) => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      })
      .map(([id, instance]) => {
        // Extract namespace from id if present
        const namespaceMatch = id.match(/^([^:]+):/);
        const extractedNamespace = namespaceMatch ? namespaceMatch[1] : undefined;
        
        // Safely handle potentially incomplete kernel instance
        let status: "active" | "busy" | "unknown" = "unknown";
        try {
          // Check if kernel and status properties exist
          if (instance && instance.kernel && typeof instance.kernel.status !== 'undefined') {
            status = instance.kernel.status || "unknown";
          }
        } catch (error) {
          console.warn(`Error getting status for kernel ${id}:`, error);
          status = "unknown";
        }
        
        return {
          id,
          mode: instance.mode,
          language: instance.language,
          status,
          created: instance.created || new Date(),
          namespace: extractedNamespace,
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
    
    // Verify the destroy function exists
    if (typeof instance.destroy !== 'function') {
      throw new Error(`Kernel ${id} is missing destroy function (type: ${typeof instance.destroy})`);
    }
    
    // Clear any inactivity timer
    this.clearInactivityTimeout(id);
    
    // Clean up execution timeouts
    if (this.executionTimeouts.has(id)) {
      const timeouts = this.executionTimeouts.get(id)!;
      for (const timeoutId of timeouts.values()) {
        clearTimeout(timeoutId);
      }
      this.executionTimeouts.delete(id);
    }
    
    // Clean up ongoing executions tracking
    this.ongoingExecutions.delete(id);
    
    // Clean up activity tracking
    this.lastActivityTime.delete(id);
    
    // Remove all event listeners for this kernel
    this.removeAllKernelListeners(id);
    
    // Destroy the kernel instance
    await instance.destroy();
    
    // Remove the kernel from the map
    this.kernels.delete(id);
  }
  
  /**
   * Destroy all kernel instances
   * @param namespace Optional namespace to filter kernels to destroy
   * @returns Promise resolving when all kernels are destroyed
   */
  public async destroyAll(namespace?: string): Promise<void> {
    const ids = Array.from(this.kernels.keys())
      .filter(id => {
        if (!namespace) return true;
        return id.startsWith(`${namespace}:`);
      });
    
    // Destroy all kernels, but skip incomplete instances
    const destroyPromises = ids.map(async (id) => {
      const instance = this.kernels.get(id);
      if (!instance || typeof instance.destroy !== 'function') {
        console.warn(`Skipping incomplete kernel instance ${id} during destroyAll`);
        // Just remove it from the map
        this.kernels.delete(id);
        return;
      }
      return this.destroyKernel(id);
    });
    
    await Promise.all(destroyPromises);
    
    // If no namespace specified, also clean up the pool
    if (!namespace) {
      await this.destroyPool();
    }
  }
  
  /**
   * Destroy all kernels in the pool
   * @private
   */
  private async destroyPool(): Promise<void> {
    console.log("Destroying kernel pool...");
    
    const destroyPromises: Promise<void>[] = [];
    
    for (const [poolKey, kernels] of this.pool.entries()) {
      console.log(`Destroying ${kernels.length} kernels from pool ${poolKey}`);
      
      for (const kernel of kernels) {
        destroyPromises.push(kernel.destroy());
      }
    }
    
    // Wait for all pool kernels to be destroyed
    await Promise.all(destroyPromises);
    
    // Clear the pool
    this.pool.clear();
    
    console.log("Kernel pool destroyed");
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
    
    // Update kernel activity
    this.updateKernelActivity(kernelId);
    
    // Track this execution
    const executionId = this.trackExecution(kernelId);
    
    try {
      // For main thread kernels, we can use the executeStream method directly
      if (instance.mode === KernelMode.MAIN_THREAD) {
        const kernel = instance.kernel as unknown as { 
          executeStream: (code: string, parent: any) => AsyncGenerator<any, any, void> 
        };
        
        // Forward to the kernel's executeStream method
        if (typeof kernel.executeStream === 'function') {
          try {
            yield* kernel.executeStream(code, parent);
            
            // Update activity after execution completes
            this.updateKernelActivity(kernelId);
            
            // Complete execution tracking
            this.completeExecution(kernelId, executionId);
            
            return { success: true };
          } catch (error) {
            console.error(`[MANAGER] Error in main thread executeStream:`, error);
            
            // Update activity even if there's an error
            this.updateKernelActivity(kernelId);
            
            // Complete execution tracking even on error
            this.completeExecution(kernelId, executionId);
            
            return { 
              success: false, 
              error: error instanceof Error ? error : new Error(String(error))
            };
          }
        } else {
          console.warn(`[MANAGER] executeStream method not found on main thread kernel, falling back to event-based approach`);
        }
      }
      
      // For worker mode, we need to implement streaming via events
      try {
        // Event-based approach for worker kernels or main thread kernels without executeStream
        const streamQueue: any[] = [];
        let executionComplete = false;
        let executionResult: { success: boolean, result?: any, error?: Error } = { success: true };
        
        // Create a promise that will resolve when execution is complete
        const executionPromise = new Promise<{ success: boolean, result?: any, error?: Error }>((resolve) => {
          // Create event handlers
          const handleStreamEvent = (event: { kernelId: string, data: any }) => {
            if (event.kernelId === kernelId) {
              streamQueue.push({
                type: 'stream',
                data: event.data
              });
              
              // Stream events also count as activity
              this.updateKernelActivity(kernelId);
            }
          };
          
          const handleDisplayEvent = (event: { kernelId: string, data: any }) => {
            if (event.kernelId === kernelId) {
              streamQueue.push({
                type: 'display_data',
                data: event.data
              });
              
              // Display events also count as activity
              this.updateKernelActivity(kernelId);
            }
          };
          
          const handleResultEvent = (event: { kernelId: string, data: any }) => {
            if (event.kernelId === kernelId) {
              streamQueue.push({
                type: 'execute_result',
                data: event.data
              });
              
              // Result events indicate activity
              this.updateKernelActivity(kernelId);
            }
          };
          
          const handleErrorEvent = (event: { kernelId: string, data: any }) => {
            if (event.kernelId === kernelId) {
              console.log(`[MANAGER] Received error event for kernel ${kernelId}:`, event.data);
              streamQueue.push({
                type: 'error',
                data: event.data
              });
              
              // Error events also count as activity
              this.updateKernelActivity(kernelId);
              
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
          try {
            // We know the execute method is available directly on the kernel object
            // because we mapped it in the IKernelInstance creation
            const executePromise = instance.kernel.execute(code, parent);
            console.log(`[MANAGER] Execute called, got promise:`, typeof executePromise);
            
            executePromise.then((result) => {
              executionComplete = true;
              executionResult = result;
              
              // Update activity when execution completes
              this.updateKernelActivity(kernelId);
              
              // Cleanup event handlers
              super.off(KernelEvents.STREAM, handleStreamEvent);
              super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
              super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
              
              resolve(result);
            }).catch((error) => {
              console.error(`[MANAGER] Error in execute:`, error);
              executionComplete = true;
              const errorResult = {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
              };
              executionResult = errorResult;
              
              // Update activity even on error
              this.updateKernelActivity(kernelId);
              
              // Cleanup event handlers
              console.log(`[MANAGER] Cleaning up event handlers after error`);
              super.off(KernelEvents.STREAM, handleStreamEvent);
              super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
              super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
              
              resolve(errorResult);
            });
          } catch (error) {
            console.error(`[MANAGER] Direct error calling execute:`, error);
            executionComplete = true;
            const errorResult = {
              success: false,
              error: error instanceof Error ? error : new Error(String(error))
            };
            executionResult = errorResult;
            
            // Update activity even on direct error
            this.updateKernelActivity(kernelId);
            
            // Cleanup event handlers on direct error
            super.off(KernelEvents.STREAM, handleStreamEvent);
            super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
            super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
            super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
            super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
            
            resolve(errorResult);
          }
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
          // Complete execution tracking
          this.completeExecution(kernelId, executionId);
          
          return {
            success: false,
            error: new Error("Execution timed out")
          };
        }
        
        // Wait for the final result
        const result = await executionPromise;
        
        // Complete execution tracking
        this.completeExecution(kernelId, executionId);
        
        return result;
      } catch (error) {
        // Complete execution tracking
        this.completeExecution(kernelId, executionId);
        
        console.error(`[MANAGER] Error in executeStream:`, error);
        return {
          success: false,
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    } catch (error) {
      // Complete execution tracking on any outer error
      this.completeExecution(kernelId, executionId);
      
      console.error(`[MANAGER] Unexpected error in executeStream:`, error);
      return {
        success: false, 
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Track a new execution task for a kernel
   * @param kernelId Kernel ID
   * @returns Unique execution ID
   * @private
   */
  private trackExecution(kernelId: string): string {
    // Create a unique execution ID
    const executionId = `exec-${crypto.randomUUID()}`;
    
    // Get or create the set of ongoing executions for this kernel
    if (!this.ongoingExecutions.has(kernelId)) {
      this.ongoingExecutions.set(kernelId, new Set());
    }
    
    // Add this execution to the set
    this.ongoingExecutions.get(kernelId)!.add(executionId);
    
    // Update activity timestamp
    this.updateKernelActivity(kernelId);
    
    // If maxExecutionTime is set, create a timeout to detect stuck/dead kernels
    const instance = this.kernels.get(kernelId);
    if (instance && instance.options.maxExecutionTime && instance.options.maxExecutionTime > 0) {
      // Get or create the map of execution timeouts for this kernel
      if (!this.executionTimeouts.has(kernelId)) {
        this.executionTimeouts.set(kernelId, new Map());
      }
      
      // Set a timeout for this execution
      const timeoutId = setTimeout(() => {
        console.warn(`Execution ${executionId} on kernel ${kernelId} has been running for ${instance.options.maxExecutionTime}ms and may be stuck/dead.`);
        // Emit a stalled execution event
        super.emit('execution_stalled', {
          kernelId,
          executionId,
          maxExecutionTime: instance.options.maxExecutionTime
        });
      }, instance.options.maxExecutionTime);
      
      // Store the timeout ID
      this.executionTimeouts.get(kernelId)!.set(executionId, timeoutId);
    }
    
    return executionId;
  }
  
  /**
   * Complete tracking for an execution
   * @param kernelId Kernel ID
   * @param executionId Execution ID
   * @private
   */
  private completeExecution(kernelId: string, executionId: string): void {
    // Clear any execution timeout
    if (this.executionTimeouts.has(kernelId)) {
      const timeouts = this.executionTimeouts.get(kernelId)!;
      if (timeouts.has(executionId)) {
        clearTimeout(timeouts.get(executionId));
        timeouts.delete(executionId);
      }
      
      // Clean up empty maps
      if (timeouts.size === 0) {
        this.executionTimeouts.delete(kernelId);
      }
    }
    
    // Remove from ongoing executions
    if (this.ongoingExecutions.has(kernelId)) {
      const executions = this.ongoingExecutions.get(kernelId)!;
      executions.delete(executionId);
      
      // Clean up empty sets
      if (executions.size === 0) {
        this.ongoingExecutions.delete(kernelId);
        
        // Update activity timestamp for completed execution
        this.updateKernelActivity(kernelId);
      }
    }
  }
  
  /**
   * Check if a kernel has any ongoing executions
   * @param kernelId Kernel ID
   * @returns True if the kernel has ongoing executions
   * @private
   */
  private hasOngoingExecutions(kernelId: string): boolean {
    return this.ongoingExecutions.has(kernelId) && 
           this.ongoingExecutions.get(kernelId)!.size > 0;
  }
  
  /**
   * Get the count of ongoing executions for a kernel
   * @param id Kernel ID
   * @returns Number of ongoing executions
   */
  public getOngoingExecutionCount(id: string): number {
    if (!this.ongoingExecutions.has(id)) {
      return 0;
    }
    return this.ongoingExecutions.get(id)!.size;
  }
  
  /**
   * Set up an inactivity timeout for a kernel
   * @param id Kernel ID
   * @param timeout Timeout in milliseconds
   * @private
   */
  private setupInactivityTimeout(id: string, timeout: number): void {
    // Don't set up a timer if timeout is 0 or negative
    if (timeout <= 0) {
      console.log(`Not setting up inactivity timer for kernel ${id} because timeout is ${timeout}ms`);
      return;
    }
    
    // Always clear any existing timer first
    this.clearInactivityTimeout(id);
    
    // Create a timer to destroy the kernel after the timeout
    console.log(`Setting up inactivity timer for kernel ${id} with timeout ${timeout}ms`);
    const timer = setTimeout(() => {
      // Check if the kernel has ongoing executions before shutting down
      if (this.hasOngoingExecutions(id)) {
        console.log(`Kernel ${id} has ongoing executions, not shutting down despite inactivity timeout.`);
        // Reset the timer to check again later
        this.setupInactivityTimeout(id, timeout);
        return;
      }
      
      console.log(`Kernel ${id} has been inactive for ${timeout}ms with no ongoing executions. Shutting down.`);
      this.destroyKernel(id).catch(error => {
        console.error(`Error destroying inactive kernel ${id}:`, error);
      });
    }, timeout);
    
    // Store the timer ID
    this.inactivityTimers.set(id, timer);
  }
  
  /**
   * Clear any existing inactivity timeout for a kernel
   * @param id Kernel ID
   * @private
   */
  private clearInactivityTimeout(id: string): void {
    if (this.inactivityTimers.has(id)) {
      const timerId = this.inactivityTimers.get(id);
      console.log(`Clearing inactivity timer ${timerId} for kernel ${id}`);
      clearTimeout(timerId);
      this.inactivityTimers.delete(id);
    }
  }

  /**
   * Update activity timestamp for a kernel and reset inactivity timer if present
   * @param id Kernel ID
   * @private
   */
  private updateKernelActivity(id: string): void {
    // Update the last activity time
    this.lastActivityTime.set(id, Date.now());
    
    // Get the kernel options
    const instance = this.kernels.get(id);
    if (!instance) return;
    
    const timeout = instance.options.inactivityTimeout;
    
    // Reset the inactivity timer if timeout is enabled (greater than 0)
    if (timeout && timeout > 0) {
      this.setupInactivityTimeout(id, timeout);
    }
  }

  /**
   * Get the last activity time for a kernel
   * @param id Kernel ID
   * @returns Last activity time in milliseconds since epoch, or undefined if not found
   */
  public getLastActivityTime(id: string): number | undefined {
    return this.lastActivityTime.get(id);
  }

  /**
   * Get the inactivity timeout for a kernel
   * @param id Kernel ID
   * @returns Inactivity timeout in milliseconds, or undefined if not set
   */
  public getInactivityTimeout(id: string): number | undefined {
    const instance = this.kernels.get(id);
    if (!instance) return undefined;
    
    return instance.options.inactivityTimeout;
  }

  /**
   * Set or update the inactivity timeout for a kernel
   * @param id Kernel ID
   * @param timeout Timeout in milliseconds, or 0 to disable
   * @returns True if the timeout was set, false if the kernel was not found
   */
  public setInactivityTimeout(id: string, timeout: number): boolean {
    const instance = this.kernels.get(id);
    if (!instance) return false;
    
    // Update the timeout in the options
    instance.options.inactivityTimeout = timeout;
    
    // Clear any existing timer
    this.clearInactivityTimeout(id);
    
    // If timeout is greater than 0, set up a new timer
    if (timeout > 0) {
      this.setupInactivityTimeout(id, timeout);
    } else {
      console.log(`Inactivity timeout disabled for kernel ${id}`);
    }
    
    return true;
  }

  /**
   * Get time until auto-shutdown for a kernel
   * @param id Kernel ID
   * @returns Time in milliseconds until auto-shutdown, or undefined if no timeout is set
   */
  public getTimeUntilShutdown(id: string): number | undefined {
    const instance = this.kernels.get(id);
    if (!instance) return undefined;
    
    const timeout = instance.options.inactivityTimeout;
    if (!timeout || timeout <= 0) return undefined;
    
    const lastActivity = this.lastActivityTime.get(id);
    if (!lastActivity) return undefined;
    
    const elapsedTime = Date.now() - lastActivity;
    const remainingTime = timeout - elapsedTime;
    
    return Math.max(0, remainingTime);
  }

  /**
   * Get the map of inactivity timers (for debugging/testing only)
   * @returns Object with kernel IDs as keys and timer IDs as values
   */
  public getInactivityTimers(): Record<string, number> {
    // Convert Map to Object for easier inspection
    const timers: Record<string, number> = {};
    this.inactivityTimers.forEach((value, key) => {
      timers[key] = value;
    });
    return timers;
  }

  /**
   * Set up a handler for stalled executions
   * @param id Kernel ID
   * @private
   */
  private setupStalledExecutionHandler(id: string): void {
    // Listen for stalled execution events
    super.on(KernelEvents.EXECUTION_STALLED, (event: { kernelId: string, executionId: string, maxExecutionTime: number }) => {
      if (event.kernelId === id) {
        console.warn(`Handling stalled execution ${event.executionId} on kernel ${id} (running longer than ${event.maxExecutionTime}ms)`);
        
        // Emit an event for clients to handle
        const instance = this.kernels.get(id);
        if (instance) {
          super.emit(KernelEvents.EXECUTE_ERROR, {
            kernelId: id,
            data: {
              ename: "ExecutionStalledError",
              evalue: `Execution stalled or potentially deadlocked (running > ${event.maxExecutionTime}ms)`,
              traceback: ["Execution may be stuck in an infinite loop or deadlocked."]
            }
          });
        }
      }
    });
  }

  /**
   * Force terminate a potentially stuck kernel
   * @param id Kernel ID
   * @param reason Optional reason for termination
   * @returns Promise resolving to true if the kernel was terminated
   */
  public async forceTerminateKernel(id: string, reason = "Force terminated due to stalled execution"): Promise<boolean> {
    const instance = this.kernels.get(id);
    
    if (!instance) {
      return false;
    }
    
    try {
      // Log the forced termination
      console.warn(`Force terminating kernel ${id}: ${reason}`);
      
      // Emit an error event to notify clients
      super.emit(KernelEvents.EXECUTE_ERROR, {
        kernelId: id,
        data: {
          ename: "KernelForcedTermination",
          evalue: reason,
          traceback: ["Kernel was forcefully terminated by the system."]
        }
      });
      
      // Destroy the kernel
      await this.destroyKernel(id);
      return true;
    } catch (error) {
      console.error(`Error during forced termination of kernel ${id}:`, error);
      return false;
    }
  }

  /**
   * Get information about ongoing executions for a kernel
   * @param id Kernel ID
   * @returns Information about ongoing executions
   */
  public getExecutionInfo(id: string): { 
    count: number; 
    isStuck: boolean; 
    executionIds: string[];
    longestRunningTime?: number;
  } {
    const instance = this.kernels.get(id);
    if (!instance) {
      return { count: 0, isStuck: false, executionIds: [] };
    }
    
    // Handle partially initialized kernels where options may not be fully set
    if (!instance.options) {
      return { count: 0, isStuck: false, executionIds: [] };
    }
    
    const executionIds = this.ongoingExecutions.get(id) 
      ? Array.from(this.ongoingExecutions.get(id)!)
      : [];
    
    const count = executionIds.length;
    
    // Calculate longest running time if we have activity timestamps
    let longestRunningTime: number | undefined = undefined;
    if (this.lastActivityTime.has(id)) {
      longestRunningTime = Date.now() - this.lastActivityTime.get(id)!;
    }
    
    // Consider stuck if running longer than maxExecutionTime
    const isStuck = instance.options.maxExecutionTime !== undefined && 
                   longestRunningTime !== undefined && 
                   longestRunningTime > instance.options.maxExecutionTime;
    
    return {
      count,
      isStuck,
      executionIds,
      longestRunningTime
    };
  }

  /**
   * Execute Python code in a kernel
   * Overrides the kernel's execute method to track executions
   * @param kernelId ID of the kernel to use
   * @param code Python code to execute
   * @param parent Optional parent message header
   * @returns Promise resolving to execution result
   */
  public async execute(
    kernelId: string,
    code: string,
    parent: any = {}
  ): Promise<{ success: boolean, result?: any, error?: Error }> {
    const instance = this.getKernel(kernelId);
    
    if (!instance) {
      throw new Error(`Kernel with ID ${kernelId} not found`);
    }
    
    // Update kernel activity
    this.updateKernelActivity(kernelId);
    
    // Track this execution
    const executionId = this.trackExecution(kernelId);
    
    try {
      // Execute the code
      const result = await instance.kernel.execute(code, parent);
      
      // Update activity after execution completes
      this.updateKernelActivity(kernelId);
      
      // Complete execution tracking
      this.completeExecution(kernelId, executionId);
      
      return result;
    } catch (error) {
      // Update activity even if there's an error
      this.updateKernelActivity(kernelId);
      
      // Complete execution tracking even on error
      this.completeExecution(kernelId, executionId);
      
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }

  /**
   * Check if a kernel type is allowed
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns True if the kernel type is allowed
   * @private
   */
  private isKernelTypeAllowed(mode: KernelMode, language: KernelLanguage): boolean {
    return this.allowedKernelTypes.some(type => 
      type.mode === mode && type.language === language
    );
  }
  
  /**
   * Get the list of allowed kernel types
   * @returns Array of allowed kernel type configurations
   */
  public getAllowedKernelTypes(): Array<{
    mode: KernelMode;
    language: KernelLanguage;
  }> {
    return [...this.allowedKernelTypes]; // Return a copy to prevent modification
  }
}