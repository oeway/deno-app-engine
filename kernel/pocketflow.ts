// PocketFlow TypeScript/Deno Implementation - 100-line minimalist LLM framework
// Adapted from the original Python version at https://github.com/The-Pocket/PocketFlow

export interface SharedState {
  [key: string]: any;
}

export interface NodeParams {
  [key: string]: any;
}

export abstract class BaseNode {
  protected params: NodeParams = {};
  public successors: Record<string, BaseNode> = {};

  setParams(params: NodeParams): void {
    this.params = params;
  }

  next(node: BaseNode, action: string = "default"): BaseNode {
    if (action in this.successors) {
      console.warn(`Overwriting successor for action '${action}'`);
    }
    this.successors[action] = node;
    return node;
  }

  prep(shared: SharedState): any {
    // Override in subclasses
  }

  exec(prepRes: any): any {
    // Override in subclasses
  }

  post(shared: SharedState, prepRes: any, execRes: any): string | null {
    // Override in subclasses
    return null;
  }

  protected _exec(prepRes: any): any {
    return this.exec(prepRes);
  }

  protected _run(shared: SharedState): string | null {
    const prepRes = this.prep(shared);
    const execRes = this._exec(prepRes);
    return this.post(shared, prepRes, execRes);
  }

  // Public interface for flow orchestration
  public runNode(shared: SharedState): string | null {
    return this._run(shared);
  }

  run(shared: SharedState): string | null {
    if (Object.keys(this.successors).length > 0) {
      console.warn("Node won't run successors. Use Flow.");
    }
    return this._run(shared);
  }

  // Operator overloading with method chaining
  rshift(other: BaseNode): BaseNode {
    return this.next(other);
  }

  sub(action: string): ConditionalTransition {
    if (typeof action !== 'string') {
      throw new TypeError("Action must be a string");
    }
    return new ConditionalTransition(this, action);
  }
}

class ConditionalTransition {
  constructor(private src: BaseNode, private action: string) {}

  rshift(target: BaseNode): BaseNode {
    return this.src.next(target, this.action);
  }
}

export class Node extends BaseNode {
  constructor(
    protected maxRetries: number = 1,
    protected wait: number = 0
  ) {
    super();
  }

  execFallback(prepRes: any, exc: Error): any {
    throw exc;
  }

  protected _exec(prepRes: any): any {
    for (let curRetry = 0; curRetry < this.maxRetries; curRetry++) {
      try {
        return this.exec(prepRes);
      } catch (e) {
        if (curRetry === this.maxRetries - 1) {
          return this.execFallback(prepRes, e as Error);
        }
        if (this.wait > 0) {
          // Synchronous sleep for compatibility
          const start = Date.now();
          while (Date.now() - start < this.wait) {
            // Busy wait
          }
        }
      }
    }
  }
}

export class BatchNode extends Node {
  protected _exec(items: any[]): any[] {
    return (items || []).map(item => super._exec(item));
  }
}

export class Flow extends BaseNode {
  constructor(protected startNode?: BaseNode) {
    super();
  }

  start(startNode: BaseNode): BaseNode {
    this.startNode = startNode;
    return startNode;
  }

  protected getNextNode(current: BaseNode, action: string | null): BaseNode | null {
    const next = current.successors[action || "default"];
    if (!next && Object.keys(current.successors).length > 0) {
      console.warn(`Flow ends: '${action}' not found in ${Object.keys(current.successors)}`);
    }
    return next || null;
  }

  protected _orch(shared: SharedState, params?: NodeParams): string | null {
    if (!this.startNode) {
      throw new Error("Start node not set");
    }
    
    let current: BaseNode | null = this.copyNode(this.startNode);
    const p = params || { ...this.params };
    let lastAction: string | null = null;

    while (current) {
      current.setParams(p);
      lastAction = current.runNode(shared);
      const next = this.getNextNode(current, lastAction);
      current = next ? this.copyNode(next) : null;
    }

    return lastAction;
  }

  protected copyNode(node: BaseNode): BaseNode {
    // Simple shallow copy for now
    const copy = Object.create(Object.getPrototypeOf(node));
    Object.assign(copy, node);
    return copy;
  }

  protected _run(shared: SharedState): string | null {
    const prepRes = this.prep(shared);
    const orchRes = this._orch(shared);
    return this.post(shared, prepRes, orchRes);
  }

  post(shared: SharedState, prepRes: any, execRes: any): string | null {
    return execRes;
  }
}

