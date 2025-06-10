// TypeScript Web Worker for Deno App Engine
// Supports both JavaScript and TypeScript execution
// @ts-ignore Import Comlink from Deno
import * as Comlink from "https://deno.land/x/comlink@4.4.1/mod.ts";
// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';
import { KernelEvents } from "./index.ts";
import { jupyter, hasDisplaySymbol } from "./jupyter.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

// Interface for TypeScript kernel worker API
export interface ITypeScriptKernelWorkerAPI {
  initialize(options: any, eventCallback: (event: { type: string; data: any }) => void): Promise<void>;
  execute(code: string, parent?: any): Promise<{ success: boolean; result?: any; error?: Error }>;
  isInitialized(): boolean;
  inputReply(content: { value: string }): Promise<void>;
  getStatus(): "active" | "busy" | "unknown";
}

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
    
    // Detect language type
    const isTypeScript = this.isTypeScript(code);
    const hasImports = this.hasImports(code);
    
    if (isTypeScript) {
      return await this.executeTypeScript(code);
    } else if (hasImports) {
      return await this.executeJavaScriptWithImports(code);
    } else {
      return await this.executeJavaScript(code);
    }
  }
  
  private isTypeScript(code: string): boolean {
    // Check for TypeScript-specific syntax
    const tsPatterns = [
      /\b(interface|type)\s+\w+/,                          // interface/type declarations
      /\w+\s*:\s*\w+(\[\]|<[^>]+>)?\s*[=;,)]/,            // type annotations
      /\(\s*\w+\s*:\s*\w+/,                                // function parameter types
      /\)\s*:\s*\w+(\[\]|<[^>]+>)?\s*[{=>]/,              // function return types
      /<\w+(\s*,\s*\w+)*>/,                                // generic type parameters
      /\bas\s+\w+/,                                        // type assertions
      /\w+\s*\?\s*:/,                                      // optional properties
      /\bpublic\s+|private\s+|protected\s+|readonly\s+/,  // access modifiers
      /\benum\s+\w+/,                                      // enum declarations
      /\bnamespace\s+\w+/,                                 // namespace declarations
      /\bimport\s+.*\s+from\s+['"][^'"]*\.ts['"]/, // TypeScript imports
      /\bexport\s+(interface|type|enum|namespace)/         // TypeScript exports
    ];
    
    return tsPatterns.some(pattern => pattern.test(code));
  }
  
  private hasImports(code: string): boolean {
    return /^\s*import\s+/m.test(code) || /^\s*export\s+/m.test(code);
  }
  
  private async executeTypeScript(code: string): Promise<any> {
    // For complex TypeScript code, prefer the file approach as it's more reliable
    // Use data URL only for simple cases
    const isComplexCode = this.isComplexTypeScriptCode(code);
    
    if (isComplexCode) {
      // Use file approach for complex code (more reliable)
      try {
        return await this.tsevalFile(code);
      } catch (fileError) {
        console.warn("[TS_WORKER] File approach failed, trying data URL approach:", fileError);
        // Fallback to data URL approach
        try {
          return await this.tseval(code);
        } catch (dataUrlError) {
          console.error("[TS_WORKER] Both file and data URL approaches failed");
          throw fileError; // Report the file error as it's usually more informative
        }
      }
    } else {
      // Use data URL approach for simple code
      try {
        return await this.tseval(code);
      } catch (dataUrlError) {
        console.warn("[TS_WORKER] Data URL approach failed, trying file approach:", dataUrlError);
        // Fallback to file approach
        try {
          return await this.tsevalFile(code);
        } catch (fileError) {
          console.error("[TS_WORKER] Both data URL and file approaches failed");
          throw fileError;
        }
      }
    }
  }
  
  private isComplexTypeScriptCode(code: string): boolean {
    // Consider code complex if it has:
    // - Template literals (backticks)
    // - Multiple lines with complex logic
    // - Async/await patterns
    // - Multiple imports
    // - Jupyter-specific APIs
    const complexPatterns = [
      /`[^`]*`/,                           // Template literals
      /await\s+\w+/,                       // Await expressions
      /import.*\n.*import/,                // Multiple imports
      /Deno\.jupyter/,                     // Jupyter APIs
      /\{\s*[^}]*\n[^}]*\}/               // Multi-line objects
    ];
    
    const lineCount = code.split('\n').length;
    
    // Consider complex if more than 3 lines or matches any complex pattern
    return lineCount > 3 || complexPatterns.some(pattern => pattern.test(code));
  }
  
  private async tseval(code: string): Promise<any> {
    // Wrap code to capture result if needed
    const wrappedCode = this.wrapCodeForResult(code);
    
    // Convert string to UTF-8 bytes then encode to base64
    const utf8Bytes = new TextEncoder().encode(wrappedCode);
    const base64Code = encodeBase64(utf8Bytes);
    const dataUrl = `data:application/typescript;charset=utf-8;base64,${base64Code}`;
    
    const module = await import(dataUrl + `?t=${Date.now()}`);
    return this.extractResult(module);
  }
  
  private async tsevalFile(code: string): Promise<any> {
    const wrappedCode = this.wrapCodeForResult(code);
    const tempFilename = `temp_ts_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.ts`;
    
    await Deno.writeTextFile(tempFilename, wrappedCode);
    
    try {
      const module = await import(`file://${Deno.cwd()}/${tempFilename}?t=${Date.now()}`);
      return this.extractResult(module);
    } finally {
      // Clean up the temporary file
      try {
        await Deno.remove(tempFilename);
      } catch (cleanupError) {
        console.warn("[TS_WORKER] Failed to clean up temporary file");
      }
    }
  }
  
  private wrapCodeForResult(code: string): string {
    const lines = code.trim().split('\n');
    
    // Check if code already has exports
    if (/^\s*export\s+/m.test(code)) {
      // Code already has exports, return as-is
      return code;
    }
    
    // Don't try to capture results from complex multi-line code with await statements
    // or object literals that span multiple lines
    const hasAwait = /\bawait\s+/.test(code);
    const hasMultiLineObjects = /\{\s*$[\s\S]*\}/.test(code);
    const lineCount = lines.length;
    
    if (hasAwait || hasMultiLineObjects || lineCount > 10) {
      // For complex code, just add a basic export without trying to capture results
      return `${code}\n\nexport const result = undefined;`;
    }
    
    // For simpler code, try to find a safe expression to capture
    let modifiedLines = [...lines];
    let hasResultCapture = false;
    
    // Look for the last non-empty, non-comment line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        // Check if it's a safe expression to capture
        if (this.isSafeExpression(line)) {
          modifiedLines[i] = `const __result = ${line};`;
          hasResultCapture = true;
          break;
        }
      }
    }
    
    // Add export statement
    return `${modifiedLines.join('\n')}\n\nexport const result = ${hasResultCapture ? '__result' : 'undefined'};`;
  }
  
  private isSafeExpression(line: string): boolean {
    // Don't treat as expression if it:
    // - Contains object literal syntax that can't be standalone
    // - Is a statement keyword
    // - Contains complex object patterns
    // - Contains incomplete syntax
    
    const unsafePatterns = [
      /^['"]\w+['"]:\s*\{/,               // Object property starting with string key
      /^['"]\w+['"]:\s*[^,}]+$/,          // String key with value but no proper object
      /^\w+:\s*\{/,                       // Object property
      /^(const|let|var|function|class|if|for|while|try|switch|return|throw|break|continue)\b/,
      /^await\s+\w+\.\w+/,                // Await statements
      /;\s*$/,                            // Ends with semicolon
      /\{\s*$/,                           // Incomplete object
      /\}\s*$/,                           // Incomplete object end
    ];
    
    // Also check if it's not a valid standalone expression
    if (unsafePatterns.some(pattern => pattern.test(line))) {
      return false;
    }
    
    // Simple heuristic: should look like an expression
    // Valid expressions typically don't start with keywords and are complete
    return this.isExpression(line);
  }
  
  private extractResult(module: any): any {
    // Try different export patterns
    if ('result' in module) {
      return module.result;
    }
    if ('default' in module) {
      return module.default;
    }
    // If no specific result, return the module itself
    return module;
  }
  
  private async executeJavaScriptWithImports(code: string): Promise<any> {
    // Try blob URL approach first
    try {
      const moduleCode = this.wrapAsJavaScriptModule(code);
      const blob = new Blob([moduleCode], { type: 'application/javascript' });
      const moduleUrl = URL.createObjectURL(blob);
      
      try {
        const module = await import(moduleUrl + `?t=${Date.now()}`);
        return this.extractResult(module);
      } finally {
        URL.revokeObjectURL(moduleUrl);
      }
    } catch (blobError) {
      // Fallback to temporary file approach
      const moduleCode = this.wrapAsJavaScriptModule(code);
      const tempFilename = `temp_js_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.js`;
      
      await Deno.writeTextFile(tempFilename, moduleCode);
      
      try {
        const module = await import(`file://${Deno.cwd()}/${tempFilename}?t=${Date.now()}`);
        return this.extractResult(module);
      } finally {
        try {
          await Deno.remove(tempFilename);
        } catch (cleanupError) {
          console.warn("[TS_WORKER] Failed to clean up temporary file");
        }
      }
    }
  }
  
  private wrapAsJavaScriptModule(code: string): string {
    // Similar to wrapCodeForResult but for JavaScript
    const lines = code.split('\n');
    
    // Check if code already has exports
    if (/^\s*export\s+/m.test(code)) {
      return code;
    }
    
    let resultExpression = 'undefined';
    
    // Look for the last non-empty, non-comment line
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line && !line.startsWith('//') && !line.startsWith('/*')) {
        if (this.isExpression(line)) {
          resultExpression = line;
          lines[i] = `const __result = ${line};`;
          break;
        }
      }
    }
    
    return `${lines.join('\n')}\n\nexport const result = typeof __result !== 'undefined' ? __result : undefined;`;
  }
  
  private async executeJavaScript(code: string): Promise<any> {
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
    
    // Check if the last line is a simple expression
    const isSimpleExpression = this.isSimpleExpression(lastLine);
    
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
    const statementKeywords = ['const', 'let', 'var', 'function', 'class', 'if', 'for', 'while', 'try'];
    const hasStatementKeyword = statementKeywords.some(keyword => 
      new RegExp(`\\b${keyword}\\b`).test(code)
    );
    return !hasStatementKeyword && !code.endsWith(';') && !code.includes('\n');
  }
  
  private isSimpleExpression(line: string): boolean {
    return !!line && 
      !line.endsWith(';') && 
      !line.endsWith('}') && 
      !line.endsWith(')') &&
      !line.startsWith('const') && 
      !line.startsWith('let') && 
      !line.startsWith('var') && 
      !line.startsWith('function') &&
      !line.startsWith('class') && 
      !line.startsWith('if') &&
      !line.startsWith('for') && 
      !line.startsWith('while') &&
      !line.startsWith('try') && 
      !line.startsWith('switch') &&
      !line.startsWith('return') && 
      !line.startsWith('throw') &&
      !line.startsWith('break') && 
      !line.startsWith('continue') &&
      !line.startsWith('await') &&
      !line.includes('=') &&
      !line.includes('{') &&
      !line.includes('(');
  }
  
  private executeStatements(code: string): any {
    // Remove common indentation from all lines to handle indented code blocks
    const cleanedCode = this.removeCommonIndentation(code);
    
    // Handle JavaScript code - try to capture last expression
    const statements = cleanedCode.split(/[;\n]/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (statements.length === 0) {
      return undefined;
    }

    const lastStatement = statements[statements.length - 1];
    const codeWithoutLastStatement = statements.slice(0, -1).join(';\n');
    
    // If the last statement looks like an expression, capture it
    if (this.isStatementExpression(lastStatement)) {
      const wrapper = `
        (() => {
          ${codeWithoutLastStatement ? codeWithoutLastStatement + ';' : ''}
          return (${lastStatement});
        })()
      `;
      return eval(wrapper);
    } else {
      // Execute all statements normally
      return eval(`(() => { ${cleanedCode}; return undefined; })()`);
    }
  }
  
  private removeCommonIndentation(code: string): string {
    const lines = code.split('\n');
    const nonEmptyLines = lines.filter(line => line.trim().length > 0);
    
    if (nonEmptyLines.length === 0) {
      return code;
    }
    
    // Find the minimum indentation level among non-empty lines
    const minIndent = Math.min(...nonEmptyLines.map(line => {
      const match = line.match(/^[ \t]*/);
      return match ? match[0].length : 0;
    }));
    
    // Remove the common indentation from all lines
    const deindentedLines = lines.map(line => {
      if (line.trim().length === 0) return line;
      return line.slice(minIndent);
    });
    
    return deindentedLines.join('\n').trim();
  }
  
  private isStatementExpression(statement: string): boolean {
    const statementKeywords = [
      'const', 'let', 'var', 'function', 'class', 'if', 'for', 
      'while', 'try', 'switch', 'return', 'throw', 'break', 'continue'
    ];
    
    return !!statement && !statementKeywords.some(keyword => statement.startsWith(keyword));
  }
  
  getExecutionCount(): number {
    return this.executionCount;
  }
}

// TypeScript Kernel Worker Implementation
class TypeScriptKernelWorker implements ITypeScriptKernelWorkerAPI {
  private eventEmitter = new EventEmitter();
  private consoleCapture = new ConsoleCapture(this.eventEmitter);
  private codeExecutor = new CodeExecutor();
  private eventCallback: ((event: { type: string; data: any }) => void) | null = null;
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
  }
  
  async initialize(options: any, eventCallback: (event: { type: string; data: any }) => void): Promise<void> {
    if (this.initialized) return;
    
    this.eventCallback = eventCallback;
    
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
      // Set up global ENVIRONS object for TypeScript/JavaScript
      (globalThis as any).ENVIRONS = { ...this.environmentVariables };
      console.log(`[TS_WORKER] Set ${Object.keys(this.environmentVariables).length} environment variables in ENVIRONS`);
    }
    
    this.initialized = true;
    this._status = "active";
  }
  
  async execute(code: string, parent?: any): Promise<{ success: boolean; result?: any; error?: Error }> {
    if (!this.initialized) {
      await this.initialize({}, () => {});
    }
    
    this._status = "busy";
    this.consoleCapture.start();
    
    try {
      const result = await this.codeExecutor.execute(code);
      
      // Emit execution result if we have a meaningful result
      if (result !== undefined) {
        this.emitExecutionResult(result);
      }
      
      this._status = "active";
      return { success: true, result };
    } catch (error) {
      this.emitExecutionError(error);
      this._status = "active";
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
    return this._status;
  }
  
  async inputReply(content: { value: string }): Promise<void> {
    console.warn("[TS_WORKER] Input reply not implemented");
  }
  
  private setupEventForwarding(): void {
    Object.values(KernelEvents).forEach((eventType) => {
      this.eventEmitter.on(eventType, (data: any) => {
        if (this.eventCallback) {
          this.eventCallback({
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
const worker = new TypeScriptKernelWorker();

// Global error handlers
self.addEventListener("error", (event) => {
  console.error("[TS_WORKER] Global error caught:", event.error);
  event.preventDefault();
});

self.addEventListener("unhandledrejection", (event) => {
  console.error("[TS_WORKER] Unhandled promise rejection:", event.reason);
  event.preventDefault();
});

// Cleanup on termination
self.addEventListener("beforeunload", () => {
  try {
    console.log("[TS_WORKER] TypeScript worker shutting down");
  } catch (error) {
    console.error("[TS_WORKER] Error during cleanup:", error);
  }
});

// Expose worker via Comlink
Comlink.expose(worker); 