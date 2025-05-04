// Kernel implementation for Deno using Pyodide directly
// Based on the PyodideKernel but simplified to run directly in the main thread

import { EventEmitter } from "node:events";
import pyodideModule from "pyodide";

// Interface for kernel events
export enum KernelEvents {
  STREAM = "stream",
  DISPLAY_DATA = "display_data",
  UPDATE_DISPLAY_DATA = "update_display_data",
  EXECUTE_RESULT = "execute_result",
  EXECUTE_ERROR = "execute_error",
  INPUT_REQUEST = "input_request",
  CLEAR_OUTPUT = "clear_output",
  COMM_OPEN = "comm_open",
  COMM_MSG = "comm_msg",
  COMM_CLOSE = "comm_close",
}

export interface IKernel {
  initialize(): Promise<void>;
  execute(code: string): Promise<{ success: boolean, error?: Error }>;
  isInitialized(): boolean;
}

export interface IKernelExecuteOptions {
  code: string;
  silent?: boolean;
  storeHistory?: boolean;
}

export class Kernel extends EventEmitter implements IKernel {
  private pyodide: any;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
  constructor() {
    super();
    // Set a higher limit for event listeners
    this.setMaxListeners(20);
  }

  /**
   * Initialize the kernel by loading Pyodide and installing required packages
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._initializeInternal();
    return this.initPromise;
  }
  
  private async _initializeInternal(): Promise<void> {
    try {
      console.log("Loading Pyodide...");
      this.pyodide = await pyodideModule.loadPyodide();
      
      // Set up Python execution environment
      await this._setupPythonEnvironment();
      
      this.initialized = true;
      console.log("Kernel initialization complete");
    } catch (error) {
      console.error("Error initializing kernel:", error);
      throw error;
    }
  }
  
  private async _setupPythonEnvironment(): Promise<void> {
    // Set up callback for handling display outputs and stream data
    await this.pyodide.runPythonAsync(`
import sys
import builtins
from pyodide.ffi import create_proxy, to_js
import io
import traceback

class DenoBridge:
    def __init__(self):
        pass

    def format_traceback(self, etype, value, tb):
        return traceback.format_exception(etype, value, tb)

    def emit_stream(self, name, text):
        bridge_emit_stream(name, text)
    
    def emit_display_data(self, data, metadata=None, transient=None):
        if metadata is None:
            metadata = {}
        if transient is None:
            transient = {}
        bridge_emit_display_data(to_js(data), to_js(metadata), to_js(transient))
    
    def emit_execute_result(self, data, execution_count, metadata=None):
        if metadata is None:
            metadata = {}
        bridge_emit_execute_result(to_js(data), execution_count, to_js(metadata))
    
    def emit_error(self, ename, evalue, traceback):
        bridge_emit_error(ename, evalue, traceback)

# Create stdout/stderr capture
class StreamCapture(io.TextIOBase):
    def __init__(self, name):
        self.name = name
        self.output = []
    
    def write(self, text):
        if text:
            deno_bridge.emit_stream(self.name, text)
            self.output.append(text)
        return len(text) if text else 0
    
    def flush(self):
        pass

# Set up the bridge to JavaScript
deno_bridge = DenoBridge()

# Capture stdout and stderr
stdout_capture = StreamCapture('stdout')
stderr_capture = StreamCapture('stderr')

# Store original stdout/stderr
original_stdout = sys.stdout
original_stderr = sys.stderr

# Replace with capture streams
sys.stdout = stdout_capture
sys.stderr = stderr_capture

# Set up display hook
def custom_displayhook(value):
    if value is None:
        return
    
    # Get representations
    plain = repr(value)
    data = {'text/plain': plain}
    
    # Try to get other representations
    try:
        if hasattr(value, '_repr_html_'):
            html = value._repr_html_()
            if html is not None:
                data['text/html'] = html
    except Exception:
        pass
    
    # Emit as execute result
    deno_bridge.emit_execute_result(data, 0)
    
    # Store in builtins._
    builtins._ = value

sys.displayhook = custom_displayhook
`);

    // Register callbacks from Python to JavaScript
    this.pyodide.globals.set("bridge_emit_stream", 
      (name: string, text: string) => {
        this.emit(KernelEvents.STREAM, { name, text });
      });
    
    this.pyodide.globals.set("bridge_emit_display_data", 
      (data: any, metadata: any, transient: any) => {
        this.emit(KernelEvents.DISPLAY_DATA, { data, metadata, transient });
      });
    
    this.pyodide.globals.set("bridge_emit_execute_result", 
      (data: any, execution_count: number, metadata: any) => {
        this.emit(KernelEvents.EXECUTE_RESULT, { 
          data, 
          metadata, 
          execution_count 
        });
      });
    
    this.pyodide.globals.set("bridge_emit_error", 
      (ename: string, evalue: string, traceback: string[]) => {
        this.emit(KernelEvents.EXECUTE_ERROR, { 
          ename, 
          evalue, 
          traceback 
        });
      });
  }
  
  /**
   * Check if the kernel has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Execute Python code
   * @param code The Python code to execute
   * @returns Result of execution
   */
  public async execute(code: string): Promise<{ success: boolean, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    try {
      // Execute the code and capture the result
      await this.pyodide.runPythonAsync(`
try:
    exec(${JSON.stringify(code)})
except Exception as e:
    import traceback
    etype, value, tb = sys.exc_info()
    traceback_lines = deno_bridge.format_traceback(etype, value, tb)
    deno_bridge.emit_error(etype.__name__, str(value), traceback_lines)
`);
      
      return { success: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      return { success: false, error: errorObj };
    }
  }
  
  /**
   * Execute Python code asynchronously and return the result through a Promise
   * @param options Execution options
   */
  public async executeAsync(options: IKernelExecuteOptions): Promise<{ success: boolean, result?: any, error?: Error }> {
    try {
      // Create a promise that will be resolved when execution is complete
      const executePromise = new Promise<{ success: boolean, result?: any, error?: Error }>((resolve) => {
        const handleResult = (result: any) => {
          this.removeListener(KernelEvents.EXECUTE_RESULT, handleResult);
          this.removeListener(KernelEvents.EXECUTE_ERROR, handleError);
          resolve({ success: true, result });
        };
        
        const handleError = (error: any) => {
          this.removeListener(KernelEvents.EXECUTE_RESULT, handleResult);
          this.removeListener(KernelEvents.EXECUTE_ERROR, handleError);
          resolve({ success: false, error: new Error(`${error.ename}: ${error.evalue}`) });
        };
        
        this.once(KernelEvents.EXECUTE_RESULT, handleResult);
        this.once(KernelEvents.EXECUTE_ERROR, handleError);
      });
      
      // Start the execution
      await this.execute(options.code);
      
      // Wait for the result or error
      return await executePromise;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      return { success: false, error: errorObj };
    }
  }
}

// Export a singleton instance
export const kernel = new Kernel(); 