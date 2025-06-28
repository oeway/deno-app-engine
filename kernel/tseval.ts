// deno run --allow-all tseval.ts
import { encodeBase64 } from "jsr:@std/encoding/base64";
import * as parser from "npm:@babel/parser";
import traverseModule from "npm:@babel/traverse";
const traverse = traverseModule.default;

// Define interface for metadata
interface VariableMeta {
  kind: string;
}

// Define interface for context
interface EvalContext extends Record<string, any> {
  __meta: Record<string, VariableMeta>;
  __history: string[];
}

export function createTSEvalContext(options?: { context?: Record<string, any> }) {
  const context: EvalContext = options?.context as EvalContext ?? {} as EvalContext;
  context.__meta = context.__meta ?? {}; // Track variable kinds
  context.__history = context.__history ?? [];

  const getHistory = () => context.__history;

  const getVariables = () => {
    return Object.keys(context).filter(key => !key.startsWith("__"));
  }

  const reset = () => {
    for (const key of Object.keys(context)) {
      if (!key.startsWith("__")) delete context[key];
    }
    context.__meta = {};
    context.__history = [];
  };

  const evaluate = async function tseval(code: string): Promise<{ result?: any, mod?: any }> {
    context.__history.push(code);

    // Parse the code to detect new variable declarations and trailing expressions
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["topLevelAwait", "typescript"]
    });

    // Collect variable names that will be defined in this execution
    const newVariables = new Set<string>();
    let lastExprCode = "";
    
    traverse(ast, {
      Program(path: any) {
        const body = path.node.body;
        
        // Collect all variable declarations in this execution
        for (const stmt of body) {
          if (stmt.type === "VariableDeclaration") {
            for (const decl of stmt.declarations) {
              if (decl.id && decl.id.type === "Identifier") {
                newVariables.add(decl.id.name);
                // Store the kind of declaration
                context.__meta[decl.id.name] = { kind: stmt.kind };
              }
            }
          } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
            newVariables.add(stmt.id.name);
            context.__meta[stmt.id.name] = { kind: "function" };
          } else if (stmt.type === "ClassDeclaration" && stmt.id) {
            newVariables.add(stmt.id.name);
            context.__meta[stmt.id.name] = { kind: "class" };
          } else if (stmt.type === "ImportDeclaration") {
            // Handle different types of import statements
            for (const specifier of stmt.specifiers) {
              if (specifier.type === "ImportDefaultSpecifier") {
                // import lodash from "npm:lodash"
                newVariables.add(specifier.local.name);
                context.__meta[specifier.local.name] = { kind: "const" };
              } else if (specifier.type === "ImportSpecifier") {
                // import { encodeBase64 } from "jsr:@std/encoding/base64"
                newVariables.add(specifier.local.name);
                context.__meta[specifier.local.name] = { kind: "const" };
              } else if (specifier.type === "ImportNamespaceSpecifier") {
                // import * as path from "jsr:@std/path"
                newVariables.add(specifier.local.name);
                context.__meta[specifier.local.name] = { kind: "const" };
              }
            }
          }
        }
        
        // Check if the last statement is an expression (for return value)
        const lastStmt = body[body.length - 1];
        if (lastStmt?.type === "ExpressionStatement") {
          // Get just the expression part, not the entire statement (which includes semicolon)
          lastExprCode = code.slice(lastStmt.expression.start!, lastStmt.expression.end!);
        }
      }
    });

    // Build prelude - make existing context variables available as regular variables
    // But exclude variables that are being redeclared in this execution
    const prelude = Object.entries(context.__meta)
      .filter(([key]) => !newVariables.has(key)) // Only include variables NOT being redeclared
      .map(([key, meta]: [string, VariableMeta]) => {
        if (meta.kind === "function") {
          return `function ${key}(...args) { return context["${key}"].apply(this, args); }`;
        } else if (meta.kind === "class") {
          return `const ${key} = context["${key}"];`;
        } else {
          return `${meta.kind} ${key} = context["${key}"];`;
        }
      })
      .join("\n");

    // Build trailing code - capture new variables and result
    const captureVariables = Array.from(newVariables)
      .map(varName => `context["${varName}"] = ${varName};`)
      .join("\n");

    // If there's a trailing expression, modify the code to capture its result without re-executing
    let finalCode;
    if (lastExprCode) {
      // Be more careful about replacement - only replace at the end of the code
      // and make sure we're not replacing part of an assignment or declaration
      const codeBeforeExpression = code.slice(0, code.lastIndexOf(lastExprCode));
      const codeAfterExpression = code.slice(code.lastIndexOf(lastExprCode) + lastExprCode.length);
      
      // Only do the replacement if this is truly a trailing expression (no significant code after it)
      if (codeAfterExpression.trim() === '' || codeAfterExpression.trim() === ';') {
        const modifiedCode = codeBeforeExpression + `(context._ = (${lastExprCode}))` + codeAfterExpression;
        finalCode = `const context = globalThis.__tseval_context__;
${prelude}

${modifiedCode}

${captureVariables}`;
      } else {
        // Fall back to the old approach if the expression is not at the end
        finalCode = `const context = globalThis.__tseval_context__;
${prelude}

${code}

${captureVariables}
context._ = (${lastExprCode});`;
      }
    } else {
      finalCode = `const context = globalThis.__tseval_context__;
${prelude}

${code}

${captureVariables}`;
    }



    const encoded = encodeBase64(finalCode);
    (globalThis as any).__tseval_context__ = context;

    const mod = await import(
      `data:application/typescript;charset=utf-8;base64,${encoded}`
    );

    return {
      result: context._,
      mod,
    };
  };

  return Object.assign(evaluate, { reset, getHistory, getVariables });
}

