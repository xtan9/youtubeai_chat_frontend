/**
 * Extracts the YouTube video ID from a YouTube URL.
 */
export function getYoutubeVideoId(url: string) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);

  return match && match[2].length === 11 ? match[2] : null;
}

/**
 * Counts words while treating CJK characters as individual words.
 */
export function countWords(text: string): number {
  const cleanText = text.trim().replace(/\s+/g, " ");
  if (!cleanText) return 0;

  const chineseRegex = /[\u4e00-\u9fff]/g;
  const chineseChars = cleanText.match(chineseRegex);
  const chineseCount = chineseChars ? chineseChars.length : 0;
  const nonChineseText = cleanText.replace(chineseRegex, "");
  const nonChineseWords = nonChineseText.trim()
    ? nonChineseText.trim().split(/\s+/).length
    : 0;

  return chineseCount + nonChineseWords;
}
