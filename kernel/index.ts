// Kernel implementation for Deno using Pyodide directly
// Based on the PyodideRemoteKernel but adapted for direct execution in main thread

// @ts-ignore Importing from npm
import { EventEmitter } from 'node:events';

// @ts-ignore Importing from npm
import pyodideModule from "npm:pyodide/pyodide.js";

// Import PyPI URLs
import {
  pipliteWheelUrl,
  pyodide_kernelWheelUrl,
  ipykernelWheelUrl,
  allJSONUrl
} from './_pypi.ts';

// Event types from JupyterLab
export enum KernelEvents {
  // IOPub Channel Messages
  STREAM = "stream",
  DISPLAY_DATA = "display_data",
  UPDATE_DISPLAY_DATA = "update_display_data",
  EXECUTE_RESULT = "execute_result",
  EXECUTE_ERROR = "execute_error",
  EXECUTE_REQUEST = "execute_request",
  
  // Input request
  INPUT_REQUEST = "input_request",
  
  // Output control
  CLEAR_OUTPUT = "clear_output",
  
  // Comm messages
  COMM_OPEN = "comm_open",
  COMM_MSG = "comm_msg",
  COMM_CLOSE = "comm_close",
  
  // Internal Events
  KERNEL_READY = "kernel_ready",
  KERNEL_BUSY = "kernel_busy",
  KERNEL_IDLE = "kernel_idle",
  
  // Special catchall for internal use
  ALL = "*", // Wildcard event type
  
  // Execution monitoring events
  EXECUTION_STALLED = "execution_stalled"
}

// Interface for kernel events
export interface IFilesystemMountOptions {
  enabled?: boolean;
  root?: string;
  mountPoint?: string;
}

// Interface for kernel options
export interface IKernelOptions {
  filesystem?: IFilesystemMountOptions;
}

// Interface for kernel
export interface IKernel extends EventEmitter {
  initialize(options?: IKernelOptions): Promise<void>;
  execute(code: string, parent?: any): Promise<{ success: boolean, result?: any, error?: Error }>;
  executeStream?(code: string, parent?: any): AsyncGenerator<any, { success: boolean, result?: any, error?: Error }, void>;
  isInitialized(): boolean;
  inputReply(content: { value: string }): Promise<void>;
  getStatus?(): "active" | "busy" | "unknown";
  status: "active" | "busy" | "unknown";
  
  // Optional methods
  complete?(code: string, cursor_pos: number, parent?: any): Promise<any>;
  inspect?(code: string, cursor_pos: number, detail_level: 0 | 1, parent?: any): Promise<any>;
  isComplete?(code: string, parent?: any): Promise<any>;
  commInfo?(target_name: string | null, parent?: any): Promise<any>;
  commOpen?(content: any, parent?: any): Promise<void>;
  commMsg?(content: any, parent?: any): Promise<void>;
  commClose?(content: any, parent?: any): Promise<void>;
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
  ident?: any;
}

// Event data structure with standardized format
export interface IEventData {
  type: string;
  data: any;
}

export class Kernel extends EventEmitter implements IKernel {
  private pyodide: any;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
  // Filesystem options
  private filesystemOptions: IFilesystemMountOptions = {
    enabled: false,
    root: ".",
    mountPoint: "/home/pyodide"
  };
  
  // Kernel components
  private _kernel: any;
  private _interpreter: any;
  private _stdout_stream: any;
  private _stderr_stream: any;
  
  // Input handling
  private _resolveInputReply: ((value: any) => void) | null = null;
  
  // Execution state
  private _parent_header: any = {};
  private executionCount = 0;
  private _status: "active" | "busy" | "unknown" = "unknown";
  
  constructor() {
    super();
    super.setMaxListeners(20);
  }

  // Getter for kernel status
  get status(): "active" | "busy" | "unknown" {
    return this._status;
  }

