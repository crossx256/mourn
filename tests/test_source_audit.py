import importlib.util
import io
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/source_audit.py'
spec = importlib.util.spec_from_file_location('source_audit_tested', SCRIPT)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class StagedAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='mourn-index-fixture-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {**os.environ, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull}
        # Git operations below construct only a disposable index fixture. They
        # never stage, commit, or write objects in the developer's repository.
        self.git('init', '--quiet', '--object-format=sha1')
        (self.root / 'scripts').mkdir()
        shutil.copyfile(SCRIPT, self.root / 'scripts/source_audit.py')
        self.token = 'ghp_' + 's' * 30

    def git(self, *args, input=None):
        return subprocess.run(['git', '--no-pager', '--no-optional-locks', *args], cwd=self.root,
                              env=self.env, input=input, capture_output=True, check=True).stdout

    def stage_blob(self, name, body, mode='100644'):
        oid = self.git('hash-object', '-w', '--stdin', input=body).decode().strip()
        self.git('update-index', '--add', '--cacheinfo', mode + ',' + oid + ',' + name)
        return oid

    def run_audit(self, *args):
        before = self.git('ls-files', '--stage', '-z')
        result = subprocess.run([sys.executable, '-B', 'scripts/source_audit.py', *args], cwd=self.root,
                                env=self.env, capture_output=True, text=True, check=False)
        self.assertEqual(self.git('ls-files', '--stage', '-z'), before)
        self.assertNotIn(self.token, result.stdout + result.stderr)
        return result

    def test_exact_index_bytes_not_unstaged_or_untracked_files(self):
        self.stage_blob('candidate.txt', b'safe staged content\n')
        (self.root / 'candidate.txt').write_text(self.token)
        (self.root / 'untracked.txt').write_text(self.token)
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1 blobs', result.stdout)
        self.stage_blob('candidate.txt', ('first line\n' + self.token + '\n').encode())
        (self.root / 'candidate.txt').write_text('safe worktree content')
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('"line": 2', result.stdout)
        self.assertIn('"rule": "service-token"', result.stdout)
        self.assertIn('[REDACTED]', result.stdout)

    def test_all_staged_blobs_including_export_ignored_and_sensitive_names(self):
        self.stage_blob('.gitattributes', b'hidden.txt export-ignore\n')
        self.stage_blob('hidden.txt', self.token.encode())
        self.stage_blob('.env.production', b'placeholder\n')
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('hidden.txt', result.stdout)
        self.assertIn('sensitive-path', result.stdout)

    def test_secret_shaped_filename_is_redacted_too(self):
        self.stage_blob(self.token + '.txt', self.token.encode())
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('[REDACTED].txt', result.stdout)

    def test_signing_generation_configuration_is_blocked_in_index(self):
        self.stage_blob('appimage-key.batch', b'synthetic configuration\n')
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('sensitive-path', result.stdout)

    def test_multiple_secret_rules_report_only_rule_and_location(self):
        private_marker = '-----BEGIN ' + 'PRIVATE KEY-----'
        credential = 'postgresql' + '://' + 'fixture:password@fixture.invalid/db'
        self.stage_blob('sensitive.txt', (private_marker + '\n' + credential + '\n').encode())
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('private-key', result.stdout)
        self.assertIn('credential-url', result.stdout)
        self.assertNotIn(private_marker, result.stdout + result.stderr)
        self.assertNotIn(credential, result.stdout + result.stderr)

    def test_staged_links_and_submodules_fail_closed(self):
        self.stage_blob('link', b'outside', '120000')
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('links, submodules', result.stderr)
        self.git('update-index', '--force-remove', 'link')
        self.stage_blob('submodule', b'not executed', '160000')
        self.assertEqual(self.run_audit('--staged').returncode, 1)

    def test_unmerged_index_fails_closed(self):
        oid = self.git('hash-object', '-w', '--stdin', input=b'conflict').decode().strip()
        self.git('update-index', '--index-info', input=('100644 ' + oid + ' 1\tconflict.txt\n').encode())
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Unmerged', result.stderr)

    def test_staged_cannot_export_or_select_another_ref(self):
        self.assertEqual(self.run_audit('--staged', 'HEAD').returncode, 2)
        self.assertEqual(self.run_audit('--staged', '--archive', 'must-not-exist.gz').returncode, 2)
        self.assertFalse((self.root / 'must-not-exist.gz').exists())

    def test_empty_unborn_index_is_supported(self):
        result = self.run_audit('--staged')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('0 blobs', result.stdout)


class ArchiveAuditTests(unittest.TestCase):
    def archive(self, name, body=b'', kind=None):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w') as stream:
            entry = tarfile.TarInfo(name)
            entry.size = len(body)
            if kind is not None:
                entry.type = kind
            stream.addfile(entry, io.BytesIO(body))
        return output.getvalue()

    def test_archive_audit_still_scans_exact_bytes(self):
        token = ('ghp_' + 't' * 30).encode()
        findings, names = audit.inspect_archive(self.archive('file.txt', b'line\n' + token))
        self.assertEqual(findings, [('file.txt', 2, 'service-token')])
        self.assertEqual(names, {'file.txt'})

    def test_archive_links_and_traversal_remain_rejected(self):
        with self.assertRaises(ValueError):
            audit.inspect_archive(self.archive('../outside'))
        with self.assertRaises(ValueError):
            audit.inspect_archive(self.archive('link', kind=tarfile.SYMTYPE))

    def test_signing_generation_configuration_is_blocked_in_archive(self):
        for name in ('appimage-key.batch', 'tools/AppImage-Key.Batch'):
            with self.subTest(name=name):
                findings, _ = audit.inspect_archive(self.archive(name, b'synthetic configuration\n'))
                self.assertEqual(findings, [(name, 0, 'sensitive-path')])


if __name__ == '__main__':
    unittest.main()
