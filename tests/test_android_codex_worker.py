"""Computer worker checks without real model, device or QQ calls."""
from pathlib import Path
import importlib.util
import io
import json
import shutil
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('worker', ROOT/'tools/android-codex-worker.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class WorkerCheck(unittest.TestCase):
    def test_additional_instance_cannot_supply_the_primary_worker_token(self):
        device = worker.Device('fake-adb', 'synthetic', 18766)
        def run(*args):
            if args[0] == 'forward': return b''
            if args[:2] == ('shell', 'pidof'): return b'111 222'
            if args[-1].endswith('/cmdline'): return b'node\0/opt/qq-workbench/assistant.mjs\0'
            if '/111/' in args[-1]: return b'QQWB_INSTANCE_SLOT=3\0WORKBENCH_TOKEN=additional-secret\0'
            return b'WORKBENCH_TOKEN=primary-secret\0'
        device.run = run
        device.connect()
        self.assertEqual(device.token, 'primary-secret')

    def setUp(self):
        base = ROOT/'build/worker-tests'
        base.mkdir(parents=True, exist_ok=True)
        self.folder = Path(tempfile.mkdtemp(dir=base))
        self.addCleanup(lambda: shutil.rmtree(self.folder))

    def run_job(self, status='blocked', output=True):
        calls = []
        folder = self.folder
        class Fake:
            _handle = 0
            pid = 0
            stdin = io.StringIO()
            stdout = io.StringIO(json.dumps({'type': 'turn.completed', 'usage': {'input_tokens': 20, 'cached_input_tokens': 10, 'output_tokens': 5}})+'\n')
            def poll(self): return 0
            def wait(self): return 0
        def launch(args, **kwargs):
            calls.append(args)
            schema = Path(args[args.index('--output-schema')+1])
            self.assertTrue(schema.is_absolute())
            self.assertTrue(schema.exists())
            if output:
                (folder/'answer.txt').write_text(json.dumps({'status': status, 'summary': '需要关键资料', 'validation': '任务尚未执行'}), encoding='utf-8')
            return Fake()
        with patch.object(worker.subprocess, 'Popen', side_effect=launch):
            result = worker.execute('synthetic-codex', ROOT, folder, {'prompt': '隔离测试', 'context': '背景'})
        self.assertEqual(len(calls), 1)
        self.assertIn('--approve-for-me', calls[0])
        self.assertNotIn('--dangerously-bypass-approvals-and-sandbox', calls[0])
        return result

    def test_blocked_is_not_completed_and_actual_usage_is_kept(self):
        result = self.run_job()
        self.assertEqual(result['status'], 'blocked')
        self.assertEqual(result['usage']['prompt_tokens'], 20)
        self.assertIn('任务尚未执行', result['text'])

    def test_missing_final_is_failed_without_automatic_reexecution(self):
        self.assertEqual(self.run_job(output=False)['status'], 'failed')

    def test_qq_text_does_not_echo_obvious_credentials(self):
        self.assertNotIn('sk-syntheticsecret123456', worker.clean('Key: sk-syntheticsecret123456'))
        self.assertNotIn('secret', worker.clean('Authorization: Bearer secret'))


if __name__ == '__main__':
    unittest.main()
