// Corretor ortográfico do macOS (pt-BR), via JavaScript for Automation.
// Uso: osascript -l JavaScript spell.js palavra1 palavra2 …  → JSON { palavra: [sugestões] } só das erradas.
ObjC.import('AppKit');
function run(argv) {
  const sc = $.NSSpellChecker.sharedSpellChecker;
  const langs = ObjC.deepUnwrap(sc.availableLanguages) || [];
  const lang = langs.find((l) => /^pt(_|-)?BR/i.test(l)) || langs.find((l) => /^pt/i.test(l));
  if (!lang) return '{}';
  sc.setLanguage(lang);
  const out = {};
  for (const w of argv) {
    if (sc.checkSpellingOfStringStartingAt(w, 0).length > 0) {
      const g = sc.guessesForWordRangeInStringLanguageInSpellDocumentWithTag($.NSMakeRange(0, w.length), w, lang, 0);
      out[w] = (ObjC.deepUnwrap(g) || []).slice(0, 4);
    }
  }
  return JSON.stringify(out);
}
