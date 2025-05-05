// Kernel implementation for Deno using Pyodide directly
// Based on the PyodideRemoteKernel but adapted for direct execution in main thread

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
  execute(code: string, parent?: any): Promise<{ success: boolean, result?: any, error?: Error }>;
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
  ident?: any;
}

export class Kernel extends EventEmitter implements IKernel {
  private pyodide: any;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  
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
  
  constructor() {
    super();
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
      // Load Pyodide
      this.pyodide = await pyodideModule.loadPyodide();
      
      // Initialize the components in order, following PyodideRemoteKernel
      await this.initPackageManager();
      await this.initKernel();
      await this.initGlobals();
      
      this.initialized = true;
      console.log("Kernel initialization complete");
    } catch (error) {
      console.error("Error initializing kernel:", error);
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
      'ipython'
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
          execution_count: this.executionCount,
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
      case 'comm_open':
      case 'comm_msg':
      case 'comm_close': {
        this.emit(msg.type, msg.content ?? {}, msg.metadata, msg.buffers);
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
   * Makes sure pyodide is ready before continuing, and cache the parent message.
   */
  private async setup(parent: any): Promise<void> {
    await this.initialize();
    this._parent_header = this.pyodide.toPy(parent || {});
  }
  
  /**
   * Execute Python code
   * @param code The Python code to execute
   * @param parent Parent message header
   * @returns Result of execution
   */
  public async execute(code: string, parent: any = {}): Promise<{ success: boolean, result?: any, error?: Error }> {
    await this.setup(parent);
    
    try {
      // Increment execution count
      this.executionCount++;
      
      // Execute the code using the kernel's run method
      const res = await this._kernel.run(code);
      const results = this.formatResult(res);
      
      if (results['status'] === 'error') {
        return {
          success: false,
          error: new Error(`${results['ename']}: ${results['evalue']}`),
          result: results
        };
      }
      
      return { success: true, result: results };
    } catch (error) {
      console.error("Error executing code:", error);
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
}
