"""Exercise authenticated asynchronous voice jobs without loading a GPU/model."""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
import wave
from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("gateway", Path(__file__).resolve().parents[1] / "tools/voice-studio-gateway.py")
gateway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gateway)


class FakeTTS:
    def __init__(self):
        self.calls = []
        self.loaded = False
        self.mel_tokens_capped = False

    def ensure_loaded(self):
        self.loaded = True
        return self

    def unload(self):
        self.loaded = False

    def infer(self, **args):
        self.calls.append(args)
        with wave.open(args["output_path"], "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(b"\x10\x00" * 2400)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        ref = self.root / "models/FeiyuVoice-CosyVoice3/reference.wav"
        ref.parent.mkdir(parents=True)
        ref.write_bytes(b"synthetic reference")
        entry = {"reference_audio": "reference.wav", "reference_sha256": gateway.hashlib.sha256(ref.read_bytes()).hexdigest()}
        (ref.parent / "manifest.json").write_text(json.dumps({"styles": {"cute": entry, "gentle": entry}}))
        self.studio = type("Studio", (), {"tts": FakeTTS(), "_INFER_LOCK": threading.Lock()})()
        self.client = TestClient(gateway.make_app(self.studio, self.root, self.root / "worker.py", "test-secret"))
        self.headers = {"Authorization": "Bearer test-secret"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_auth_and_bounded_input(self):
        self.assertEqual(self.client.get("/health").status_code, 401)
        self.assertEqual(self.client.post("/v1/speech", headers=self.headers, content="x" * 17000).status_code, 413)
        for payload in ({"text": ""}, {"text": "hello", "voice": "../../model"}, {"text": "hello", "emotion": "inject"}, {"text": []}):
            self.assertEqual(self.client.post("/v1/speech", headers=self.headers, json=payload).status_code, 400)
        self.assertEqual(self.studio.tts.calls, [])

    def wait(self, task):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            status = self.client.get("/v1/jobs/" + task, headers=self.headers).json()
            if status["status"] not in ("running", "queued"):
                return status
            time.sleep(.01)
        self.fail("job did not finish")

    def test_emotion_job_audio_and_private_paths(self):
        task = self.client.post("/v1/speech", headers=self.headers, json={"text": "主人，辛苦了。", "voice": "feiyu-index", "emotion": "gentle"}).json()["id"]
        state = self.wait(task)
        self.assertEqual(state["status"], "success")
        self.assertNotIn("audio", state)
        self.assertNotIn(str(self.root), json.dumps(state))
        self.assertEqual(self.studio.tts.calls[0]["emo_vector"], gateway.emotion_vector("gentle"))
        audio = self.client.get("/v1/jobs/" + task + "/audio", headers=self.headers)
        self.assertEqual(audio.status_code, 200)
        self.assertEqual(audio.content[:4], b"RIFF")
        self.assertEqual(self.client.get("/v1/jobs/" + "f" * 32, headers=self.headers).status_code, 404)

    def test_reference_tampering_and_truncation_never_return_success(self):
        (self.root / "models/FeiyuVoice-CosyVoice3/reference.wav").write_bytes(b"changed")
        task = self.client.post("/v1/speech", headers=self.headers, json={"text": "hello", "voice": "feiyu-index"}).json()["id"]
        self.assertEqual(self.wait(task)["status"], "failed")
        self.assertEqual(self.client.get("/v1/jobs/" + task + "/audio", headers=self.headers).status_code, 409)

    def test_character_variants_keep_one_identity_use_original_emotion_and_reject_bad_indices(self):
        folder=self.root/'reference-profiles/character-daily';folder.mkdir(parents=True)
        entries=[]
        for i in range(3):
            file=folder/(str(i)+'.wav')
            with wave.open(str(file),'wb') as output:
                output.setnchannels(1);output.setsampwidth(2);output.setframerate(24000);output.writeframes(bytes([16+i,0])*24000)
            entries.append({'file':file.name,'bytes':file.stat().st_size,'sha256':gateway.hashlib.sha256(file.read_bytes()).hexdigest()})
        record={'schema':1,'voice':'character-daily','speaker':entries[0],'emotions':{'shy':[entries[1]]*7+[entries[2]]},'emotionAlpha':.65}
        manifest=folder/'manifest.json';manifest.write_text(json.dumps(record))
        task=self.client.post('/v1/speech',headers=self.headers,json={'voice':'character-daily','emotion':'shy','variant':7,'text':'嗯，我听着呢。'}).json()['id']
        self.assertEqual(self.wait(task)['status'],'success');call=self.studio.tts.calls[-1]
        self.assertEqual(call['spk_audio_prompt'],str(folder/'0.wav'));self.assertEqual(call['emo_audio_prompt'],str(folder/'2.wav'));self.assertEqual(call['emo_alpha'],.65);self.assertNotIn('emo_vector',call)
        for bad in [-1,8,True,'1']:
            self.assertEqual(self.client.post('/v1/speech',headers=self.headers,json={'voice':'character-daily','text':'你好','variant':bad}).status_code,400)
        (folder/'2.wav').write_bytes(b'changed')
        with self.assertRaises(ValueError):gateway.checked_character_reference(self.root,'shy',7)
        record['speaker']['file']='../../outside.wav';manifest.write_text(json.dumps(record))
        with self.assertRaises(ValueError):gateway.checked_character_reference(self.root,'shy',0)

    def test_shared_gpu_lock_is_respected(self):
        with self.studio._INFER_LOCK:
            task = self.client.post("/v1/speech", headers=self.headers, json={"text": "hello", "voice": "feiyu-index"}).json()["id"]
            time.sleep(.03)
            self.assertEqual(self.studio.tts.calls, [])
        self.assertEqual(self.wait(task)["status"], "success")

    def test_ssr_profile_uses_cleaned_reference_and_rejects_tampering(self):
        folder = self.root / "reference-profiles/feiyu-ssr"
        folder.mkdir(parents=True)
        ref = folder / "vocals.wav"
        with wave.open(str(ref), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(b"\x10\x00" * 24000)
        record = {"file": ref.name, "bytes": ref.stat().st_size,
                  "sha256": gateway.hashlib.sha256(ref.read_bytes()).hexdigest()}
        manifest = folder / "manifest.json"
        manifest.write_text(json.dumps(record))
        task = self.client.post("/v1/speech", headers=self.headers,
            json={"text": "主人，开饭啦。", "voice": "feiyu-ssr"}).json()["id"]
        self.assertEqual(self.wait(task)["status"], "success")
        self.assertEqual(self.studio.tts.calls[-1]["spk_audio_prompt"], str(ref))
        ref.write_bytes(b"changed")
        task = self.client.post("/v1/speech", headers=self.headers,
            json={"text": "主人，开饭啦。", "voice": "feiyu-ssr"}).json()["id"]
        self.assertEqual(self.wait(task)["status"], "failed")
        record["file"] = "../../../../outside.wav"
        manifest.write_text(json.dumps(record))
        with self.assertRaises(ValueError):
            gateway.checked_ssr_reference(self.root)


if __name__ == "__main__":
    unittest.main()
