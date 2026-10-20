"""BL-0081: o glossário do cliente entra no prompt do Whisper; sem glossário o prompt é o de antes.

Rodar: python3 -m unittest discover -s services/asr -p 'test_*.py'  (não precisa do mlx-whisper)
"""
import sys
import types
import unittest

# O teste não carrega o modelo: troca o mlx_whisper por um módulo vazio antes de importar o script.
fake = types.ModuleType("mlx_whisper")
fake_audio = types.ModuleType("mlx_whisper.audio")
fake_audio.SAMPLE_RATE = 16000
fake_audio.load_audio = lambda *_: None
fake.audio = fake_audio
sys.modules.setdefault("mlx_whisper", fake)
sys.modules.setdefault("mlx_whisper.audio", fake_audio)

import transcribe as t  # noqa: E402


class InitialPrompt(unittest.TestCase):
    def test_sem_glossario_igual_ao_de_antes(self):
        self.assertEqual(t.initial_prompt(True), t.VERBATIM_PROMPT)
        self.assertEqual(t.initial_prompt(True, ""), t.VERBATIM_PROMPT)
        self.assertEqual(t.initial_prompt(True, "   "), t.VERBATIM_PROMPT)
        self.assertIsNone(t.initial_prompt(False))
        self.assertIsNone(t.initial_prompt(False, None))

    def test_glossario_depois_do_ao_pe_da_letra(self):
        self.assertEqual(t.initial_prompt(True, "Daniel Sun, Eustosina"), t.VERBATIM_PROMPT + " Nomes e marcas: Daniel Sun, Eustosina.")
        self.assertEqual(t.initial_prompt(False, "Eustosina"), "Nomes e marcas: Eustosina.")


if __name__ == "__main__":
    unittest.main()
