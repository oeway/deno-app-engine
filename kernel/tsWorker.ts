// TypeScript Web Worker for Deno App Engine
// Enhanced implementation using tseval context for variable persistence and top-level await
import * as Comlink from "comlink";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { KernelEvents } from "./index.ts";
import { jupyter, hasDisplaySymbol } from "./jupyter.ts";
import { createTSEvalContext } from "./tseval.ts";

// Console capture utility
class ConsoleCapture {
  private originalMethods: Record<string, (...args: any[]) => void> = {};
  private eventEmitter: EventEmitter;
  private isEmitting = false; // Recursion guard
  
  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
    this.originalMethods = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console)
    };
  }
  
  start(): void {
    // Override console methods
    console.log = (...args: any[]) => {
      this.originalMethods.log.apply(console, args);
      this.safeEmit('stdout', args);
    };
    
    console.error = (...args: any[]) => {
      this.originalMethods.error.apply(console, args);
      this.safeEmit('stderr', args);
    };
    
    console.warn = (...args: any[]) => {
      this.originalMethods.warn.apply(console, args);
      this.safeEmit('stderr', args);
    };
    
    console.info = (...args: any[]) => {
      this.originalMethods.info.apply(console, args);
      this.safeEmit('stdout', args);
    };
  }
  
  stop(): void {
    // Restore original methods
    console.log = this.originalMethods.log;
    console.error = this.originalMethods.error;
    console.warn = this.originalMethods.warn;
    console.info = this.originalMethods.info;
  }
  
  private safeEmit(stream: 'stdout' | 'stderr', args: any[]): void {
    // Guard against recursion
    if (this.isEmitting) {
      return;
    }
    
    try {
      this.isEmitting = true;
      this.emit(stream, args);
    } catch (error) {
      // If emit fails, use original console methods to avoid recursion
      this.originalMethods.error('[ConsoleCapture] Failed to emit:', error);
    } finally {
      this.isEmitting = false;
    }
  }
  
  private emit(stream: 'stdout' | 'stderr', args: any[]): void {
    const text = args.map(arg => {
      try {
        if (typeof arg === 'string') {
          return arg;
        } else if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}`;
        } else {
          return JSON.stringify(arg, null, 2);
        }
      } catch (jsonError) {
        // Handle circular references and other JSON.stringify errors
        return String(arg);
      }
    }).join(' ');
    
    this.eventEmitter.emit(KernelEvents.STREAM, {
      name: stream,
      text: text + "\n"
    });
  }
}

// Main TypeScript Kernel
class TypeScriptKernel {
  private eventEmitter = new EventEmitter();
  private consoleCapture = new ConsoleCapture(this.eventEmitter);
  private tseval: ReturnType<typeof createTSEvalContext>;
  private eventPort: MessagePort | null = null;
  private initialized = false;
  private pathMappings: Map<string, string> = new Map();
  private _status: "active" | "busy" | "unknown" = "unknown";
  private executionCount = 0;
  
  // Environment variables
  private environmentVariables: Record<string, string> = {};
  
  constructor() {
    this.setupEventForwarding();
    this.setupJupyterEventForwarding();
    this.setupFileSystemInterception();
    
    // Initialize tseval context with console proxy
    const consoleProxy = {
      log: (...args: any[]) => console.log("[worker]", ...args),
      error: (...args: any[]) => console.error("[worker]", ...args),
      warn: (...args: any[]) => console.warn("[worker]", ...args),
      info: (...args: any[]) => console.info("[worker]", ...args),
    };
    
    this.tseval = createTSEvalContext({
      context: {
        console: consoleProxy,
      }
    });
  }
  
  setEventPort(port: MessagePort): void {
    this.eventPort = port;
  }
  
  async initialize(options?: any): Promise<void> {
    if (this.initialized) return;
    
    console.log("[TS_WORKER] Initializing TypeScript/JavaScript kernel");
    
    // Handle filesystem mounting if provided
    if (options?.filesystem?.enabled && options.filesystem.root && options.filesystem.mountPoint) {
      try {
        this.pathMappings.set(options.filesystem.mountPoint, options.filesystem.root);
        console.log(`[TS_WORKER] Filesystem mapping: ${options.filesystem.mountPoint} -> ${options.filesystem.root}`);
      } catch (error) {
        console.error("[TS_WORKER] Error setting up filesystem:", error);
      }
    }
    
    // Handle environment variables if provided
    if (options?.env) {
      this.environmentVariables = { ...options.env };
      // Set up global ENVIRONS object for TypeScript/JavaScript and add to context
      (globalThis as any).ENVIRONS = { ...this.environmentVariables };
      
      // Add environment variables to tseval context
      await this.tseval(`
        globalThis.ENVIRONS = ${JSON.stringify(this.environmentVariables)};
        const ENVIRONS = globalThis.ENVIRONS;
      `);
      
      console.log(`[TS_WORKER] Set ${Object.keys(this.environmentVariables).length} environment variables in ENVIRONS`);
    }
    
    this.initialized = true;
    
    if (this.eventPort) {
      this.eventPort.postMessage({
        type: "KERNEL_INITIALIZED",
        data: { success: true }
      });
    }
  }
  
  async execute(code: string, parent?: any): Promise<{ success: boolean, result?: any, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.executionCount++;
    this.consoleCapture.start();
    
    try {
      // Use tseval for execution
      const { result, mod } = await this.tseval(code);
      
      // Emit execution result if we have a meaningful result
      if (result !== undefined) {
        this.emitExecutionResult(result);
      }
      
      return { success: true, result };
    } catch (error) {
      console.error("[TS_WORKER] Execution error:", error);
      
      this.emitExecutionError(error);
      
      // Ensure error is properly structured
      const structuredError = error instanceof Error ? error : new Error(String(error));
      
      return { 
        success: false, 
        error: structuredError
      };
    } finally {
      this.consoleCapture.stop();
    }
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  async getStatus(): Promise<"active" | "busy" | "unknown"> {
    return this._status;
  }
  
  async inputReply(content: { value: string }): Promise<void> {
    console.warn("[TS_WORKER] Input reply not implemented");
  }
  
  // Get execution history from tseval context
  getHistory(): string[] {
    return this.tseval.getHistory();
  }
  
  // Get current variables from tseval context
  getVariables(): string[] {
    return this.tseval.getVariables();
  }
  
  // Reset the execution context
  resetContext(): void {
    this.tseval.reset();
    this.executionCount = 0;
  }
  
  private setupEventForwarding(): void {
    Object.values(KernelEvents).forEach((eventType) => {
      this.eventEmitter.on(eventType, (data: any) => {
        if (this.eventPort) {
          this.eventPort.postMessage({
            type: eventType,
            data: data
          });
        }
      });
    });
  }
  
  private setupJupyterEventForwarding(): void {
    jupyter.onBroadcast((msgType: string, content: any, metadata: Record<string, any>, buffers: any[]) => {
      // Map Jupyter message types to kernel events
      if (msgType === 'display_data' || msgType === 'update_display_data') {
        this.eventEmitter.emit(KernelEvents.DISPLAY_DATA, content);
      } else if (msgType === 'stream') {
        this.eventEmitter.emit(KernelEvents.STREAM, content);
      } else if (msgType === 'execute_result') {
        this.eventEmitter.emit(KernelEvents.EXECUTE_RESULT, content);
      } else if (msgType === 'error') {
        this.eventEmitter.emit(KernelEvents.EXECUTE_ERROR, content);
      }
    });
  }
  
  private setupFileSystemInterception(): void {
    // Store original Deno file system methods
    const originalReadTextFile = Deno.readTextFile;
    const originalWriteTextFile = Deno.writeTextFile;
    const originalReadDir = Deno.readDir;
    const originalRemove = Deno.remove;
    const originalMkdir = Deno.mkdir;
    const originalStat = Deno.stat;
    
    // Override file system methods to handle path mapping
    Deno.readTextFile = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalReadTextFile.call(Deno, mappedPath, options);
    };
    
    Deno.writeTextFile = async (path: string | URL, data: string | ReadableStream<string>, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalWriteTextFile.call(Deno, mappedPath, data, options);
    };
    
    Deno.readDir = (path: string | URL) => {
      const mappedPath = this.mapPath(path.toString());
      return originalReadDir.call(Deno, mappedPath);
    };
    
    Deno.remove = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalRemove.call(Deno, mappedPath, options);
    };
    
    Deno.mkdir = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalMkdir.call(Deno, mappedPath, options);
    };
    
    Deno.stat = async (path: string | URL) => {
      const mappedPath = this.mapPath(path.toString());
      return originalStat.call(Deno, mappedPath);
    };
  }
  
  private mapPath(path: string): string {
    // Check if the path starts with any of our mapped mount points
    for (const [mountPoint, realPath] of this.pathMappings.entries()) {
      if (path.startsWith(mountPoint)) {
        const relativePath = path.substring(mountPoint.length);
        const mappedPath = realPath + relativePath;
        console.log(`[TS_WORKER] Path mapping: ${path} -> ${mappedPath}`);
        return mappedPath;
      }
    }
    
    return path;
  }
  
  private emitExecutionResult(result: any): void {
    try {
      // Check if the result has a display symbol - if so, emit display_data event
      if (result !== null && typeof result === "object" && hasDisplaySymbol(result)) {
        try {
          const displayResult = result[jupyter.$display]();
          if (displayResult && typeof displayResult === "object") {
            this.eventEmitter.emit(KernelEvents.DISPLAY_DATA, {
              data: displayResult,
              metadata: {},
              transient: {}
            });
            return;
          }
        } catch (e) {
          console.error("[TS_WORKER] Error in display symbol execution:", e);
        }
      }
      
      // Format the result using jupyter helper for regular execution results
      const formattedResult = jupyter.formatResult(result);
      
      this.eventEmitter.emit(KernelEvents.EXECUTE_RESULT, {
        execution_count: this.executionCount,
        data: formattedResult,
        metadata: {}
      });
    } catch (error) {
      console.error("[TS_WORKER] Error emitting execution result:", error);
    }
  }
  
  private emitExecutionError(error: any): void {
    const errorData = {
      ename: error instanceof Error ? error.name : "Error",
      evalue: error instanceof Error ? error.message : String(error),
      traceback: error instanceof Error && error.stack ? [error.stack] : ["No traceback available"]
    };
    
    this.eventEmitter.emit(KernelEvents.EXECUTE_ERROR, errorData);
  }
}

// Add global error handlers to prevent unhandled errors
self.addEventListener('error', (event) => {
  console.error('[TS_WORKER] Global error caught:', event.error);
  event.preventDefault();
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('[TS_WORKER] Unhandled promise rejection:', event.reason);
  event.preventDefault();
});

// Global kernel instance
const kernel = new TypeScriptKernel();

// Message handling
self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_EVENT_PORT" && event.data?.port) {
    kernel.setEventPort(event.data.port);
  } else if (event.data?.type === "INITIALIZE_KERNEL") {
    kernel.initialize(event.data.options).catch(error => {
      console.error("[TS_WORKER] Error initializing kernel:", error);
    });
  } else if (event.data?.type === "SET_INTERRUPT_BUFFER") {
    // TypeScript kernels don't support interrupt buffers like Python/Pyodide
    console.log("[TS_WORKER] Interrupt buffer not supported for TypeScript kernels");
    self.postMessage({
      type: "INTERRUPT_BUFFER_SET"
    });
  }
});

// Cleanup on termination
self.addEventListener("beforeunload", () => {
  try {
    console.log("[TS_WORKER] TypeScript worker shutting down");
  } catch (error) {
    console.error("[TS_WORKER] Error during cleanup:", error);
  }
});

// Expose kernel interface via Comlink
const kernelInterface = {
  initialize: (options?: any) => kernel.initialize(options),
  execute: (code: string, parent?: any) => kernel.execute(code, parent),
  isInitialized: () => kernel.isInitialized(),
  inputReply: (content: { value: string }) => kernel.inputReply(content),
  getStatus: () => kernel.getStatus(),
  getHistory: () => kernel.getHistory(),
  getVariables: () => kernel.getVariables(),
  resetContext: () => kernel.resetContext()
};

Comlink.expose(kernelInterface); 