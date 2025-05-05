// Check if wheels exist and generate them if they don't
import { exists } from "https://deno.land/std/fs/mod.ts";
import { join } from "https://deno.land/std/path/mod.ts";

export async function ensureWheelsExist() {
  const pypiDir = join(Deno.cwd(), "kernel", "pypi");
  const allJsonPath = join(pypiDir, "all.json");
  
  try {
    // Check if the pypi directory exists
    const pypiDirExists = await exists(pypiDir);
    
    // Check if the all.json file exists
    const allJsonExists = pypiDirExists && await exists(allJsonPath);
    
    // Check if at least one wheel file exists
    let wheelExists = false;
    if (pypiDirExists) {
      for await (const entry of Deno.readDir(pypiDir)) {
        if (entry.name.endsWith(".whl")) {
          wheelExists = true;
          break;
        }
      }
    }
    
    // If any of the checks fail, generate the wheels
    if (!pypiDirExists || !allJsonExists || !wheelExists) {
      console.log("Wheels not found. Generating wheels...");
      
      // Create the pypi directory if it doesn't exist
      if (!pypiDirExists) {
        await Deno.mkdir(pypiDir, { recursive: true });
      }
      
      // Run the wheel generation script using the newer Deno.Command API
      const command = new Deno.Command("python3", {
        args: ["generate-wheels-js.py"],
        cwd: join(Deno.cwd(), "kernel"),
        stdout: "piped",
        stderr: "piped",
      });
      
      const { code, stdout, stderr } = await command.output();
      
      if (code !== 0) {
        const errorOutput = new TextDecoder().decode(stderr);
        console.error("Error generating wheels:", errorOutput);
        throw new Error("Failed to generate wheels");
      }
      
      const output = new TextDecoder().decode(stdout);
      console.log(output);
      
      console.log("Wheels generated successfully");
    } else {
      console.log("Wheels already exist");
    }
    
    return true;
  } catch (error) {
    console.error("Error checking/generating wheels:", error);
    return false;
  }
} 