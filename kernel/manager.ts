// Kernel Manager for Deno App Engine
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
  
  // Pool management - now using promises for immediate response
  private pool: Map<string, Promise<IKernelInstance>[]> = new Map();
  private poolConfig: IKernelPoolConfig;
  private isPreloading: boolean = false;
  // Track which pool keys are currently being prefilled to prevent duplicates
  private prefillingInProgress: Map<string, boolean> = new Map();
  
  // Allowed kernel types configuration
  private allowedKernelTypes: Array<{
    mode: KernelMode;
    language: KernelLanguage;
  }>;
  
  // Interrupt buffers for worker kernels (using SharedArrayBuffer)
  private interruptBuffers: Map<string, Uint8Array> = new Map();
  
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
   * Get a kernel promise from the pool if available
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns Kernel promise or null if none available
   * @private
   */
  private getFromPool(mode: KernelMode, language: KernelLanguage): Promise<IKernelInstance> | null {
    if (!this.poolConfig.enabled) {
      return null;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    const poolPromises = this.pool.get(poolKey);
    
    if (!poolPromises || poolPromises.length === 0) {
      return null;
    }
    
    // Remove and return the first promise from the pool (FIFO)
    const kernelPromise = poolPromises.shift()!;
    
    // Immediately trigger background refill to add one promise back
    if (this.poolConfig.autoRefill) {
      setTimeout(() => {
        this.refillPoolSingle(mode, language).catch(error => {
          console.error(`Error refilling single kernel for ${poolKey}:`, error);
        });
      }, 0);
    }
    
    return kernelPromise;
  }
  
  /**
   * Add a kernel promise to the pool
   * @param mode Kernel mode
   * @param language Kernel language
   * @param kernelPromise Kernel promise
   * @private
   */
  private addToPool(mode: KernelMode, language: KernelLanguage, kernelPromise: Promise<IKernelInstance>): void {
    if (!this.poolConfig.enabled) {
      return;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    
    if (!this.pool.has(poolKey)) {
      this.pool.set(poolKey, []);
    }
    
    const poolPromises = this.pool.get(poolKey)!;
    
    // Only add if we haven't reached the pool size limit
    if (poolPromises.length < this.poolConfig.poolSize) {
      poolPromises.push(kernelPromise);
      
      // Handle promise rejection to prevent unhandled rejections
      kernelPromise.catch(error => {
        console.error(`Pool kernel promise rejected for ${poolKey}:`, error);
        // Remove the failed promise from the pool
        const index = poolPromises.indexOf(kernelPromise);
        if (index !== -1) {
          poolPromises.splice(index, 1);
        }
      });
    } else {
      // Pool is full, let the excess promise resolve and then destroy the kernel
      kernelPromise.then(kernel => {
        kernel.destroy().catch(error => {
          console.error("Error destroying excess pool kernel:", error);
        });
      }).catch(error => {
        console.error("Excess pool kernel promise rejected:", error);
      });
    }
  }
  
  /**
   * Refill the pool with a single kernel promise
   * @param mode Kernel mode
   * @param language Kernel language
   * @private
   */
  private async refillPoolSingle(mode: KernelMode, language: KernelLanguage): Promise<void> {
    if (!this.poolConfig.enabled) {
      return;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    const poolPromises = this.pool.get(poolKey) || [];
    
    // Only add one if we're below the pool size
    if (poolPromises.length < this.poolConfig.poolSize) {
      console.log(`Adding single kernel promise to pool for ${poolKey}`);
      const kernelPromise = this.createPoolKernelPromise(mode, language);
      this.addToPool(mode, language, kernelPromise);
    }
  }

  /**
   * Refill the pool for a specific configuration with parallel creation
   * @param mode Kernel mode
   * @param language Kernel language
   * @private
   */
  private async refillPool(mode: KernelMode, language: KernelLanguage): Promise<void> {
    if (!this.poolConfig.enabled) {
      return;
    }
    
    const poolKey = this.getPoolKey(mode, language);
    
    // Check if already prefilling this pool key to prevent duplicates
    if (this.prefillingInProgress.get(poolKey)) {
      console.log(`Pool refill already in progress for ${poolKey}, skipping`);
      return;
    }
    
    // Set prefilling flag
    this.prefillingInProgress.set(poolKey, true);
    
    try {
      const poolPromises = this.pool.get(poolKey) || [];
      const needed = this.poolConfig.poolSize - poolPromises.length;
      
      if (needed <= 0) {
        return;
      }
      
      console.log(`Refilling pool for ${poolKey}, creating ${needed} kernel promise(s) in parallel`);
      
      // Create all needed kernel promises in parallel
      const newPromises = Array.from({ length: needed }, () => 
        this.createPoolKernelPromise(mode, language)
      );
      
      // Add all promises to the pool
      for (const kernelPromise of newPromises) {
        this.addToPool(mode, language, kernelPromise);
      }
      
      console.log(`Successfully added ${needed} kernel promises to pool for ${poolKey}`);
    } catch (error) {
      console.error(`Error refilling pool for ${poolKey}:`, error);
    } finally {
      // Always clear the prefilling flag
      this.prefillingInProgress.set(poolKey, false);
    }
  }
  
  /**
   * Create a kernel promise for the pool
   * @param mode Kernel mode
   * @param language Kernel language
   * @returns Promise that resolves to a kernel instance
   * @private
   */
  private createPoolKernelPromise(mode: KernelMode, language: KernelLanguage): Promise<IKernelInstance> {
    return new Promise(async (resolve, reject) => {
      try {
        const kernel = await this.createPoolKernel(mode, language);
        // Mark as taken from pool
        kernel.isFromPool = true;
        resolve(kernel);
      } catch (error) {
        console.error(`Error creating pool kernel for ${mode}-${language}:`, error);
        reject(error);
      }
    });
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
    
    for (const [poolKey, promises] of this.pool.entries()) {
      stats[poolKey] = {
        available: promises.length,
        total: this.poolConfig.poolSize
      };
    }
    
    return stats;
  }
  
  /**
   * Get pool configuration information
   * @returns Pool configuration details
   */
  public getPoolConfig(): {
    enabled: boolean;
    poolSize: number;
    autoRefill: boolean;
    preloadConfigs: Array<{
      mode: KernelMode;
      language: KernelLanguage;
    }>;
    isPreloading: boolean;
  } {
    return {
      enabled: this.poolConfig.enabled,
      poolSize: this.poolConfig.poolSize,
      autoRefill: this.poolConfig.autoRefill,
      preloadConfigs: [...this.poolConfig.preloadConfigs], // Return a copy to prevent modification
      isPreloading: this.isPreloading
    };
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
      const poolKey = this.getPoolKey(mode, language);
      
      // Check if this kernel type is configured for pooling
      const isPooledType = this.poolConfig.preloadConfigs.some(config => 
        config.mode === mode && config.language === language
      );
      
      if (isPooledType) {
        // First try to get from existing pool
        let poolKernelPromise = this.getFromPool(mode, language);
        
        if (poolKernelPromise) {
          console.log(`Using kernel promise from pool for ${id} (${mode}-${language})`);
          return await this.setupPoolKernelFromPromise(poolKernelPromise, id, options);
        }
        
        // Pool is empty, but this type should be pooled
        // Create a new promise immediately and trigger background refill
        console.log(`Pool exhausted for ${poolKey}, creating new kernel promise for ${id}`);
        
        try {
          // Create a new kernel promise specifically for this request
          const newKernelPromise = this.createPoolKernelPromise(mode, language);
          console.log(`Created new kernel promise for exhausted pool: ${id} (${mode}-${language})`);
          
          // Trigger background refill to replenish the pool for future requests
          if (this.poolConfig.autoRefill) {
            setTimeout(() => {
              this.refillPool(mode, language).catch(error => {
                console.error(`Error refilling exhausted pool for ${poolKey}:`, error);
              });
            }, 0);
          }
          
          return await this.setupPoolKernelFromPromise(newKernelPromise, id, options);
        } catch (error) {
          console.error(`Failed to create kernel promise for exhausted pool: ${error}`);
          // Fall through to on-demand creation as last resort
        }
      } else {
        // This kernel type is not configured for pooling, try to get from pool anyway
        // in case there are kernels available from previous configurations
        const poolKernelPromise = this.getFromPool(mode, language);
        if (poolKernelPromise) {
          console.log(`Using available kernel promise from pool for ${id} (${mode}-${language}) - not configured for pooling`);
          return await this.setupPoolKernelFromPromise(poolKernelPromise, id, options);
        }
      }
    }
    
    // Fall back to creating a new kernel on-demand
    console.log(`Creating new kernel on-demand for ${id} (${mode}-${language})`);
    return this.createOnDemandKernel(id, mode, language, options);
  }
  
  /**
   * Setup a pool kernel from a promise with new ID and options
   * @param poolKernelPromise Kernel promise from pool
   * @param id New kernel ID
   * @param options Kernel options
   * @returns Kernel ID (returned after kernel is ready)
   * @private
   */
  private async setupPoolKernelFromPromise(
    poolKernelPromise: Promise<IKernelInstance>, 
    id: string, 
    options: IManagerKernelOptions
  ): Promise<string> {
    try {
      // Wait for the pool kernel to be ready
      const poolKernel = await poolKernelPromise;
      
      // Reassign the pool kernel with the new ID and options
      const instance = this.reassignPoolKernel(poolKernel, id, options);
      
      // For worker kernels, we need to recreate the event handler with the new ID
      if (instance.mode === KernelMode.WORKER && instance.worker) {
        console.log(`[MANAGER] Updating worker event handler for reassigned kernel ${id}`);
        
        // Get the worker and create new message channel
        const worker = instance.worker;
        
        // Create a new message channel for the reassigned kernel
        const { port1, port2 } = new MessageChannel();
        
        // Send the new event port to the worker
        worker.postMessage({
          type: "SET_EVENT_PORT",
          port: port2
        }, [port2]);
        
        // Create a new event handler with the correct kernel ID
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
        
        // Listen for events from the worker with the new handler
        port1.addEventListener('message', eventHandler);
        port1.start();
        
        // Update the destroy function to clean up the new event handler
        const originalDestroy = instance.destroy;
        instance.destroy = async () => {
          port1.removeEventListener('message', eventHandler);
          port1.close();
          return originalDestroy();
        };
      }
      
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
      
      console.log(`Kernel ${id} is now ready and registered`);
      return id;
    } catch (error) {
      console.error(`Error setting up pool kernel ${id}:`, error);
      // Emit an error event for this kernel
      super.emit(KernelEvents.EXECUTE_ERROR, {
        kernelId: id,
        data: {
          ename: "KernelSetupError",
          evalue: `Failed to setup kernel: ${error instanceof Error ? error.message : String(error)}`,
          traceback: [error instanceof Error ? (error.stack || error.message) : String(error)]
        }
      });
      throw error; // Re-throw to let the caller handle it
    }
  }

  /**
   * Setup a pool kernel with new ID and options (for already resolved kernels)
   * @param poolKernel Kernel from pool
   * @param id New kernel ID
   * @param options Kernel options
   * @returns Kernel ID
   * @private
   */
  private setupPoolKernel(
    poolKernel: IKernelInstance, 
    id: string, 
    options: IManagerKernelOptions
  ): string {
    // Reassign the pool kernel with the new ID and options
    const instance = this.reassignPoolKernel(poolKernel, id, options);
    
    // For worker kernels, we need to recreate the event handler with the new ID
    if (instance.mode === KernelMode.WORKER && instance.worker) {
      console.log(`[MANAGER] Updating worker event handler for reassigned kernel ${id}`);
      
      // Get the worker and create new message channel
      const worker = instance.worker;
      
      // Create a new message channel for the reassigned kernel
      const { port1, port2 } = new MessageChannel();
      
      // Send the new event port to the worker
      worker.postMessage({
        type: "SET_EVENT_PORT",
        port: port2
      }, [port2]);
      
      // Create a new event handler with the correct kernel ID
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
      
      // Listen for events from the worker with the new handler
      port1.addEventListener('message', eventHandler);
      port1.start();
      
      // Update the destroy function to clean up the new event handler
      const originalDestroy = instance.destroy;
      instance.destroy = async () => {
        port1.removeEventListener('message', eventHandler);
        port1.close();
        return originalDestroy();
      };
    }
    
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
  
  /**
   * Create a kernel on-demand (not from pool)
   * @param id Kernel ID
   * @param mode Kernel mode
   * @param language Kernel language
   * @param options Kernel options
   * @returns Kernel ID
   * @private
   */
  private async createOnDemandKernel(
    id: string, 
    mode: KernelMode, 
    language: KernelLanguage, 
    options: IManagerKernelOptions
  ): Promise<string> {
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
        // Filter out pool kernels (temporary kernels with IDs starting with "pool-")
        if (id.startsWith("pool-")) return false;
        
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
    
    // Clean up interrupt buffers
    if (this.interruptBuffers.has(id)) {
      console.log(`Cleaning up interrupt buffer for kernel ${id}`);
      this.interruptBuffers.delete(id);
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
    
    for (const [poolKey, promises] of this.pool.entries()) {
      console.log(`Destroying ${promises.length} kernel promises from pool ${poolKey}`);
      
      for (const kernelPromise of promises) {
        // Handle each promise - if it resolves, destroy the kernel
        const destroyPromise = kernelPromise.then(kernel => {
          return kernel.destroy();
        }).catch(error => {
          console.error(`Error destroying pool kernel from promise:`, error);
          // Don't re-throw to avoid unhandled rejections
        });
        
        destroyPromises.push(destroyPromise);
      }
    }
    
    // Wait for all pool kernels to be destroyed
    await Promise.all(destroyPromises);
    
    // Clear the pool and prefilling flags
    this.pool.clear();
    this.prefillingInProgress.clear();
    
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
        
        console.log(`[MANAGER] Setting up event-based execution for kernel ${kernelId}`);
        
        // Create a promise that will resolve when execution is complete
        const executionPromise = new Promise<{ success: boolean, result?: any, error?: Error }>((resolve) => {
          // Create event handlers
          const handleStreamEvent = (event: { kernelId: string, data: any }) => {
            if (event.kernelId === kernelId) {
              console.log(`[MANAGER] Received stream event for kernel ${kernelId}:`, event.data);
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
              console.log(`[MANAGER] Received display event for kernel ${kernelId}:`, event.data);
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
              console.log(`[MANAGER] Received result event for kernel ${kernelId}:`, event.data);
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
          
          console.log(`[MANAGER] Registering event handlers for kernel ${kernelId}`);
          
          // Register all the event handlers
          super.on(KernelEvents.STREAM, handleStreamEvent);
          super.on(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
          super.on(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
          super.on(KernelEvents.EXECUTE_RESULT, handleResultEvent);
          super.on(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
          
          console.log(`[MANAGER] Event handlers registered, starting execution for kernel ${kernelId}`);
          
          // Execute the code
          // We need to wait for the execution to complete before returning the result
          try {
            // We know the execute method is available directly on the kernel object
            // because we mapped it in the IKernelInstance creation
            const executePromise = instance.kernel.execute(code, parent);
            console.log(`[MANAGER] Execute called for kernel ${kernelId}, got promise:`, typeof executePromise);
            
            executePromise.then((result) => {
              console.log(`[MANAGER] Execute completed for kernel ${kernelId} with result:`, result);
              executionComplete = true;
              executionResult = result;
              
              // Update activity when execution completes
              this.updateKernelActivity(kernelId);
              
              // Cleanup event handlers
              console.log(`[MANAGER] Cleaning up event handlers for kernel ${kernelId}`);
              super.off(KernelEvents.STREAM, handleStreamEvent);
              super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
              super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
              
              resolve(result);
            }).catch((error) => {
              console.error(`[MANAGER] Error in execute for kernel ${kernelId}:`, error);
              executionComplete = true;
              const errorResult = {
                success: false,
                error: error instanceof Error ? error : new Error(String(error))
              };
              executionResult = errorResult;
              
              // Update activity even on error
              this.updateKernelActivity(kernelId);
              
              // Cleanup event handlers
              console.log(`[MANAGER] Cleaning up event handlers after error for kernel ${kernelId}`);
              super.off(KernelEvents.STREAM, handleStreamEvent);
              super.off(KernelEvents.DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.UPDATE_DISPLAY_DATA, handleDisplayEvent);
              super.off(KernelEvents.EXECUTE_RESULT, handleResultEvent);
              super.off(KernelEvents.EXECUTE_ERROR, handleErrorEvent);
              
              resolve(errorResult);
            });
          } catch (error) {
            console.error(`[MANAGER] Direct error calling execute for kernel ${kernelId}:`, error);
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
        
        console.log(`[MANAGER] Starting event monitoring loop for kernel ${kernelId}`);
        
        // Monitor the stream queue and yield results
        while ((!executionComplete || streamQueue.length > 0) && 
               (Date.now() - startTime < timeout)) {
          // If there are items in the queue, yield them
          if (streamQueue.length > 0) {
            const event = streamQueue.shift();
            console.log(`[MANAGER] Yielding event for kernel ${kernelId}:`, event);
            yield event;
            continue;
          }
          
          // If no more events but execution is not complete, wait a little
          if (!executionComplete) {
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        
        console.log(`[MANAGER] Event monitoring completed for kernel ${kernelId}. Complete: ${executionComplete}, Queue length: ${streamQueue.length}`);
        
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
        console.log(`[MANAGER] Final execution result for kernel ${kernelId}:`, result);
        
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

  /**
   * Ping a kernel to reset its activity timer and extend the deadline
   * @param id Kernel ID
   * @returns True if the kernel was pinged successfully, false if not found
   */
  public pingKernel(id: string): boolean {
    const instance = this.kernels.get(id);
    if (!instance) {
      return false;
    }
    
    // Update kernel activity (this will reset the inactivity timer)
    this.updateKernelActivity(id);
    
    console.log(`Kernel ${id} pinged - activity timer reset`);
    return true;
  }

  /**
   * Restart a kernel by destroying it and creating a new one with the same ID and configuration
   * @param id Kernel ID
   * @returns Promise resolving to true if the kernel was restarted successfully, false if not found
   */
  public async restartKernel(id: string): Promise<boolean> {
    const instance = this.kernels.get(id);
    if (!instance) {
      console.warn(`Cannot restart kernel ${id}: kernel not found`);
      return false;
    }
    
    try {
      console.log(`Restarting kernel ${id}...`);
      
      // Store the current configuration
      const currentConfig = {
        mode: instance.mode,
        language: instance.language,
        options: { ...instance.options }
      };
      
      // Extract namespace from ID if present
      let namespace: string | undefined;
      let baseId: string;
      
      if (id.includes(':')) {
        const parts = id.split(':');
        namespace = parts[0];
        baseId = parts[1];
      } else {
        baseId = id;
      }
      
      console.log(`Destroying existing kernel ${id} before restart...`);
      
      // Destroy the existing kernel
      await this.destroyKernel(id);
      
      console.log(`Creating new kernel with same configuration for ${id}...`);
      
      // Create a new kernel with the same configuration
      const restartOptions: IManagerKernelOptions = {
        id: baseId,
        mode: currentConfig.mode,
        lang: currentConfig.language,
        namespace,
        deno: currentConfig.options.deno,
        filesystem: currentConfig.options.filesystem,
        inactivityTimeout: currentConfig.options.inactivityTimeout,
        maxExecutionTime: currentConfig.options.maxExecutionTime
      };
      
      // Create the new kernel
      const newKernelId = await this.createKernel(restartOptions);
      
      // Verify the new kernel has the same ID
      if (newKernelId !== id) {
        console.error(`Kernel restart failed: expected ID ${id}, got ${newKernelId}`);
        return false;
      }
      
      console.log(`Kernel ${id} restarted successfully`);
      return true;
      
    } catch (error) {
      console.error(`Error restarting kernel ${id}:`, error);
      return false;
    }
  }

  /**
   * Interrupt a running kernel execution
   * @param id Kernel ID
   * @returns Promise resolving to true if the interrupt was successful, false if not found or failed
   */
  public async interruptKernel(id: string): Promise<boolean> {
    const instance = this.kernels.get(id);
    if (!instance) {
      console.warn(`Cannot interrupt kernel ${id}: kernel not found`);
      return false;
    }
    
    try {
      console.log(`Interrupting kernel ${id} (mode: ${instance.mode})...`);
      
      if (instance.mode === KernelMode.WORKER && instance.worker) {
        // For worker kernels, use SharedArrayBuffer interrupt method
        return await this.interruptWorkerKernel(id, instance);
      } else {
        // For main thread kernels, use the kernel's interrupt method
        return await this.interruptMainThreadKernel(id, instance);
      }
    } catch (error) {
      console.error(`Error interrupting kernel ${id}:`, error);
      return false;
    }
  }
  
  /**
   * Interrupt a main thread kernel
   * @param id Kernel ID
   * @param instance Kernel instance
   * @returns Promise resolving to interrupt success
   * @private
   */
  private async interruptMainThreadKernel(id: string, instance: IKernelInstance): Promise<boolean> {
    console.log(`[MANAGER] Interrupting main thread kernel ${id}`);
    
    try {
      // Try to use the kernel's interrupt method
      if (typeof instance.kernel.interrupt === 'function') {
        const result = await instance.kernel.interrupt();
        console.log(`[MANAGER] Main thread kernel ${id} interrupt result: ${result}`);
        return result;
      } else {
        console.warn(`[MANAGER] Main thread kernel ${id} does not support interrupt method`);
        
        // Emit a synthetic KeyboardInterrupt event
        super.emit(KernelEvents.EXECUTE_ERROR, {
          kernelId: id,
          data: {
            ename: "KeyboardInterrupt",
            evalue: "Execution interrupted by user",
            traceback: ["KeyboardInterrupt: Execution interrupted by user"]
          }
        });
        
        return true;
      }
    } catch (error) {
      console.error(`[MANAGER] Error interrupting main thread kernel ${id}:`, error);
      return false;
    }
  }
  
  /**
   * Interrupt a worker kernel using SharedArrayBuffer
   * @param id Kernel ID
   * @param instance Kernel instance
   * @returns Promise resolving to interrupt success
   * @private
   */
  private async interruptWorkerKernel(id: string, instance: IKernelInstance): Promise<boolean> {
    console.log(`[MANAGER] Interrupting worker kernel ${id}`);
    
    try {
      const worker = instance.worker;
      if (!worker) {
        console.error(`[MANAGER] Worker not found for kernel ${id}`);
        return false;
      }
      
      // Check if we already have an interrupt buffer for this kernel
      let interruptBuffer = this.interruptBuffers.get(id);
      
      if (!interruptBuffer) {
        // Create a new SharedArrayBuffer for interrupt control
        console.log(`[MANAGER] Creating interrupt buffer for worker kernel ${id}`);
        
        try {
          // Try to create SharedArrayBuffer (requires specific security headers)
          const sharedBuffer = new SharedArrayBuffer(1);
          interruptBuffer = new Uint8Array(sharedBuffer);
          
          // Store the buffer for future use
          this.interruptBuffers.set(id, interruptBuffer);
          
          // Send the buffer to the worker
          worker.postMessage({
            type: "SET_INTERRUPT_BUFFER",
            buffer: interruptBuffer
          });
          
          // Wait a moment for the worker to set up the buffer
          await new Promise(resolve => setTimeout(resolve, 100));
          
          console.log(`[MANAGER] Interrupt buffer created and sent to worker kernel ${id}`);
        } catch (error) {
          console.warn(`[MANAGER] Failed to create SharedArrayBuffer for kernel ${id}, falling back to message-based interrupt:`, error);
          
          // Fallback: use message-based interrupt
          return await this.interruptWorkerKernelFallback(id, worker);
        }
      }
      
      // Reset buffer to 0 first
      interruptBuffer[0] = 0;
      
      // Send interrupt message to worker
      worker.postMessage({
        type: "INTERRUPT_KERNEL"
      });
      
      // Wait for a short time to see if the interrupt was processed
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check if the interrupt was processed (buffer should still be 0 if processed, or 2 if not)
      const wasProcessed = interruptBuffer[0] === 0;
      
      console.log(`[MANAGER] Worker kernel ${id} interrupt ${wasProcessed ? 'successful' : 'may have failed'}`);
      return true; // Return true even if we're not sure, as the interrupt was attempted
      
    } catch (error) {
      console.error(`[MANAGER] Error interrupting worker kernel ${id}:`, error);
      return false;
    }
  }
  
  /**
   * Fallback interrupt method for worker kernels when SharedArrayBuffer is not available
   * @param id Kernel ID
   * @param worker Worker instance
   * @returns Promise resolving to interrupt success
   * @private
   */
  private async interruptWorkerKernelFallback(id: string, worker: Worker): Promise<boolean> {
    console.log(`[MANAGER] Using fallback interrupt method for worker kernel ${id}`);
    
    return new Promise<boolean>((resolve) => {
      // Set up a listener for the interrupt response
      const responseHandler = (event: MessageEvent) => {
        if (event.data?.type === "INTERRUPT_TRIGGERED") {
          worker.removeEventListener("message", responseHandler);
          const success = event.data.data?.success || false;
          console.log(`[MANAGER] Fallback interrupt for kernel ${id} result: ${success}`);
          resolve(success);
        }
      };
      
      // Listen for the response
      worker.addEventListener("message", responseHandler);
      
      // Send the interrupt message
      worker.postMessage({
        type: "INTERRUPT_KERNEL"
      });
      
      // Set a timeout in case we don't get a response
      setTimeout(() => {
        worker.removeEventListener("message", responseHandler);
        console.warn(`[MANAGER] Timeout waiting for interrupt response from kernel ${id}`);
        resolve(false);
      }, 5000); // 5 second timeout
    });
  }
}