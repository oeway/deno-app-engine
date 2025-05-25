// TypeScript Kernel for Main Thread
// Simplified implementation for main thread execution
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { KernelEvents, IKernel, IKernelOptions } from "./index.ts";
import { jupyter, hasDisplaySymbol } from "./jupyter.ts";

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
      console.log("[TS_KERNEL] Blob URL import failed, trying temporary file approach:", errorMessage);
      
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
            console.warn("[TS_KERNEL] Failed to clean up temporary file:", cleanupMessage);
          }
        }
      } catch (fileError) {
        console.error("[TS_KERNEL] Both blob URL and temporary file approaches failed");
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

// Main TypeScript Kernel for main thread
export class TypeScriptKernel extends EventEmitter implements IKernel {
  private consoleCapture = new ConsoleCapture(this);
  private codeExecutor = new CodeExecutor();
  private initialized = false;
  private pathMappings: Map<string, string> = new Map();
  
  constructor() {
    super();
    this.setupJupyterEventForwarding();
    this.setupFileSystemInterception();
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
  
  async* executeStream(code: string, parent?: any): AsyncGenerator<any, { success: boolean, result?: any, error?: Error }, void> {
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
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  get status(): "active" | "busy" | "unknown" {
    return this.initialized ? "active" : "unknown";
  }
  
  async inputReply(content: { value: string }): Promise<void> {
    // Not implemented for TypeScript kernel
    console.warn("[TS_KERNEL] Input reply not implemented");
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
          execution_count: this.codeExecutor.getExecutionCount(),
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
          execution_count: this.codeExecutor.getExecutionCount(),
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