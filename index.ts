import "bun";
import fs from "node:fs";
import path from "node:path";
import { config } from "node:process";
// import command from "commander";

console.log("Simply Declare started.");

const Exampleyml = `
Config: true
Configs:
    - WezTerm:
        - config: "./lua.lua"
        - target: "./test folder 1/wezterm.lua"
    - Alacritty:
        - config: "./alacritty.yml"
        - target: "./test folder 1/alacritty.yml"
# Themes: false
# Applications: false

`;

async function symlinker(source: string, destination: string, app?: string) {
  //   const source = path.resolve("./cli.json");
  //   const destination = path.resolve("./test folder 1/config.json");

  try {
    fs.symlinkSync(source, destination, "file");
    console.log("Symlink for " + app + " created successfully!");
  } catch (err) {
    const errCode = err instanceof Error && "code" in err ? err.code : "";

    if (errCode === "EPERM") {
      console.error("Permission denied. Try running with elevated privileges.");
      process.exit(1);
    } else if (errCode === "EEXIST") {
      let response: string | "n" | null;
      response = await prompt(
        "Target file for " + app + " already exists. Delete it? (y/n): "
      );
      if (response?.toLowerCase() === "y") {
        await Bun.file(destination).delete();
        symlinker(source, destination, app);
      } else {
        console.error("Operation cancelled.");
        process.exit(1);
      }
    } else {
      console.error("Error creating symlink:", err);
      process.exit(1);
    }
    process.exit(0);
  }
}

let configPath = "";
let targetPath = "";

try {
  const ParsedFlags = Bun.YAML.parse(Exampleyml) as Record<string, unknown>;
  console.log("Parsed Flags:", ParsedFlags);
  console.log("Simply Declare finished.", ParsedFlags.Configs);
  for (const apps of ParsedFlags.Configs as Array<
    Record<string, Array<Record<string, string>>>
  >) {
    for (const [appName, appDetails] of Object.entries(apps)) {
      console.log(`Application: ${appName}`);
      const config = appDetails.find((d) => "config" in d)?.config;
      const target = appDetails.find((d) => "target" in d)?.target;
      if (config && target) {
        symlinker(path.resolve(config), path.resolve(target), appName);
      }
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to parse YAML: ${message}`);
  process.exit(1);
}

// symlinker();
