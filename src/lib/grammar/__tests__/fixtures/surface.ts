// Test-only okurigana rule shared by the conjugation tests: the verb's
// kanji part never changes, the kana after it follows the expected reading.
// E.g. 思い出す/おもいだす: kana tail "す", kanji part 思い出 <-> おもいだ, so
// おもいだします -> 思い出します. Independent of conjugate.ts.

const isHiragana = (ch: string) => /[ぁ-ゟ]/.test(ch);

export function surfaceFromReading(dictSurface: string, dictReading: string, formReading: string): string {
  let k = 0;
  while (k < dictSurface.length && isHiragana(dictSurface[dictSurface.length - 1 - k])) k++;
  const tail = dictSurface.slice(dictSurface.length - k);
  if (!dictReading.endsWith(tail)) throw new Error(`${dictSurface}: 假名詞尾 ${tail} 與讀音 ${dictReading} 不一致`);
  const kanjiPart = dictSurface.slice(0, dictSurface.length - k);
  const readingPrefix = dictReading.slice(0, dictReading.length - k);
  if (!formReading.startsWith(readingPrefix)) throw new Error(`${dictSurface}: ${formReading} 不以 ${readingPrefix} 開頭`);
  return kanjiPart + formReading.slice(readingPrefix.length);
}
