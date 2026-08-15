/**
 * Hand-picked Pexels clips for common exercises.
 * Prefer these over live search when the coach query matches a key
 * (exact or substring). Fill placeholders with direct MP4 URLs from pexels.com.
 *
 * Keys should be lowercase exercise names / phrases.
 */
const CURATED_EXERCISE_VIDEOS = {
  squat: {
    videoUrl: 'https://videos.pexels.com/video-files/PLACEHOLDER_SQUAT/PLACEHOLDER_SQUAT.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
  'kettlebell swing': {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_KB_SWING/PLACEHOLDER_KB_SWING.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
  'bicep curl': {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_BICEP_CURL/PLACEHOLDER_BICEP_CURL.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
  'deadlift': {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_DEADLIFT/PLACEHOLDER_DEADLIFT.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
};

/**
 * Exact or substring match against curated keys (longest key wins).
 * @param {string} normalizedQuery lowercase trimmed query
 * @returns {{ videoUrl: string, photographerName: string, photographerProfileUrl: string }|null}
 */
function findCuratedExerciseVideo(normalizedQuery) {
  if (!normalizedQuery) return null;

  const matches = Object.entries(CURATED_EXERCISE_VIDEOS).filter(([key]) => {
    const k = String(key).toLowerCase().trim();
    if (!k) return false;
    return (
      normalizedQuery === k ||
      normalizedQuery.includes(k) ||
      k.includes(normalizedQuery)
    );
  });

  if (matches.length === 0) return null;

  matches.sort((a, b) => b[0].length - a[0].length);
  const entry = matches[0][1];
  if (!entry || typeof entry.videoUrl !== 'string' || !entry.videoUrl) {
    return null;
  }

  return {
    videoUrl: entry.videoUrl,
    photographerName: entry.photographerName || 'Unknown',
    photographerProfileUrl:
      entry.photographerProfileUrl || 'https://www.pexels.com',
  };
}

module.exports = {
  CURATED_EXERCISE_VIDEOS,
  findCuratedExerciseVideo,
};
