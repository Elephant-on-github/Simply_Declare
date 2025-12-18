import "bun";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { config } from "node:process";
import { Command } from "commander";

console.log(chalk.blue("Simply Declare started."));

async function Getfile(filePath: string): Promise<string> {
  try {
    return await Bun.file(filePath).text();
  } catch (error) {
    if (error == "ENOENT") {
      console.error(chalk.red("File not found: " + filePath));
      console.log(
        chalk.yellow(
          "Pleae Provide a valid file path or run",
          chalk.white("'simply-declare init'"),
          "to create a new config file."
        )
      );
      process.exit(1);
    } else {
      console.error(chalk.red("Error reading file: " + filePath), error);
      process.exit(1);
    }
  }
}

async function symlinker(source: string, destination: string, app?: string) {
  try {
    fs.symlinkSync(source, destination, "file");
    console.log(chalk.green("Symlink for " + app + " created successfully!"));
  } catch (err) {
    const errCode = err instanceof Error && "code" in err ? err.code : "";

    if (errCode === "EPERM") {
      console.error(
        chalk.red("Permission denied. Try running with elevated privileges.")
      );
      // We keep the exit(1) here because if you don't have perms,
      // the rest of the links will likely fail too.
      process.exit(1);
    } else if (errCode === "EEXIST") {
      const response = await prompt(
        "Target file for " + app + " already exists. Delete it? (y/n): "
      );

      if (response?.toLowerCase() === "y") {
        await Bun.file(destination).delete();
        console.log(chalk.yellow("Existing file deleted."));
        // Recurse to try creating the link again now that the path is clear
        await symlinker(source, destination, app);
      } else {
        console.log(chalk.blue(`Skipping ${app} as requested.`));
        return; // Important: Return to the loop so the next app can process
      }
    } else {
      console.error(chalk.red(`Error creating symlink for ${app}:`), err);
      return; // Return so the script doesn't crash entirely for one bad path
    }
  }
}
async function main(configPath: string = "./example.yml") {
  try {
    const ParsedFlags = Bun.YAML.parse(await Getfile(configPath)) as Record<
      string,
      unknown
    >;
    console.log("Parsed Flags:", ParsedFlags);
    console.log(chalk.green("Simply Declare finished."), ParsedFlags.Configs);
    for (const apps of ParsedFlags.Configs as Array<
      Record<string, Array<Record<string, string>>>
    >) {
      for (const [appName, appDetails] of Object.entries(apps)) {
        console.log(`Application: ${appName}`);
        const config = appDetails.find((d) => "config" in d)?.config;
        const target = appDetails.find((d) => "target" in d)?.target;
        if (config && target) {
          await symlinker(path.resolve(config), path.resolve(target), appName);
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse YAML: ${message}`);
    process.exit(1);
  }
}

const program = new Command();

program
  .name("simply-declare")
  .description("A CLI to manage declarations")
  .version("1.0.0");

// The 'init' command
program
  .command("init")
  .description("Initialize a new config file")
  .action(() => {
    console.log("Initializing configuration...");
    // Your logic to create a template YAML file
  });

// The default 'run' command (taking the config as an argument)
program
  .command("run", { isDefault: true }) // Setting isDefault: true allows 'simply-declare my-file.yaml'
  .description("Run the tool with a config file")
  .argument("<config>", "Path to the YAML configuration file")
  .action((config) => {
    main(config);
  });

program.parse();
