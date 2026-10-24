/**
 * Parse standard LRC or plain text lyrics.
 * Strips timestamp tags like [01:23.45] from the display text.
 * Returns an array of { id, time, text } objects.
 * If the lyrics have timestamps, time is in seconds (float).
 * If the lyrics are plain text, time is -1.
 */
export function parseLrc(rawLyrics) {
  if (!rawLyrics || typeof rawLyrics !== 'string') {
    return [];
  }

  const lines = rawLyrics.split(/\r?\n/);
  // Match timestamps like [00:12.34], [01:23.456], [02:34], [00:12:34]
  const timeRegex = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const parsed = [];
  let hasTimestamp = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine) continue;

    // Ignore metadata tags like [ti:Title], [ar:Artist], [al:Album], [by:Author], [offset:0], etc.
    if (/^\[(ti|ar|al|by|offset|length|re|ve|encoding):/i.test(rawLine)) {
      continue;
    }

    const matches = [...rawLine.matchAll(timeRegex)];
    if (matches.length > 0) {
      hasTimestamp = true;
      // Strip out all timestamps to get the clean display text
      const cleanText = rawLine.replace(timeRegex, '').trim();

      for (const match of matches) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        let ms = 0;
        if (match[3]) {
          // Normalize 1, 2, or 3 digits to fractional seconds
          const msStr = match[3].padEnd(3, '0').slice(0, 3);
          ms = parseInt(msStr, 10) / 1000;
        }
        const time = min * 60 + sec + ms;

        parsed.push({
          time,
          text: cleanText,
        });
      }
    } else {
      // Plain text line without timestamp
      if (!rawLine.startsWith('[')) {
        parsed.push({
          time: -1,
          text: rawLine,
        });
      }
    }
  }

  if (hasTimestamp) {
    // Sort all timed entries by time ascending
    return parsed
      .filter((item) => item.time >= 0)
      .sort((a, b) => a.time - b.time)
      .map((item, idx) => ({ ...item, id: idx }));
  }

  // Plain lyrics fallback
  return parsed.map((item, idx) => ({ ...item, id: idx }));
}

/**
 * Given the current playback time (in seconds) and parsed lyrics array,
 * find the index of the currently active lyric line.
 */
export function getActiveLyricIndex(parsedLyrics, currentTime) {
  if (!parsedLyrics || parsedLyrics.length === 0) return -1;
  // If lyrics are not timestamped (time === -1), return -1
  if (parsedLyrics[0].time < 0) return -1;

  let activeIdx = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    if (currentTime >= parsedLyrics[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}
