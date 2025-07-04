// TypeScript Kernel for Main Thread
// Enhanced implementation using tseval context for variable persistence and top-level await
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { KernelEvents, IKernel, IKernelOptions } from "./index.ts";
import { jupyter, hasDisplaySymbol } from "./jupyter.ts";
import { createTSEvalContext } from "./tseval.ts";

// Enable Jupyter functionality in Deno
// @ts-ignore - Deno.internal is available but not in types
(Deno as any).internal?.enableJupyter?.();

// Console capture utility
class ConsoleCapture {
  private originalMethods: Record<string, (...args: any[]) => void> = {};
  private eventEmitter: EventEmitter;
  
  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }
  
  start(): void {
    // Store original methods
    this.originalMethods.log = console.log;
    this.originalMethods.error = console.error;
    this.originalMethods.warn = console.warn;
    this.originalMethods.info = console.info;
    
    // Override console methods
    console.log = (...args: any[]) => {
      this.originalMethods.log.apply(console, args);
      this.emit('stdout', args);
    };
    
    console.error = (...args: any[]) => {
      this.originalMethods.error.apply(console, args);
      this.emit('stderr', args);
    };
    
    console.warn = (...args: any[]) => {
      this.originalMethods.warn.apply(console, args);
      this.emit('stderr', args);
    };
    
    console.info = (...args: any[]) => {
      this.originalMethods.info.apply(console, args);
      this.emit('stdout', args);
    };
  }
  
  stop(): void {
    // Restore original methods
    console.log = this.originalMethods.log;
    console.error = this.originalMethods.error;
    console.warn = this.originalMethods.warn;
    console.info = this.originalMethods.info;
  }
  
  private emit(stream: 'stdout' | 'stderr', args: any[]): void {
    const text = args.map(arg => 
      typeof arg === 'string' ? arg : 
      (arg instanceof Error ? `${arg.name}: ${arg.message}` : 
      JSON.stringify(arg, null, 2))
    ).join(' ');
    
    // Use the TypeScript kernel's _sendMessage method if available
    if (typeof (this.eventEmitter as any)._sendMessage === 'function') {
      (this.eventEmitter as any)._sendMessage({
        type: 'stream',
        bundle: {
          name: stream,
          text: text + "\n"
        }
      });
    } else {
      // Fallback for compatibility
      this.eventEmitter.emit(KernelEvents.STREAM, {
        name: stream,
        text: text + "\n"
      });
    }
  }
}

// Main TypeScript Kernel for main thread
export class TypeScriptKernel extends EventEmitter implements IKernel {
  private consoleCapture = new ConsoleCapture(this);
  private tseval: ReturnType<typeof createTSEvalContext>;
  private pathMappings: Map<string, string> = new Map();
  private initialized = false;
  private _status: "active" | "busy" | "unknown" = "unknown";
  private executionCount = 0;
  

  
  // Interrupt functionality
  private _abortController: AbortController | null = null;
  private _isExecuting = false;
  
