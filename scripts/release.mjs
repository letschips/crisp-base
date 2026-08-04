import { execSync } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = ['main.js', 'manifest.json', 'styles.css'];

async function main() {
	const outputArg = process.argv[2];
	const output = outputArg
		? resolve(outputArg)
		: resolve(process.env.HOME ?? '/tmp', 'Desktop', 'crisp-base-release');

	console.log('Building...');
	execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });

	const manifest = JSON.parse(
		await readFile(resolve(projectRoot, 'manifest.json'), 'utf8'),
	);
	if (typeof manifest.id !== 'string' || typeof manifest.version !== 'string') {
		throw new Error('manifest.json must contain id and version.');
	}
	for (const artifact of artifacts) {
		await stat(resolve(projectRoot, artifact));
	}

	await mkdir(output, { recursive: true });
	const zipPath = resolve(output, `${manifest.id}-${manifest.version}.zip`);
	await rm(zipPath, { force: true });
	execSync(
		`cd "${projectRoot}" && zip -j "${zipPath}" ${artifacts.join(' ')}`,
		{ stdio: 'inherit' },
	);
	console.log(`Release ready: ${zipPath}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
