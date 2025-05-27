// TypeScript Web Worker for Deno App Engine
// Simplified and elegant implementation
import * as Comlink from "comlink";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { KernelEvents } from "./index.ts";
import { jupyter, hasDisplaySymbol } from "./jupyter.ts";


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
    
    this.eventEmitter.emit(KernelEvents.STREAM, {
      name: stream,
      text: text + "\n"
    });
  }
}

// Code execution engine
class CodeExecutor {
  private executionCount = 0;
  
  async execute(code: string): Promise<any> {
    this.executionCount++;
    
    if (this.hasImports(code)) {
      return await this.executeWithImports(code);
    } else {
      return await this.executeSimple(code);
    }
  }
  
  private hasImports(code: string): boolean {
    return /^\s*import\s+/m.test(code) || /^\s*export\s+/m.test(code);
  }
  
  private async executeWithImports(code: string): Promise<any> {
    // Try blob URL approach first
    try {
      const moduleCode = this.wrapAsModule(code);
      const blob = new Blob([moduleCode], { type: 'text/typescript' });
      const moduleUrl = URL.createObjectURL(blob);
      
      try {
        const module = await import(moduleUrl + `?t=${Date.now()}`);
        return module.result;
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    } catch (blobError: unknown) {
      const errorMessage = blobError instanceof Error ? blobError.message : String(blobError);
      console.log("[TS_WORKER] Blob URL import failed, trying temporary file approach:", errorMessage);
      
      // Fallback to temporary file approach
      try {
        const moduleCode = this.wrapAsModule(code);
        const tempFilename = `temp_module_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.ts`;
        
        await Deno.writeTextFile(tempFilename, moduleCode);
        
        try {
          const module = await import(`file://${Deno.cwd()}/${tempFilename}?t=${Date.now()}`);
          return module.result;
        } finally {
          // Clean up the temporary file
          try {
            await Deno.remove(tempFilename);
          } catch (cleanupError: unknown) {
            const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
            console.warn("[TS_WORKER] Failed to clean up temporary file:", cleanupMessage);
          }
        }
      } catch (fileError) {
        console.error("[TS_WORKER] Both blob URL and temporary file approaches failed");
        throw fileError;
      }
    }
  }
  
  private async executeSimple(code: string): Promise<any> {
    // Handle async code
    if (code.includes('await') || code.includes('async')) {
      return await this.executeAsync(code);
    }
    
    // Check if it's an expression or statement
    const trimmed = code.trim();
    if (this.isExpression(trimmed)) {
      return eval(trimmed);
    } else {
      // Execute as statements and try to capture the last expression
      return this.executeStatements(code);
    }
  }
  
  private async executeAsync(code: string): Promise<any> {
    // For async code, we need to be more careful about capturing the last expression
    // Let's use a simpler approach: check if the last non-empty line looks like an expression
    const lines = code.trim().split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    if (lines.length === 0) {
      return undefined;
    }
    
    let lastLine = lines[lines.length - 1];
    
    // Remove comments from the last line for analysis
    const commentIndex = lastLine.indexOf('//');
    if (commentIndex !== -1) {
      lastLine = lastLine.substring(0, commentIndex).trim();
    }
    
    // Check if the last line looks like a simple expression (not a statement)
    const isSimpleExpression = lastLine && 
      !lastLine.endsWith(';') && 
      !lastLine.endsWith('}') && 
      !lastLine.endsWith(')') &&
      !lastLine.startsWith('const') && 
      !lastLine.startsWith('let') && 
      !lastLine.startsWith('var') && 
      !lastLine.startsWith('function') &&
      !lastLine.startsWith('class') && 
      !lastLine.startsWith('if') &&
      !lastLine.startsWith('for') && 
      !lastLine.startsWith('while') &&
      !lastLine.startsWith('try') && 
      !lastLine.startsWith('switch') &&
      !lastLine.startsWith('return') && 
      !lastLine.startsWith('throw') &&
      !lastLine.startsWith('break') && 
      !lastLine.startsWith('continue') &&
      !lastLine.startsWith('await') &&
      !lastLine.includes('=') &&
      !lastLine.includes('{') &&
      !lastLine.includes('(');
    
    if (isSimpleExpression) {
      // Remove the last line and add it as a return statement
      const codeWithoutLastLine = lines.slice(0, -1).join('\n');
      const asyncWrapper = `
        (async () => {
          ${codeWithoutLastLine}
          return (${lastLine});
        })()
      `;
      return await eval(asyncWrapper);
    } else {
      // Execute all code normally
      const asyncWrapper = `
        (async () => {
          ${code}
          return undefined;
        })()
      `;
      return await eval(asyncWrapper);
    }
  }
  
  private isExpression(code: string): boolean {
    // Simple heuristic: if it doesn't contain statement keywords and doesn't end with semicolon
    const statementKeywords = ['const', 'let', 'var', 'function', 'class', 'if', 'for', 'while', 'try'];
    const hasStatementKeyword = statementKeywords.some(keyword => 
      new RegExp(`\\b${keyword}\\b`).test(code)
    );
    return !hasStatementKeyword && !code.endsWith(';') && !code.includes('\n');
  }
  
  private executeStatements(code: string): any {
    // Execute statements and try to capture the last expression value
    // Split the code into statements by semicolons and newlines
    const statements = code.trim().split(/[;\n]/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (statements.length === 0) {
      return undefined;
    }
    
    let lastStatement = statements[statements.length - 1];
    let codeWithoutLastStatement = statements.slice(0, -1).join(';\n');
    
    // If we have previous statements, add semicolon
    if (codeWithoutLastStatement) {
      codeWithoutLastStatement += ';';
    }
    
    // If the last statement looks like an expression (doesn't start with keywords), capture it
    if (lastStatement && 
        !lastStatement.startsWith('const') && !lastStatement.startsWith('let') && 
        !lastStatement.startsWith('var') && !lastStatement.startsWith('function') &&
        !lastStatement.startsWith('class') && !lastStatement.startsWith('if') &&
        !lastStatement.startsWith('for') && !lastStatement.startsWith('while') &&
        !lastStatement.startsWith('try') && !lastStatement.startsWith('switch') &&
        !lastStatement.startsWith('return') && !lastStatement.startsWith('throw') &&
        !lastStatement.startsWith('break') && !lastStatement.startsWith('continue')) {
      
      const wrapper = `
        (() => {
          ${codeWithoutLastStatement}
          return (${lastStatement});
        })()
      `;
      return eval(wrapper);
    } else {
      // Execute all statements normally
      const wrapper = `
        (() => {
          ${code}
          return undefined;
        })()
      `;
      return eval(wrapper);
    }
  }
  
  private wrapAsModule(code: string): string {
    // Find the last expression that could be a result
    const lines = code.split('\n');
    let resultExpression = 'undefined';
    
    // Look for the last non-empty, non-comment line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        // If it's not a statement (doesn't end with ; or }), it might be an expression
        if (!line.endsWith(';') && !line.endsWith('}') && !line.startsWith('import') && !line.startsWith('export')) {
          resultExpression = line;
          lines[i] = `const __lastResult = ${line};`;
          break;
        }
      }
    }
    
    return `
${lines.join('\n')}

// Export the result
export const result = typeof __lastResult !== 'undefined' ? __lastResult : undefined;
    `;
  }
  
