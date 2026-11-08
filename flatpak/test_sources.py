import importlib.util
from pathlib import Path
import unittest
import copy
import hashlib
import json
import tempfile
import shutil
import tomllib
import os

spec = importlib.util.spec_from_file_location('sources', Path(__file__).with_name('prepare-sources.py'))
sources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sources)


class SourcesTests(unittest.TestCase):
    def test_json_strings_are_not_rewritten(self):
        self.assertEqual(sources.jsonc('{"a": ",]", "b": [1,],}'), {'a': ',]', 'b': [1]})

    def test_nested_bun_paths(self):
        self.assertEqual(sources.package_path('vite/esbuild/@esbuild/linux-x64'),
                         'node_modules/vite/node_modules/esbuild/node_modules/@esbuild/linux-x64')
        for key in ['../secret', 'vite/../../secret', '/x', '@bad']:
            with self.assertRaises(ValueError):
                sources.package_path(key)

    def test_arch_filter(self):
        self.assertEqual(sources.admitted_arches({'os': 'darwin'}), [])
        self.assertEqual(sources.admitted_arches({'os': 'linux', 'cpu': 'x64'}), ['x86_64'])
        self.assertEqual(sources.admitted_arches({'os': ['!linux']}), [])

    def test_reviewed_bin_owner_on_both_architectures(self):
        layout = sources.generate()['node-layout.json']
        policy = layout['binOwners']['node_modules/.bin/sass']
        self.assertEqual(policy['owner'], 'node_modules/sass-embedded')
        self.assertEqual(policy['contenders'], ['node_modules/sass', 'node_modules/sass-embedded'])
        self.assertEqual(policy['arches'], ['x86_64', 'aarch64'])
        changed = copy.deepcopy(layout['packages'])
        changed.append({'path': 'node_modules/unreviewed', 'name': 'unreviewed', 'version': '1',
                        'bin': {'sass': 'bin.js'}, 'arches': ['x86_64']})
        with self.assertRaisesRegex(ValueError, 'Unreviewed executable collision'):
            sources.bin_owners(changed)
        with self.assertRaisesRegex(ValueError, 'Unreviewed executable collision'):
            sources.bin_owners([{'path': 'node_modules/a', 'bin': {'new': 'a.js'}, 'arches': ['x86_64']},
                                {'path': 'node_modules/b', 'bin': {'new': 'b.js'}, 'arches': ['x86_64']}])

    def test_lf_and_crlf_generate_identical_canonical_commitments(self):
        with tempfile.TemporaryDirectory(prefix='mourn-source-test-') as directory:
            root = Path(directory)
            (root / 'src-tauri').mkdir()
            shutil.copyfile(sources.ROOT / 'src-tauri/Cargo.toml', root / 'src-tauri/Cargo.toml')
            shutil.copytree(sources.ROOT / 'src-tauri/vendor', root / 'src-tauri/vendor')
            (root / 'package.json').write_bytes((sources.ROOT / 'package.json').read_bytes())
            lf = {}
            for name in ('bun.lock', 'src-tauri/Cargo.lock'):
                lf[name] = (sources.ROOT / name).read_bytes().replace(b'\r\n', b'\n')
                (root / name).write_bytes(lf[name])
            expected = sources.generate(root)
            for name, data in lf.items():
                (root / name).write_bytes(data.replace(b'\n', b'\r\n'))
            self.assertEqual(sources.generate(root), expected)
            commitment = expected['source-locks.json']
            self.assertEqual(commitment['lockfile_encoding'], 'utf-8-lf')
            self.assertEqual(commitment['bun_lock_sha256'], hashlib.sha256(lf['bun.lock']).hexdigest())
            self.assertEqual(commitment['cargo_lock_sha256'], hashlib.sha256(lf['src-tauri/Cargo.lock']).hexdigest())
            with (root / 'bun.lock').open('ab') as output:
                output.write(b'\r')
            with self.assertRaisesRegex(ValueError, 'line endings'):
                sources.generate(root)

    def test_reviewed_glib_backport_is_committed_without_registry_fetch(self):
        generated = sources.generate()
        local = generated['source-locks.json']['local_cargo_sources']['glib']
        self.assertEqual(local['version'], '0.18.5')
        self.assertEqual(local['path'], 'src-tauri/vendor/glib')
        self.assertEqual(len(local['provenance_sha256']), 64)
        self.assertFalse(any(source.get('url', '').endswith('/glib-0.18.5.crate')
                             for source in generated['cargo-sources.json']))

    def cargo_fixture(self):
        directory = tempfile.TemporaryDirectory(prefix='mourn-local-cargo-test-')
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        (root / 'src-tauri').mkdir()
        shutil.copyfile(sources.ROOT / 'src-tauri/Cargo.toml', root / 'src-tauri/Cargo.toml')
        shutil.copytree(sources.ROOT / 'src-tauri/vendor', root / 'src-tauri/vendor')
        lock = tomllib.loads((sources.ROOT / 'src-tauri/Cargo.lock').read_text())
        return root, lock

    def test_extra_local_identity_and_registry_glib_cannot_bypass_review(self):
        root, lock = self.cargo_fixture()
        for package in [{'name': 'unreviewed', 'version': '1.0.0'},
                        {'name': 'mourn-desktop', 'version': '9.0.0'},
                        {'name': 'glib', 'version': '0.18.5',
                         'source': 'registry+https://github.com/rust-lang/crates.io-index',
                         'checksum': '0' * 64}]:
            with self.subTest(package=package):
                changed = copy.deepcopy(lock)
                changed['package'].append(package)
                with self.assertRaisesRegex(ValueError, 'local Cargo|GLib'):
                    sources.validate_local_cargo(root, changed)

    def test_changed_missing_extra_and_symlinked_vendor_files_fail_closed(self):
        for mutation in ('changed', 'missing', 'extra', 'symlink'):
            if mutation == 'symlink' and os.name == 'nt':
                continue
            with self.subTest(mutation=mutation):
                root, lock = self.cargo_fixture()
                file = root / 'src-tauri/vendor/glib/src/variant_iter.rs'
                if mutation == 'changed':
                    file.write_text('// unreviewed change\n')
                elif mutation == 'missing':
                    file.unlink()
                elif mutation == 'extra':
                    (file.parent / 'extra.rs').write_text('// unreviewed source\n')
                else:
                    file.unlink()
                    file.symlink_to(root / 'src-tauri/Cargo.toml')
                with self.assertRaisesRegex(ValueError, 'local Cargo'):
                    sources.validate_local_cargo(root, lock)

    def test_unreviewed_patch_path_provenance_and_version_fail_closed(self):
        for mutation in ('path', 'provenance', 'version'):
            with self.subTest(mutation=mutation):
                root, lock = self.cargo_fixture()
                if mutation == 'path':
                    file = root / 'src-tauri/Cargo.toml'
                    file.write_text(file.read_text().replace('path = "vendor/glib"', 'path = "../outside"'))
                elif mutation == 'provenance':
                    file = root / 'src-tauri/vendor/glib.provenance.json'
                    file.write_text(file.read_text() + ' ')
                else:
                    next(pkg for pkg in lock['package'] if pkg['name'] == 'glib')['version'] = '0.18.6'
                with self.assertRaisesRegex(ValueError, 'local Cargo'):
                    sources.validate_local_cargo(root, lock)

    def test_checked_in_generated_inputs(self):
        for name, value in sources.generate().items():
            self.assertEqual(json.loads((sources.ROOT / 'flatpak' / name).read_text(encoding='utf-8')), value, name)

    def test_registry_sources_have_integrity_and_no_install_scripts(self):
        generated = sources.generate()
        self.assertTrue(generated['node-sources.json'])
        for source in generated['node-sources.json']:
            self.assertEqual(len(source['sha512']), 128)
            self.assertTrue(source['url'].startswith('https://registry.npmjs.org/'))
            self.assertNotIn('commands', source)
        for source in generated['cargo-sources.json']:
            if source['type'] == 'archive':
                self.assertEqual(len(source['sha256']), 64)


if __name__ == '__main__':
    unittest.main()
