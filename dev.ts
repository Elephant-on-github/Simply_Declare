import chalk from "chalk"
import { download, Getgit, parseGit } from "./lib.ts"

// download

const test = Getgit("InioX", "matugen", "Cargo.toml")

if (await test === "https://raw.githubusercontent.com/InioX/matugen/refs/heads/main/Cargo.toml") {
    console.log(chalk.green("good out"))
}

// download(await test, "test folder 1/target.ignore.txt")

// console.log(await parseGit("InioX:matugen:Cargo.toml"))
const yesyes = await parseGit("InioX:matugen:Cargo.toml")
Getgit(...yesyes)