  getExecutionCount(): number {
    return this.executionCount;
  }
}

// Main TypeScript Kernel
class TypeScriptKernel {
  private eventEmitter = new EventEmitter();
  private consoleCapture = new ConsoleCapture(this.eventEmitter);
  private codeExecutor = new CodeExecutor();
  private eventPort: MessagePort | null = null;
  private initialized = false;
  private pathMappings: Map<string, string> = new Map();
  
  constructor() {
    this.setupEventForwarding();
    this.setupJupyterEventForwarding();
    this.setupFileSystemInterception();
  }
  
  setEventPort(port: MessagePort): void {
    this.eventPort = port;
  }
  
  async initialize(options?: any): Promise<void> {
    if (this.initialized) return;
    
    console.log("[TS_WORKER] Initializing TypeScript kernel");
    
    // Handle filesystem mounting if provided
    if (options?.filesystem?.enabled && options.filesystem.root && options.filesystem.mountPoint) {
      try {
        // Set up path mapping for virtual filesystem
        this.pathMappings.set(options.filesystem.mountPoint, options.filesystem.root);
        console.log(`[TS_WORKER] Filesystem mapping: ${options.filesystem.mountPoint} -> ${options.filesystem.root}`);
      } catch (error) {
        console.error("[TS_WORKER] Error setting up filesystem:", error);
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
  
  async execute(code: string, parent?: any): Promise<{ success: boolean, result?: any, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    this.consoleCapture.start();
    
    try {
      const result = await this.codeExecutor.execute(code);
      
      // Emit execution result if we have a meaningful result
      if (result !== undefined) {
        this.emitExecutionResult(result);
      }
      
      return { success: true, result };
    } catch (error) {
      this.emitExecutionError(error);
      return { 
        success: false, 
        error: error instanceof Error ? error : new Error(String(error))
      };
    } finally {
      this.consoleCapture.stop();
    }
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  getStatus(): "active" | "busy" | "unknown" {
    return this.initialized ? "active" : "unknown";
  }
  
  async inputReply(content: { value: string }): Promise<void> {
    // Not implemented for TypeScript kernel
    console.warn("[TS_WORKER] Input reply not implemented");
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
    // Listen for Jupyter broadcast events and forward them to the kernel event system
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
        console.log(`[TS_WORKER] Path mapping: ${path} -> ${mappedPath}`);
        return mappedPath;
      }
    }
    
    // If no mapping found, return the original path
    return path;
  }
  
  private emitExecutionResult(result: any): void {
    try {
      // Check if the result has a display symbol - if so, emit display_data event
      if (result !== null && typeof result === "object" && hasDisplaySymbol(result)) {
        try {
          const displayResult = result[jupyter.$display]();
          if (displayResult && typeof displayResult === "object") {
            // Emit as display_data event
            this.eventEmitter.emit(KernelEvents.DISPLAY_DATA, {
              data: displayResult,
              metadata: {},
              transient: {}
            });
            return; // Don't emit as execution result
          }
        } catch (e) {
          console.error("[TS_WORKER] Error in display symbol execution:", e);
        }
      }
      
      // Format the result using jupyter helper for regular execution results
      const formattedResult = jupyter.formatResult(result);
      
      this.eventEmitter.emit(KernelEvents.EXECUTE_RESULT, {
        execution_count: this.codeExecutor.getExecutionCount(),
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
    // But we need to acknowledge the message to prevent timeout
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
  getStatus: () => kernel.getStatus()
};

Comlink.expose(kernelInterface); 