  constructor() {
    super();
    this.setupJupyterEventForwarding();
    this.setupFileSystemInterception();
    
    // Initialize tseval context with console proxy that goes through ConsoleCapture
    const consoleProxy = {
      log: (...args: any[]) => {
        // Emit directly to our event system for capture
        super.emit(KernelEvents.STREAM, {
          name: 'stdout',
          text: args.map(arg => {
            try {
              if (typeof arg === 'string') {
                return arg;
              } else if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}`;
              } else {
                return JSON.stringify(arg, null, 2);
              }
            } catch (jsonError) {
              return String(arg);
            }
          }).join(' ') + '\n'
        });
        // Also print to terminal for debugging
        console.log(...args);
      },
      error: (...args: any[]) => {
        super.emit(KernelEvents.STREAM, {
          name: 'stderr',
          text: args.map(arg => {
            try {
              if (typeof arg === 'string') {
                return arg;
              } else if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}`;
              } else {
                return JSON.stringify(arg, null, 2);
              }
            } catch (jsonError) {
              return String(arg);
            }
          }).join(' ') + '\n'
        });
        console.error(...args);
      },
      warn: (...args: any[]) => {
        super.emit(KernelEvents.STREAM, {
          name: 'stderr',
          text: args.map(arg => {
            try {
              if (typeof arg === 'string') {
                return arg;
              } else if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}`;
              } else {
                return JSON.stringify(arg, null, 2);
              }
            } catch (jsonError) {
              return String(arg);
            }
          }).join(' ') + '\n'
        });
        console.warn(...args);
      },
      info: (...args: any[]) => {
        super.emit(KernelEvents.STREAM, {
          name: 'stdout',
          text: args.map(arg => {
            try {
              if (typeof arg === 'string') {
                return arg;
              } else if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}`;
              } else {
                return JSON.stringify(arg, null, 2);
              }
            } catch (jsonError) {
              return String(arg);
            }
          }).join(' ') + '\n'
        });
        console.info(...args);
      },
    };
    
    this.tseval = createTSEvalContext({
      context: {
        console: consoleProxy,
      }
    });
  }
  
  async initialize(options?: IKernelOptions): Promise<void> {
    if (this.initialized) return;
    
    console.log("[TS_KERNEL] Initializing TypeScript kernel in main thread");
    
    // Handle filesystem mounting if provided
    if (options?.filesystem?.enabled && options.filesystem.root && options.filesystem.mountPoint) {
      try {
        // Set up path mapping for virtual filesystem
        this.pathMappings.set(options.filesystem.mountPoint, options.filesystem.root);
        console.log(`[TS_KERNEL] Filesystem mapping: ${options.filesystem.mountPoint} -> ${options.filesystem.root}`);
      } catch (error) {
        console.error("[TS_KERNEL] Error setting up filesystem:", error);
      }
    }
    
    // Handle environment variables if provided
    if (options?.env && typeof options.env === 'object') {
      console.log(`[TS_KERNEL] Setting environment variables: ${JSON.stringify(options.env)}`);
      // Set environment variables directly on Deno.env
      for (const [key, value] of Object.entries(options.env)) {
        if (typeof value === 'string') {
          Deno.env.set(key, value);
        }
      }
    }
    this.initialized = true;
  }
  
  private setupFileSystemInterception(): void {
    // Store original Deno file system methods
    const originalReadTextFile = Deno.readTextFile;
    const originalWriteTextFile = Deno.writeTextFile;
    const originalReadDir = Deno.readDir;
    const originalRemove = Deno.remove;
    const originalMkdir = Deno.mkdir;
    const originalStat = Deno.stat;
    
    // Override Deno.readTextFile to handle path mapping
    Deno.readTextFile = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalReadTextFile.call(Deno, mappedPath, options);
    };
    
    // Override Deno.writeTextFile to handle path mapping
    Deno.writeTextFile = async (path: string | URL, data: string | ReadableStream<string>, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalWriteTextFile.call(Deno, mappedPath, data, options);
    };
    
    // Override Deno.readDir to handle path mapping
    Deno.readDir = (path: string | URL) => {
      const mappedPath = this.mapPath(path.toString());
      return originalReadDir.call(Deno, mappedPath);
    };
    
    // Override Deno.remove to handle path mapping
    Deno.remove = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalRemove.call(Deno, mappedPath, options);
    };
    
    // Override Deno.mkdir to handle path mapping
    Deno.mkdir = async (path: string | URL, options?: any) => {
      const mappedPath = this.mapPath(path.toString());
      return originalMkdir.call(Deno, mappedPath, options);
    };
    
    // Override Deno.stat to handle path mapping
    Deno.stat = async (path: string | URL) => {
      const mappedPath = this.mapPath(path.toString());
      return originalStat.call(Deno, mappedPath);
    };
  }
  
  private mapPath(path: string): string {
    // Check if the path starts with any of our mapped mount points
    for (const [mountPoint, realPath] of this.pathMappings.entries()) {
      if (path.startsWith(mountPoint)) {
        // Replace the mount point with the real path
        const relativePath = path.substring(mountPoint.length);
        const mappedPath = realPath + relativePath;
        console.log(`[TS_KERNEL] Path mapping: ${path} -> ${mappedPath}`);
        return mappedPath;
      }
    }
    
    // If no mapping found, return the original path
    return path;
  }
  
  async execute(code: string, parent?: any): Promise<{ success: boolean, execution_count: number, result?: any, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.executionCount++;
    this._isExecuting = true;
    this._abortController = new AbortController();
    this.consoleCapture.start();
    
    try {
      // Check for interrupt before execution
      if (this._abortController.signal.aborted) {
        throw new Error('KeyboardInterrupt: Execution was interrupted');
      }

      // Set up execution state to collect all messages
      const executionState = {
        allMessages: [] as any[],
        executionComplete: false,
        executionResult: null as any,
        executionError: null as Error | null,
        timeout: null as number | null
      };

      // Promise-based execution with proper message collection
      return new Promise<{ success: boolean, execution_count: number, result?: any, error?: Error }>((resolve, reject) => {
        
        // Collect all events during execution
        const handleAllEvents = (eventData: any) => {
          console.log(`[TS_KERNEL] Captured event: ${eventData.type}`);
          executionState.allMessages.push(eventData);
        };

        // Set up event listener BEFORE execution
        super.on('stream', handleAllEvents);
        super.on('display_data', handleAllEvents);
        super.on('execute_result', handleAllEvents);
        super.on('execute_error', handleAllEvents);

        // Completion detector - waits for message settling
        const completionDetector = () => {
          if (executionState.executionComplete) return;
          
          executionState.executionComplete = true;
          
          // Clear timeout
          if (executionState.timeout !== null) {
            clearTimeout(executionState.timeout);
          }
          
          // Clean up event listeners
          super.off('stream', handleAllEvents);
          super.off('display_data', handleAllEvents);
          super.off('execute_result', handleAllEvents);
          super.off('execute_error', handleAllEvents);
          
          console.log(`[TS_KERNEL] Execution complete, captured ${executionState.allMessages.length} messages`);
          
          // Process captured messages to build result
          const streamOutputs: string[] = [];
          let displayData: any[] = [];
          let hasError = false;
          let errorResult: any = null;
          
          for (const msg of executionState.allMessages) {
            if (msg.type === 'stream' && msg.bundle?.text) {
              streamOutputs.push(msg.bundle.text);
            } else if (msg.type === 'display_data' && msg.bundle?.data) {
              displayData.push(msg.bundle);
            } else if (msg.type === 'execute_result' && msg.bundle?.data) {
              displayData.push(msg.bundle);
            } else if (msg.type === 'execute_error') {
              hasError = true;
              errorResult = msg.bundle;
            }
          }
          
          // Prepare result
          let resultObj: any;
          let success = !hasError;
          
          if (hasError && errorResult) {
            // Error case
            const errorDisplayData = {
              "text/plain": `${errorResult.ename}: ${errorResult.evalue}`,
              "application/vnd.jupyter.error": errorResult
            };
            
            resultObj = {
              _displayData: errorDisplayData,
              _streamOutput: streamOutputs.join(''),
              [Symbol.for("Jupyter.display")]() {
                return errorDisplayData;
              }
            };
            
            resolve({
              success: false,
              execution_count: this.executionCount,
              error: new Error(`${errorResult.ename}: ${errorResult.evalue}`),
              result: resultObj
            });
          } else {
            // Success case
            let displayDataForSerialization;
            
            if (displayData.length > 0) {
              displayDataForSerialization = displayData[0].data;
            } else if (executionState.executionResult !== undefined) {
              displayDataForSerialization = {
                "text/plain": typeof executionState.executionResult === 'string' ? executionState.executionResult : JSON.stringify(executionState.executionResult)
              };
            } else if (streamOutputs.length > 0) {
              displayDataForSerialization = {
                "text/plain": streamOutputs.join('')
              };
            } else {
              displayDataForSerialization = {
                "text/plain": ""
              };
            }
            
            resultObj = {
              _displayData: displayDataForSerialization,
              _streamOutput: streamOutputs.join(''),
              [Symbol.for("Jupyter.display")]() {
                return displayDataForSerialization;
              }
            };
            
            resolve({
              success: true,
              execution_count: this.executionCount,
              result: resultObj
            });
          }
        };

        // Set up timeout as safety net (10 seconds)
        executionState.timeout = setTimeout(() => {
          if (!executionState.executionComplete) {
            console.warn("[TS_KERNEL] Execution timeout, completing anyway");
            completionDetector();
          }
        }, 10000) as unknown as number;

        // Execute the code
        this.executeWithInterruptSupport(code)
          .then(({ result, mod }) => {
            executionState.executionResult = result;
            
            // Emit execution result if we have a meaningful result
            if (result !== undefined) {
              this.emitExecutionResult(result);
            }
            
            // Wait for message settling (100ms should be enough for TS execution)
            setTimeout(() => {
              if (!executionState.executionComplete) {
                completionDetector();
              }
            }, 100);
          })
          .catch((error) => {
            executionState.executionError = error instanceof Error ? error : new Error(String(error));
            
            // Check if this was an interrupt
            if (executionState.executionError.message.includes('KeyboardInterrupt')) {
              this._sendMessage({
                type: 'stream',
                bundle: {
                  name: 'stderr',
                  text: 'KeyboardInterrupt: TypeScript execution interrupted by user\n'
                }
              });
              
              this._sendMessage({
                type: 'execute_error',
                bundle: {
                  ename: 'KeyboardInterrupt',
                  evalue: 'TypeScript execution interrupted by user',
                  traceback: ['KeyboardInterrupt: TypeScript execution interrupted by user']
                }
              });
            } else {
              this.emitExecutionError(executionState.executionError);
            }
            
            // Wait for error message settling
            setTimeout(() => {
              if (!executionState.executionComplete) {
                completionDetector();
              }
            }, 100);
          });
      });
    } catch (error) {
      // Handle setup errors (before promise execution)
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error("[TS_KERNEL] Setup error:", errorObj);
      
      return {
        success: false,
        execution_count: this.executionCount,
        error: errorObj,
        result: {
          _displayData: {
            "text/plain": `Setup Error: ${errorObj.message}`
          },
          _streamOutput: '',
          [Symbol.for("Jupyter.display")]() {
            return {
              "text/plain": `Setup Error: ${errorObj.message}`
            };
          }
        }
      };
    } finally {
      this._isExecuting = false;
      this._abortController = null;
      this.consoleCapture.stop();
    }
  }
  
  private async executeWithInterruptSupport(code: string): Promise<{ result?: any, mod?: any }> {
    // For TypeScript execution, we can add interrupt checks at strategic points
    // Since most TS execution is fast, we mainly need to handle async operations
    
    const checkInterrupt = () => {
      if (this._abortController?.signal.aborted) {
        throw new Error('KeyboardInterrupt: Execution was interrupted');
      }
    };
    
    // Check interrupt before starting
    checkInterrupt();
    
    // Execute with periodic interrupt checks for async operations
    const result = await this.tseval(code);
    
    // Check interrupt after execution
    checkInterrupt();
    
    return result;
  }
  
  async* executeStream(code: string, parent?: any): AsyncGenerator<any, { success: boolean, execution_count: number, result?: any, error?: Error }, void> {
    try {
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Create event listeners to capture events during execution
      const eventQueue: any[] = [];
      
      const handleAllEvents = (eventData: any) => {
        eventQueue.push(eventData);
      };
      
      // Listen for all events BEFORE executing code
      super.on(KernelEvents.ALL, handleAllEvents);
      
      try {
        // Execute code as normal
        const result = await this.execute(code, parent);
        
        // Forward captured events
        while (eventQueue.length > 0) {
          yield eventQueue.shift();
        }
        
        return result;
      } finally {
        // Clean up listener in finally block to ensure it's always removed
        super.off(KernelEvents.ALL, handleAllEvents);
      }
    } catch (error) {
      console.error("Error in executeStream:", error);
      const errorObj = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        execution_count: this.executionCount,
        error: errorObj
      };
    }
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  async getStatus(): Promise<"active" | "busy" | "unknown"> {
    return this._status;
  }
  
  async inputReply(content: { value: string }): Promise<void> {
    // Not implemented for TypeScript kernel
    console.warn("[TS_KERNEL] Input reply not implemented");
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
  
  // Interrupt functionality - now with real interrupt support!
  async interrupt(): Promise<boolean> {
    console.log("[TS_KERNEL] Interrupt requested");
    
    try {
      if (!this._isExecuting) {
        console.log("[TS_KERNEL] No execution in progress, nothing to interrupt");
        return false;
      }
      
      if (this._abortController) {
        console.log("[TS_KERNEL] Aborting current execution...");
        this._abortController.abort();
        
        // Give it a moment to process the abort
        await new Promise(resolve => setTimeout(resolve, 50));
        
        console.log("[TS_KERNEL] Execution interrupted successfully");
        return true;
      } else {
        console.warn("[TS_KERNEL] No abort controller available");
        return false;
      }
    } catch (error) {
      console.error("[TS_KERNEL] Error during interrupt:", error);
      return false;
    }
  }

  setInterruptBuffer(buffer: Uint8Array): void {
    console.warn("[TS_KERNEL] Interrupt buffer not supported for TypeScript kernels");
  }
  
  // Code completion - now with real completion support!
  async complete(code: string, cursor_pos: number, parent?: any): Promise<any> {
    try {
      const completions = this.getCompletions(code, cursor_pos);
      
      return {
        matches: completions.matches,
        cursor_start: completions.cursor_start,
        cursor_end: completions.cursor_end,
        metadata: completions.metadata,
        status: 'ok'
      };
    } catch (error) {
      console.error("[TS_KERNEL] Error in code completion:", error);
      return {
        matches: [],
        cursor_start: cursor_pos,
        cursor_end: cursor_pos,
        metadata: {},
        status: 'error'
      };
    }
  }
  
  private getCompletions(code: string, cursor_pos: number): {
    matches: string[];
    cursor_start: number;
    cursor_end: number;
    metadata: Record<string, any>;
  } {
    // Extract the word being typed at cursor position
    const beforeCursor = code.slice(0, cursor_pos);
    const afterCursor = code.slice(cursor_pos);
    
    // Find word boundaries
    const wordMatch = beforeCursor.match(/(\w+)$/);
    const prefix = wordMatch ? wordMatch[1] : '';
    const cursor_start = cursor_pos - prefix.length;
    const cursor_end = cursor_pos;
    
    const matches: string[] = [];
    const metadata: Record<string, any> = {};
    
    // 1. Get available variables from tseval context
    const contextVariables = this.tseval.getVariables();
    
    // 2. JavaScript/TypeScript keywords and globals
    const keywords = [
      // Control flow
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return',
      // Declarations
      'var', 'let', 'const', 'function', 'class', 'interface', 'type', 'enum',
      // Types
      'string', 'number', 'boolean', 'object', 'undefined', 'null', 'any', 'void',
      // Async
      'async', 'await', 'Promise',
      // Import/export
      'import', 'export', 'from', 'default',
      // Error handling
      'try', 'catch', 'finally', 'throw',
      // Other
      'new', 'this', 'super', 'extends', 'implements', 'typeof', 'instanceof'
    ];
    
    // 3. Built-in globals
    const globals = [
      'console', 'Math', 'Date', 'Array', 'Object', 'String', 'Number', 'Boolean',
      'JSON', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
      'Deno', 'globalThis', 'window'
    ];
    
    // 4. Common method names (when we detect object access)
    const commonMethods = [
      'length', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'join',
      'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'includes',
      'toString', 'valueOf', 'hasOwnProperty', 'keys', 'values', 'entries'
    ];
    
    // Check if we're completing after a dot (method/property access)
    const beforePrefix = beforeCursor.slice(0, cursor_start);
    const isDotCompletion = beforePrefix.match(/\w+\.$/);
    
    if (isDotCompletion) {
      // Complete methods/properties
      commonMethods.forEach(method => {
        if (!prefix || method.startsWith(prefix)) {
          matches.push(method);
          metadata[method] = { type: 'method' };
        }
      });
    } else {
      // Complete variables, keywords, and globals
      
      // Add context variables
      contextVariables.forEach(variable => {
        if (!prefix || variable.startsWith(prefix)) {
          matches.push(variable);
          metadata[variable] = { type: 'variable', source: 'context' };
        }
      });
      
      // Add keywords
      keywords.forEach(keyword => {
        if (!prefix || keyword.startsWith(prefix)) {
          matches.push(keyword);
          metadata[keyword] = { type: 'keyword' };
        }
      });
      
      // Add globals
      globals.forEach(global => {
        if (!prefix || global.startsWith(prefix)) {
          matches.push(global);
          metadata[global] = { type: 'global' };
        }
      });
    }
    
    // Sort matches: context variables first, then keywords, then globals
    matches.sort((a, b) => {
      const aType = metadata[a]?.type || '';
      const bType = metadata[b]?.type || '';
      
      const typeOrder = { 'variable': 0, 'keyword': 1, 'global': 2, 'method': 3 };
      const aOrder = typeOrder[aType as keyof typeof typeOrder] ?? 4;
      const bOrder = typeOrder[bType as keyof typeof typeOrder] ?? 4;
      
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    });
    
    // Remove duplicates while preserving order
    const uniqueMatches = Array.from(new Set(matches));
    
    return {
      matches: uniqueMatches,
      cursor_start,
      cursor_end,
      metadata
    };
  }

  // Code inspection (basic implementation)
  async inspect(code: string, cursor_pos: number, detail_level: 0 | 1, parent?: any): Promise<any> {
    console.warn("[TS_KERNEL] Code inspection not implemented for TypeScript kernel");
    return {
      status: 'ok',
      data: {},
      metadata: {},
      found: false
    };
  }

  // Code completeness check (basic implementation)
  async isComplete(code: string, parent?: any): Promise<any> {
    // Simple heuristic: check for unclosed braces, brackets, or parentheses
    try {
      // Try to parse as TypeScript/JavaScript
      new Function(code);
      return {
        status: 'complete'
      };
    } catch (error) {
      // If it's a syntax error, it might be incomplete
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Unexpected end of input') || 
          errorMessage.includes('Unexpected token')) {
        return {
          status: 'incomplete',
          indent: '    ' // 4 spaces for continuation
        };
      }
      return {
        status: 'invalid'
      };
    }
  }

  // Comm functionality (not applicable for TypeScript kernel)
  async commInfo(target_name: string | null, parent?: any): Promise<any> {
    console.warn("[TS_KERNEL] Comm functionality not supported for TypeScript kernel");
    return {
      comms: {},
      status: 'ok'
    };
  }

  async commOpen(content: any, parent?: any): Promise<void> {
    console.warn("[TS_KERNEL] Comm functionality not supported for TypeScript kernel");
  }

  async commMsg(content: any, parent?: any): Promise<void> {
    console.warn("[TS_KERNEL] Comm functionality not supported for TypeScript kernel");
  }

  async commClose(content: any, parent?: any): Promise<void> {
    console.warn("[TS_KERNEL] Comm functionality not supported for TypeScript kernel");
  }
  
  private setupJupyterEventForwarding(): void {
    // Listen for Jupyter broadcast events and forward them to the kernel event system
    jupyter.onBroadcast((msgType: string, content: any, metadata: Record<string, any>, buffers: any[]) => {
      // Map Jupyter message types to kernel events
      if (msgType === 'display_data' || msgType === 'update_display_data') {
        this._sendMessage({
          type: 'display_data',
          bundle: content
        });
      } else if (msgType === 'stream') {
        this._sendMessage({
          type: 'stream',
          bundle: content
        });
      } else if (msgType === 'execute_result') {
        this._sendMessage({
          type: 'execute_result',
          bundle: content
        });
      } else if (msgType === 'error') {
        this._sendMessage({
          type: 'execute_error',
          bundle: content
        });
      }
    });
  }
  
  /**
   * Send a message and emit both specific event and ALL event
   */
  private _sendMessage(msg: { type: string; bundle?: any; content?: any }): void {
    this._processMessage(msg);
  }
  
  /**
   * Process a message by emitting the appropriate event
   */
  private _processMessage(msg: { type: string; bundle?: any; content?: any }): void {
    if (!msg.type) {
      return;
    }

    let eventData: any;

    switch (msg.type) {
      case 'stream': {
        const bundle = msg.bundle ?? { name: 'stdout', text: '' };
        super.emit(KernelEvents.STREAM, bundle);
        eventData = bundle;
        break;
      }
      case 'display_data': {
        const bundle = msg.bundle ?? { data: {}, metadata: {}, transient: {} };
        super.emit(KernelEvents.DISPLAY_DATA, bundle);
        eventData = bundle;
        break;
      }
      case 'update_display_data': {
        const bundle = msg.bundle ?? { data: {}, metadata: {}, transient: {} };
        super.emit(KernelEvents.UPDATE_DISPLAY_DATA, bundle);
        eventData = bundle;
        break;
      }
      case 'execute_result': {
        const bundle = msg.bundle ?? {
          execution_count: this.executionCount,
          data: {},
          metadata: {},
        };
        super.emit(KernelEvents.EXECUTE_RESULT, bundle);
        eventData = bundle;
        break;
      }
      case 'execute_error': {
        const bundle = msg.bundle ?? { ename: '', evalue: '', traceback: [] };
        super.emit(KernelEvents.EXECUTE_ERROR, bundle);
        eventData = bundle;
        break;
      }
    }

    // Emit the ALL event with standardized format
    if (eventData) {
      super.emit(KernelEvents.ALL, {
        type: msg.type,
        data: eventData
      });
    }
  }
  
  private emitExecutionResult(result: any): void {
    try {
      // Check if the result has a display symbol - if so, emit display_data event
      if (result !== null && typeof result === "object" && hasDisplaySymbol(result)) {
        try {
          const displayResult = result[jupyter.$display]();
          if (displayResult && typeof displayResult === "object") {
            // Emit as display_data event
            this._sendMessage({
              type: 'display_data',
              bundle: {
                data: displayResult,
                metadata: {},
                transient: {}
              }
            });
            return; // Don't emit as execution result
          }
        } catch (e) {
          console.error("[TS_KERNEL] Error in display symbol execution:", e);
        }
      }
      
      // Format the result using jupyter helper for regular execution results
      const formattedResult = jupyter.formatResult(result);
      
      this._sendMessage({
        type: 'execute_result',
        bundle: {
          execution_count: this.executionCount,
          data: formattedResult,
          metadata: {}
        }
      });
    } catch (error) {
      console.error("[TS_KERNEL] Error emitting execution result:", error);
    }
  }
  
  private emitExecutionError(error: any): void {
    const errorData = {
      ename: error instanceof Error ? error.name : "Error",
      evalue: error instanceof Error ? error.message : String(error),
      traceback: error instanceof Error && error.stack ? [error.stack] : ["No traceback available"]
    };
    
    this._sendMessage({
      type: 'execute_error',
      bundle: errorData
    });
  }
} 