  /**
   * Initialize the kernel by loading Pyodide and installing required packages
   * @param options Kernel initialization options
   */
  public async initialize(options?: IKernelOptions): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initPromise) {
      return this.initPromise;
    }

    // Set filesystem options if provided
    if (options?.filesystem) {
      this.filesystemOptions = {
        ...this.filesystemOptions,
        ...options.filesystem
      };
    }

    this.initPromise = this._initializeInternal();
    return this.initPromise;
  }
  
  private async _initializeInternal(): Promise<void> {
    try {
      console.log("Loading Pyodide...");
      // Load Pyodide
      this.pyodide = await pyodideModule.loadPyodide();
      
      // Mount filesystem if enabled
      if (this.filesystemOptions.enabled) {
        await this.mountFilesystem();
      }
      
      // Initialize the components in order, following PyodideRemoteKernel
      await this.initPackageManager();
      await this.initKernel();
      await this.initGlobals();
      
      this.initialized = true;
      this._status = "active";
      console.log("Kernel initialization complete");
    } catch (error) {
      console.error("Error initializing kernel:", error);
      throw error;
    }
  }

  /**
   * Mount the local filesystem to the Pyodide environment
   */
  private async mountFilesystem(): Promise<void> {
    try {
      console.log(`Mounting filesystem from ${this.filesystemOptions.root} to ${this.filesystemOptions.mountPoint}`);
      
      // Use the same approach as in deno-demo-fs-asgi.js for maximum compatibility
      // Simple and direct mounting of the filesystem
      await this.pyodide.FS.mount(
        this.pyodide.FS.filesystems.NODEFS,
        { root: this.filesystemOptions.root || "." },
        this.filesystemOptions.mountPoint || "/home/pyodide"
      );
      
      console.log("Filesystem mounted successfully");
      
      // Verify the mount by listing the directory
      try {
        const mountedFiles = this.pyodide.FS.readdir(this.filesystemOptions.mountPoint || "/home/pyodide");
        console.log(`Files in ${this.filesystemOptions.mountPoint} directory: ${mountedFiles.join(", ")}`);
      } catch (error) {
        console.error(`Error listing mounted directory: ${error}`);
      }
    } catch (error) {
      console.error("Error mounting filesystem:", error);
      throw error;
    }
  }

  /**
   * Initialize the Pyodide package manager and install required packages
   * Based on the PyodideRemoteKernel implementation
   */
  private async initPackageManager(): Promise<void> {
    console.log("Initializing package manager...");
    
    try {
      // Load micropip
      console.log("Loading micropip, packaging");
      await this.pyodide.loadPackage(['micropip', 'packaging']);
      console.log("Loaded micropip, packaging");
      
      // Use import.meta.url to get the base URL
      const baseUrl = new URL(".", import.meta.url).href;
      const allJsonPath = new URL(allJSONUrl, baseUrl).href;
      const wheelFiles = [
        new URL(pipliteWheelUrl, baseUrl).href,
        new URL(pyodide_kernelWheelUrl, baseUrl).href,
        new URL(ipykernelWheelUrl, baseUrl).href
      ];
      
      console.log(`Loading wheels from: ${baseUrl}`);
      console.log(`allJsonPath: ${allJsonPath}`);
      console.log(`wheelFiles: ${wheelFiles.join(", ")}`);
      
      // Install the packages using micropip directly with local file URLs
      // First make our URLs available to Python
      this.pyodide.globals.set("piplite_wheel_url", wheelFiles[0]);
      this.pyodide.globals.set("pyodide_kernel_wheel_url", wheelFiles[1]);
      this.pyodide.globals.set("ipykernel_wheel_url", wheelFiles[2]);
      this.pyodide.globals.set("all_json_url", allJsonPath);
      
      await this.pyodide.runPythonAsync(`
import micropip
import sys

# Get the URLs from the globals
piplite_url = piplite_wheel_url
pyodide_kernel_url = pyodide_kernel_wheel_url
ipykernel_url = ipykernel_wheel_url
all_json_url = all_json_url

# Install piplite first (wheel needs to be available at a URL)
print(f"Installing piplite from {piplite_url}")
await micropip.install(piplite_url)

# Now import piplite and use it
import piplite

# Set the all.json URL
piplite.piplite._PIPLITE_URLS = [all_json_url]

# Install other packages directly from wheel URLs
print(f"Installing pyodide_kernel from {pyodide_kernel_url}")
await micropip.install(pyodide_kernel_url)

print(f"Installing ipykernel from {ipykernel_url}")
await micropip.install(ipykernel_url)

# Print status
print(f"Piplite configuration: {piplite.piplite._PIPLITE_URLS}")
`);
    } catch (error) {
      console.error("Error in initPackageManager:", error);
      throw error;
    }
  }

  /**
   * Initialize the kernel with required Python packages
   * Based on the PyodideRemoteKernel implementation
   */
  private async initKernel(): Promise<void> {
    console.log("Initializing kernel packages...");
    
    // List of packages to load (matches PyodideRemoteKernel)
    const toLoad = [
      'ssl',
      'sqlite3',
      'ipykernel',
      'comm',
      'pyodide_kernel',
      'jedi',
      'ipython',
      'nbformat'
    ];

    // Use piplite to install required packages
    const scriptLines: string[] = [];

    for (const pkgName of toLoad) {
      scriptLines.push(`await piplite.install('${pkgName}', keep_going=True)`);
    }
    
    // Import the kernel
    scriptLines.push('import pyodide_kernel');
    
    // Execute the installation
    await this.pyodide.runPythonAsync(scriptLines.join('\n'));
  }
  
  /**
   * Initialize global objects from the pyodide_kernel package
   * Based on the PyodideRemoteKernel implementation
   */
  private async initGlobals(): Promise<void> {
    console.log("Initializing globals...");
    
    // Get the globals from the Python environment
    const { globals } = this.pyodide;
    
    // Get the kernel instance and related objects
    this._kernel = globals.get('pyodide_kernel').kernel_instance.copy();
    this._stdout_stream = globals.get('pyodide_kernel').stdout_stream.copy();
    this._stderr_stream = globals.get('pyodide_kernel').stderr_stream.copy();
    this._interpreter = this._kernel.interpreter.copy();
    
    // Set up communication handlers
    this._interpreter.send_comm = this.sendComm.bind(this);
    
    // Set up callbacks
    this.setupCallbacks();
  }
  
  /**
   * Setup all necessary callbacks for the Python environment
   */
  private setupCallbacks(): void {
    // Execution result callback
    const publishExecutionResult = (
      prompt_count: any,
      data: any,
      metadata: any,
    ): void => {
      const bundle = {
        execution_count: prompt_count,
        data: this.formatResult(data),
        metadata: this.formatResult(metadata),
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
        type: 'execute_result',
      });
    };

    // Error callback
    const publishExecutionError = (ename: any, evalue: any, traceback: any): void => {
      const bundle = {
        ename: ename,
        evalue: evalue,
        traceback: traceback,
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
          type: 'execute_error',
      });
    };

    // Clear output callback
    const clearOutputCallback = (wait: boolean): void => {
      const bundle = {
        wait: this.formatResult(wait),
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
          type: 'clear_output',
      });
    };

    // Display data callback
    const displayDataCallback = (data: any, metadata: any, transient: any): void => {
      const bundle = {
        data: this.formatResult(data),
        metadata: this.formatResult(metadata),
        transient: this.formatResult(transient),
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
        type: 'display_data',
      });
    };

    // Update display data callback
    const updateDisplayDataCallback = (
      data: any,
      metadata: any,
      transient: any,
    ): void => {
      const bundle = {
        data: this.formatResult(data),
        metadata: this.formatResult(metadata),
        transient: this.formatResult(transient),
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
        type: 'update_display_data',
      });
    };

    // Stream callback
    const publishStreamCallback = (name: any, text: any): void => {
      const bundle = {
        name: this.formatResult(name),
        text: this.formatResult(text),
      };

      this._sendMessage({
        parentHeader: this.formatResult(this._parent_header)['header'],
        bundle,
        type: 'stream',
      });
    };

    // Assign callbacks to the Python objects
    this._stdout_stream.publish_stream_callback = publishStreamCallback;
    this._stderr_stream.publish_stream_callback = publishStreamCallback;
    this._interpreter.display_pub.clear_output_callback = clearOutputCallback;
    this._interpreter.display_pub.display_data_callback = displayDataCallback;
    this._interpreter.display_pub.update_display_data_callback = updateDisplayDataCallback;
    this._interpreter.displayhook.publish_execution_result = publishExecutionResult;
    this._interpreter.input = this.input.bind(this);
    this._interpreter.getpass = this.getpass.bind(this);
  }
  
  /**
   * Process a message from Python environment
   */
  private _sendMessage(msg: IMessage): void {
    this._processMessage(msg);
  }
  
  /**
   * Process a message by emitting the appropriate event
   */
  private _processMessage(msg: IMessage): void {
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
      case 'input_request': {
        const content = msg.content ?? { prompt: '', password: false };
        super.emit(KernelEvents.INPUT_REQUEST, content);
        eventData = content;
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
      case 'clear_output': {
        const bundle = msg.bundle ?? { wait: false };
        super.emit(KernelEvents.CLEAR_OUTPUT, bundle);
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
      case 'comm_open':
      case 'comm_msg':
      case 'comm_close': {
        const content = msg.content ?? {};
        super.emit(msg.type, content, msg.metadata, msg.buffers);
        eventData = {
          content,
          metadata: msg.metadata,
          buffers: msg.buffers
        };
        break;
      }
    }

    // Emit the ALL event with standardized format
    if (eventData) {
      super.emit(KernelEvents.ALL, {
        type: msg.type,
        data: eventData
      } as IEventData);
    }
  }
  
  /**
   * Check if the kernel has been initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Makes sure pyodide is ready before continuing, and cache the parent message.
   */
  private async setup(parent: any): Promise<void> {
    await this.initialize();
    this._parent_header = this.pyodide.toPy(parent || {});
  }
  
  /**
   * Execute code in the kernel
   * 
   * @param code The code to execute
   * @param parent Parent message header
   * @returns The result of the execution
   */
  public async execute(code: string, parent: any = {}): Promise<{ success: boolean, result?: any, error?: Error }> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      this._status = "busy";
      console.log("Executing Python code...");
      
      // Set up parent header for message callbacks
      await this.setup(parent);
      
      // Execute the code using the IPython interpreter
      const result = await this._kernel.run(code);
      
      // Debug the result structure
      console.debug("Python execution result structure:", JSON.stringify(result, null, 2));
      
      // Check if there was a Python error - look for error status or error fields directly in result
      // or inside a nested result object
      if (result && 
         ((result.status === 'error') || 
          (result.ename) || 
          (result.evalue))) {
        
        this._status = "active";
        
        // Send the error as an execute_error event
        this._sendMessage({
          type: 'execute_error',
          bundle: {
            ename: result.ename || 'Error',
            evalue: result.evalue || 'Unknown error',
            traceback: result.traceback || []
          }
        });
        
        return {
          success: false,
          error: new Error(`${result.ename || 'Error'}: ${result.evalue || 'Unknown error'}`),
          result: result
        };
      }
      
      // Get the last expression value if available
      const lastExpr = this.pyodide.globals.get('_');
      if (lastExpr !== undefined && lastExpr !== null && String(lastExpr) !== 'None') {
        const value = this.formatResult(lastExpr);
        if (value !== undefined && value !== null && String(value) !== 'None') {
          this._sendMessage({
            type: 'execute_result',
            bundle: {
              execution_count: this.executionCount++,
              data: { 'text/plain': String(value) },
              metadata: {}
            }
          });
        }
      }
      
      // Format the result for the return value
      const formattedResult = this.formatResult(result);
      
      // Check if the formatted result contains error information
      if (formattedResult && 
         ((formattedResult.status === 'error') || 
          (formattedResult.ename) || 
          (formattedResult.evalue))) {
        
        this._status = "active";
        
        // Send the error as an execute_error event if not already sent
        this._sendMessage({
          type: 'execute_error',
          bundle: {
            ename: formattedResult.ename || 'Error',
            evalue: formattedResult.evalue || 'Unknown error',
            traceback: formattedResult.traceback || []
          }
        });
        
        return {
          success: false,
          error: new Error(`${formattedResult.ename || 'Error'}: ${formattedResult.evalue || 'Unknown error'}`),
          result: formattedResult
        };
      }
      
      this._status = "active";
      return {
        success: true,
        result: formattedResult
      };
    } catch (error) {
      console.error("JavaScript error during execution:", error);
      
      // Send the error as an execute_error event
      this._sendMessage({
        type: 'execute_error',
        bundle: {
          ename: error instanceof Error ? error.name : 'Error',
          evalue: error instanceof Error ? error.message : String(error),
          traceback: error instanceof Error && error.stack ? [error.stack] : ['No traceback available']
        }
      });
      
      this._status = "active";
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
  
  /**
   * Format the result from the Pyodide evaluation
   * Based on PyodideRemoteKernel implementation
   */
  private formatResult(res: any): any {
    if (!(res instanceof this.pyodide.ffi.PyProxy)) {
      return res;
    }
    
    try {
      // Convert PyProxy to JS
      const m = res.toJs();
      const results = this.mapToObject(m);
      return results;
    } catch (error) {
      console.error("Error formatting result:", error);
      return { status: 'error', error: String(error) };
    }
  }
  
  /**
   * Convert a Map to a JavaScript object recursively
   * Based on PyodideRemoteKernel implementation
   */
  private mapToObject(obj: any) {
    const out: any = obj instanceof Array ? [] : {};
    
    obj.forEach((value: any, key: string) => {
      out[key] = 
        value instanceof Map || value instanceof Array
          ? this.mapToObject(value)
          : value;
    });
    
    return out;
  }
  
  /**
   * Handle input reply from user
   */
  public async inputReply(content: { value: string }): Promise<void> {
    if (this._resolveInputReply) {
      this._resolveInputReply(content);
      this._resolveInputReply = null;
    }
  }
  
  /**
   * Send a input request to the front-end.
   */
  private async sendInputRequest(prompt: string, password: boolean): Promise<void> {
    const content = {
      prompt,
      password,
    };

    this._sendMessage({
      type: 'input_request',
      content,
      parentHeader: this.formatResult(this._parent_header)['header']
    });
  }

  /**
   * Get password input (with hidden input)
   */
  private async getpass(prompt: string): Promise<string> {
    prompt = typeof prompt === 'undefined' ? '' : prompt;
    await this.sendInputRequest(prompt, true);
    const replyPromise = new Promise<{ value: string }>((resolve) => {
      this._resolveInputReply = resolve;
    });
    const result = await replyPromise;
    return result.value;
  }

  /**
   * Get text input
   */
  private async input(prompt: string): Promise<string> {
    prompt = typeof prompt === 'undefined' ? '' : prompt;
    await this.sendInputRequest(prompt, false);
    const replyPromise = new Promise<{ value: string }>((resolve) => {
      this._resolveInputReply = resolve;
    });
    const result = await replyPromise;
    return result.value;
  }
  
  /**
   * Send a comm message to the front-end.
   */
  private async sendComm(type: string, content: any, metadata: any, ident: any, buffers: any): Promise<void> {
    this._sendMessage({
      type: type,
      content: this.formatResult(content),
      metadata: this.formatResult(metadata),
      ident: this.formatResult(ident),
      buffers: this.formatResult(buffers),
      parentHeader: this.formatResult(this._parent_header)['header'],
    });
  }
  
  /**
   * Complete the code submitted by a user.
   */
  public async complete(code: string, cursor_pos: number, parent: any = {}): Promise<any> {
    await this.setup(parent);
    
    const res = this._kernel.complete(code, cursor_pos);
    return this.formatResult(res);
  }

  /**
   * Inspect the code submitted by a user.
   */
  public async inspect(code: string, cursor_pos: number, detail_level: 0 | 1, parent: any = {}): Promise<any> {
    await this.setup(parent);
    
    const res = this._kernel.inspect(code, cursor_pos, detail_level);
    return this.formatResult(res);
  }

  /**
   * Check code for completeness.
   */
  public async isComplete(code: string, parent: any = {}): Promise<any> {
    await this.setup(parent);
    
    const res = this._kernel.is_complete(code);
    return this.formatResult(res);
  }

  /**
   * Get information about available comms.
   */
  public async commInfo(target_name: string | null, parent: any = {}): Promise<any> {
    await this.setup(parent);
    
    const res = this._kernel.comm_info(target_name);
    return {
      comms: this.formatResult(res),
      status: 'ok',
    };
  }

  /**
   * Open a COMM
   */
  public async commOpen(content: any, parent: any = {}): Promise<void> {
    await this.setup(parent);
    
    const res = this._kernel.comm_manager.comm_open(
      this.pyodide.toPy(null),
      this.pyodide.toPy(null),
      this.pyodide.toPy(content)
    );
    
    return this.formatResult(res);
  }
  
  /**
   * Send a message through a COMM
   */
  public async commMsg(content: any, parent: any = {}): Promise<void> {
    await this.setup(parent);
    
    const res = this._kernel.comm_manager.comm_msg(
      this.pyodide.toPy(null),
      this.pyodide.toPy(null),
      this.pyodide.toPy(content)
    );
    
    return this.formatResult(res);
  }
  
  /**
   * Close a COMM
   */
  public async commClose(content: any, parent: any = {}): Promise<void> {
    await this.setup(parent);
    
    const res = this._kernel.comm_manager.comm_close(
      this.pyodide.toPy(null),
      this.pyodide.toPy(null),
      this.pyodide.toPy(content)
    );
    
    return this.formatResult(res);
  }

  /**
   * Execute Python code with streaming output
   * @param code The Python code to execute
   * @param parent Parent message header
   * @returns AsyncGenerator yielding intermediate outputs and finally the execution result
   */
  public async* executeStream(code: string, parent: any = {}): AsyncGenerator<any, { success: boolean, result?: any, error?: Error }, void> {
    try {
      await this.initialize();
      await this.setup(parent);
      
      this._status = "busy";
      
      // Create event listeners
      const eventQueue: IEventData[] = [];
      
      const handleAllEvents = (eventData: IEventData) => {
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
        
        this._status = "active";
        return result;
      } finally {
        // Clean up listener in finally block to ensure it's always removed
        super.off(KernelEvents.ALL, handleAllEvents);
      }
    } catch (error) {
      this._status = "active";
      console.error("Error in executeStream:", error);
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error))
      };
    }
  }
}

// Export TypeScript kernel for main thread use
export { TypeScriptKernel } from "./tsKernel.ts";
