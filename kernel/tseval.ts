// deno run --allow-all tseval.ts
import { encodeBase64 } from "jsr:@std/encoding/base64";
import * as babel from "npm:@babel/core";
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

// ✅ Babel plugin that rewrites top-level vars to context assignments with kind tracking
const rewriteTopLevelToContext = ({ types: t }: { types: any }) => ({
  visitor: {
    Program(path: any, state: any) {
      const contextId = t.identifier(state.opts?.contextIdentifier || "context");
      const metaId = t.memberExpression(contextId, t.identifier("__meta"));
      const ensureMeta = t.expressionStatement(
        t.assignmentExpression(
          "=",
          metaId,
          t.logicalExpression("||", metaId, t.objectExpression([]))
        )
      );

      const newBody = [ensureMeta];

      for (const stmt of path.node.body) {
        if (t.isVariableDeclaration(stmt)) {
          for (const decl of stmt.declarations) {
            if (t.isIdentifier(decl.id)) {
              newBody.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(contextId, decl.id),
                    decl.init || t.identifier("undefined")
                  )
                ),
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(metaId, t.stringLiteral(decl.id.name), true),
                    t.objectExpression([t.objectProperty(t.identifier("kind"), t.stringLiteral(stmt.kind))])
                  )
                )
              );
            }
          }
        } else if (t.isFunctionDeclaration(stmt) && stmt.id) {
          newBody.push(
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(contextId, stmt.id),
                t.functionExpression(stmt.id, stmt.params, stmt.body, stmt.generator, stmt.async)
              )
            ),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(metaId, t.stringLiteral(stmt.id.name), true),
                t.objectExpression([t.objectProperty(t.identifier("kind"), t.stringLiteral("function"))])
              )
            )
          );
        } else if (t.isClassDeclaration(stmt) && stmt.id) {
          newBody.push(
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(contextId, stmt.id),
                t.classExpression(stmt.id, stmt.superClass, stmt.body)
              )
            ),
            t.expressionStatement(
              t.assignmentExpression(
                "=",
                t.memberExpression(metaId, t.stringLiteral(stmt.id.name), true),
                t.objectExpression([t.objectProperty(t.identifier("kind"), t.stringLiteral("class"))])
              )
            )
          );
        } else if (t.isExportNamedDeclaration(stmt) && stmt.declaration) {
          if (t.isVariableDeclaration(stmt.declaration)) {
            for (const decl of stmt.declaration.declarations) {
              if (t.isIdentifier(decl.id)) {
                newBody.push(
                  t.expressionStatement(
                    t.assignmentExpression(
                      "=",
                      t.memberExpression(contextId, decl.id),
                      decl.init || t.identifier("undefined")
                    )
                  ),
                  t.expressionStatement(
                    t.assignmentExpression(
                      "=",
                      t.memberExpression(metaId, t.stringLiteral(decl.id.name), true),
                      t.objectExpression([t.objectProperty(t.identifier("kind"), t.stringLiteral(stmt.declaration.kind))])
                    )
                  )
                );
              }
            }
          }
        } else {
          newBody.push(stmt);
        }
      }

      path.node.body = newBody;
    },
  },
});

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

    const prelude = Object.entries(context.__meta)
      .map(([key, meta]: [string, VariableMeta]) => {
        if (meta.kind === "function") return `function ${key}(...args) { return context["${key}"].apply(this, args); }`;
        if (meta.kind === "class") return `const ${key} = context["${key}"];`;
        return `${meta.kind} ${key} = context["${key}"];`;
      })
      .join("\n");

    let lastExprCode = "";
    const ast = parser.parse(code, {
      sourceType: "module",
      plugins: ["topLevelAwait", "typescript"]
    });

    traverse(ast, {
      Program(path: any) {
        const body = path.node.body;
        const lastStmt = body[body.length - 1];
        if (lastStmt?.type === "ExpressionStatement") {
          lastExprCode = code.slice(lastStmt.start!, lastStmt.end!);
          body.pop();
        }
      }
    });

    const transformed = await babel.transformFromAstAsync(ast, code, {
      plugins: [[rewriteTopLevelToContext, { contextIdentifier: "context" }]],
      parserOpts: { sourceType: "module", plugins: ["topLevelAwait", "typescript"] },
    });

    const trailingCode = lastExprCode ? `context._ = (${lastExprCode});` : "";
    const finalCode = `const context = globalThis.__tseval_context__;
${prelude}
${transformed?.code}
${trailingCode}`;

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
