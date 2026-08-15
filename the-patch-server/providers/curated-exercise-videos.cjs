/**
 * Hand-picked Pexels clips for common exercises.
 * Prefer these over live search when the coach query matches a key
 * (exact or substring). videoUrl must be a direct MP4 hotlink.
 *
 * Keys should be lowercase exercise names / phrases.
 */
const CURATED_EXERCISE_VIDEOS = {
  squat: {
    // https://www.pexels.com/video/woman-doing-squats-in-the-gym-6980032/
    videoUrl:
      'https://videos.pexels.com/video-files/6980032/6980032-sd_338_640_30fps.mp4',
    photographerName: 'Monstera Production',
    photographerProfileUrl: 'https://www.pexels.com/@gabby-k',
  },
  'kettlebell swing': {
    // https://www.pexels.com/video/man-wearing-face-mask-working-out-at-the-gym-10336282/
    videoUrl:
      'https://videos.pexels.com/video-files/10336282/10336282-sd_960_540_30fps.mp4',
    photographerName: 'shaand jiafitness',
    photographerProfileUrl: 'https://www.pexels.com/@shaand-jiafitness-32886884',
  },
  'bicep curl': {
    // https://www.pexels.com/video/man-using-dumbbells-5837657/
    videoUrl:
      'https://videos.pexels.com/video-files/5837657/5837657-sd_640_360_24fps.mp4',
    photographerName: 'RDNE Stock project',
    photographerProfileUrl: 'https://www.pexels.com/@rdne',
  },
  deadlift: {
    // https://www.pexels.com/video/a-woman-lifting-a-barbell-7674502/
    videoUrl:
      'https://videos.pexels.com/video-files/7674502/7674502-sd_426_226_25fps.mp4',
    photographerName: 'cottonbro studio',
    photographerProfileUrl: 'https://www.pexels.com/@cottonbro',
  },
  'push up': {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_PUSH_UP/PLACEHOLDER_PUSH_UP.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
  'push-up': {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_PUSH_UP/PLACEHOLDER_PUSH_UP.mp4',
    photographerName: 'TODO — replace after picking clip',
    photographerProfileUrl: 'https://www.pexels.com/@todo',
  },
  pushup: {
    videoUrl:
      'https://videos.pexels.com/video-files/PLACEHOLDER_PUSH_UP/PLACEHOLDER_PUSH_UP.mp4',
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

  // Skip unfinished placeholders so live Pexels search can still run.
  if (entry.videoUrl.includes('PLACEHOLDER')) {
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
