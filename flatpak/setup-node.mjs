// Materialize reviewed executable links only; never run lifecycle scripts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function planNodeBins(layout, arch) {
  if (layout.schema !== 2 || !Array.isArray(layout.packages) || !layout.binOwners || !['x86_64', 'aarch64'].includes(arch)) {
    throw new Error('Unsupported node layout or architecture');
  }
  const candidates = new Map();
  const packagePaths = new Set();
  for (const pkg of layout.packages) {
    if (!pkg.arches.includes(arch)) continue;
    if (typeof pkg.path !== 'string' || !pkg.path.startsWith('node_modules/') || pkg.path.includes('\\') || pkg.path.split('/').some(part => !part || part === '.' || part === '..') || packagePaths.has(pkg.path)) {
      throw new Error('Unsafe or duplicate package path');
    }
    packagePaths.add(pkg.path);
    const nested = pkg.path.lastIndexOf('/node_modules/');
    const modules = nested === -1 ? 'node_modules' : pkg.path.slice(0, nested) + '/node_modules';
    for (const [name, relative] of Object.entries(pkg.bin)) {
      if (!/^[A-Za-z0-9._-]+$/.test(name) || ['.', '..'].includes(name) || typeof relative !== 'string' || relative.includes('\\')) throw new Error('Unsafe executable metadata');
      const target = path.posix.normalize(pkg.path + '/' + relative);
      if (!target.startsWith(pkg.path + '/')) throw new Error('Executable escapes package');
      const link = modules + '/.bin/' + name;
      if (!candidates.has(link)) candidates.set(link, []);
      candidates.get(link).push({ pkg, relative, target, link });
    }
  }
  const selected = [];
  const usedPolicies = new Set();
  for (const [link, bins] of candidates) {
    const policy = layout.binOwners[link];
    if (bins.length === 1) {
      if (policy?.arches.includes(arch)) throw new Error('Stale executable collision policy');
      selected.push(bins[0]);
      continue;
    }
    const contenders = bins.map(bin => bin.pkg.path).sort();
    if (!policy || !policy.arches.includes(arch) || JSON.stringify(contenders) !== JSON.stringify(policy.contenders)) throw new Error('Unreviewed executable collision: ' + link);
    const owner = bins.find(bin => bin.pkg.path === policy.owner);
    if (!owner) throw new Error('Executable collision owner is missing');
    selected.push(owner);
    usedPolicies.add(link);
  }
  for (const [link, policy] of Object.entries(layout.binOwners)) {
    if (policy.arches.includes(arch) && !usedPolicies.has(link)) throw new Error('Unused executable collision policy');
  }
  return selected;
}

export function setupNode(root, layout, arch) {
  root = fs.realpathSync(root);
  const selected = planNodeBins(layout, arch);
  const withinModules = root + path.sep + 'node_modules' + path.sep;
  // Validate every package, including packages whose colliding bin was not chosen.
  for (const pkg of layout.packages.filter(pkg => pkg.arches.includes(arch))) {
    const dir = fs.realpathSync(path.resolve(root, pkg.path));
    if (!dir.startsWith(withinModules)) throw new Error('Unsafe package path');
    const actual = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (actual.name !== pkg.name || actual.version !== pkg.version) throw new Error('Package identity mismatch: ' + pkg.path);
  }
  const bins = selected.map(bin => {
    const dir = fs.realpathSync(path.resolve(root, bin.pkg.path));
    const target = fs.realpathSync(path.resolve(root, bin.target));
    if (!target.startsWith(dir + path.sep) || !fs.statSync(target).isFile()) throw new Error('Executable escapes package');
    return { target, link: path.resolve(root, bin.link) };
  });
  for (const { target, link } of bins) {
    const binDir = path.dirname(link);
    fs.mkdirSync(binDir, { recursive: true });
    if (!fs.realpathSync(binDir).startsWith(withinModules)) throw new Error('Unsafe executable directory');
    fs.chmodSync(target, fs.statSync(target).mode | 0o111);
    try {
      fs.lstatSync(link);
      if (fs.realpathSync(link) !== target) throw new Error('Executable name collision: ' + link);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A dangling link is not an absent destination: exclusive symlink creation
      // will reject it rather than following or replacing it.
      fs.symlinkSync(path.relative(binDir, target), link);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Flatpak Node setup supports Linux x86_64/aarch64 only');
  const layout = JSON.parse(fs.readFileSync('flatpak/node-layout.json', 'utf8'));
  setupNode(process.cwd(), layout, process.arch === 'x64' ? 'x86_64' : 'aarch64');
  console.log('Validated package identities and reviewed executable links; lifecycle scripts not run');
}
