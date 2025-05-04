// Kernel implementation for Deno using Pyodide directly
// Based on the PyodideKernel but simplified to run directly in the main thread

import { EventEmitter } from "node:events";
// @ts-ignore Importing from npm
import pyodideModule from "npm:pyodide/pyodide.js";

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

export interface IMessage {
  type: string;
  bundle?: any;
  content?: any;
  metadata?: any;
  parentHeader?: any;
  buffers?: any;
}

export class Kernel extends EventEmitter implements IKernel {
  private pyodide: any;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private kernel: any;
  private interpreter: any;
  private stdout_stream: any;
  private stderr_stream: any;
  private parent_header: any = {};
  private resolveInputReply: any;
  private executionCount = 0;
  
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
      
      // Initialize package manager
      await this.initPackageManager();
      
      // Initialize kernel
      await this.initKernel();
      
      // Set up Python execution environment
      await this._setupPythonEnvironment();
      
      this.initialized = true;
      console.log("Kernel initialization complete");
    } catch (error) {
      console.error("Error initializing kernel:", error);
      throw error;
    }
  }

  /**
   * Initialize the Pyodide package manager and install required packages
   */
  private async initPackageManager(): Promise<void> {
    // Load micropip
    await this.pyodide.loadPackage(['micropip']);
    
    // Load piplite for package management
    await this.pyodide.runPythonAsync(`
      import micropip
    `);
  }

  /**
   * Initialize the kernel with required Python packages
   */
  private async initKernel(): Promise<void> {
    // List of packages to load
    const toLoad = [
      'ssl',
      'sqlite3',
      'ipykernel',
      'comm',
      'jedi',
      'ipython'
    ];

    const scriptLines: string[] = [];

    // Install packages using micropip
    for (const pkgName of toLoad) {
      scriptLines.push(`
try:
    import ${pkgName}
except ImportError:
    try:
        await micropip.install('${pkgName}', keep_going=True)
    except Exception as e:
        print(f"Warning: Could not install ${pkgName}: {e}")
      `);
    }

    // Run the installation script
    await this.pyodide.runPythonAsync(scriptLines.join('\n'));
  }
  
  /**
   * Setup Python execution environment, callback handlers and stream capturing
   */
  private async _setupPythonEnvironment(): Promise<void> {
    // Set up callback for handling display outputs and stream data
    await this.pyodide.runPythonAsync(`
import sys
import builtins
from pyodide.ffi import create_proxy, to_js
import io
import traceback
import json

# Create a namespace for user code execution
user_ns = {}

class DenoBridge:
    def __init__(self):
        self._input_response = None
        
    def set_input_response(self, value):
        self._input_response = value
        
    def get_input_response(self):
        response = self._input_response
        self._input_response = None
        return response

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
        bridge_emit_error(ename, evalue, to_js(traceback))
    
    def emit_update_display_data(self, data, metadata=None, transient=None):
        if metadata is None:
            metadata = {}
        if transient is None:
            transient = {}
        bridge_emit_update_display_data(to_js(data), to_js(metadata), to_js(transient))
    
    def emit_clear_output(self, wait=False):
        bridge_emit_clear_output(wait)
        
    def input_request(self, prompt, password=False):
        bridge_emit_input_request(prompt, password)
        # In a real implementation, we would wait for a response
        # For now, we'll just return an empty string
        return ""

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

# Simple kernel implementation
class DenoKernel:
    def __init__(self):
        self._parent_header = {}
        self.interpreter = DenoInterpreter()
        
    def run(self, code):
        try:
            print(f"Executing Python code: {code}")
            # Execute in the user namespace to maintain state between executions
            compiled_code = compile(code, "<string>", "exec")
            exec(compiled_code, user_ns)
            print("Code executed successfully")
            return {'status': 'ok'}
        except Exception as e:
            etype, value, tb = sys.exc_info()
            traceback_lines = deno_bridge.format_traceback(etype, value, tb)
            print(f"Error executing code: {type(e).__name__}: {str(e)}")
            for line in traceback_lines:
                print(line)
                
            deno_bridge.emit_error(etype.__name__, str(value), traceback_lines)
            return {
                'status': 'error',
                'ename': etype.__name__,
                'evalue': str(value),
                'traceback': traceback_lines
            }

class DenoInterpreter:
    def __init__(self):
        self.display_pub = DisplayPub()
        self.displayhook = DisplayHook()
        self.execution_count = 0
        
    def send_comm(self, type, content, metadata, ident, buffers):
        pass
        
    def input(self, prompt):
        return deno_bridge.input_request(prompt, False)
        
    def getpass(self, prompt):
        return deno_bridge.input_request(prompt, True)
            
class DisplayPub:
    def __init__(self):
        self.clear_output_callback = None
        self.display_data_callback = None
        self.update_display_data_callback = None
            
class DisplayHook:
    def __init__(self):
        self.publish_execution_result = None

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

# Create kernel instance
kernel_instance = DenoKernel()

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
    deno_bridge.emit_execute_result(data, kernel_instance.interpreter.execution_count)
    
    # Store in builtins._
    builtins._ = value

sys.displayhook = custom_displayhook

# Add the ability to evaluate expressions and return results
def evaluate_expression(expr):
    try:
        result = eval(expr, globals(), user_ns)
        return result
    except Exception as e:
        etype, value, tb = sys.exc_info()
        traceback_lines = deno_bridge.format_traceback(etype, value, tb)
        return {
            'error': True,
            'ename': etype.__name__, 
            'evalue': str(value),
            'traceback': traceback_lines
        }

# Show current user namespace variables
def get_user_namespace():
    return {key: repr(value) for key, value in user_ns.items()}
`);

    // Register callbacks from Python to JavaScript
    this.pyodide.globals.set("bridge_emit_stream", 
      (name: string, text: string) => {
        this._processWorkerMessage({
          type: 'stream',
          bundle: { name, text },
          parentHeader: this.parent_header
        });
      });
    
    this.pyodide.globals.set("bridge_emit_display_data", 
      (data: any, metadata: any, transient: any) => {
        this._processWorkerMessage({
          type: 'display_data',
          bundle: { data, metadata, transient },
          parentHeader: this.parent_header
        });
      });
    
    this.pyodide.globals.set("bridge_emit_execute_result", 
      (data: any, execution_count: number, metadata: any) => {
        this._processWorkerMessage({
          type: 'execute_result',
          bundle: { 
            data, 
            metadata, 
            execution_count: this.executionCount 
          },
          parentHeader: this.parent_header
        });
      });
    
    this.pyodide.globals.set("bridge_emit_error", 
      (ename: string, evalue: string, traceback: string[]) => {
        this._processWorkerMessage({
          type: 'execute_error',
          bundle: { 
            ename, 
            evalue, 
            traceback 
          },
          parentHeader: this.parent_header
        });
      });
      
    this.pyodide.globals.set("bridge_emit_update_display_data", 
      (data: any, metadata: any, transient: any) => {
        this._processWorkerMessage({
          type: 'update_display_data',
          bundle: { data, metadata, transient },
          parentHeader: this.parent_header
        });
      });
      
    this.pyodide.globals.set("bridge_emit_clear_output", 
      (wait: boolean) => {
        this._processWorkerMessage({
          type: 'clear_output',
          bundle: { wait },
          parentHeader: this.parent_header
        });
      });
      
    this.pyodide.globals.set("bridge_emit_input_request", 
      (prompt: string, password: boolean) => {
        this._processWorkerMessage({
          type: 'input_request',
          content: { prompt, password },
          parentHeader: this.parent_header
        });
      });
      
    // Get the kernel, interpreter instances from Python
    this.kernel = this.pyodide.globals.get('kernel_instance');
    this.interpreter = this.kernel.interpreter;
    this.stdout_stream = this.pyodide.globals.get('stdout_capture');
    this.stderr_stream = this.pyodide.globals.get('stderr_capture');
  }
  
  /**
   * Process a message coming from Python
   */
  private _processWorkerMessage(msg: IMessage): void {
    if (!msg.type) {
      return;
    }

    switch (msg.type) {
      case 'stream': {
        const bundle = msg.bundle ?? { name: 'stdout', text: '' };
        this.emit(KernelEvents.STREAM, bundle);
        break;
      }
      case 'input_request': {
        const content = msg.content ?? { prompt: '', password: false };
        this.emit(KernelEvents.INPUT_REQUEST, content);
        break;
      }
      case 'display_data': {
        const bundle = msg.bundle ?? { data: {}, metadata: {}, transient: {} };
        this.emit(KernelEvents.DISPLAY_DATA, bundle);
        break;
      }
      case 'update_display_data': {
        const bundle = msg.bundle ?? { data: {}, metadata: {}, transient: {} };
        this.emit(KernelEvents.UPDATE_DISPLAY_DATA, bundle);
        break;
      }
      case 'clear_output': {
        const bundle = msg.bundle ?? { wait: false };
        this.emit(KernelEvents.CLEAR_OUTPUT, bundle);
        break;
      }
      case 'execute_result': {
        const bundle = msg.bundle ?? {
          execution_count: 0,
          data: {},
          metadata: {},
        };
        this.emit(KernelEvents.EXECUTE_RESULT, bundle);
        break;
      }
      case 'execute_error': {
        const bundle = msg.bundle ?? { ename: '', evalue: '', traceback: [] };
        this.emit(KernelEvents.EXECUTE_ERROR, bundle);
        break;
      }
      case 'comm_msg':
      case 'comm_open':
      case 'comm_close': {
        this.emit(
          msg.type === 'comm_msg' ? KernelEvents.COMM_MSG : 
            msg.type === 'comm_open' ? KernelEvents.COMM_OPEN : KernelEvents.COMM_CLOSE,
          { 
            content: msg.content, 
            metadata: msg.metadata, 
            buffers: msg.buffers 
          }
        );
        break;
      }
    }
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
      // Increment execution count
      this.executionCount += 1;
      
      console.log("Executing Python code:", code);
      
      // Execute the code and capture the result
      const result = await this.pyodide.runPythonAsync(`
kernel_instance.run(${JSON.stringify(code)})
`);
      
      const jsResult = result.toJs();
      console.log("Execution result:", jsResult);
      
      // Print the current user namespace
      const namespace = await this.pyodide.runPythonAsync(`get_user_namespace()`);
      console.log("User namespace:", namespace.toJs());
      
      const status = jsResult.status;
      return { success: status === 'ok' };
    } catch (error) {
      console.error("Error executing Python code:", error);
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
  
  /**
   * Evaluate a Python expression and return the result directly
   * @param expression The Python expression to evaluate
   * @returns Result of evaluation
   */
  public async evaluate(expression: string): Promise<any> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const result = await this.pyodide.runPythonAsync(`
evaluate_expression(${JSON.stringify(expression)})
`);
    
    return result.toJs();
  }
  
  /**
   * Handle input reply from user
   */
  public inputReply(content: { value: string }): void {
    if (this.resolveInputReply) {
      this.resolveInputReply(content);
    }
    
    // Also set the input response in Python
    this.pyodide.runPython(`
deno_bridge.set_input_response(${JSON.stringify(content.value)})
`);
  }
}

// Export a singleton instance
export const kernel = new Kernel(); 