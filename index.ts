import "bun";
import fs from 'node:fs';
import path from 'node:path';
import command from 'commander';

console.log("Simply Declare started.");

const Flags = `
Config: true
# Themes: false
# Applications: false
`;

try {
    const ParsedFlags = Bun.YAML.parse(Flags) as Record<string, unknown>;
    console.log("Parsed Flags:", ParsedFlags);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse YAML: ${message}`);
    process.exit(1);
}

async function symlinker() {
const source = path.resolve('./cli.json');
const destination = path.resolve('./test folder 1/config.json');

try {
    fs.symlinkSync(source, destination, 'file');
    console.log('Symlink created successfully!');
} catch (err) {
    const errCode = err instanceof Error && 'code' in err ? err.code : '';
    
    if (errCode === 'EPERM') {
        console.error('Permission denied. Try running with elevated privileges.');
        process.exit(1);
    } else if (errCode === 'EEXIST') {
        let response: string | "n" | null
        response = await prompt('Target file already exists. Delete it? (y/n): ');
        if (response?.toLowerCase() === 'y') {
            await Bun.file(destination).delete();
            symlinker();
        } else {
            console.error('Operation cancelled.');
            process.exit(1);
        }
    } else {
        console.error('Error creating symlink:', err);
        process.exit(1);
    }
    process.exit(0);
}}

symlinker();