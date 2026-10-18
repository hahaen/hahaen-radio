import { describe, expect, it } from 'vitest';
import { languageFilterAliases, normalizeLanguages } from './languages.js';
describe('catalogue language vocabulary', () => {
  it('merges equivalent languages and rejects non-language upstream values', () => {
    expect(
      normalizeLanguages([
        'English',
        'eng',
        'engilsh',
        'en',
        '123',
        '__proto__',
        'constructor',
        'rock',
        'https://example.com',
        'pop',
        '中文不是语言代码',
        '日本語不是代码',
      ]),
    ).toEqual(['en']);
    expect(normalizeLanguages(['cmn', 'yue', 'pt-br', 'fil', 'gsw', '德语'])).toEqual([
      'zh',
      'yue',
      'pt-BR',
      'fil',
      'gsw',
      'de',
    ]);
  });
  it('keeps old snapshot aliases searchable during a component update', () => {
    expect(languageFilterAliases(['en', 'pt-BR'])).toEqual(
      expect.arrayContaining(['en', 'english', 'engilsh', 'pt-br', 'brazilian portuguese']),
    );
    expect(languageFilterAliases([])).toEqual([]);
  });
});
