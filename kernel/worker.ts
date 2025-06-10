// Web Worker file for running the Kernel in a separate thread
// Import necessary modules
// @ts-ignore Import Comlink from Deno
import * as Comlink from "https://deno.land/x/comlink@4.4.1/mod.ts";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { Kernel, KernelEvents, IKernelOptions } from "./index.ts";

// Interface for kernel worker API
export interface IKernelWorkerAPI {
  initialize(options: IKernelOptions, eventCallback: (event: { type: string; data: any }) => void): Promise<void>;
  execute(code: string, parent?: any): Promise<{ success: boolean; result?: any; error?: Error }>;
  isInitialized(): boolean;
  inputReply(content: { value: string }): Promise<void>;
  getStatus(): "active" | "busy" | "unknown";
  interrupt(): Promise<boolean>;
  setInterruptBuffer(buffer: Uint8Array): boolean;
}

// Create kernel worker implementation
class KernelWorker implements IKernelWorkerAPI {
  private kernel = new Kernel();
  private eventCallback: ((event: { type: string; data: any }) => void) | null = null;
  private currentEventListeners: Map<string, (data: any) => void> = new Map();
  private interruptBuffer: Uint8Array | null = null;

  // Helper function to check if an error is a KeyboardInterrupt
  private isKeyboardInterrupt(error: any): boolean {
    return error && 
           typeof error === 'object' && 
           (error.type === "KeyboardInterrupt" || 
            (error.message && error.message.includes("KeyboardInterrupt")));
  }

  // Helper function to create KeyboardInterrupt error result
  private createKeyboardInterruptResult() {
    return {
      success: false,
      error: new Error("KeyboardInterrupt: Execution interrupted by user"),
      result: {
        payload: [],
        status: "error",
        ename: "KeyboardInterrupt",
        evalue: "Execution interrupted by user",
        traceback: ["KeyboardInterrupt: Execution interrupted by user"]
      }
    };
  }

  async initialize(options: IKernelOptions, eventCallback: (event: { type: string; data: any }) => void): Promise<void> {
    try {
      // Store the event callback
      this.eventCallback = eventCallback;
      
      // Initialize the kernel
      await this.kernel.initialize(options);
      
      // Set up the interrupt buffer if it's available
      if (this.interruptBuffer && typeof (this.kernel as any).setInterruptBuffer === 'function') {
        (this.kernel as any).setInterruptBuffer(this.interruptBuffer);
      }
      
      // Set up event forwarding
      this.setupEventForwarding();
      
      console.log("[WORKER] Kernel initialized successfully");
    } catch (error) {
      console.error("[WORKER] Kernel initialization failed:", error);
      throw error;
    }
  }

  async execute(code: string, parent?: any): Promise<{ success: boolean; result?: any; error?: Error }> {
    try {
      const result = await this.kernel.execute(code, parent);
      return result;
    } catch (error) {
      console.error("[WORKER] Execute error:", error);
      
      // Check if this is a KeyboardInterrupt and handle it specially
      if (this.isKeyboardInterrupt(error)) {
        console.log("[WORKER] KeyboardInterrupt caught in execute method");
        return this.createKeyboardInterruptResult();
      }
      
      // Handle other errors normally
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        result: {
          payload: [],
          status: "error",
          ename: error instanceof Error ? error.constructor.name : "Error",
          evalue: error instanceof Error ? error.message : String(error),
          traceback: error instanceof Error && error.stack ? error.stack.split('\n') : [String(error)]
        }
      };
    }
  }

  isInitialized(): boolean {
    return this.kernel.isInitialized();
  }

  async inputReply(content: { value: string }): Promise<void> {
    await this.kernel.inputReply(content);
  }

  getStatus(): "active" | "busy" | "unknown" {
    return (this.kernel as any).status || "unknown";
  }

  async interrupt(): Promise<boolean> {
    if (this.interruptBuffer) {
      // Set interrupt signal (2 = SIGINT)
      this.interruptBuffer[0] = 2;
      return true;
    }
    
    // Fallback to kernel interrupt method if available
    if (typeof (this.kernel as any).interrupt === 'function') {
      return await (this.kernel as any).interrupt();
    }
    
    return false;
  }

  setInterruptBuffer(buffer: Uint8Array): boolean {
    this.interruptBuffer = buffer;
    
    if (this.kernel.isInitialized() && typeof (this.kernel as any).setInterruptBuffer === 'function') {
      (this.kernel as any).setInterruptBuffer(buffer);
      return true;
    }
    
    return false;
  }

  private setupEventForwarding(): void {
    // Clean up old event listeners
    this.cleanupEventForwarding();

    // Forward all kernel events to the callback
    Object.values(KernelEvents).forEach((eventType) => {
      const listener = (data: any) => {
        if (this.eventCallback) {
          this.eventCallback({
            type: eventType,
            data: data
          });
        }
      };
      
      // Store the listener for later cleanup
      this.currentEventListeners.set(eventType, listener);
      
      // Add the listener to the kernel
      (this.kernel as unknown as EventEmitter).on(eventType, listener);
    });
  }

  private cleanupEventForwarding(): void {
    if (this.currentEventListeners.size > 0) {
      // Remove all current event listeners
      for (const [eventType, listener] of this.currentEventListeners.entries()) {
        (this.kernel as unknown as EventEmitter).off(eventType, listener);
      }
      
      // Clear the listeners map
      this.currentEventListeners.clear();
    }
  }
}

// Create worker instance
const worker = new KernelWorker();

// Global error handlers to prevent worker crashes
self.addEventListener("error", (event) => {
  console.error("[WORKER] Global error caught:", event.error);
  event.preventDefault();
});

self.addEventListener("unhandledrejection", (event) => {
  // Check if this is a KeyboardInterrupt
  const error = event.reason;
  if (error && 
      typeof error === 'object' && 
      (error.type === "KeyboardInterrupt" || 
       (error.message && error.message.includes("KeyboardInterrupt")))) {
    console.log("[WORKER] KeyboardInterrupt caught in unhandled rejection handler - this is expected during interrupts");
  } else {
    console.error("[WORKER] Unhandled promise rejection:", event.reason);
  }
  event.preventDefault();
});

// Expose the worker API via Comlink
Comlink.expose(worker); 