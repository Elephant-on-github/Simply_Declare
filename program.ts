import { Command } from "commander";
import chalk from "chalk";
import { parse as parseYaml } from "yaml";
import { initConfig, main, validateConfig } from "./lib"
import { readFileSync } from "node:fs";

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
  .command("validate")
  .description("Validate a YAML configuration file")
  .argument("<config>", "Path to the YAML configuration file")
  .action(async (config) => {
    try {
      const content = readFileSync(config, "utf-8");
      const parsed = parseYaml(content);
      const result = validateConfig(parsed);
      if (result.success) {
        console.log(chalk.green.bold("✓ Configuration is valid!"));
        console.log(chalk.blue(`Found ${result.data.Configs.length} application(s).`));
      } else {
        console.error(chalk.red.bold("✗ Configuration is invalid:"));
        for (const issue of result.error.issues) {
          console.error(chalk.red(`  - ${issue.path.join(".")}: ${issue.message}`));
        }
        process.exit(1);
      }
    } catch (error: any) {
      console.error(chalk.red(`Failed to read or parse file: ${error.message}`));
      process.exit(1);
    }
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

