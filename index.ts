import "bun";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";

async function Getfile(filePath: string): Promise<string> {
  try {
    const file = Bun.file(filePath);
    const exists = await file.exists();

    if (!exists) {
      throw new Error("ENOENT");
    }

    return await file.text();
  } catch (error: any) {
    // Check for our manual throw or the system error code
    if (error.message === "ENOENT" || error.code === "ENOENT") {
      console.error(chalk.red(`\nFile not found: ${path.resolve(filePath)}`));
      console.log(
        chalk.yellow(
          "Please provide a valid file path or run",
          chalk.white.bold("'simply-declare init'"),
          "to create a new config file."
        )
      );
    } else {
      console.error(chalk.red("Error reading file:"), error);
    }
    process.exit(1);
  }
}

async function symlinker(source: string, destination: string, app?: string) {
  try {
    // Ensure parent directory for destination exists
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.symlinkSync(source, destination, "file");
    console.log(chalk.green(`✔ Symlink for ${app} created successfully!`));
  } catch (err: any) {
    if (err.code === "EPERM") {
      console.error(
        chalk.red(
          "Permission denied. Try running with elevated privileges (sudo/admin)."
        )
      );
      process.exit(1);
    } else if (err.code === "EEXIST") {
      const response = await prompt(
        `Target file for ${app} already exists. Overwrite? (y/n): `
      );

      if (response?.toLowerCase() === "y") {
        await Bun.file(destination).delete();
        console.log(chalk.yellow("Existing file deleted. Re-linking..."));
        await symlinker(source, destination, app);
      } else {
        console.log(chalk.blue(`Skipping ${app}.`));
      }
    } else {
      console.error(
        chalk.red(`Error creating symlink for ${app}:`),
        err.message
      );
    }
  }
}

async function main(configPath: string) {
  const fileContent = await Getfile(configPath);

  try {
    const parsed = Bun.YAML.parse(fileContent) as any;

    if (!parsed.Configs || !Array.isArray(parsed.Configs)) {
      throw new Error("YAML missing 'Configs' array.");
    }

    console.log(
      chalk.blue(`Processing ${parsed.Configs.length} application(s)...`)
    );

    for (const appObj of parsed.Configs) {
      for (const [appName, details] of Object.entries(appObj)) {
        // Flattening the array structure from your YAML
        const configArr = details as Array<Record<string, string>>;
        const sourcePath = configArr.find((d) => d.config)?.config;
        const targetPath = configArr.find((d) => d.target)?.target;

        if (sourcePath && targetPath) {
          await symlinker(
            path.resolve(sourcePath),
            path.resolve(targetPath),
            appName
          );
        } else {
          console.warn(
            chalk.yellow(`Skipping ${appName}: Missing config or target path.`)
          );
        }
      }
    }
    console.log(chalk.green.bold("\nAll declarations processed."));
  } catch (error: any) {
    console.error(chalk.red(`Failed to parse YAML: ${error.message}`));
    process.exit(1);
  }
}

async function initConfig() {
  console.warn(chalk.yellow("This feature Curls from a Github Repository."));
  const response = await prompt(
    chalk.yellow("Do you want to proceed? (y/n): ")
  );
  if (response?.toLowerCase() === "y") {
    console.log(chalk.green("Proceeding with initialization..."));
    const responsefile = await fetch(
      "https://raw.githubusercontent.com/Elephant-on-github/Simply_Declare/refs/heads/main/Example.yml"
    );
    const responseText = await responsefile.text();
    await Bun.write(Bun.file("SimplyDeclare.yml"), responseText);
    console.log(
      chalk.green(
        "Configuration file 'SimplyDeclare.yml' created successfully."
      )
    );
  } else {
    console.log(chalk.red("Initialization cancelled by user."));
    process.exit(0);
  }
}

const program = new Command();

program
  .name("simply-declare")
  .description("A CLI to manage declarations")
  .version("1.0.0");

program
  .command("init")
  .description("Initialize a new config file")
  .action(async () => {
    console.log(chalk.blue("Creating a new configuration file..."));
    initConfig();
  });

program
  .command("run", { isDefault: true })
  .description("Run the tool with a config file")
  .argument("[config]", "Path to the YAML configuration file", "Not-given")
  .action(async (config) => {
    if (
      config === "Not-given" &&
      (await Bun.file("SimplyDeclare.yml").exists())
    ) {
      config = "SimplyDeclare.yml";
      main(config);
    } else if (config === "Not-given") {
      console.error(
        chalk.blue("\nNo configuration file provided Initializing...")
      );
      initConfig();
    } else {
      main(config);
    }
  });

program.parse();
