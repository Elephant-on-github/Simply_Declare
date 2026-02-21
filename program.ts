import { Command } from "commander";
import chalk from "chalk";
import {initConfig, main} from "./lib"


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