export class BatchFlow extends Flow {
  protected _run(shared: SharedState): string | null {
    const prepRes = this.prep(shared) || [];
    for (const batchParams of prepRes) {
      this._orch(shared, { ...this.params, ...batchParams });
    }
    return this.post(shared, prepRes, null);
  }
}

// Async versions
export abstract class AsyncNode extends Node {
  async prepAsync(shared: SharedState): Promise<any> {
    // Override in subclasses
  }

  async execAsync(prepRes: any): Promise<any> {
    // Override in subclasses
  }

  async execFallbackAsync(prepRes: any, exc: Error): Promise<any> {
    throw exc;
  }

  async postAsync(shared: SharedState, prepRes: any, execRes: any): Promise<string | null> {
    // Override in subclasses
    return null;
  }

  protected async _exec(prepRes: any): Promise<any> {
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await this.execAsync(prepRes);
      } catch (e) {
        if (i === this.maxRetries - 1) {
          return await this.execFallbackAsync(prepRes, e as Error);
        }
        if (this.wait > 0) {
          await new Promise(resolve => setTimeout(resolve, this.wait));
        }
      }
    }
  }

  async runAsync(shared: SharedState): Promise<string | null> {
    if (Object.keys(this.successors).length > 0) {
      console.warn("Node won't run successors. Use AsyncFlow.");
    }
    return await this._runAsync(shared);
  }

  protected async _runAsync(shared: SharedState): Promise<string | null> {
    const prepRes = await this.prepAsync(shared);
    const execRes = await this._exec(prepRes);
    return await this.postAsync(shared, prepRes, execRes);
  }

  // Public interface for async flow orchestration
  public async runNodeAsync(shared: SharedState): Promise<string | null> {
    return await this._runAsync(shared);
  }

  public runNode(shared: SharedState): string | null {
    throw new Error("Use runNodeAsync for AsyncNode.");
  }

  protected _run(shared: SharedState): string | null {
    throw new Error("Use runAsync.");
  }
}

export class AsyncBatchNode extends AsyncNode {
  protected async _exec(items: any[]): Promise<any[]> {
    const results = [];
    for (const item of items || []) {
      results.push(await super._exec(item));
    }
    return results;
  }
}

export class AsyncParallelBatchNode extends AsyncNode {
  protected async _exec(items: any[]): Promise<any[]> {
    return await Promise.all((items || []).map(item => super._exec(item)));
  }
}

export class AsyncFlow extends Flow {
  protected async _orchAsync(shared: SharedState, params?: NodeParams): Promise<string | null> {
    if (!this.startNode) {
      throw new Error("Start node not set");
    }
    
    let current: BaseNode | null = this.copyNode(this.startNode);
    const p = params || { ...this.params };
    let lastAction: string | null = null;

    while (current) {
      current.setParams(p);
      if (current instanceof AsyncNode) {
        lastAction = await current.runNodeAsync(shared);
      } else {
        lastAction = current.runNode(shared);
      }
      const next = this.getNextNode(current, lastAction);
      current = next ? this.copyNode(next) : null;
    }

    return lastAction;
  }

  protected async _runAsync(shared: SharedState): Promise<string | null> {
    const prepRes = await this.prepAsync(shared);
    const orchRes = await this._orchAsync(shared);
    return await this.postAsync(shared, prepRes, orchRes);
  }

  async prepAsync(shared: SharedState): Promise<any> {
    // Override in subclasses
  }

  async postAsync(shared: SharedState, prepRes: any, execRes: any): Promise<string | null> {
    return execRes;
  }
}

export class AsyncBatchFlow extends AsyncFlow {
  protected async _runAsync(shared: SharedState): Promise<string | null> {
    const prepRes = await this.prepAsync(shared) || [];
    for (const batchParams of prepRes) {
      await this._orchAsync(shared, { ...this.params, ...batchParams });
    }
    return await this.postAsync(shared, prepRes, null);
  }
}

export class AsyncParallelBatchFlow extends AsyncFlow {
  protected async _runAsync(shared: SharedState): Promise<string | null> {
    const prepRes = await this.prepAsync(shared) || [];
    await Promise.all(prepRes.map(batchParams => 
      this._orchAsync(shared, { ...this.params, ...batchParams })
    ));
    return await this.postAsync(shared, prepRes, null);
  }
}

// Utility functions for operator overloading simulation
export function connect(source: BaseNode, target: BaseNode): BaseNode {
  return source.rshift(target);
}

export function conditionalConnect(source: BaseNode, action: string, target: BaseNode): BaseNode {
  return source.sub(action).rshift(target);
}