if (import.meta.main) {
  const consoleProxy = {
    log: (...args: any[]) => console.log("[console]", ...args),
  };

  const tseval = createTSEvalContext({
    context: {
      customValue: 123,
      console: consoleProxy,
    },
  });

  const run = async (code: string, label = "") => {
    try {
      const { result, mod } = await tseval(code);
      if (label) console.log(`▶ ${label}:`, result);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.error(`❌ ${label}:`, errorMessage);
    }
  };

  console.log("\n--- Simulated Jupyter REPL Session ---\n");

  await run(`console.log("customValue is", context.customValue)`, "print customValue");
  await run(`let x = 10`, "declare let x");
  await run(`const y = x + 5`, "declare const y");
  await run(`x + y`, "expression: x + y");
  await run(`x = x + 20`, "modify x");
  await run(`x`, "read modified x");
  await run(`const nums = [1, 2, 3]`, "declare array");
  await run(`nums.push(4); nums`, "mutate array");
  await run(`const config = { debug: true }`, "declare object");
  await run(`config.debug = false; config`, "mutate object");
  await run(`function square(n) { return n * n }`, "declare function");
  await run(`square(x)`, "call function");
  await run(`class Greeter { constructor(name) { this.name = name; } greet() { return 'Hi ' + this.name; } }`, "declare class");
  await run(`const g = new Greeter("Bob")`, "instantiate class");
  await run(`g.greet()`, "call method");
  await run(`var z = 100`, "declare var z");
  await run(`z += 50`, "modify z");
  await run(`z`, "read modified z");
  await run(`const a = await Promise.resolve(42)`, "top-level await");
  await run(`a * 2`, "expression after await");
  await run(`x = x + a`, "combine x and a");
  await run(`x`, "read final x");
  await run(`type A = { a: number }; const val: A = { a: 1 };`, "typescript type");
  await run(`console.log("val.a =", val.a)`, "access typed object");
  await run(`import * as path from "jsr:@std/path"; path.basename("/foo/bar.txt")`, "deno import");
  const { mod } = await tseval(`export const test = "test";`);
  console.log(`▶ mod export:`, mod);
  // get history
  console.log(`▶ context history:`, tseval.getHistory());
  // get variables
  console.log(`▶ context variables:`, tseval.getVariables());

  // ✅ test context reset
  tseval.reset();
  await run(`typeof x`, "check after reset x");

  // ✅ test context history
  console.log(`▶ context history:`, tseval.getHistory());

  // ✅ test context variables
  console.log(`▶ context variables:`, tseval.getVariables());

  console.log("\n--- End of Session ---\n");
}
