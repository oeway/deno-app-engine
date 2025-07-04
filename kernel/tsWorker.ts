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
  

  
  constructor() {
    this.setupEventForwarding();
    this.setupJupyterEventForwarding();
    this.setupFileSystemInterception();
    
    // Initialize tseval context with console proxy that goes through ConsoleCapture
    const consoleProxy = {
      log: (...args: any[]) => {
        const streamData = {
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
        };
        // Emit directly to our event system for capture
        this.eventEmitter.emit(KernelEvents.STREAM, streamData);
        // Also print to terminal for debugging
        console.log(...args);
      },
      error: (...args: any[]) => {
        this.eventEmitter.emit(KernelEvents.STREAM, {
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
        this.eventEmitter.emit(KernelEvents.STREAM, {
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
        this.eventEmitter.emit(KernelEvents.STREAM, {
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
    if (options?.env && typeof options.env === 'object') {
      console.log(`[TS_WORKER] Setting environment variables: ${JSON.stringify(options.env)}`);
      // Set environment variables directly on Deno.env
      for (const [key, value] of Object.entries(options.env)) {
        if (typeof value === 'string') {
          Deno.env.set(key, value);
        }
      }
    }
    
    this.initialized = true;
    
    if (this.eventPort) {
      this.eventPort.postMessage({
        type: "KERNEL_INITIALIZED",
        data: { success: true }
      });
    }
  }
  
  async execute(code: string, parent?: any): Promise<{ success: boolean, execution_count: number, result?: any, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.executionCount++;
    this.consoleCapture.start();
    
    try {
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
          // The eventData here is the actual stream data, we need to wrap it with type info
          const wrappedEvent = {
            type: 'stream', // We know this is from the stream event
            bundle: eventData
          };
          console.log(`[TS_WORKER] Captured event: stream`, eventData);
          executionState.allMessages.push(wrappedEvent);
        };

        // Set up event listeners for different types BEFORE execution
        const handleStreamEvent = (eventData: any) => {
          const wrappedEvent = { type: 'stream', bundle: eventData };
          executionState.allMessages.push(wrappedEvent);
        };
        
        const handleDisplayEvent = (eventData: any) => {
          const wrappedEvent = { type: 'display_data', bundle: eventData };
          executionState.allMessages.push(wrappedEvent);
        };
        
        const handleResultEvent = (eventData: any) => {
          const wrappedEvent = { type: 'execute_result', bundle: eventData };
          executionState.allMessages.push(wrappedEvent);
        };
        
        const handleErrorEvent = (eventData: any) => {
          const wrappedEvent = { type: 'execute_error', bundle: eventData };
          executionState.allMessages.push(wrappedEvent);
        };

        this.eventEmitter.on('stream', handleStreamEvent);
        this.eventEmitter.on('display_data', handleDisplayEvent);
        this.eventEmitter.on('execute_result', handleResultEvent);
        this.eventEmitter.on('execute_error', handleErrorEvent);

        // Completion detector - waits for message settling
        const completionDetector = () => {
          if (executionState.executionComplete) return;
          
          executionState.executionComplete = true;
          
          // Clean up event listeners
          this.eventEmitter.off('stream', handleStreamEvent);
          this.eventEmitter.off('display_data', handleDisplayEvent);
          this.eventEmitter.off('execute_result', handleResultEvent);
          this.eventEmitter.off('execute_error', handleErrorEvent);
          
          console.log(`[TS_WORKER] Execution complete, captured ${executionState.allMessages.length} messages`);
          
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
            
            // Ensure properties are enumerable for postMessage serialization
            Object.defineProperty(resultObj, '_displayData', {
              value: errorDisplayData,
              enumerable: true,
              writable: true,
              configurable: true
            });
            Object.defineProperty(resultObj, '_streamOutput', {
              value: streamOutputs.join(''),
              enumerable: true,
              writable: true,
              configurable: true
            });
            
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
            
            // Ensure properties are enumerable for postMessage serialization
            Object.defineProperty(resultObj, '_displayData', {
              value: displayDataForSerialization,
              enumerable: true,
              writable: true,
              configurable: true
            });
            Object.defineProperty(resultObj, '_streamOutput', {
              value: streamOutputs.join(''),
              enumerable: true,
              writable: true,
              configurable: true
            });
            
            resolve({
              success: true,
              execution_count: this.executionCount,
              result: resultObj
            });
          }
        };

        // Execute the code
        this.tseval(code)
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
            console.error("[TS_WORKER] Execution error:", executionState.executionError);
            
            this.emitExecutionError(executionState.executionError);
            
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
      console.error("[TS_WORKER] Setup error:", errorObj);
      
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

  // Completion methods (from IKernel interface)
  async complete(code: string, cursor_pos: number, parent?: any): Promise<any> {
    try {
      // Implement completion logic directly in worker
      const completions = this.getCompletions(code, cursor_pos);
      
      return {
        matches: completions.matches,
        cursor_start: completions.cursor_start,
        cursor_end: completions.cursor_end,
        metadata: completions.metadata,
        status: 'ok'
      };
    } catch (error) {
      console.error("[TS_WORKER] Complete error:", error);
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

    // Get context variables from tseval
    const contextVariables = this.tseval.getVariables();
    
    // Keywords for TypeScript/JavaScript
    const keywords = [
      'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
      'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false',
      'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let',
      'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try',
      'typeof', 'var', 'void', 'while', 'with', 'yield', 'interface', 'type',
      'enum', 'namespace', 'module', 'declare', 'readonly', 'public', 'private',
      'protected', 'static', 'abstract', 'implements', 'keyof', 'unique', 'infer'
    ];
    
    // Global objects and built-ins
    const globals = [
      'console', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'Math',
      'JSON', 'RegExp', 'Error', 'Promise', 'Symbol', 'Map', 'Set', 'WeakMap',
      'WeakSet', 'Proxy', 'Reflect', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
      'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
      'Deno', 'window', 'document', 'navigator', 'location', 'history',
      'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest'
    ];

    // Check if we're completing after a dot (method/property completion)
    const beforePrefix = beforeCursor.slice(0, -prefix.length);
    const isDotCompletion = beforePrefix.match(/\w+\.$/);
    
    if (isDotCompletion) {
      // Complete methods/properties for common types
      const arrayMethods = [
        'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join',
        'reverse', 'sort', 'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex',
        'filter', 'map', 'reduce', 'reduceRight', 'forEach', 'some', 'every',
        'length', 'toString', 'valueOf'
      ];
      
      const objectMethods = [
        'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
        'constructor', 'keys', 'values', 'entries', 'assign', 'create', 'defineProperty',
        'freeze', 'seal', 'preventExtensions'
      ];
      
      // Add common methods
      [...arrayMethods, ...objectMethods].forEach(method => {
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
          metadata[variable] = { type: 'variable' };
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
    const uniqueMatches = matches.filter((match, index) => matches.indexOf(match) === index);
    
    return {
      matches: uniqueMatches,
      cursor_start,
      cursor_end,
      metadata
    };
  }

  async inspect(code: string, cursor_pos: number, detail_level: 0 | 1, parent?: any): Promise<any> {
    console.warn("[TS_WORKER] Code inspection not implemented for TypeScript worker");
    return {
      status: 'ok',
      data: {},
      metadata: {},
      found: false
    };
  }

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

  async interrupt(): Promise<boolean> {
    console.warn("[TS_WORKER] Interrupt not fully implemented for TypeScript worker");
    return false;
  }

  setInterruptBuffer(buffer: Uint8Array): void {
    console.warn("[TS_WORKER] Interrupt buffer not supported for TypeScript worker");
  }

  // Comm methods (from IKernel interface)
  async commInfo(target_name: string | null, parent?: any): Promise<any> {
    console.warn("[TS_WORKER] Comm functionality not supported for TypeScript worker");
    return { comms: {}, status: 'ok' };
  }

  async commOpen(content: any, parent?: any): Promise<void> {
    console.warn("[TS_WORKER] Comm functionality not supported for TypeScript worker");
  }

  async commMsg(content: any, parent?: any): Promise<void> {
    console.warn("[TS_WORKER] Comm functionality not supported for TypeScript worker");
  }

  async commClose(content: any, parent?: any): Promise<void> {
    console.warn("[TS_WORKER] Comm functionality not supported for TypeScript worker");
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
  resetContext: () => kernel.resetContext(),
  
  // Completion methods
  complete: (code: string, cursor_pos: number, parent?: any) => kernel.complete(code, cursor_pos, parent),
  inspect: (code: string, cursor_pos: number, detail_level: 0 | 1, parent?: any) => kernel.inspect(code, cursor_pos, detail_level, parent),
  isComplete: (code: string, parent?: any) => kernel.isComplete(code, parent),
  interrupt: () => kernel.interrupt(),
  setInterruptBuffer: (buffer: Uint8Array) => kernel.setInterruptBuffer(buffer),
  
  // Comm methods
  commInfo: (target_name: string | null, parent?: any) => kernel.commInfo(target_name, parent),
  commOpen: (content: any, parent?: any) => kernel.commOpen(content, parent),
  commMsg: (content: any, parent?: any) => kernel.commMsg(content, parent),
  commClose: (content: any, parent?: any) => kernel.commClose(content, parent)
};

Comlink.expose(kernelInterface); 