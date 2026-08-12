import fs from 'node:fs';

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const tauriConfig = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargoManifest = fs.readFileSync('src-tauri/Cargo.toml', 'utf8');
const cargoVersion = cargoManifest.match(/\[package\][\s\S]*?^version = "([^"]+)"/m)?.[1];

if (!cargoVersion
  || packageJson.version !== tauriConfig.version
  || packageJson.version !== cargoVersion) {
  console.error('Version mismatch:', {
    package: packageJson.version,
    tauri: tauriConfig.version,
    cargo: cargoVersion,
  });
  process.exitCode = 1;
} else {
  console.log(`Version ${packageJson.version} is synchronized`);
}
